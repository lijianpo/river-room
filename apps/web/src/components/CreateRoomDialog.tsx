import type { AiDifficulty, GameMode, RoomVisibility } from '@poker/contracts';
import { Bot, LockKeyhole, Trophy, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export interface CreateRoomValues {
  name: string;
  mode: GameMode;
  visibility: RoomVisibility;
  ranked: boolean;
  maxSeats: number;
  targetPlayers: number;
  smallBlind: number;
  bigBlind: number;
  startingStackBb: number;
  minBuyInBb: number;
  maxBuyInBb: number;
  buyInBb: number;
  autoFillAi: boolean;
  aiDifficulty: AiDifficulty;
}

export function CreateRoomDialog({
  open,
  onClose,
  onCreate,
  availableChips,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (values: CreateRoomValues) => Promise<void>;
  availableChips: number | null;
}) {
  const [values, setValues] = useState<CreateRoomValues>({
    name: '周末牌局',
    mode: 'cash',
    visibility: 'public',
    ranked: false,
    maxSeats: 6,
    targetPlayers: 4,
    smallBlind: 10,
    bigBlind: 20,
    startingStackBb: 100,
    minBuyInBb: 40,
    maxBuyInBb: 200,
    buyInBb: 100,
    autoFillAi: true,
    aiDifficulty: 'normal',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;
  const update = <K extends keyof CreateRoomValues>(key: K, value: CreateRoomValues[K]) => setValues((current) => ({ ...current, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (values.ranked && values.mode === 'cash' && (availableChips ?? 0) < values.buyInBb * 20) {
        throw new Error(`可用筹码不足，需要 ${(values.buyInBb * 20).toLocaleString()} 筹码`);
      }
      await onCreate(values);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="dialog create-room-dialog" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header><div><span className="eyebrow">NEW TABLE</span><h2 id="create-title">创建牌局</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          <label>房间名称<input value={values.name} onChange={(event) => update('name', event.target.value)} minLength={2} maxLength={24} required /></label>
          <div className="segmented">
            <button type="button" className={values.mode === 'cash' ? 'active' : ''} onClick={() => update('mode', 'cash')}>常规桌</button>
            <button type="button" className={values.mode === 'tournament' ? 'active' : ''} onClick={() => update('mode', 'tournament')}>单桌锦标赛</button>
          </div>
          <div className="option-grid">
            <button type="button" className={`option-card ${values.visibility === 'public' && !values.ranked ? 'selected' : ''}`} onClick={() => { update('visibility', 'public'); update('ranked', false); }}><span>♠</span><strong>公共休闲</strong><small>游客与 AI 均可加入</small></button>
            <button type="button" className={`option-card ${values.visibility === 'private' ? 'selected' : ''}`} onClick={() => { update('visibility', 'private'); update('ranked', false); }}><LockKeyhole /><strong>私密邀请</strong><small>凭房间码加入</small></button>
            <button type="button" className={`option-card ${values.ranked ? 'selected' : ''}`} onClick={() => { update('visibility', 'public'); update('ranked', true); update('autoFillAi', false); update('minBuyInBb', 40); update('maxBuyInBb', 200); update('buyInBb', 100); }}><Trophy /><strong>公共排位</strong><small>仅正式账号，无 AI</small></button>
          </div>
          <div className="form-grid two">
            <label>座位数<select value={values.maxSeats} onChange={(event) => { const max = Number(event.target.value); update('maxSeats', max); update('targetPlayers', Math.min(values.targetPlayers, max)); }}>{Array.from({ length: 8 }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label>
            <label>目标开局人数<select value={values.targetPlayers} onChange={(event) => update('targetPlayers', Number(event.target.value))}>{Array.from({ length: values.maxSeats - 1 }, (_, index) => index + 2).map((count) => <option key={count}>{count}</option>)}</select></label>
          </div>
          {values.mode === 'cash' && !values.ranked && (
            <div className="form-grid three">
              <label>小盲<input type="number" min={1} value={values.smallBlind} disabled={values.ranked} onChange={(event) => update('smallBlind', Number(event.target.value))} /></label>
              <label>大盲<input type="number" min={2} value={values.bigBlind} disabled={values.ranked} onChange={(event) => update('bigBlind', Number(event.target.value))} /></label>
              <label>起始筹码<select value={values.startingStackBb} disabled={values.ranked} onChange={(event) => update('startingStackBb', Number(event.target.value))}><option value={40}>40 BB</option><option value={100}>100 BB</option><option value={200}>200 BB</option></select></label>
            </div>
          )}
          {values.mode === 'cash' && values.ranked && (
            <section className="ranked-buyin-settings">
              <div className="ranked-fixed-blinds"><Trophy /><span>排位固定盲注</span><strong>10 / 20</strong></div>
              <div className="form-grid three">
                <label>最小买入<select value={values.minBuyInBb} onChange={(event) => { const minimum = Number(event.target.value); update('minBuyInBb', minimum); update('maxBuyInBb', Math.max(minimum, values.maxBuyInBb)); update('buyInBb', Math.max(minimum, values.buyInBb)); }}>{Array.from({ length: 17 }, (_, index) => 40 + index * 10).map((value) => <option key={value} value={value}>{value} BB</option>)}</select></label>
                <label>最大买入<select value={values.maxBuyInBb} onChange={(event) => { const maximum = Number(event.target.value); update('maxBuyInBb', maximum); update('minBuyInBb', Math.min(maximum, values.minBuyInBb)); update('buyInBb', Math.min(maximum, values.buyInBb)); }}>{Array.from({ length: 17 }, (_, index) => 40 + index * 10).map((value) => <option key={value} value={value}>{value} BB</option>)}</select></label>
                <label>我的买入<select value={values.buyInBb} onChange={(event) => update('buyInBb', Number(event.target.value))}>{Array.from({ length: Math.floor((values.maxBuyInBb - values.minBuyInBb) / 10) + 1 }, (_, index) => values.minBuyInBb + index * 10).map((value) => <option key={value} value={value}>{value} BB · {(value * 20).toLocaleString()}</option>)}</select></label>
              </div>
              <p>可用筹码 {(availableChips ?? 0).toLocaleString()} · 创建时将扣除 {(values.buyInBb * 20).toLocaleString()}</p>
            </section>
          )}
          {!values.ranked && (
            <div className="ai-setting">
              <label className="switch-row"><span><Bot size={18} /><span><strong>AI 自动补位</strong><small>倒计时 30 秒后补至目标人数</small></span></span><input type="checkbox" checked={values.autoFillAi} onChange={(event) => update('autoFillAi', event.target.checked)} /></label>
              {values.autoFillAi && <label>默认难度<select value={values.aiDifficulty} onChange={(event) => update('aiDifficulty', event.target.value as AiDifficulty)}><option value="easy">简单</option><option value="normal">普通</option><option value="hard">困难</option></select></label>}
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button" disabled={busy}>{busy ? '创建中…' : '创建并入座'}</button></div>
        </form>
      </section>
    </div>
  );
}
