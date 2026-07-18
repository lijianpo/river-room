import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoomShareDialog } from './RoomShareDialog';

describe('房间二维码分享面板', () => {
  it('展示二维码、房间码和可复制的公网链接', () => {
    const html = renderToStaticMarkup(
      <RoomShareDialog
        open
        roomName="好友牌桌"
        inviteCode="ABCD23"
        publicOrigin="https://play.example.com"
        onClose={() => undefined}
        onNotice={() => undefined}
      />,
    );
    expect(html).toContain('好友牌桌');
    expect(html).toContain('ABCD23');
    expect(html).toContain('https://play.example.com/invite/ABCD23');
    expect(html).toContain('房间邀请二维码');
  });
});
