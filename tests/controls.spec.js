import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test.use({ hasTouch: true, isMobile: true });

test('tilt directions map to the ball after calibration', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const I = window.__game.input;
    const feed = (beta, gamma, n = 12) => { for (let k = 0; k < n; k++) { I.onOrient({ beta, gamma }); I.update(0.05); } return [+I.x.toFixed(2), +I.y.toFixed(2)]; };
    I.tilt = true; I.startCalibration(); feed(40, 0); I.endCalibration();
    return { neutral: feed(40, 0), right: feed(40, 15), left: feed(40, -15), forward: feed(25, 0), back: feed(55, 0) };
  });
  expect(Math.abs(r.neutral[0]) + Math.abs(r.neutral[1])).toBeLessThan(0.05);
  expect(r.right[0]).toBeGreaterThan(0.3);
  expect(r.left[0]).toBeLessThan(-0.3);
  expect(r.forward[1]).toBeGreaterThan(0.3);
  expect(r.back[1]).toBeLessThan(-0.2);
});

test('refused motion permission falls back to touch control', async ({ page }) => {
  await page.addInitScript(() => { window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); });
  await openGame(page);
  await page.tap('#btnTilt');
  await expect(page.locator('#permMsg')).toBeVisible();
  await page.waitForFunction(() => window.__game.state !== 'menu');
  expect(await page.evaluate(() => [window.__game.mode, window.__game.input.tilt])).toEqual(['touch', false]);
});

test('touch joystick steers', async ({ page }) => {
  await openGame(page);
  await page.tap('#btnTouch');
  await page.waitForFunction(() => window.__game.input.enabled);
  await page.mouse.move(195, 600); await page.mouse.down(); await page.mouse.move(195, 520, { steps: 4 });
  const joy = await page.evaluate(() => window.__game.input.joyY);
  await page.mouse.up();
  expect(joy).toBeGreaterThan(0.5);
});
