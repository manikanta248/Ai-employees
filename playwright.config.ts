import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;
// Locally we may point at a pre-installed Chromium; CI installs its own via `playwright install`.
const launchOptions = process.env.CHROMIUM_PATH
  ? { executablePath: process.env.CHROMIUM_PATH }
  : {};

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm --filter @hazir/web exec next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'mobile',
      use: {
        ...devices['Pixel 7'],
        launchOptions,
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions,
      },
    },
  ],
});
