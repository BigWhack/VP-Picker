import { defineConfig } from '@playwright/test';

const seeded = '.e2e/seeded';
const empty = '.e2e/empty';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { trace: 'off' },
  webServer: [
    {
      command: `rm -rf ${seeded} && DATA_DIR=${seeded} npx tsx scripts/seed-dev.ts && DATA_DIR=${seeded} NO_SCHEDULER=1 OFFLINE=1 PORT=4410 node dist/server/server/index.js`,
      url: 'http://localhost:4410/api/health', reuseExistingServer: false, timeout: 120000,
    },
    {
      command: `rm -rf ${empty} && DATA_DIR=${empty} NO_SCHEDULER=1 OFFLINE=1 PORT=4411 node dist/server/server/index.js`,
      url: 'http://localhost:4411/api/health', reuseExistingServer: false, timeout: 60000,
    },
  ],
});
