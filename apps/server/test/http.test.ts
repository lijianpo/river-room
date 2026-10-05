import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, type BuiltServer } from '../src/index.js';

let server: BuiltServer | null = null;
let temporaryDirectory = '';

afterEach(async () => {
  if (server) await server.close();
  server = null;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = '';
});

describe('HTTP 大厅流程', () => {
  it('允许反向代理后的公网同源请求并拒绝外部来源', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'poker-sol-test-'));
    server = await buildServer({ databasePath: join(temporaryDirectory, 'test.db'), logger: false });

    const sameOrigin = await server.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        host: 'localhost:3001',
        origin: 'https://river-room.example.com',
        'x-forwarded-host': 'river-room.example.com',
      },
    });
    expect(sameOrigin.statusCode).toBe(200);
    expect(sameOrigin.headers['access-control-allow-origin']).toBe('https://river-room.example.com');

    const foreignOrigin = await server.app.inject({
      method: 'GET',
      url: '/api/health',
      headers: {
        host: 'localhost:3001',
        origin: 'https://malicious.example.com',
        'x-forwarded-host': 'river-room.example.com',
      },
    });
    expect(foreignOrigin.statusCode).toBe(500);
  });

  it('游客没有筹码流水，注册用户可读取初始筹码记录', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'poker-sol-test-'));
    server = await buildServer({ databasePath: join(temporaryDirectory, 'test.db'), logger: false });
    const guest = await server.app.inject({ method: 'POST', url: '/api/auth/guest', payload: { displayName: '流水游客' } });
    const guestList = await server.app.inject({ method: 'GET', url: '/api/account/transactions', headers: { cookie: String(guest.headers['set-cookie']).split(';')[0]! } });
    expect(guestList.statusCode).toBe(403);
    const registered = await server.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'ledger@example.com', displayName: '流水玩家', password: 'ledger-test-password' } });
    const list = await server.app.inject({ method: 'GET', url: '/api/account/transactions?limit=10', headers: { cookie: String(registered.headers['set-cookie']).split(';')[0]! } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ transactions: [{ type: 'initial', amount: 10_000 }], nextCursor: null });
  });

  it('两个游客可以创建并加入休闲房', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'poker-sol-test-'));
    server = await buildServer({ databasePath: join(temporaryDirectory, 'test.db'), logger: false });

    const firstGuest = await server.app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { displayName: '测试玩家一' },
    });
    expect(firstGuest.statusCode).toBe(200);
    const firstCookie = firstGuest.headers['set-cookie'];
    expect(firstCookie).toBeTypeOf('string');

    const create = await server.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { cookie: String(firstCookie).split(';')[0]! },
      payload: {
        name: '测试牌桌',
        mode: 'cash',
        visibility: 'public',
        ranked: false,
        maxSeats: 6,
        targetPlayers: 3,
        smallBlind: 10,
        bigBlind: 20,
        startingStackBb: 100,
        autoFillAi: true,
        aiDifficulty: 'normal',
      },
    });
    expect(create.statusCode).toBe(200);
    const roomId = create.json<{ room: { id: string } }>().room.id;

    const secondGuest = await server.app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { displayName: '测试玩家二' },
    });
    const secondCookie = secondGuest.headers['set-cookie'];
    const joinResponse = await server.app.inject({
      method: 'POST',
      url: `/api/rooms/${roomId}/join`,
      headers: { cookie: String(secondCookie).split(';')[0]! },
    });
    expect(joinResponse.statusCode).toBe(200);
    expect(joinResponse.json<{ room: { seated: number; humans: number; spectators: number } }>().room).toMatchObject({ seated: 1, humans: 1, spectators: 1 });

    const lobby = await server.app.inject({ method: 'GET', url: '/api/rooms' });
    expect(lobby.json<{ rooms: Array<{ id: string }> }>().rooms.some((room) => room.id === roomId)).toBe(true);
  });

  it('无需登录即可用邀请码预览私密房间', async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), 'poker-sol-test-'));
    server = await buildServer({ databasePath: join(temporaryDirectory, 'test.db'), logger: false });

    const guest = await server.app.inject({
      method: 'POST',
      url: '/api/auth/guest',
      payload: { displayName: '邀请发起人' },
    });
    const cookie = guest.headers['set-cookie'];
    const create = await server.app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { cookie: String(cookie).split(';')[0]! },
      payload: {
        name: '扫码私密桌',
        mode: 'cash',
        visibility: 'private',
        ranked: false,
        maxSeats: 6,
        targetPlayers: 3,
        smallBlind: 10,
        bigBlind: 20,
        startingStackBb: 100,
        autoFillAi: false,
        aiDifficulty: 'normal',
      },
    });
    const code = create.json<{ room: { code: string } }>().room.code;

    const preview = await server.app.inject({
      method: 'GET',
      url: `/api/public/rooms/invite/${code.toLowerCase()}`,
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json<{ room: Record<string, unknown> }>().room).toMatchObject({
      name: '扫码私密桌',
      mode: 'cash',
      visibility: 'private',
      ranked: false,
      status: 'waiting',
      seated: 1,
      maxSeats: 6,
      spectators: 0,
    });
    expect(preview.json<{ room: Record<string, unknown> }>().room).not.toHaveProperty('id');
    expect(preview.json<{ room: Record<string, unknown> }>().room).not.toHaveProperty('code');

    const missing = await server.app.inject({ method: 'GET', url: '/api/public/rooms/invite/AAAAAA' });
    expect(missing.statusCode).toBe(404);
  });
});
