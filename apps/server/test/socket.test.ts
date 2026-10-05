import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Ack, ClientToServerEvents, GameSnapshot, HandHistoryDetail, ServerToClientEvents } from '@poker/contracts';
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

    const history = await request<{ hands: Array<{ id: string }> }>(baseUrl, cookieOne, '/api/history');
    expect(history.hands).toHaveLength(1);
    const detail = await request<{ hand: HandHistoryDetail }>(baseUrl, cookieOne, `/api/history/${history.hands[0]!.id}`);
    expect(detail.hand).toMatchObject({ maxSeats: 6, smallBlind: 10, bigBlind: 20 });
    expect(detail.hand.players.every((player) => player.startingStack === 2_000)).toBe(true);
    const playerIds = new Set(detail.hand.players.map((player) => player.id));
    expect(detail.hand.actions.filter((action) => action.action !== 'deal').every((action) => playerIds.has(action.playerId))).toBe(true);

    const stats = await request<{ stats: { hands: number; vpip: number | null; netCurve: number[] } }>(baseUrl, cookieOne, '/api/stats/me');
    expect(stats.stats.hands).toBe(1);
    expect(stats.stats.netCurve).toHaveLength(2);
    expect((await request<{ stats: { hands: number } }>(baseUrl, cookieOne, '/api/stats/me?mode=tournament')).stats.hands).toBe(0);
    const missing = await fetch(`${baseUrl}/api/stats/users/${crypto.randomUUID()}`, { headers: { cookie: cookieOne } });
    expect(missing.status).toBe(404);
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
    const hostMe = await request<{ user: { userId: string } }>(baseUrl, hostCookie, '/api/auth/me');
    const profile = await request<{ profile: { displayName: string; stats: { hands: number } } }>(baseUrl, playerCookie, `/api/stats/users/${hostMe.user.userId}`);
    expect(profile.profile).toMatchObject({ displayName: '排位房主', stats: { hands: 1 } });
    const stand = await new Promise<Ack>((resolve) => player.emit('room:stand-up', { roomId: created.room.id }, resolve));
    expect(stand).toEqual({ ok: true });
    expect((await request<{ wallet: { availableChips: number; tableChips: number; totalChips: number } }>(baseUrl, playerCookie, '/api/auth/me')).wallet).toMatchObject({ availableChips: 10_010, tableChips: 0, totalChips: 10_010 });
    const leave = await new Promise<Ack>((resolve) => host.emit('room:leave', { roomId: created.room.id }, resolve));
    expect(leave).toEqual({ ok: true });
    expect((await request<{ wallet: { availableChips: number; tableChips: number } }>(baseUrl, hostCookie, '/api/auth/me')).wallet).toMatchObject({ availableChips: 9_990, tableChips: 0 });
  });
});

async function startTestServer(name: string, timing?: { turnTimeoutMs?: number; timeBankMs?: number }): Promise<string> {
  directory = mkdtempSync(join(tmpdir(), `poker-sol-${name}-`));
  server = await buildServer({ databasePath: join(directory, `${name}.db`), avatarDirectory: join(directory, 'avatars'), logger: false, ...(timing ? { timing } : {}) });
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const address = server.app.server.address();
  if (!address || typeof address === 'string') throw new Error('无法获取测试端口');
  return `http://127.0.0.1:${address.port}`;
}

const casualRoom = (overrides: Record<string, unknown> = {}) => ({
  name: '牌桌工具测试', mode: 'cash', visibility: 'public', ranked: false,
  maxSeats: 6, targetPlayers: 2, smallBlind: 10, bigBlind: 20, startingStackBb: 100,
  autoFillAi: false, aiDifficulty: 'normal', ...overrides,
});

function emitRoom(client: ClientSocket, event: 'room:sit-out' | 'room:sit-in', roomId: string): Promise<Ack> {
  return new Promise((resolve) => client.emit(event, { roomId }, resolve));
}

describe('暂离与时间银行', () => {
  it('暂离的玩家下一手不发牌，回到牌局后恢复', async () => {
    const baseUrl = await startTestServer('sit-out');
    const hostCookie = await guest(baseUrl, '暂离房主');
    const playerCookie = await guest(baseUrl, '暂离玩家');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', casualRoom());
    await request(baseUrl, playerCookie, `/api/rooms/${created.room.id}/join`, {});
    const host = await connect(baseUrl, hostCookie);
    const player = await connect(baseUrl, playerCookie);
    await emitAck(host, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:take-seat', { roomId: created.room.id, seat: 1 } as never);
    await emitAck(host, 'room:add-bot', { roomId: created.room.id, difficulty: 'easy' } as never);
    expect(await emitRoom(player, 'room:sit-out', created.room.id)).toEqual({ ok: true });

    const dealt = new Promise<GameSnapshot>((resolve) => {
      player.on('room:snapshot', (snapshot) => {
        if (snapshot.handId) resolve(snapshot);
      });
    });
    expect((await emitAck(host, 'room:start', { roomId: created.room.id } as never)).ok).toBe(true);
    const snapshot = await dealt;
    const self = snapshot.players.find((seat) => seat.id === snapshot.selfId)!;
    expect(self).toMatchObject({ sittingOut: true, holeCards: [] });
    expect(snapshot.players.filter((seat) => seat.holeCards.length === 2)).toHaveLength(2);

    const resumed = new Promise<GameSnapshot>((resolve) => {
      player.on('room:snapshot', (next) => {
        if (!next.players.find((seat) => seat.id === next.selfId)?.sittingOut) resolve(next);
      });
    });
    expect(await emitRoom(player, 'room:sit-in', created.room.id)).toEqual({ ok: true });
    expect((await resumed).players.find((seat) => seat.name === '暂离玩家')?.sittingOut).toBe(false);
  });

  it('锦标赛不能暂离', async () => {
    const baseUrl = await startTestServer('sit-out-tournament');
    const hostCookie = await guest(baseUrl, '锦标赛暂离房主');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', casualRoom({ mode: 'tournament' }));
    const host = await connect(baseUrl, hostCookie);
    await emitAck(host, 'room:subscribe', { roomId: created.room.id } as never);
    const result = await emitRoom(host, 'room:sit-out', created.room.id);
    expect(result).toMatchObject({ ok: false, error: expect.stringMatching(/锦标赛不能暂离/) });
  });

  it('基础时限用完后进入时间银行，连续超时会自动暂离', async () => {
    const baseUrl = await startTestServer('time-bank', { turnTimeoutMs: 200, timeBankMs: 300 });
    const hostCookie = await guest(baseUrl, '时间银行房主');
    const playerCookie = await guest(baseUrl, '时间银行玩家');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', casualRoom({ maxSeats: 2 }));
    await request(baseUrl, playerCookie, `/api/rooms/${created.room.id}/join`, {});
    const host = await connect(baseUrl, hostCookie);
    const player = await connect(baseUrl, playerCookie);
    await emitAck(host, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(player, 'room:take-seat', { roomId: created.room.id, seat: 1 } as never);

    // 大盲位的玩家始终不操作；小盲位只跟注/过牌，让大盲在同一手里连续超时两次。
    let idleId: string | null = null;
    let sawTimeBank = false;
    let baseDeadline = 0;
    const autoSatOut = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('未触发自动暂离')), 6_000);
      const onSnapshot = (client: ClientSocket) => (snapshot: GameSnapshot) => {
        if (!snapshot.handId) return;
        idleId ??= snapshot.players.find((seat) => seat.isBigBlind)?.id ?? null;
        const idle = snapshot.players.find((seat) => seat.id === idleId);
        if (idle?.isActing && !idle.usingTimeBank && !sawTimeBank) baseDeadline = snapshot.actionDeadline ?? 0;
        if (idle?.isActing && idle.usingTimeBank) {
          sawTimeBank = true;
          expect(snapshot.actionDeadline ?? 0).toBeGreaterThan(baseDeadline);
        }
        if (idle?.sittingOut) {
          clearTimeout(timer);
          resolve();
          return;
        }
        if (snapshot.selfId === idleId || !snapshot.legalActions) return;
        client.emit('game:action', {
          roomId: created.room.id,
          action: {
            type: snapshot.legalActions.callAmount > 0 ? 'call' : 'check',
            actionId: `bank-${crypto.randomUUID()}`,
            handId: snapshot.handId,
            version: snapshot.version,
          },
        }, () => undefined);
      };
      host.on('room:snapshot', onSnapshot(host));
      player.on('room:snapshot', onSnapshot(player));
    });
    expect((await emitAck(host, 'room:start', { roomId: created.room.id } as never)).ok).toBe(true);
    await autoSatOut;
    expect(sawTimeBank).toBe(true);
  }, 10_000);
});

describe('牌桌表情', () => {
  it('入座玩家的表情会广播给房间，限频生效，观众不能发送', async () => {
    const baseUrl = await startTestServer('emote');
    const hostCookie = await guest(baseUrl, '表情房主');
    const watcherCookie = await guest(baseUrl, '表情观众');
    const created = await request<{ room: { id: string } }>(baseUrl, hostCookie, '/api/rooms', casualRoom());
    await request(baseUrl, watcherCookie, `/api/rooms/${created.room.id}/join`, {});
    const host = await connect(baseUrl, hostCookie);
    const watcher = await connect(baseUrl, watcherCookie);
    await emitAck(host, 'room:subscribe', { roomId: created.room.id } as never);
    await emitAck(watcher, 'room:subscribe', { roomId: created.room.id } as never);
    const sendEmote = (client: ClientSocket) => new Promise<Ack>((resolve) => client.emit('room:emote', { roomId: created.room.id, emote: 'thumbs_up' }, resolve));

    const received = new Promise<{ playerId: string; emote: string }>((resolve) => watcher.once('room:emote', resolve));
    expect(await sendEmote(host)).toEqual({ ok: true });
    expect(await received).toMatchObject({ emote: 'thumbs_up', playerId: expect.stringMatching(/^g:/) });
    expect(await sendEmote(host)).toMatchObject({ ok: false, error: expect.stringMatching(/太快/) });
    expect(await sendEmote(watcher)).toMatchObject({ ok: false, error: expect.stringMatching(/入座/) });
  });
});
