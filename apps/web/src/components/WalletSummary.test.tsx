import type { WalletView } from '@poker/contracts';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WalletSummary } from './WalletSummary';

describe('筹码账户摘要', () => {
  it('分别展示可用、本桌和合计筹码', () => {
    const wallet: WalletView = { availableChips: 8_000, tableChips: 2_400, totalChips: 10_400, dailyBonusAmount: 2_000, dailyBonusAvailable: true };
    const html = renderToStaticMarkup(<WalletSummary wallet={wallet} />);
    expect(html).toContain('可用筹码');
    expect(html).toContain('8,000');
    expect(html).toContain('本桌筹码');
    expect(html).toContain('2,400');
    expect(html).toContain('10,400');
  });
});
