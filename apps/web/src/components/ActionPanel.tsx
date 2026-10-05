import type { GameSnapshot, PlayerActionType } from '@poker/contracts';
import { Check, Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { betPresets, clampBet, type PreAction } from '../lib/betting';
import { useTurnClock } from '../lib/turn-clock';

const URGENT_MS = 5_000;

const preActionOptions: Array<{ value: PreAction; label: string }> = [
  { value: 'check_fold', label: '过牌/弃牌' },
  { value: 'check', label: '自动过牌' },
  { value: 'call_any', label: '跟任意注' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function ActionPanel({
  snapshot,
  onAction,
  pendingAction,
  preAction,
  onPreActionChange,
}: {
  snapshot: GameSnapshot;
  onAction: (type: PlayerActionType, amount?: number) => void;
  pendingAction: PlayerActionType | null;
  preAction: PreAction | null;
  onPreActionChange: (preAction: PreAction | null) => void;
}) {
  const legal = snapshot.legalActions;
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const minimum = legal?.minBet ?? legal?.minRaiseTo ?? 0;
  const [amount, setAmount] = useState(minimum);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => {
    setAmount(minimum);
    setDraft(null);
  }, [minimum, snapshot.version]);
  const isBet = legal?.minBet !== null && legal?.minBet !== undefined;
  const canSize = Boolean(legal && minimum > 0 && legal.maxAmount >= minimum);
  const presets = useMemo(
    () => (legal ? betPresets({ legal, pot: snapshot.pot, currentBet: snapshot.currentBet, bigBlind: snapshot.room.bigBlind, boardCount: snapshot.board.length }) : []),
    [legal, snapshot.pot, snapshot.currentBet, snapshot.room.bigBlind, snapshot.board.length],
  );
  const clock = useTurnClock(legal ? snapshot.actionDeadline : null);
  const busy = pendingAction !== null;
  const step = snapshot.room.bigBlind;
  const setClamped = (value: number) => {
    if (!legal) return;
    setAmount(clampBet(value, minimum, legal.maxAmount));
    setDraft(null);
  };
  const commitDraft = () => {
    if (draft !== null) setClamped(Number(draft));
  };
  const raiseType: PlayerActionType = isBet ? 'bet' : 'raise';

  // 键盘快捷键：F 弃牌（可过牌时不响应，避免误弃）、C 过牌/跟注、R 下注/加注、↑↓ 按一个大盲调整下注额。
  useEffect(() => {
    if (!legal) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat || busy) return;
      if (isTypingTarget(event.target) || document.querySelector('[aria-modal="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'f' && legal.canFold && !legal.canCheck) onAction('fold');
      else if (key === 'c' && legal.canCheck) onAction('check');
      else if (key === 'c' && legal.callAmount > 0) onAction('call');
      else if (key === 'r' && canSize) onAction(raiseType, amount);
      else if (key === 'arrowup' && canSize) setAmount((value) => clampBet(value + step, minimum, legal.maxAmount));
      else if (key === 'arrowdown' && canSize) setAmount((value) => clampBet(value - step, minimum, legal.maxAmount));
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [legal, busy, canSize, raiseType, amount, minimum, step, onAction]);

  if (!legal) {
    const inHand = Boolean(self && snapshot.handId && !self.folded && !self.allIn && self.holeCards.length > 0 && snapshot.phase !== 'complete' && snapshot.phase !== 'showdown');
    const acting = snapshot.players.find((player) => player.isActing);
    if (!inHand) {
      return (
        <div className="action-panel waiting-actions">
          {self?.stack === 0 && snapshot.room.mode === 'cash' ? '筹码已用尽，可在本手结束后补充筹码' : self?.folded ? '本手已弃牌，等待下一手…' : '等待其他玩家行动…'}
        </div>
      );
    }
    return (
      <div className="action-panel waiting-actions pre-actions">
        <span>{acting ? `等待 ${acting.name} 行动…` : '等待其他玩家行动…'}</span>
        <div className="pre-action-options" role="group" aria-label="预选操作，轮到你时自动执行">
          {preActionOptions.map((option) => (
            <button key={option.value} aria-pressed={preAction === option.value} className={preAction === option.value ? 'active' : ''} onClick={() => onPreActionChange(preAction === option.value ? null : option.value)}>
              <span className="pre-action-check" aria-hidden="true">{preAction === option.value && <Check size={11} strokeWidth={3} />}</span>{option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const urgent = clock.remaining > 0 && clock.remaining <= URGENT_MS;
  const onAmountKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitDraft();
    }
  };

  return (
    <div className={`action-panel my-turn ${urgent ? 'urgent' : ''}`} aria-busy={busy} style={{ '--turn-progress': clock.progress } as React.CSSProperties}>
      <span className="turn-bar" aria-hidden="true" />
      <span className="turn-pill" role="status">轮到你行动{snapshot.actionDeadline ? ` · ${Math.ceil(clock.remaining / 1000)} 秒` : ''}</span>
      {canSize && (
        <div className="bet-sizing">
          <div className="preset-row" aria-label="快捷下注额">
            {presets.map((preset) => <button key={preset.label} className={amount === preset.value ? 'active' : ''} onClick={() => setClamped(preset.value)}>{preset.label}</button>)}
          </div>
          <div className="amount-row">
            <button className="amount-step" aria-label="减少一个大盲" disabled={amount <= minimum} onClick={() => setClamped(amount - step)}><Minus size={14} /></button>
            <input
              className="amount-input"
              type="number"
              inputMode="numeric"
              aria-label={isBet ? '下注额' : '加注到'}
              min={minimum}
              max={legal.maxAmount}
              step={step}
              value={draft ?? amount}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitDraft}
              onKeyDown={onAmountKeyDown}
            />
            <button className="amount-step" aria-label="增加一个大盲" disabled={amount >= legal.maxAmount} onClick={() => setClamped(amount + step)}><Plus size={14} /></button>
            <input className="amount-slider" type="range" aria-label="下注额滑块" min={minimum} max={legal.maxAmount} step={Math.max(1, snapshot.room.smallBlind)} value={amount} onChange={(event) => setClamped(Number(event.target.value))} />
          </div>
        </div>
      )}
      <div className="action-buttons">
        {legal.canFold && <button className="fold" disabled={busy} onClick={() => onAction('fold')}>{pendingAction === 'fold' ? '提交中…' : <>弃牌{!legal.canCheck && <kbd>F</kbd>}</>}</button>}
        {legal.canCheck && <button className="neutral" disabled={busy} onClick={() => onAction('check')}>{pendingAction === 'check' ? '提交中…' : <>过牌<kbd>C</kbd></>}</button>}
        {legal.callAmount > 0 && <button className="call" disabled={busy} onClick={() => onAction('call')}>{pendingAction === 'call' ? '提交中…' : <>跟注 <span>{legal.callAmount.toLocaleString()}</span><kbd>C</kbd></>}</button>}
        {canSize && <button className="raise" disabled={busy} onClick={() => onAction(raiseType, amount)}>{pendingAction === raiseType ? '提交中…' : <>{isBet ? '下注' : '加注到'} <span>{amount.toLocaleString()}</span><kbd>R</kbd></>}</button>}
        {legal.canAllIn && <button className="all-in" disabled={busy} onClick={() => onAction('all_in')}>{pendingAction === 'all_in' ? '提交中…' : <>全押 <span>{legal.maxAmount.toLocaleString()}</span></>}</button>}
      </div>
    </div>
  );
}
