import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4179',
  },
  webServer: {
    command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VITE_SUPABASE_URL: 'https://azs-test.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'test-anon-key',
      VITE_REQUEST_TIMEOUT_MS: '1000',
    },
  },
  projects: [
    { name: 'logic', testMatch: /(?:logic|server)\.spec\.ts/ },
    {
      name: 'chromium',
      testMatch: /resilience\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
  ],
})
