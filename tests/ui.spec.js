import { test, expect } from '@playwright/test';
import { openGame } from './helpers.js';

test.describe('French browser', () => {
  test.use({ locale: 'fr-FR', hasTouch: true, isMobile: true });
  test('language is detected and can be switched on the menu', async ({ page }) => {
    await openGame(page);
    await expect(page.locator('#btnTilt')).toHaveText('JOUER AVEC LE GYROSCOPE');
    await page.tap('#langSeg button[data-lang="en"]');
    await expect(page.locator('#btnTilt')).toHaveText('PLAY WITH GYROSCOPE');
    await page.reload(); await page.waitForFunction(() => window.__game);
    await expect(page.locator('#btnTilt')).toHaveText('PLAY WITH GYROSCOPE');   // choice is remembered
  });
});

test('music and sound toggles work independently', async ({ page }) => {
  await openGame(page);
  await page.click('.tgMusic');
  await page.click('#menu .tgSfx');
  const r = await page.evaluate(() => ({ music: window.__game.audio.musicOn, sfx: window.__game.audio.sfxOn, cls: document.querySelector('#menu .tgMusic').className }));
  expect(r.music).toBe(false); expect(r.sfx).toBe(false); expect(r.cls).toContain('off');
  await page.click('#menu .tgSfx');
  expect(await page.evaluate(() => window.__game.audio.sfxOn)).toBe(true);
});

test('skins can be changed from the pause menu', async ({ page }) => {
  await openGame(page);
  await page.click('#btnTilt');
  await page.evaluate(() => { const g = window.__game; g.halt = true; for (let k = 0; k < 40; k++) g.tick(1 / 30, false); g.pause(); });
  await expect(page.locator('#pause')).toBeVisible();
  await page.click('#skinsPause .skinRow:nth-child(1) .sw >> nth=2');
  await page.click('#skinsPause .skinRow:nth-child(2) .sw >> nth=3');
  expect(await page.evaluate(() => [window.__game.themeIdx, window.__game.skinIdx])).toEqual([2, 3]);
});

test('share text links to the production URL', async ({ page }) => {
  await openGame(page, '/?mode=daily');
  const texts = await page.evaluate(() => {
    const g = window.__game, out = [];
    navigator.share = (d) => { out.push(d.text); return Promise.resolve(); };
    navigator.canShare = () => true;
    g.shareInfo = { dist: 1284, score: 48920 }; g.shareSt = 'ready'; g.runDay = dayKey(); g.share();
    g.setGameMode('random'); g.shareInfo = { dist: 1284, score: 48920 }; g.shareSt = 'ready'; g.share();
    return out;
  });
  expect(texts[0]).toContain(PROD_URL_EXPECTED + '?mode=daily');
  expect(texts[1]).toContain(PROD_URL_EXPECTED);
});
const PROD_URL_EXPECTED = 'https://gyroll.vercel.app/';
