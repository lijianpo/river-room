import type { HandHistoryDetail } from '@poker/contracts';
import { describe, expect, it } from 'vitest';
import { buildReplaySteps } from './replay';

type Action = HandHistoryDetail['actions'][number];

let sequence = 0;
const act = (playerId: string, street: string, action: string, amount = 0): Action => ({
  sequence: ++sequence,
  playerId,
  playerName: playerId === 'dealer' ? '荷官' : playerId.toUpperCase(),
  street,
  action,
  amount,
  createdAt: sequence,
});

function hand(actions: Action[], players: Array<{ id: string; seat: number; startingStack: number; netChips: number }>, boardCount = 5): HandHistoryDetail {
  const board = [
    { rank: 'A', suit: 's' }, { rank: 'K', suit: 'd' }, { rank: '7', suit: 'c' }, { rank: '2', suit: 'h' }, { rank: '9', suit: 's' },
  ].slice(0, boardCount);
  return {
    id: 'h1', roomName: '回放桌', mode: 'cash', ranked: false, handNumber: 3, pot: 0, netChips: 0, bigBlind: 20, smallBlind: 10,
    completedAt: 0, resultText: '', maxSeats: 6, board,
    players: players.map((player) => ({ ...player, name: player.id.toUpperCase(), holeCards: [], shown: false })),
    actions,
  };
}

function totals(steps: ReturnType<typeof buildReplaySteps>): number[] {
  return steps.map((step) => step.pot + step.players.reduce((sum, player) => sum + player.stack, 0));
}

describe('牌谱回放', () => {
  it('摊牌手牌：每一步筹码守恒，换街清空本街下注，公共牌逐街出现', () => {
    sequence = 0;
    const detail = hand([
      act('a', 'preflop', 'small_blind', 10),
      act('b', 'preflop', 'big_blind', 20),
      act('dealer', 'preflop', 'deal'),
      act('a', 'preflop', 'call', 10),
      act('b', 'preflop', 'check'),
      act('b', 'flop', 'bet', 40),
      act('a', 'flop', 'call', 40),
      act('b', 'turn', 'check'),
      act('a', 'turn', 'check'),
      act('b', 'river', 'check'),
      act('a', 'river', 'check'),
      act('a', 'showdown', 'win', 120),
    ], [
      { id: 'a', seat: 0, startingStack: 1_000, netChips: 60 },
      { id: 'b', seat: 3, startingStack: 1_000, netChips: -60 },
    ]);
    const steps = buildReplaySteps(detail);
    expect(steps).toHaveLength(12);
    expect(new Set(totals(steps))).toEqual(new Set([2_000]));
    expect(steps[0]).toMatchObject({ sequence: null, pot: 0, board: [] });
    const flopBet = steps.find((step) => step.street === 'flop' && step.description.includes('下注'))!;
    expect(flopBet.board).toHaveLength(3);
    expect(flopBet.players.find((player) => player.id === 'a')!.committed).toBe(0);
    expect(flopBet.players.find((player) => player.id === 'b')!.committed).toBe(40);
    expect(steps.find((step) => step.street === 'turn')!.board).toHaveLength(4);
    const last = steps.at(-1)!;
    expect(last.pot).toBe(0);
    expect(last.board).toHaveLength(5);
    for (const player of detail.players) {
      expect(last.players.find((item) => item.id === player.id)!.stack).toBe(player.startingStack + player.netChips);
    }
  });

  it('翻牌前全押直接跑牌，摊牌时显示全部公共牌，并退回未被跟注的筹码', () => {
    sequence = 0;
    const detail = hand([
      act('a', 'preflop', 'small_blind', 10),
      act('b', 'preflop', 'big_blind', 20),
      act('dealer', 'preflop', 'deal'),
      act('a', 'preflop', 'all_in', 1_490),
      act('b', 'preflop', 'call', 280),
      act('a', 'showdown', 'win', 1_200),
      act('b', 'showdown', 'win', 600),
    ], [
      { id: 'a', seat: 0, startingStack: 1_500, netChips: -300 },
      { id: 'b', seat: 1, startingStack: 300, netChips: 300 },
    ]);
    const steps = buildReplaySteps(detail);
    expect(new Set(totals(steps))).toEqual(new Set([1_800]));
    const allIn = steps.find((step) => step.description.includes('全押'))!;
    expect(allIn.players.find((player) => player.id === 'a')).toMatchObject({ stack: 0, allIn: true });
    expect(allIn.board).toHaveLength(0);
    const last = steps.at(-1)!;
    expect(last.board).toHaveLength(5);
    expect(last.players.map((player) => player.stack)).toEqual([1_200, 600]);
  });

  it('其余玩家弃牌时只显示已发出的公共牌', () => {
    sequence = 0;
    const detail = hand([
      act('a', 'preflop', 'small_blind', 10),
      act('b', 'preflop', 'big_blind', 20),
      act('dealer', 'preflop', 'deal'),
      act('a', 'preflop', 'fold'),
      act('b', 'complete', 'win', 30),
    ], [
      { id: 'a', seat: 0, startingStack: 500, netChips: -10 },
      { id: 'b', seat: 1, startingStack: 500, netChips: 10 },
    ], 0);
    const steps = buildReplaySteps(detail);
    expect(steps.at(-1)).toMatchObject({ pot: 0, board: [] });
    expect(steps.at(-1)!.players.find((player) => player.id === 'a')!.folded).toBe(true);
  });
});
