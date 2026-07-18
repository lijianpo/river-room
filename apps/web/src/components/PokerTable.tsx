import type { GameSnapshot, PlayerSnapshot } from '@poker/contracts';
import { Bot, Crown, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PlayingCard } from './PlayingCard';
import { Avatar } from './Avatar';
import { ShowdownOverlay } from './ShowdownOverlay';

const layouts: Record<number, Array<[number, number]>> = {
  2: [[50, 88], [50, 8]],
  3: [[50, 88], [12, 25], [88, 25]],
  4: [[50, 88], [8, 45], [50, 8], [92, 45]],
  5: [[50, 88], [8, 58], [26, 8], [74, 8], [92, 58]],
  6: [[50, 88], [12, 70], [14, 14], [50, 7], [86, 14], [88, 70]],
  7: [[50, 88], [15, 76], [6, 42], [28, 8], [72, 8], [94, 42], [85, 76]],
  8: [[50, 88], [20, 80], [6, 54], [15, 16], [50, 7], [85, 16], [94, 54], [80, 80]],
  9: [[50, 88], [20, 80], [6, 58], [9, 25], [30, 8], [70, 8], [91, 25], [94, 58], [80, 80]],
};

function useRemaining(deadline: number | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    const update = () => setRemaining(deadline ? Math.max(0, deadline - Date.now()) : 0);
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [deadline]);
  return remaining;
}

function SeatView({
  player,
  isSelf,
  position,
  deadline,
  isHost,
  canManage,
  onRemove,
}: {
  player: PlayerSnapshot;
  isSelf: boolean;
  position: [number, number];
  deadline: number | null;
  isHost: boolean;
  canManage: boolean;
  onRemove: (player: PlayerSnapshot) => void;
}) {
  const remaining = useRemaining(player.isActing ? deadline : null);
  return (
    <div
      className={`table-seat ${isSelf ? 'self' : ''} ${player.isActing ? 'acting' : ''} ${player.folded ? 'folded' : ''}`}
      style={{ left: `${position[0]}%`, top: `${position[1]}%` }}
    >
      <div className={`seat-cards ${isSelf ? 'self-hole-cards' : ''}`} aria-label={isSelf ? '自己的底牌' : undefined}>
        {player.holeCards.map((card, index) => <PlayingCard key={index} card={card} small={!isSelf} />)}
      </div>
      <div className="seat-panel">
        <span className="avatar">{player.isBot ? <Bot size={16} /> : <Avatar src={player.avatarUrl} name={player.name} />}</span>
        <span className="seat-info">
          <strong>{player.name}</strong>
          <small className={isSelf && player.buyInChips !== null ? 'self-stack' : ''}>{isSelf && player.buyInChips !== null && <span>剩余 </span>}<b>{player.stack.toLocaleString()}</b> {player.committed > 0 && <em>+{player.committed}</em>}</small>
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
      </div>
      {player.isActing && <div className="turn-timer" style={{ '--turn-progress': `${Math.min(100, remaining / 200)}%` } as React.CSSProperties}>{Math.ceil(remaining / 1000)}</div>}
    </div>
  );
}

export function PokerTable({ snapshot, onManagePlayer, onTakeSeat }: { snapshot: GameSnapshot; onManagePlayer: (player: PlayerSnapshot) => void; onTakeSeat: (seat: number) => void }) {
  const self = snapshot.players.find((player) => player.id === snapshot.selfId);
  const maxSeats = snapshot.room.maxSeats;
  const positions = layouts[maxSeats] ?? layouts[9]!;
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
            return card ? <PlayingCard key={index} card={card} /> : <span key={index} className="card-slot" />;
          })}
        </div>
        <div className="pot-display">底池 <strong>{snapshot.pot.toLocaleString()}</strong></div>
        {snapshot.resultMessage && <div className="result-banner">{snapshot.resultMessage}</div>}
      </div>
      {Array.from({ length: maxSeats }, (_, seatNumber) => {
        const player = snapshot.players.find((candidate) => candidate.seat === seatNumber);
        const relative = self ? (seatNumber - self.seat + maxSeats) % maxSeats : seatNumber;
        const position = positions[relative] ?? positions[0]!;
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
            onRemove={onManagePlayer}
          />
        );
      })}
      <ShowdownOverlay result={snapshot.showdown} />
      <div className="table-meta">
        <span>第 {snapshot.handNumber || '—'} 手</span>
        <span>{snapshot.room.mode === 'cash' ? '常规桌' : `锦标赛 L${snapshot.tournamentLevel ?? 1}`}</span>
        <span>{snapshot.room.smallBlind}/{snapshot.room.bigBlind}</span>
      </div>
    </section>
  );
}
