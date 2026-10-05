import type { PublicRoomSummary } from '@poker/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, Copy, Gift, LockKeyhole, Plus, Search, Spade, Trophy, Users } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreateRoomDialog, type CreateRoomValues } from '../components/CreateRoomDialog';
import { WalletSummary } from '../components/WalletSummary';
import { useAuth } from '../context/AuthContext';
import { api, post } from '../lib/api';
import { copyText } from '../lib/clipboard';
import { socket } from '../lib/socket';

function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return 'LATE NIGHT';
  if (hour < 12) return 'GOOD MORNING';
  if (hour < 18) return 'GOOD AFTERNOON';
  return 'GOOD EVENING';
}

function statusLabel(status: PublicRoomSummary['status']): string {
  return { waiting: '等待中', countdown: '即将开局', playing: '进行中', finished: '已结束' }[status];
}

function RoomCard({ room, onJoin, isGuest }: { room: PublicRoomSummary; onJoin: (room: PublicRoomSummary) => void; isGuest: boolean }) {
  const full = room.seated >= room.maxSeats;
  const joinable = room.status !== 'finished';
  return (
    <article className="room-card">
      <header>
        <span className={`mode-icon ${room.ranked ? 'ranked' : ''}`}>{room.ranked ? <Trophy /> : room.mode === 'cash' ? <Spade /> : 'SNG'}</span>
        <div><h3>{room.name}</h3><p>{room.mode === 'cash' ? '无限注常规桌' : '单桌淘汰锦标赛'}</p></div>
        <span className={`room-status ${room.status}`}>{statusLabel(room.status)}</span>
      </header>
      <div className="room-stats">
        <span><Users /> {room.seated}/{room.maxSeats}</span>
        <span>观众 {room.spectators}</span>
        <span>盲注 {room.smallBlind}/{room.bigBlind}</span>
        {room.minBuyInBb !== null && <span>买入 {room.minBuyInBb}–{room.maxBuyInBb} BB</span>}
        {room.hasAi && <span><Bot /> 含 AI</span>}
        {room.ranked && <span className="ranked-label">排位</span>}
      </div>
      <footer>
        <span>{room.humans} 名真人入座 · 目标 {room.targetPlayers} 人</span>
        <button className="small-primary" disabled={!joinable} onClick={() => onJoin(room)}>{!joinable ? '已结束' : isGuest && room.ranked ? '注册后进入' : full || room.status === 'playing' ? '进入观战' : '进入房间'}</button>
      </footer>
    </article>
  );
}

export function LobbyPage() {
  const { user, currentRoom, wallet, refresh, claimDailyBonus } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'all' | 'cash' | 'tournament' | 'ranked'>('all');
  const [error, setError] = useState<string | null>(null);
  const [roomCodeCopied, setRoomCodeCopied] = useState(false);
  const [rewardBusy, setRewardBusy] = useState(false);
  const [rewardMessage, setRewardMessage] = useState<string | null>(null);
  const roomsQuery = useQuery({
    queryKey: ['rooms'],
    queryFn: () => api<{ rooms: PublicRoomSummary[] }>('/api/rooms'),
    refetchInterval: 10_000,
  });
  useEffect(() => {
    const update = () => void queryClient.invalidateQueries({ queryKey: ['rooms'] });
    socket.on('lobby:updated', update);
    return () => { socket.off('lobby:updated', update); };
  }, [queryClient]);
  useEffect(() => setRoomCodeCopied(false), [currentRoom?.code]);
  const filtered = useMemo(() => (roomsQuery.data?.rooms ?? []).filter((room) => {
    const matchesQuery = room.name.toLowerCase().includes(query.toLowerCase());
    const matchesMode = mode === 'all' || (mode === 'ranked' ? room.ranked : room.mode === mode);
    return matchesQuery && matchesMode;
  }), [roomsQuery.data, query, mode]);

  const join = async (value: string, publicRoom = false) => {
    setError(null);
    try {
      const result = publicRoom
        ? await post<{ room: PublicRoomSummary }>(`/api/rooms/${value}/join`)
        : await post<{ room: PublicRoomSummary }>('/api/rooms/join', { code: value });
      await refresh();
      navigate(`/room/${result.room.id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加入失败');
    }
  };
  const joinRoom = (room: PublicRoomSummary) => {
    if (room.ranked && user?.isGuest) {
      navigate('/account');
      return;
    }
    void join(room.id, true);
  };
  const create = async (values: CreateRoomValues) => {
    if (values.ranked && user?.isGuest) throw new Error('游客不能创建排位房，请先升级账号');
    const result = await post<{ room: PublicRoomSummary }>('/api/rooms', values);
    await refresh();
    navigate(`/room/${result.room.id}`);
  };
  const joinPrivate = (event: FormEvent) => {
    event.preventDefault();
    if (joinCode.trim()) void join(joinCode.trim());
  };
  const claimReward = async () => {
    setRewardBusy(true);
    setRewardMessage(null);
    try {
      const awarded = await claimDailyBonus();
      setRewardMessage(`已领取 ${awarded.toLocaleString()} 筹码`);
    } catch (reason) {
      setRewardMessage(reason instanceof Error ? reason.message : '领取失败');
    } finally {
      setRewardBusy(false);
    }
  };
  const copyCurrentRoomCode = async () => {
    if (!currentRoom?.code) return;
    setError(null);
    try {
      await copyText(currentRoom.code);
      setRoomCodeCopied(true);
    } catch {
      setError(`无法自动复制，请手动记录房间码 ${currentRoom.code}`);
    }
  };
  return (
    <div className="lobby-page">
      <section className="lobby-hero">
        <div><span className="eyebrow">{greeting()}</span><h1>{user?.displayName}，选张桌子吧。</h1><p>和真人切磋，或创建自己的 AI 牌局。</p></div>
        <div className="lobby-actions">
          <form className="code-join" onSubmit={joinPrivate}><LockKeyhole /><input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} maxLength={36} placeholder="输入房间码" /><button>加入</button></form>
          <button className="primary-button" onClick={() => setCreateOpen(true)}><Plus /> 创建牌局</button>
        </div>
      </section>
      {wallet && <section className="lobby-wallet-card"><WalletSummary wallet={wallet} /><button className={wallet.dailyBonusAvailable ? 'daily-bonus ready' : 'daily-bonus'} disabled={!wallet.dailyBonusAvailable || rewardBusy} onClick={() => void claimReward()}><Gift /><span><strong>{wallet.dailyBonusAvailable ? `领取每日 ${wallet.dailyBonusAmount.toLocaleString()}` : '今日奖励已领取'}</strong><small>{rewardMessage ?? (wallet.dailyBonusAvailable ? '手动领取后立即到账' : '明日可再次领取')}</small></span></button></section>}
      {currentRoom && <section className="active-room-card"><span className="live-dot" /><div><strong>{currentRoom.name}</strong><small>你仍在这个房间中</small></div><button onClick={() => navigate(`/room/${currentRoom.id}`)}>返回牌桌</button><button className="copy-button" aria-label={roomCodeCopied ? '房间码已复制' : '复制房间码'} title={roomCodeCopied ? '房间码已复制' : '复制房间码'} onClick={() => void copyCurrentRoomCode()}>{roomCodeCopied ? <Check size={15} /> : <Copy size={15} />}</button></section>}
      {error && <div className="alert error" role="alert">{error}<button onClick={() => setError(null)}>×</button></div>}
      <section className="room-browser">
        <header className="browser-header">
          <div><h2>公共牌桌</h2><span>{filtered.length} 张可见牌桌</span></div>
          <div className="browser-tools">
            <label className="search-input"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索房间" /></label>
            <div className="filter-tabs">
              {([['all', '全部'], ['cash', '常规'], ['tournament', '锦标赛'], ['ranked', '排位']] as const).map(([value, label]) => <button key={value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{label}</button>)}
            </div>
          </div>
        </header>
        {roomsQuery.isLoading ? <div className="skeleton-grid">{[1, 2, 3].map((item) => <div key={item} className="room-skeleton" />)}</div> : filtered.length > 0 ? <div className="room-grid">{filtered.map((room) => <RoomCard key={room.id} room={room} isGuest={Boolean(user?.isGuest)} onJoin={joinRoom} />)}</div> : <div className="empty-state"><span>♠</span><h3>还没有符合条件的牌桌</h3><p>创建一张桌子，成为今天的第一位房主。</p><button className="secondary-button" onClick={() => setCreateOpen(true)}>创建牌局</button></div>}
      </section>
      <CreateRoomDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={create} availableChips={wallet?.availableChips ?? null} />
    </div>
  );
}
