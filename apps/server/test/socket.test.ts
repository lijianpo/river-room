import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ack, ClientToServerEvents, GameSnapshot, ServerToClientEvents } from '@poker/contracts';
import { io, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer, type BuiltServer } from '../src/index.js';

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let server: BuiltServer | null = null;
let directory = '';
const clients: ClientSocket[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  if (server) await server.close();
  server = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = '';
});

async function guest(baseUrl: string, name: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ displayName: name }),
  });
  expect(response.ok).toBe(true);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function register(baseUrl: string, email: string, displayName: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, displayName, password: 'wallet-test-password' }),
  });
  expect(response.ok).toBe(true);
  return response.headers.get('set-cookie')!.split(';')[0]!;
}

async function request<T>(baseUrl: string, cookie: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function connect(baseUrl: string, cookie: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const client: ClientSocket = io(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      forceNew: true,
    });
    clients.push(client);
    const timer = setTimeout(() => reject(new Error('Socket 连接超时')), 4_000);
    client.once('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.once('connect_error', reject);
  });
}

function emitAck(client: ClientSocket, event: 'room:subscribe' | 'room:take-seat' | 'room:add-bot' | 'room:start', payload: never): Promise<Ack> {
  return new Promise((resolve) => client.emit(event, payload, resolve));
}

describe('WebSocket 联机牌局', () => {
  it('两个真人和一个 AI 可以同步完成一手牌并生成牌谱', async () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-socket-'));
    server = await buildServer({ databasePath: join(directory, 'socket.db'), logger: false });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const cookieOne = await guest(baseUrl, '联机玩家一');
    const cookieTwo = await guest(baseUrl, '联机玩家二');
    const created = await request<{ room: { id: string } }>(baseUrl, cookieOne, '/api/rooms', {
      name: '联机验收桌',
      mode: 'cash',
      visibility: 'public',
      ranked: false,
      maxSeats: 6,
      targetPlayers: 3,
      smallBlind: 10,
      bigBlind: 20,
      startingStackBb: 100,
      autoFillAi: false,
      aiDifficulty: 'normal',
    });
    await request(baseUrl, cookieTwo, `/api/rooms/${created.room.id}/join`, {});

    const first = await connect(baseUrl, cookieOne);
    const second = await connect(baseUrl, cookieTwo);
    expect((await emitAck(first, 'room:subscribe', { roomId: created.room.id } as never)).ok).toBe(true);
    const spectatorSnapshot = new Promise<GameSnapshot>((resolve) => second.once('room:snapshot', resolve));
    expect((await emitAck(second, 'room:subscribe', { roomId: created.room.id } as never)).ok).toBe(true);
    expect(await spectatorSnapshot).toMatchObject({ selfRole: 'spectator', spectatorCount: 1 });
    const ping = await new Promise<{ ok: true; nonce: string; serverTime: number }>((resolve) => second.emit('connection:ping', { nonce: 'socket-test' }, resolve));
    expect(ping).toMatchObject({ ok: true, nonce: 'socket-test' });
    const overview = await fetch(`${baseUrl}/api/public/overview`).then((response) => response.json() as Promise<{ onlineCount: number; onlineGuests: number }>);
    expect(overview).toMatchObject({ onlineCount: 2, onlineGuests: 2 });
    expect((await emitAck(second, 'room:take-seat', { roomId: created.room.id, seat: 1 } as never)).ok).toBe(true);
    expect((await emitAck(first, 'room:add-bot', { roomId: created.room.id, difficulty: 'easy' } as never)).ok).toBe(true);

    const completed = new Promise<GameSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('手牌未在预期时间内完成')), 12_000);
      const actionVersions = new Set<string>();
      const onSnapshot = (client: ClientSocket) => (snapshot: GameSnapshot) => {
        if (snapshot.resultMessage && snapshot.handId) {
          clearTimeout(timer);
          resolve(snapshot);
          return;
        }
        if (!snapshot.legalActions || !snapshot.handId) return;
        const key = `${snapshot.handId}:${snapshot.version}:${snapshot.selfId}`;
        if (actionVersions.has(key)) return;
        actionVersions.add(key);
        client.emit(
          'game:action',
          {
            roomId: created.room.id,
            action: {
              type: 'fold',
              actionId: `test-${crypto.randomUUID()}`,
              handId: snapshot.handId,
              version: snapshot.version,
            },
          },
          () => undefined,
        );
      };
      first.on('room:snapshot', onSnapshot(first));
      second.on('room:snapshot', onSnapshot(second));
    });

    expect((await emitAck(first, 'room:start', { roomId: created.room.id } as never)).ok).toBe(true);
    const result = await completed;
    expect(result.players).toHaveLength(3);
    expect(result.resultMessage).toMatch(/赢得/);
    expect(result.showdown?.winners).toHaveLength(1);
    expect(result.showdown?.winners[0]).toMatchObject({ revealed: false, handName: null, holeCards: [] });
    expect((result.showdown?.displayUntil ?? 0) - (result.showdown?.completedAt ?? 0)).toBe(8_000);

    const history = await request<{ hands: unknown[] }>(baseUrl, cookieOne, '/api/history');
    expect(history.hands).toHaveLength(1);
  }, 15_000);

  it('锦标赛观众可订阅和选座，但不能发送聊天', async () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-spectator-'));
    server = await buildServer({ databasePath: join(directory, 'spectator.db'), avatarDirectory: join(directory, 'avatars'), logger: false });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const hostCookie = await guest(baseUrl, '锦标赛房主');
    const watcherCookie = await guest(baseUrl, '锦标赛观众');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', {
      name: '观战规则桌', mode: 'tournament', visibility: 'public', ranked: false,
      maxSeats: 6, targetPlayers: 2, smallBlind: 10, bigBlind: 20, startingStackBb: 100,
      autoFillAi: false, aiDifficulty: 'normal',
    });
    await request(baseUrl, watcherCookie, `/api/rooms/${created.room.id}/join`, {});
    const watcher = await connect(baseUrl, watcherCookie);
    expect((await emitAck(watcher, 'room:subscribe', { roomId: created.room.id } as never)).ok).toBe(true);
    const chat = await new Promise<Ack>((resolve) => watcher.emit('chat:send', { roomId: created.room.id, text: '观众发言' }, resolve));
    expect(chat).toMatchObject({ ok: false });
    expect(chat.error).toMatch(/只能查看/);
    expect((await emitAck(watcher, 'room:take-seat', { roomId: created.room.id, seat: 1 } as never)).ok).toBe(true);
  });

  it('锦标赛开赛后离座会弃赛并转为观众', async () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-forfeit-'));
    server = await buildServer({ databasePath: join(directory, 'forfeit.db'), avatarDirectory: join(directory, 'avatars'), logger: false });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const hostCookie = await guest(baseUrl, '弃赛测试房主');
    const playerCookie = await guest(baseUrl, '弃赛测试玩家');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', {
      name: '锦标赛弃赛桌', mode: 'tournament', visibility: 'public', ranked: false,
      maxSeats: 2, targetPlayers: 2, smallBlind: 10, bigBlind: 20, startingStackBb: 100,
      autoFillAi: false, aiDifficulty: 'normal',
    });
    await request(baseUrl, playerCookie, `/api/rooms/${created.room.id}/join`, {});
    const host = await connect(baseUrl, hostCookie);
    const player = await connect(baseUrl, playerCookie);
    await emitAck(host, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:take-seat', { roomId: created.room.id, seat: 1 } as never);

    const finished = new Promise<GameSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('弃赛后未结束锦标赛')), 4_000);
      player.on('room:snapshot', (snapshot) => {
        if (snapshot.selfRole === 'spectator' && snapshot.room.status === 'finished') {
          clearTimeout(timer);
          resolve(snapshot);
        }
      });
    });
    host.on('room:snapshot', (snapshot) => {
      if (!snapshot.legalActions || !snapshot.handId) return;
      host.emit('game:action', {
        roomId: created.room.id,
        action: {
          type: snapshot.legalActions.callAmount > 0 ? 'call' : 'check',
          actionId: `forfeit-${crypto.randomUUID()}`,
          handId: snapshot.handId,
          version: snapshot.version,
        },
      }, () => undefined);
    });
    await emitAck(host, 'room:start', { roomId: created.room.id } as never);
    const stand = await new Promise<Ack>((resolve) => player.emit('room:stand-up', { roomId: created.room.id }, resolve));
    expect(stand.ok).toBe(true);
    const finalSnapshot = await finished;
    expect(finalSnapshot.resultMessage).toMatch(/冠军/);
    expect(finalSnapshot.players.some((seat) => seat.id === finalSnapshot.selfId)).toBe(false);
  });

  it('排位常规桌按玩家选择买入并在离座后兑回', async () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-ranked-wallet-'));
    server = await buildServer({ databasePath: join(directory, 'ranked-wallet.db'), logger: false });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const hostCookie = await register(baseUrl, 'ranked-host@example.com', '排位房主');
    const playerCookie = await register(baseUrl, 'ranked-player@example.com', '排位玩家');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', {
      name: '排位筹码桌', mode: 'cash', visibility: 'public', ranked: true,
      maxSeats: 2, targetPlayers: 2, smallBlind: 10, bigBlind: 20, startingStackBb: 100,
      minBuyInBb: 40, maxBuyInBb: 200, buyInBb: 100,
      autoFillAi: false, aiDifficulty: 'normal',
    });
    const hostWallet = await request<{ wallet: { availableChips: number; tableChips: number; totalChips: number } }>(baseUrl, hostCookie, '/api/auth/me');
    expect(hostWallet.wallet).toEqual({ availableChips: 8_000, tableChips: 2_000, totalChips: 10_000, dailyBonusAmount: 2_000, dailyBonusAvailable: false });

    const guestCookie = await guest(baseUrl, '排位游客');
    const guestJoin = await fetch(`${baseUrl}/api/rooms/${created.room.id}/join`, { method: 'POST', headers: { cookie: guestCookie } });
    expect(guestJoin.status).toBe(400);
    expect(await guestJoin.json()).toMatchObject({ error: expect.stringMatching(/注册用户/) });

    await request(baseUrl, playerCookie, `/api/rooms/${created.room.id}/join`, {});
    const host = await connect(baseUrl, hostCookie);
    const player = await connect(baseUrl, playerCookie);
    await emitAck(host, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:subscribe', { roomId: created.room.id } as never);
    const invalid = await new Promise<Ack>((resolve) => player.emit('room:take-seat', { roomId: created.room.id, seat: 1, buyInBb: 30 }, resolve));
    expect(invalid).toMatchObject({ ok: false });
    const seated = await new Promise<Ack>((resolve) => player.emit('room:take-seat', { roomId: created.room.id, seat: 1, buyInBb: 40 }, resolve));
    expect(seated).toEqual({ ok: true });
    expect((await request<{ wallet: { availableChips: number; tableChips: number } }>(baseUrl, playerCookie, '/api/auth/me')).wallet).toMatchObject({ availableChips: 9_200, tableChips: 800 });

    const completed = new Promise<GameSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('排位手牌未完成')), 5_000);
      const act = (client: ClientSocket) => (snapshot: GameSnapshot) => {
        if (snapshot.resultMessage) {
          clearTimeout(timer);
          resolve(snapshot);
          return;
        }
        if (!snapshot.legalActions || !snapshot.handId) return;
        client.emit('game:action', {
          roomId: created.room.id,
          action: { type: 'fold', actionId: `ranked-${crypto.randomUUID()}`, handId: snapshot.handId, version: snapshot.version },
        }, () => undefined);
      };
      host.on('room:snapshot', act(host));
      player.on('room:snapshot', act(player));
    });
    expect((await emitAck(host, 'room:start', { roomId: created.room.id } as never)).ok).toBe(true);
    const result = await completed;
    expect(result.resultMessage).toMatch(/赢得/);
    const stand = await new Promise<Ack>((resolve) => player.emit('room:stand-up', { roomId: created.room.id }, resolve));
    expect(stand).toEqual({ ok: true });
    expect((await request<{ wallet: { availableChips: number; tableChips: number; totalChips: number } }>(baseUrl, playerCookie, '/api/auth/me')).wallet).toMatchObject({ availableChips: 10_010, tableChips: 0, totalChips: 10_010 });
    const leave = await new Promise<Ack>((resolve) => host.emit('room:leave', { roomId: created.room.id }, resolve));
    expect(leave).toEqual({ ok: true });
    expect((await request<{ wallet: { availableChips: number; tableChips: number } }>(baseUrl, hostCookie, '/api/auth/me')).wallet).toMatchObject({ availableChips: 9_990, tableChips: 0 });
  });
});
