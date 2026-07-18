import type { WalletView } from '@poker/contracts';
import { Coins } from 'lucide-react';

export function WalletSummary({ wallet, compact = false }: { wallet: WalletView | null; compact?: boolean }) {
  if (!wallet) return null;
  if (compact) {
    return <div className="wallet-chip" title={`可用 ${wallet.availableChips.toLocaleString()} · 本桌 ${wallet.tableChips.toLocaleString()}`}><Coins /><span>总筹码</span><strong>{wallet.totalChips.toLocaleString()}</strong></div>;
  }
  return (
    <dl className="wallet-summary">
      <div><dt>可用筹码</dt><dd>{wallet.availableChips.toLocaleString()}</dd></div>
      <div><dt>本桌筹码</dt><dd>{wallet.tableChips.toLocaleString()}</dd></div>
      <div className="wallet-total"><dt>总计</dt><dd>{wallet.totalChips.toLocaleString()}</dd></div>
    </dl>
  );
}
