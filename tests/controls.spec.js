import { test, expect } from '@playwright/test';
import { openGame, openOptions, teleport } from './helpers.js';

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

// Runs inside the page: feeds orientation events (beta, gamma in degrees) at 60 Hz and returns the input.
function tiltKit() {
  const I = window.__game.input;
  window.feed = (beta, gamma, sec = 0.4) => { for (let t = 0; t < sec; t += 1 / 60) { I.onOrient({ beta, gamma }); I.update(1 / 60); } return [+I.x.toFixed(2), +I.y.toFixed(2)]; };
  window.calib = (beta, gamma) => { I.tilt = true; I.startCalibration(); window.feed(beta, gamma, 0.3); I.endCalibration(); };
}

test('forward is "top edge away from you" however the phone is held: flat, upright, or above your face in bed', async ({ page }) => {
  await openGame(page);
  await page.evaluate(tiltKit);
  const r = await page.evaluate(() => {
    const out = {};
    // beta: 20 almost flat, 90 upright, 150 lying on your back with the phone above you, 180 face down
    for (const b0 of [20, 45, 90, 120, 150, 180]) {
      window.calib(b0, 0);
      const n = window.feed(b0, 0), f = window.feed(b0 - 12, 0), k = window.feed(b0 + 12, 0);
      out[b0] = { n, fwd: f[1], back: k[1] };
    }
    // steering: the right edge lower is right, and held upright the steering-wheel turn works too
    window.calib(40, 0); out.roll = [window.feed(40, 14)[0], window.feed(40, -14)[0]];
    window.calib(90, 0);
    const wheel = (deg) => { const a = deg * Math.PI / 180, g = [Math.sin(a), -Math.cos(a), 0];   // gravity, the phone turned clockwise
      const beta = Math.asin(-g[1]) * 180 / Math.PI, gamma = Math.atan2(g[0], -g[2] || -1e-9) * 180 / Math.PI;
      return window.feed(beta, Math.abs(gamma) > 90 ? Math.sign(gamma) * 89.9 : gamma)[0]; };
    out.wheel = [wheel(14), wheel(-14)];
    return out;
  });
  for (const b0 of [20, 45, 90, 120, 150, 180]) {
    const { n, fwd, back } = r[b0];
    expect(Math.abs(n[0]) + Math.abs(n[1]), `neutral at ${b0}°`).toBeLessThan(0.05);
    expect(fwd, `forward at ${b0}°`).toBeGreaterThan(0.4);
    expect(back, `back at ${b0}°`).toBeLessThan(-0.4);
    expect(Math.abs(fwd - r[20].fwd), `same feel at ${b0}°`).toBeLessThan(0.08);
  }
  expect(r.roll[0]).toBeGreaterThan(0.3); expect(r.roll[1]).toBeLessThan(-0.3);
  expect(r.wheel[0]).toBeGreaterThan(0.4); expect(r.wheel[1]).toBeLessThan(-0.4);
});

test('the neutral pose follows a slow drift back, but held forward tilt and hard braking never fade', async ({ page }) => {
  await openGame(page);
  await page.evaluate(tiltKit);
  const r = await page.evaluate(() => {
    const I = window.__game.input; I.enabled = true;
    window.calib(40, 0);
    const fwd = window.feed(28, 0, 8)[1];                   // 8 s of forward: it stays
    const hard = window.feed(70, 0, 4)[1];                  // 4 s of hard braking: it stays
    window.feed(40, 0, 0.5);
    const drift0 = window.feed(48, 0, 0.5)[1];              // the hands creep back 8°: a mild brake at first…
    const drift1 = window.feed(48, 0, 5)[1];                // …that fades as the neutral pose follows
    const fwd2 = window.feed(36, 0, 0.5)[1];                // and 12° forward from there pushes about as before
    window.feed(90, 0, 20);                                 // a long hard brake after that moves nothing more
    const cap = I.drift;
    return { fwd, hard, drift0, drift1, fwd2, cap };
  });
  expect(r.fwd).toBeGreaterThan(0.45); expect(r.hard).toBe(-1);
  expect(r.drift0).toBeLessThan(-0.25); expect(r.drift1).toBeGreaterThan(-0.08);
  expect(Math.abs(r.fwd2 - r.fwd)).toBeLessThan(0.08);
  expect(r.cap).toBeLessThanOrEqual(0.3001);
});

test('the neutral pose is the last steady one, and a screen rotation during a run measures it again', async ({ page }) => {
  await openGame(page);
  await page.evaluate(tiltKit);
  // the hand still moving after the tap: only the steady end counts
  const n = await page.evaluate(() => { const I = window.__game.input; I.tilt = true; I.startCalibration(); window.feed(10, 0, 0.2); window.feed(45, 0, 0.3); I.endCalibration(); return window.feed(45, 0); });
  expect(Math.abs(n[1])).toBeLessThan(0.05);
  // the screen turns to landscape: the tilt pauses for a moment, then works from the new pose
  await page.evaluate(() => { Object.defineProperty(screen.orientation, 'angle', { get: () => 90, configurable: true }); window.dispatchEvent(new Event('orientationchange')); });
  expect(await page.evaluate(() => !!window.__game.input.calib)).toBe(true);
  await page.evaluate(() => window.feed(0, -40, 0.2));
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => { const I = window.__game.input; const n = window.feed(0, -40, 0.3); return { calib: !!I.calib, n, fwd: window.feed(0, -52)[1], right: window.feed(12, -40)[0] }; });
  expect(after.calib).toBe(false);
  expect(Math.abs(after.n[0]) + Math.abs(after.n[1])).toBeLessThan(0.05);
  expect(Math.abs(after.fwd) + Math.abs(after.right)).toBeGreaterThan(0.4);
});

test('refused motion permission falls back to touch control', async ({ page }) => {
  await page.addInitScript(() => { window.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied'); });
  await openGame(page);
  await page.tap('#btnPlay');                                        // the gyroscope is the default control on phones
  await expect(page.locator('#permMsg')).toBeVisible();
  await page.waitForFunction(() => window.__game.state !== 'menu');
  expect(await page.evaluate(() => [window.__game.mode, window.__game.input.tilt, window.__game.ctrl])).toEqual(['touch', false, 'touch']);
});

test('touch joystick steers', async ({ page }) => {
  await openGame(page);
  await openOptions(page);
  await page.tap('#ctrlSeg button[data-ctrl=touch]');
  await page.tap('#btnOpts');
  await page.tap('#btnPlay');
  await page.waitForFunction(() => window.__game.input.enabled);
  await page.mouse.move(195, 600); await page.mouse.down(); await page.mouse.move(195, 520, { steps: 4 });
  const joy = await page.evaluate(() => window.__game.input.joyY);
  await page.mouse.up();
  expect(joy).toBeGreaterThan(0.5);
});

// Pointer events on the game canvas (id: a finger).
const touch = (page, pts) => page.evaluate((pts) => {
  const cv = document.getElementById('c');
  for (const [id, x, y, type] of pts) cv.dispatchEvent(new PointerEvent(type || 'pointermove', { pointerId: id, clientX: x, clientY: y, bubbles: true, isPrimary: id === 1 }));
}, pts);

test('with the gyroscope, a finger turns the camera (it swings back after), a pinch zooms, a double tap fires star power', async ({ page }) => {
  const errors = await openGame(page);
  const tick = (n) => page.evaluate((n) => { const g = window.__game; g.halt = true; for (let k = 0; k < n; k++) g.tick(1 / 60, false); }, n);
  await page.evaluate(() => { const g = window.__game, I = g.input; I.raw = [0, 0, -1]; I.lastEvt = performance.now(); I.tilt = true; g.startRun('tilt'); });
  await tick(200);
  await page.evaluate(teleport, 150);
  await page.evaluate(() => { const g = window.__game; g.input.update = function () { this.x = -g.ball.u * 0.8; this.y = 0.2; }; });   // stays on the track
  expect(await page.evaluate(() => window.__game.state)).toBe('play');
  const cam = () => page.evaluate(() => { const g = window.__game, c = g.cam, b = g.ball.p; return { yaw: c.offYaw, pitch: c.offPitch, zoom: c.zoom, d: Math.hypot(c.pos[0] - b[0], c.pos[1] - b[1], c.pos[2] - b[2]), joy: g.input.ptr }; });
  const c0 = await cam();
  await touch(page, [[1, 200, 440, 'pointerdown'], [1, 150, 470], [1, 90, 500]]);                 // left and down: around, and higher
  await tick(20);
  const c1 = await cam();
  expect(c1.yaw).toBeGreaterThan(0.6); expect(c1.pitch).toBeGreaterThan(0.2); expect(c1.joy).toBe(null);   // no joystick
  await touch(page, [[1, 90, 500, 'pointerup']]);
  await tick(20);
  expect((await cam()).yaw).toBeGreaterThan(0.6);                              // held a moment after the finger lifts…
  await tick(200);
  expect(Math.abs((await cam()).yaw)).toBeLessThan(0.05);                       // …then back behind the ball
  // pinch: fingers closing move the camera away (and the setting is kept)
  await touch(page, [[1, 120, 500, 'pointerdown'], [2, 280, 500, 'pointerdown'], [1, 160, 500], [2, 240, 500], [1, 190, 500], [2, 210, 500], [1, 190, 500, 'pointerup'], [2, 210, 500, 'pointerup']]);
  await tick(120);
  const c2 = await cam();
  expect(c2.zoom).toBeGreaterThan(1.7); expect(c2.d).toBeGreaterThan(c0.d * 1.4);
  // a double tap fires a full star gauge
  await page.evaluate(teleport, 300);
  await page.evaluate(() => { window.__game.power = 1; });
  await touch(page, [[1, 200, 500, 'pointerdown'], [1, 200, 500, 'pointerup'], [1, 200, 500, 'pointerdown'], [1, 200, 500, 'pointerup']]);
  await tick(2);
  expect(await page.evaluate(() => [window.__game.state, window.__game.star])).toEqual(['play', true]);
  await page.evaluate(() => window.__game.goMenu());
  expect(await page.evaluate(() => +JSON.parse(localStorage.getItem('gyroll.zoom')))).toBeGreaterThan(1.7);
  expect(errors).toEqual([]);
});
