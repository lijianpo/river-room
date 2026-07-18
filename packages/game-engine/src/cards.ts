import { randomInt } from 'node:crypto';

export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUITS = ['c', 'd', 'h', 's'] as const;

export type Rank = (typeof RANKS)[number];
export type Suit = (typeof SUITS)[number];

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type RandomSource = () => number;

export function createDeck(): Card[] {
  return SUITS.flatMap((suit) => RANKS.map((rank) => ({ rank, suit })));
}

export function cardCode(card: Card): string {
  return `${card.rank}${card.suit}`;
}

export function parseCard(code: string): Card {
  const rank = code[0] as Rank;
  const suit = code[1] as Suit;
  if (code.length !== 2 || !RANKS.includes(rank) || !SUITS.includes(suit)) {
    throw new Error(`无效的牌: ${code}`);
  }
  return { rank, suit };
}

export function shuffleDeck(deck: Card[] = createDeck(), random?: RandomSource): Card[] {
  const shuffled = deck.map((card) => ({ ...card }));
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = random
      ? Math.floor(random() * (index + 1))
      : randomInt(index + 1);
    const current = shuffled[index];
    const target = shuffled[swapIndex];
    if (!current || !target) throw new Error('洗牌失败');
    shuffled[index] = target;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

export function seededRandom(seed: number): RandomSource {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
