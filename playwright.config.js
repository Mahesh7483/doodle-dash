// @ts-check
const { defineConfig } = require('@playwright/test');

const PORT = Number(process.env.E2E_PORT || 3123);

module.exports = defineConfig({
  testDir: './e2e',
  outputDir: './e2e/output',
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    // Autoplay of Web Audio would need a gesture anyway; keep test runs quiet.
    launchOptions: { args: ['--mute-audio'] },
  },
  webServer: {
    command: 'node server/index.js',
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 20_000,
    env: {
      PORT: String(PORT),
      // Short timers so a whole game fits in a test run.
      DD_DRAW_MS: '30000',
      DD_CHOOSE_MS: '15000',
      DD_REVEAL_MS: '1500',
      // Chaos rounds only apply when a host turns them on; this fixes their order for the test.
      DD_CHAOS: 'mirror,oneline,blind',
    },
  },
});
