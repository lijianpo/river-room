import type { Ack } from '@poker/contracts';
import { History, LogOut, Settings, Shield, Spade, Trophy } from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { socket } from '../lib/socket';
import { Avatar } from './Avatar';
import { useConfirm } from './ConfirmDialog';
import { LatencyBadge } from './LatencyBadge';
import { WalletSummary } from './WalletSummary';

const links = [
  { to: '/lobby', label: '牌局大厅', icon: Spade },
  { to: '/leaderboard', label: '排行榜', icon: Trophy },
  { to: '/history', label: '牌谱', icon: History },
  { to: '/settings', label: '设置', icon: Settings },
];

export function Shell() {
  const { user, currentRoom, wallet, logout } = useAuth();
  const visibleLinks = user?.isAdmin ? [...links, { to: '/admin', label: '运营后台', icon: Shield }] : links;
  const [confirmElement, confirm] = useConfirm();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  // 服务端要求先离开房间才能退出登录，这里先征得确认并代为离开，失败时把原因显示出来。
  const handleLogout = async () => {
    if (loggingOut) return;
    setLogoutError(null);
    if (currentRoom) {
      const forfeit = currentRoom.mode === 'tournament' && currentRoom.status === 'playing';
      const confirmed = await confirm({
        title: '退出登录',
        message: `你仍在房间「${currentRoom.name}」中，需要先离开房间才能退出登录。${forfeit ? '锦标赛进行中离开将视为弃赛。' : ''}`,
        confirmLabel: '离开房间并退出',
        danger: true,
      });
      if (!confirmed) return;
    }
    setLoggingOut(true);
    try {
      if (currentRoom) {
        const roomId = currentRoom.id;
        const ack = await new Promise<Ack>((resolve) => {
          const timer = window.setTimeout(() => resolve({ ok: false, error: '离开房间超时，请检查网络后重试' }), 8_000);
          socket.emit('room:leave', { roomId }, (result) => {
            window.clearTimeout(timer);
            resolve(result);
          });
        });
        if (!ack.ok) throw new Error(ack.error ?? '离开房间失败');
      }
      await logout();
    } catch (reason) {
      setLogoutError(reason instanceof Error ? reason.message : '退出登录失败');
    } finally {
      setLoggingOut(false);
    }
  };
  return (
    <div className="app-shell">
      <header className="topbar">
        <NavLink className="brand" to="/lobby" aria-label="River Room 首页">
          <span className="brand-mark">♠</span>
          <span>
            <strong>RIVER ROOM</strong>
            <small>德州牌室</small>
          </span>
        </NavLink>
        <nav className="desktop-nav" aria-label="主导航">
          {visibleLinks.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <WalletSummary wallet={wallet} compact />
        <LatencyBadge />
        <div className="account-chip">
          {user && <Avatar src={user.avatarUrl} name={user.displayName} />}
          <NavLink to="/account">{user?.displayName}</NavLink>
          <button className="icon-button" aria-label="退出登录" disabled={loggingOut} onClick={() => void handleLogout()}>
            <LogOut size={16} />
          </button>
        </div>
      </header>
      {currentRoom && (
        <NavLink className="return-room" to={`/room/${currentRoom.id}`}>
          <span className="live-dot" /> 返回正在进行的房间：{currentRoom.name}
        </NavLink>
      )}
      <main className="page-content">
        {logoutError && <div className="alert error" role="alert">{logoutError}<button aria-label="关闭提示" onClick={() => setLogoutError(null)}>×</button></div>}
        <Outlet />
      </main>
      <nav className="mobile-nav" aria-label="移动端主导航">
        {visibleLinks.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? 'active' : '')}>
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      {confirmElement}
    </div>
  );
}
