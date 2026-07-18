import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { buildServer, type BuiltServer } from '../src/index.js';

let server: BuiltServer | null = null;
let directory = '';
const adminEmail = 'operator@example.com';

afterEach(async () => {
  config.adminEmails.delete(adminEmail);
  if (server) await server.close();
  server = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = '';
});

async function register(email: string, displayName: string): Promise<string> {
  const response = await server!.app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { email, displayName, password: 'initial-password' },
  });
  expect(response.statusCode).toBe(200);
  return String(response.headers['set-cookie']).split(';')[0]!;
}

describe('账号、游客预览与运营后台', () => {
  it('公开预览无需登录，管理员可分页、改设置并发放强制修改的临时密码', async () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-features-'));
    config.adminEmails.add(adminEmail);
    server = await buildServer({ databasePath: join(directory, 'test.db'), avatarDirectory: join(directory, 'avatars'), logger: false });
    const adminCookie = await register(adminEmail, '运营管理员');
    const userCookie = await register('player@example.com', '普通玩家');

    const overview = await server.app.inject({ method: 'GET', url: '/api/public/overview' });
    expect(overview.statusCode).toBe(200);
    expect(overview.json()).toMatchObject({ onlineCount: 0, onlineGuests: 0, entries: [] });

    const denied = await server.app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: userCookie } });
    expect(denied.statusCode).toBe(403);
    const list = await server.app.inject({ method: 'GET', url: '/api/admin/users?page=1&pageSize=1', headers: { cookie: adminCookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json<{ total: number; items: unknown[] }>()).toMatchObject({ total: 2 });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);

    const settings = await server.app.inject({
      method: 'PATCH',
      url: '/api/admin/settings',
      headers: { cookie: adminCookie },
      payload: { showdownDurationSeconds: 11 },
    });
    expect(settings.json()).toEqual({ showdownDurationSeconds: 11 });

    const userId = listAllUserId(await server.app.inject({ method: 'GET', url: '/api/admin/users?pageSize=20', headers: { cookie: adminCookie } }), 'player@example.com');
    const registrationBonus = await server.app.inject({ method: 'POST', url: '/api/account/daily-bonus', headers: { cookie: userCookie } });
    expect(registrationBonus.statusCode).toBe(409);
    const adjusted = await server.app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/chips/adjust`,
      headers: { cookie: adminCookie },
      payload: { direction: 'add', amount: 2_000, reason: '测试运营赠送' },
    });
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json<{ wallet: { availableChips: number; totalChips: number } }>().wallet).toMatchObject({ availableChips: 12_000, totalChips: 12_000 });
    expect((await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: userCookie } })).json<{ wallet: { availableChips: number } }>().wallet.availableChips).toBe(12_000);
    const overdrawn = await server.app.inject({
      method: 'POST',
      url: `/api/admin/users/${userId}/chips/adjust`,
      headers: { cookie: adminCookie },
      payload: { direction: 'deduct', amount: 20_000, reason: '测试超额扣减' },
    });
    expect(overdrawn.statusCode).toBe(400);
    const reset = await server.app.inject({ method: 'POST', url: `/api/admin/users/${userId}/reset-password`, headers: { cookie: adminCookie } });
    expect(reset.statusCode).toBe(200);
    const temporaryPassword = reset.json<{ temporaryPassword: string }>().temporaryPassword;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(16);
    expect((await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: userCookie } })).statusCode).toBe(401);

    const login = await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'player@example.com', password: temporaryPassword } });
    const temporaryCookie = String(login.headers['set-cookie']).split(';')[0]!;
    expect(login.json<{ user: { mustChangePassword: boolean } }>().user.mustChangePassword).toBe(true);
    const blockedRoom = await server.app.inject({ method: 'POST', url: '/api/rooms', headers: { cookie: temporaryCookie }, payload: roomPayload('被阻止的牌桌') });
    expect(blockedRoom.statusCode).toBe(403);

    const changed = await server.app.inject({
      method: 'POST',
      url: '/api/account/password',
      headers: { cookie: temporaryCookie },
      payload: { currentPassword: temporaryPassword, newPassword: 'a-new-secure-password' },
    });
    expect(changed.statusCode).toBe(200);
    expect(changed.json<{ user: { mustChangePassword: boolean } }>().user.mustChangePassword).toBe(false);
    const changedCookie = String(changed.headers['set-cookie']).split(';')[0]!;
    const disable = await server.app.inject({ method: 'PATCH', url: `/api/admin/users/${userId}/status`, headers: { cookie: adminCookie }, payload: { status: 'disabled', reason: '测试封禁' } });
    expect(disable.statusCode).toBe(200);
    expect((await server.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: changedCookie } })).statusCode).toBe(401);
    expect((await server.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'player@example.com', password: 'a-new-secure-password' } })).json<{ error: string }>().error).toMatch(/停用/);
    expect((await server.app.inject({ method: 'PATCH', url: `/api/admin/users/${userId}/status`, headers: { cookie: adminCookie }, payload: { status: 'active' } })).statusCode).toBe(200);
  });

  it('上传头像会校验并转为 WebP，切回预设头像会清理旧文件', async () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-avatar-'));
    const avatarDirectory = join(directory, 'avatars');
    server = await buildServer({ databasePath: join(directory, 'test.db'), avatarDirectory, logger: false });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const cookie = await register('avatar@example.com', '头像玩家');
    const invalidForm = new FormData();
    invalidForm.append('avatar', new Blob(['not-an-image'], { type: 'image/png' }), 'fake.png');
    const invalid = await fetch(`${baseUrl}/api/account/avatar`, { method: 'POST', headers: { cookie }, body: invalidForm });
    expect(invalid.status).toBe(400);
    const png = await sharp({ create: { width: 30, height: 20, channels: 4, background: '#cc2233' } }).png().toBuffer();
    const form = new FormData();
    form.append('avatar', new Blob([Uint8Array.from(png).buffer], { type: 'image/png' }), 'avatar.png');
    const upload = await fetch(`${baseUrl}/api/account/avatar`, { method: 'POST', headers: { cookie }, body: form });
    expect(upload.status).toBe(200);
    const avatarUrl = (await upload.json() as { user: { avatarUrl: string } }).user.avatarUrl;
    expect(avatarUrl).toMatch(/^\/media\/avatars\/[a-f0-9-]+\.webp$/);
    expect(readdirSync(avatarDirectory)).toHaveLength(1);

    const preset = await server.app.inject({
      method: 'PATCH',
      url: '/api/account/profile',
      headers: { cookie },
      payload: { displayName: '头像玩家', presetAvatar: 'heart' },
    });
    expect(preset.statusCode).toBe(200);
    expect(preset.json<{ user: { avatarUrl: string } }>().user.avatarUrl).toBe('/api/avatars/preset/heart');
    expect(readdirSync(avatarDirectory)).toHaveLength(0);
  });
});

function listAllUserId(response: Awaited<ReturnType<BuiltServer['app']['inject']>>, email: string): string {
  const user = response.json<{ items: Array<{ id: string; email: string }> }>().items.find((item) => item.email === email);
  if (!user) throw new Error('测试用户不存在');
  return user.id;
}

function roomPayload(name: string) {
  return {
    name,
    mode: 'cash',
    visibility: 'public',
    ranked: false,
    maxSeats: 6,
    targetPlayers: 2,
    smallBlind: 10,
    bigBlind: 20,
    startingStackBb: 100,
    autoFillAi: false,
    aiDifficulty: 'normal',
  };
}
