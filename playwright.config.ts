import { defineConfig } from '@playwright/test';
const devProof = process.env.VULPES_TEST_MODE === 'dev_proof';
const origin = `http://127.0.0.1:${devProof ? 5173 : 4173}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: origin, browserName: 'chromium', trace: 'off', screenshot: 'off', video: 'off' },
  webServer: {
    command: devProof ? 'npm run dev:full' : 'npm run preview:full',
    url: `${origin}/api/status`,
    reuseExistingServer: false,
    timeout: 30_000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
  },
});
