import type { GameEventView } from '@poker/contracts';
import { ScrollText, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/** 本手行动记录：收起时显示最新一条，展开后可回看本手全部行动。 */
export function HandLog({ events, handNumber }: { events: GameEventView[]; handNumber: number }) {
  const [open, setOpen] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const latest = events[events.length - 1];
  useEffect(() => {
    // 只滚动列表自身；scrollIntoView 会连带滚动牌桌外层的 overflow 容器。
    if (open && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [open, events.length]);
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);
  return (
    <div className={`hand-log ${open ? 'open' : ''}`}>
      <button className="hand-log-toggle" aria-expanded={open} aria-controls="hand-log-panel" aria-label={`本手记录，共 ${events.length} 条`} onClick={() => setOpen((value) => !value)}>
        <ScrollText size={15} />
        <span className="hand-log-latest">{latest?.message ?? '本手暂无行动'}</span>
        {events.length > 0 && <b>{events.length}</b>}
      </button>
      {open && (
        <section id="hand-log-panel" className="hand-log-panel" aria-label="本手记录">
          <header><strong>第 {handNumber || '—'} 手 · 行动记录</strong><button className="icon-button" aria-label="收起本手记录" onClick={() => setOpen(false)}><X size={16} /></button></header>
          {events.length === 0 ? <p className="hand-log-empty">本手还没有玩家行动。</p> : (
            <ol ref={list}>
              {events.map((event) => <li key={event.id}><time>{new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })}</time><span>{event.message}</span></li>)}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}
