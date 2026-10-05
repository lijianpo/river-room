import type { ChipTransactionType } from '@poker/contracts';

const LABELS: Record<ChipTransactionType, string> = {
  initial: '初始筹码',
  daily_bonus: '每日奖励',
  buy_in: '牌桌买入',
  cash_out: '离桌兑回',
  recovery: '异常恢复退回',
  admin_adjustment: '管理员调整',
};

export function transactionLabel(type: ChipTransactionType | string): string {
  return LABELS[type as ChipTransactionType] ?? type;
}

/** 带符号的筹码数：入账 +1,000，出账 -2,000，零值不加符号。 */
export function signedChips(amount: number): string {
  return `${amount > 0 ? '+' : ''}${amount.toLocaleString('zh-CN')}`;
}
