import { test, expect } from '@playwright/test';
import { openGame, openOptions } from './helpers.js';

test.use({ viewport: { width: 1280, height: 720 } });
const still = (page) => page.addStyleTag({ content: '#menu *, #menu::before { transition: none !important; animation: none !important }' });
const box = (page, s) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height, cx: r.left + r.width / 2 }; }, s);

test('computer: the middle or right mouse button turns the camera, the left one steers', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; g.startRun('keys'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
  const look = () => page.evaluate(() => { const g = window.__game; g.tick(1 / 60, false); return { yaw: g.cam.offYaw, pitch: g.cam.offPitch, joy: g.input.ptr !== null, held: g.cam.held }; });
  for (const button of ['middle', 'right']) {
    await page.mouse.move(640, 400); await page.mouse.down({ button });
    await page.mouse.move(540, 360, { steps: 4 });
    const r = await look();
    expect(r.joy, button).toBe(false);
    expect(r.held).toBe(true);
    expect(r.yaw, button).toBeGreaterThan(0.4);                        // dragged left: the view swings round
    expect(r.pitch).toBeLessThan(0);
    await page.mouse.up({ button });
    await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 180; k++) g.tick(1 / 60, false); });
    expect(Math.abs((await look()).yaw)).toBeLessThan(0.05);           // let go: back behind the ball
  }
  await page.evaluate(() => { window.__game.cam.offYaw = 0; });
  await page.mouse.move(640, 400); await page.mouse.down();
  await page.mouse.move(600, 380, { steps: 3 });
  const l = await look();
  expect([l.joy, Math.abs(l.yaw) < 1e-6]).toEqual([true, true]);        // the left button is the joystick
  await page.mouse.up();
  expect(errors).toEqual([]);
});

test('computer: the mouse wheel zooms; a trackpad swipe turns the view and its pinch zooms', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; g.startRun('keys'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
  const wheel = (evts) => page.evaluate(async (evts) => {
    const g = window.__game, c = g.canvas, z0 = g.cam.zoom;
    for (const e of evts) { c.dispatchEvent(new WheelEvent('wheel', Object.assign({ bubbles: true, cancelable: true }, e))); g.tick(1 / 60, false); }
    const r = { dz: g.cam.zoom / z0, yaw: g.cam.offYaw, pitch: g.cam.offPitch };
    g.gest.wheelT = -1e4; g.cam.offYaw = g.cam.offPitch = 0;                   // the next gesture starts fresh
    return r;
  }, evts);
  const mouse = await wheel([{ deltaY: 100 }, { deltaY: 100 }]);
  expect(mouse.dz).toBeGreaterThan(1.2); expect(mouse.yaw).toBe(0);
  const lines = await wheel([{ deltaY: -3, deltaMode: 1 }]);                  // Firefox counts wheel steps in lines
  expect(lines.dz).toBeLessThan(0.97);
  const swipe = await wheel([{ deltaX: 6, deltaY: 1 }, { deltaX: 14, deltaY: 2 }, { deltaX: 20, deltaY: 2 }, { deltaX: 25, deltaY: 1 }]);
  expect(swipe.dz).toBe(1); expect(swipe.yaw).toBeGreaterThan(0.3);
  const up = await wheel([{ deltaY: 3.5 }, { deltaY: 12 }, { deltaY: 30 }, { deltaY: 60 }]);    // small first steps: a trackpad, even the big ones after
  expect(up.dz).toBe(1); expect(up.pitch).toBeLessThan(-0.3);
  const pinch = await wheel([{ deltaY: -8, ctrlKey: true }, { deltaY: -8, ctrlKey: true }]);
  expect(pinch.dz).toBeLessThan(0.9); expect(pinch.yaw).toBe(0);
  expect(errors).toEqual([]);
});

test('computer: the settings are a centered card, with ABOUT and INSTALL in the middle of the space above it', async ({ page }) => {
  const errors = await openGame(page);
  await still(page);
  await openOptions(page);
  const sh = await box(page, '#sheet'), bar = await box(page, '#menuTop'), ab = await box(page, '#btnAbout');
  expect(sh.w).toBeLessThanOrEqual(560);
  expect(Math.abs(sh.cx - 640)).toBeLessThan(1);
  expect(sh.b).toBeCloseTo(720, 0);
  // the pair (ABOUT above INSTALL) sits in the middle between the top bar and the card
  const ins = await box(page, '#btnInstall').catch(() => null);
  const bottom = ins && ins.h ? ins.b : ab.b;
  expect(Math.abs((ab.t - bar.b) - (sh.t - bottom))).toBeLessThan(3);
  expect(ab.t - bar.b).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});

test('the settings sheet follows a drag on its grip and closes when let go far enough', async ({ page }) => {
  const errors = await openGame(page);
  await still(page);
  await openOptions(page);
  const opts = () => page.evaluate(() => document.getElementById('menu').classList.contains('opts'));
  const g = await box(page, '#sheetGrip'), sh = await box(page, '#sheet');
  // a short pull springs back
  await page.mouse.move(g.cx, g.t + 12); await page.mouse.down();
  await page.mouse.move(g.cx, g.t + 42, { steps: 3 });
  expect(await page.evaluate(() => document.getElementById('sheet').style.transform)).toMatch(/^translateY\(30(\.0)?px\)$/);
  await page.mouse.up();
  expect(await opts()).toBe(true);
  expect(await page.evaluate(() => document.getElementById('sheet').style.transform)).toBe('');
  // pulling up only stretches a little
  await page.mouse.move(g.cx, g.t + 12); await page.mouse.down();
  await page.mouse.move(g.cx, g.t - 200, { steps: 3 });
  const up = await page.evaluate(() => +document.getElementById('sheet').style.transform.match(/-?[\d.]+/)[0]);
  expect(up).toBeLessThan(0); expect(up).toBeGreaterThan(-25);
  await page.mouse.up();
  // a long pull closes it
  await page.mouse.move(g.cx, g.t + 12); await page.mouse.down();
  await page.mouse.move(g.cx, g.t + 12 + sh.h * 0.45, { steps: 6 });
  await page.mouse.up();
  expect(await opts()).toBe(false);
  expect(errors).toEqual([]);
});

test('phone in landscape: the side panel closes with a drag to the right', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  const errors = await openGame(page);
  await still(page);
  await openOptions(page);
  const g = await box(page, '#sheetGrip'), sh = await box(page, '#sheet');
  expect(g.h).toBeGreaterThan(200);                                     // the grip runs along the panel's left edge
  expect(Math.abs(g.l - sh.l)).toBeLessThanOrEqual(1);                  // (inside the panel's 1 px border)
  await page.mouse.move(g.cx, 200); await page.mouse.down();
  await page.mouse.move(g.cx + 60, 204, { steps: 3 });
  expect(await page.evaluate(() => document.getElementById('sheet').style.transform)).toMatch(/^translateX\(60(\.0)?px\)$/);
  await page.mouse.move(g.cx + sh.w * 0.5, 210, { steps: 3 });
  await page.mouse.up();
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('opts'))).toBe(false);
  expect(errors).toEqual([]);
});
