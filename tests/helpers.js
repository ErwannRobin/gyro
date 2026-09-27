// Opens the game and collects page errors. Returns the error list (checked at the end of a test).
export async function openGame(page, url = '/') {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // the sky follows the real clock by default; tests use the fixed daytime sky unless they choose one
  await page.addInitScript(() => { if (localStorage.getItem('gyroll.tod') === null) localStorage.setItem('gyroll.tod', '"day"'); });
  await page.goto(url);
  await page.waitForFunction(() => window.__game && window.__game.R);
  return errors;
}

// Presses PLAY on the menu (closing the options sheet first if it is open).
export async function play(page) {
  if (await page.evaluate(() => document.getElementById('menu').classList.contains('opts'))) await page.click('#btnOpts');
  await page.click('#btnPlay');
}

// Opens the options sheet of the menu (kid mode, controls, time of day, pickers, language, sound).
// The live game loop is stopped first (tests drive it by hand): with software rendering each frame
// is slow, and clicks wait for steady frames.
export async function openOptions(page) {
  await page.evaluate(() => { window.__game.halt = true; });
  if (!(await page.evaluate(() => document.getElementById('menu').classList.contains('opts')))) await page.click('#btnOpts');
  await page.waitForFunction(() => getComputedStyle(document.getElementById('sheet')).visibility === 'visible');
}

// Runs inside the page: puts the ball at `dist` meters and prepares a playable frame there.
export function teleport(dist) {
  const g = window.__game, T = g.track, b = g.ball;
  g.gen.fill(dist + 400);
  const s = CFG.START_S + dist;
  for (const ch of g.chunks.values()) g.R.free(ch.mesh);
  g.chunks.clear(); g.nextChunk = Math.max(0, Math.floor((s - 60) / (CFG.CHUNK_ROWS * CFG.DS)));
  const p = [0, 0, 0, 0]; T.pointAt(s, 0, CFG.R, p);
  b.p[0] = p[0]; b.p[1] = p[1]; b.p[2] = p[2]; b.v[0] = Math.sin(p[3]) * 10; b.v[1] = 0; b.v[2] = Math.cos(p[3]) * 10;
  b.hint = Math.floor(s / CFG.DS); b.lost = false; b.grounded = true;
  const L = T.locate(b.p[0], b.p[2], b.hint); b.s = L.s; b.surfY = p[1] - CFG.R;
  g.maxS = b.s; g.dist = dist; g.collapseS = b.s - 45; g.runT = 10; g.state = 'play';
  g.env.reset(T, b.s, g.quality.cur.env, g.quality.cur.dust, g.R.meshes); g.floorY = b.surfY - 62;
  g.updateChunks(99); g.cam.snap(b, T, g.R.w / g.R.h); g.cam.mode = 'follow';
}
