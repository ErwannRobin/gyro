
// =====================================================================
// Game — state machine, main loop, glue between all systems.
// States: menu → calib → play → falling → over  (+ paused)
// =====================================================================
const GEM_COL = hex(0xffd36b), STAR_COL = [1, 0.82, 0.4];
class Game {
  constructor() {
    LANG = detectLang();
    this.ui = new UI();
    this.canvas = document.getElementById('c');
    try { this.R = new Renderer(this.canvas); } catch (e) {
      const d = document.createElement('div'); d.id = 'noGL';
      d.textContent = tr('noGL');
      document.body.appendChild(d); console.error(e); return;
    }
    this.mobile = InputManager.tiltLikely();
    this.quality = new QualityManager(this.mobile);
    this.track = new Track();
    this.ball = new Ball();
    this.physics = new Physics(this.track, this);
    this.cam = new CameraRig();
    this.input = new InputManager(this.canvas);
    this.audio = new AudioManager();
    this.parts = new ParticleSystem(this.quality.cur.particles);
    this.env = new Environment();
    this.fx = new FxBuilder();
    this.replay = new Replay();
    this.chunks = new Map(); this.nextChunk = 0;
    this.themeIdx = clamp(Store.get('theme', 0) | 0, 0, TRACK_THEMES.length - 1);
    this.skinIdx = clamp(Store.get('skin', 0) | 0, 0, BALL_SKINS.length - 1);
    let qm;
    try { qm = new URLSearchParams(location.search).get('mode'); } catch (e) { qm = null; }
    this.gameMode = (qm === 'daily' || qm === 'random' ? qm : Store.get('mode', 'random')) === 'daily' ? 'daily' : 'random';
    this.kid = Store.get('kid', false) === true;
    // Random mode is one endless track per player: after a fall the next run starts again at the last checkpoint.
    this.rSeed = (Store.get('rseed', 0) | 0) || this.newSeed();
    this.contS = Math.max(CFG.START_S, +Store.get('rpos', 0) || 0);
    this.best = this.modeBest();
    this.bestScore = Math.max(0, +Store.get('bestScore', 0) || 0);
    this.state = 'menu'; this.time = 0; this.timeScale = 1; this.acc = 0; this.used = false; this.mode = 'touch';
    this.model = M4.create(); this.tmp = [0, 0, 0, 0]; this.q = [0, 0, 0, 1]; this.qi = [0, 0, 0, 1];
    this.q2 = [0, 0, 0, 1]; this.qCoin = Q.fromAxisAngle([0, 0, 0, 1], 1, 0, 0, Math.PI / 2);   // coins stand on their edge
    this.railPts = [[0, 0, 0], [0, 0, 0]]; this.starK = 0; this.starKey = false;
    this.gemGlow = new Float32Array(96 * 3); this.gemGlowN = 0;
    this.collapseS = -1e9; this.danger = 0; this.warnT = 0; this.pruneT = 0; this.emitAcc = 0;
    this.R.setTheme(TRACK_THEMES[this.themeIdx]);
    this.R.setZones(0, 0, 0); this.zoneIdx = 0; this.floorY = 0;
    this.ui.setAccent(TRACK_THEMES[this.themeIdx]);
    this.bindUI();
    this.resize(true);
    this.newWorld();
    this.bindWindow();
    this.setupPWA();
    Analytics.init();
    this.last = performance.now();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  // ------------------------------------------------------------- setup
  bindUI() {
    const U = this.ui, E = U.el, $ = U.$;
    const tap = (el, fn) => el.addEventListener('click', (e) => { e.preventDefault(); fn(e); });
    for (const b of document.querySelectorAll('#langSeg button')) tap(b, () => { LANG = b.dataset.lang; Store.set('lang', LANG); this.refreshTexts(); this.audio.tick(); });
    tap($('tgKid'), () => { if (this.state === 'menu') { this.setKid(!this.kid); this.audio.tick(); } });
    tap(E.newTrack, () => { if (this.state === 'menu') { this.newTrack(); this.audio.tick(); } });
    for (const b of document.querySelectorAll('#modeSeg button')) tap(b, () => { if (this.state === 'menu' && b.dataset.mode !== this.gameMode) { this.setGameMode(b.dataset.mode); this.audio.tick(); } });
    const toggles = () => U.setToggles(this.audio.musicOn, this.audio.sfxOn);
    for (const b of document.querySelectorAll('.tgMusic')) tap(b, () => { this.audio.init(); this.audio.setMusic(!this.audio.musicOn); toggles(); });
    for (const b of document.querySelectorAll('.tgSfx')) tap(b, () => { this.audio.init(); this.audio.setSfx(!this.audio.sfxOn); toggles(); this.audio.tick(); });
    toggles();
    if (!this.mobile) E.btnTouch.classList.add('hidden');
    tap(E.btnTilt, () => {
      if (this.state !== 'menu' || this.busy) return;
      this.audio.init();
      if (!this.mobile) { this.input.tilt = false; this.startRun('keys'); return; }
      this.busy = true; E.btnTilt.style.opacity = 0.6;
      this.input.requestTilt().then((r) => {
        this.busy = false; E.btnTilt.style.opacity = '';
        if (r.ok) { this.input.tilt = true; E.perm.classList.add('hidden'); this.startRun('tilt'); }
        else {
          this.input.tilt = false;
          E.perm.textContent = tr(r.reason === 'denied' ? 'permDenied' : 'permNone');
          E.perm.classList.remove('hidden');
          setTimeout(() => this.startRun('touch'), 900);
        }
      });
    });
    tap(E.btnTouch, () => { if (this.state !== 'menu') return; this.audio.init(); this.input.tilt = false; this.startRun('touch'); });
    tap($('btnPause'), () => this.pause());
    tap($('btnResume'), () => this.resume(false));
    tap(E.recal, () => this.resume(true));
    tap($('btnQuit'), () => this.goMenu());
    tap($('btnRetry'), () => { if (this.state === 'over') { this.audio.init(); this.startRun(this.mode); } });
    tap($('btnMenu'), () => this.goMenu());
    tap(E.share, () => this.share());
    tap(E.power, () => this.tryStar());
    const vs = $('volSfx'), vm = $('volMusic');
    vs.value = Math.round(this.audio.sfxVol * 100); vm.value = Math.round(this.audio.musicVol * 100);
    const vol = () => this.audio.setVolumes(vs.value / 100, vm.value / 100);
    vs.addEventListener('input', vol); vm.addEventListener('input', vol);
    const onTrack = (i) => {
      if (i === this.themeIdx) return;
      this.themeIdx = i; Store.set('theme', i);
      this.R.setTheme(TRACK_THEMES[i]); U.setAccent(TRACK_THEMES[i]); U.selectSkins(this.themeIdx, this.skinIdx); this.audio.tick();
      if (this.state === 'paused') this.render();
    };
    const onBall = (i) => { this.skinIdx = i; Store.set('skin', i); U.selectSkins(this.themeIdx, this.skinIdx); this.audio.tick(); if (this.state === 'paused') this.render(); };
    U.buildSkins('skinsMenu', onTrack, onBall); U.buildSkins('skinsPause', onTrack, onBall);
    U.selectSkins(this.themeIdx, this.skinIdx);
    this.refreshTexts();
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if ((k === 'escape' || k === 'p') && (this.state === 'play' || this.state === 'calib')) this.pause();
      else if (k === ' ' && this.state === 'play') this.starKey = true;
      else if ((k === 'escape' || k === 'p' || k === 'enter') && this.state === 'paused') this.resume(false);
      else if ((k === ' ' || k === 'enter') && this.state === 'menu' && !this.mobile) { this.audio.init(); this.input.tilt = false; this.startRun('keys'); }
      else if ((k === ' ' || k === 'enter') && this.state === 'over' && this.overT > 0.6) { this.audio.init(); this.startRun(this.mode); }
    });
  }
  refreshTexts() {
    const U = this.ui, E = U.el;
    U.applyLang();
    E.btnTilt.textContent = tr(this.mobile ? 'playGyro' : 'play');
    const cont = this.gameMode === 'random' && this.contS > CFG.START_S + 5;
    U.setMode(this.gameMode, this.gameMode === 'daily' ? tr('infoDaily', { date: dayLabel(dayKey()) }) : cont ? tr('infoContinue', { d: fmt(this.contS - CFG.START_S) }) : tr('infoRandom'));
    E.newTrack.classList.toggle('hidden', !cont);
    E.mBest.textContent = fmt(this.modeBest()) + ' m';
    const kb = U.$('tgKid'); kb.classList.toggle('off', !this.kid); kb.title = tr('kidInfo');
    if (this.shareSt) U.shareState(this.shareSt, this.shareP || 0);
  }
  // ------------------------------------------------------------- game modes
  setGameMode(m) {
    this.gameMode = m === 'daily' ? 'daily' : 'random'; Store.set('mode', this.gameMode);
    this.best = this.modeBest(); this.refreshTexts();
    this.newWorld(); this.used = false;
  }
  // Kid mode (side rails) keeps its own records so they never mix with real ones.
  setKid(on) {
    this.kid = !!on; Store.set('kid', this.kid);
    this.best = this.modeBest(); this.refreshTexts();
    this.newWorld(); this.used = false;
  }
  modeBest() {
    const k = this.kid ? '_kid' : '';
    if (this.gameMode === 'daily') { const d = Store.get('daily' + k, null); return d && d.day === dayKey() ? Math.max(0, +d.best || 0) : 0; }
    return Math.max(0, +Store.get('bestDist' + k, 0) || 0);
  }
  saveBest(dist) {
    const k = this.kid ? '_kid' : '';
    if (this.gameMode === 'daily') Store.set('daily' + k, { day: this.runDay, best: dist });
    else Store.set('bestDist' + k, dist);
  }
  runSeed() {
    if (this.gameMode === 'daily') { this.runDay = dayKey(); return dailySeed(this.runDay); }
    return this.rSeed;
  }
  newSeed() { const s = ((Math.random() * 1e9) | 0) || 1; Store.set('rseed', s); return s; }
  newTrack() {
    this.rSeed = this.newSeed(); this.contS = CFG.START_S; Store.set('rpos', this.contS);
    this.refreshTexts(); this.newWorld(); this.used = false;
  }
  bindWindow() {
    const onResize = () => { clearTimeout(this.rt); this.rt = setTimeout(() => this.resize(), 80); };
    window.addEventListener('resize', onResize); window.addEventListener('orientationchange', onResize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { if (this.state === 'play' || this.state === 'calib') this.pause(); this.audio.suspend(); }
      else { if (this.state !== 'paused') this.audio.resume(); if (this.state === 'play') this.lockWake(); }
    });
    window.addEventListener('blur', () => { if (this.state === 'play' && !this.mobile) this.pause(); });
    window.addEventListener('pagehide', () => this.audio.suspend());
    document.addEventListener('touchmove', (e) => { if (!(e.target instanceof HTMLInputElement)) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.glLost = true; if (this.state === 'play') this.pause(); });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.glLost = false;
      try {
        this.R.initGL(); this.R.fbo = null; this.R.w = 0; this.resize(true);
        this.chunks.clear();
        this.nextChunk = Math.max(0, Math.floor((this.ball.s - CFG.BEHIND) / (CFG.CHUNK_ROWS * CFG.DS)));
        this.updateChunks(99);
      } catch (err) { console.error(err); }
    });
  }
  resize(force) {
    const w = window.innerWidth, h = window.innerHeight, q = this.quality.cur;
    if (force || this.R.post !== q.post || this.R.bloomDiv !== q.bloomDiv) { this.R.freeFBO(); this.R.w = 0; }
    this.R.post = q.post; this.R.bloomDiv = q.bloomDiv;
    this.R.resize(w, h, this.quality.pixelScale(w, h));
  }
  applyQuality() {
    const q = this.quality.cur;
    this.parts.max = Math.min(q.particles, this.parts.cap); if (this.parts.n > this.parts.max) this.parts.n = this.parts.max;
    this.env.setDust(q.dust); this.env.density = clamp(q.env / 22, 0.4, 1.2);
    this.resize(true);
  }

  // ------------------------------------------------------------- world
  newWorld(seed, s0 = CFG.START_S) {
    if (seed === undefined) { seed = this.runSeed(); if (this.gameMode === 'random') s0 = this.contS; }
    for (const ch of this.chunks.values()) this.R.free(ch.mesh);
    this.chunks.clear();
    this.track.reset();
    this.gen = new TrackGenerator(this.track, seed);
    this.gen.fill(s0 + CFG.AHEAD + 40);
    const O = this.track.objects;
    if (s0 > CFG.START_S) {
      // runs only restart on a checkpoint gate: the last one at or before s0 (or the very start)
      let cs = CFG.START_S; for (const o of O) if (o.kind === 'gate' && o.s <= s0 + 0.5 && o.s > cs) cs = o.s;
      s0 = cs;
      if (this.gameMode === 'random' && this.contS !== s0) { this.contS = s0; Store.set('rpos', s0); this.refreshTexts(); }
      for (const o of O) if (o.kind === 'gate' && o.s <= s0 + 0.5) o.passed = true;
    }
    this.nextChunk = Math.max(0, Math.floor((s0 - CFG.BEHIND) / (CFG.CHUNK_ROWS * CFG.DS)) - 1);
    let w = 0; for (let k = 0; k < O.length; k++) if (O[k].s > s0 - 60) O[w++] = O[k]; O.length = w;
    const b = this.ball; b.reset();
    this.track.pointAt(s0, 0, CFG.R, this.tmp);
    b.p[0] = this.tmp[0]; b.p[1] = this.tmp[1]; b.p[2] = this.tmp[2]; b.hint = Math.floor(s0 / CFG.DS);
    const L = this.track.locate(b.p[0], b.p[2], b.hint); b.s = L.s; b.u = L.u; b.surfY = this.tmp[1] - CFG.R;
    this.physics.collapseS = this.collapseS = -1e9; this.physics.kid = this.kid; this.physics.time = 0;
    this.lastCP = b.s; this.lookRef = null;
    this.startS = b.s; this.maxS = b.s; this.score = 0; this.dist = 0; this.mult = 1; this.recordShown = false;
    this.danger = 0; this.timeScale = 1; this.acc = 0; this.runT = 0;
    // star power: coins fill the gauge, a streak of coins raises the coin multiplier
    this.power = 0; this.star = false; this.physics.star = false; this.starK = 0; this.starN = 0;
    this.coinStreak = 0; this.coinMult = 1; this.coins = 0;
    this.input.flick = this.input.doubleTap = this.starKey = false;
    this.audio.setTempo(1); this.ui.updatePower(0, 1, 'fill', '');
    this.parts.clear();
    this.replay.reset(); this.shareToken = (this.shareToken || 0) + 1; this.shareFile = null; this.shareInfo = null;
    this.updateChunks(99);
    this.env.reset(this.track, b.s, this.quality.cur.env, this.quality.cur.dust, this.R.meshes);
    this.floorY = b.surfY - 62; this.zoneIdx = 0; this.R.setZones(0, 0, 0);
    this.fx.resetTrail(b.p);
    this.R.resetProbe();
    this.cam.snap(b, this.track, this.R.w / this.R.h);
  }
  updateChunks(maxBuild) {
    const T = this.track, CR = CFG.CHUNK_ROWS, b = this.ball;
    let built = 0;
    while ((this.nextChunk + 1) * CR + 1 < T.n && built < maxBuild) {
      const c = this.nextChunk++;
      if ((c + 1) * CR * CFG.DS < b.s - CFG.BEHIND || c * CR < T.minIndex()) continue;
      const res = TrackMesher.build(T, c, this.kid);
      this.chunks.set(c, { mesh: this.R.upload(res.mb), cx: res.cx, cy: res.cy, cz: res.cz, rad: res.rad, sEnd: res.sEnd });
      built++;
    }
    for (const [c, ch] of this.chunks) if (ch.sEnd < b.s - CFG.BEHIND - 20) { this.R.free(ch.mesh); this.chunks.delete(c); }
  }

  // ------------------------------------------------------------- flow
  startRun(mode) {
    this.mode = mode;
    if (this.used || this.state !== 'menu') this.newWorld();
    this.used = true;
    const U = this.ui, E = U.el;
    if (this.gameMode === 'daily' && this.runDay !== dayKey()) this.newWorld();   // the day changed
    this.best = this.modeBest();
    U.show('menu', false); U.show('over', false); U.show('pause', false);
    U.hud(true);
    U.el.ctrl.textContent = tr(mode === 'tilt' ? 'ctrlTilt' : mode === 'keys' ? 'ctrlKeys' : 'ctrlTouch') + (this.kid ? ' · 🛡 ' + tr('kidTag') : '');
    E.recal.classList.toggle('hidden', mode !== 'tilt');
    this.input.enabled = true; this.input.release();
    this.cam.mode = 'follow';
    this.beginCountdown(mode === 'tilt', mode === 'tilt' ? 1.5 : 0.7);
    if (mode !== 'tilt') {
      U.el.touchHint.textContent = tr(mode === 'keys' ? 'keysHint' : 'touchHint');
      U.el.touchHint.classList.remove('hidden'); U.el.touchHint.style.opacity = 1;
      clearTimeout(this.hintT); this.hintT = setTimeout(() => { U.el.touchHint.style.opacity = 0; }, 3500);
    } else U.el.touchHint.classList.add('hidden');
    this.lockWake();
    Analytics.event('run_start', { mode: this.gameMode, control: mode, kid: this.kid });
  }
  beginCountdown(calibrate, dur) {
    this.state = 'calib'; this.calibT = 0; this.calibDur = dur; this.calibrating = calibrate; this.lastNum = -1;
    const U = this.ui;
    if (calibrate) {
      this.input.startCalibration();
      U.el.calibTxt.textContent = tr('calib'); U.el.calibSub.textContent = tr('calibSub');
      U.show('calib', true);
    }
  }
  updateCountdown(dt) {
    const half = this.calibT < this.calibDur * 0.45;
    this.calibT += dt;
    // only the last part of the window counts as "neutral" (the hand settles after the tap)
    if (this.calibrating && half && this.calibT >= this.calibDur * 0.45) this.input.startCalibration();
    const left = this.calibDur - this.calibT;
    if (this.calibrating || this.showReady) {
      const n = Math.max(1, Math.ceil(left / (this.calibDur / 3)));
      if (n !== this.lastNum) { this.lastNum = n; this.ui.el.calibNum.textContent = n; this.audio.tick(); }
    }
    if (left <= 0) {
      if (this.calibrating) this.input.endCalibration();
      this.ui.show('calib', false); this.showReady = false;
      this.state = 'play'; this.ui.go(); this.audio.go();
      if (this.collapseS < -1e8) { this.collapseS = this.startS - 32; this.runT = 0; }
    }
  }
  pause() {
    if (this.state !== 'play' && this.state !== 'calib') return;
    if (this.state === 'calib' && this.calibrating) { this.input.calib = null; this.ui.show('calib', false); }
    this.state = 'paused'; this.input.release(); this.input.enabled = false;
    this.ui.show('pause', true); this.audio.suspend(); this.unlockWake();
  }
  resume(recal) {
    if (this.state !== 'paused') return;
    this.ui.show('pause', false); this.audio.init(); this.audio.resume();
    this.input.enabled = true;
    this.beginCountdown(recal && this.input.tilt, recal && this.input.tilt ? 1.5 : 0.8);
    if (!(recal && this.input.tilt)) { this.ui.el.calibTxt.textContent = tr('ready'); this.ui.el.calibSub.textContent = ''; this.ui.show('calib', true); this.calibrating = false; this.showReady = true; }
    this.lockWake();
  }
  goMenu() {
    this.state = 'menu'; this.input.enabled = false; this.input.release();
    const U = this.ui;
    U.show('pause', false); U.show('over', false); U.show('calib', false); U.show('menu', true); U.hud(false);
    U.el.touchHint.classList.add('hidden');
    this.best = this.modeBest(); this.refreshTexts();
    this.audio.resume();
    this.newWorld(); this.used = false; this.cam.mode = 'orbit';
    this.unlockWake();
  }
  finishRun() {
    this.state = 'over'; this.overT = 0;
    this.input.enabled = false; this.input.release(); this.unlockWake();
    const dist = Math.floor(this.dist), score = Math.floor(this.score);
    const beat = dist > Math.floor(this.best);
    if (beat) { this.best = dist; this.saveBest(dist); }
    const record = beat && dist >= 10;                 // no fanfare for trivial distances
    if (score > this.bestScore) { this.bestScore = score; Store.set('bestScore', score); }
    if (this.gameMode === 'random') { this.contS = this.lastCP; Store.set('rpos', this.contS); }
    const U = this.ui, E = U.el;
    E.ovDist.textContent = fmt(dist); const sm = document.createElement('small'); sm.textContent = 'm'; E.ovDist.appendChild(sm);
    E.ovScore.textContent = 'SCORE ' + fmt(score);
    E.ovBest.textContent = 'BEST '; const bb = document.createElement('b'); bb.textContent = fmt(this.best) + ' m'; E.ovBest.appendChild(bb);
    this.prepareShare(record);
    Analytics.event('game_over', { mode: this.gameMode, control: this.mode, zone: ZONES[zoneAt(this.maxS)].id, from: Math.floor((this.startS - CFG.START_S) / 100) * 100, meters: Math.floor(dist / 50) * 50, record: !!record, kid: this.kid, stars: this.starN });
    E.ovRails.textContent = tr('kidBadge'); E.ovRails.classList.toggle('hidden', !this.kid);
    E.ovMode.textContent = this.gameMode === 'daily' ? tr('dailyTag', { date: dayLabel(this.runDay || dayKey()) }) : tr('randomTag');
    E.record.classList.add('hidden');
    U.hud(false); U.el.danger.style.opacity = 0; U.cache.dg = '0.00';
    U.show('over', true);
    if (record) {
      void E.record.offsetWidth; E.record.classList.remove('hidden');
      this.audio.record(); U.flash(0.55, 'rgb(255,215,120)');
      const c = this.cam.look;
      for (let k = 0; k < 90; k++) {
        const col = [GEM_COL, TRACK_THEMES[this.themeIdx].accent, TRACK_THEMES[this.themeIdx].accent2, [1, 1, 1]][k & 3];
        this.parts.emit(c[0], c[1] + 1, c[2], (Math.random() - 0.5) * 16, Math.random() * 12 + 2, (Math.random() - 0.5) * 16, 2.2, col, 0.22, 9, 0.8);
      }
    } else this.audio.gameOver();
  }

  // ------------------------------------------------------------- physics events
  hit(b, impact, pos) {
    this.audio.hit(impact);
    const n = Math.min(26, 5 + impact * 2) | 0;
    this.parts.burst(pos[0], pos[1], pos[2], n, 3 + impact * 0.6, [1, 0.75, 0.4], { life: 0.5, size: 0.07, grav: 14, mix: [1, 1, 1], up: 1.5 });
    this.cam.shake = Math.min(1, this.cam.shake + impact / 12);
    if (impact > 5 && navigator.vibrate) try { navigator.vibrate(12); } catch (e) { /* ignore */ }
  }
  land(b, imp) {
    if (imp < 2) return;
    this.audio.land(imp);
    const T = TRACK_THEMES[this.themeIdx];
    this.parts.burst(b.p[0], b.p[1] - CFG.R, b.p[2], Math.min(20, imp * 2) | 0, 2 + imp * 0.2, T.accent, { life: 0.5, size: 0.08, grav: 4, up: 0.8 });
    this.cam.shake = Math.min(1, this.cam.shake + imp / 25);
  }
  railJump(b, impact, pos) {
    this.audio.hit(impact * 1.3);
    this.parts.burst(pos[0], pos[1], pos[2], 24, 5, [1, 0.6, 0.3], { life: 0.6, size: 0.09, grav: 12, mix: [1, 1, 1], up: 2 });
    this.cam.shake = Math.min(1, this.cam.shake + 0.5);
    this.ui.toast(tr('tooFast'), 'pink', true);
  }
  boost(b) {
    this.audio.boost(); this.cam.kick = 1; this.ui.flash(0.12, 'rgb(160,240,255)');
    const T = TRACK_THEMES[this.themeIdx];
    this.parts.burst(b.p[0], b.p[1], b.p[2], 24, 5, T.accent2, { life: 0.6, size: 0.1, grav: 0, vx: -b.v[0] * 0.3, vz: -b.v[2] * 0.3, mix: [1, 1, 1] });
    this.ui.toast('BOOST', 'pink');
  }
  lost(b, reason) {
    if (this.state !== 'play') return;
    this.state = 'falling'; this.fallT = 0; this.timeScale = 0.3;
    this.endStar(true);
    this.cam.mode = 'fall';
    this.audio.fall(); this.audio.setRoll(0, false);
    const T = TRACK_THEMES[this.themeIdx], sk = BALL_SKINS[this.skinIdx];
    this.parts.burst(b.p[0], b.p[1], b.p[2], 60, 6, sk.glow, { life: 1.4, size: 0.14, grav: 3, mix: T.accent, drag: 1.2 });
    this.ui.flash(0.3, 'rgb(255,80,110)');
    if (navigator.vibrate) try { navigator.vibrate([40, 40, 90]); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------- per-frame logic
  frame(now) {
    requestAnimationFrame(this.frame);
    const dtR = clamp((now - this.last) / 1000, 0, 0.05); this.last = now;
    if (this.glLost || this.halt || !dtR) return;
    this.tick(dtR, true);
  }
  tick(dtR, draw) {
    this.frameDt = dtR;
    this.quality.sample(dtR);
    if (this.quality.changed) { this.quality.changed = false; this.applyQuality(); }
    this.time += dtR;
    this.input.update(dtR);
    const st = this.state, b = this.ball;
    if (st === 'calib') this.updateCountdown(dtR);
    if (st === 'falling') {
      this.fallT += dtR;
      this.timeScale = this.fallT < 0.7 ? 0.3 : lerp(0.3, 1, clamp((this.fallT - 0.7) / 0.7, 0, 1));
      if (this.fallT > 1.8) this.finishRun();
    } else this.timeScale = 1;
    if (st === 'over') this.overT = (this.overT || 0) + dtR;
    const dt = dtR * this.timeScale;
    const sim = st === 'play' || st === 'falling' || st === 'over';

    if (st === 'play') {
      this.runT += dt;
      const d = this.gen.diff(this.maxS);
      const vc = lerp(2.4, 6.2, d) * clamp((this.runT - 2) / 4, 0, 1);
      this.collapseS = fin(Math.max(this.collapseS + vc * dt, this.maxS - 55), this.maxS - 55);
      this.physics.collapseS = this.collapseS;
      const gap = b.s - this.collapseS;
      this.danger = clamp(1 - (gap - 3) / 11, 0, 1);
      this.warnT -= dt;
      if (this.danger > 0.45 && this.warnT <= 0) { this.audio.warn(); this.warnT = lerp(0.7, 0.25, this.danger); }
    } else if (st !== 'paused') this.danger = Math.max(0, this.danger - dtR * 2);

    if (sim) {
      const h = 1 / 120; let n = 0;
      const ix = st === 'play' ? this.input.x : 0, iy = st === 'play' ? this.input.y : 0;
      this.acc += dt;
      while (this.acc >= h && n < 10) { this.physics.step(b, ix, iy, this.cam.yaw, h); this.acc -= h; n++; }
      if (n >= 10) this.acc = 0;
    }
    if (st === 'menu') this.menuLook(); else this.cam.gyroLook = this.lookRef = null;
    if (st === 'play') { this.progress(dt); this.updateStar(dt); }
    else this.input.flick = this.input.doubleTap = this.starKey = false;
    this.starK += ((this.star ? 1 : 0) - this.starK) * damp(7, dtR);
    if (st !== 'paused') {
      this.gen.fill(b.s + CFG.AHEAD);
      this.updateChunks(1);
      this.updateZones(dtR);
      this.env.update(this.track, b.s, dt, this.R.meshes, () => this.bolt());
      this.floorY = lerp(this.floorY, b.surfY - 62, damp(0.4, dtR));
      this.pruneT -= dtR;
      if (this.pruneT <= 0) { this.pruneT = 2; const o = this.track.objects, cut = b.s - 60; let w = 0; for (let k = 0; k < o.length; k++) if (o[k].s > cut) o[w++] = o[k]; o.length = w; }
      this.parts.update(dt);
      this.fx.pushTrail(b.p, dt);
      this.cam.update(st === 'falling' ? dtR : dtR, b, this.track, this.R.w / this.R.h);
      this.audio.intensity = lerp(this.audio.intensity, st === 'play' ? clamp(b.speed / CFG.VMAX, 0.15, 1) : 0.15, damp(0.5, dtR));
      this.rollT = (this.rollT || 0) + dtR;
      if (this.rollT > 0.05) { this.rollT = 0; this.audio.setRoll(b.speed, st === 'play' && b.grounded && b.support); }
    }
    // while the replay video is being encoded, draw the backdrop at half rate
    if (draw && st === 'over' && this.shareSt === 'busy' && (this.halfTick = !this.halfTick)) draw = false;
    if (draw) {
      this.render();
      if (st === 'play' || st === 'falling') this.replay.capture(this.canvas, dtR, this.dist, st === 'falling');
    }
    this.ui.frame(dtR, this.danger);
    if (st === 'play' || st === 'calib') {
      this.ui.updateHud(this.dist, this.score, Math.max(this.best, this.dist), b.speed, this.mult, b.boost);
      this.ui.updatePower(this.power, this.coinMult, this.star ? 'on' : this.power >= 1 ? 'ready' : 'fill',
        tr(this.mode === 'tilt' ? 'starGo' : this.mode === 'keys' ? 'starGoKeys' : 'starGoTouch'));
    }
  }

  progress(dt) {
    const b = this.ball, T = this.track;
    if (!b.lost && b.s > this.maxS) {
      const ds = Math.min(b.s - this.maxS, 3);
      this.maxS += ds; this.score += ds * 10 * this.mult * (this.star ? 2 : 1);
    }
    this.dist = this.maxS - this.startS;
    const sp = b.speed, m = Math.max(b.boost > 0 ? 4 : 1, sp >= 30 ? 5 : sp >= 20 ? 4 : sp >= 12 ? 3 : sp >= 8 ? 2 : 1);
    if (m !== this.mult) { if (m > this.mult && m >= 3) this.audio.tick(); this.mult = m; }
    if (!this.recordShown && this.best >= 30 && this.dist > this.best) {
      this.recordShown = true; this.ui.toast(tr('record'), 'gold', true); this.ui.flash(0.25, 'rgb(255,215,120)'); this.audio.checkpoint();
    }
    // coins & checkpoints
    for (const o of T.objects) {
      if (o.kind === 'gem') {
        if (o.taken || o.missed) continue;
        if (Math.abs(o.s - b.s) < 2.5) {
          T.pointAt(o.s, o.u, o.h, this.tmp);
          if (Math.hypot(this.tmp[0] - b.p[0], this.tmp[1] - b.p[1], this.tmp[2] - b.p[2]) < CFG.R + 0.5) this.coin(o);
        } else if (b.s > o.s + 2.5 && o.s > this.startS) this.coinMissed(o);
      } else if (o.kind === 'gate' && !o.passed && this.maxS >= o.s) {
        o.passed = true; this.lastCP = o.s; this.score += 1000; this.audio.checkpoint();
        this.ui.toast('CHECKPOINT · ' + fmt(o.cp) + ' m', 'cyan', true); this.ui.flash(0.22, 'rgb(170,245,255)');
        T.pointAt(o.s, 0, 2.6, this.tmp);
        const th = TRACK_THEMES[this.themeIdx];
        this.parts.burst(this.tmp[0], this.tmp[1], this.tmp[2], 50, 6, th.accent, { life: 1.2, size: 0.12, grav: 6, mix: GEM_COL });
      }
    }
    // rolling sparks / boost streaks / acceleration dust
    const th = TRACK_THEMES[this.themeIdx];
    if (b.grounded && b.support) {
      const rate = (b.speed > 11 ? (b.speed - 11) * 4 : 0) + (b.boost > 0 ? 45 : 0) + (this.input.y > 0.5 && b.speed > 4 && b.speed < 11 ? 6 : 0);
      this.emitAcc += rate * dt;
      while (this.emitAcc >= 1) {
        this.emitAcc -= 1;
        const bo = b.boost > 0 && Math.random() < 0.6;
        const col = bo ? th.accent2 : Math.random() < 0.5 ? th.accent : [1, 0.9, 0.7];
        this.parts.emit(b.p[0] + (Math.random() - 0.5) * 0.3, b.p[1] - CFG.R * 0.85, b.p[2] + (Math.random() - 0.5) * 0.3,
          -b.v[0] * 0.25 + (Math.random() - 0.5) * 1.5, Math.random() * 1.8, -b.v[2] * 0.25 + (Math.random() - 0.5) * 1.5,
          bo ? 0.5 : 0.35, col, bo ? 0.1 : 0.06, 7, 2);
      }
    }
  }

  // Phone motion on the menu: turning the phone walks the camera around the ball, tilting it
  // raises or lowers the camera. The way the phone is held when the menu opens is the reference.
  menuLook() {
    const I = this.input;
    if (!I.raw || performance.now() - I.lastEvt > 600) { this.cam.gyroLook = this.lookRef = null; return; }
    if (!this.lookRef) this.lookRef = { h: I.heading, p: I.pitch, x: I.sx };
    const R = this.lookRef, L = this.lookV || (this.lookV = { yaw: 0, pitch: 0 });
    L.yaw = I.heading !== null && R.h !== null ? wrapAngle(I.heading - R.h) : clamp((I.sx - R.x) * 2.2, -1.6, 1.6);
    L.pitch = I.pitch - R.p;
    this.cam.gyroLook = L;
  }

  // ------------------------------------------------------------- coins & star power
  // Every coin fills the star gauge; coins taken in a row raise the coin multiplier (faster gauge,
  // more points). Missing a single coin resets it. A full gauge is fired with a quick tilt up
  // (or double-tap / Space / tapping the gauge): safety rails appear, the ball lights up, the
  // music speeds up and the score doubles until the gauge is empty.
  coin(o) {
    o.taken = true; this.coins++;
    this.coinStreak++;
    const cm = Math.min(4, 1 + Math.floor(this.coinStreak / CFG.COIN_STEP)), up = cm > this.coinMult;
    this.coinMult = cm;
    const pts = 250 * cm * (this.star ? 2 : 1); this.score += pts;
    this.audio.gem();
    this.parts.burst(this.tmp[0], this.tmp[1], this.tmp[2], 16 + cm * 6, 4, GEM_COL, { life: 0.7, size: 0.1, grav: 2, mix: [1, 1, 1] });
    this.ui.toast('+' + fmt(pts), 'gold');
    if (up) this.ui.toast(tr('combo', { n: cm }), 'gold');
    if (!this.star && this.power < 1) {
      this.power = Math.min(1, this.power + CFG.COIN_POWER * cm);
      if (this.power >= 1) { this.audio.starReady(); this.ui.toast(tr('starReady'), 'gold'); }
    }
  }
  coinMissed(o) {
    o.missed = true;
    if (this.coinStreak > 0) { this.audio.coinMiss(); if (this.coinMult > 1) this.ui.toast(tr('comboLost'), 'pink'); }
    this.coinStreak = 0; this.coinMult = 1;
  }
  updateStar(dt) {
    const I = this.input, want = I.flick || I.doubleTap || this.starKey;
    I.flick = I.doubleTap = this.starKey = false;
    if (want) this.tryStar();
    if (this.star) { this.power = Math.max(0, this.power - dt / CFG.STAR_TIME); if (this.power <= 0) this.endStar(false); }
  }
  tryStar() {
    if (this.state !== 'play' || this.star || this.power < 1) return false;
    this.star = true; this.physics.star = true; this.starN++;
    this.audio.setTempo(1.3); this.audio.starOn();
    this.ui.flash(0.45, 'rgb(255,220,140)'); this.ui.toast(tr('starOn'), 'gold', true);
    this.cam.kick = 1;
    const b = this.ball;
    this.parts.burst(b.p[0], b.p[1], b.p[2], 60, 7, STAR_COL, { life: 0.9, size: 0.12, grav: 2, mix: [1, 1, 1], up: 2 });
    if (navigator.vibrate) try { navigator.vibrate([20, 40, 20]); } catch (e) { /* ignore */ }
    return true;
  }
  endStar(quiet) {
    if (!this.star) return;
    this.star = false; this.physics.star = false; this.power = 0;
    this.audio.setTempo(1); this.ui.updatePower(0, this.coinMult, 'fill', '');
    if (!quiet) { this.audio.starOff(); this.ui.toast(tr('starEnd'), 'gold'); }
  }

  // ------------------------------------------------------------- rendering
  camCrossing(p) { const e = this.cam.eye; return Math.abs((e[0] - p[0]) * Math.sin(p[3]) + (e[2] - p[2]) * Math.cos(p[3])) < 1.4; }
  fallOffset(s) { const d = this.collapseS - s; if (d <= 0) return 0; const t = d * 0.2; return -(9 * t * t + 1.5 * t); }
  drawProps() {
    const T = this.track, R = this.R, b = this.ball, M = R.meshes, th = TRACK_THEMES[this.themeIdx], tm = this.time;
    const s0 = b.s - 25, s1 = b.s + 230;
    this.gemGlowN = 0;
    for (const o of T.objects) {
      if (o.s < s0 || o.s > s1) continue;
      const yo = this.fallOffset(o.s);
      if (o.kind === 'gem') {
        if (o.taken) continue;
        T.pointAt(o.s, o.u, o.h + Math.sin(tm * 3 + o.id) * 0.08 + yo, this.tmp);
        Q.mul(this.q2, Q.yaw(this.q, tm * 3 + o.id), this.qCoin);
        M4.fromTRS(this.model, this.tmp[0], this.tmp[1], this.tmp[2], this.q2, 0.34, 0.07, 0.34);
        R.addInst(M.coin, this.model, GEM_COL, o.missed ? 0.25 : 1);             // a missed coin goes dull
        if (!o.missed && this.gemGlowN < 96) { this.gemGlow.set([this.tmp[0], this.tmp[1], this.tmp[2]], this.gemGlowN * 3); this.gemGlowN++; }
      } else if (o.kind === 'post') {
        T.pointAt(o.s, o.u, yo - 0.05, this.tmp);
        M4.fromTRS(this.model, this.tmp[0], this.tmp[1], this.tmp[2], this.qi, o.rad, 0.95, o.rad);
        R.addInst(M.post, this.model, th.trim, 1);
      } else if (o.kind === 'slider') {
        const u = o.amp * Math.sin(TAU * this.physics.time / o.period + o.phase);
        T.pointAt(o.s, u, 0.3 + yo, this.tmp);
        Q.yaw(this.q, this.tmp[3]);
        M4.fromTRS(this.model, this.tmp[0], this.tmp[1], this.tmp[2], this.q, 0.84, 0.6, 0.84);
        R.addInst(M.slider, this.model, th.hazard, 1);
      } else if (o.kind === 'gate') {
        T.pointAt(o.s, 0, yo, this.tmp);
        if (this.camCrossing(this.tmp)) continue;          // the chase camera is passing through the arch
        Q.yaw(this.q, this.tmp[3]);
        M4.fromTRS(this.model, this.tmp[0], this.tmp[1], this.tmp[2], this.q, 1, 1, 1);
        R.addInst(M.gate, this.model, o.passed ? GEM_COL : th.accent, 1);
      }
    }
    // previous-best marker
    const sb = this.startS + this.best;
    if (this.best >= 30 && sb > s0 && sb < s1 && this.state !== 'menu') {
      T.pointAt(sb, 0, this.fallOffset(sb), this.tmp);
      if (!this.camCrossing(this.tmp)) {
        Q.yaw(this.q, this.tmp[3]);
        M4.fromTRS(this.model, this.tmp[0], this.tmp[1], this.tmp[2], this.q, 0.92, 0.8, 1);
        R.addInst(M.gate, this.model, GEM_COL, 1.4);
      }
    }
  }
  // Star power safety rails: a glowing camera-facing band on every open outer edge ahead of the
  // ball, with light beads running along it.
  starRails(F, k) {
    const T = this.track, b = this.ball, M = T.mask, P = this.tmp, pts = this.railPts, eye = this.cam.eye;
    const s0 = Math.ceil(Math.max(b.s - 6, this.collapseS + 1)), s1 = b.s + 48;
    for (const sg of [-1, 1]) {
      let has = false, cur = pts[0], aPrev = 0;
      for (let s = s0; s <= s1; s += 1) {
        const f = s / CFG.DS, i = Math.floor(f), t = f - i, m = i & M, n = T.rowN[m];
        const open = i >= T.minIndex() && i < T.n - 1 && n > 0 && (sg < 0 ? T.rowAO[m * 3] : T.rowBO[m * 3 + n - 1]);
        if (!open || (T.rowF[m] & (sg < 0 ? RF.RAIL_L : RF.RAIL_R))) { has = false; continue; }
        const u = (sg < 0 ? T.edgeA(i, 0, t) : T.edgeB(i, n - 1, t)) - sg * 0.08;
        const nxt = cur === pts[0] ? pts[1] : pts[0];
        T.pointAt(s, u, 0.2, P); nxt[0] = P[0]; nxt[1] = P[1]; nxt[2] = P[2];
        const d = s - b.s, fade = clamp((d + 6) / 4, 0, 1) * clamp((48 - d) / 18, 0, 1);
        const a = fade * (0.7 + 0.3 * Math.sin(s * 0.9 - this.time * 14));
        if (has) {
          const dx = nxt[0] - cur[0], dy = nxt[1] - cur[1], dz = nxt[2] - cur[2], vx = eye[0] - cur[0], vy = eye[1] - cur[1], vz = eye[2] - cur[2];
          let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx; const l = Math.hypot(sx, sy, sz) || 1;
          sx = sx / l * 0.11; sy = sy / l * 0.11; sz = sz / l * 0.11;
          F.quad([cur[0] - sx, cur[1] - sy, cur[2] - sz], [cur[0] + sx, cur[1] + sy, cur[2] + sz], [nxt[0] + sx, nxt[1] + sy, nxt[2] + sz], [nxt[0] - sx, nxt[1] - sy, nxt[2] - sz],
            0, STAR_COL, k * 1.6, [aPrev, 0, aPrev, 1, a, 1, a, 0]);
        }
        if ((s & 1) === 0) F.glow(nxt[0], nxt[1], nxt[2], 0.3, STAR_COL, k * a * a * 0.9);
        cur = nxt; aPrev = a; has = true;
      }
    }
  }
  // Reflection probe: the world seen from the ball's center, drawn into a cube map (some faces
  // per frame, all six after a jump) so the ball mirrors the real track, coins and scenery.
  renderProbe(lit) {
    const R = this.R, q = this.quality.cur, eye = this.ball.p;
    if (!q.probe || this.noProbe) { R.freeProbe(); return; }
    if ((!R.probe || R.probe.size !== q.probe) && !R.makeProbe(q.probe)) { this.noProbe = true; return; }
    const P = R.probe, n = R.probeReady ? q.faces : 6;
    // one set of instance queues (props + scenery seen from the ball) serves every face
    R.cam[0] = eye[0]; R.cam[1] = eye[1]; R.cam[2] = eye[2]; R.camF[0] = R.camF[1] = R.camF[2] = 0;
    R.farList = [];
    this.drawProps(); this.env.draw(R, this.time, eye);
    const far = R.farList, pl = Object.assign({}, lit, { fogBase: eye[1] - 7 });
    R.farList = null; R.cullFar = 160;
    for (let k = 0; k < n; k++) {
      R.probeFace(eye, P.next, this.time); P.next = (P.next + 1) % 6;
      R.drawFloor(this.floorY, this.time);
      R.litSetup(pl);
      for (const ch of this.chunks.values()) R.drawChunk(ch);
      R.flushBatches(true);
      for (const it of far) { R.setFogK(it.k); R.drawProp(it.mesh, it.m, it.col, it.e); }
      R.setFogK(1);
    }
    R.clearBatches(); R.cullFar = 330;
    R.endProbe(n);
  }
  // The deck plane under the ball (for the reflection of the track at the contact point).
  ballPlane() {
    const b = this.ball, T = this.track, o = this.bplane || (this.bplane = { c: b.p, q: b.q, gN: [0, 1, 0], gD: -1e5, a: [0, 0, 0, 0], b: [0, 0, 0, 0], d: [0, 0, 0, 0] });
    o.c = b.p; o.q = b.q;
    if (b.lost || b.p[1] > b.surfY + 3 || b.s < T.minIndex() * CFG.DS || b.s > (T.n - 3) * CFG.DS) { o.gN[0] = 0; o.gN[1] = 1; o.gN[2] = 0; o.gD = -1e5; return o; }
    T.pointAt(b.s, b.u - 0.5, 0, o.a); T.pointAt(b.s, b.u + 0.5, 0, o.b); T.pointAt(b.s + 0.5, b.u, 0, o.d);
    const ux = o.b[0] - o.a[0], uy = o.b[1] - o.a[1], uz = o.b[2] - o.a[2], vx = o.d[0] - o.a[0], vy = o.d[1] - o.a[1], vz = o.d[2] - o.a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = (ny < 0 ? -1 : 1) * (Math.hypot(nx, ny, nz) || 1); nx /= l; ny /= l; nz /= l;
    o.gN[0] = nx; o.gN[1] = ny; o.gN[2] = nz; o.gD = nx * o.a[0] + ny * o.a[1] + nz * o.a[2];
    return o;
  }
  render() {
    const R = this.R, cam = this.cam, b = this.ball, th = TRACK_THEMES[this.themeIdx], sk = BALL_SKINS[this.skinIdx];
    const aspect = R.w / R.h;
    const Z = R.Z, boostK = clamp(b.boost / 1.3, 0, 1), spK = clamp((b.speed - 6) / 14, 0, 1), stK = this.starK;
    const glowCol = stK > 0.01 ? [lerp(sk.glow[0], STAR_COL[0], stK), lerp(sk.glow[1], STAR_COL[1], stK), lerp(sk.glow[2], STAR_COL[2], stK)] : sk.glow;
    const lit = {
      time: this.time, fogDen: 0.0078, fogBase: cam.eye[1] - 7,
      ball: [b.p[0], b.p[1], b.p[2], CFG.R], ballGlow: glowCol, ballLight: 0.3 + boostK * 0.9 + stK * 1.4 + (sk.type === 2 ? 0.35 : sk.type === 1 ? 0.15 : 0),
      shadow: b.lost ? 0 : 1, collapse: this.collapseS,
    };
    this.renderProbe(lit);
    R.setCamera(cam.eye, cam.tgt, cam.roll, clamp(cam.fov, 0.6, 1.9), 0.08, 1400);
    R.begin(this.time);
    R.drawFloor(this.floorY, this.time);
    R.litSetup(lit);
    for (const ch of this.chunks.values()) R.drawChunk(ch);
    this.drawProps();
    this.env.draw(R, this.time, b.p);
    R.endLit();
    M4.fromTRS(this.model, b.p[0], b.p[1], b.p[2], b.q, CFG.R, CFG.R, CFG.R);
    R.drawBall(this.model, sk, Math.max(spK, boostK), 1, stK, this.ballPlane());
    // additive pass
    R.beginAdditive();
    const F = this.fx; F.begin(R.view);
    const sk2 = Z.shafts, shaftCol = [lerp(Z.sun[0], th.accent[0], 0.3) * sk2, lerp(Z.sun[1], th.accent[1], 0.3) * sk2, lerp(Z.sun[2], th.accent[2], 0.3) * sk2];
    for (const s of this.env.shafts) F.shaft(s, cam.eye, shaftCol);
    const running = this.state === 'play' || this.state === 'falling';
    F.speedLines(this.frameDt || 0, cam.eye, R.camF, running ? b.speed : 0, Z.dust, running ? clamp((b.speed - 7) / 12, 0, 1) * 0.3 + boostK * 0.35 : 0);
    for (const bo of this.env.bolts) { const a = bo.life / 0.28; F.polyRibbon(bo.pts, cam.eye, 1.4, Z.c1, a * 0.8); F.polyRibbon(bo.pts, cam.eye, 0.35, [1, 0.95, 1], a * 1.6); }
    F.ribbon(cam.eye, CFG.R * (0.55 + stK * 0.35), glowCol, clamp((b.speed - 8) / 8, 0, 1) * 0.55 + boostK * 0.5 + stK * 0.6);
    F.glow(b.p[0], b.p[1], b.p[2], CFG.R * (2.8 + stK * 2.2), glowCol, 0.1 + boostK * 0.35 + spK * 0.08 + stK * (0.4 + 0.12 * Math.sin(this.time * 14)));
    if (stK > 0.01 && !b.lost) this.starRails(F, stK);
    for (let k = 0; k < this.gemGlowN; k++) F.glow(this.gemGlow[k * 3], this.gemGlow[k * 3 + 1], this.gemGlow[k * 3 + 2], 0.75, GEM_COL, 0.4);
    R.drawFx(F.buf, F.n);
    let n = this.parts.write(this.parts.out, 0);
    n = this.env.writeDust(this.parts.out, n, cam.eye, this.time, Z.dust, Z.drift);
    R.drawPoints(this.parts.out, n);
    R.endAdditive();
    const q = this.quality.cur;
    R.finish({ bloom: 1.0, blur: q.blur ? clamp((b.speed - 11) / 9, 0, 1) * 0.5 + boostK * 0.4 : 0, ca: q.blur ? boostK * 0.6 : 0, cx: 0.5, cy: aspect < 1 ? 0.4 : 0.45 });
  }

  // ------------------------------------------------------------- world zones
  // Zone follows distance; the last 14 % of each zone cross-fades into the next.
  updateZones(dt) {
    const R = this.R;
    const pos = Math.max(0, this.maxS - CFG.START_S);                    // worlds follow the position on the track
    for (let i = 0; i < ZONES.length; i++) if (!R.zoneTex[i]) { if (this.state === 'menu' || this.state === 'calib' || pos > (i - 1) * ZONE_LEN + 300) R.ensureZone(i); break; }
    const zf = clamp(pos / ZONE_LEN, 0, ZONES.length - 1), zA = Math.min(ZONES.length - 1, Math.floor(zf));
    const fr = zf - zA, k = zA < ZONES.length - 1 ? clamp((fr - 0.86) / 0.14, 0, 1) : 0, kk = k * k * (3 - 2 * k);
    R.setZones(zA, Math.min(ZONES.length - 1, zA + 1), kk);
    const cur = kk > 0.5 ? zA + 1 : zA;
    if (cur !== this.zoneIdx) { if (cur > this.zoneIdx && this.state === 'play') this.audio.whoosh(); this.zoneIdx = cur; }
    R.flash = Math.max(0, R.flash - dt * 3.5);
  }
  bolt() {
    this.R.flash = 1; this.ui.flash(0.08, 'rgb(255,200,200)');
    clearTimeout(this.thunderT); this.thunderT = setTimeout(() => this.audio.thunder(), 250 + Math.random() * 500);
  }

  // ------------------------------------------------------------- installable app (PWA)
  // The manifest and service worker only exist on a web server; file:// copies skip them.
  setupPWA() {
    const web = /^https?:$/.test(location.protocol), btn = this.ui.$('btnInstall'), E = this.ui.el;
    if (web) {
      const l = document.createElement('link'); l.rel = 'manifest'; l.href = 'manifest.webmanifest'; document.head.appendChild(l);
      if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    const installed = matchMedia('(display-mode: fullscreen)').matches || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (!web || installed) return;
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.installEvt = e; btn.classList.remove('hidden'); });
    window.addEventListener('appinstalled', () => { btn.classList.add('hidden'); Analytics.event('install', { outcome: 'installed' }); });
    if (ios) btn.classList.remove('hidden');
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.installEvt) {
        const ev = this.installEvt; this.installEvt = null; ev.prompt();
        ev.userChoice.then((c) => { Analytics.event('install', { outcome: c.outcome }); if (c.outcome === 'accepted') btn.classList.add('hidden'); }).catch(() => {});
      } else if (ios) { E.perm.textContent = tr('iosInstall'); E.perm.classList.remove('hidden'); }
    });
  }

  // ------------------------------------------------------------- sharing
  prepareShare(record) {
    const th = TRACK_THEMES[this.themeIdx], css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
    const info = {
      dist: Math.floor(this.dist), score: Math.floor(this.score), best: Math.floor(this.best), record, recordTxt: tr('newRecord'),
      tag: [this.gameMode === 'daily' ? tr('dailyTag', { date: dayLabel(this.runDay || dayKey()) }) : '', this.kid ? '🛡 ' + tr('kidShare').toUpperCase() : ''].filter(Boolean).join(' · '),
      accent: css(th.accent), accent2: css(th.accent2), portrait: this.R.h >= this.R.w,
    };
    this.shareInfo = info; this.shareFile = null; this.shareToken = (this.shareToken || 0) + 1;
    this.setShare('idle');
  }
  // The video is only made when asked for (first tap). Making it takes longer than the browser
  // keeps the tap "active", so sharing it needs a second tap unless it was quick (image fallback).
  makeShare() {
    const token = this.shareToken, t0 = performance.now();
    this.setShare('busy', 0);
    const done = (f) => {
      if (token !== this.shareToken) return;
      this.shareFile = f;
      if (performance.now() - t0 < 900) this.share(); else this.setShare('ready');
    };
    const go = () => {
      if (token !== this.shareToken) return;
      if (this.replay.pending > 0) { setTimeout(go, 100); return; }          // last snapshots still encoding
      this.replay.make(this.shareInfo, (p) => { if (token === this.shareToken) this.setShare('busy', p); })
        .then(done).catch(() => done(null));
    };
    go();
  }
  setShare(st, p = 0) { this.shareSt = st; this.shareP = p; this.ui.shareState(st, p); }
  share() {
    const f = this.shareFile, info = this.shareInfo;
    if (!info || this.shareSt === 'busy') return;
    if (this.shareSt === 'idle') { this.makeShare(); return; }
    const url = PROD_URL + (this.gameMode === 'daily' ? '?mode=daily' : '');
    let text = tr('shareText', { d: fmt(info.dist), s: fmt(info.score) });
    if (this.gameMode === 'daily') text += ' — ' + tr('shareDaily', { date: dayLabel(this.runDay || dayKey()) });
    if (this.kid) text += ' (🛡 ' + tr('kidShare') + ')';
    text += ' ' + url;
    let canFiles;
    try { canFiles = !!(f && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { canFiles = false; }
    const kind = f ? (f.type.startsWith('video') ? 'video' : 'image') : 'text';
    if (navigator.share && (canFiles || !f)) {
      Analytics.event('share', { kind, via: 'share' });
      navigator.share(canFiles ? { files: [f], text, title: 'GYROLL' } : { text, title: 'GYROLL' })
        .catch((e) => { if (!e || e.name !== 'AbortError') this.download(f, text); });
      return;
    }
    Analytics.event('share', { kind, via: 'download' });
    this.download(f, text);
  }
  download(f, text) {
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { /* ignore */ }
    if (!f) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 8000);
    this.setShare('saved');
  }

  // ------------------------------------------------------------- misc
  lockWake() {
    try {
      if (!('wakeLock' in navigator) || this.wake || document.hidden) return;
      navigator.wakeLock.request('screen').then((w) => { this.wake = w; w.addEventListener('release', () => { this.wake = null; }); }).catch(() => {});
    } catch (e) { /* unsupported */ }
  }
  unlockWake() { try { if (this.wake) this.wake.release(); } catch (e) { /* ignore */ } this.wake = null; }
}

window.addEventListener('load', () => { window.__game = new Game(); });
