import type { ChatMessage } from '@poker/contracts';
import { describe, expect, it } from 'vitest';
import { shouldIncrementChatUnread } from './chat-unread';

const message = (senderId: string, system = false): ChatMessage => ({
  id: `${senderId}-${system}`,
  senderId,
  senderName: senderId,
  text: 'hello',
  createdAt: 1,
  ...(system ? { system: true } : {}),
});

describe('聊天未读计数', () => {
  it('仅在移动端聊天关闭时统计他人消息', () => {
    expect(shouldIncrementChatUnread({ message: message('other'), selfId: 'self', chatOpen: false, mobile: true })).toBe(true);
    expect(shouldIncrementChatUnread({ message: message('other'), selfId: 'self', chatOpen: true, mobile: true })).toBe(false);
    expect(shouldIncrementChatUnread({ message: message('other'), selfId: 'self', chatOpen: false, mobile: false })).toBe(false);
  });

  it('不统计自己或系统发送的消息', () => {
    expect(shouldIncrementChatUnread({ message: message('self'), selfId: 'self', chatOpen: false, mobile: true })).toBe(false);
    expect(shouldIncrementChatUnread({ message: message('system', true), selfId: 'self', chatOpen: false, mobile: true })).toBe(false);
  });
});
