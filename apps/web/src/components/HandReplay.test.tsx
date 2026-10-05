import type { HandHistoryDetail } from '@poker/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buildReplaySteps } from '../lib/replay';
import { HandReplay } from './HandReplay';

const hand: HandHistoryDetail = {
  id: 'h1', roomName: '回放桌', mode: 'cash', ranked: false, handNumber: 1, pot: 30, netChips: 10, bigBlind: 20, smallBlind: 10,
  completedAt: 0, resultText: '', maxSeats: 2, board: [],
  players: [
    { id: 'me', name: '自己', seat: 0, holeCards: [{ rank: 'A', suit: 's' }, { rank: 'A', suit: 'h' }], shown: true, startingStack: 500, netChips: 10 },
    { id: 'op', name: '对手', seat: 1, holeCards: [{ rank: '', suit: '', hidden: true }, { rank: '', suit: '', hidden: true }], shown: false, startingStack: 500, netChips: -10 },
  ],
  actions: [
    { sequence: 1, playerId: 'op', playerName: '对手', street: 'preflop', action: 'small_blind', amount: 10, createdAt: 0 },
    { sequence: 2, playerId: 'me', playerName: '自己', street: 'preflop', action: 'big_blind', amount: 20, createdAt: 0 },
    { sequence: 3, playerId: 'op', playerName: '对手', street: 'preflop', action: 'fold', amount: 0, createdAt: 0 },
    { sequence: 4, playerId: 'me', playerName: '自己', street: 'complete', action: 'win', amount: 30, createdAt: 0 },
  ],
};

describe('牌谱回放组件', () => {
  it('按当前步骤渲染底池、下注和进度', () => {
    const steps = buildReplaySteps(hand);
    const html = renderToStaticMarkup(<HandReplay steps={steps} maxSeats={2} selfId="me" index={2} playing={false} onIndexChange={() => undefined} onPlayingChange={() => undefined} />);
    expect(html).toContain('底池 <strong>30</strong>');
    expect(html).toContain('自己 大盲 20');
    expect(html).toContain('3/5');
    // 自己的座位旋转到正下方
    expect(html).toMatch(/table-seat self[^"]*" style="left:50%;top:88%/);
  });

  it('最后一步显示赢得的筹码', () => {
    const steps = buildReplaySteps(hand);
    const html = renderToStaticMarkup(<HandReplay steps={steps} maxSeats={2} selfId="me" index={steps.length - 1} playing={false} onIndexChange={() => undefined} onPlayingChange={() => undefined} />);
    expect(html).toContain('replay-won');
    expect(html).toContain('+30');
  });
});
