import type { ChatMessage, GameSnapshot } from '@poker/contracts';
import { create } from 'zustand';

interface GameStore {
  snapshot: GameSnapshot | null;
  messages: ChatMessage[];
  connected: boolean;
  error: string | null;
  setSnapshot: (snapshot: GameSnapshot) => void;
  setMessages: (messages: ChatMessage[]) => void;
  addMessage: (message: ChatMessage) => void;
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set) => ({
  snapshot: null,
  messages: [],
  connected: false,
  error: null,
  setSnapshot: (snapshot) => set({ snapshot }),
  setMessages: (messages) => set({ messages }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message].slice(-50) })),
  setConnected: (connected) => set({ connected }),
  setError: (error) => set({ error }),
  reset: () => set({ snapshot: null, messages: [], connected: false, error: null }),
}));
