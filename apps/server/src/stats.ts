import type { GameMode, PlayerStatsView } from '@poker/contracts';

export interface StatsAction {
  playerId: string;
  street: string;
  action: string;
  amount: number;
}

export interface StatsHandRow {
  handId: string;
  mode: GameMode;
  bigBlind: number;
  completedAt: number;
  pot: number;
  boardCount: number;
  netChips: number;
  /** 是否进入摊牌并亮牌 */
  shown: boolean;
  /** 该手牌全部玩家的行动，按序号排列 */
  actions: StatsAction[];
}

/** 净赢曲线保留的手数 */
export const NET_CURVE_HANDS = 100;

const BETTING_STREETS = new Set(['preflop', 'flop', 'turn', 'river']);

interface HandFacts {
  vpip: boolean;
  pfr: boolean;
  foldedPreflop: boolean;
  aggressive: number;
  passive: number;
}

/** 逐街重放下注额，判断目标玩家的每次行动是否为主动入池、加注或跟注。 */
function analyseHand(identityId: string, actions: StatsAction[]): HandFacts {
  const facts: HandFacts = { vpip: false, pfr: false, foldedPreflop: false, aggressive: 0, passive: 0 };
  let street = '';
  let currentBet = 0;
  let committed = new Map<string, number>();
  for (const action of actions) {
    if (!BETTING_STREETS.has(action.street)) continue;
    if (action.street !== street) {
      street = action.street;
      currentBet = 0;
      committed = new Map();
    }
    const before = committed.get(action.playerId) ?? 0;
    const after = before + action.amount;
    committed.set(action.playerId, after);
    // 全押超过当前最高下注才算加注，否则视为跟注。
    const raises = action.action === 'bet' || action.action === 'raise' || (action.action === 'all_in' && after > currentBet);
    const calls = action.action === 'call' || (action.action === 'all_in' && !raises && action.amount > 0);
    currentBet = Math.max(currentBet, after);
    if (action.playerId !== identityId) continue;
    if (street === 'preflop') {
      if (raises || calls) facts.vpip = true;
      if (raises) facts.pfr = true;
      if (action.action === 'fold') facts.foldedPreflop = true;
    } else if (raises) facts.aggressive += 1;
    else if (calls) facts.passive += 1;
  }
  return facts;
}

const ratio = (part: number, total: number): number | null => (total > 0 ? part / total : null);
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** 汇总一名玩家的牌谱为技术统计。rows 顺序不限。 */
export function computePlayerStats(identityId: string, rows: StatsHandRow[]): PlayerStatsView {
  const ordered = [...rows].sort((left, right) => left.completedAt - right.completedAt);
  let vpip = 0;
  let pfr = 0;
  let aggressive = 0;
  let passive = 0;
  let sawFlop = 0;
  let showdowns = 0;
  let showdownWins = 0;
  let wins = 0;
  let netChips = 0;
  let netBb = 0;
  let cashHands = 0;
  let cashNetBb = 0;
  let biggestPotWon = 0;
  for (const row of ordered) {
    const facts = analyseHand(identityId, row.actions);
    if (facts.vpip) vpip += 1;
    if (facts.pfr) pfr += 1;
    aggressive += facts.aggressive;
    passive += facts.passive;
    if (!facts.foldedPreflop && row.boardCount >= 3) {
      sawFlop += 1;
      if (row.shown) {
        showdowns += 1;
        if (row.netChips > 0) showdownWins += 1;
      }
    }
    if (row.netChips > 0) {
      wins += 1;
      biggestPotWon = Math.max(biggestPotWon, row.pot);
    }
    const bb = row.bigBlind > 0 ? row.netChips / row.bigBlind : 0;
    netChips += row.netChips;
    netBb += bb;
    if (row.mode === 'cash') {
      cashHands += 1;
      cashNetBb += bb;
    }
  }
  const recent = ordered.slice(-NET_CURVE_HANDS);
  const netCurve = [0];
  for (const row of recent) netCurve.push(round1(netCurve[netCurve.length - 1]! + (row.bigBlind > 0 ? row.netChips / row.bigBlind : 0)));
  return {
    hands: ordered.length,
    vpip: ratio(vpip, ordered.length),
    pfr: ratio(pfr, ordered.length),
    aggressionFactor: passive > 0 ? round1(aggressive / passive) : null,
    wtsd: ratio(showdowns, sawFlop),
    wsd: ratio(showdownWins, showdowns),
    winRate: ratio(wins, ordered.length),
    netChips,
    netBb: round1(netBb),
    bbPer100: cashHands > 0 ? round1((cashNetBb / cashHands) * 100) : null,
    biggestPotWon,
    netCurve: recent.length > 0 ? netCurve : [],
  };
}
