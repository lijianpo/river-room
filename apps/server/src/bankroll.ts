import { randomUUID } from 'node:crypto';
import type { ChipTransactionPage, ChipTransactionType, WalletView } from '@poker/contracts';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { config } from './config.js';
import type { PokerDatabase } from './db/index.js';
import { chipTransactions, tableStakes, users } from './db/schema.js';

export const INITIAL_CHIPS = 10_000;
export const DAILY_BONUS_CHIPS = 2_000;

export interface ActiveStake {
  id: string;
  userId: string;
  identityId: string;
  roomId: string;
  buyInChips: number;
  currentChips: number;
}

function calendarDate(at = Date.now()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: config.appTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export class BankrollService {
  constructor(private readonly db: PokerDatabase) {}

  initializeUser(userId: string, at = Date.now()): void {
    this.db.transaction((transaction) => {
      const user = transaction.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw new Error('账号不存在');
      transaction.update(users).set({ lastDailyBonusDate: calendarDate(at) }).where(eq(users.id, userId)).run();
      transaction.insert(chipTransactions).values({
        id: `initial:${userId}`,
        userId,
        type: 'initial',
        amount: INITIAL_CHIPS,
        balanceAfter: user.chipBalance,
        roomId: null,
        stakeId: null,
        actorUserId: null,
        note: '初始筹码',
        idempotencyKey: `initial:${userId}`,
        createdAt: at,
      }).onConflictDoNothing({ target: chipTransactions.idempotencyKey }).run();
    });
  }

  wallet(userId: string, liveTableChips?: number): WalletView {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new Error('账号不存在');
    const active = this.activeStakeForUser(userId);
    const tableChips = Math.max(0, Math.floor(liveTableChips ?? active?.currentChips ?? 0));
    return {
      availableChips: user.chipBalance,
      tableChips,
      totalChips: user.chipBalance + tableChips,
      dailyBonusAmount: DAILY_BONUS_CHIPS,
      dailyBonusAvailable: user.lastDailyBonusDate !== calendarDate(),
    };
  }

  claimDailyBonus(userId: string, at = Date.now()): WalletView {
    const date = calendarDate(at);
    this.db.transaction((transaction) => {
      const user = transaction.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw new Error('账号不存在');
      if (user.lastDailyBonusDate === date) throw new Error('今日奖励已经领取');
      const balanceAfter = user.chipBalance + DAILY_BONUS_CHIPS;
      transaction.update(users).set({ chipBalance: balanceAfter, lastDailyBonusDate: date, updatedAt: at }).where(eq(users.id, userId)).run();
      transaction.insert(chipTransactions).values({
        id: randomUUID(),
        userId,
        type: 'daily_bonus',
        amount: DAILY_BONUS_CHIPS,
        balanceAfter,
        roomId: null,
        stakeId: null,
        actorUserId: null,
        note: `${date} 每日奖励`,
        idempotencyKey: `daily:${userId}:${date}`,
        createdAt: at,
      }).run();
    });
    return this.wallet(userId);
  }

  openStake(input: { userId: string; identityId: string; roomId: string; buyInChips: number }): ActiveStake {
    const buyInChips = Math.floor(input.buyInChips);
    if (buyInChips <= 0) throw new Error('买入筹码必须大于零');
    const id = randomUUID();
    const now = Date.now();
    this.db.transaction((transaction) => {
      const user = transaction.select().from(users).where(eq(users.id, input.userId)).get();
      if (!user) throw new Error('账号不存在');
      const active = transaction.select().from(tableStakes)
        .where(and(eq(tableStakes.userId, input.userId), eq(tableStakes.status, 'active'))).get();
      if (active) throw new Error('你已有一笔牌桌买入尚未结算');
      if (user.chipBalance < buyInChips) throw new Error('可用筹码不足');
      const balanceAfter = user.chipBalance - buyInChips;
      transaction.update(users).set({ chipBalance: balanceAfter, updatedAt: now }).where(eq(users.id, input.userId)).run();
      transaction.insert(tableStakes).values({
        id,
        userId: input.userId,
        identityId: input.identityId,
        roomId: input.roomId,
        buyInChips,
        currentChips: buyInChips,
        status: 'active',
        openedAt: now,
        updatedAt: now,
        settledAt: null,
      }).run();
      transaction.insert(chipTransactions).values({
        id: randomUUID(),
        userId: input.userId,
        type: 'buy_in',
        amount: -buyInChips,
        balanceAfter,
        roomId: input.roomId,
        stakeId: id,
        actorUserId: null,
        note: '排位常规桌买入',
        idempotencyKey: `buy-in:${id}`,
        createdAt: now,
      }).run();
    });
    return { id, ...input, buyInChips, currentChips: buyInChips };
  }

  checkpointStake(stakeId: string, currentChips: number): void {
    this.db.update(tableStakes).set({
      currentChips: Math.max(0, Math.floor(currentChips)),
      updatedAt: Date.now(),
    }).where(and(eq(tableStakes.id, stakeId), eq(tableStakes.status, 'active'))).run();
  }

  settleStake(stakeId: string, currentChips: number, type: 'cash_out' | 'recovery' = 'cash_out'): boolean {
    const chips = Math.max(0, Math.floor(currentChips));
    const now = Date.now();
    return this.db.transaction((transaction) => {
      const stake = transaction.select().from(tableStakes)
        .where(and(eq(tableStakes.id, stakeId), eq(tableStakes.status, 'active'))).get();
      if (!stake) return false;
      const user = transaction.select().from(users).where(eq(users.id, stake.userId)).get();
      if (!user) throw new Error('买入对应的账号不存在');
      const balanceAfter = user.chipBalance + chips;
      transaction.update(users).set({ chipBalance: balanceAfter, updatedAt: now }).where(eq(users.id, stake.userId)).run();
      transaction.update(tableStakes).set({
        currentChips: chips,
        status: type === 'recovery' ? 'recovered' : 'settled',
        updatedAt: now,
        settledAt: now,
      }).where(eq(tableStakes.id, stake.id)).run();
      transaction.insert(chipTransactions).values({
        id: randomUUID(),
        userId: stake.userId,
        type,
        amount: chips,
        balanceAfter,
        roomId: stake.roomId,
        stakeId: stake.id,
        actorUserId: null,
        note: type === 'recovery' ? '服务恢复自动退回' : '离桌兑回',
        idempotencyKey: `${type}:${stake.id}`,
        createdAt: now,
      }).run();
      return true;
    });
  }

  adjust(userId: string, amount: number, actorUserId: string, reason: string): WalletView {
    const delta = Math.trunc(amount);
    if (delta === 0 || Math.abs(delta) > 1_000_000) throw new Error('单次调整必须为 1–1,000,000 筹码');
    const note = reason.trim();
    if (!note) throw new Error('请填写调整原因');
    const now = Date.now();
    this.db.transaction((transaction) => {
      const user = transaction.select().from(users).where(eq(users.id, userId)).get();
      if (!user) throw new Error('用户不存在');
      const balanceAfter = user.chipBalance + delta;
      if (balanceAfter < 0) throw new Error('扣减后可用筹码不能为负数');
      transaction.update(users).set({ chipBalance: balanceAfter, updatedAt: now }).where(eq(users.id, userId)).run();
      transaction.insert(chipTransactions).values({
        id: randomUUID(),
        userId,
        type: 'admin_adjustment',
        amount: delta,
        balanceAfter,
        roomId: null,
        stakeId: null,
        actorUserId,
        note,
        idempotencyKey: `admin:${randomUUID()}`,
        createdAt: now,
      }).run();
    });
    return this.wallet(userId);
  }

  /** 按时间倒序分页读取筹码流水；游标为上一页最后一条的 `createdAt:id`。 */
  listTransactions(userId: string, options: { limit?: number; cursor?: string | undefined } = {}): ChipTransactionPage {
    const limit = Math.min(100, Math.max(1, options.limit ?? 30));
    const [cursorTime, ...cursorIdParts] = (options.cursor ?? '').split(':');
    const cursorId = cursorIdParts.join(':');
    const after = options.cursor && Number.isFinite(Number(cursorTime)) && cursorId
      ? or(
          lt(chipTransactions.createdAt, Number(cursorTime)),
          and(eq(chipTransactions.createdAt, Number(cursorTime)), lt(chipTransactions.id, cursorId)),
        )
      : undefined;
    const rows = this.db.select().from(chipTransactions)
      .where(after ? and(eq(chipTransactions.userId, userId), after) : eq(chipTransactions.userId, userId))
      .orderBy(desc(chipTransactions.createdAt), desc(chipTransactions.id))
      .limit(limit + 1)
      .all();
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      transactions: page.map((row) => ({
        id: row.id,
        type: row.type as ChipTransactionType,
        amount: row.amount,
        balanceAfter: row.balanceAfter,
        note: row.note,
        createdAt: row.createdAt,
      })),
      nextCursor: rows.length > limit && last ? `${last.createdAt}:${last.id}` : null,
    };
  }

  activeStakeForUser(userId: string): ActiveStake | null {
    const stake = this.db.select().from(tableStakes)
      .where(and(eq(tableStakes.userId, userId), eq(tableStakes.status, 'active'))).get();
    return stake ? {
      id: stake.id,
      userId: stake.userId,
      identityId: stake.identityId,
      roomId: stake.roomId,
      buyInChips: stake.buyInChips,
      currentChips: stake.currentChips,
    } : null;
  }

  recoverActiveStakes(): number {
    const stakes = this.db.select().from(tableStakes).where(eq(tableStakes.status, 'active')).all();
    let recovered = 0;
    for (const stake of stakes) {
      if (this.settleStake(stake.id, stake.currentChips, 'recovery')) recovered += 1;
    }
    return recovered;
  }
}
