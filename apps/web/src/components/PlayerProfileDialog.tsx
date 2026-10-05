import type { PlayerProfileView } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api } from '../lib/api';
import { SMALL_SAMPLE_HANDS } from '../lib/stats-format';
import { useDialog } from '../lib/use-dialog';
import { Avatar } from './Avatar';
import { StatTiles } from './StatTiles';

/** 牌桌上点击对手头像打开的资料卡，只展示聚合统计。 */
export function PlayerProfileDialog({ userId, onClose }: { userId: string; onClose: () => void }) {
  const dialogRef = useDialog<HTMLElement>(true, onClose);
  const query = useQuery({ queryKey: ['profile', userId], queryFn: () => api<{ profile: PlayerProfileView }>(`/api/stats/users/${userId}`) });
  const profile = query.data?.profile;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="dialog profile-dialog" role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title">
        <header>
          <div className="profile-dialog-title">
            {profile && <Avatar src={profile.avatarUrl} name={profile.displayName} />}
            <div><span className="eyebrow">PLAYER CARD</span><h2 id="profile-dialog-title">{profile?.displayName ?? '玩家资料'}</h2></div>
          </div>
          <button className="icon-button" aria-label="关闭玩家资料" onClick={onClose}><X /></button>
        </header>
        {query.isLoading ? <p className="form-hint">正在读取玩家数据…</p> : query.isError ? <p className="form-message">{query.error instanceof Error ? query.error.message : '读取失败'}</p> : profile && <>
          <StatTiles stats={profile.stats} compact />
          {profile.stats.hands < SMALL_SAMPLE_HANDS && <p className="form-hint">样本较少（{profile.stats.hands} 手），数据仅供参考。</p>}
        </>}
      </section>
    </div>
  );
}
