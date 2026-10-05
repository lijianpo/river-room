import type { GameMode, HandHistoryDetail, HandHistorySummary } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { HandReplay } from '../components/HandReplay';
import { PlayingCard } from '../components/PlayingCard';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import { ACTION_NAMES, buildReplaySteps, STREET_NAMES } from '../lib/replay';
import { useDialog } from '../lib/use-dialog';

function HandDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const query = useQuery({ queryKey: ['hand', id], queryFn: () => api<{ hand: HandHistoryDetail }>(`/api/history/${id}`) });
  const hand = query.data?.hand;
  const dialogRef = useDialog<HTMLElement>(true, onClose);
  const steps = useMemo(() => (hand ? buildReplaySteps(hand) : []), [hand]);
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stepBySequence = useMemo(() => new Map(steps.map((step, index) => [step.sequence, index])), [steps]);
  const activeSequence = steps[stepIndex]?.sequence ?? null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="dialog hand-dialog" role="dialog" aria-modal="true" aria-labelledby="hand-dialog-title">
        <header><div><span className="eyebrow">HAND REPLAY</span><h2 id="hand-dialog-title">牌谱详情</h2></div><button className="icon-button" aria-label="关闭牌谱" onClick={onClose}><X /></button></header>
        {query.isLoading ? <p>正在读取牌谱…</p> : query.isError ? <p className="form-message">{query.error instanceof Error ? query.error.message : '牌谱读取失败'}</p> : hand && <>
          <div className="hand-summary"><div><small>{hand.roomName} · 第 {hand.handNumber} 手 · 盲注 {hand.smallBlind}/{hand.bigBlind}</small><strong>底池 {hand.pot}</strong><span>{hand.resultText}</span></div><div className="history-board">{hand.board.map((card, index) => <PlayingCard key={index} card={card} small />)}</div></div>
          {steps.length > 1 && <HandReplay steps={steps} maxSeats={hand.maxSeats} selfId={user?.identityId ?? null} index={stepIndex} playing={playing} onIndexChange={setStepIndex} onPlayingChange={setPlaying} />}
          <div className="history-players">{hand.players.map((player) => <div key={player.id}><span>{player.name}</span><span className="mini-cards">{player.holeCards.map((card, index) => <PlayingCard key={index} card={card} small />)}</span><strong className={player.netChips >= 0 ? 'positive' : 'negative'}>{player.netChips >= 0 ? '+' : ''}{player.netChips}</strong></div>)}</div>
          <ol className="action-timeline" aria-label="行动时间线，点击跳转到对应步骤">
            {hand.actions.map((action) => {
              const target = stepBySequence.get(action.sequence);
              const content = <><span>{action.playerName}</span><small>{STREET_NAMES[action.street] ?? action.street}</small><strong>{ACTION_NAMES[action.action] ?? action.action} {action.amount > 0 && action.amount}</strong></>;
              return (
                <li key={action.sequence} className={action.sequence === activeSequence ? 'current' : ''} aria-current={action.sequence === activeSequence ? 'step' : undefined}>
                  {target === undefined ? <div>{content}</div> : <button onClick={() => { setPlaying(false); setStepIndex(target); }}>{content}</button>}
                </li>
              );
            })}
          </ol>
        </>}
      </section>
    </div>
  );
}

export function HistoryPage() {
  const [mode, setMode] = useState<'all' | GameMode>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['history'], queryFn: () => api<{ hands: HandHistorySummary[] }>('/api/history') });
  const hands = (query.data?.hands ?? []).filter((hand) => mode === 'all' || hand.mode === mode);
  return (
    <div className="history-page"><header className="page-heading"><span className="eyebrow">HAND HISTORY</span><h1>近期牌谱</h1><p>隐藏底牌只对牌手本人可见，对手仅在摊牌后公开。</p></header><div className="ranking-tabs compact-tabs">{([['all', '全部'], ['cash', '常规桌'], ['tournament', '锦标赛']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div><section className="history-list">{query.isLoading ? <p className="loading-line">正在读取牌谱…</p> : hands.length === 0 ? <div className="empty-state"><span>♠</span><h3>还没有完成的牌局</h3><p>完成第一手牌后，牌谱会显示在这里。</p></div> : hands.map((hand) => <button className="history-row" key={hand.id} onClick={() => setSelected(hand.id)}><span className={`history-mode ${hand.mode}`}>{hand.mode === 'cash' ? '常规' : 'SNG'}</span><span><strong>{hand.roomName} · 第 {hand.handNumber} 手</strong><small><Clock /> {new Date(hand.completedAt).toLocaleString('zh-CN')}</small></span><span>底池 <strong>{hand.pot}</strong></span><span className={(hand.netChips ?? 0) >= 0 ? 'positive' : 'negative'}>{(hand.netChips ?? 0) >= 0 ? '+' : ''}{hand.netChips ?? 0} <small>({((hand.netChips ?? 0) / hand.bigBlind).toFixed(1)} BB)</small></span><ChevronRight /></button>)}</section>{selected && <HandDetailDialog id={selected} onClose={() => setSelected(null)} />}</div>
  );
}
