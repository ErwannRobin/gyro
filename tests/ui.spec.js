import { test, expect } from '@playwright/test';
import { openGame, openOptions, play } from './helpers.js';

test.describe('French browser', () => {
  test.use({ locale: 'fr-FR', hasTouch: true, isMobile: true });
  test('language is detected and can be switched on the menu', async ({ page }) => {
    test.slow();                                                  // the game boots twice
    await openGame(page);
    await expect(page.locator('#btnPlay')).toHaveText('JOUER');
    await expect(page.locator('#modeSeg button[data-mode=random]')).toHaveText('ENTRAÎNEMENT');
    await openOptions(page);
    await expect(page.locator('#btnAbout')).toHaveText('À PROPOS');
    await page.tap('#langSeg button[data-lang="en"]');
    await expect(page.locator('#btnPlay')).toHaveText('PLAY');
    await expect(page.locator('#btnAbout')).toHaveText('ABOUT');
    await expect(page.locator('#modeSeg button[data-mode=random]')).toHaveText('TRAINING');
    await page.reload(); await page.waitForFunction(() => window.__game && window.__game.R);
    await page.evaluate(() => { window.__game.halt = true; });
    await expect(page.locator('#btnPlay')).toHaveText('PLAY');   // choice is remembered
  });
});

test('music and sound toggles work independently', async ({ page }) => {
  await openGame(page);
  await openOptions(page);
  await page.click('.tgMusic');
  await page.click('#menu .tgSfx');
  const r = await page.evaluate(() => ({ music: window.__game.audio.musicOn, sfx: window.__game.audio.sfxOn, cls: document.querySelector('#menu .tgMusic').className }));
  expect(r.music).toBe(false); expect(r.sfx).toBe(false); expect(r.cls).toContain('off');
  await page.click('#menu .tgSfx');
  expect(await page.evaluate(() => window.__game.audio.sfxOn)).toBe(true);
});

test('the pause screen has no skin pickers: they live in the menu options', async ({ page }) => {
  await openGame(page);
  await play(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; for (let k = 0; k < 40; k++) g.tick(1 / 30, false); g.pause(); });
  await expect(page.locator('#pause')).toBeVisible();
  await expect(page.locator('#pause .skins, #pause .sw')).toHaveCount(0);
  expect(await page.evaluate(() => [...document.querySelectorAll('#pause > *')].map((e) => e.id || e.className))).toEqual(['', 'btnResume', 'btnRecal', 'volRow', 'volRow', 'btnQuit']);
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
