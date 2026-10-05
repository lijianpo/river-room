import { describe, expect, it } from 'vitest';
import { signedChips, transactionLabel } from './ledger';

describe('筹码流水文案', () => {
  it('交易类型显示中文标签，未知类型原样返回', () => {
    expect(transactionLabel('buy_in')).toBe('牌桌买入');
    expect(transactionLabel('cash_out')).toBe('离桌兑回');
    expect(transactionLabel('mystery')).toBe('mystery');
  });

  it('入账带加号，出账保留负号', () => {
    expect(signedChips(2000)).toBe('+2,000');
    expect(signedChips(-800)).toBe('-800');
    expect(signedChips(0)).toBe('0');
  });
});
