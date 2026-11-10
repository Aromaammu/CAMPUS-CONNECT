import { defineConfig, devices } from '@playwright/test';

/** Headless end-to-end tests against a fresh demo database (tools/scripts/stack.mjs e2e). */
export default defineConfig({
  testDir: './e2e',
  testIgnore: ['**/walkthrough/**'],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    permissions: ['camera', 'microphone'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 860 } } }],
  webServer: {
    command: 'node tools/scripts/stack.mjs e2e',
    url: 'http://localhost:5174/api/public/health',
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: process.env.PW_SERVER_LOG ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
});
