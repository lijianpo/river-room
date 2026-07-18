import { describe, expect, it } from 'vitest';
import { createDeck, decideAiAction, HoldemEngine, seededRandom, shuffleDeck } from '../src/index.js';

describe('无限注德州状态机', () => {
  it('支持单挑中小盲先行动，弃牌后底池守恒', () => {
    const engine = new HoldemEngine({
      handId: 'heads-up',
      players: [
        { id: 'a', name: 'A', seat: 0, stack: 100 },
        { id: 'b', name: 'B', seat: 1, stack: 100 },
      ],
      dealerSeat: 0,
      smallBlind: 5,
      bigBlind: 10,
      random: seededRandom(1),
    });
    expect(engine.actingSeat).toBe(0);
    expect(engine.getLegalActions('a')?.callAmount).toBe(5);
    engine.applyAction('a', { type: 'fold' });
    expect(engine.isComplete).toBe(true);
    expect(engine.getPlayer('b')?.stack).toBe(105);
    expect(engine.players.reduce((sum, player) => sum + player.stack, 0)).toBe(200);
  });

  it('全押时自动发完公共牌并正确拆分边池和未跟注筹码', () => {
    const engine = new HoldemEngine({
      handId: 'side-pots',
      players: [
        { id: 'a', name: 'A', seat: 0, stack: 100 },
        { id: 'b', name: 'B', seat: 1, stack: 50 },
        { id: 'c', name: 'C', seat: 2, stack: 20 },
      ],
      dealerSeat: 0,
      smallBlind: 5,
      bigBlind: 10,
      deck: shuffleDeck(createDeck(), seededRandom(42)),
    });
    engine.applyAction('a', { type: 'all_in' });
    engine.applyAction('b', { type: 'all_in' });
    engine.applyAction('c', { type: 'all_in' });
    expect(engine.isComplete).toBe(true);
    expect(engine.board).toHaveLength(5);
    expect(engine.result?.payouts.reduce((sum, payout) => sum + payout.amount, 0)).toBe(170);
    expect(engine.players.reduce((sum, player) => sum + player.stack, 0)).toBe(170);
  });

  it('AI 在每个回合只会生成可执行动作并能完成一手牌', () => {
    const random = seededRandom(12);
    const engine = new HoldemEngine({
      handId: 'bots',
      players: [
        { id: 'a', name: 'A', seat: 0, stack: 200 },
        { id: 'b', name: 'B', seat: 1, stack: 200 },
        { id: 'c', name: 'C', seat: 2, stack: 200 },
      ],
      dealerSeat: 0,
      smallBlind: 5,
      bigBlind: 10,
      random,
    });
    let actions = 0;
    while (!engine.isComplete && actions < 100) {
      const player = engine.players.find((candidate) => candidate.seat === engine.actingSeat);
      expect(player).toBeDefined();
      const decision = decideAiAction(engine, player!.id, 'normal', random);
      expect(() => engine.applyAction(player!.id, decision)).not.toThrow();
      actions += 1;
    }
    expect(engine.isComplete).toBe(true);
    expect(actions).toBeLessThan(100);
    expect(engine.players.reduce((sum, player) => sum + player.stack, 0)).toBe(600);
  });
});
