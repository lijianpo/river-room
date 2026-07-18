import type { LeaderboardEntry } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { Crown, Medal, Trophy } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';

type RankingMode = 'total' | 'cash' | 'tournament';

export function LeaderboardPage() {
  const [mode, setMode] = useState<RankingMode>('total');
  const query = useQuery({ queryKey: ['leaderboard'], queryFn: () => api<{ season: string; entries: LeaderboardEntry[] }>('/api/leaderboard') });
  const entries = useMemo(() => [...(query.data?.entries ?? [])].sort((left, right) => {
    if (mode === 'cash') return right.cashPoints - left.cashPoints;
    if (mode === 'tournament') return right.tournamentPoints - left.tournamentPoints;
    return right.totalPoints - left.totalPoints;
  }), [query.data, mode]);
  const score = (entry: LeaderboardEntry) => mode === 'cash' ? entry.cashPoints : mode === 'tournament' ? entry.tournamentPoints : entry.totalPoints;
  return (
    <div className="leaderboard-page">
      <header className="page-heading split"><div><span className="eyebrow">SEASON RANKING</span><h1>牌室排行榜</h1><p>{query.data?.season ?? '当前'} 赛季 · 仅统计全真人公开排位桌</p></div><Trophy className="heading-icon" /></header>
      <div className="ranking-tabs">{([['total', '总榜'], ['cash', '常规桌'], ['tournament', '锦标赛']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div>
      {entries.length >= 1 && <section className="podium">{entries.slice(0, 3).map((entry, index) => <article key={entry.userId} className={`podium-${index + 1}`}><span className="podium-medal">{index === 0 ? <Crown /> : <Medal />}</span><img className="ranking-avatar" src={entry.avatarUrl} alt="" /><strong>{entry.displayName}</strong><b>{score(entry).toFixed(1)}</b><small>积分</small></article>)}</section>}
      <section className="ranking-table">
        <div className="table-head"><span>排名</span><span>玩家</span><span>常规积分</span><span>锦标赛</span><span>冠军</span><span>当前分数</span></div>
        {query.isLoading ? <p className="loading-line">正在读取排行榜…</p> : entries.length === 0 ? <div className="empty-state compact"><span>♠</span><h3>本赛季还没有排位成绩</h3><p>创建公开排位桌，争取第一笔积分。</p></div> : entries.map((entry, index) => <div className="ranking-row" key={entry.userId}><span className={`rank-number rank-${index + 1}`}>{index + 1}</span><span className="player-cell"><img src={entry.avatarUrl} alt="" /><strong>{entry.displayName}</strong></span><span>{entry.cashPoints.toFixed(1)}<small>{entry.cashHands} 手</small></span><span>{entry.tournamentPoints.toFixed(1)}<small>{entry.tournaments} 场</small></span><span>{entry.wins}</span><strong>{score(entry).toFixed(1)}</strong></div>)}
      </section>
    </div>
  );
}
