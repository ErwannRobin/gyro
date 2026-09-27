
// =====================================================================
// QualityManager — adapts resolution / effects to hold the frame rate.
// =====================================================================
class QualityManager {
  constructor(mobile) {
    this.levels = [
      // probe: size of the ball's reflection cube map (0 = sky panorama only), faces: cube faces redrawn per frame
      { scale: 0.75, post: false, particles: 160, dust: 40, env: 10, bloomDiv: 4, blur: false, probe: 0, faces: 0 },
      { scale: 1.0, post: true, particles: 300, dust: 70, env: 14, bloomDiv: 4, blur: false, probe: 64, faces: 2 },
      { scale: 1.5, post: true, particles: 480, dust: 110, env: 18, bloomDiv: 4, blur: true, probe: 128, faces: 3 },
      { scale: 2.0, post: true, particles: 720, dust: 150, env: 24, bloomDiv: 3, blur: true, probe: 256, faces: 6 },
    ];
    this.top = mobile ? 2 : 3; this.level = this.top;
    this.acc = 0; this.frames = 0; this.good = 0; this.drops = 0; this.warm = 2.5; this.changed = false;
  }
  get cur() { return this.levels[this.level]; }
  sample(dt) {
    if (this.warm > 0) { this.warm -= dt; return; }
    this.acc += dt; this.frames++;
    if (this.acc < 1.5) return;
    const avg = this.acc / this.frames; this.acc = 0; this.frames = 0;
    if (avg > 1 / 47 && this.level > 0) { this.level--; this.drops++; this.good = 0; this.changed = true; this.warm = 1.5; }
    else if (avg < 1 / 57) {
      this.good += 1.5;
      if (this.good > 10 && this.level < this.top && this.drops < 3) { this.level++; this.good = 0; this.changed = true; this.warm = 1.5; }
    } else this.good = 0;
  }
  pixelScale(cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const cap = Math.sqrt(2.4e6 / Math.max(1, cssW * cssH));
    return clamp(Math.min(this.cur.scale, dpr, cap), 0.5, 3);
  }
}

// =====================================================================
// UI — DOM overlay: HUD, screens, toasts, skins, language, toggles.
// =====================================================================
class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.el = {
      hud: $('hud'), dist: $('hDist'), score: $('hScore'), best: $('hBest'), speed: $('hSpeed'), bar: $('hSpeedBar'), mult: $('mult'),
      ctrl: $('ctrlTag'), toasts: $('toasts'), danger: $('danger'), flash: $('flash'), menu: $('menu'), calib: $('calib'),
      calibNum: $('calibNum'), calibTxt: $('calibTxt'), calibSub: $('calibSub'), go: $('go'), pause: $('pause'), over: $('over'),
      record: $('record'), ovDist: $('ovDist'), ovScore: $('ovScore'), ovBest: $('ovBest'), ovMode: $('ovMode'), ovRails: $('ovRails'), mBest: $('mBest'), perm: $('permMsg'),
      btnTilt: $('btnTilt'), btnTouch: $('btnTouch'), touchHint: $('touchHint'), modeInfo: $('modeInfo'), modeTxt: $('modeTxt'), newTrack: $('btnNewTrack'), share: $('btnShare'), recal: $('btnRecal'),
      power: $('power'), pwCoin: $('pwCoin'), pwTxt: $('pwTxt'), pwFill: $('pwFill'),
    };
    this.cache = {};
    this.flashA = 0; this.flashCol = '#fff';
    this.skinSets = [];
  }
  set(key, el, txt) { if (this.cache[key] !== txt) { this.cache[key] = txt; el.textContent = txt; } }
  show(name, on) {
    const e = this.el[name]; if (!e) return;
    if (on) { clearTimeout(e._t); e.classList.remove('hidden'); void e.offsetWidth; e.classList.remove('fade'); }
    else if (!e.classList.contains('hidden')) {
      e.classList.add('fade');
      clearTimeout(e._t); e._t = setTimeout(() => { if (e.classList.contains('fade')) e.classList.add('hidden'); }, 450);
    }
  }
  hideNow(name) { const e = this.el[name]; e.classList.add('hidden', 'fade'); }
  hud(on) { this.el.hud.classList.toggle('on', on); }

  // Static texts follow data-i18n; dynamic ones are refreshed by the game.
  applyLang() {
    document.documentElement.lang = LANG;
    for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = tr(e.dataset.i18n);
    for (const e of document.querySelectorAll('[data-i18n-aria]')) { const t = tr(e.dataset.i18nAria); e.setAttribute('aria-label', t); e.title = t; }
    for (const b of document.querySelectorAll('#langSeg button')) b.classList.toggle('on', b.dataset.lang === LANG);
    this.refreshSkinLabels();
  }
  setToggles(musicOn, sfxOn) {
    for (const b of document.querySelectorAll('.tgMusic')) b.classList.toggle('off', !musicOn);
    for (const b of document.querySelectorAll('.tgSfx')) b.classList.toggle('off', !sfxOn);
  }
  setMode(mode, info) {
    for (const b of document.querySelectorAll('#modeSeg button')) b.classList.toggle('on', b.dataset.mode === mode);
    this.el.modeTxt.textContent = info;
  }

  updateHud(dist, score, best, speed, mult) {
    this.set('d', this.el.dist, fmt(dist) + ' m');
    this.set('s', this.el.score, fmt(score));
    this.set('b', this.el.best, fmt(best) + ' m');
    this.set('v', this.el.speed, String(Math.round(speed * 3.6)));
    const w = Math.round(clamp(speed / 40, 0, 1) * 100) + '%';
    if (this.cache.w !== w) { this.cache.w = w; this.el.bar.style.width = w; }
    this.set('m', this.el.mult, '×' + mult);
    const mo = mult > 1;
    if (this.cache.mo !== mo) { this.cache.mo = mo; this.el.mult.classList.toggle('on', mo); }
  }
  // Star power gauge. st: 'fill' | 'ready' | 'on'; hint = how to trigger it with the current controls.
  updatePower(power, coinMult, st, hint) {
    const w = (Math.round(clamp(power, 0, 1) * 200) / 2) + '%';
    if (this.cache.pw !== w) { this.cache.pw = w; this.el.pwFill.style.width = w; }
    this.set('pc', this.el.pwCoin, '×' + coinMult);
    if (this.cache.pcm !== coinMult) {
      const up = coinMult > (this.cache.pcm || 1); this.cache.pcm = coinMult;
      if (up) { const e = this.el.pwCoin; e.classList.add('up'); clearTimeout(e._t); e._t = setTimeout(() => e.classList.remove('up'), 220); }
    }
    this.set('pt', this.el.pwTxt, st === 'ready' ? hint : st === 'on' ? tr('starActive') : tr('star'));
    const key = st + LANG;
    if (this.cache.pst !== key) {
      this.cache.pst = key;
      this.el.power.classList.toggle('ready', st === 'ready'); this.el.power.classList.toggle('on', st === 'on');
      document.body.classList.toggle('star', st === 'on');
    }
  }
  toast(txt, cls = '', big = false) {
    const el = document.createElement('div');
    el.className = 'toast ' + cls + (big ? ' big' : ''); el.textContent = txt;
    this.el.toasts.appendChild(el);
    while (this.el.toasts.children.length > 3) this.el.toasts.firstChild.remove();
    setTimeout(() => el.remove(), 1500);
  }
  flash(a, col = '#fff') { this.flashA = Math.max(this.flashA, a); this.flashCol = col; this.el.flash.style.background = col; }
  frame(dt, danger) {
    if (this.flashA > 0) { this.flashA = Math.max(0, this.flashA - dt * 2.8); this.el.flash.style.opacity = this.flashA.toFixed(3); }
    const d = danger.toFixed(2);
    if (this.cache.dg !== d) { this.cache.dg = d; this.el.danger.style.opacity = d; }
  }
  go() { const g = this.el.go; g.classList.remove('on'); void g.offsetWidth; g.classList.add('on'); }
  setAccent(theme) {
    const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
    document.documentElement.style.setProperty('--accent', css(theme.accent));
    document.documentElement.style.setProperty('--accent2', css(theme.accent2));
  }

  // One skin picker per container (menu + pause); both stay in sync.
  buildSkins(containerId, onTrack, onBall) {
    const box = this.$(containerId);
    const mkRow = (list, round, cb, lblKey) => {
      const row = document.createElement('div'); row.className = 'skinRow';
      const l = document.createElement('span'); l.className = 'lbl'; l.dataset.i18n = lblKey; row.appendChild(l);
      const btns = list.map((sk, i) => {
        const b = document.createElement('button');
        b.className = 'sw' + (round ? ' round' : '');
        b.style.background = sk.swatch; b.setAttribute('aria-label', sk.name.en);
        b.addEventListener('click', () => cb(i));
        row.appendChild(b); return b;
      });
      box.appendChild(row); return btns;
    };
    const set = { track: mkRow(TRACK_THEMES, false, onTrack, 'track'), ball: mkRow(BALL_SKINS, true, onBall, 'ball') };
    set.name = document.createElement('div'); set.name.className = 'skinName'; box.appendChild(set.name);
    this.skinSets.push(set);
  }
  selectSkins(ti, bi) {
    this.ti = ti; this.bi = bi;
    for (const set of this.skinSets) {
      set.track.forEach((b, i) => b.classList.toggle('sel', i === ti));
      set.ball.forEach((b, i) => b.classList.toggle('sel', i === bi));
    }
    this.refreshSkinLabels();
  }
  refreshSkinLabels() {
    if (this.ti === undefined) return;
    const txt = TRACK_THEMES[this.ti].name[LANG] + '  ·  ' + BALL_SKINS[this.bi].name[LANG];
    for (const set of this.skinSets) set.name.textContent = txt;
  }
  shareState(state, p = 0) {
    const b = this.el.share, prog = b.querySelector('.prog');
    const key = state + LANG;
    if (this.cache.share !== key) {
      this.cache.share = key;
      b.classList.toggle('busy', state === 'busy'); b.disabled = state === 'busy';
      b.classList.toggle('ready', state === 'ready');
      b.querySelector('.lbl').textContent = tr({ busy: 'shareBusy', saved: 'shareSaved', ready: 'shareReady' }[state] || 'share');
      b.classList.toggle('hidden', state === 'none');
    }
    const w = state === 'busy' ? Math.round(p * 20) * 5 + '%' : '0';          // 5 % steps: few DOM writes
    if (this.cache.shareW !== w) { this.cache.shareW = w; prog.style.width = w; }
  }
}
