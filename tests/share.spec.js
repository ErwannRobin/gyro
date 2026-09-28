import { test, expect } from '@playwright/test';
import { openGame, teleport } from './helpers.js';

// Starts a keyboard run, moves to `dist` meters and pushes the ball off the side until game over.
async function fallAt(page, dist) {
  await page.evaluate(() => { const g = window.__game; g.halt = true; g.startRun('keys'); for (let k = 0; k < 40; k++) g.tick(1 / 30, false); });
  await page.evaluate(teleport, dist);
  await page.evaluate(() => {
    const g = window.__game, b = g.ball, L = g.track.locate(b.p[0], b.p[2], b.hint);
    b.p[0] += L.rx * (L.w / 2 + 1.5); b.p[2] += L.rz * (L.w / 2 + 1.5);
    for (let k = 0; k < 150 && g.state !== 'over'; k++) g.tick(1 / 30, false);
  });
}
// Films n pictures of the run (24 a second), the last `fall` of them while falling; picture k is
// at k meters, and the fastest one is number `top`.
async function film(page, n, fall, top) {
  await page.evaluate(async ([n, fall, top]) => {
    const g = window.__game, R = g.replay;
    g.render();
    for (let k = 0; k < n; k++) {
      R.capture(g.canvas, 1 / 24, k, k === top ? 40 : 10, k >= n - fall);
      while (R.pending > 2) await new Promise((r) => setTimeout(r, 4));
    }
    while (R.pending > 0) await new Promise((r) => setTimeout(r, 4));
  }, [n, fall, top]);
}
const shared = (page) => page.evaluate(async () => {
  const d = window.__shared.pop(), f = d.files && d.files[0];
  if (!f) return { text: d.text };
  const out = { text: d.text, name: f.name, type: f.type, size: f.size };
  if (f.type.startsWith('image')) { const im = await createImageBitmap(f); out.w = im.width; out.h = im.height; }
  return out;
});

test('the replay keeps the last 10 seconds whole and the run before as an even timelapse', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const R = window.__game.replay, b = new Blob(['x']);
    R.reset();
    const n = 60 * 24;                                            // one minute of pictures, the last 1.5 s falling
    for (let k = 0; k < n; k++) R.keep({ b, t: k / 24, dist: k / 2, speed: k === n - 100 ? 50 : k === n - 10 ? 60 : 10, fall: k >= n - 36 });
    const gaps = R.frames.slice(1).map((f, i) => f.t - R.frames[i].t);
    const T = R.timeline('real'), F = R.timeline('fast'), A = R.all();
    const mono = (X) => { let last = -1, ok = true; for (let t = 0; t < X.total; t += 0.05) { const a = R.at(X, t); if (a.i < last) ok = false; last = a.i; } return ok; };
    return {
      span: R.span, frames: R.frames.length, gapMin: Math.min(...gaps), gapMax: Math.max(...gaps), all: A.length,
      best: A[R.bestIndex()].t, real: [T.intro, T.main, T.end, T.outro, T.badge, T.seq.length], fast: [F.main, F.end, F.badge], mono: [mono(T), mono(F)],
      card: R.at(T, T.total - 0.1).ph, intro: R.at(T, 0.2).ph, fall: R.at(T, T.intro + T.main + 0.5).ph,
      sizes: [R.size('story', 1080), R.size('square', 720), R.size('wide', 720), R.size('story', 480)],
    };
  });
  expect(r.span).toBeCloseTo(10, 1);
  expect(r.frames).toBeGreaterThan(40); expect(r.frames).toBeLessThanOrEqual(90);
  expect(r.gapMax - r.gapMin).toBeLessThan(0.01);                // an even timelapse
  expect(r.best).toBeCloseTo((60 * 24 - 100) / 24, 3);            // the fastest moment before the fall (not the fall itself)
  expect(r.real[0]).toBe(0.7); expect(r.real[1]).toBeCloseTo(8.5, 1); expect(r.real[2]).toBeCloseTo(1.5, 1); expect(r.real[4]).toBe('1×');
  expect(r.real[5]).toBeGreaterThanOrEqual(240); expect(r.real[5]).toBeLessThanOrEqual(241);   // real speed: every picture of the last 10 s
  expect(r.fast[0]).toBeGreaterThan(4); expect(r.fast[0]).toBeLessThan(8);   // the timelapse: 12 pictures a second or more, 7 s at most expect(r.fast[1]).toBeCloseTo(1.5, 1);
  expect(r.fast[2]).toMatch(/^⏩ \d+×$/);
  expect(r.mono).toEqual([true, true]);
  expect([r.intro, r.fall, r.card]).toEqual([0, 2, 3]);
  expect(r.sizes).toEqual([[1080, 1920], [720, 720], [1280, 720], [480, 854]]);
});

test('SHARE opens a popup: a screenshot of the chosen moment or a video; DOWNLOAD and SHARE turn on after the choice', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openGame(page);
  await fallAt(page, 60);
  await film(page, 300, 20, 120);
  await expect(page.locator('#btnShare')).toHaveText('SHARE');
  await page.evaluate(() => { window.__shared = []; navigator.canShare = () => true; navigator.share = (d) => { window.__shared.push(d); return Promise.resolve(); }; });
  await page.click('#btnShare');
  await expect(page.locator('#shareBox')).toHaveClass(/open/);
  await expect(page.locator('#btnShDl')).toBeDisabled();
  await expect(page.locator('#btnShShare')).toBeDisabled();
  await expect(page.locator('.shTile')).toHaveText([/SCREENSHOT/, /VIDEO/]);
  // screenshot: the picker starts on the best moment, and the picture is ready at once
  await page.click('.shTile[data-kind="image"]');
  await expect(page.locator('#btnShShare')).toBeEnabled();
  await expect(page.locator('#btnShDl')).toBeEnabled();
  // (the pictures older than 10 s thinned out into the timelapse; picture k was filmed at k meters)
  const pick = await page.evaluate(() => { const A = window.__game.replay.all(); return [A.length - 1, A.findIndex((f) => f.dist === 120), A.findIndex((f) => f.dist === 200)]; });
  expect(pick[0]).toBeGreaterThan(240); expect(pick[1]).toBeGreaterThan(0);
  expect(await page.evaluate(() => [+document.getElementById('shFrame').max, +document.getElementById('shFrame').value])).toEqual(pick.slice(0, 2));
  await expect(page.locator('#shFrameLbl')).toHaveText('120 m');
  await page.locator('#shFrame').fill(String(pick[2]));
  await expect(page.locator('#shFrameLbl')).toHaveText('200 m');
  await page.click('#btnShShare');
  let s = await shared(page);
  expect(s).toMatchObject({ type: 'image/jpeg', w: 1080, h: 1920 });   // portrait screen: a story picture by default
  expect(s.name).toMatch(/^gyroll-\d+m\.jpg$/);
  expect(s.text).toContain('https://gyroll.vercel.app/');
  await page.click('#shFmt button[data-fmt="square"]');
  await page.click('#btnShShare');
  expect(await shared(page)).toMatchObject({ w: 1080, h: 1080 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnShDl')]);
  expect(dl.suggestedFilename()).toMatch(/\.jpg$/);
  // video: nothing to send until it is made; the settings line follows the choices
  await page.click('.shTile[data-kind="video"]');
  await expect(page.locator('#btnShShare')).toBeDisabled();
  await expect(page.locator('#btnShMake')).toBeVisible();
  await page.click('#shSpeed button[data-speed="real"]');
  await page.click('#shRes button[data-res="480"]');
  await expect(page.locator('#shInfo')).toContainText('The last 10 seconds');
  await expect(page.locator('#shInfo')).toContainText(/(MP4|WEBM) · 1[34] s/);
  await page.click('#btnShMake');
  await expect(page.locator('#btnShMake')).toContainText('CREATING');
  await page.waitForFunction(() => !!window.__game.shareBox.file, null, { timeout: 90_000 });
  await expect(page.locator('#btnShShare')).toBeEnabled();
  await expect(page.locator('#shVideo')).toBeVisible();
  await page.click('#btnShShare');
  s = await shared(page);
  expect(s.type).toMatch(/^video\/(mp4|webm)$/);
  // the video is 480 × 480, lasts the plan, and carries its own music (a real, non-silent signal)
  const v = await page.evaluate(async () => {
    const f = window.__game.shareBox.file, url = URL.createObjectURL(f), el = document.createElement('video');
    el.muted = true; el.src = url;
    await new Promise((r) => { el.onloadedmetadata = r; el.onerror = r; });
    const b = await new AudioContext().decodeAudioData(await f.arrayBuffer()), d = b.getChannelData(0);
    let e = 0; for (let i = 0; i < d.length; i++) e += d[i] * d[i];
    return { w: el.videoWidth, h: el.videoHeight, dur: b.duration, rms: Math.sqrt(e / d.length) };
  });
  expect([v.w, v.h]).toEqual([480, 480]);
  expect(v.dur).toBeGreaterThan(11); expect(v.rms).toBeGreaterThan(0.01);
  // another setting: the video is gone until it is made again
  await page.click('#shRes button[data-res="720"]');
  await expect(page.locator('#btnShShare')).toBeDisabled();
  await expect(page.locator('#shVideo')).toBeHidden();
  // ✕ closes the popup, back to the game over screen
  await page.click('#btnShClose');
  await expect(page.locator('#shareBox')).toBeHidden();
  await expect(page.locator('#btnRetry')).toBeVisible();
  expect(errors).toEqual([]);
});

test('without a share sheet, SHARE saves the file and copies the text with the link', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 1280, height: 720 });
  const errors = await openGame(page);
  await fallAt(page, 40);
  await film(page, 30, 5, 10);
  await page.evaluate(() => { delete Navigator.prototype.share; delete navigator.share; });
  await page.click('#btnShare');
  await page.click('.shTile[data-kind="image"]');
  await expect(page.locator('#btnShShare')).toBeEnabled();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnShShare')]);
  expect(dl.suggestedFilename()).toMatch(/\.jpg$/);
  await expect(page.locator('#btnShShare')).toContainText('LINK COPIED');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('https://gyroll.vercel.app/');
  // a wide screen makes wide pictures, and the popup is a card with the preview on the left
  const box = await page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); return { panel: r('shPanel'), view: r('shView'), side: r('shSide'), cv: r('shCanvas') }; });
  expect(box.panel.width).toBeLessThan(1280);
  expect(box.view.right).toBeLessThanOrEqual(box.side.left);
  expect(box.cv.width / box.cv.height).toBeCloseTo(16 / 9, 1);
  await page.keyboard.press('Escape');
  await expect(page.locator('#shareBox')).toBeHidden();
  expect(errors).toEqual([]);
});
