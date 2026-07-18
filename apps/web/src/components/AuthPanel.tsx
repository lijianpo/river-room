import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type AuthMode = 'guest' | 'login' | 'register';

export function AuthPanel({
  upgrade = false,
  allowGuest = !upgrade,
  guestActionLabel = '立即入座',
}: {
  upgrade?: boolean;
  allowGuest?: boolean;
  guestActionLabel?: string;
}) {
  const { user, enterAsGuest, login, register } = useAuth();
  const guestEnabled = !upgrade && allowGuest;
  const [mode, setMode] = useState<AuthMode>(upgrade ? 'register' : guestEnabled ? 'guest' : 'login');
  const [displayName, setDisplayName] = useState(user?.displayName ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'guest') await enterAsGuest(displayName);
      else if (mode === 'login') await login(email, password);
      else await register(email, password, displayName);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '操作失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="auth-card">
      <div className={`auth-tabs ${guestEnabled ? '' : 'two'}`} role="tablist" aria-label="进入方式">
        {guestEnabled && <button className={mode === 'guest' ? 'active' : ''} onClick={() => setMode('guest')}>游客</button>}
        <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>登录</button>
        <button className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>{upgrade ? '升级账号' : '注册'}</button>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        {mode !== 'login' && (
          <label>
            昵称
            <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={16} placeholder="2–16 个字符" required />
          </label>
        )}
        {mode !== 'guest' && (
          <>
            <label>
              邮箱
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" required />
            </label>
            <label>
              密码
              <span className="password-input">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === 'register' ? 8 : 1} maxLength={72} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />
                <button type="button" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword((value) => !value)}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>
          </>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="primary-button auth-submit" disabled={busy}>
          {busy ? '请稍候…' : mode === 'guest' ? guestActionLabel : mode === 'login' ? '登录牌室' : '创建账号'}
        </button>
      </form>
      <div className="auth-notes">
        <span><ShieldCheck size={15} /> 仅娱乐积分，不涉及真实资金</span>
        {guestEnabled && <span><Sparkles size={15} /> 游客可随时升级并保留昵称</span>}
      </div>
    </section>
  );
}
