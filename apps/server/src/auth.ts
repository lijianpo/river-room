import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Algorithm, hash, verify, Version } from '@node-rs/argon2';
import type { AccountStatus, AuthUser } from '@poker/contracts';
import { and, eq, gt, ne } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { avatarUrl, PRESET_AVATARS } from './avatar.js';
import type { BankrollService } from './bankroll.js';
import { config } from './config.js';
import type { PokerDatabase } from './db/index.js';
import { sessions, users } from './db/schema.js';

export const SESSION_COOKIE = 'poker_session';

export interface SessionRecord extends AuthUser {
  tokenHash: string;
  expiresAt: number;
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function adminForEmail(email: string | null | undefined): boolean {
  return Boolean(email && config.adminEmails.has(email.trim().toLowerCase()));
}

function guestAvatar(identityId: string): string {
  const score = [...identityId].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return PRESET_AVATARS[score % PRESET_AVATARS.length]?.id ?? 'spade';
}

function userFromRows(session: typeof sessions.$inferSelect, user?: typeof users.$inferSelect): SessionRecord {
  const email = user?.email ?? null;
  return {
    tokenHash: session.tokenHash,
    identityId: session.identityId,
    userId: session.userId,
    displayName: user?.displayName ?? session.displayName,
    email,
    isGuest: session.userId === null,
    avatarUrl: user ? avatarUrl(user.avatarType, user.avatarValue) : avatarUrl('preset', guestAvatar(session.identityId)),
    isAdmin: adminForEmail(email),
    mustChangePassword: user?.passwordMustChange ?? false,
    accountStatus: (user?.accountStatus as AccountStatus | undefined) ?? 'active',
    expiresAt: session.expiresAt,
  };
}

export class AuthService {
  constructor(
    private readonly db: PokerDatabase,
    private readonly bankroll: BankrollService,
  ) {}

  async createPasswordHash(password: string): Promise<string> {
    return hash(password, {
      algorithm: Algorithm.Argon2id,
      version: Version.V0x13,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });
  }

  async verifyPassword(encoded: string, password: string): Promise<boolean> {
    try {
      return await verify(encoded, password);
    } catch {
      return false;
    }
  }

  loadByToken(token: string | undefined): SessionRecord | null {
    if (!token) return null;
    const now = Date.now();
    const session = this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, now)))
      .get();
    if (!session) return null;
    const user = session.userId ? this.db.select().from(users).where(eq(users.id, session.userId)).get() : undefined;
    if (user?.accountStatus === 'disabled') return null;
    return userFromRows(session, user);
  }

  loadRequest(request: FastifyRequest): SessionRecord | null {
    return this.loadByToken(request.cookies[SESSION_COOKIE]);
  }

  createGuest(displayName: string, reply: FastifyReply): SessionRecord {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const record = {
      tokenHash: tokenHash(token),
      identityId: `g:${randomUUID()}`,
      userId: null,
      displayName,
      createdAt: now,
      expiresAt: now + config.sessionDays * 86_400_000,
    } satisfies typeof sessions.$inferInsert;
    this.db.insert(sessions).values(record).run();
    this.setCookie(reply, token, record.expiresAt);
    return userFromRows(record as typeof sessions.$inferSelect);
  }

  updateGuestName(session: SessionRecord, displayName: string): SessionRecord {
    if (!session.isGuest) return session;
    this.db.update(sessions).set({ displayName }).where(eq(sessions.tokenHash, session.tokenHash)).run();
    return { ...session, displayName };
  }

  async register(
    current: SessionRecord | null,
    input: { email: string; password: string; displayName: string },
    reply: FastifyReply,
  ): Promise<SessionRecord> {
    const email = input.email.trim().toLowerCase();
    if (this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).get()) throw new Error('该邮箱已经注册');
    const id = randomUUID();
    const now = Date.now();
    this.db
      .insert(users)
      .values({
        id,
        email,
        passwordHash: await this.createPasswordHash(input.password),
        displayName: input.displayName,
        avatarType: 'preset',
        avatarValue: 'spade',
        accountStatus: 'active',
        passwordMustChange: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    this.bankroll.initializeUser(id, now);

    if (current) {
      this.db
        .update(sessions)
        .set({ identityId: `u:${id}`, userId: id, displayName: input.displayName })
        .where(eq(sessions.tokenHash, current.tokenHash))
        .run();
      const updated = this.db.select().from(sessions).where(eq(sessions.tokenHash, current.tokenHash)).get();
      const user = this.db.select().from(users).where(eq(users.id, id)).get();
      if (!updated || !user) throw new Error('账号创建失败');
      return userFromRows(updated, user);
    }
    return this.createUserSession(id, reply);
  }

  async login(emailInput: string, password: string, reply: FastifyReply, current?: SessionRecord | null): Promise<SessionRecord> {
    const email = emailInput.trim().toLowerCase();
    const user = this.db.select().from(users).where(eq(users.email, email)).get();
    if (!user || !(await this.verifyPassword(user.passwordHash, password))) throw new Error('邮箱或密码错误');
    if (user.accountStatus === 'disabled') throw new Error('账号已被停用，请联系管理员');
    if (current) this.db.delete(sessions).where(eq(sessions.tokenHash, current.tokenHash)).run();
    return this.createUserSession(user.id, reply);
  }

  logout(request: FastifyRequest, reply: FastifyReply): void {
    const token = request.cookies[SESSION_COOKIE];
    if (token) this.db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token))).run();
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  getUser(userId: string): typeof users.$inferSelect | null {
    return this.db.select().from(users).where(eq(users.id, userId)).get() ?? null;
  }

  updateProfile(session: SessionRecord, displayName: string, presetAvatar?: string): SessionRecord {
    if (!session.userId) throw new Error('游客需要先升级账号');
    const changes: Partial<typeof users.$inferInsert> = { displayName, updatedAt: Date.now() };
    if (presetAvatar) {
      changes.avatarType = 'preset';
      changes.avatarValue = presetAvatar;
    }
    this.db.update(users).set(changes).where(eq(users.id, session.userId)).run();
    this.db.update(sessions).set({ displayName }).where(eq(sessions.userId, session.userId)).run();
    return this.reloadSession(session);
  }

  updateAvatar(session: SessionRecord, type: 'preset' | 'upload', value: string): SessionRecord {
    if (!session.userId) throw new Error('游客需要先升级账号');
    this.db.update(users).set({ avatarType: type, avatarValue: value, updatedAt: Date.now() }).where(eq(users.id, session.userId)).run();
    return this.reloadSession(session);
  }

  async changePassword(session: SessionRecord, currentPassword: string, nextPassword: string, reply: FastifyReply): Promise<SessionRecord> {
    if (!session.userId) throw new Error('游客没有密码');
    const user = this.getUser(session.userId);
    if (!user || !(await this.verifyPassword(user.passwordHash, currentPassword))) throw new Error('当前密码不正确');
    const nextHash = await this.createPasswordHash(nextPassword);
    this.db.update(users).set({ passwordHash: nextHash, passwordMustChange: false, updatedAt: Date.now() }).where(eq(users.id, user.id)).run();
    this.db.delete(sessions).where(eq(sessions.userId, user.id)).run();
    return this.createUserSession(user.id, reply);
  }

  revokeUserSessions(userId: string): void {
    this.db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }

  revokeOtherSessions(userId: string, currentTokenHash: string): void {
    this.db.delete(sessions).where(and(eq(sessions.userId, userId), ne(sessions.tokenHash, currentTokenHash))).run();
  }

  recordLastSeen(userId: string): void {
    this.db.update(users).set({ lastSeenAt: Date.now() }).where(eq(users.id, userId)).run();
  }

  private reloadSession(session: SessionRecord): SessionRecord {
    const row = this.db.select().from(sessions).where(eq(sessions.tokenHash, session.tokenHash)).get();
    const user = session.userId ? this.getUser(session.userId) ?? undefined : undefined;
    if (!row) throw new Error('会话已失效');
    return userFromRows(row, user);
  }

  private createUserSession(userId: string, reply: FastifyReply): SessionRecord {
    const user = this.getUser(userId);
    if (!user) throw new Error('账号不存在');
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const record = {
      tokenHash: tokenHash(token),
      identityId: `u:${userId}`,
      userId,
      displayName: user.displayName,
      createdAt: now,
      expiresAt: now + config.sessionDays * 86_400_000,
    } satisfies typeof sessions.$inferInsert;
    this.db.insert(sessions).values(record).run();
    this.setCookie(reply, token, record.expiresAt);
    return userFromRows(record as typeof sessions.$inferSelect, user);
  }

  private setCookie(reply: FastifyReply, token: string, expiresAt: number): void {
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: reply.request.protocol === 'https',
      path: '/',
      expires: new Date(expiresAt),
    });
  }
}
