import { History, LogOut, Settings, Shield, Spade, Trophy } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './Avatar';
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
        <LatencyBadge connected />
        <div className="account-chip">
          {user && <Avatar src={user.avatarUrl} name={user.displayName} />}
          <NavLink to="/account">{user?.displayName}</NavLink>
          <button className="icon-button" aria-label="退出登录" onClick={() => void logout()}>
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
    </div>
  );
}
