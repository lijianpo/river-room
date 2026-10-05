import type { ChatMessage, GameSnapshot } from '@poker/contracts';
import { create } from 'zustand';

export type NoticeKind = 'error' | 'success';

export interface Notice {
  id: number;
  kind: NoticeKind;
  message: string;
}

let noticeId = 0;

interface GameStore {
  snapshot: GameSnapshot | null;
  messages: ChatMessage[];
  connected: boolean;
  /** 牌桌顶部提示：错误或成功反馈 */
  notice: Notice | null;
  setSnapshot: (snapshot: GameSnapshot) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setConnected: (connected: boolean) => void;
  notify: (message: string, kind?: NoticeKind) => void;
  dismissNotice: () => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  snapshot: null,
  messages: [],
  connected: false,
  notice: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message].slice(-50) })),
  setConnected: (connected) => set({ connected }),
  notify: (message, kind = 'error') => set({ notice: { id: ++noticeId, kind, message } }),
  dismissNotice: () => set({ notice: null }),
  reset: () => set({ snapshot: null, messages: [], connected: false, notice: null }),
}));
