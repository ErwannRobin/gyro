import { defineConfig } from '@playwright/test';

// Headless Chromium renders WebGL in software (SwiftShader), so tests drive the game
// loop by hand (game.halt + game.tick) instead of relying on real-time frames.
export default defineConfig({
  testDir: 'tests',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 390, height: 780 },
    trace: 'retain-on-failure',
    launchOptions: {
      args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: { command: 'node scripts/serve.mjs 4173', url: 'http://127.0.0.1:4173/', reuseExistingServer: !process.env.CI, timeout: 30_000 },
});
