import type { PublicRoomSummary, RoomInvitePreview } from '@poker/contracts';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Eye, LockKeyhole, ShieldAlert, Spade, Trophy, Users } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AuthPanel } from '../components/AuthPanel';
import { useAuth } from '../context/AuthContext';
import { api, post } from '../lib/api';
import { isValidInviteCode, normalizeInviteCode } from '../lib/invite';

const STATUS_LABEL: Record<RoomInvitePreview['status'], string> = {
  waiting: '等待开局',
  countdown: '即将开局',
  playing: '牌局进行中',
  finished: '牌局已结束',
};

function InviteError({ message, target }: { message: string; target: string }) {
  return (
    <section className="invite-state-card" role="alert">
      <ShieldAlert />
      <h2>暂时无法加入</h2>
      <p>{message}</p>
      <Link className="secondary-button" to={target}><ArrowLeft />返回{target === '/lobby' ? '大厅' : '首页'}</Link>
    </section>
  );
}

export function InvitePage() {
  const { code: rawCode = '' } = useParams();
  const code = normalizeInviteCode(rawCode);
  const validCode = isValidInviteCode(code);
  const navigate = useNavigate();
  const { user, currentRoom, loading: authLoading, refresh } = useAuth();
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const attemptedJoin = useRef<string | null>(null);
  const previewQuery = useQuery({
    queryKey: ['room-invite', code],
    queryFn: () => api<{ room: RoomInvitePreview }>(`/api/public/rooms/invite/${encodeURIComponent(code)}`).then((result) => result.room),
    enabled: validCode,
    retry: false,
  });
  const preview = previewQuery.data;
  const currentRoomMatches = Boolean(currentRoom?.code && normalizeInviteCode(currentRoom.code) === code);
  const hasOtherRoom = Boolean(currentRoom && !currentRoomMatches);

  const joinRoom = useCallback(async () => {
    if (!user || !preview || preview.status === 'finished') return;
    setJoining(true);
    setJoinError(null);
    try {
      const result = await post<{ room: PublicRoomSummary }>('/api/rooms/join', { code });
      await refresh();
      navigate(`/room/${result.room.id}`, { replace: true });
    } catch (reason) {
      setJoinError(reason instanceof Error ? reason.message : '加入房间失败');
    } finally {
      setJoining(false);
    }
  }, [code, navigate, preview, refresh, user]);

  useEffect(() => {
    if (authLoading || !user || !preview || preview.status === 'finished' || user.mustChangePassword || hasOtherRoom) return;
    if (currentRoomMatches && currentRoom) {
      navigate(`/room/${currentRoom.id}`, { replace: true });
      return;
    }
    if (preview.ranked && user.isGuest) return;
    const attemptKey = `${user.identityId}:${code}`;
    if (attemptedJoin.current === attemptKey) return;
    attemptedJoin.current = attemptKey;
    void joinRoom();
  }, [authLoading, code, currentRoom, currentRoomMatches, hasOtherRoom, joinRoom, navigate, preview, user]);

  const homeTarget = user ? '/lobby' : '/';
  const queryError = previewQuery.error instanceof Error ? previewQuery.error.message : '房间不存在或邀请码无效';

  return (
    <main className="invite-page">
      <Link className="invite-brand" to={homeTarget}><span>♠</span><div><strong>RIVER ROOM</strong><small>德州牌室</small></div></Link>
      {!validCode ? <InviteError message="邀请码格式无效，请向邀请人重新获取二维码。" target={homeTarget} />
        : authLoading || previewQuery.isLoading ? <section className="invite-state-card"><span className="chip-loader">♠</span><h2>正在读取房间邀请…</h2></section>
          : previewQuery.isError || !preview ? <InviteError message={queryError} target={homeTarget} />
            : (
              <div className="invite-layout">
                <section className="invite-preview-card">
                  <span className={`invite-mode-icon ${preview.ranked ? 'ranked' : ''}`}>
                    {preview.ranked ? <Trophy /> : preview.visibility === 'private' ? <LockKeyhole /> : <Spade />}
                  </span>
                  <p className="eyebrow">TABLE INVITATION</p>
                  <h1>{preview.name}</h1>
                  <p className="invite-description">朋友邀请你加入这张德州牌桌。进入后先观战，点击空座即可参与下一手。</p>
                  <dl className="invite-stats">
                    <div><dt>房间码</dt><dd>{code}</dd></div>
                    <div><dt>当前状态</dt><dd>{STATUS_LABEL[preview.status]}</dd></div>
                    <div><dt><Users /> 已入座</dt><dd>{preview.seated}/{preview.maxSeats}</dd></div>
                    <div><dt><Eye /> 观战</dt><dd>{preview.spectators}</dd></div>
                  </dl>
                  <span className="invite-room-kind">{preview.ranked ? '正式账号排位桌' : preview.visibility === 'private' ? '私密邀请牌桌' : '公共休闲牌桌'}</span>
                </section>

                <section className="invite-entry-card">
                  {preview.status === 'finished' ? <InviteError message="这张牌桌已经结束，无法继续加入。" target={homeTarget} />
                    : !user ? <><header><span className="eyebrow">ONE STEP AWAY</span><h2>认证后自动加入</h2><p>{preview.ranked ? '排位房仅限正式账号，请登录或注册。' : '可使用游客昵称，也可登录已有账号。'}</p></header><AuthPanel allowGuest={!preview.ranked} guestActionLabel="完成并加入" /></>
                      : user.mustChangePassword ? <section className="invite-inline-state"><ShieldAlert /><h2>请先修改临时密码</h2><p>修改完成后会自动回到这个邀请并加入房间。</p><button className="primary-button" onClick={() => navigate(`/account?returnTo=${encodeURIComponent(`/invite/${code}`)}`)}>前往账号安全</button></section>
                        : hasOtherRoom && currentRoom ? <section className="invite-inline-state"><ShieldAlert /><h2>你正在另一个房间</h2><p>为避免意外离桌，不会自动退出「{currentRoom.name}」。请先返回并离开当前房间。</p><button className="primary-button" onClick={() => navigate(`/room/${currentRoom.id}`)}>返回当前牌桌</button></section>
                          : preview.ranked && user.isGuest ? <><header><span className="eyebrow">RANKED ACCESS</span><h2>升级后自动加入</h2><p>排位房只允许正式账号，你可以注册或切换已有账号。</p></header><AuthPanel upgrade /></>
                            : joinError ? <section className="invite-inline-state" role="alert"><ShieldAlert /><h2>加入失败</h2><p>{joinError}</p><div className="invite-state-actions"><button className="primary-button" disabled={joining} onClick={() => void joinRoom()}>{joining ? '重试中…' : '重新尝试'}</button><Link className="secondary-button" to={homeTarget}>返回大厅</Link></div></section>
                              : <section className="invite-inline-state joining"><span className="chip-loader">♠</span><h2>{currentRoomMatches ? '正在返回牌桌…' : '正在加入房间…'}</h2><p>即将以观战者身份进入，入房后可点击空座入座。</p></section>}
                </section>
              </div>
            )}
    </main>
  );
}
