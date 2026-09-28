import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openGame, openOptions } from './helpers.js';

test.use({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

test('ABOUT opens from the options: the story, the real size of index.html and the links', async ({ page }) => {
  const errors = await openGame(page);
  // the build writes the file's own line count and size into it
  const file = readFileSync(new URL('../index.html', import.meta.url));
  const lines = file.toString('utf8').split('\n').length - 1, kb = Math.round(file.length / 1024);
  expect(await page.evaluate(() => BUILD_INFO)).toEqual({ lines, kb });
  expect(lines).toBeGreaterThan(5000);
  await expect(page.locator('#btnAbout')).toBeHidden();            // only in options mode
  await openOptions(page);
  await page.click('#btnAbout');
  const about = page.locator('#about');
  await expect(about).toHaveClass(/open/);
  // the circle grows from the button until the screen covers everything, over the options
  await expect.poll(() => page.evaluate(() => [[5, 5], [385, 775], [195, 400]].map(([x, y]) => !!document.elementFromPoint(x, y).closest('#about')))).toEqual([true, true, true]);
  // the rules and how it is made, as cards; no author name and no prompt story
  await expect(page.locator('.abSec h3')).toHaveText(['HOW TO PLAY', 'HOW IT IS MADE']);
  await expect(page.locator('.abCard h4')).toHaveText(['Roll, and don’t stop', 'Coins and star power', 'Checkpoints and modes', 'Close calls and boosts', 'Nine worlds', 'Tracks and marbles',
    'Written by an AI', '3D engine', 'Physics', 'Sound engine', 'Screenshots and videos', 'Gyroscope']);
  await expect(about).toContainText('Claude Code');
  // the AI card names the model, the effort level and what it cost
  await expect(page.locator('.abFacts dt')).toHaveText(['Model', 'Effort', 'Tokens', 'Cost']);
  await expect(page.locator('.abFacts dd')).toHaveText(['Claude Opus 5.5', 'Ultra code', /million read[^]*million written/, /^≈ US\$\d+ at API prices/]);
  for (const t of ['Erwann', 'Robin', 'prompt', '2026']) await expect(about).not.toContainText(t);
  // the numbers count up to the real values, while the marble rolls along the track it draws
  const marble = () => page.locator('#abMarble').getAttribute('transform');
  const m0 = await marble();
  await expect(page.locator('#abStats b')).toHaveText([fmt(lines), fmt(kb), '0']);
  await expect.poll(marble).not.toBe(m0);                           // it keeps rolling (poll: slow CI machines skip frames)
  expect(await page.evaluate(() => +getComputedStyle(document.getElementById('abPath')).strokeDashoffset.replace('px', ''))).toBeLessThan(1);
  await expect(page.locator('#abRepo')).toHaveAttribute('href', 'https://github.com/ErwannRobin/gyro');
  await expect(page.locator('#abX')).toHaveAttribute('href', 'https://x.com/diwann');
  for (const a of ['#abRepo', '#abX']) { await expect(page.locator(a)).toHaveAttribute('target', '_blank'); await expect(page.locator(a)).toHaveAttribute('rel', 'noopener'); }
  await expect(page.locator('#abX')).toContainText('@diwann');
  // ✕ closes it and the options are still there; Escape closes it too, without closing the options
  await page.click('#btnAboutClose');
  await expect(about).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('opts'))).toBe(true);
  await page.click('#btnAbout');
  await expect(about).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(about).toBeHidden();
  expect(await page.evaluate(() => document.getElementById('menu').classList.contains('opts'))).toBe(true);
  expect(errors).toEqual([]);
});

test('ABOUT in French, and it scrolls on a short landscape screen', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 380 });
  await page.addInitScript(() => localStorage.setItem('gyroll.lang', '"fr"'));
  const errors = await openGame(page);
  await openOptions(page);
  await expect(page.locator('#btnAbout')).toHaveText('À PROPOS');
  await page.click('#btnAbout');
  await expect(page.locator('.abSec h3')).toHaveText(['COMMENT JOUER', 'COMMENT C’EST FAIT']);
  await expect(page.locator('#about')).toContainText('Moteur sonore');
  await expect(page.locator('#abX')).toContainText('Suivre @diwann');
  const s = await page.evaluate(() => { const e = document.getElementById('abScroll'); return [e.scrollHeight > e.clientHeight, e.scrollWidth <= e.clientWidth]; });
  expect(s).toEqual([true, true]);
  expect(errors).toEqual([]);
});

test('ABOUT uses a wide screen: the cards stand in three columns', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = await openGame(page);
  await openOptions(page);
  await page.click('#btnAbout');
  await expect(page.locator('#about')).toHaveClass(/open/);
  const cols = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.abSec:first-of-type .abCard')].map((c) => c.getBoundingClientRect());
    return { tops: new Set(cards.slice(0, 3).map((r) => Math.round(r.top))).size, lefts: new Set(cards.map((r) => Math.round(r.left))).size, width: cards[0].width };
  });
  expect(cols).toEqual({ tops: 1, lefts: 3, width: expect.any(Number) });
  expect(cols.width).toBeGreaterThan(300);
  expect(errors).toEqual([]);
});
