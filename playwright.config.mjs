import { defineConfig } from '@playwright/test';
const testPort = Number(process.env.CAPTAIN_TEST_PORT || 41731);
if (!Number.isInteger(testPort) || testPort < 1024 || testPort > 65535) throw new Error('Invalid CAPTAIN_TEST_PORT');

export default defineConfig({
  testDir: './tests',
  // Node unit tests run via npm test in isolated processes. Loading them here
  // executes node:test suites inside Playwright discovery and shares globals.
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CAPTAIN_TEST_WORKERS ? Number(process.env.CAPTAIN_TEST_WORKERS) : 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${testPort}`,
    /* Edge is what is installed on the desk this is developed at. A CI
       runner has Playwright's own Chromium and no Edge, and naming a channel
       it cannot find fails before a single test runs. */
    channel: process.env.CI ? undefined : 'msedge',
    headless: true,
    viewport: { width: 390, height: 844 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  /*
   * A PORT NOBODY ELSE IS ON.
   *
   * 4173 is vite's default preview port, and something unrelated on the
   * development machine was already listening on it. `reuseExistingServer`
   * trusts whatever answers - so every test ran against a stranger's server
   * and reported `POSNIC is not defined`, which reads exactly like the app
   * being broken. Two runs were spent believing that.
   *
   * A distinctive port cannot collide by coincidence.
   */
  webServer: {
    /* `npm.cmd` exists on Windows and nowhere else, so this ran at the desk
       and failed on a runner with "npm.cmd: not found" - the same shape of
       bug as the hard-coded gradlew.bat in build-apk.js. */
    command: `${process.platform === 'win32' ? 'npm.cmd' : 'npm'} run dev -- --host 127.0.0.1 --port ${testPort} --strictPort`,
    url: `http://127.0.0.1:${testPort}/index.html`,
    reuseExistingServer: !process.env.CAPTAIN_TEST_PORT,
    timeout: 120_000
  }
});
