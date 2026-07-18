import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabase } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { PersistenceService } from '../src/persistence.js';

let directory = '';

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = '';
});

describe('积分与牌谱持久化', () => {
  it('按净赢大盲和锦标赛名次更新分模式积分', () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-persistence-'));
    const { db, sqlite } = createDatabase(join(directory, 'persistence.db'));
    const firstUserId = randomUUID();
    const secondUserId = randomUUID();
    db.insert(users)
      .values([
        { id: firstUserId, email: 'first@test.local', passwordHash: 'test', displayName: '第一名', createdAt: Date.now() },
        { id: secondUserId, email: 'second@test.local', passwordHash: 'test', displayName: '第二名', createdAt: Date.now() },
      ])
      .run();
    const persistence = new PersistenceService(db);
    const roomConfig = {
      name: '排位测试',
      mode: 'cash' as const,
      visibility: 'public' as const,
      ranked: true,
      maxSeats: 2,
      targetPlayers: 2,
      smallBlind: 10,
      bigBlind: 20,
      startingStackBb: 100,
      minBuyInBb: 40,
      maxBuyInBb: 200,
      autoFillAi: false,
      aiDifficulty: 'normal' as const,
    };
    persistence.createGameSession({ id: 'session', roomId: 'room', roomName: '排位测试', mode: 'cash', ranked: true, config: roomConfig, startedAt: Date.now() });
    persistence.persistHand({
      id: randomUUID(),
      gameSessionId: 'session',
      roomId: 'room',
      roomName: '排位测试',
      mode: 'cash',
      ranked: true,
      handNumber: 1,
      board: [],
      pot: 400,
      smallBlind: 10,
      bigBlind: 20,
      resultText: '第一名赢得底池',
      startedAt: Date.now() - 100,
      completedAt: Date.now(),
      actions: [],
      participants: [
        { identityId: `u:${firstUserId}`, userId: firstUserId, name: '第一名', seat: 0, holeCards: [], shown: false, startingStack: 2_000, endingStack: 2_200 },
        { identityId: `u:${secondUserId}`, userId: secondUserId, name: '第二名', seat: 1, holeCards: [], shown: false, startingStack: 2_000, endingStack: 1_800 },
      ],
    });
    persistence.recordTournamentResults([
      { userId: firstUserId, place: 1, players: 2 },
      { userId: secondUserId, place: 2, players: 2 },
    ]);
    const board = persistence.leaderboard();
    expect(board[0]).toMatchObject({ userId: firstUserId, cashPoints: 10, tournamentPoints: 20, totalPoints: 30, wins: 1 });
    expect(board[1]).toMatchObject({ userId: secondUserId, cashPoints: -10, tournamentPoints: 0, totalPoints: -10 });
    sqlite.close();
  });
});
