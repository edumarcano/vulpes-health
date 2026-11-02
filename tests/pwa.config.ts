import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  testDir: './pwa',
  workers: 1,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    trace: 'off',
  },
  webServer: {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    command:
      'node node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4175 --strictPort',
    url: 'http://127.0.0.1:4175/offline.html',
    reuseExistingServer: false,
  },
});
