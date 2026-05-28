import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',

  timeout: 30_000,

  use: {
    baseURL: 'http://127.0.0.1:3007',
    trace: 'on-first-retry',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:3007',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})