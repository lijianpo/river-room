import { describe, expect, it } from 'vitest';
import { computePlayerStats, NET_CURVE_HANDS, type StatsAction, type StatsHandRow } from '../src/stats.js';

const me = 'u:me';
const a = (playerId: string, street: string, action: string, amount = 0): StatsAction => ({ playerId, street, action, amount });

let time = 0;
function row(actions: StatsAction[], overrides: Partial<StatsHandRow> = {}): StatsHandRow {
  time += 1;
  return { handId: `h${time}`, mode: 'cash', bigBlind: 20, completedAt: time, pot: 0, boardCount: 0, netChips: 0, shown: false, actions, ...overrides };
}

const blinds = (sb: string, bb: string) => [a(sb, 'preflop', 'small_blind', 10), a(bb, 'preflop', 'big_blind', 20), a('dealer', 'preflop', 'deal')];

describe('玩家技术统计', () => {
  it('VPIP 不计盲注，PFR 只计翻前加注', () => {
    const stats = computePlayerStats(me, [
      // 大盲位过牌：不算入池
      row([...blinds('op', me), a('op', 'preflop', 'call', 10), a(me, 'preflop', 'check')], { boardCount: 3 }),
      // 跟注：入池但不算加注
      row([...blinds(me, 'op'), a(me, 'preflop', 'call', 10), a('op', 'preflop', 'check')], { boardCount: 3 }),
      // 加注：入池且加注
      row([...blinds(me, 'op'), a(me, 'preflop', 'raise', 50), a('op', 'preflop', 'fold'), a(me, 'complete', 'win', 80)], { netChips: 20, pot: 80 }),
      // 弃牌
      row([...blinds('op', 'x'), a(me, 'preflop', 'fold')]),
    ]);
    expect(stats.hands).toBe(4);
    expect(stats.vpip).toBe(0.5);
    expect(stats.pfr).toBe(0.25);
    expect(stats.biggestPotWon).toBe(80);
    expect(stats.winRate).toBe(0.25);
  });

  it('全押超过当前下注算加注，否则算跟注', () => {
    const raiseAllIn = computePlayerStats(me, [row([...blinds('op', me), a('op', 'preflop', 'call', 10), a(me, 'preflop', 'all_in', 480)])]);
    expect(raiseAllIn).toMatchObject({ vpip: 1, pfr: 1 });
    // 对手先加注到 500，我只剩 300 全押：只是跟注
    const callAllIn = computePlayerStats(me, [row([...blinds(me, 'op'), a('op', 'preflop', 'raise', 480), a(me, 'preflop', 'all_in', 290)])]);
    expect(callAllIn).toMatchObject({ vpip: 1, pfr: 0 });
    // 翻后同理：全押跟注计入被动行动
    const postflop = computePlayerStats(me, [row([
      ...blinds(me, 'op'), a(me, 'preflop', 'call', 10), a('op', 'preflop', 'check'),
      a('op', 'flop', 'bet', 100), a(me, 'flop', 'all_in', 60),
      a('op', 'turn', 'check'), a(me, 'turn', 'bet', 40), a('op', 'turn', 'call', 40),
    ], { boardCount: 5 })]);
    expect(postflop.aggressionFactor).toBe(1);
  });

  it('WTSD 以看到翻牌为分母，W$SD 以摊牌为分母', () => {
    const stats = computePlayerStats(me, [
      row([...blinds(me, 'op'), a(me, 'preflop', 'call', 10)], { boardCount: 5, shown: true, netChips: 100 }),
      row([...blinds(me, 'op'), a(me, 'preflop', 'call', 10)], { boardCount: 5, shown: true, netChips: -40 }),
      row([...blinds(me, 'op'), a(me, 'preflop', 'call', 10), a(me, 'flop', 'fold')], { boardCount: 3, netChips: -20 }),
      row([...blinds(me, 'op'), a(me, 'preflop', 'fold')], { boardCount: 5, netChips: -10 }),
    ]);
    expect(stats.wtsd).toBeCloseTo(2 / 3);
    expect(stats.wsd).toBe(0.5);
    expect(stats.netChips).toBe(30);
    expect(stats.netBb).toBe(1.5);
    expect(stats.bbPer100).toBe(37.5);
  });

  it('没有样本时比率为 null，净赢曲线只保留最近若干手', () => {
    expect(computePlayerStats(me, [])).toMatchObject({ hands: 0, vpip: null, wtsd: null, aggressionFactor: null, bbPer100: null, netCurve: [] });
    const many = Array.from({ length: NET_CURVE_HANDS + 20 }, () => row([...blinds(me, 'op')], { netChips: 20, mode: 'tournament' }));
    const stats = computePlayerStats(me, many);
    expect(stats.netCurve).toHaveLength(NET_CURVE_HANDS + 1);
    expect(stats.netCurve.at(-1)).toBe(NET_CURVE_HANDS);
    expect(stats.bbPer100).toBeNull();
  });
});
