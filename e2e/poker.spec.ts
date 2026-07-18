import { expect, test, type Page } from '@playwright/test';

async function enterAsGuest(page: Page, name: string) {
  await page.goto('/');
  await page.getByLabel('昵称').fill(name);
  await page.getByRole('button', { name: '立即入座' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(`${name}，选张桌子吧`) })).toBeVisible();
}

test.describe('多人牌桌主流程', () => {
  test('手机端首页标题保持两行且不溢出', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', '仅在手机视口运行');
    await page.goto('/');
    const title = page.locator('.landing-copy h1');
    await expect(title).toContainText('真正坐在同一张牌桌的感觉。');
    await expect(title.locator('br')).toHaveCSS('display', 'inline');

    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      const metrics = await title.evaluate((element) => {
        const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
        return {
          lines: Math.round(element.getBoundingClientRect().height / lineHeight),
          fits: element.scrollWidth <= element.clientWidth + 1,
        };
      });
      expect(metrics, `${width}px 宽度下标题应保持两行且不溢出`).toEqual({ lines: 2, fits: true });
    }
  });

  test('手机端表单控件保持防缩放字号', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', '仅在手机视口运行');
    const suffix = Date.now().toString().slice(-6);
    await page.goto('/');

    await expect(page.getByLabel('昵称')).toHaveCSS('font-size', '16px');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByLabel('邮箱')).toHaveCSS('font-size', '16px');
    await expect(page.locator('.auth-card input[type="password"]')).toHaveCSS('font-size', '16px');

    await page.getByRole('button', { name: '游客' }).click();
    await page.getByLabel('昵称').fill(`防缩放${suffix}`);
    await page.getByRole('button', { name: '立即入座' }).click();
    await expect(page.getByRole('heading', { name: new RegExp(`防缩放${suffix}，选张桌子吧`) })).toBeVisible();
    await expect(page.getByPlaceholder('输入房间码')).toHaveCSS('font-size', '16px');
    await expect(page.getByPlaceholder('搜索房间')).toHaveCSS('font-size', '16px');

    await page.getByRole('button', { name: /创建牌局/ }).first().click();
    await expect(page.getByLabel('房间名称')).toHaveCSS('font-size', '16px');
    await expect(page.getByLabel('座位数')).toHaveCSS('font-size', '16px');
    await expect(page.getByLabel('小盲')).toHaveCSS('font-size', '16px');
    await expect(page.getByLabel('AI 自动补位')).toHaveCSS('width', '42px');
  });

  test('二维码邀请页支持游客认证后自动加入私密房', async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', '仅在桌面视口运行');
    const suffix = Date.now().toString().slice(-6);
    const roomName = `扫码牌桌${suffix}`;
    await enterAsGuest(page, `邀请人${suffix}`);
    await page.getByRole('button', { name: /创建牌局/ }).first().click();
    await page.getByLabel('房间名称').fill(roomName);
    await page.getByRole('button', { name: '私密邀请' }).click();
    await page.getByRole('button', { name: '创建并入座' }).click();
    await page.getByRole('button', { name: /分享房间/ }).click();
    const inviteUrl = await page.getByLabel('邀请链接').inputValue();
    await expect(page.getByLabel('房间邀请二维码')).toBeVisible();

    const invitedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const invited = await invitedContext.newPage();
    await invited.goto(inviteUrl);
    await expect(invited.getByRole('heading', { name: roomName })).toBeVisible();
    await invited.getByLabel('昵称').fill(`扫码客${suffix}`);
    await invited.getByRole('button', { name: '完成并加入' }).click();
    await expect(invited.getByRole('heading', { name: roomName })).toBeVisible();
    await expect(invited.getByText(/正在观战/)).toBeVisible();
    await invitedContext.close();
  });

  test('桌面端两个玩家入座、添加 AI 并开局', async ({ browser, page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium', '仅在桌面视口运行');
    const suffix = Date.now().toString().slice(-6);
    const hostName = `房主${suffix}`;
    const guestName = `牌友${suffix}`;
    const roomName = `验收牌桌${suffix}`;
    await enterAsGuest(page, hostName);
    await page.getByRole('button', { name: /创建牌局/ }).first().click();
    await page.getByLabel('房间名称').fill(roomName);
    await page.getByLabel('AI 自动补位').uncheck();
    await page.getByRole('button', { name: '创建并入座' }).click();
    await expect(page.getByRole('heading', { name: roomName })).toBeVisible();

    const secondContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const second = await secondContext.newPage();
    await enterAsGuest(second, guestName);
    const card = second.locator('.room-card').filter({ hasText: roomName });
    await card.getByRole('button', { name: '进入房间' }).click();
    await expect(second.getByRole('heading', { name: roomName })).toBeVisible();
    await second.locator('.empty-table-seat:not(:disabled)').first().click();
    await expect(page.locator('.table-seat').filter({ hasText: guestName })).toBeVisible();

    await page.getByRole('button', { name: '添加 AI' }).click();
    await expect(page.locator('.table-seat')).toHaveCount(3);
    await page.getByRole('button', { name: '开始牌局' }).click();
    await expect(page.getByText('第 1 手')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('desktop-table.png'), fullPage: true });
    await secondContext.close();
  });

  test('手机竖屏大厅和牌桌控件可达', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-chromium', '仅在手机视口运行');
    const suffix = Date.now().toString().slice(-6);
    await enterAsGuest(page, `手机玩家${suffix}`);
    await expect(page.locator('.mobile-nav')).toBeVisible();
    await page.getByRole('button', { name: /创建牌局/ }).first().click();
    await page.getByLabel('房间名称').fill(`手机牌桌${suffix}`);
    await page.getByLabel('AI 自动补位').uncheck();
    await page.getByRole('button', { name: '创建并入座' }).click();
    await page.getByRole('button', { name: '添加 AI' }).click();
    await page.getByRole('button', { name: '开始牌局' }).click();
    await expect(page.locator('.poker-stage')).toBeVisible();
    await expect(page.locator('.action-panel')).toBeVisible();
    await expect(page.locator('.mobile-chat-button')).toBeVisible();
    await page.locator('.mobile-chat-button').click();
    await expect(page.getByLabel('聊天消息')).toHaveCSS('font-size', '16px');
    await page.getByLabel('关闭聊天').click();
    await page.screenshot({ path: testInfo.outputPath('mobile-table.png'), fullPage: true });
  });
});
