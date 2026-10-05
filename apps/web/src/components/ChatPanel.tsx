import type { ChatMessage } from '@poker/contracts';
import { Flag, Send, UserX, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { readSettings } from '../lib/settings';

export function ChatPanel({
  messages,
  selfId,
  open,
  onClose,
  onSend,
  onReport,
  muted,
  onMute,
  readOnly = false,
}: {
  messages: ChatMessage[];
  selfId: string;
  open: boolean;
  onClose: () => void;
  onSend: (text: string) => void;
  onReport: (messageId: string) => void;
  /** 本地屏蔽的玩家；牌桌上同样隐藏他们的表情 */
  muted: ReadonlySet<string>;
  onMute: (senderId: string) => void;
  readOnly?: boolean;
}) {
  const [text, setText] = useState('');
  const end = useRef<HTMLDivElement>(null);
  const visible = messages.filter((message) => message.system || !muted.has(message.senderId));
  useEffect(() => {
    // 用块语句体，不能把 scrollIntoView 的返回值交给 React：新版浏览器会返回 Promise，被当成清理函数调用而崩溃。
    end.current?.scrollIntoView({ behavior: readSettings().reducedMotion ? 'auto' : 'smooth' });
  }, [visible.length, open]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <aside className={`chat-panel ${open ? 'open' : ''}`} aria-label="牌桌聊天">
      <header>
        <div><strong>牌桌聊天</strong><small>{messages.length} 条近期消息</small></div>
        <button className="icon-button chat-close" onClick={onClose} aria-label="关闭聊天"><X size={18} /></button>
      </header>
      <div className="chat-messages" aria-live="polite">
        {visible.length === 0 && <p className="empty-chat">还没有消息，打个招呼吧。</p>}
        {visible.map((message) => (
          <div key={message.id} className={`chat-message ${message.system ? 'system' : ''} ${message.senderId === selfId ? 'mine' : ''}`}>
            {!message.system && <strong>{message.senderName}</strong>}
            <p>{message.text}</p>
            {!message.system && message.senderId !== selfId && (
              <span className="message-tools">
                <button onClick={() => onMute(message.senderId)} title="屏蔽该玩家"><UserX size={12} /> 屏蔽</button>
                <button onClick={() => onReport(message.id)} title="举报消息"><Flag size={12} /> 举报</button>
              </span>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
      {readOnly ? <p className="chat-readonly">该模式下观众只能查看聊天</p> : <form className="chat-form" onSubmit={submit}>
        <input value={text} onChange={(event) => setText(event.target.value)} maxLength={200} placeholder="输入消息…" aria-label="聊天消息" />
        <button className="icon-button" disabled={!text.trim()} aria-label="发送"><Send size={18} /></button>
      </form>}
    </aside>
  );
}
