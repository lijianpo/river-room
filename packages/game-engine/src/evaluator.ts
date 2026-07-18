import type { Card } from './cards.js';
import { RANKS } from './cards.js';

const CATEGORY_NAMES = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
] as const;

export interface HandEvaluation {
  category: number;
  name: string;
  tiebreakers: number[];
  score: number[];
  cards: Card[];
}

function rankValue(card: Card): number {
  return RANKS.indexOf(card.rank) + 2;
}

function straightHigh(values: number[]): number | null {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let index = 0; index <= unique.length - 5; index += 1) {
    const slice = unique.slice(index, index + 5);
    const first = slice[0];
    const last = slice[4];
    if (first !== undefined && last !== undefined && first - last === 4) return first;
  }
  return null;
}

export function evaluateFive(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) throw new Error('牌型判断需要恰好 5 张牌');
  const values = cards.map(rankValue).sort((a, b) => b - a);
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const flush = cards.every((card) => card.suit === cards[0]?.suit);
  const highStraight = straightHigh(values);

  let category = 0;
  let tiebreakers = values;

  if (flush && highStraight !== null) {
    category = 8;
    tiebreakers = [highStraight];
  } else if (groups[0]?.[1] === 4) {
    category = 7;
    tiebreakers = [groups[0][0], groups[1]?.[0] ?? 0];
  } else if (groups[0]?.[1] === 3 && groups[1]?.[1] === 2) {
    category = 6;
    tiebreakers = [groups[0][0], groups[1][0]];
  } else if (flush) {
    category = 5;
  } else if (highStraight !== null) {
    category = 4;
    tiebreakers = [highStraight];
  } else if (groups[0]?.[1] === 3) {
    category = 3;
    tiebreakers = [groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  } else if (groups[0]?.[1] === 2 && groups[1]?.[1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    tiebreakers = [...pairs, groups[2]?.[0] ?? 0];
    category = 2;
  } else if (groups[0]?.[1] === 2) {
    category = 1;
    tiebreakers = [groups[0][0], ...groups.slice(1).map(([value]) => value).sort((a, b) => b - a)];
  }

  return {
    category,
    name: CATEGORY_NAMES[category] ?? '未知牌型',
    tiebreakers,
    score: [category, ...tiebreakers],
    cards: cards.map((card) => ({ ...card })),
  };
}

export function compareEvaluations(left: HandEvaluation, right: HandEvaluation): number {
  const length = Math.max(left.score.length, right.score.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left.score[index] ?? 0) - (right.score[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function combinations<T>(items: T[], choose: number): T[][] {
  const result: T[][] = [];
  const walk = (start: number, selected: T[]) => {
    if (selected.length === choose) {
      result.push([...selected]);
      return;
    }
    for (let index = start; index <= items.length - (choose - selected.length); index += 1) {
      const item = items[index];
      if (item === undefined) continue;
      selected.push(item);
      walk(index + 1, selected);
      selected.pop();
    }
  };
  walk(0, []);
  return result;
}

export function evaluateBest(cards: Card[]): HandEvaluation {
  if (cards.length < 5 || cards.length > 7) throw new Error('最佳牌型判断需要 5 到 7 张牌');
  const candidates = combinations(cards, 5).map(evaluateFive);
  const first = candidates[0];
  if (!first) throw new Error('无法生成候选牌型');
  return candidates.slice(1).reduce(
    (best, candidate) => (compareEvaluations(candidate, best) > 0 ? candidate : best),
    first,
  );
}
