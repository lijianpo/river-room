import type { AuthUser, PublicRoomSummary, WalletView } from '@poker/contracts';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, post } from '../lib/api';
import { socket } from '../lib/socket';

interface AuthContextValue {
  user: AuthUser | null;
  currentRoom: PublicRoomSummary | null;
  wallet: WalletView | null;
  loading: boolean;
  latencyMs: number | null;
  latencyTimedOut: boolean;
  refresh: () => Promise<void>;
  enterAsGuest: (displayName: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  logout: () => Promise<void>;
  claimDailyBonus: () => Promise<number>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [currentRoom, setCurrentRoom] = useState<PublicRoomSummary | null>(null);
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [loading, setLoading] = useState(true);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [latencyTimedOut, setLatencyTimedOut] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const result = await api<{ user: AuthUser; wallet: WalletView | null; currentRoom: PublicRoomSummary | null }>('/api/auth/me');
      setUser(result.user);
      setWallet(result.wallet);
      setCurrentRoom(result.currentRoom);
    } catch {
      setUser(null);
      setWallet(null);
      setCurrentRoom(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => {
    const updateWallet = (next: WalletView) => setWallet(next);
    socket.on('wallet:updated', updateWallet);
    return () => { socket.off('wallet:updated', updateWallet); };
  }, []);
  useEffect(() => {
    if (user && !user.mustChangePassword) {
      if (!socket.connected) socket.connect();
    } else if (socket.connected) socket.disconnect();
  }, [user]);

  useEffect(() => {
    if (!user || user.mustChangePassword) {
      setLatencyMs(null);
      setLatencyTimedOut(false);
      return;
    }
    let timeout: number | null = null;
    let pending = false;
    let activeNonce: string | null = null;
    const measure = () => {
      if (!socket.connected || pending) return;
      pending = true;
      const nonce = `${Date.now()}-${Math.random()}`;
      activeNonce = nonce;
      const started = performance.now();
      timeout = window.setTimeout(() => {
        if (activeNonce !== nonce) return;
        pending = false;
        activeNonce = null;
        timeout = null;
        setLatencyMs(null);
        setLatencyTimedOut(true);
      }, 4_000);
      socket.emit('connection:ping', { nonce }, (ack) => {
        if (ack.nonce !== nonce || activeNonce !== nonce) return;
        pending = false;
        activeNonce = null;
        if (timeout !== null) window.clearTimeout(timeout);
        timeout = null;
        setLatencyMs(Math.max(0, Math.round(performance.now() - started)));
        setLatencyTimedOut(false);
      });
    };
    const onConnect = () => measure();
    const onDisconnect = () => {
      pending = false;
      activeNonce = null;
      if (timeout !== null) window.clearTimeout(timeout);
      timeout = null;
      setLatencyMs(null);
      setLatencyTimedOut(false);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    if (socket.connected) measure();
    const interval = window.setInterval(measure, 5_000);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      window.clearInterval(interval);
      if (timeout !== null) window.clearTimeout(timeout);
    };
  }, [user]);

  const enterAsGuest = async (displayName: string) => {
    await post('/api/auth/guest', { displayName });
    await refresh();
  };
  const login = async (email: string, password: string) => {
    await post('/api/auth/login', { email, password });
    await refresh();
  };
  const register = async (email: string, password: string, displayName: string) => {
    await post('/api/auth/register', { email, password, displayName });
    await refresh();
  };
  const logout = async () => {
    await post('/api/auth/logout');
    setUser(null);
    setCurrentRoom(null);
    setWallet(null);
  };
  const claimDailyBonus = async () => {
    const result = await post<{ wallet: WalletView; awarded: number }>('/api/account/daily-bonus');
    setWallet(result.wallet);
    return result.awarded;
  };

  const value = useMemo(
    () => ({ user, currentRoom, wallet, loading, latencyMs, latencyTimedOut, refresh, enterAsGuest, login, register, logout, claimDailyBonus }),
    [user, currentRoom, wallet, loading, latencyMs, latencyTimedOut, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider 未挂载');
  return value;
}
