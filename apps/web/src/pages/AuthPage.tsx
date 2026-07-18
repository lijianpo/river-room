import type { PublicOverview } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, MonitorSmartphone, ShieldCheck, Trophy, Users } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthPanel } from '../components/AuthPanel';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';

export function AuthPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const overview = useQuery({ queryKey: ['public-overview'], queryFn: () => api<PublicOverview>('/api/public/overview'), refetchInterval: 15_000 });
  useEffect(() => {
    if (user) navigate('/lobby', { replace: true });
  }, [user, navigate]);
  if (loading) return <div className="full-loader"><span className="chip-loader">♠</span><p>正在准备牌桌…</p></div>;
  return (
    <main className="landing-page">
      <section className="landing-copy">
        <div className="landing-brand"><span>♠</span><div><strong>RIVER ROOM</strong><small>德州牌室</small></div></div>
        <p className="eyebrow">PLAY TOGETHER · ANYWHERE</p>
        <h1>真正坐在同一张<br /><em>牌桌</em>的感觉。</h1>
        <p className="landing-lead">邀请朋友，或让聪明的 AI 补上空座。无需下载，电脑和手机打开浏览器即可开局。</p>
        <div className="feature-pills">
          <span><Users /> 2–9 人实时联机</span>
          <span><Bot /> 三档 AI 牌友</span>
          <span><MonitorSmartphone /> 横竖屏适配</span>
          <span><ShieldCheck /> 纯娱乐积分</span>
        </div>
        <section className="guest-preview" aria-label="牌室实时预览">
          <header><span><Activity /> 当前在线 <strong>{overview.data?.onlineCount ?? '—'}</strong></span><span><Trophy /> {overview.data?.season ?? '当前赛季'} 前十</span></header>
          <ol>{overview.data?.entries.length ? overview.data.entries.map((entry) => <li key={entry.userId}><span>{entry.rank}</span><img src={entry.avatarUrl} alt="" /><strong>{entry.displayName}</strong><b>{entry.totalPoints.toFixed(1)}</b></li>) : <li className="preview-empty">本赛季排行榜正在等待第一位玩家</li>}</ol>
        </section>
        <div className="decorative-cards" aria-hidden="true"><span>A♠</span><span>K♥</span></div>
      </section>
      <AuthPanel />
    </main>
  );
}
