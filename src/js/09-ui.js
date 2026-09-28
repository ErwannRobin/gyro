
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
// Install guides, one per kind of device: the steps (text keys; each has a hint under key + 'h')
// with their icons, and for phones the labels shown in the animated phone.
const INSTALL_ICONS = {
  share: '<path class="stk" d="M12 3.5v10.5M8.2 7.3L12 3.5l3.8 3.8"/><path class="stk" d="M8 10H5.8v10.2h12.4V10H16"/>',
  plus: '<rect class="stk" x="4" y="4" width="16" height="16" rx="4.5"/><path class="stk" d="M12 8.2v7.6M8.2 12h7.6"/>',
  check: '<circle class="stk" cx="12" cy="12" r="9"/><path class="stk" d="M8 12.4l2.8 2.8 5.4-5.6"/>',
  dots: '<circle cx="12" cy="5.4" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="18.6" r="1.9"/>',
  phone: '<rect class="stk" x="6.5" y="2.6" width="11" height="18.8" rx="2.6"/><path class="stk" d="M12 7v7M9.2 11.3l2.8 2.8 2.8-2.8"/>',
  monitor: '<rect class="stk" x="3" y="4" width="18" height="12.5" rx="2"/><path class="stk" d="M8.5 20.3h7M12 16.5v3.8M12 7.2v5.4M9.5 10.2l2.5 2.5 2.5-2.5"/>',
  menu: '<path class="stk" d="M4 6.5h16M4 12h16M4 17.5h10"/>',
  dock: '<path class="stk" d="M3 18h18"/><rect class="stk" x="4.5" y="10" width="4.2" height="4.2" rx="1.2"/><rect class="stk" x="9.9" y="10" width="4.2" height="4.2" rx="1.2"/><rect class="stk" x="15.3" y="10" width="4.2" height="4.2" rx="1.2"/>',
  globe: '<circle class="stk" cx="12" cy="12" r="9"/><path class="stk" d="M3 12h18M12 3c3.2 3.3 3.2 14.7 0 18M12 3c-3.2 3.3-3.2 14.7 0 18"/>',
};
const INSTALL_GUIDES = {
  ios: { phone: 'ios', key: 'share', row: 'insIosRow', btn: 'insIosBtn', steps: [['insIos1', 'share'], ['insIos2', 'plus'], ['insIos3', 'check']] },
  android: { phone: 'android', key: 'dots', row: 'insAndRow', btn: 'insAndBtn', steps: [['insAnd1', 'dots'], ['insAnd2', 'phone'], ['insAnd3', 'check']] },
  desktop: { steps: [['insDk1', 'monitor'], ['insDk2', 'dots'], ['insDk3', 'check']] },
  mac: { steps: [['insMac1', 'menu'], ['insMac2', 'dock'], ['insMac3', 'check']] },
  firefox: { steps: [['insFf1', 'globe'], ['insFf2', 'check']] },
  inapp: { steps: [['insIn1', 'globe'], ['insIn2', 'share']] },
};
// Which guide fits this browser: in-app browsers (social apps) cannot install at all.
function installKind() {
  const ua = navigator.userAgent || '';
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|musical_ly|TikTok|Snapchat|LinkedInApp/i.test(ua)) return 'inapp';
  if (/iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/android/i.test(ua)) return 'android';
  if (/firefox/i.test(ua)) return 'firefox';
  if (/macintosh/i.test(ua) && /safari/i.test(ua) && !/chrome|chromium|edg\//i.test(ua)) return 'mac';
  return 'desktop';
}
class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.el = {
      hud: $('hud'), dist: $('hDist'), score: $('hScore'), best: $('hBest'), speed: $('hSpeed'), bar: $('hSpeedBar'), mult: $('mult'),
      ctrl: $('ctrlTag'), toasts: $('toasts'), danger: $('danger'), flash: $('flash'), menu: $('menu'), calib: $('calib'),
      calibNum: $('calibNum'), calibTxt: $('calibTxt'), calibSub: $('calibSub'), go: $('go'), pause: $('pause'), over: $('over'),
      record: $('record'), ovDist: $('ovDist'), ovScore: $('ovScore'), ovBest: $('ovBest'), ovMode: $('ovMode'), ovRails: $('ovRails'), mBest: $('mBest'), perm: $('permMsg'),
      btnPlay: $('btnPlay'), btnOpts: $('btnOpts'), sheet: $('sheet'), touchHint: $('touchHint'), modeInfo: $('modeInfo'), modeTxt: $('modeTxt'), newTrack: $('btnNewTrack'), share: $('btnShare'), recal: $('btnRecal'),
      power: $('power'), pwCoin: $('pwCoin'), pwTxt: $('pwTxt'), pwFill: $('pwFill'), about: $('about'), btnAbout: $('btnAbout'),
      install: $('install'), insPhone: $('insPhone'), insSteps: $('insSteps'),
    };
    $('abRepo').href = REPO_URL; $('abX').href = X_URL;
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
  // Menu offsets (portrait): PLAY in the middle of the screen (lower if the header needs the room),
  // and for options mode the title's move into the top bar, the mode switch's move under it and the
  // top of the sheet. Layout offsets ignore transforms, so the values hold while the animations play.
  layoutMenu() {
    const m = this.el.menu, $ = this.$, H = m.clientHeight;
    if (!H) return;
    const top = (el) => { let y = 0; for (let e = el; e && e !== m; e = e.offsetParent) y += e.offsetTop; return y; };
    const set = (k, v) => m.style.setProperty(k, Math.round(v) + 'px');
    const bar = $('menuTop');
    if (matchMedia('(orientation: landscape) and (max-height: 640px)').matches) {
      for (const k of ['--playY', '--tY', '--hY', '--sheetTop']) set(k, 0);
      // OPTIONS sits in its slot under BEST; as DONE it glides to the middle of the top bar
      const slot = $('optSlot'), left = (el) => { let x = 0; for (let e = el; e && e !== m; e = e.offsetParent) x += e.offsetLeft; return x; };
      const x = left(slot) + slot.offsetWidth / 2, y = top(slot);
      set('--optX', x); set('--optY', y);
      set('--dX', m.clientWidth / 2 - x); set('--dY', top(bar) + bar.offsetHeight / 2 - this.el.btnOpts.offsetHeight / 2 - y);
      return;
    }
    const title = $('title'), seg = $('modeSeg'), info = this.el.modeInfo, links = $('optLinks'), head = top(info) + info.offsetHeight;
    set('--playY', Math.max(H / 2 - this.el.btnPlay.offsetHeight / 2, head + 14));
    set('--tY', top(bar) + bar.offsetHeight / 2 - top(title) - title.offsetHeight / 2);
    const hY = top(bar) + bar.offsetHeight + 12 - top(seg);
    set('--hY', hY); set('--sheetTop', top(links) + links.offsetHeight + hY + 16);
  }
  // About: a circle opens from the About button, the marble draws its track, the numbers count up.
  get aboutOpen() { return this.el.about.classList.contains('open'); }
  openAbout() {
    const a = this.el.about, r = this.el.btnAbout.getBoundingClientRect();
    if (this.aboutOpen) return;
    a.style.setProperty('--ox', Math.round(r.left + r.width / 2) + 'px'); a.style.setProperty('--oy', Math.round(r.top + r.height / 2) + 'px');
    clearTimeout(a._t); a.classList.remove('hidden'); void a.offsetWidth; a.classList.add('open');
    this.$('abScroll').scrollTop = 0;
    this.abT0 = performance.now(); cancelAnimationFrame(this.abRaf);
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const loop = (now) => { this.aboutFrame(still ? 1e9 : (now - this.abT0) / 1000); if (!still && this.aboutOpen) this.abRaf = requestAnimationFrame(loop); };
    loop(this.abT0);
    this.$('btnAboutClose').focus({ preventScroll: true });
  }
  closeAbout() {
    const a = this.el.about;
    if (!this.aboutOpen) return;
    a.classList.remove('open'); cancelAnimationFrame(this.abRaf);
    clearTimeout(a._t); a._t = setTimeout(() => { if (!this.aboutOpen) a.classList.add('hidden'); }, 700);
  }
  // t: seconds since the screen opened. The track draws itself behind the marble, then the marble
  // keeps rolling to and fro along it like in a half-pipe.
  aboutFrame(t) {
    const path = this.$('abPath'), len = this.abLen || (this.abLen = path.getTotalLength());
    const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
    const draw = clamp((t - 0.35) / 1.5, 0, 1), p = draw < 1 ? ease(draw) : 0.5 + 0.5 * Math.cos((t - 1.85) * Math.PI / 2.6);
    path.style.strokeDasharray = len; path.style.strokeDashoffset = len * (1 - ease(draw));
    this.$('abGlow').style.strokeDasharray = len; this.$('abGlow').style.strokeDashoffset = len * (1 - ease(draw));
    const pt = path.getPointAtLength(len * p);
    this.$('abMarble').setAttribute('transform', `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
    this.$('abSpin').setAttribute('transform', `rotate(${(len * p / 8.5 * 180 / Math.PI).toFixed(1)})`);
    const vals = { lines: BUILD_INFO.lines, kb: BUILD_INFO.kb, libs: 0 };
    this.el.about.querySelectorAll('[data-to]').forEach((b, i) => {
      const k = clamp((t - 0.5 - i * 0.12) / 1.6, 0, 1);
      this.set('ab' + i, b, fmt(vals[b.dataset.to] * (1 - Math.pow(1 - k, 4))));
    });
  }
  // Install guide: it opens like About, from the button. The phone plays the steps in a loop
  // (tap, menu, confirm, the icon lands on the home screen) and the list lights up the step shown.
  get installOpen() { return this.el.install.classList.contains('open'); }
  openInstall(kind, from) {
    const a = this.el.install, G = INSTALL_GUIDES[kind] || INSTALL_GUIDES.desktop, ph = this.el.insPhone, ol = this.el.insSteps;
    if (this.installOpen) return;
    const r = from.getBoundingClientRect();
    a.style.setProperty('--ox', Math.round(r.left + r.width / 2) + 'px'); a.style.setProperty('--oy', Math.round(r.top + r.height / 2) + 'px');
    ol.textContent = '';
    for (let i = 0; i < G.steps.length; i++) {
      const [k, ic] = G.steps[i], li = document.createElement('li');
      li.innerHTML = `<i class="n">${i + 1}</i><svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${INSTALL_ICONS[ic]}</svg><span><b></b><small></small></span>`;
      li.querySelector('b').textContent = tr(k); li.querySelector('small').textContent = tr(k + 'h');
      ol.appendChild(li);
    }
    this.$('insFig').classList.toggle('hidden', !G.phone);
    if (G.phone) {
      ph.className = G.phone;
      ph.querySelector('.key').innerHTML = `<svg class="ic" viewBox="0 0 24 24">${INSTALL_ICONS[G.key]}</svg>`;
      this.$('insRow').textContent = tr(G.row); this.$('insBtn').textContent = tr(G.btn);
    }
    this.$('insHelp').textContent = tr('insHelp', { host: location.host || 'gyroll.vercel.app' });
    clearTimeout(a._t); a.classList.remove('hidden'); void a.offsetWidth; a.classList.add('open');
    this.$('insScroll').scrollTop = 0;
    const still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches, n = G.steps.length;
    let p = -1;
    const step = () => {
      p = (p + 1) % (G.phone ? 4 : n);
      if (G.phone) ph.className = G.phone + ' p' + p;
      ol.querySelectorAll('li').forEach((li, i) => li.classList.toggle('on', i === Math.min(p, n - 1)));
      this.insT = setTimeout(step, G.phone && p === 3 ? 2400 : 1700);
    };
    clearTimeout(this.insT);
    if (still) { if (G.phone) ph.className = G.phone + ' p1'; } else this.insT = setTimeout(step, 700);
    this.$('btnInstallClose').focus({ preventScroll: true });
  }
  closeInstall() {
    const a = this.el.install;
    if (!this.installOpen) return;
    a.classList.remove('open'); clearTimeout(this.insT);
    clearTimeout(a._t); a._t = setTimeout(() => { if (!this.installOpen) a.classList.add('hidden'); }, 700);
  }
  setOpts(on) {
    this.layoutMenu();
    this.el.menu.classList.toggle('opts', on); this.el.btnOpts.setAttribute('aria-expanded', String(on));
    if (on) this.el.sheet.scrollTop = 0;
  }
  // Marks the chosen button of a segmented control; its pill slides under it.
  setSeg(id, key, val) {
    for (const b of this.$(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset[key] === val);
    this.pills();
  }
  pills() {
    for (const seg of document.querySelectorAll('.seg')) {
      const pill = seg.querySelector('.pill'), on = seg.querySelector('button.on');
      if (!pill) continue;
      pill.style.width = on ? on.offsetWidth + 'px' : '0';
      if (on) pill.style.transform = `translateX(${on.offsetLeft}px)`;
    }
  }
  hideNow(name) { const e = this.el[name]; e.classList.add('hidden', 'fade'); }
  hud(on) { this.el.hud.classList.toggle('on', on); }

  // Static texts follow data-i18n; dynamic ones are refreshed by the game.
  applyLang() {
    document.documentElement.lang = LANG;
    for (const e of document.querySelectorAll('[data-i18n]')) e.textContent = tr(e.dataset.i18n);
    for (const e of document.querySelectorAll('[data-i18n-aria]')) { const t = tr(e.dataset.i18nAria); e.setAttribute('aria-label', t); e.title = t; }
    this.setSeg('langSeg', 'lang', LANG);
    this.refreshSkinLabels();
  }
  setToggles(musicOn, sfxOn) {
    for (const b of document.querySelectorAll('.tgMusic')) b.classList.toggle('off', !musicOn);
    for (const b of document.querySelectorAll('.tgSfx')) b.classList.toggle('off', !sfxOn);
  }
  setMode(mode, info) {
    this.setSeg('modeSeg', 'mode', mode);
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

  // A skin picker (track row + ball row) in a container; every picker built stays in sync.
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
  // A rendered thumbnail (data URL) replaces the CSS swatch. kind: 'track' | 'ball'.
  setPreview(kind, i, url) {
    for (const set of this.skinSets) { const b = set[kind][i]; if (b && url) b.style.background = `#070a14 url(${url}) center / cover no-repeat`; }
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
