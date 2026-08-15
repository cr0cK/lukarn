import { defineConfig, devices } from '@playwright/test';
import { BASE_URL, FEED_URL, SINK_URL } from './fixtures/instance.js';

/**
 * The browser gate.
 *
 * Two projects, and both are load-bearing. **WebKit on a phone** is the engine
 * the mobile rework was written for — safe-area insets, pinch and view
 * transitions are iOS claims, and Chromium agreeing proves nothing about them.
 * **Chromium at 1280 px** guards the other half of the promise: that nothing
 * moved above 768 px.
 *
 * The suite runs against the artefact a container ships — `dist/main.js` serving
 * `packages/web/dist` — rather than a dev server, so a bundle that breaks only
 * when built is a failure here rather than a failure in production.
 */
export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',

  /**
   * One worker, deliberately. All the specs share one instance and one database:
   * a comment posted by one file and a cover set by another would make each
   * other's assertions depend on which finished first.
   */
  workers: 1,
  fullyParallel: false,

  forbidOnly: Boolean(process.env.CI),
  // One retry on CI and none locally: a runner under load is the difference
  // between the two, and a retry that hides a real failure locally is worse
  // than the minute it saves.
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },

  // The list reporter says what is happening; the HTML one is what CI uploads
  // when something fails, and it is the only artefact that carries the trace.
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    /**
     * Stated rather than inherited: the top bar's retraction is disabled under
     * `prefers-reduced-motion`, so a runner configured to reduce motion would
     * turn that claim into a silent pass.
     */
    contextOptions: { reducedMotion: 'no-preference' },
    /**
     * The service worker caches the application shell, and a shell cached by an
     * earlier test is a shell no later test can reason about. It is covered by
     * unit tests and by none of the claims here.
     */
    serviceWorkers: 'block',
  },

  projects: [
    {
      name: 'phone',
      testIgnore: 'desktop.spec.ts',
      use: { ...devices['iPhone 13'] },
    },
    {
      name: 'desktop',
      testMatch: 'desktop.spec.ts',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],

  webServer: [
    {
      command: 'node --import tsx fixtures/smtp-sink.ts',
      url: `${SINK_URL}/messages`,
      // Never reuse: a sink left running from an earlier run still holds that
      // run's messages, and the identity flow would read a stale code.
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      // Started before the server, like the sink: the instance reads its address
      // from the environment at startup, and a feed that is not listening yet
      // would make the first check fail and cache that failure for half an hour.
      command: 'node --import tsx fixtures/release-feed.ts',
      url: `${FEED_URL}/releases/latest`,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node --import tsx fixtures/serve.ts',
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: false,
      // Seeding renders every demo photo five times, up to 4096 px: a cold run
      // on a loaded machine spends most of this budget before the port opens.
      timeout: 240_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
