import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlayingCard } from './PlayingCard';

describe('PlayingCard', () => {
  it('渲染可访问的红桃 A', () => {
    const html = renderToStaticMarkup(<PlayingCard card={{ rank: 'A', suit: 'h' }} />);
    expect(html).toContain('红桃A');
    expect(html).toContain('♥');
    expect(html).toContain('red');
    expect(html).toContain('card-rank');
    expect(html).toContain('card-suit');
  });

  it('隐藏未公开的底牌', () => {
    const html = renderToStaticMarkup(<PlayingCard card={{ rank: '', suit: '', hidden: true }} />);
    expect(html).toContain('暗牌');
    expect(html).toContain('card-back');
  });
});
