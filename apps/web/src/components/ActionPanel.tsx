import type { GameSnapshot, PlayerActionType } from '@poker/contracts';
import { useEffect, useMemo, useState } from 'react';

export function ActionPanel({
  snapshot,
  onAction,
  pendingAction,
}: {
  snapshot: GameSnapshot;
  onAction: (type: PlayerActionType, amount?: number) => void;
  pendingAction: PlayerActionType | null;
}) {
  const legal = snapshot.legalActions;
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const minimum = legal?.minBet ?? legal?.minRaiseTo ?? 0;
  const [amount, setAmount] = useState(minimum);
  useEffect(() => setAmount(minimum), [minimum, snapshot.version]);
  const isBet = legal?.minBet !== null && legal?.minBet !== undefined;
  const canSize = minimum > 0 && legal && legal.maxAmount >= minimum;
  const presets = useMemo(() => {
    if (!legal || !self || !canSize) return [];
    return [0.5, 0.75, 1].map((ratio) => {
      const base = isBet
        ? Math.round(snapshot.pot * ratio)
        : snapshot.currentBet + Math.round((snapshot.pot + legal.callAmount) * ratio);
      return { label: ratio === 1 ? '满池' : `${ratio * 100}%`, value: Math.min(legal.maxAmount, Math.max(minimum, base)) };
    });
  }, [legal, self, canSize, isBet, snapshot.pot, snapshot.currentBet, minimum]);

  if (!legal) {
    const own = snapshot.players.find((player) => player.id === snapshot.selfId);
    return (
      <div className="action-panel waiting-actions">
        {own?.stack === 0 && snapshot.room.mode === 'cash' ? '筹码已用尽，可在本手结束后补充筹码' : '等待其他玩家行动…'}
      </div>
    );
  }

  return (
    <div className="action-panel" aria-busy={pendingAction !== null}>
      {canSize && (
        <div className="bet-sizing">
          <div className="preset-row">
            {presets.map((preset) => <button key={preset.label} onClick={() => setAmount(preset.value)}>{preset.label}</button>)}
          </div>
          <label>
            <span>下注额 <strong>{amount.toLocaleString()}</strong></span>
            <input type="range" min={minimum} max={legal.maxAmount} step={Math.max(1, snapshot.room.smallBlind)} value={amount} onChange={(event) => setAmount(Number(event.target.value))} />
          </label>
        </div>
      )}
      <div className="action-buttons">
        {legal.canFold && <button className="fold" disabled={pendingAction !== null} onClick={() => onAction('fold')}>{pendingAction === 'fold' ? '提交中…' : '弃牌'}</button>}
        {legal.canCheck && <button className="neutral" disabled={pendingAction !== null} onClick={() => onAction('check')}>{pendingAction === 'check' ? '提交中…' : '过牌'}</button>}
        {legal.callAmount > 0 && <button className="call" disabled={pendingAction !== null} onClick={() => onAction('call')}>{pendingAction === 'call' ? '提交中…' : <>跟注 <span>{legal.callAmount}</span></>}</button>}
        {canSize && <button className="raise" disabled={pendingAction !== null} onClick={() => onAction(isBet ? 'bet' : 'raise', amount)}>{pendingAction === (isBet ? 'bet' : 'raise') ? '提交中…' : <>{isBet ? '下注' : '加注'} <span>{amount}</span></>}</button>}
        {legal.canAllIn && <button className="all-in" disabled={pendingAction !== null} onClick={() => onAction('all_in')}>{pendingAction === 'all_in' ? '提交中…' : <>全押 <span>{legal.maxAmount}</span></>}</button>}
      </div>
    </div>
  );
}
