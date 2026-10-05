import type { GameSnapshot, PlayerSnapshot, TableEmote } from '@poker/contracts';
import { Bot, Coins, Crown, WifiOff, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { emoteOf } from '../lib/emotes';
import { betPlacement, seatPosition } from '../lib/table-layout';
import { useTurnClock } from '../lib/turn-clock';
import { PlayingCard } from './PlayingCard';
import { Avatar } from './Avatar';
import { ShowdownOverlay } from './ShowdownOverlay';

function SeatView({
  player,
  isSelf,
  position,
  deadline,
  isHost,
  canManage,
  showBet,
  emote,
  onRemove,
  onShowProfile,
}: {
  player: PlayerSnapshot;
  isSelf: boolean;
  position: [number, number];
  deadline: number | null;
  isHost: boolean;
  canManage: boolean;
  showBet: boolean;
  emote?: TableEmote | undefined;
  onRemove: (player: PlayerSnapshot) => void;
  onShowProfile?: ((player: PlayerSnapshot) => void) | undefined;
}) {
  const clock = useTurnClock(player.isActing ? deadline : null);
  return (
    <div
      className={`table-seat ${isSelf ? 'self' : ''} ${player.isActing ? 'acting' : ''} ${player.folded ? 'folded' : ''} ${player.sittingOut ? 'sitting-out' : ''}`}
      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
    >
      <div className={`seat-cards ${isSelf ? 'self-hole-cards' : ''}`} aria-label={isSelf ? '自己的底牌' : undefined}>
        {player.holeCards.map((card, index) => <PlayingCard key={`${index}-${card.rank}${card.suit}`} card={card} small={!isSelf} />)}
      </div>
      <div className="seat-panel">
        <span className="avatar">
          {player.isBot ? <Bot size={16} /> : onShowProfile && !isSelf && player.userId ? (
            <button className="seat-avatar-button" aria-label={`查看 ${player.name} 的资料`} onClick={() => onShowProfile(player)}><Avatar src={player.avatarUrl} name={player.name} /></button>
          ) : <Avatar src={player.avatarUrl} name={player.name} />}
        </span>
        <span className="seat-info">
          <strong>{player.name}</strong>
          <small className={isSelf && player.buyInChips !== null ? 'self-stack' : ''}>{isSelf && player.buyInChips !== null && <span>剩余 </span>}<b>{player.stack.toLocaleString()}</b></small>
        </span>
        {isHost && <Crown className="host-crown" size={13} />}
        {!player.connected && !player.isBot && <WifiOff className="offline" size={13} />}
        {canManage && (
          <button className="seat-remove" aria-label={player.isBot ? '移除 AI' : '移出玩家'} onClick={() => onRemove(player)}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="seat-badges">
        {player.isDealer && <span>D</span>}
        {player.isSmallBlind && <span>SB</span>}
        {player.isBigBlind && <span>BB</span>}
        {player.allIn && <span className="danger">ALL IN</span>}
        {player.placement && <span>#{player.placement}</span>}
        {player.leavingAfterHand && <span>离座中</span>}
        {player.sittingOut && !player.leavingAfterHand && <span>暂离</span>}
      </div>
      {player.isActing && <div className={`turn-timer ${player.usingTimeBank ? 'time-bank' : clock.remaining <= 5_000 ? 'urgent' : ''}`} title={player.usingTimeBank ? '正在使用时间银行' : undefined} style={{ '--turn-progress': `${clock.progress * 100}%` } as React.CSSProperties} aria-label={`剩余 ${Math.ceil(clock.remaining / 1000)} 秒`}>{Math.ceil(clock.remaining / 1000)}</div>}
      {emote && <span key={emote.id} className="seat-emote" role="img" aria-label={`${player.name}：${emoteOf(emote.emote).label}`}>{emoteOf(emote.emote).emoji}</span>}
      {showBet && player.committed > 0 && <span className={`seat-bet ${betPlacement(position)}`} title="本手已下注"><Coins size={12} aria-hidden="true" />{player.committed.toLocaleString()}</span>}
    </div>
  );
}

export function PokerTable({
  snapshot,
  onManagePlayer,
  onTakeSeat,
  emotes,
  onShowProfile,
  children,
}: {
  snapshot: GameSnapshot;
  onManagePlayer: (player: PlayerSnapshot) => void;
  onTakeSeat: (seat: number) => void;
  /** 各玩家最近一次表情，按玩家 id 索引 */
  emotes?: Record<string, TableEmote>;
  /** 点击注册玩家头像时打开资料卡 */
  onShowProfile?: (player: PlayerSnapshot) => void;
  /** 追加在牌桌左下角信息行末尾的内容（如本手记录） */
  children?: ReactNode;
}) {
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const maxSeats = snapshot.room.maxSeats;
  const positionOf = (seatNumber: number) => seatPosition(seatNumber, maxSeats, self?.seat ?? null);
  const handSettled = snapshot.phase === 'complete' || snapshot.phase === 'showdown';
  const showdown = snapshot.showdown && snapshot.showdown.displayUntil > Date.now() ? snapshot.showdown : null;
  return (
    <section className="poker-stage" aria-label="德州牌桌">
      <div className="felt-table">
        <div className="table-logo">
          <span>RIVER</span>
          <strong>ROOM</strong>
        </div>
        <div className="community-cards" aria-label="公共牌">
          {Array.from({ length: 5 }, (_, index) => {
            const card = snapshot.board[index];
            return card ? <PlayingCard key={`${snapshot.handId}-${index}`} card={card} /> : <span key={index} className="card-slot" />;
          })}
        </div>
        <div className="pot-display">底池 <strong>{snapshot.pot.toLocaleString()}</strong></div>
        {snapshot.resultMessage && <div className="result-banner" title={snapshot.resultMessage}>{snapshot.resultMessage}</div>}
      </div>
      {Array.from({ length: maxSeats }, (_, seatNumber) => {
        const player = snapshot.players.find((candidate) => candidate.seat === seatNumber);
        const position = positionOf(seatNumber);
        if (!player) {
          const canTakeSeat = snapshot.selfRole === 'spectator' && snapshot.openSeats.includes(seatNumber) && snapshot.room.status !== 'finished' && (snapshot.room.mode === 'cash' || snapshot.phase === 'waiting' || snapshot.phase === 'countdown');
          return <button key={`empty-${seatNumber}`} className="empty-table-seat" style={{ left: `${position[0]}%`, top: `${position[1]}%` }} disabled={!canTakeSeat} onClick={() => onTakeSeat(seatNumber)}><span>+</span><strong>{canTakeSeat ? '点击入座' : '空座'}</strong><small>{seatNumber + 1} 号位</small></button>;
        }
        const canManage = snapshot.room.hostId === snapshot.selfId && player.id !== snapshot.selfId && (snapshot.phase === 'waiting' || snapshot.phase === 'countdown' || snapshot.phase === 'complete' || snapshot.phase === 'showdown');
        return (
          <SeatView
            key={player.id}
            player={player}
            isSelf={player.id === snapshot.selfId}
            position={position}
            deadline={snapshot.actionDeadline}
            isHost={player.id === snapshot.room.hostId}
            canManage={canManage}
            showBet={!handSettled}
            emote={emotes?.[player.id]}
            onRemove={onManagePlayer}
            onShowProfile={onShowProfile}
          />
        );
      })}
      {showdown && (
        <div key={showdown.handId} className="chip-flights" aria-hidden="true">
          {showdown.winners.map((winner) => {
            const seat = snapshot.players.find((player) => player.id === winner.playerId)?.seat;
            if (seat === undefined) return null;
            const [x, y] = positionOf(seat);
            return [0, 1, 2].map((index) => <span key={`${winner.playerId}-${index}`} className="chip-flight" style={{ '--to-x': `${x}%`, '--to-y': `${y}%`, animationDelay: `${index * 90}ms` } as React.CSSProperties} />);
          })}
        </div>
      )}
      <ShowdownOverlay result={snapshot.showdown} />
      <div className="table-meta">
        <span>第 {snapshot.handNumber || '—'} 手</span>
        <span>{snapshot.room.mode === 'cash' ? '常规桌' : `锦标赛 L${snapshot.tournamentLevel ?? 1}`}</span>
        <span>{snapshot.room.smallBlind}/{snapshot.room.bigBlind}</span>
        {children}
      </div>
    </section>
  );
}
