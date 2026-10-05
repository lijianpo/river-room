import type { WalletView } from '@poker/contracts';
import { Coins, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDialog } from '../lib/use-dialog';
import { WalletSummary } from './WalletSummary';

function floorBb(availableChips: number, bigBlind: number): number {
  return Math.floor(availableChips / bigBlind / 10) * 10;
}

export function BuyInDialog({
  title,
  minBb,
  maxBb,
  bigBlind,
  wallet,
  onClose,
  onConfirm,
}: {
  title: string;
  minBb: number;
  maxBb: number;
  bigBlind: number;
  wallet: WalletView;
  onClose: () => void;
  onConfirm: (buyInBb: number) => Promise<void>;
}) {
  const affordableMax = Math.min(maxBb, floorBb(wallet.availableChips, bigBlind));
  const initial = Math.max(minBb, Math.min(100, affordableMax));
  const [buyInBb, setBuyInBb] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialog<HTMLElement>(true, busy ? undefined : onClose);
  const buyInChips = buyInBb * bigBlind;
  const canBuy = affordableMax >= minBb && buyInBb >= minBb && buyInBb <= affordableMax;
  const options = useMemo(() => Array.from({ length: Math.max(0, Math.floor((maxBb - minBb) / 10) + 1) }, (_, index) => minBb + index * 10), [minBb, maxBb]);

  const confirm = async () => {
    if (!canBuy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm(buyInBb);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '买入失败');
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="dialog buy-in-dialog" role="dialog" aria-modal="true" aria-labelledby="buy-in-title">
        <header><div><span className="eyebrow">RANKED BUY-IN</span><h2 id="buy-in-title">{title}</h2></div><button className="icon-button" aria-label="关闭买入面板" disabled={busy} onClick={onClose}><X /></button></header>
        <WalletSummary wallet={wallet} />
        <div className="buy-in-range-copy"><Coins /><span>本桌允许 <strong>{minBb}–{maxBb} BB</strong></span><small>盲注 {bigBlind / 2}/{bigBlind}</small></div>
        {affordableMax >= minBb ? <>
          <label className="buy-in-slider">选择买入
            <input type="range" min={minBb} max={affordableMax} step={10} value={buyInBb} onChange={(event) => setBuyInBb(Number(event.target.value))} />
          </label>
          <div className="buy-in-options">{options.filter((value) => value <= affordableMax).map((value) => <button key={value} className={buyInBb === value ? 'active' : ''} onClick={() => setBuyInBb(value)}>{value} BB</button>)}</div>
          <div className="buy-in-total"><span>本次买入</span><strong>{buyInChips.toLocaleString()} 筹码</strong><small>{buyInBb} BB</small></div>
        </> : <p className="form-error">可用筹码不足，至少需要 {(minBb * bigBlind).toLocaleString()} 筹码才能入座。</p>}
        {error && <p className="form-error">{error}</p>}
        <div className="dialog-actions"><button className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" data-autofocus disabled={!canBuy || busy} onClick={() => void confirm()}>{busy ? '买入中…' : '确认买入'}</button></div>
      </section>
    </div>
  );
}
