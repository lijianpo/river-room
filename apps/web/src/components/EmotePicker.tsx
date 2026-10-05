import type { EmoteId } from '@poker/contracts';
import { Smile, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { EMOTES, QUICK_PHRASES } from '../lib/emotes';

/** 牌桌表情与快捷语选择面板，挂在牌桌左下角信息行里。 */
export function EmotePicker({ onEmote, onPhrase }: { onEmote: (emote: EmoteId) => void; onPhrase: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return (
    <div className={`emote-picker ${open ? 'open' : ''}`}>
      <button className="emote-toggle" aria-expanded={open} aria-controls="emote-panel" aria-label="表情与快捷语" onClick={() => setOpen((value) => !value)}>
        <Smile size={15} />
      </button>
      {open && (
        <section id="emote-panel" className="emote-panel" aria-label="表情与快捷语">
          <header><strong>表情 · 快捷语</strong><button className="icon-button" aria-label="收起表情面板" onClick={() => setOpen(false)}><X size={16} /></button></header>
          <div className="emote-grid">
            {EMOTES.map((emote) => (
              <button key={emote.id} aria-label={emote.label} title={emote.label} onClick={() => { onEmote(emote.id); setOpen(false); }}>{emote.emoji}</button>
            ))}
          </div>
          <div className="quick-phrases">
            {QUICK_PHRASES.map((phrase) => <button key={phrase} onClick={() => { onPhrase(phrase); setOpen(false); }}>{phrase}</button>)}
          </div>
        </section>
      )}
    </div>
  );
}
