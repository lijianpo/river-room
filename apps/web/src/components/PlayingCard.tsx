import type { CardView } from '@poker/contracts';

const suitMap: Record<string, { symbol: string; name: string }> = {
  s: { symbol: '♠', name: '黑桃' },
  h: { symbol: '♥', name: '红桃' },
  d: { symbol: '♦', name: '方片' },
  c: { symbol: '♣', name: '梅花' },
};

export function PlayingCard({ card, small = false }: { card: CardView; small?: boolean }) {
  if (card.hidden) return <span className={`playing-card card-back ${small ? 'small' : ''}`} aria-label="暗牌"><span>♠</span></span>;
  const suit = suitMap[card.suit] ?? { symbol: '?', name: '未知花色' };
  const rank = card.rank === 'T' ? '10' : card.rank;
  const red = card.suit === 'h' || card.suit === 'd';
  return (
    <span className={`playing-card ${red ? 'red' : ''} ${small ? 'small' : ''}`} aria-label={`${suit.name}${rank}`}>
      <strong className="card-rank">{rank}</strong>
      <span className="card-suit">{suit.symbol}</span>
    </span>
  );
}
