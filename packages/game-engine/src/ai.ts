import type { AiDifficulty, PlayerActionType } from '@poker/contracts';
import { createDeck, type Card, type RandomSource } from './cards.js';
import { compareEvaluations, evaluateBest } from './evaluator.js';
import type { HoldemEngine } from './engine.js';

export interface AiDecision {
  type: PlayerActionType;
  amount?: number;
}

function removeKnown(deck: Card[], known: Card[]): Card[] {
  const codes = new Set(known.map((card) => `${card.rank}${card.suit}`));
  return deck.filter((card) => !codes.has(`${card.rank}${card.suit}`));
}

function drawRandom(deck: Card[], count: number, random: RandomSource): Card[] {
  const pool = [...deck];
  const result: Card[] = [];
  for (let index = 0; index < count; index += 1) {
    const selected = Math.floor(random() * pool.length);
    const [card] = pool.splice(selected, 1);
    if (card) result.push(card);
  }
  return result;
}

export function estimateEquity(
  holeCards: Card[],
  board: Card[],
  opponents: number,
  iterations: number,
  random: RandomSource,
): number {
  if (opponents <= 0) return 1;
  const baseDeck = removeKnown(createDeck(), [...holeCards, ...board]);
  let equity = 0;
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const neededBoard = 5 - board.length;
    const drawn = drawRandom(baseDeck, neededBoard + opponents * 2, random);
    const simulatedBoard = [...board, ...drawn.slice(0, neededBoard)];
    const hero = evaluateBest([...holeCards, ...simulatedBoard]);
    let bestComparison = 1;
    let ties = 1;
    for (let opponent = 0; opponent < opponents; opponent += 1) {
      const start = neededBoard + opponent * 2;
      const opponentCards = drawn.slice(start, start + 2);
      const evaluation = evaluateBest([...opponentCards, ...simulatedBoard]);
      const comparison = compareEvaluations(hero, evaluation);
      if (comparison < 0) {
        bestComparison = -1;
        break;
      }
      if (comparison === 0) ties += 1;
    }
    if (bestComparison > 0) equity += 1 / ties;
  }
  return equity / iterations;
}

const SETTINGS: Record<AiDifficulty, { iterations: number; looseness: number; aggression: number; error: number }> = {
  easy: { iterations: 36, looseness: 0.1, aggression: 0.18, error: 0.2 },
  normal: { iterations: 100, looseness: 0.03, aggression: 0.28, error: 0.08 },
  hard: { iterations: 260, looseness: -0.02, aggression: 0.38, error: 0.025 },
};

export function decideAiAction(
  engine: HoldemEngine,
  playerId: string,
  difficulty: AiDifficulty,
  random: RandomSource = Math.random,
): AiDecision {
  const player = engine.getPlayer(playerId);
  const legal = engine.getLegalActions(playerId);
  if (!player || !legal) throw new Error('AI 当前没有行动权');
  const settings = SETTINGS[difficulty];
  const opponents = engine.players.filter((candidate) => candidate.id !== player.id && !candidate.folded).length;
  let equity = estimateEquity(player.holeCards, engine.board, opponents, settings.iterations, random);
  equity += settings.looseness + (random() - 0.5) * settings.error * 2;
  const price = legal.callAmount;
  const potOdds = price > 0 ? price / (engine.pot + price) : 0;
  const pressure = player.stack <= engine.bigBlind * 8;

  if (price > 0 && equity < potOdds + 0.04 && random() > settings.error) return { type: 'fold' };

  const shouldRaise = equity > Math.max(0.58, potOdds + 0.24) || random() < settings.aggression * Math.max(0, equity - 0.25);
  if (pressure && equity > 0.5 && legal.canAllIn) return { type: 'all_in' };

  if (shouldRaise) {
    if (engine.currentBet === 0 && legal.minBet !== null) {
      const target = Math.min(
        legal.maxAmount,
        Math.max(legal.minBet, Math.round(engine.pot * (0.45 + random() * 0.45))),
      );
      if (target === legal.maxAmount && target < legal.minBet) return { type: 'all_in' };
      return { type: 'bet', amount: target };
    }
    if (legal.minRaiseTo !== null) {
      const target = Math.min(
        legal.maxAmount,
        Math.max(legal.minRaiseTo, engine.currentBet + Math.round(engine.pot * (0.35 + random() * 0.45))),
      );
      return { type: 'raise', amount: target };
    }
  }

  if (legal.canCheck) return { type: 'check' };
  if (price > 0) return { type: 'call' };
  if (legal.canAllIn) return { type: 'all_in' };
  return { type: 'fold' };
}
