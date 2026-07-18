import type { AdminReportView, AdminUserView } from '@poker/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, CheckCircle2, Clipboard, Coins, FileWarning, LogOut, RotateCcw, Search, Settings2, Shield, Users, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Avatar } from '../components/Avatar';
import { api, patch, post } from '../lib/api';
import { copyText } from '../lib/clipboard';

type AdminTab = 'users' | 'reports' | 'settings';
interface PageResult<T> { items: T[]; page: number; pageSize: number; total: number; totalPages: number }
type PasswordCopyStatus = 'idle' | 'copied' | 'error';

export function AdminPage() {
  const client = useQueryClient();
  const [tab, setTab] = useState<AdminTab>('users');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [reportStatus, setReportStatus] = useState('open');
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [passwordCopyStatus, setPasswordCopyStatus] = useState<PasswordCopyStatus>('idle');
  const [notice, setNotice] = useState<string | null>(null);
  const [chipTarget, setChipTarget] = useState<AdminUserView | null>(null);
  const [chipDirection, setChipDirection] = useState<'add' | 'deduct'>('add');
  const [chipAmount, setChipAmount] = useState(2_000);
  const [chipReason, setChipReason] = useState('运营调整');

  const users = useQuery({
    queryKey: ['admin-users', page, search, status],
    queryFn: () => api<PageResult<AdminUserView> & { onlineCount: number; onlineGuests: number }>(`/api/admin/users?page=${page}&pageSize=20&status=${status}&search=${encodeURIComponent(search)}`),
    enabled: tab === 'users',
  });
  const reports = useQuery({
    queryKey: ['admin-reports', page, reportStatus],
    queryFn: () => api<PageResult<AdminReportView>>(`/api/admin/reports?page=${page}&pageSize=20&status=${reportStatus}`),
    enabled: tab === 'reports',
  });
  const settings = useQuery({
    queryKey: ['admin-settings'],
    queryFn: () => api<{ showdownDurationSeconds: number }>('/api/admin/settings'),
    enabled: tab === 'settings',
  });

  const refreshUsers = () => void client.invalidateQueries({ queryKey: ['admin-users'] });
  const runUserAction = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setNotice(success);
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作失败');
    }
  };
  const changeStatus = (user: AdminUserView) => {
    if (user.status === 'active') {
      const reason = window.prompt(`请输入封禁 ${user.displayName} 的原因`, '违反牌室规则');
      if (reason === null) return;
      void runUserAction(() => patch(`/api/admin/users/${user.id}/status`, { status: 'disabled', reason }), '账号已封禁');
    } else {
      void runUserAction(() => patch(`/api/admin/users/${user.id}/status`, { status: 'active' }), '账号已解封');
    }
  };
  const forceLogout = (user: AdminUserView) => {
    if (!window.confirm(`确认强制 ${user.displayName} 下线吗？`)) return;
    void runUserAction(() => post(`/api/admin/users/${user.id}/force-logout`), '用户已下线');
  };
  const resetPassword = async (user: AdminUserView) => {
    if (!window.confirm(`确认重置 ${user.displayName} 的密码吗？所有会话将失效。`)) return;
    try {
      const result = await post<{ temporaryPassword: string }>(`/api/admin/users/${user.id}/reset-password`);
      setTemporaryPassword(result.temporaryPassword);
      setPasswordCopyStatus('idle');
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '重置失败');
    }
  };
  const resolveReport = async (report: AdminReportView, next: 'resolved' | 'dismissed') => {
    const note = window.prompt('处理备注（可留空）', '') ?? undefined;
    await patch(`/api/admin/reports/${report.id}`, { status: next, ...(note ? { note } : {}) });
    void client.invalidateQueries({ queryKey: ['admin-reports'] });
  };
  const adjustChips = async (event: FormEvent) => {
    event.preventDefault();
    if (!chipTarget) return;
    try {
      await post(`/api/admin/users/${chipTarget.id}/chips/adjust`, { direction: chipDirection, amount: chipAmount, reason: chipReason });
      setNotice(`${chipTarget.displayName} 的可用筹码已调整`);
      setChipTarget(null);
      refreshUsers();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '筹码调整失败');
    }
  };
  const copyTemporaryPassword = async () => {
    if (!temporaryPassword) return;
    try {
      await copyText(temporaryPassword);
      setPasswordCopyStatus('copied');
    } catch {
      setPasswordCopyStatus('error');
    }
  };
  const closeTemporaryPassword = () => {
    setTemporaryPassword(null);
    setPasswordCopyStatus('idle');
  };

  return (
    <div className="admin-page">
      <header className="page-heading split"><div><span className="eyebrow">OPERATIONS</span><h1>运营后台</h1><p>管理用户、举报和全局牌桌参数。</p></div><Shield className="heading-icon" /></header>
      <div className="admin-tabs">
        <button className={tab === 'users' ? 'active' : ''} onClick={() => { setTab('users'); setPage(1); }}><Users /> 用户</button>
        <button className={tab === 'reports' ? 'active' : ''} onClick={() => { setTab('reports'); setPage(1); }}><FileWarning /> 举报</button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}><Settings2 /> 设置</button>
      </div>
      {notice && <div className="alert admin-notice">{notice}<button onClick={() => setNotice(null)}>×</button></div>}

      {tab === 'users' && <section className="admin-panel">
        <header className="admin-toolbar">
          <div className="presence-summary"><span><i className="live-dot" />在线 {users.data?.onlineCount ?? 0}</span><span>游客 {users.data?.onlineGuests ?? 0}</span></div>
          <label className="search-input"><Search /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="搜索昵称或邮箱" /></label>
          <select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">全部状态</option><option value="online">在线</option><option value="offline">离线</option><option value="active">正常</option><option value="disabled">已封禁</option></select>
        </header>
        <div className="admin-user-list">
          {users.isLoading ? <p className="loading-line">正在加载用户…</p> : users.data?.items.map((user) => <article key={user.id} className="admin-user-row">
            <Avatar src={user.avatarUrl} name={user.displayName} />
            <div className="admin-user-main"><strong>{user.displayName}</strong><span>{user.email}</span></div>
            <span className={`user-state ${user.online ? 'online' : ''}`}>{user.online ? '在线' : '离线'}</span>
            <span className={`account-state ${user.status}`}>{user.status === 'active' ? '正常' : '已封禁'}</span>
            <div className="admin-user-wallet"><span>可用 {user.availableChips.toLocaleString()}</span><strong>合计 {user.totalChips.toLocaleString()}</strong>{user.tableChips > 0 && <small>桌上 {user.tableChips.toLocaleString()}</small>}</div>
            <div className="admin-user-dates"><span>注册 {new Date(user.createdAt).toLocaleDateString()}</span><span>最后在线 {user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleString() : '—'}</span></div>
            <div className="admin-row-actions">
              <button onClick={() => { setChipTarget(user); setChipDirection('add'); setChipAmount(2_000); setChipReason('运营调整'); }}><Coins />筹码</button>
              <button onClick={() => changeStatus(user)}>{user.status === 'active' ? <Ban /> : <CheckCircle2 />}{user.status === 'active' ? '封禁' : '解封'}</button>
              <button onClick={() => forceLogout(user)}><LogOut />下线</button>
              <button onClick={() => void resetPassword(user)}><RotateCcw />重置密码</button>
            </div>
          </article>)}
        </div>
        <Pagination page={users.data?.page ?? page} totalPages={users.data?.totalPages ?? 1} onPage={setPage} />
      </section>}

      {tab === 'reports' && <section className="admin-panel">
        <header className="admin-toolbar"><strong>聊天举报</strong><select value={reportStatus} onChange={(event) => { setReportStatus(event.target.value); setPage(1); }}><option value="open">待处理</option><option value="resolved">已处理</option><option value="dismissed">已驳回</option><option value="all">全部</option></select></header>
        <div className="report-list">{reports.data?.items.map((report) => <article key={report.id} className="report-card"><header><span>{new Date(report.createdAt).toLocaleString()}</span><b>{report.status}</b></header><blockquote>{report.messageText}</blockquote><p>发送者：{report.senderIdentityId}<br />举报者：{report.reporterIdentityId}</p>{report.status === 'open' && <footer><button onClick={() => void resolveReport(report, 'resolved')}>标记已处理</button><button onClick={() => void resolveReport(report, 'dismissed')}>驳回</button></footer>}</article>)}</div>
        {!reports.isLoading && reports.data?.items.length === 0 && <div className="empty-state compact"><FileWarning /><h3>没有符合条件的举报</h3></div>}
        <Pagination page={reports.data?.page ?? page} totalPages={reports.data?.totalPages ?? 1} onPage={setPage} />
      </section>}

      {tab === 'settings' && <SettingsForm value={settings.data?.showdownDurationSeconds ?? 8} onSaved={() => void client.invalidateQueries({ queryKey: ['admin-settings'] })} />}

      {temporaryPassword && <div className="dialog-backdrop"><section className="temporary-password-dialog" role="dialog" aria-modal="true"><h2>临时密码</h2><p>密码只显示这一次，请通过安全渠道交给用户。</p><code>{temporaryPassword}</code><button className="secondary-button" aria-live="polite" onClick={() => void copyTemporaryPassword()}>{passwordCopyStatus === 'copied' ? <CheckCircle2 /> : <Clipboard />}{passwordCopyStatus === 'copied' ? '已复制' : passwordCopyStatus === 'error' ? '重试复制' : '复制'}</button>{passwordCopyStatus === 'error' && <p className="temporary-password-copy-error" role="alert">自动复制失败，请长按上方临时密码手动复制。</p>}<button className="primary-button" onClick={closeTemporaryPassword}>我已保存，关闭</button></section></div>}
      {chipTarget && <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setChipTarget(null)}><section className="dialog chip-adjust-dialog" role="dialog" aria-modal="true"><header><div><span className="eyebrow">CHIP CONTROL</span><h2>调整用户筹码</h2></div><button className="icon-button" onClick={() => setChipTarget(null)}><X /></button></header><div className="chip-target-summary"><Avatar src={chipTarget.avatarUrl} name={chipTarget.displayName} /><span><strong>{chipTarget.displayName}</strong><small>当前可用 {chipTarget.availableChips.toLocaleString()}</small></span></div><form onSubmit={(event) => void adjustChips(event)}><div className="segmented"><button type="button" className={chipDirection === 'add' ? 'active' : ''} onClick={() => setChipDirection('add')}>增加</button><button type="button" className={chipDirection === 'deduct' ? 'active' : ''} onClick={() => setChipDirection('deduct')}>扣减</button></div><label>筹码数量<input type="number" min={1} max={1_000_000} value={chipAmount} onChange={(event) => setChipAmount(Number(event.target.value))} required /></label><label>调整原因<input value={chipReason} minLength={2} maxLength={200} onChange={(event) => setChipReason(event.target.value)} required /></label><p className="chip-adjust-preview">调整后可用筹码：<strong>{Math.max(0, chipTarget.availableChips + (chipDirection === 'add' ? chipAmount : -chipAmount)).toLocaleString()}</strong></p><div className="dialog-actions"><button type="button" className="secondary-button" onClick={() => setChipTarget(null)}>取消</button><button className="primary-button" disabled={chipDirection === 'deduct' && chipAmount > chipTarget.availableChips}>确认调整</button></div></form></section></div>}
    </div>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (page: number) => void }) {
  return <div className="pagination"><button disabled={page <= 1} onClick={() => onPage(page - 1)}>上一页</button><span>{page} / {totalPages}</span><button disabled={page >= totalPages} onClick={() => onPage(page + 1)}>下一页</button></div>;
}

function SettingsForm({ value, onSaved }: { value: number; onSaved: () => void }) {
  const [seconds, setSeconds] = useState(value);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => setSeconds(value), [value]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await patch('/api/admin/settings', { showdownDurationSeconds: seconds });
      setMessage('设置已保存，将从下一手牌生效');
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    }
  };
  return <section className="admin-panel settings-admin"><h2>牌桌结算</h2><form onSubmit={(event) => void submit(event)}><label>赢家信息停留时间<input type="number" min={3} max={30} value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /><span>秒（3–30）</span></label><button className="primary-button">保存设置</button></form>{message && <p>{message}</p>}</section>;
}
