import type { ShowdownResultView } from '@poker/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShowdownOverlay } from './ShowdownOverlay';

const base: ShowdownResultView = {
  handId: 'hand-1',
  resultText: '阿河 赢得底池',
  completedAt: Date.now(),
  displayUntil: Date.now() + 8_000,
  winners: [],
};

describe('赢家结算层', () => {
  it('展示赢家、筹码、牌型和公开底牌', () => {
    const html = renderToStaticMarkup(<ShowdownOverlay result={{ ...base, winners: [{
      playerId: 'p1', name: '阿河', amount: 680, reason: '摊牌', handName: '同花', revealed: true,
      holeCards: [{ rank: 'A', suit: 'h' }, { rank: 'K', suit: 'h' }],
    }] }} />);
    expect(html).toContain('阿河');
    expect(html).toContain('+680');
    expect(html).toContain('同花');
    expect(html).toContain('A');
  });

  it('弃牌获胜时明确隐藏底牌', () => {
    const html = renderToStaticMarkup(<ShowdownOverlay result={{ ...base, winners: [{
      playerId: 'p1', name: '阿河', amount: 120, reason: '其余玩家弃牌', handName: null, revealed: false, holeCards: [],
    }] }} />);
    expect(html).toContain('底牌未公开');
    expect(html).not.toContain('playing-card');
  });
});
