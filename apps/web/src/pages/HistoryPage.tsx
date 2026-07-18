import type { GameMode, HandHistoryDetail, HandHistorySummary } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Clock, X } from 'lucide-react';
import { useState } from 'react';
import { PlayingCard } from '../components/PlayingCard';
import { api } from '../lib/api';

const actionName: Record<string, string> = { small_blind: '小盲', big_blind: '大盲', fold: '弃牌', check: '过牌', call: '跟注', bet: '下注', raise: '加注', all_in: '全押', deal: '发牌', win: '赢得' };

function HandDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useQuery({ queryKey: ['hand', id], queryFn: () => api<{ hand: HandHistoryDetail }>(`/api/history/${id}`) });
  const hand = query.data?.hand;
  return <div className="dialog-backdrop"><section className="dialog hand-dialog"><header><div><span className="eyebrow">HAND REPLAY</span><h2>牌谱详情</h2></div><button className="icon-button" onClick={onClose}><X /></button></header>{query.isLoading ? <p>正在读取牌谱…</p> : hand && <><div className="hand-summary"><div><small>{hand.roomName} · 第 {hand.handNumber} 手</small><strong>底池 {hand.pot}</strong><span>{hand.resultText}</span></div><div className="history-board">{hand.board.map((card, index) => <PlayingCard key={index} card={card} small />)}</div></div><div className="history-players">{hand.players.map((player) => <div key={player.id}><span>{player.name}</span><span className="mini-cards">{player.holeCards.map((card, index) => <PlayingCard key={index} card={card} small />)}</span><strong className={player.netChips >= 0 ? 'positive' : 'negative'}>{player.netChips >= 0 ? '+' : ''}{player.netChips}</strong></div>)}</div><ol className="action-timeline">{hand.actions.map((action) => <li key={action.sequence}><span>{action.playerName}</span><small>{action.street}</small><strong>{actionName[action.action] ?? action.action} {action.amount > 0 && action.amount}</strong></li>)}</ol></>}</section></div>;
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
