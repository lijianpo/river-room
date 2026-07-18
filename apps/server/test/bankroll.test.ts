import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { BankrollService } from '../src/bankroll.js';
import { createDatabase } from '../src/db/index.js';
import { chipTransactions, users } from '../src/db/schema.js';

let directory = '';

afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = '';
});

function setup() {
  directory = mkdtempSync(join(tmpdir(), 'poker-sol-bankroll-'));
  const database = createDatabase(join(directory, 'wallet.db'));
  const userId = randomUUID();
  const now = Date.now();
  database.db.insert(users).values({
    id: userId,
    email: `${userId}@test.local`,
    passwordHash: 'hash',
    displayName: '筹码玩家',
    createdAt: now,
    updatedAt: now,
  }).run();
  const bankroll = new BankrollService(database.db);
  bankroll.initializeUser(userId, now);
  return { ...database, bankroll, userId };
}

describe('用户筹码账务', () => {
  it('注册当天只有初始筹码，之后每日奖励只能领取一次', () => {
    const { db, sqlite, bankroll, userId } = setup();
    expect(bankroll.wallet(userId)).toMatchObject({ availableChips: 10_000, tableChips: 0, totalChips: 10_000, dailyBonusAvailable: false });
    expect(() => bankroll.claimDailyBonus(userId)).toThrow(/已经领取/);
    db.update(users).set({ lastDailyBonusDate: null }).where(eq(users.id, userId)).run();
    expect(bankroll.claimDailyBonus(userId)).toMatchObject({ availableChips: 12_000, dailyBonusAvailable: false });
    expect(() => bankroll.claimDailyBonus(userId)).toThrow(/已经领取/);
    expect(db.select().from(chipTransactions).where(eq(chipTransactions.userId, userId)).all().map((row) => row.type)).toEqual(['initial', 'daily_bonus']);
    sqlite.close();
  });

  it('买入、牌局检查点、异常恢复和管理员调整都保持余额守恒', () => {
    const { sqlite, bankroll, userId } = setup();
    const stake = bankroll.openStake({ userId, identityId: `u:${userId}`, roomId: 'ranked-room', buyInChips: 2_000 });
    expect(bankroll.wallet(userId)).toMatchObject({ availableChips: 8_000, tableChips: 2_000, totalChips: 10_000 });
    bankroll.checkpointStake(stake.id, 2_500);
    expect(bankroll.wallet(userId)).toMatchObject({ availableChips: 8_000, tableChips: 2_500, totalChips: 10_500 });
    expect(bankroll.recoverActiveStakes()).toBe(1);
    expect(bankroll.recoverActiveStakes()).toBe(0);
    expect(bankroll.wallet(userId)).toMatchObject({ availableChips: 10_500, tableChips: 0, totalChips: 10_500 });
    bankroll.adjust(userId, 1_000, userId, '测试增加');
    expect(bankroll.wallet(userId).availableChips).toBe(11_500);
    bankroll.adjust(userId, -500, userId, '测试扣减');
    expect(bankroll.wallet(userId).availableChips).toBe(11_000);
    expect(() => bankroll.adjust(userId, -20_000, userId, '超额扣减')).toThrow(/不能为负数/);
    sqlite.close();
  });
});
