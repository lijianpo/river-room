import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { aiDifficultySchema, buyInBbSchema, roomConfigSchema, statsModeSchema, type AuthUser, type PlayerProfileView } from '@poker/contracts';
import sharp from 'sharp';
import { z } from 'zod';
import type { AdminService } from './admin.js';
import type { BankrollService } from './bankroll.js';
import { avatarUrl, isPresetAvatar, PRESET_AVATARS, presetAvatarSvg } from './avatar.js';
import type { AuthService, SessionRecord } from './auth.js';
import { config } from './config.js';
import type { PersistenceService } from './persistence.js';
import type { PresenceService } from './presence.js';
import type { RoomManager } from './room-manager.js';

const displayNameSchema = z.string().trim().min(2, '昵称至少 2 个字符').max(16, '昵称最多 16 个字符');
const passwordSchema = z.string().min(8, '密码至少 8 位').max(72, '密码最多 72 位');
const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

function publicAuth(session: SessionRecord): AuthUser {
  return {
    identityId: session.identityId,
    userId: session.userId,
    displayName: session.displayName,
    email: session.email,
    isGuest: session.isGuest,
    avatarUrl: session.avatarUrl,
    isAdmin: session.isAdmin,
    mustChangePassword: session.mustChangePassword,
    accountStatus: session.accountStatus,
  };
}

function requireAuth(auth: AuthService, request: FastifyRequest, reply: FastifyReply): SessionRecord | null {
  const session = auth.loadRequest(request);
  if (!session) {
    void reply.code(401).send({ error: '请先进入游戏' });
    return null;
  }
  return session;
}

function requireReady(auth: AuthService, request: FastifyRequest, reply: FastifyReply): SessionRecord | null {
  const session = requireAuth(auth, request, reply);
  if (!session) return null;
  if (session.mustChangePassword) {
    void reply.code(403).send({ error: '请先修改临时密码' });
    return null;
  }
  return session;
}

function requireAdmin(auth: AuthService, request: FastifyRequest, reply: FastifyReply): SessionRecord | null {
  const session = requireReady(auth, request, reply);
  if (!session) return null;
  if (!session.isAdmin || !session.userId) {
    void reply.code(403).send({ error: '需要管理员权限' });
    return null;
  }
  return session;
}

function message(error: unknown): string {
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? '输入格式错误';
  return error instanceof Error ? error.message : '操作失败';
}

async function removeUploadedAvatar(directory: string, value: string | null | undefined): Promise<void> {
  if (!value || !/^[a-f0-9-]+\.webp$/i.test(value)) return;
  await fs.unlink(path.join(directory, value)).catch(() => undefined);
}

export function registerRoutes(
  app: FastifyInstance,
  services: {
    auth: AuthService;
    rooms: RoomManager;
    persistence: PersistenceService;
    presence: PresenceService;
    admin: AdminService;
    bankroll: BankrollService;
    notifyWallet: (userId: string) => void;
    disconnectUser: (userId: string) => void;
    avatarDirectory: string;
  },
): void {
  const { auth, rooms, persistence, presence, admin, bankroll, notifyWallet, disconnectUser, avatarDirectory } = services;

  app.get('/api/health', async () => ({ ok: true, time: Date.now() }));

  app.get('/api/avatars/preset/:id', async (request, reply) => {
    const params = z.object({ id: z.string() }).safeParse(request.params);
    const svg = params.success ? presetAvatarSvg(params.data.id) : null;
    if (!svg) return reply.code(404).send({ error: '头像不存在' });
    return reply.header('cache-control', 'public, max-age=86400').type('image/svg+xml').send(svg);
  });

  app.get('/api/public/overview', async () => {
    const counts = presence.counts();
    const season = persistence.currentSeason();
    return {
      ...counts,
      season,
      entries: persistence.leaderboard(season).slice(0, 10),
      generatedAt: Date.now(),
    };
  });

  app.get('/api/public/rooms/invite/:code', async (request, reply) => {
    const params = z.object({ code: z.string().trim().regex(/^[A-HJ-NP-Z2-9]{6}$/i) }).safeParse(request.params);
    if (!params.success) return reply.code(404).send({ error: '房间不存在或邀请码无效' });
    const room = rooms.invitePreview(params.data.code.toUpperCase());
    if (!room) return reply.code(404).send({ error: '房间不存在或邀请码无效' });
    return { room };
  });

  app.get('/api/auth/me', async (request, reply) => {
    const session = auth.loadRequest(request);
    if (!session) return reply.code(401).send({ error: '未登录' });
    return {
      user: publicAuth(session),
      wallet: session.userId ? bankroll.wallet(session.userId) : null,
      currentRoom: rooms.roomForIdentity(session.identityId),
    };
  });

  app.post('/api/auth/guest', async (request, reply) => {
    try {
      const input = z.object({ displayName: displayNameSchema }).parse(request.body);
      const existing = auth.loadRequest(request);
      const session = existing?.isGuest ? auth.updateGuestName(existing, input.displayName) : auth.createGuest(input.displayName, reply);
      return { user: publicAuth(session) };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/auth/register', async (request, reply) => {
    try {
      const input = z.object({ email: z.string().trim().email('请输入有效邮箱'), password: passwordSchema, displayName: displayNameSchema }).parse(request.body);
      const current = auth.loadRequest(request);
      if (current && rooms.roomForIdentity(current.identityId)) throw new Error('请先离开当前房间再升级账号');
      const session = await auth.register(current, input, reply);
      return { user: publicAuth(session) };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    try {
      const input = z.object({ email: z.string().trim().email(), password: z.string().min(1) }).parse(request.body);
      const current = auth.loadRequest(request);
      if (current && rooms.roomForIdentity(current.identityId)) throw new Error('请先离开当前房间再切换账号');
      const session = await auth.login(input.email, input.password, reply, current);
      return { user: publicAuth(session) };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const session = auth.loadRequest(request);
    if (session && !session.mustChangePassword && rooms.roomForIdentity(session.identityId)) return reply.code(409).send({ error: '请先离开当前房间' });
    auth.logout(request, reply);
    return { ok: true };
  });

  app.post('/api/account/daily-bonus', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    if (!session.userId) return reply.code(400).send({ error: '游客不能领取账号筹码' });
    try {
      const wallet = bankroll.claimDailyBonus(session.userId);
      notifyWallet(session.userId);
      return { wallet, awarded: wallet.dailyBonusAmount };
    } catch (error) {
      const errorMessage = message(error);
      return reply.code(errorMessage.includes('已经领取') ? 409 : 400).send({ error: errorMessage });
    }
  });

  app.get('/api/account/transactions', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    if (!session.userId) return reply.code(403).send({ error: '游客没有筹码账户' });
    const query = z.object({
      limit: z.coerce.number().int().min(1).max(100).default(30),
      cursor: z.string().max(120).optional(),
    }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: '查询参数无效' });
    return bankroll.listTransactions(session.userId, query.data);
  });

  app.patch('/api/account/profile', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    if (!session.userId) return reply.code(400).send({ error: '游客需要先升级账号' });
    if (rooms.roomForIdentity(session.identityId)) return reply.code(409).send({ error: '请先离开当前房间再修改资料' });
    try {
      const input = z.object({ displayName: displayNameSchema, presetAvatar: z.string().optional() }).parse(request.body);
      if (input.presetAvatar && !isPresetAvatar(input.presetAvatar)) throw new Error('预设头像无效');
      const previous = auth.getUser(session.userId);
      const updated = auth.updateProfile(session, input.displayName, input.presetAvatar);
      if (input.presetAvatar && previous?.avatarType === 'upload') await removeUploadedAvatar(avatarDirectory, previous.avatarValue);
      return { user: publicAuth(updated) };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/account/avatar', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    if (!session.userId) return reply.code(400).send({ error: '游客需要先升级账号' });
    if (rooms.roomForIdentity(session.identityId)) return reply.code(409).send({ error: '请先离开当前房间再修改头像' });
    let filename: string | null = null;
    try {
      const file = await request.file({ limits: { files: 1, fileSize: 2 * 1024 * 1024 } });
      if (!file) throw new Error('请选择头像图片');
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw new Error('头像仅支持 JPEG、PNG 或 WebP');
      const buffer = await file.toBuffer();
      const metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 16_000_000 }).metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('图片文件格式无效');
      await fs.mkdir(avatarDirectory, { recursive: true });
      filename = `${randomUUID()}.webp`;
      await sharp(buffer, { failOn: 'error', animated: false, limitInputPixels: 16_000_000 })
        .rotate()
        .resize(256, 256, { fit: 'cover', position: 'centre' })
        .webp({ quality: 86 })
        .toFile(path.join(avatarDirectory, filename));
      const previous = auth.getUser(session.userId);
      const updated = auth.updateAvatar(session, 'upload', filename);
      if (previous?.avatarType === 'upload') await removeUploadedAvatar(avatarDirectory, previous.avatarValue);
      return { user: publicAuth(updated) };
    } catch (error) {
      if (filename) await removeUploadedAvatar(avatarDirectory, filename);
      return reply.code(400).send({ error: message(error).includes('too large') ? '头像不能超过 2MB' : message(error) });
    }
  });

  app.post('/api/account/password', async (request, reply) => {
    const session = requireAuth(auth, request, reply);
    if (!session) return;
    if (!session.userId) return reply.code(400).send({ error: '游客没有密码' });
    if (!session.mustChangePassword && rooms.roomForIdentity(session.identityId)) return reply.code(409).send({ error: '请先离开当前房间再修改密码' });
    try {
      const input = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }).parse(request.body);
      if (input.currentPassword === input.newPassword) throw new Error('新密码不能与当前密码相同');
      const updated = await auth.changePassword(session, input.currentPassword, input.newPassword, reply);
      disconnectUser(session.userId);
      return { user: publicAuth(updated) };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.get('/api/rooms', async () => ({ rooms: rooms.listPublicRooms() }));

  app.post('/api/rooms', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    try {
      const roomConfig = roomConfigSchema.parse(request.body);
      const buyInInput = z.object({ buyInBb: z.unknown().optional() }).passthrough().parse(request.body).buyInBb;
      const buyInBb = roomConfig.ranked && roomConfig.mode === 'cash' ? buyInBbSchema.parse(buyInInput) : undefined;
      return { room: rooms.createRoom(publicAuth(session), roomConfig, buyInBb), role: 'player' };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/rooms/join', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    try {
      const input = z.object({ code: z.string().trim().min(1).max(40) }).parse(request.body);
      return { room: rooms.joinRoom(publicAuth(session), input.code), role: 'spectator' };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/rooms/:roomId/join', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    try {
      const params = z.object({ roomId: z.string().uuid() }).parse(request.params);
      return { room: rooms.joinRoom(publicAuth(session), params.roomId), role: 'spectator' };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.get('/api/leaderboard', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    const query = z.object({ season: z.string().regex(/^\d{4}-\d{2}$/).optional() }).safeParse(request.query);
    const season = query.success ? (query.data.season ?? persistence.currentSeason()) : persistence.currentSeason();
    return { season, entries: persistence.leaderboard(query.success ? query.data.season : undefined) };
  });

  app.get('/api/history', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    const query = z.object({ limit: z.coerce.number().int().min(1).max(100).default(50) }).safeParse(request.query);
    return { hands: persistence.listHistory(session.identityId, query.success ? query.data.limit : 50) };
  });

  app.get('/api/history/:handId', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    const params = z.object({ handId: z.string().uuid() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: '牌谱编号无效' });
    const hand = persistence.handDetail(session.identityId, params.data.handId);
    if (!hand) return reply.code(404).send({ error: '牌谱不存在或无权查看' });
    return { hand };
  });

  app.get('/api/stats/me', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    const query = z.object({ mode: statsModeSchema.default('all') }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: '统计模式无效' });
    return { stats: persistence.playerStats(session.identityId, query.data.mode) };
  });

  app.get('/api/stats/users/:userId', async (request, reply) => {
    const session = requireReady(auth, request, reply);
    if (!session) return;
    const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);
    const query = z.object({ mode: statsModeSchema.default('all') }).safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: '查询参数无效' });
    const user = auth.getUser(params.data.userId);
    if (!user) return reply.code(404).send({ error: '玩家不存在' });
    // 只返回聚合数据，不包含任何底牌或单手记录。
    const profile: PlayerProfileView = {
      userId: user.id,
      displayName: user.displayName,
      avatarUrl: avatarUrl(user.avatarType, user.avatarValue),
      stats: persistence.playerStats(`u:${user.id}`, query.data.mode),
    };
    return { profile };
  });

  app.get('/api/meta', async () => ({
    aiDifficulties: aiDifficultySchema.options,
    turnTimeoutMs: config.turnTimeoutMs,
    presetAvatars: PRESET_AVATARS,
    ...admin.getSettings(),
  }));

  app.get('/api/admin/users', async (request, reply) => {
    if (!requireAdmin(auth, request, reply)) return;
    const query = pageQuerySchema.extend({ search: z.string().max(80).optional(), status: z.enum(['all', 'active', 'disabled', 'online', 'offline']).default('all') }).parse(request.query);
    return { ...admin.listUsers({ page: query.page, pageSize: query.pageSize, status: query.status, ...(query.search ? { search: query.search } : {}) }), ...presence.counts() };
  });

  app.patch('/api/admin/users/:userId/status', async (request, reply) => {
    const actor = requireAdmin(auth, request, reply);
    if (!actor) return;
    try {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
      const input = z.object({ status: z.enum(['active', 'disabled']), reason: z.string().trim().max(200).optional() }).parse(request.body);
      admin.setUserStatus(actor, userId, input.status, input.reason, request.ip);
      if (input.status === 'disabled') {
        rooms.disableUser(userId);
        disconnectUser(userId);
      }
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/admin/users/:userId/chips/adjust', async (request, reply) => {
    const actor = requireAdmin(auth, request, reply);
    if (!actor?.userId) return;
    try {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
      const input = z.object({
        direction: z.enum(['add', 'deduct']),
        amount: z.number().int().min(1).max(1_000_000),
        reason: z.string().trim().min(2, '调整原因至少 2 个字符').max(200),
      }).parse(request.body);
      const delta = input.direction === 'add' ? input.amount : -input.amount;
      const wallet = bankroll.adjust(userId, delta, actor.userId, input.reason);
      admin.audit(actor.userId, userId, 'chips.adjust', { amount: delta, reason: input.reason }, request.ip);
      notifyWallet(userId);
      return { wallet };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/admin/users/:userId/force-logout', async (request, reply) => {
    const actor = requireAdmin(auth, request, reply);
    if (!actor) return;
    try {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
      admin.forceLogout(actor, userId, request.ip);
      disconnectUser(userId);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.post('/api/admin/users/:userId/reset-password', async (request, reply) => {
    const actor = requireAdmin(auth, request, reply);
    if (!actor) return;
    try {
      const { userId } = z.object({ userId: z.string().uuid() }).parse(request.params);
      const temporaryPassword = await admin.resetPassword(actor, userId, request.ip);
      disconnectUser(userId);
      return { temporaryPassword };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.get('/api/admin/settings', async (request, reply) => {
    if (!requireAdmin(auth, request, reply)) return;
    return admin.getSettings();
  });

  app.patch('/api/admin/settings', async (request, reply) => {
    const actor = requireAdmin(auth, request, reply);
    if (!actor) return;
    try {
      const input = z.object({ showdownDurationSeconds: z.number().int().min(3).max(30) }).parse(request.body);
      return admin.updateSettings(actor, input.showdownDurationSeconds, request.ip);
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });

  app.get('/api/admin/reports', async (request, reply) => {
    if (!requireAdmin(auth, request, reply)) return;
    const query = pageQuerySchema.extend({ status: z.enum(['all', 'open', 'resolved', 'dismissed']).default('all') }).parse(request.query);
    return admin.listReports(query);
  });

  app.patch('/api/admin/reports/:reportId', async (request, reply) => {
    const actor = requireAdmin(auth, request, reply);
    if (!actor) return;
    try {
      const { reportId } = z.object({ reportId: z.string().uuid() }).parse(request.params);
      const input = z.object({ status: z.enum(['resolved', 'dismissed']), note: z.string().trim().max(500).optional() }).parse(request.body);
      admin.updateReport(actor, reportId, input.status, input.note, request.ip);
      return { ok: true };
    } catch (error) {
      return reply.code(400).send({ error: message(error) });
    }
  });
}
