import { defineConfig, devices } from '@playwright/test';

// End-to-end tests run against the Node build of the site (npm run build:test).
// Phone first: the smallest supported width is 320px.
const port = Number(process.env.E2E_PORT ?? 4321);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${port}`;

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/wb_e2e';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'phone-320',
      use: { ...devices['Desktop Chrome'], viewport: { width: 320, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
    },
    {
      name: 'phone-390-dark',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, colorScheme: 'dark' },
    },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
      testMatch: /site\.spec\.ts/,
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'node scripts/start-node.mjs',
        url: `${baseURL}/`,
        reuseExistingServer: !process.env.CI,
        timeout: 60_000,
        env: {
          PORT: String(port),
          HOST: '127.0.0.1',
          DATABASE_URL: databaseUrl,
          APP_ENV: 'test',
          BOT_MIN_SECONDS: '0',
          SUPABASE_JWT_SECRET: process.env.SUPABASE_JWT_SECRET ?? 'e2e-only-jwt-secret-0123456789abcdef',
        },
      },
});
