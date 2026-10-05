import { useQuery } from '@tanstack/react-query';
import { Camera, Crown, Gift, KeyRound, Save, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AuthPanel } from '../components/AuthPanel';
import { Avatar } from '../components/Avatar';
import { WalletSummary } from '../components/WalletSummary';
import { useAuth } from '../context/AuthContext';
import { api, patch, post } from '../lib/api';
import { isSafeInviteReturnTo } from '../lib/invite';

interface PresetAvatar { id: string; label: string; symbol: string; color: string }

export function AccountPage() {
  const { user, currentRoom, wallet, refresh, claimDailyBonus } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = searchParams.get('returnTo');
  const meta = useQuery({ queryKey: ['meta'], queryFn: () => api<{ presetAvatars: PresetAvatar[] }>('/api/meta'), enabled: !user?.isGuest });
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [presetAvatar, setPresetAvatar] = useState<string | undefined>(() => user?.avatarUrl.includes('/preset/') ? user.avatarUrl.split('/').pop() : undefined);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [walletMessage, setWalletMessage] = useState<string | null>(null);
  useEffect(() => { if (user) setDisplayName(user.displayName); }, [user]);

  if (user?.isGuest) return <div className="narrow-page"><header className="page-heading"><span className="eyebrow">PLAYER PROFILE</span><h1>玩家账号</h1><p>升级后可使用头像、排位和牌谱功能。</p></header><AuthPanel upgrade /><div className="guest-tip"><UserRound /><div><strong>当前为游客身份</strong><p>升级账号前需要先离开正在进行或观战的房间。</p></div></div></div>;
  if (!user) return null;

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProfileMessage(null);
    try {
      await patch('/api/account/profile', { displayName, ...(presetAvatar ? { presetAvatar } : {}) });
      await refresh();
      setProfileMessage('个人资料已保存');
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : '保存失败');
    } finally { setBusy(false); }
  };
  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setProfileMessage(null);
    try {
      const form = new FormData();
      form.append('avatar', file);
      await api('/api/account/avatar', { method: 'POST', body: form });
      setPresetAvatar(undefined);
      await refresh();
      setProfileMessage('头像已更新');
    } catch (error) {
      setProfileMessage(error instanceof Error ? error.message : '上传失败');
    } finally { setBusy(false); }
  };
  const changePassword = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) return setPasswordMessage('两次输入的新密码不一致');
    setBusy(true);
    try {
      const resumeInvite = user.mustChangePassword && isSafeInviteReturnTo(returnTo) ? returnTo : null;
      await post('/api/account/password', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      await refresh();
      setPasswordMessage('密码已修改，其他设备的会话已退出');
      if (resumeInvite) navigate(resumeInvite, { replace: true });
    } catch (error) {
      setPasswordMessage(error instanceof Error ? error.message : '修改失败');
    } finally { setBusy(false); }
  };

  return (
    <div className="account-page">
      <header className="page-heading"><span className="eyebrow">PLAYER PROFILE</span><h1>玩家账号</h1><p>管理公开昵称、头像和登录安全。</p></header>
      {user.mustChangePassword && <div className="forced-password-banner"><ShieldAlert /><div><strong>临时密码必须更换</strong><p>修改完成前不能进入大厅或连接牌桌。</p></div></div>}
      {wallet && <section className="account-wallet-card"><div><span className="eyebrow">CHIP WALLET</span><h2>我的筹码</h2><p>{walletMessage ?? '排位常规桌买入使用，离座后自动兑回。'}</p></div><WalletSummary wallet={wallet} /><button className="secondary-button" disabled={!wallet.dailyBonusAvailable || busy} onClick={() => { setBusy(true); setWalletMessage(null); void claimDailyBonus().then((amount) => setWalletMessage(`每日奖励 +${amount.toLocaleString()} 已到账`)).catch((error: unknown) => setWalletMessage(error instanceof Error ? error.message : '领取失败')).finally(() => setBusy(false)); }}><Gift />{wallet.dailyBonusAvailable ? `领取 ${wallet.dailyBonusAmount.toLocaleString()}` : '今日已领取'}</button></section>}
      <div className="account-grid">
        <section className="account-card profile-editor">
          <header><Avatar src={user.avatarUrl} name={user.displayName} className="profile-photo" /><div><span className="verified"><ShieldCheck /> 正式账号</span><h2>{user.displayName}</h2><p>{user.email}</p></div></header>
          <form onSubmit={(event) => void saveProfile(event)}>
            <label>公开昵称<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={16} disabled={Boolean(currentRoom)} required /></label>
            <fieldset disabled={Boolean(currentRoom)}><legend>选择预设头像</legend><div className="avatar-picker">{meta.data?.presetAvatars.map((avatar) => <button type="button" key={avatar.id} title={avatar.label} className={presetAvatar === avatar.id ? 'selected' : ''} style={{ background: avatar.color }} onClick={() => setPresetAvatar(avatar.id)}>{avatar.symbol}</button>)}</div></fieldset>
            <label className="avatar-upload"><Camera />上传自定义头像<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(currentRoom) || busy} onChange={(event) => void uploadAvatar(event.target.files?.[0])} /><small>JPEG、PNG、WebP，最大 2MB</small></label>
            {currentRoom && <p className="form-hint">请先离开当前房间再修改个人资料。</p>}
            {profileMessage && <p className="form-message">{profileMessage}</p>}
            <button className="primary-button" disabled={busy || Boolean(currentRoom)}><Save />保存资料</button>
          </form>
        </section>

        <section className={`account-card password-editor ${user.mustChangePassword ? 'required' : ''}`}>
          <header><span className="account-icon"><KeyRound /></span><div><h2>{user.mustChangePassword ? '设置新密码' : '修改密码'}</h2><p>修改后其他设备会自动退出。</p></div></header>
          <form onSubmit={(event) => void changePassword(event)}>
            <label>当前密码<input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
            <label>新密码<input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
            <label>确认新密码<input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={8} maxLength={72} autoComplete="new-password" required /></label>
            {passwordMessage && <p className="form-message">{passwordMessage}</p>}
            <button className="primary-button" disabled={busy || Boolean(currentRoom && !user.mustChangePassword)}><KeyRound />更新密码</button>
          </form>
          <dl><div><dt>身份</dt><dd><Crown size={15} /> 注册玩家</dd></div><div><dt>排位资格</dt><dd>已解锁</dd></div></dl>
        </section>
      </div>
    </div>
  );
}
