import type { LegalActions } from '@poker/contracts';
import { describe, expect, it } from 'vitest';
import { betPresets, clampBet, resolvePreAction } from './betting';

const legal = (overrides: Partial<LegalActions> = {}): LegalActions => ({
  canFold: true,
  canCheck: false,
  callAmount: 20,
  minBet: null,
  minRaiseTo: 40,
  maxAmount: 2_000,
  canAllIn: true,
  ...overrides,
});

describe('预选操作', () => {
  it('过牌/弃牌：能过牌就过牌，否则弃牌', () => {
    expect(resolvePreAction('check_fold', legal({ canCheck: true, callAmount: 0 }))).toBe('check');
    expect(resolvePreAction('check_fold', legal())).toBe('fold');
  });

  it('自动过牌在有人下注后失效', () => {
    expect(resolvePreAction('check', legal({ canCheck: true, callAmount: 0 }))).toBe('check');
    expect(resolvePreAction('check', legal())).toBeNull();
  });

  it('跟任意注：需要跟注时跟注，否则过牌', () => {
    expect(resolvePreAction('call_any', legal())).toBe('call');
    expect(resolvePreAction('call_any', legal({ canCheck: true, callAmount: 0 }))).toBe('check');
  });
});

describe('下注快捷金额', () => {
  it('翻牌前未加注时提供 2.5BB 与 3BB 开局加注', () => {
    const presets = betPresets({ legal: legal(), pot: 30, currentBet: 20, bigBlind: 20, boardCount: 0 });
    expect(presets.slice(0, 2)).toEqual([{ label: '2.5BB', value: 50 }, { label: '3BB', value: 60 }]);
    expect(presets.at(-1)).toEqual({ label: '全押', value: 2_000 });
  });

  it('翻牌后按底池比例下注，不再提供 BB 倍数', () => {
    const presets = betPresets({ legal: legal({ minBet: 20, minRaiseTo: null, callAmount: 0, canCheck: true }), pot: 200, currentBet: 0, bigBlind: 20, boardCount: 3 });
    expect(presets.map((preset) => preset.label)).toEqual(['50%', '75%', '满池', '全押']);
    expect(presets.map((preset) => preset.value)).toEqual([100, 150, 200, 2_000]);
  });

  it('金额被截断到合法范围并去重', () => {
    const presets = betPresets({ legal: legal({ maxAmount: 100 }), pot: 400, currentBet: 20, bigBlind: 20, boardCount: 3 });
    expect(presets).toEqual([{ label: '50%', value: 100 }]);
  });

  it('无法加注时不提供快捷金额', () => {
    expect(betPresets({ legal: legal({ minRaiseTo: null }), pot: 30, currentBet: 20, bigBlind: 20, boardCount: 0 })).toEqual([]);
  });
});

describe('下注额输入', () => {
  it('限制在最小与最大下注之间', () => {
    expect(clampBet(5, 40, 2_000)).toBe(40);
    expect(clampBet(99_999, 40, 2_000)).toBe(2_000);
    expect(clampBet(Number.NaN, 40, 2_000)).toBe(40);
    expect(clampBet(123.6, 40, 2_000)).toBe(124);
  });
});
