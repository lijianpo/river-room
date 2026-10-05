import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:3101',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 768 } } },
    { name: 'mobile-chromium', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: 'http://127.0.0.1:3101/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      PORT: '3101',
      HOST: '127.0.0.1',
      DATABASE_PATH: './data/e2e.db',
      AVATAR_DIR: './data/e2e-avatars',
      TURN_TIMEOUT_MS: '5000',
      TIME_BANK_MS: '0',
      AI_FILL_DELAY_MS: '3000',
    },
  },
});
