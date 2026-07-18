import type { ChatMessage } from '@poker/contracts';

export function shouldIncrementChatUnread(input: {
  message: ChatMessage;
  selfId: string | null;
  chatOpen: boolean;
  mobile: boolean;
}): boolean {
  return input.mobile && !input.chatOpen && !input.message.system && input.message.senderId !== input.selfId;
}
