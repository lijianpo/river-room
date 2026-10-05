import { ChevronLeft, ChevronRight, Coins, Pause, Play, RotateCcw } from 'lucide-react';
import { useEffect, type KeyboardEvent } from 'react';
import { STREET_NAMES, type ReplayStep } from '../lib/replay';
import { betPlacement, seatPosition } from '../lib/table-layout';
import { PlayingCard } from './PlayingCard';

export const REPLAY_INTERVAL_MS = 900;

/**
 * 牌谱回放：迷你牌桌 + 播放控制。步骤状态由外层持有，方便与行动时间线联动。
 * selfId 所在座位旋转到正下方，与真实牌桌视角一致。
 */
export function HandReplay({
  steps,
  maxSeats,
  selfId,
  index,
  playing,
  onIndexChange,
  onPlayingChange,
}: {
  steps: ReplayStep[];
  maxSeats: number;
  selfId: string | null;
  index: number;
  playing: boolean;
  onIndexChange: (index: number) => void;
  onPlayingChange: (playing: boolean) => void;
}) {
  const step = steps[Math.min(index, steps.length - 1)];
  const last = steps.length - 1;
  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      onPlayingChange(false);
      return;
    }
    const timer = window.setTimeout(() => onIndexChange(index + 1), REPLAY_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, onIndexChange, onPlayingChange]);
  if (!step) return null;

  const anchorSeat = step.players.find((player) => player.id === selfId)?.seat ?? null;
  const go = (next: number) => {
    onPlayingChange(false);
    onIndexChange(Math.max(0, Math.min(last, next)));
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // 进度滑条自带方向键行为，不重复处理。
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowLeft') go(index - 1);
    else if (event.key === 'ArrowRight') go(index + 1);
    else return;
    event.preventDefault();
  };
  const togglePlay = () => {
    if (!playing && index >= last) onIndexChange(0);
    onPlayingChange(!playing);
  };

  return (
    <section className="hand-replay" aria-label="牌谱回放" onKeyDown={onKeyDown}>
      <div className="replay-stage">
        <div className="felt-table">
          <div className="community-cards" aria-label="公共牌">
            {Array.from({ length: 5 }, (_, slot) => {
              const card = step.board[slot];
              return card ? <PlayingCard key={slot} card={card} /> : <span key={slot} className="card-slot" />;
            })}
          </div>
          <div className="pot-display">底池 <strong>{step.pot.toLocaleString()}</strong></div>
        </div>
        {step.players.map((player) => {
          const position = seatPosition(player.seat, maxSeats, anchorSeat);
          return (
            <div
              key={player.id}
              className={`table-seat ${player.id === selfId ? 'self' : ''} ${player.id === step.actorId ? 'acting' : ''} ${player.folded ? 'folded' : ''}`}
              style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
            >
              <div className="seat-cards">{player.holeCards.map((card, slot) => <PlayingCard key={slot} card={card} small />)}</div>
              <div className="seat-panel">
                <span className="seat-info"><strong>{player.name}</strong><small><b>{player.stack.toLocaleString()}</b></small></span>
              </div>
              <div className="seat-badges">
                {player.allIn && !player.won && <span className="danger">ALL IN</span>}
                {player.won > 0 ? <span className="replay-won">+{player.won.toLocaleString()}</span> : player.lastAction && <span>{player.lastAction}</span>}
              </div>
              {player.committed > 0 && <span className={`seat-bet ${betPlacement(position)}`}><Coins size={12} aria-hidden="true" />{player.committed.toLocaleString()}</span>}
            </div>
          );
        })}
      </div>
      <p className="replay-caption" aria-live="polite"><small>{STREET_NAMES[step.street] ?? step.street}</small>{step.description}</p>
      <div className="replay-controls">
        <button className="icon-button" aria-label="从头开始" onClick={() => go(0)}><RotateCcw size={16} /></button>
        <button className="icon-button" aria-label="上一步" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft size={18} /></button>
        <button className="icon-button replay-play" aria-label={playing ? '暂停' : '播放'} onClick={togglePlay}>{playing ? <Pause size={16} /> : <Play size={16} />}</button>
        <button className="icon-button" aria-label="下一步" disabled={index >= last} onClick={() => go(index + 1)}><ChevronRight size={18} /></button>
        <input type="range" aria-label="回放进度" min={0} max={last} value={index} onChange={(event) => go(Number(event.target.value))} />
        <span className="replay-counter">{index + 1}/{steps.length}</span>
      </div>
    </section>
  );
}
