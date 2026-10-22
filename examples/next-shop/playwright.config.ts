import { defineConfig, devices } from '@playwright/test';

const PORT = 3310;
// Use `localhost`: Next.js treats 127.0.0.1 as a different dev origin and blocks
// its client chunks, which leaves the card form without its React handlers.
const ORIGIN = `http://localhost:${PORT}`;

/**
 * One browser test for the happy path. The web server runs the same `dev`
 * script a reader uses, so the test also proves that `prisma generate` and
 * `prisma db push` work before the app starts. MockProvider needs no
 * credentials and no network.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  use: {
    baseURL: ORIGIN,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: ORIGIN,
    // Always start a fresh server: a stale dev process on the test port would
    // make the test talk to a different app (or a half-dead compiler).
    reuseExistingServer: false,
    timeout: 180_000,
    env: { DEMO_ADMIN_KEY: 'demo-admin' },
  },
});
