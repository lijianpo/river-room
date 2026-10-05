import { Copy, QrCode, Share2, X } from 'lucide-react';
import QRCode from 'react-qr-code';
import { copyText } from '../lib/clipboard';
import { buildInviteUrl, isLoopbackInviteOrigin, resolvePublicAppOrigin } from '../lib/invite';
import { useDialog } from '../lib/use-dialog';

interface RoomShareDialogProps {
  open: boolean;
  roomName: string;
  inviteCode: string;
  onClose: () => void;
  onNotice: (message: string, kind?: 'success' | 'error') => void;
  publicOrigin?: string;
}

export function RoomShareDialog({ open, roomName, inviteCode, onClose, onNotice, publicOrigin }: RoomShareDialogProps) {
  const currentOrigin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const origin = resolvePublicAppOrigin(publicOrigin ?? import.meta.env.VITE_PUBLIC_APP_URL, currentOrigin);
  const inviteUrl = buildInviteUrl(inviteCode, origin);

  const dialogRef = useDialog<HTMLElement>(open, onClose);

  if (!open) return null;

  const copyInvite = async () => {
    try {
      await copyText(inviteUrl);
      onNotice('邀请链接已复制', 'success');
    } catch (reason) {
      onNotice(reason instanceof Error ? reason.message : '复制失败');
    }
  };
  const shareInvite = async () => {
    if (!navigator.share) {
      await copyInvite();
      return;
    }
    try {
      await navigator.share({
        title: `${roomName} · River Room`,
        text: `邀请你加入德州牌桌「${roomName}」，房间码 ${inviteCode}`,
        url: inviteUrl,
      });
      onClose();
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      onNotice(reason instanceof Error ? `分享失败：${reason.message}` : '分享失败');
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} tabIndex={-1} className="dialog share-room-dialog" role="dialog" aria-modal="true" aria-labelledby="share-room-title">
        <header>
          <div><span className="eyebrow">ROOM INVITE</span><h2 id="share-room-title">分享牌桌</h2></div>
          <button className="icon-button" aria-label="关闭分享面板" onClick={onClose}><X size={20} /></button>
        </header>
        <div className="share-room-content">
          <div className="share-qr" aria-label="房间邀请二维码">
            <QRCode value={inviteUrl} size={224} level="Q" bgColor="#ffffff" fgColor="#07130f" title={`${roomName} 房间二维码`} />
          </div>
          <div className="share-room-details">
            <span>邀请加入</span>
            <h3>{roomName}</h3>
            <p>扫码后完成登录或游客认证，即可进入房间观战并选择空座。</p>
            <div className="share-room-code"><QrCode /><span>房间码</span><strong>{inviteCode}</strong></div>
          </div>
        </div>
        <label className="share-link-field">邀请链接<input aria-label="邀请链接" value={inviteUrl} readOnly onFocus={(event) => event.currentTarget.select()} /></label>
        {isLoopbackInviteOrigin(origin) && <p className="share-origin-warning">当前链接指向本机，其他设备无法访问。请通过公网域名或局域网 IP 打开本站后重新分享，或配置 VITE_PUBLIC_APP_URL。</p>}
        <div className="dialog-actions share-actions">
          <button className="secondary-button" data-autofocus onClick={() => void copyInvite()}><Copy />复制链接</button>
          <button className="primary-button" onClick={() => void shareInvite()}><Share2 />系统分享</button>
        </div>
      </section>
    </div>
  );
}
