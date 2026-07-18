import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { useAuth } from './context/AuthContext';
import { AccountPage } from './pages/AccountPage';
import { AdminPage } from './pages/AdminPage';
import { AuthPage } from './pages/AuthPage';
import { HistoryPage } from './pages/HistoryPage';
import { InvitePage } from './pages/InvitePage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { LobbyPage } from './pages/LobbyPage';
import { RoomPage } from './pages/RoomPage';
import { SettingsPage } from './pages/SettingsPage';

function Protected() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="full-loader"><span className="chip-loader">♠</span></div>;
  if (!user) return <Navigate to="/" replace />;
  if (user.mustChangePassword && location.pathname !== '/account') return <Navigate to="/account" replace />;
  return <Outlet />;
}

function AdminOnly() {
  const { user } = useAuth();
  return user?.isAdmin ? <Outlet /> : <Navigate to="/lobby" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<AuthPage />} />
      <Route path="/invite/:code" element={<InvitePage />} />
      <Route element={<Protected />}>
        <Route path="/room/:roomId" element={<RoomPage />} />
        <Route element={<Shell />}>
          <Route path="/lobby" element={<LobbyPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/account" element={<AccountPage />} />
          <Route element={<AdminOnly />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
