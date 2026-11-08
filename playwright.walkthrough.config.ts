import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/** Visual walkthrough: every screen per role, desktop + phone, screenshots + video to docs/walkthrough/. */
export default defineConfig({
  ...base,
  testDir: './e2e/walkthrough',
  testIgnore: [],
  timeout: 300_000,
  outputDir: 'docs/walkthrough/results',
  use: { ...base.use, video: 'on', screenshot: 'off' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 } } },
    { name: 'phone', use: { ...devices['Pixel 7'], viewport: { width: 360, height: 780 } } },
  ],
});
