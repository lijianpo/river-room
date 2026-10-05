import type { PlayerStatsView, StatsMode } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { NetCurveChart } from '../components/NetCurveChart';
import { StatTiles } from '../components/StatTiles';
import { api } from '../lib/api';
import { SMALL_SAMPLE_HANDS } from '../lib/stats-format';

const modes: Array<[StatsMode, string]> = [['all', '全部'], ['cash', '常规桌'], ['tournament', '锦标赛']];

export function StatsPage() {
  const [mode, setMode] = useState<StatsMode>('all');
  const query = useQuery({ queryKey: ['stats', 'me', mode], queryFn: () => api<{ stats: PlayerStatsView }>(`/api/stats/me?mode=${mode}`) });
  const stats = query.data?.stats;
  return (
    <div className="stats-page">
      <header className="page-heading"><span className="eyebrow">PLAYER STATS</span><h1>我的数据</h1><p>基于最近 1,000 手牌谱计算，帮助你了解自己的打法风格。</p></header>
      <div className="ranking-tabs compact-tabs">{modes.map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}</div>
      {query.isLoading ? <p className="loading-line">正在计算统计…</p> : query.isError ? <p className="loading-line">统计读取失败，请稍后重试</p> : stats && stats.hands === 0 ? (
        <div className="empty-state"><span>♣</span><h3>还没有可统计的手牌</h3><p>完成几手牌后，这里会显示你的入池率、激进度和净赢走势。</p></div>
      ) : stats && <>
        {stats.hands < SMALL_SAMPLE_HANDS && <p className="stats-sample-note"><Info size={15} /> 当前只有 {stats.hands} 手样本，数据波动较大，仅供参考。</p>}
        <StatTiles stats={stats} />
        <section className="stats-curve-card"><header><h2>净赢走势</h2><small>单位：BB</small></header><NetCurveChart values={stats.netCurve} /></section>
      </>}
    </div>
  );
}
