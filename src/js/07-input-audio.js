
// =====================================================================
// InputManager — tilt (DeviceOrientation), touch/mouse joystick, keyboard.
// =====================================================================
class InputManager {
  constructor(canvas) {
    this.x = 0; this.y = 0;
    this.tiltX = 0; this.tiltY = 0; this.keyX = 0; this.keyY = 0; this.joyX = 0; this.joyY = 0;
    this.tilt = false;              // tilt control active
    this.raw = null;                // screen-space gravity [sx, sy, sz]
    this.g0 = [0, 0, -1];
    this.calib = null;
    this.lastEvt = 0;
    this.keys = new Set();
    this.ptr = null; this.enabled = false;
    this.flick = false; this.doubleTap = false; this.lastTap = 0; this.hist = []; this.lastFlick = -1e4;
    this.joyEl = document.getElementById('joy'); this.knob = this.joyEl.firstElementChild;
    this.onOrient = this.onOrient.bind(this);
    this.angle = this.screenAngle();
    this.heading = null; this.pitch = 0;
    // Motion data for the menu camera. Without a permission prompt (Android…) listen right away;
    // on iOS only once the player has granted it before, from their first tap.
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission !== 'function') window.addEventListener('deviceorientation', this.onOrient);
    else if (DOE && Store.get('tiltOK', false) === true) {
      const once = () => {
        document.removeEventListener('touchend', once, true); document.removeEventListener('click', once, true);
        try { Promise.resolve(DOE.requestPermission()).then((r) => { if (r === 'granted') window.addEventListener('deviceorientation', this.onOrient); }).catch(() => {}); } catch (e) { /* ignore */ }
      };
      document.addEventListener('touchend', once, true); document.addEventListener('click', once, true);
    }
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
      this.keys.add(k);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => { this.keys.clear(); this.release(); });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.enabled || this.ptr !== null || this.tilt) return;     // with the gyroscope, fingers move the camera (CamGestures)
      e.preventDefault();
      const now = performance.now();
      if (now - this.lastTap < 320) this.doubleTap = true;
      this.lastTap = now;
      this.ptr = e.pointerId; this.cx = e.clientX; this.cy = e.clientY; this.joyX = this.joyY = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      this.joyEl.style.left = this.cx + 'px'; this.joyEl.style.top = this.cy + 'px';
      this.knob.style.transform = 'translate(0,0)';
      this.joyEl.classList.add('on');
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.ptr) return;
      const R = Math.min(70, Math.min(innerWidth, innerHeight) * 0.16);
      let dx = e.clientX - this.cx, dy = e.clientY - this.cy;
      const l = Math.hypot(dx, dy);
      if (l > R) { // drag the joystick origin along so reversing direction stays responsive
        this.cx += dx - dx / l * R; this.cy += dy - dy / l * R; dx = dx / l * R; dy = dy / l * R;
        this.joyEl.style.left = this.cx + 'px'; this.joyEl.style.top = this.cy + 'px';
      }
      this.joyX = dx / R; this.joyY = -dy / R;
      this.knob.style.transform = `translate(${dx}px,${dy}px)`;
    });
    const up = (e) => { if (e.pointerId === this.ptr) this.release(); };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const onRot = () => {
      const a = this.screenAngle();
      if (a !== this.angle) { this.angle = a; if (this.tilt) this.startCalibration(); }
    };
    window.addEventListener('orientationchange', onRot);
    if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', onRot);
  }
  release() { this.ptr = null; this.joyX = this.joyY = 0; this.joyEl.classList.remove('on'); }
  screenAngle() {
    let a = (screen.orientation && typeof screen.orientation.angle === 'number') ? screen.orientation.angle : (typeof window.orientation === 'number' ? window.orientation : 0);
    a = ((a % 360) + 360) % 360;
    return a;
  }
  static tiltLikely() {
    return typeof window.DeviceOrientationEvent !== 'undefined' && (matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window);
  }

  // Must be called synchronously from a user gesture (iOS permission prompt).
  requestTilt() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return Promise.resolve({ ok: false, reason: 'unsupported' });
    const ok = (r) => { if (r.ok) Store.set('tiltOK', true); return r; };
    const listen = () => new Promise((res) => {
      window.addEventListener('deviceorientation', this.onOrient);
      const t0 = performance.now();
      const check = () => {
        if (this.raw) return res({ ok: true });
        if (performance.now() - t0 > 1500) { window.removeEventListener('deviceorientation', this.onOrient); return res({ ok: false, reason: 'nodata' }); }
        setTimeout(check, 60);
      };
      check();
    });
    if (typeof DOE.requestPermission === 'function') {
      let p;
      try { p = DOE.requestPermission(); } catch (e) { return Promise.resolve({ ok: false, reason: 'denied' }); }
      return Promise.resolve(p).then((r) => (r === 'granted' ? listen() : { ok: false, reason: 'denied' })).then(ok).catch(() => ({ ok: false, reason: 'denied' }));
    }
    return listen().then(ok);
  }
  onOrient(e) {
    if (e.beta === null || e.gamma === null || e.beta === undefined) return;
    const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
    if (!Number.isFinite(b) || !Number.isFinite(g)) return;
    // gravity ("down") direction in device coordinates
    const dx = Math.sin(g) * Math.cos(b), dy = -Math.sin(b), dz = -Math.cos(g) * Math.cos(b);
    let sx = dx, sy = dy;
    switch (this.angle) {
      case 90: sx = -dy; sy = dx; break;
      case 270: sx = dy; sy = -dx; break;
      case 180: sx = -dx; sy = -dy; break;
    }
    this.raw = [sx, sy, dz];
    this.lastEvt = performance.now();
    // quick "tilt up" (top edge raised towards you): the screen pitch grows by ~20° in a quarter second.
    // An angle, not sy, so it still works when the phone is held almost upright.
    const now = this.lastEvt, H = this.hist, pitch = Math.atan2(-sy, -dz);
    this.pitch = pitch; this.sx = sx;
    // compass-like heading of the phone (of its top edge plus its back), stable both flat and upright
    if (typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
      const a = e.alpha * Math.PI / 180, sg = Math.sin(g), cg = Math.cos(g), sb = Math.sin(b), cb = Math.cos(b);
      const vx = -sg, vy = cb + sb * cg, X = Math.cos(a) * vx - Math.sin(a) * vy, Y = Math.sin(a) * vx + Math.cos(a) * vy;
      this.heading = Math.atan2(X, Y);
    } else this.heading = null;
    H.push(now, pitch);
    while (H.length > 2 && now - H[0] > 250) H.splice(0, 2);
    let low = 9; for (let k = 1; k < H.length; k += 2) low = Math.min(low, H[k]);
    if (pitch - low > 0.35 && now - this.lastFlick > 900) { this.flick = true; this.lastFlick = now; H.length = 0; }
    if (this.calib) { this.calib.acc[0] += sx; this.calib.acc[1] += sy; this.calib.acc[2] += dz; this.calib.n++; }
  }
  startCalibration() { this.calib = { acc: [0, 0, 0], n: 0 }; }
  endCalibration() {
    const c = this.calib; this.calib = null;
    if (c && c.n > 0) this.g0 = [c.acc[0] / c.n, c.acc[1] / c.n, c.acc[2] / c.n];
    else if (this.raw) this.g0 = this.raw.slice();
    this.tiltX = this.tiltY = 0;
  }

  update(dt) {
    const shape = (v) => { const a = Math.abs(v); if (a < 0.035) return 0; return Math.sign(v) * Math.min(1, Math.pow((a - 0.035) / 0.965, 1.15)); };
    if (this.tilt && this.raw && !this.calib) {
      const SENS = 0.36; // ≈ 21° of tilt for full input
      const tx = shape((this.raw[0] - this.g0[0]) / SENS), ty = shape((this.raw[1] - this.g0[1]) / SENS);
      const k = damp(16, dt);
      this.tiltX += (tx - this.tiltX) * k; this.tiltY += (ty - this.tiltY) * k;
    } else { this.tiltX *= 1 - damp(10, dt); this.tiltY *= 1 - damp(10, dt); }
    const K = this.keys, has = (...a) => a.some((k) => K.has(k));
    const kx = (has('arrowright', 'd') ? 1 : 0) - (has('arrowleft', 'a', 'q') ? 1 : 0);
    const ky = (has('arrowup', 'w', 'z') ? 1 : 0) - (has('arrowdown', 's') ? 1 : 0);
    this.keyX += (kx - this.keyX) * damp(kx ? 7 : 11, dt); this.keyY += (ky - this.keyY) * damp(ky ? 7 : 11, dt);
    let x, y;
    if (this.ptr !== null) { x = this.joyX; y = this.joyY; } else { x = this.tiltX; y = this.tiltY; }
    x = clamp(x + this.keyX, -1, 1); y = clamp(y + this.keyY, -1, 1);
    this.x = fin(x); this.y = fin(y);
  }
}

// =====================================================================
// CamGestures — one finger (or the mouse) drags the camera, two fingers pinch to zoom, the wheel
// zooms. `accept(target, event)` says whether a press belongs to the camera; the game takes the
// totals every frame. Quick taps are counted (two in a row make a double tap).
// =====================================================================
class CamGestures {
  constructor(accept) {
    this.accept = accept; this.pts = new Map(); this.pinchD = 0; this.lastTap = -1e4; this.onTap = null;
    this.take();
    window.addEventListener('pointerdown', (e) => {
      if (!this.accept(e.target, e)) return;
      const multi = this.pts.size > 0;
      for (const p of this.pts.values()) p.multi = true;
      this.pts.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now(), multi });
      this.pinchD = this.spread();
    });
    window.addEventListener('pointermove', (e) => {
      const p = this.pts.get(e.pointerId);
      if (!p) return;
      if (this.pts.size === 1) { this.dx += e.clientX - p.x; this.dy += e.clientY - p.y; }
      p.x = e.clientX; p.y = e.clientY;
      if (this.pts.size > 1) { const d = this.spread(); if (this.pinchD > 0 && d > 0) this.zoom *= this.pinchD / d; this.pinchD = d; }
    });
    const up = (e) => {
      const p = this.pts.get(e.pointerId);
      if (!p) return;
      this.pts.delete(e.pointerId); this.pinchD = this.spread();
      const now = performance.now();
      if (e.type === 'pointerup' && !p.multi && now - p.t < 280 && Math.hypot(p.x - p.x0, p.y - p.y0) < 12) {
        this.taps++; if (now - this.lastTap < 350) this.double = true;
        this.lastTap = now;
        if (this.onTap) this.onTap();
      }
    };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', () => this.reset());
    window.addEventListener('wheel', (e) => {
      if (!this.accept(e.target, e)) return;
      e.preventDefault(); this.zoom *= Math.exp(clamp(e.deltaY, -120, 120) * 0.0016);
    }, { passive: false });
  }
  spread() { if (this.pts.size < 2) return 0; const [a, b] = this.pts.values(); return Math.hypot(a.x - b.x, a.y - b.y); }
  get held() { return this.pts.size > 0; }
  take() {
    const o = { dx: this.dx || 0, dy: this.dy || 0, zoom: this.zoom || 1, taps: this.taps || 0, double: !!this.double };
    this.dx = this.dy = 0; this.zoom = 1; this.taps = 0; this.double = false;
    return o;
  }
  reset() { this.pts.clear(); this.pinchD = 0; this.take(); }
}

// =====================================================================
// AudioManager — everything synthesized with Web Audio.
// =====================================================================
class AudioManager {
  constructor() {
    this.ctx = null;
    this.musicOn = Store.get('musicOn', true) !== false;
    this.sfxOn = Store.get('sfxOn', true) !== false;
    this.sfxVol = clamp(+Store.get('sfxVol', 0.8) || 0, 0, 1);
    this.musicVol = clamp(+Store.get('musicVol', 0.55) || 0, 0, 1);
    this.intensity = 0.15; this.tempo = 1; this.step = 0; this.nextT = 0; this.chord = -1; this.gemCombo = 0; this.lastGem = 0;
  }
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC(); } catch (e) { this.ctx = null; return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxOn ? this.sfxVol : 0; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.musicOn ? this.musicVol * 0.55 : 0; this.music.connect(this.master);
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(2.2); this.verbOut = c.createGain(); this.verbOut.gain.value = 0.5;
    this.verb.connect(this.verbOut); this.verbOut.connect(this.master);
    // separate sends so each toggle also silences its reverb tail
    this.verbS = c.createGain(); this.verbS.gain.value = this.sfxOn ? this.sfxVol : 0; this.verbS.connect(this.verb);
    this.verbM = c.createGain(); this.verbM.gain.value = this.musicOn ? this.musicVol : 0; this.verbM.connect(this.verb);
    this.delay = c.createDelay(1); this.delay.delayTime.value = 60 / 84 * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.38; const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2400;
    this.delay.connect(dl); dl.connect(fb); fb.connect(this.delay); dl.connect(this.music);
    this.noiseBuf = this.noise(2);
    // rolling: looped brown noise → bandpass, plus low rumble and seam "clicks" via LFO
    const src = c.createBufferSource(); src.buffer = this.noise(3, true); src.loop = true;
    this.rollBP = c.createBiquadFilter(); this.rollBP.type = 'bandpass'; this.rollBP.frequency.value = 300; this.rollBP.Q.value = 0.7;
    this.rollAmp = c.createGain(); this.rollAmp.gain.value = 0;
    src.connect(this.rollBP); this.rollBP.connect(this.rollAmp); this.rollAmp.connect(this.sfx); src.start();
    this.rum = c.createOscillator(); this.rum.type = 'sine'; this.rum.frequency.value = 48;
    this.rumAmp = c.createGain(); this.rumAmp.gain.value = 0; this.rum.connect(this.rumAmp); this.rumAmp.connect(this.sfx); this.rum.start();
    this.lfo = c.createOscillator(); this.lfo.type = 'square'; this.lfo.frequency.value = 2;
    this.lfoAmp = c.createGain(); this.lfoAmp.gain.value = 0; this.lfo.connect(this.lfoAmp); this.lfoAmp.connect(this.rollAmp.gain); this.lfo.start();
    // iOS unlock
    const b = c.createBufferSource(); b.buffer = c.createBuffer(1, 1, 22050); b.connect(c.destination); b.start(0);
    if (c.state !== 'running') c.resume().catch(() => {});
    this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 50);
  }
  noise(sec, brown) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }
  impulse(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2); }
    return b;
  }
  get ok() { return !!this.ctx && this.ctx.state === 'running'; }
  setMusic(on) { this.musicOn = !!on; Store.set('musicOn', this.musicOn); this.applyGains(); }
  setSfx(on) { this.sfxOn = !!on; Store.set('sfxOn', this.sfxOn); this.applyGains(); }
  setVolumes(sfx, music) {
    this.sfxVol = sfx; this.musicVol = music; Store.set('sfxVol', sfx); Store.set('musicVol', music);
    this.applyGains();
  }
  applyGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, s = this.sfxOn ? this.sfxVol : 0, m = this.musicOn ? this.musicVol : 0;
    this.sfx.gain.setTargetAtTime(s, t, 0.05); this.verbS.gain.setTargetAtTime(s, t, 0.05);
    this.music.gain.setTargetAtTime(m * 0.55, t, 0.05); this.verbM.gain.setTargetAtTime(m, t, 0.05);
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }

  // soft: rolling on grass (a duller rustle, less rumble)
  setRoll(speed, contact, soft) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, lv = contact ? clamp(speed / 16, 0, 1) : 0;
    this.rollAmp.gain.setTargetAtTime(lv * (soft ? 0.24 : 0.34), t, 0.05);
    this.rollBP.frequency.setTargetAtTime(soft ? 900 + speed * 45 : 160 + speed * 70, t, 0.08);
    this.rumAmp.gain.setTargetAtTime(lv * (soft ? 0.08 : 0.22), t, 0.06);
    this.rum.frequency.setTargetAtTime(38 + speed * 2.4, t, 0.1);
    this.lfo.frequency.setTargetAtTime(Math.max(0.5, speed / 1.0), t, 0.1);
    this.lfoAmp.gain.setTargetAtTime(lv * (soft ? 0.18 : 0.12), t, 0.05);
  }

  // ---- tiny synth helpers
  env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  tone(type, f, t, a, peak, dec, dest, f2) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    this.env(g, t, a, peak, dec); o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + a + dec + 0.05);
    return g;
  }
  burst(t, dur, peak, type, f, q, dest, f2) {
    const c = this.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    this.env(g, t, 0.004, peak, dur); s.connect(fl); fl.connect(g); g.connect(dest || this.sfx);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  mtof(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  hit(impact) {
    if (!this.ok) return; const t = this.ctx.currentTime, v = clamp(impact / 9, 0.12, 1);
    this.burst(t, 0.08, 0.5 * v, 'bandpass', 2600, 1.2);
    for (const f of [410, 1130, 1870, 2960]) this.tone('sine', f * (0.95 + Math.random() * 0.1), t, 0.002, 0.14 * v, 0.28 + Math.random() * 0.2);
  }
  // rolling through a grass tuft (cut: mowed by star power)
  grass(speed, cut) {
    if (!this.ok) return; const t = this.ctx.currentTime, v = clamp(speed / 14, 0.3, 1);
    this.burst(t, cut ? 0.22 : 0.16, (cut ? 0.3 : 0.22) * v, 'bandpass', cut ? 3200 : 2200, 0.9, null, cut ? 1400 : 900);
    if (!cut) this.tone('sine', 150, t, 0.004, 0.18 * v, 0.12, null, 70);
  }
  // star power smashing an obstacle
  smash() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    this.burst(t, 0.45, 0.5, 'lowpass', 2400, 0.8, null, 180);
    this.burst(t, 0.12, 0.35, 'highpass', 3000, 0.7);
    this.tone('sine', 140, t, 0.004, 0.45, 0.35, null, 45);
    for (const m of [84, 91]) this.tone('triangle', this.mtof(m), t + 0.04, 0.005, 0.08, 0.4, this.verbS);
  }
  land(imp) {
    if (!this.ok) return; const t = this.ctx.currentTime, v = clamp(imp / 10, 0.1, 1);
    this.tone('sine', 110, t, 0.004, 0.5 * v, 0.2, null, 42);
    this.burst(t, 0.1, 0.25 * v, 'lowpass', 700, 0.7);
  }
  gem() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    this.gemCombo = t - this.lastGem < 1.6 ? Math.min(this.gemCombo + 1, 8) : 0; this.lastGem = t;
    const base = 84 + [0, 2, 4, 7, 9, 12, 14, 16, 19][this.gemCombo];
    this.tone('triangle', this.mtof(base), t, 0.004, 0.22, 0.2, this.sfx);
    this.tone('sine', this.mtof(base + 7), t + 0.07, 0.004, 0.18, 0.35, this.verbS);
    this.tone('sine', this.mtof(base + 19), t + 0.07, 0.004, 0.06, 0.25);
  }
  checkpoint() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    [72, 76, 79, 84, 88].forEach((m, i) => { this.tone('triangle', this.mtof(m), t + i * 0.06, 0.005, 0.16, 0.6); this.tone('sine', this.mtof(m + 12), t + i * 0.06, 0.005, 0.05, 0.9, this.verbS); });
    this.burst(t, 0.8, 0.08, 'highpass', 6000, 0.5, this.verbS);
  }
  boost() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    this.burst(t, 0.6, 0.35, 'bandpass', 350, 1.6, null, 3800);
    this.tone('sawtooth', 90, t, 0.02, 0.1, 0.55, null, 420);
    this.tone('sine', 220, t, 0.01, 0.2, 0.4, null, 880);
  }
  fall() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    this.tone('sine', 820, t, 0.02, 0.22, 1.5, null, 70);
    this.tone('triangle', 410, t + 0.05, 0.02, 0.08, 1.4, this.verbS, 50);
    this.burst(t, 1.6, 0.3, 'lowpass', 1800, 0.8, null, 120);
  }
  gameOver() {
    if (!this.ok) return; const t = this.ctx.currentTime + 0.1;
    [57, 60, 64, 69].forEach((m, i) => { this.tone('triangle', this.mtof(m), t + i * 0.12, 0.02, 0.12, 1.8); this.tone('sine', this.mtof(m - 12), t + i * 0.12, 0.02, 0.08, 2.2, this.verbS); });
  }
  record() {
    if (!this.ok) return; const t = this.ctx.currentTime + 0.05;
    [72, 76, 79, 84, 88, 91, 96].forEach((m, i) => { this.tone('square', this.mtof(m), t + i * 0.075, 0.005, 0.05, 0.3); this.tone('triangle', this.mtof(m), t + i * 0.075, 0.005, 0.14, 0.7, this.verbS); });
    this.burst(t + 0.5, 1.2, 0.1, 'highpass', 7000, 0.5, this.verbS);
  }
  go() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone('triangle', 880, t, 0.005, 0.2, 0.15); this.tone('triangle', 1760, t + 0.12, 0.005, 0.2, 0.4, this.verbS); }
  tick() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone('sine', 1320, t, 0.002, 0.08, 0.06); }
  setTempo(k) { this.tempo = k; }
  starOn() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    [60, 64, 67, 72, 76, 79, 84, 88].forEach((m, i) => { this.tone('sawtooth', this.mtof(m), t + i * 0.045, 0.01, 0.05, 0.5); this.tone('triangle', this.mtof(m + 12), t + i * 0.045, 0.01, 0.12, 0.9, this.verbS); });
    this.burst(t, 0.9, 0.25, 'bandpass', 500, 1.2, this.verbS, 6000);
  }
  starOff() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    [84, 79, 76, 72].forEach((m, i) => this.tone('triangle', this.mtof(m), t + i * 0.07, 0.01, 0.09, 0.5, this.verbS));
  }
  starReady() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    [76, 83, 88].forEach((m, i) => this.tone('sine', this.mtof(m), t + i * 0.08, 0.005, 0.14, 0.5, this.verbS));
  }
  coinMiss() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone('square', 196, t, 0.005, 0.05, 0.15, null, 150); }
  thunder() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    this.burst(t, 1.8, 0.5, 'lowpass', 260, 0.9, null, 60);
    this.burst(t + 0.05, 0.4, 0.3, 'bandpass', 900, 0.8, this.verbS, 200);
  }
  whoosh() {
    if (!this.ok) return; const t = this.ctx.currentTime;
    this.burst(t, 1.4, 0.18, 'bandpass', 200, 1.2, this.verbS, 2400);
    this.tone('sine', 110, t, 0.4, 0.08, 1.2, this.verbS, 220);
  }
  warn() { if (!this.ok) return; const t = this.ctx.currentTime; this.tone('square', 220, t, 0.005, 0.04, 0.12); }

  // ---- generative ambient music (lookahead scheduler)
  schedule() {
    const c = this.ctx; if (!c || c.state !== 'running') return;
    const stepDur = 60 / (84 * this.tempo) / 4;
    if (!this.musicOn) { this.nextT = c.currentTime + 0.1; return; }   // no nodes created while music is off
    if (this.nextT < c.currentTime - 0.5) this.nextT = c.currentTime + 0.05;
    const CH = [
      { root: 45, pad: [57, 60, 64, 67, 71], sc: [69, 72, 74, 76, 79, 81] },
      { root: 41, pad: [53, 57, 60, 64, 67], sc: [69, 72, 76, 77, 79, 81] },
      { root: 48, pad: [55, 59, 60, 64, 67], sc: [67, 71, 72, 74, 76, 79] },
      { root: 43, pad: [55, 59, 62, 64, 67], sc: [67, 71, 74, 76, 78, 79] },
    ];
    while (this.nextT < c.currentTime + 0.25) {
      const st = this.step, t = this.nextT, bar16 = st % 32, ci = Math.floor(st / 32) % 4, ch = CH[ci], I = this.intensity;
      if (bar16 === 0) this.pad(ch.pad, t, stepDur * 32);
      if (st % 16 === 0 || st % 16 === 10) this.tone('triangle', this.mtof(ch.root - 12 + 12), t, 0.02, 0.16, stepDur * 5, this.music);
      if (Math.random() < 0.18 + I * 0.4 && st % 2 === 0) {
        const m = ch.sc[Math.floor(Math.random() * ch.sc.length)] + (Math.random() < 0.2 ? 12 : 0);
        const g = this.tone('triangle', this.mtof(m), t, 0.004, 0.05 + I * 0.03, 0.35, this.music);
        g.connect(this.delay);
      }
      if (I > 0.45 && st % 4 === 2) this.burst(t, 0.04, 0.03 * I, 'highpass', 8000, 0.7, this.music);
      if (this.tempo > 1.05 && st % 2 === 1) this.tone('triangle', this.mtof(ch.sc[(st >> 1) % ch.sc.length] + 12), t, 0.003, 0.05, 0.12, this.music);   // star power arpeggio
      if (I > 0.65 && st % 8 === 0) this.tone('sine', 120, t, 0.003, 0.28 * I, 0.22, this.music, 42);
      this.nextT += stepDur; this.step++;
    }
  }
  pad(notes, t, dur) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.value = 700 + this.intensity * 1400; f.Q.value = 0.3;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.055, t + 1.8); g.gain.setValueAtTime(0.055, t + dur - 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur + 1.4);
    f.connect(g); g.connect(this.music); g.connect(this.verbM);
    for (const m of notes) for (const det of [-7, 7]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = this.mtof(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 1.5);
    }
  }

  // ---- music for the shared video: rendered offline to fit the video's parts, then played into a
  // stream track (never to the speakers) while the recorder runs. It is added even when the game
  // music is off: the video is made for other people. null when the browser cannot do it.
  async videoMusic(plan) {
    const c = this.ctx, OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!c || !OAC || typeof c.createMediaStreamDestination !== 'function') return null;
    if (c.state !== 'running') await Promise.race([c.resume().catch(() => {}), new Promise((r) => setTimeout(r, 400))]);
    if (c.state !== 'running') return null;
    const buf = await renderTune(new OAC(2, Math.ceil(c.sampleRate * (plan.total + 0.1)), c.sampleRate), plan);
    const dest = c.createMediaStreamDestination(), track = dest.stream.getAudioTracks()[0];
    if (!buf || !track) return null;
    let src = null;
    return {
      track,
      start() { src = c.createBufferSource(); src.buffer = buf; src.connect(dest); src.start(); },
      stop() { try { if (src) { src.stop(); src.disconnect(); } } catch (e) { /* already stopped */ } track.stop(); },
    };
  }
}

// A 124 BPM tune in A minor for the shared video. P: { intro, main, end, outro, total, record } in
// seconds. A noise riser under the intro; a house groove (kick, claps, hats, off-beat bass, a
// ping-pong arpeggio, pumping pads on Am–F–C–G) under the fast timelapse, with a clap roll into the
// fall; a boom and a falling whoosh over the real-time ending; a last chord and a bell arpeggio
// under the score card (A major after a record), fading out with the video.
function renderTune(c, P) {
  const tA = P.intro, tE = tA + P.main, tO = tE + P.end, T = P.total, beat = 60 / 124, s16 = beat / 4;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const out = c.createGain(), comp = c.createDynamicsCompressor();
  out.gain.setValueAtTime(0.62, 0); out.gain.setValueAtTime(0.62, Math.max(0, T - 0.8)); out.gain.linearRampToValueAtTime(0.0001, T);
  comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  out.connect(comp); comp.connect(c.destination);
  const noise = c.createBuffer(1, c.sampleRate, c.sampleRate), nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const verb = c.createConvolver(), ir = c.createBuffer(2, c.sampleRate * 2, c.sampleRate), vOut = c.createGain();
  for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3); }
  verb.buffer = ir; vOut.gain.value = 0.3; verb.connect(vOut); vOut.connect(out);
  const pump = c.createGain(); pump.connect(out);                          // pads, bass and arpeggio duck under each kick
  let ducked = -1;
  const duck = (t) => { if (t < ducked + 0.22) return; ducked = t; pump.gain.setValueAtTime(0.4, t); pump.gain.linearRampToValueAtTime(1, t + 0.2); };
  const delay = c.createDelay(1), fb = c.createGain(), dOut = c.createGain();
  delay.delayTime.value = s16 * 3; fb.gain.value = 0.32; dOut.gain.value = 0.35;
  delay.connect(fb); fb.connect(delay); delay.connect(dOut); dOut.connect(pump);
  const panned = (x) => { if (!c.createStereoPanner) return pump; const p = c.createStereoPanner(); p.pan.value = x; p.connect(pump); return p; };
  const side = [panned(-0.35), panned(0.35)];
  const env = (g, t, a, peak, dec) => { g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); };
  const tone = (type, f, t, a, peak, dec, dest, f2) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dec);
    env(g, t, a, peak, dec); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dec + 0.05);
    return g;
  };
  const hiss = (t, dur, peak, type, f, q, dest, f2) => {
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; s.loop = true; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
    env(g, t, 0.003, peak, dur); s.connect(fl); fl.connect(g); g.connect(dest);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
    return g;
  };
  const pad = (notes, t, dur, cut, peak) => {
    const f = c.createBiquadFilter(), g = c.createGain();
    f.type = 'lowpass'; f.frequency.setValueAtTime(cut, t); f.Q.value = 0.4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(peak, t + 0.06);
    g.gain.setValueAtTime(peak, t + Math.max(0.07, dur - 0.1)); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.3);
    f.connect(g); g.connect(pump); g.connect(verb);
    for (const m of notes) for (const det of [-9, 9]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.35);
    }
    return f;
  };
  const kick = (t, peak = 0.8) => { tone('sine', 150, t, 0.002, peak, 0.3, out, 46); hiss(t, 0.012, 0.08, 'highpass', 4000, 0.7, out); duck(t); };
  const crash = (t, peak) => { const g = hiss(t, 1.3, peak, 'highpass', 3200, 0.5, out); g.connect(verb); };
  const CH = [
    { root: 33, pad: [57, 60, 64, 67, 71], arp: [69, 72, 76, 79] },       // Am9
    { root: 29, pad: [53, 57, 60, 64, 67], arp: [65, 69, 72, 76] },       // Fmaj9
    { root: 36, pad: [55, 59, 60, 64, 67], arp: [67, 72, 76, 79] },       // Cmaj7
    { root: 31, pad: [55, 59, 62, 64, 67], arp: [67, 71, 74, 79] },       // G6
  ];
  const ARP = [0, 1, 2, 3, 1, 2, 3, 2];
  // intro: a rising noise sweep and the first chord opening up
  if (tA > 0.1) {
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; s.loop = true; fl.type = 'bandpass'; fl.Q.value = 1.2;
    fl.frequency.setValueAtTime(300, 0); fl.frequency.exponentialRampToValueAtTime(6000, tA);
    g.gain.setValueAtTime(0.0001, 0); g.gain.exponentialRampToValueAtTime(0.22, tA); g.gain.linearRampToValueAtTime(0.0001, tA + 0.03);
    s.connect(fl); fl.connect(g); g.connect(out); s.start(0); s.stop(tA + 0.05);
    const f = pad(CH[0].pad, 0, tA, 300, 0.035); f.frequency.exponentialRampToValueAtTime(2200, tA);
  }
  // the timelapse: a house groove on a 16th-note grid; the last beat before the fall is a clap roll
  crash(tA, 0.14);
  for (let k = 0; ; k++) {
    const t = tA + k * s16;
    if (t > tE - 0.02) break;
    const ch = CH[Math.floor(k / 16) % 4], roll = t >= tE - beat;
    if (k % 16 === 0) pad(ch.pad, t, Math.min(beat * 4, tE - t), 1800, 0.045);
    if (roll) { hiss(t, 0.1, 0.08 + 0.17 * (1 - (tE - t) / beat), 'bandpass', 1700, 0.9, out); continue; }
    if (k % 4 === 0) kick(t);
    if (k % 8 === 4) { const g = hiss(t, 0.15, 0.3, 'bandpass', 1500, 0.8, out); g.connect(verb); }
    if (k % 2 === 1 || k % 4 === 2) hiss(t, 0.035, k % 4 === 2 ? 0.11 : 0.035, 'highpass', 8000, 0.7, out);
    if (k % 4 === 2 || k % 16 === 15) {
      const o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
      o.type = 'sawtooth'; o.frequency.value = mtof(ch.root + (k % 16 === 15 ? 12 : 0));
      f.type = 'lowpass'; f.Q.value = 5; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + s16 * 1.8);
      env(g, t, 0.004, 0.2, s16 * 1.8); o.connect(f); f.connect(g); g.connect(pump); o.start(t); o.stop(t + s16 * 2 + 0.05);
    }
    const g = tone('triangle', mtof(ch.arp[ARP[k % 8]] + (k % 32 >= 16 ? 12 : 0)), t, 0.003, 0.07, 0.16, side[k & 1]);
    g.connect(delay);
  }
  // the real-time ending: a boom, the chord of the fall closing down and a whoosh falling with the ball
  if (tO - tE > 0.1) {
    kick(tE, 1); crash(tE, 0.12);
    tone('sine', 90, tE, 0.005, 0.5, P.end + 0.4, out, 30);
    const f = pad([53, 57, 60, 64], tE, P.end, 2400, 0.05); f.frequency.exponentialRampToValueAtTime(260, tO);
    const s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
    s.buffer = noise; s.loop = true; fl.type = 'bandpass'; fl.Q.value = 2;
    fl.frequency.setValueAtTime(5000, tE); fl.frequency.exponentialRampToValueAtTime(180, tO);
    g.gain.setValueAtTime(0.0001, tE); g.gain.linearRampToValueAtTime(0.16, tE + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, tO + 0.1);
    s.connect(fl); fl.connect(g); g.connect(out); s.start(tE); s.stop(tO + 0.15);
  }
  // the score card: the last chord, a bell arpeggio going up, the low A under it
  const third = P.record ? 61 : 60;
  kick(tO, 0.8); crash(tO, 0.16);
  pad([45, 57, third, 64, 69, 71], tO, T - tO, 2600, 0.06);
  tone('sine', mtof(33), tO, 0.01, 0.35, T - tO, out);
  const bells = P.record ? [69, 73, 76, 81, 85, 88] : [69, 72, 76, 81, 83, 88];
  bells.forEach((m, i) => {
    const t = tO + 0.1 + i * beat / 2;
    if (t > T - 0.3) return;
    const a = tone('sine', mtof(m), t, 0.003, 0.12, 1.1, side[i & 1]), b = tone('sine', mtof(m) * 2.01, t, 0.002, 0.035, 0.4, side[i & 1]);
    a.connect(verb); b.connect(verb); a.connect(delay);
  });
  return new Promise((res) => {
    c.oncomplete = (e) => res(e.renderedBuffer);
    const p = c.startRendering();                                         // a promise, except on old Safari
    if (p && p.catch) p.catch(() => res(null));
  });
}
