import { defineConfig, devices } from '@playwright/test';

// Runs against a live stack: docker compose -f compose.yaml -f compose.dev.yaml up
export default defineConfig({
  testDir: 'e2e',
  timeout: 60000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8088', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
