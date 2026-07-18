import type { ShowdownResultView } from '@poker/contracts';
import { Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PlayingCard } from './PlayingCard';

export function ShowdownOverlay({ result }: { result: ShowdownResultView | null }) {
  const [visible, setVisible] = useState(() => Boolean(result && result.displayUntil > Date.now()));
  useEffect(() => {
    if (!result) {
      setVisible(false);
      return;
    }
    const remaining = result.displayUntil - Date.now();
    setVisible(remaining > 0);
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => setVisible(false), remaining);
    return () => window.clearTimeout(timer);
  }, [result]);
  if (!result || !visible) return null;
  return (
    <section className="showdown-overlay" role="status" aria-live="assertive">
      <header><Trophy /><div><span>本手赢家</span><strong>{result.resultText}</strong></div></header>
      <div className="showdown-winners">
        {result.winners.map((winner) => (
          <article key={winner.playerId}>
            <div className="winner-copy"><strong>{winner.name}</strong><b>+{winner.amount.toLocaleString()}</b></div>
            {winner.revealed ? (
              <div className="winner-hand">
                <div>{winner.holeCards.map((card, index) => <PlayingCard key={index} card={card} small />)}</div>
                <span>{winner.handName ?? winner.reason}</span>
              </div>
            ) : <span className="winner-reason">其他玩家弃牌 · 底牌未公开</span>}
          </article>
        ))}
      </div>
    </section>
  );
}
