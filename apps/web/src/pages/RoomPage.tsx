import type { Ack, AiDifficulty, PlayerActionType, PlayerSnapshot } from '@poker/contracts';
import { Armchair, Bot, ChevronLeft, Eye, LogOut, MessageCircle, Play, QrCode, RotateCcw, UserMinus, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ActionPanel } from '../components/ActionPanel';
import { BuyInDialog } from '../components/BuyInDialog';
import { ChatPanel } from '../components/ChatPanel';
import { useConfirm } from '../components/ConfirmDialog';
import { HandLog } from '../components/HandLog';
import { PokerTable } from '../components/PokerTable';
import { RoomShareDialog } from '../components/RoomShareDialog';
import { LatencyBadge } from '../components/LatencyBadge';
import { WalletSummary } from '../components/WalletSummary';
import { useAuth } from '../context/AuthContext';
import { playTone, vibrate } from '../lib/settings';
import { socket } from '../lib/socket';
import { createActionId } from '../lib/action-id';
import { resolvePreAction, type PreAction } from '../lib/betting';
import { shouldIncrementChatUnread } from '../lib/chat-unread';
import { useGameStore } from '../store/game';

function useCountdown(deadline: number | null): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const update = () => setSeconds(deadline ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return seconds;
}

export function RoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { snapshot, messages, connected, notice, setSnapshot, setMessages, addMessage, setConnected, notify, dismissNotice, reset } = useGameStore();
  const [chatOpen, setChatOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [difficulty, setDifficulty] = useState<AiDifficulty>('normal');
  const [pendingAction, setPendingAction] = useState<PlayerActionType | null>(null);
  const [buyInRequest, setBuyInRequest] = useState<{ type: 'seat'; seat: number } | { type: 'rebuy' } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // 预选操作只对选择时所在的这一条街有效，换街或换手后自动失效。
  const [preAction, setPreAction] = useState<{ type: PreAction; street: string } | null>(null);
  const [confirmElement, confirm] = useConfirm();
  const actionTimeout = useRef<number | null>(null);
  const previous = useRef<{ acting: boolean; handId: string | null; result: string | null }>({ acting: false, handId: null, result: null });
  const chatOpenRef = useRef(chatOpen);
  const selfIdRef = useRef<string | null>(null);
  const countdown = useCountdown(snapshot?.countdownDeadline ?? null);
  useEffect(() => { chatOpenRef.current = chatOpen; if (chatOpen) setUnreadCount(0); }, [chatOpen]);
  useEffect(() => { selfIdRef.current = snapshot?.selfId ?? null; }, [snapshot?.selfId]);

  useEffect(() => {
    reset();
    const subscribe = () => socket.emit('room:subscribe', { roomId }, (ack) => {
      if (!ack.ok) notify(ack.error ?? '无法加入房间');
      else setConnected(true);
    });
    const onConnect = () => { setConnected(true); dismissNotice(); subscribe(); };
    const onDisconnect = () => {
      setConnected(false);
      setPendingAction(null);
      if (actionTimeout.current !== null) window.clearTimeout(actionTimeout.current);
      actionTimeout.current = null;
    };
    const onConnectError = (reason: Error) => {
      setConnected(false);
      notify(reason.message.includes('会话') ? reason.message : '实时连接失败，正在重试…');
      if (reason.message.includes('会话')) void refresh();
    };
    const onError = (payload: { message: string }) => notify(payload.message);
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    socket.on('room:snapshot', setSnapshot);
    const onChatHistory = (history: Parameters<typeof setMessages>[0]) => { setMessages(history); setUnreadCount(0); };
    const onChat = (message: Parameters<typeof addMessage>[0]) => {
      addMessage(message);
      if (shouldIncrementChatUnread({ message, selfId: selfIdRef.current, chatOpen: chatOpenRef.current, mobile: window.matchMedia('(max-width: 980px)').matches })) setUnreadCount((count) => count + 1);
    };
    socket.on('room:chat-history', onChatHistory);
    socket.on('room:chat', onChat);
    socket.on('app:error', onError);
    if (socket.connected) subscribe();
    else socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      socket.off('room:snapshot', setSnapshot);
      socket.off('room:chat-history', onChatHistory);
      socket.off('room:chat', onChat);
      socket.off('app:error', onError);
      if (actionTimeout.current !== null) window.clearTimeout(actionTimeout.current);
      actionTimeout.current = null;
      setPendingAction(null);
      reset();
      setUnreadCount(0);
    };
  }, [roomId, refresh, reset, setSnapshot, setMessages, addMessage, setConnected, notify, dismissNotice]);

  const hasSnapshot = snapshot !== null;
  useEffect(() => {
    // 加载失败的提示需要一直显示；进入牌桌后提示自动消失。
    if (!notice || !hasSnapshot) return;
    const timer = window.setTimeout(dismissNotice, notice.kind === 'success' ? 3_000 : 6_000);
    return () => window.clearTimeout(timer);
  }, [notice, hasSnapshot, dismissNotice]);

  useEffect(() => {
    if (!snapshot) return;
    const acting = snapshot.players.some((player) => player.id === snapshot.selfId && player.isActing);
    if (acting && (!previous.current.acting || previous.current.handId !== snapshot.handId)) {
      playTone('turn');
      vibrate([80, 40, 80]);
    }
    if (snapshot.resultMessage && snapshot.resultMessage !== previous.current.result) playTone('win');
    previous.current = { acting, handId: snapshot.handId, result: snapshot.resultMessage };
  }, [snapshot]);

  const reportError = (ack: Ack) => {
    if (!ack.ok) notify(ack.error ?? '操作失败');
  };
  const action = (type: PlayerActionType, amount?: number) => {
    if (!snapshot?.handId || pendingAction) return;
    setPendingAction(type);
    actionTimeout.current = window.setTimeout(() => {
      actionTimeout.current = null;
      setPendingAction(null);
      notify('操作响应超时，请检查网络后重试');
    }, 8_000);
    socket.emit('game:action', {
      roomId,
      action: {
        type,
        ...(amount === undefined ? {} : { amount }),
        actionId: createActionId(),
        handId: snapshot.handId,
        version: snapshot.version,
      },
    }, (ack) => {
      if (actionTimeout.current !== null) window.clearTimeout(actionTimeout.current);
      actionTimeout.current = null;
      setPendingAction(null);
      reportError(ack);
      if (ack.ok) playTone('chip');
    });
  };
  const street = snapshot ? `${snapshot.handId}:${snapshot.board.length}` : '';
  const activePreAction = preAction?.street === street ? preAction.type : null;
  useEffect(() => {
    if (!activePreAction || !snapshot?.legalActions || pendingAction) return;
    const type = resolvePreAction(activePreAction, snapshot.legalActions);
    setPreAction(null);
    if (type) action(type);
    // 执行前先清空预选，因此每次轮到自己最多触发一次；action 每次渲染都会重建，不放进依赖。
  }, [snapshot?.legalActions, activePreAction, pendingAction]);
  const leave = () => {
    socket.emit('room:leave', { roomId }, (ack) => {
      if (!ack.ok) return reportError(ack);
      void refresh().then(() => navigate('/lobby'));
    });
  };
  const takeSeat = (seat: number) => {
    if (snapshot?.room.ranked && snapshot.room.mode === 'cash') {
      setBuyInRequest({ type: 'seat', seat });
      return;
    }
    socket.emit('room:take-seat', { roomId, seat }, reportError);
  };
  const confirmBuyIn = (buyInBb: number) => new Promise<void>((resolve, reject) => {
    if (!buyInRequest) return reject(new Error('买入请求已失效'));
    const callback = (ack: Ack) => {
      if (!ack.ok) {
        reject(new Error(ack.error ?? '买入失败'));
        return;
      }
      setBuyInRequest(null);
      resolve();
    };
    if (buyInRequest.type === 'seat') socket.emit('room:take-seat', { roomId, seat: buyInRequest.seat, buyInBb }, callback);
    else socket.emit('room:rebuy', { roomId, buyInBb }, callback);
  });
  const standUp = async () => {
    if (snapshot?.room.mode === 'tournament' && snapshot.room.status === 'playing' && !await confirm({ title: '离座观战', message: '锦标赛开赛后离座将立即弃赛，确定继续吗？', confirmLabel: '弃赛并离座', danger: true })) return;
    socket.emit('room:stand-up', { roomId }, reportError);
  };
  const managePlayer = async (player: PlayerSnapshot) => {
    const event = player.isBot ? 'room:remove-bot' : 'room:kick';
    if (!player.isBot && !await confirm({ title: '移出玩家', message: `确定将 ${player.name} 移出房间吗？`, confirmLabel: '移出', danger: true })) return;
    if (event === 'room:remove-bot') socket.emit(event, { roomId, playerId: player.id }, reportError);
    else socket.emit(event, { roomId, playerId: player.id }, reportError);
  };
  const sendChat = (text: string) => socket.emit('chat:send', { roomId, text }, reportError);
  const openChat = () => { chatOpenRef.current = true; setUnreadCount(0); setChatOpen(true); };
  const closeChat = () => { chatOpenRef.current = false; setChatOpen(false); };
  const reportChat = (messageId: string) => socket.emit('chat:report', { roomId, messageId }, (ack) => {
    reportError(ack);
    if (ack.ok) notify('举报已记录，感谢反馈', 'success');
  });

  if (!snapshot) return <div className="room-loading"><span className="chip-loader">♠</span><h2>{notice?.kind === 'error' ? notice.message : '正在连接牌桌…'}</h2><p>{connected ? '同步房间状态' : '建立实时连接'}</p><button className="secondary-button" onClick={() => navigate('/lobby')}><ChevronLeft /> 返回大厅</button></div>;
  const isHost = snapshot.room.hostId === snapshot.selfId;
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const canAddBot = isHost && !snapshot.room.ranked && snapshot.players.length < snapshot.room.maxSeats && (snapshot.phase === 'waiting' || snapshot.phase === 'countdown' || snapshot.phase === 'complete' || snapshot.phase === 'showdown');

  return (
    <div className="room-page">
      <header className="room-header">
        <div className="room-title"><button className="icon-button" onClick={() => navigate('/lobby')} aria-label="返回大厅"><ChevronLeft /></button><div><span>{snapshot.room.ranked ? '排位牌桌' : snapshot.room.visibility === 'private' ? '私密牌桌' : '休闲牌桌'}</span><h1>{snapshot.room.name}</h1></div></div>
        <div className="room-header-meta">
          {snapshot.room.inviteCode && <button className="invite-code" aria-label={`分享房间，房间码 ${snapshot.room.inviteCode}`} onClick={() => setShareOpen(true)}><span>分享房间</span><strong>{snapshot.room.inviteCode}</strong><QrCode size={15} /></button>}
          <WalletSummary wallet={snapshot.selfWallet} compact />
          <LatencyBadge connected={connected} />
          {snapshot.selfRole === 'player' && <button className="stand-button" onClick={() => void standUp()}><UserMinus /> 离座观战</button>}
          <button className="leave-button" onClick={leave}><LogOut /> 离开房间</button>
        </div>
      </header>
      {notice && <div key={notice.id} className={`room-toast ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}<button aria-label="关闭提示" onClick={dismissNotice}>×</button></div>}
      <div className="room-layout">
        <main className="table-column">
          {snapshot.selfRole === 'spectator' && <div className="spectator-banner"><Eye /><span>正在观战 · {snapshot.spectatorCount} 名观众</span>{snapshot.openSeats.length > 0 && (snapshot.room.mode === 'cash' || snapshot.phase === 'waiting' || snapshot.phase === 'countdown') && <strong><Armchair /> 点击空座即可入座</strong>}</div>}
          {snapshot.room.ranked && snapshot.room.mode === 'cash' && snapshot.selfWallet && <div className="table-wallet-hud"><WalletSummary wallet={snapshot.selfWallet} />{self && <div className="buyin-remaining"><small>本次买入 {self.buyInChips?.toLocaleString() ?? '—'}</small><strong>当前剩余 {self.stack.toLocaleString()}</strong>{self.committed > 0 && <span>本手已下注 {self.committed.toLocaleString()}</span>}</div>}</div>}
          <PokerTable snapshot={snapshot} onManagePlayer={(player) => void managePlayer(player)} onTakeSeat={takeSeat}>
            {snapshot.handId && <HandLog events={snapshot.events} handNumber={snapshot.handNumber} />}
          </PokerTable>
          {(snapshot.phase === 'waiting' || snapshot.phase === 'countdown') ? (
            <section className="waiting-panel">
              <div><span className="waiting-icon"><UserPlus /></span><div><strong>{snapshot.phase === 'countdown' ? `${countdown} 秒后 AI 补位开局` : `等待玩家 · ${snapshot.players.length}/${snapshot.room.targetPlayers}`}</strong><p>{snapshot.room.ranked ? '排位房只允许正式账号真人玩家' : snapshot.room.config.autoFillAi ? '房主开局后会等待真人，人数不足时自动补入 AI' : '房主可直接开局或手动添加 AI'}</p></div></div>
              <div className="waiting-controls">
                {canAddBot && <><select value={difficulty} onChange={(event) => setDifficulty(event.target.value as AiDifficulty)} aria-label="AI 难度"><option value="easy">简单 AI</option><option value="normal">普通 AI</option><option value="hard">困难 AI</option></select><button className="secondary-button" onClick={() => socket.emit('room:add-bot', { roomId, difficulty }, reportError)}><Bot /> 添加 AI</button></>}
                {isHost && snapshot.phase === 'waiting' && <button className="primary-button" onClick={() => socket.emit('room:start', { roomId }, reportError)}><Play /> 开始牌局</button>}
                {isHost && snapshot.phase === 'countdown' && <button className="secondary-button" onClick={() => socket.emit('room:cancel-countdown', { roomId }, reportError)}>取消倒计时</button>}
              </div>
            </section>
          ) : snapshot.room.status === 'finished' ? null : snapshot.selfRole === 'player' ? (
            <ActionPanel snapshot={snapshot} onAction={action} pendingAction={pendingAction} preAction={activePreAction} onPreActionChange={(type) => setPreAction(type ? { type, street } : null)} />
          ) : <section className="spectator-action"><Eye /><div><strong>观战模式</strong><p>你可以查看公共牌和行动；空座玩家会从下一手开始参与。</p></div></section>}
          {snapshot.room.mode === 'cash' && self?.stack === 0 && snapshot.handId && (snapshot.phase === 'complete' || snapshot.phase === 'showdown') && <button className="rebuy-button" onClick={() => snapshot.room.ranked ? setBuyInRequest({ type: 'rebuy' }) : socket.emit('room:rebuy', { roomId }, reportError)}><RotateCcw /> {snapshot.room.ranked ? '重新买入' : `补充至 ${snapshot.room.bigBlind * snapshot.room.config.startingStackBb} 筹码`}</button>}
          {snapshot.room.status === 'finished' && <section className="finished-panel"><strong>{snapshot.resultMessage}</strong><button className="primary-button" onClick={leave}>返回大厅</button></section>}
        </main>
        <ChatPanel messages={messages} selfId={snapshot.selfId} open={chatOpen} onClose={closeChat} onSend={sendChat} onReport={reportChat} readOnly={snapshot.selfRole === 'spectator' && (snapshot.room.ranked || snapshot.room.mode === 'tournament')} />
      </div>
      <button className="mobile-chat-button" onClick={openChat}><MessageCircle />{unreadCount > 0 && <span>{unreadCount > 99 ? '99+' : unreadCount}</span>}</button>
      {buyInRequest && snapshot.selfWallet && snapshot.room.minBuyInBb !== null && snapshot.room.maxBuyInBb !== null && <BuyInDialog title={buyInRequest.type === 'seat' ? '选择入座买入' : '重新买入'} minBb={snapshot.room.minBuyInBb} maxBb={snapshot.room.maxBuyInBb} bigBlind={snapshot.room.bigBlind} wallet={snapshot.selfWallet} onClose={() => setBuyInRequest(null)} onConfirm={confirmBuyIn} />}
      {snapshot.room.inviteCode && <RoomShareDialog open={shareOpen} roomName={snapshot.room.name} inviteCode={snapshot.room.inviteCode} onClose={() => setShareOpen(false)} onNotice={notify} />}
      {confirmElement}
    </div>
  );
}
