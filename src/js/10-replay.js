// =====================================================================
// Replay — keeps pictures of the run and turns them into a screenshot or a video at game over.
// While playing, the WebGL canvas is copied as a JPEG about 24 times a second. The last 10
// seconds stay complete (real speed video, frame picker); older pictures thin out into an even
// timelapse of the whole run. At the end the chosen pictures are drawn on a 2D canvas with the
// score around them: a JPEG for a screenshot, or a video recorded by MediaRecorder, with its own
// music when the browser can record sound.
// =====================================================================
const REPLAY_FPS = 24, REPLAY_KEEP = 10;
const SHARE_FMT = { story: [9, 16], square: [1, 1], wide: [16, 9] };
const SHARE_RATE = { 480: 2500000, 720: 5000000, 1080: 8000000 };     // video bits per second for each quality
class Replay {
  constructor(audio, mobile) {
    this.audio = audio;
    this.caps = mobile ? [720, 960, 1280, 1280] : [960, 1280, 1920, 1920];   // longest side of a kept picture, per quality level
    this.cap = this.caps[3];
    this.snap = document.createElement('canvas'); this.snapCx = this.snap.getContext('2d');
    this.pending = 0;
    this.canVideo = typeof window.MediaRecorder === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    this.reset();
  }
  // A slower device (lower quality level) keeps smaller pictures, so filming costs it less.
  setLevel(level) { this.cap = this.caps[clamp(level | 0, 0, 3)]; }
  reset() {
    if (this.job) this.job.abort = true;
    this.frames = []; this.recent = []; this.interval = 0.25; this.acc = 0; this.t = 0; this.job = null; this.gen = (this.gen || 0) + 1;
  }
  // Must run right after the frame was rendered (the drawing buffer is still valid).
  // dt: real seconds since the last call; fall: the ball is falling (the end of the run).
  capture(src, dt, dist, speed, fall) {
    this.t += dt; this.acc += dt;
    if (this.acc < 1 / REPLAY_FPS - 1e-4 || this.pending > 3) return;
    this.acc = Math.min(this.acc - 1 / REPLAY_FPS, 1 / REPLAY_FPS);
    const k = Math.min(1, this.cap / Math.max(src.width, src.height, 1));
    const w = Math.max(2, Math.round(src.width * k / 2) * 2), h = Math.max(2, Math.round(src.height * k / 2) * 2);
    if (this.snap.width !== w || this.snap.height !== h) { this.snap.width = w; this.snap.height = h; }
    try { this.snapCx.drawImage(src, 0, 0, w, h); } catch (e) { return; }
    this.pending++;
    const gen = this.gen, f = { b: null, t: this.t, dist, speed, fall: !!fall };
    this.snap.toBlob((b) => {
      this.pending--;
      if (b && gen === this.gen) { f.b = b; this.keep(f); }
    }, 'image/jpeg', 0.8);
  }
  keep(f) {
    const R = this.recent;
    let i = R.length; while (i > 0 && R[i - 1].t > f.t) i--;
    R.splice(i, 0, f);
    const last = R[R.length - 1].t;
    while (R.length && R[0].t < last - REPLAY_KEEP) {              // older pictures thin out into the timelapse
      const o = R.shift(), F = this.frames;
      if (!F.length || o.t - F[F.length - 1].t >= this.interval - 1e-3) F.push(o);
      if (F.length > 90) { this.frames = F.filter((_, j) => j % 2 === 0); this.interval *= 2; }
    }
  }
  // Every kept picture, oldest first (the frame picker).
  all() { return this.frames.concat(this.recent); }
  // The best moment for a screenshot: the fastest one before the fall.
  bestIndex() {
    const A = this.all();
    let bi = A.length - 1, bs = -1;
    A.forEach((f, i) => { if (!f.fall && f.speed >= bs) { bs = f.speed; bi = i; } });
    return Math.max(0, bi);
  }
  get span() { const R = this.recent; return R.length ? R[R.length - 1].t - R[0].t + 1 / REPLAY_FPS : 0; }
  decode(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob).catch(() => this.decodeImg(blob));
    return this.decodeImg(blob);
  }
  decodeImg(blob) {
    return new Promise((res) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); res(null); }; im.src = u; });
  }

  // The video's plan. 'fast': an intro, the whole run as a timelapse (about 7 s), the fall at real
  // speed, the score card. 'real': the same around the last seconds, all at real speed.
  // seq: pictures with their start time (t0) and phase (1 run, 2 fall).
  timeline(speed) {
    const R = this.recent, INTRO = 0.7, OUTRO = 2.4, seq = [];
    const live = R.filter((f) => !f.fall), fall = R.filter((f) => f.fall);
    let tMain, badge;
    if (speed === 'real') {
      const t0 = R.length ? R[0].t : 0;
      for (const f of live) seq.push({ f, t0: INTRO + f.t - t0, ph: 1 });
      tMain = fall.length ? fall[0].t - t0 : live.length ? live[live.length - 1].t - t0 + 1 / REPLAY_FPS : 0;
      badge = '1×';
    } else {
      const main = this.frames.slice();
      let last = main.length ? main[main.length - 1].t : -1e9;
      for (const f of live) if (f.t - last >= this.interval - 1e-3) { main.push(f); last = f.t; }
      const fps = Math.max(12, main.length / 7), step = main.length > 1 ? (main[main.length - 1].t - main[0].t) / (main.length - 1) : this.interval;
      main.forEach((f, i) => seq.push({ f, t0: INTRO + i / fps, ph: 1 }));
      tMain = main.length / fps;
      badge = '⏩ ' + Math.max(2, Math.round(step * fps)) + '×';
    }
    const e0 = fall.length ? fall[0].t : 0;
    for (const f of fall) seq.push({ f, t0: INTRO + tMain + f.t - e0, ph: 2 });
    const tEnd = fall.length ? fall[fall.length - 1].t - e0 + 1 / REPLAY_FPS : 0;
    return { seq, intro: INTRO, main: tMain, end: tEnd, outro: OUTRO, total: INTRO + tMain + tEnd + OUTRO, badge };
  }
  // What the video shows at time t: the picture (index in T.seq) and the phase (0 intro … 3 card).
  at(T, t) {
    const S = T.seq;
    if (!S.length) return { i: -1, ph: 3 };
    if (t >= T.intro + T.main + T.end) return { i: S.length - 1, ph: 3 };
    let lo = 0, hi = S.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (S[mid].t0 <= t) lo = mid; else hi = mid - 1; }
    return { i: lo, ph: t < T.intro ? 0 : S[lo].ph };
  }
  // Output size for a format ('story' 9:16, 'square', 'wide' 16:9) and a quality (its short side).
  size(fmt, res) {
    const [a, b] = SHARE_FMT[fmt] || SHARE_FMT.story, k = res / Math.min(a, b), even = (x) => Math.round(x / 2) * 2;
    return [even(a * k), even(b * k)];
  }

  // Records the video. o: { speed, fmt, res }. onProgress(0..1), onFrame(canvas) after each picture.
  async make(info, o, onProgress, onFrame, attempt = 0) {
    const T = this.timeline(o.speed);
    if (!this.canVideo || !T.seq.length) return null;
    const job = { abort: false }; this.job = job;
    const [W, H] = this.size(o.fmt, o.res);
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d');
    // music fitted to the four parts; a browser that fails to record it gets silent videos from then on
    let tune = null;
    if (!this.noAudio && this.audio) tune = await this.audio.videoMusic({ intro: T.intro, main: T.main, end: T.end, outro: T.outro, total: T.total, record: info.record }).catch(() => null);
    if (job.abort) { if (tune) tune.stop(); return null; }
    const types = tune ? ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = types.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
    let rec, track;
    try {
      const stream = out.captureStream(30); track = stream.getVideoTracks()[0];
      if (tune) stream.addTrack(tune.track);
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: SHARE_RATE[o.res] || SHARE_RATE[720] } : undefined);
    } catch (e) {
      if (tune) { tune.stop(); this.noAudio = true; return this.make(info, o, onProgress, onFrame, attempt); }
      this.canVideo = false; return null;
    }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    // sliding window of decoded pictures so memory stays small
    const S = T.seq, cache = new Map();
    const want = (i) => { if (i < 0 || i >= S.length || cache.has(i)) return; cache.set(i, this.decode(S[i].f.b)); };
    const get = async (i) => {
      want(i); const im = await cache.get(i);
      for (let j = i + 1; j <= i + 5; j++) want(j);
      for (const k of cache.keys()) if (k < i - 1) { cache.get(k).then((b) => b && b.close && b.close()); cache.delete(k); }
      return im;
    };
    const draw = (t, im, a) => {
      if (a.ph === 3) this.card(g, W, H, im, info, clamp((t - T.intro - T.main - T.end) / 0.5, 0, 1));
      else this.frame(g, W, H, im, info, S[a.i].f.dist, a.ph, t, T.badge);
      if (track && track.requestFrame) track.requestFrame();
      if (onFrame) onFrame(out);
    };
    const first = await get(0);
    draw(0, first, { i: 0, ph: 0 });                                    // prime the stream before recording
    rec.start(250);
    for (let k = 0; k < (attempt ? 30 : 4); k++) { await new Promise((r) => setTimeout(r, 40)); draw(0, first, { i: 0, ph: 0 }); }
    if (tune) tune.start();                                              // the music and the pictures share the same start
    const t0 = performance.now();
    let last = first;
    while (!job.abort) {
      const t = (performance.now() - t0) / 1000;
      if (t >= T.total) break;
      const a = this.at(T, t), im = await get(a.i);
      if (im) last = im;
      draw(t, last, a);
      onProgress(t / T.total);
      await new Promise((r) => setTimeout(r, 1000 / 30));
    }
    try { rec.requestData(); } catch (e) { /* ignore */ }
    rec.stop(); await done;
    if (tune) tune.stop();
    for (const p of cache.values()) p.then((b) => b && b.close && b.close());
    if (this.job === job) this.job = null;
    if (job.abort) return null;
    if (!chunks.length) {                                               // some encoders need a warm-up: retry once
      if (tune) this.noAudio = true;
      if (attempt === 0) return this.make(info, o, onProgress, onFrame, 1);
      return null;
    }
    const type = (mime || chunks[0].type || 'video/webm').split(';')[0];
    return new File(chunks, `gyroll-${Math.floor(info.dist)}m.${type.includes('mp4') ? 'mp4' : 'webm'}`, { type });
  }
  // The file type this browser records into (for the settings line), or null.
  videoType() {
    if (!this.canVideo) return null;
    const t = ['video/mp4', 'video/webm'].find((x) => { try { return MediaRecorder.isTypeSupported(x); } catch (e) { return false; } });
    return t ? t.split('/')[1].toUpperCase() : 'WEBM';
  }
  // A screenshot as a JPEG file, made at once (it stays inside the tap, so it can be shared).
  imageFile(im, info, fmt) {
    const [W, H] = this.size(fmt, 1080), c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    if (im) this.still(g, W, H, im, info); else this.card(g, W, H, null, info, 1);
    const url = c.toDataURL('image/jpeg', 0.92), bin = atob(url.slice(url.indexOf(',') + 1)), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return new File([a], `gyroll-${Math.floor(info.dist)}m.jpg`, { type: 'image/jpeg' });
  }

  // ---- drawing (every size is in units of u: 1/540 of the picture's short side)
  cover(g, W, H, im) {
    if (!im) { g.fillStyle = '#05060d'; g.fillRect(0, 0, W, H); return; }
    const k = Math.max(W / im.width, H / im.height), w = im.width * k, h = im.height * k;
    g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }
  font(px, w = 900) { return `${w} ${Math.round(px)}px -apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Arial,sans-serif`; }
  logo(g, x, y, px, info, align = 'center') {
    g.font = this.font(px); g.textAlign = align; g.textBaseline = 'middle';
    const gr = g.createLinearGradient(x - px * 2, 0, x + px * 2, 0);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, info.accent); gr.addColorStop(1, info.accent2);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = px * 0.3; g.fillStyle = gr; g.fillText('GYROLL', x, y); g.shadowBlur = 0;
  }
  shade(g, W, H, y0, y1) {
    const gr = g.createLinearGradient(0, y0, 0, y1); gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, Math.min(y0, y1), W, Math.abs(y1 - y0));
  }
  // One picture of the video: the run with the logo, the distance there and the speed badge.
  frame(g, W, H, im, info, dist, ph, t, badge) {
    const u = Math.min(W, H) / 540;
    this.cover(g, W, H, im);
    this.shade(g, W, H, 0, 150 * u);
    this.logo(g, 22 * u, 34 * u, 26 * u, info, 'left');
    g.font = this.font(54 * u); g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 12 * u;
    g.fillText(fmt(dist) + ' m', W / 2, 96 * u); g.shadowBlur = 0;
    g.font = this.font(18 * u, 800); g.textAlign = 'right'; g.fillStyle = info.accent;
    g.fillText(ph === 2 ? '1×' : badge, W - 20 * u, 34 * u);
    if (info.tag) { g.font = this.font(14 * u, 800); g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(info.tag, W / 2, H - 28 * u); }
    if (ph === 0) {
      const a = 1 - clamp(t / 0.7, 0, 1);
      g.fillStyle = `rgba(5,6,13,${0.75 * a})`; g.fillRect(0, 0, W, H);
      g.globalAlpha = a; this.logo(g, W / 2, H / 2, 86 * u, info); g.globalAlpha = 1;
    }
  }
  // A screenshot: the chosen moment, with the run's result above and the score and the link below.
  still(g, W, H, im, info) {
    const u = Math.min(W, H) / 540;
    this.cover(g, W, H, im);
    this.shade(g, W, H, 0, 160 * u); this.shade(g, W, H, H, H - 150 * u);
    this.logo(g, 22 * u, 34 * u, 26 * u, info, 'left');
    g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 12 * u;
    g.font = this.font(58 * u); g.fillText(fmt(info.dist) + ' m', W / 2, 100 * u);
    g.font = this.font(20 * u, 800); g.fillText('SCORE ' + fmt(info.score), W / 2, H - (info.tag ? 88 : 64) * u);
    if (info.tag) { g.font = this.font(14 * u, 800); g.fillStyle = 'rgba(255,255,255,.85)'; g.fillText(info.tag, W / 2, H - 60 * u); }
    g.font = this.font(16 * u, 800); g.fillStyle = info.accent; g.fillText(PROD_HOST, W / 2, H - 32 * u);
    g.shadowBlur = 0;
  }
  card(g, W, H, im, info, a) {
    this.cover(g, W, H, im);
    g.fillStyle = `rgba(5,6,13,${0.72 * a})`; g.fillRect(0, 0, W, H);
    g.globalAlpha = a;
    const cy = H / 2, u = Math.min(W, H) / 540;
    this.logo(g, W / 2, cy - 190 * u, 62 * u, info);
    g.textAlign = 'center'; g.fillStyle = '#fff';
    if (info.record) { g.font = this.font(26 * u); g.fillStyle = '#ffd36b'; g.fillText(info.recordTxt, W / 2, cy - 105 * u); g.fillStyle = '#fff'; }
    g.font = this.font(104 * u); g.fillText(fmt(info.dist) + ' m', W / 2, cy - 10 * u);
    g.font = this.font(24 * u, 800); g.fillText('SCORE ' + fmt(info.score), W / 2, cy + 75 * u);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = this.font(18 * u, 800); g.fillText('BEST ' + fmt(info.best) + ' m', W / 2, cy + 112 * u);
    if (info.tag) { g.fillStyle = info.accent; g.font = this.font(16 * u, 800); g.fillText(info.tag, W / 2, cy + 150 * u); }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = this.font(20 * u, 500); g.fillText('How far can you go?', W / 2, cy + 200 * u);
    g.fillStyle = info.accent; g.font = this.font(18 * u, 800); g.fillText(PROD_HOST, W / 2, cy + 236 * u);
    g.globalAlpha = 1;
  }
}

// =====================================================================
// ShareBox — the SHARE popup of the game over screen. Choose a screenshot (scrub the replay to
// the best moment) or a video (timelapse or real speed, format, quality); DOWNLOAD and SHARE turn
// on once there is something to send.
// =====================================================================
class ShareBox {
  constructor(game) {
    const $ = (id) => document.getElementById(id);
    this.g = game; this.R = game.replay;
    this.el = { box: $('shareBox'), panel: $('shPanel'), view: $('shView'), cv: $('shCanvas'), vid: $('shVideo'), frame: $('shFrame'), lbl: $('shFrameLbl'), play: $('btnShPlay'),
      info: $('shInfo'), make: $('btnShMake'), dl: $('btnShDl'), share: $('btnShShare'), note: $('shNote') };
    this.cx = this.el.cv.getContext('2d');
    this.kind = ''; this.fmt = 'story'; this.speed = 'fast'; this.res = 720; this.info = null;
    this.file = null; this.url = null; this.busy = false; this.pic = null; this.picI = -1; this.anim = 0;
    const tap = (el, fn) => el.addEventListener('click', (e) => { e.preventDefault(); fn(e); });
    for (const b of document.querySelectorAll('.shTile')) tap(b, () => { this.setKind(b.dataset.kind); this.g.audio.tick(); });
    for (const b of document.querySelectorAll('#shFmt button')) tap(b, () => { if (b.dataset.fmt !== this.fmt) { this.fmt = b.dataset.fmt; this.changed(); this.g.audio.tick(); } });
    for (const b of document.querySelectorAll('#shSpeed button')) tap(b, () => { if (b.dataset.speed !== this.speed) { this.speed = b.dataset.speed; this.changed(); this.g.audio.tick(); } });
    for (const b of document.querySelectorAll('#shRes button')) tap(b, () => { if (+b.dataset.res !== this.res) { this.res = +b.dataset.res; this.changed(); this.g.audio.tick(); } });
    tap($('btnShClose'), () => { this.close(); this.g.audio.tick(); });
    this.el.box.addEventListener('click', (e) => { if (e.target === this.el.box) this.close(); });   // a tap outside the panel
    tap(this.el.play, () => this.togglePlay());
    this.el.frame.addEventListener('input', () => { this.stopPlay(); this.pick(+this.el.frame.value); });
    tap(this.el.make, () => this.makeVideo());
    tap(this.el.dl, () => this.download());
    tap(this.el.share, () => this.send());
    window.addEventListener('resize', () => { if (this.open) this.layout(); });
  }
  get open() { return this.el.box.classList.contains('open'); }
  show(info) {
    const E = this.el;
    this.info = info; this.kind = ''; this.clearFile();
    this.fmt = this.g.R.h >= this.g.R.w ? 'story' : 'wide';
    const A = this.R.all(); this.picI = -1; this.pic = null;
    E.frame.max = String(Math.max(0, A.length - 1)); E.frame.value = String(this.R.bestIndex());
    E.box.dataset.kind = '';
    clearTimeout(E.box._t); E.box.classList.remove('hidden'); void E.box.offsetWidth; E.box.classList.add('open');
    this.texts(); this.layout();
    try { document.getElementById('btnShClose').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  close() {
    const E = this.el;
    if (!this.open) return;
    if (this.R.job) this.R.job.abort = true;
    this.busy = false; this.stopPlay(); cancelAnimationFrame(this.anim); this.anim = 0;
    E.vid.pause(); E.box.classList.remove('open');
    clearTimeout(E.box._t); E.box._t = setTimeout(() => { if (!this.open) { E.box.classList.add('hidden'); this.clearFile(); } }, 350);
  }
  setKind(k) {
    if (k === 'video' && !this.R.videoType()) return;
    if (k === this.kind) return;
    this.kind = k; this.el.box.dataset.kind = k;
    this.changed();
  }
  // Any setting changed: a screenshot is ready at once, a video has to be made again.
  changed() {
    if (this.R.job) this.R.job.abort = true;
    this.busy = false; this.clearFile(); this.stopPlay();
    this.texts(); this.layout();
  }
  clearFile() {
    this.file = null;
    if (this.url) { URL.revokeObjectURL(this.url); this.url = null; }
    const v = this.el.vid; v.pause(); v.removeAttribute('src'); v.classList.add('hidden'); this.el.cv.classList.remove('hidden');
    try { v.load(); } catch (e) { /* ignore */ }
  }
  // Labels, pills, the settings line and which buttons can be used.
  texts() {
    const E = this.el, U = this.g.ui, k = this.kind, vt = this.R.videoType();
    for (const b of document.querySelectorAll('.shTile')) {
      b.classList.toggle('on', b.dataset.kind === k);
      if (b.dataset.kind === 'video') { b.disabled = !vt; b.querySelector('small').textContent = tr(vt ? 'shVidSub' : 'shNoVideo'); }
    }
    U.setSeg('shFmt', 'fmt', this.fmt); U.setSeg('shSpeed', 'speed', this.speed); U.setSeg('shRes', 'res', String(this.res));
    const T = this.R.timeline(this.speed), sec = Math.max(1, Math.round(T.total)), mb = Math.max(0.1, (SHARE_RATE[this.res] + 128000) * T.total / 8 / 1048576);
    E.info.textContent = (this.speed === 'real' ? tr('shRealInfo', { s: Math.max(1, Math.round(this.R.span)) }) : tr('shFastInfo')) + ' · ' +
      tr('shSpecs', { type: vt || '', s: sec, mb: mb < 10 ? mb.toFixed(1) : Math.round(mb) });
    const ready = k === 'image' ? this.pic !== null || !this.R.all().length : k === 'video' && !!this.file;
    E.dl.disabled = E.share.disabled = !ready;
    E.make.classList.toggle('hidden', k !== 'video' || !!this.file);
    this.makeLabel();
  }
  makeLabel(p) {
    const b = this.el.make;
    b.classList.toggle('busy', this.busy); b.disabled = this.busy;
    b.querySelector('.lbl').textContent = this.busy ? tr('shMaking', { p: Math.round((p || 0) * 100) }) : tr('shMake');
    b.querySelector('.prog').style.width = this.busy ? Math.round((p || 0) * 100) + '%' : '0';
  }
  // The preview keeps the output's shape and fits the free space.
  layout() {
    const E = this.el, [a, b] = SHARE_FMT[this.fmt], vw = E.view.clientWidth, vh = E.view.clientHeight;
    if (!vw || !vh) return;
    const k = Math.min(vw / a, vh / b), w = Math.floor(a * k), h = Math.floor(b * k), dpr = Math.min(window.devicePixelRatio || 1, 2);
    for (const e of [E.cv, E.vid]) { e.style.width = w + 'px'; e.style.height = h + 'px'; }
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (E.cv.width !== pw || E.cv.height !== ph) { E.cv.width = pw; E.cv.height = ph; }
    this.paint();
  }
  // Draws the preview for the current choice: the score card, the chosen moment, or the video's plan playing.
  paint() {
    const E = this.el, W = E.cv.width, H = E.cv.height, g = this.cx;
    if (!this.info || !W) return;
    cancelAnimationFrame(this.anim); this.anim = 0;
    if (this.kind === 'image') {
      if (this.R.all().length) this.pick(+E.frame.value, true); else this.R.card(g, W, H, null, this.info, 1);
      return;
    }
    if (this.kind === 'video' && !this.busy && !this.file) { this.loop(); return; }
    if (this.kind === '') {
      const A = this.R.all(), f = A.length ? A[A.length - 1] : null;
      this.R.card(g, W, H, null, this.info, 1);
      if (f) this.R.decode(f.b).then((im) => { if (this.kind === '' && im) this.R.card(g, W, H, im, this.info, 1); });
    }
  }
  // Screenshot: shows picture i of the replay; once decoded it is the one a tap sends.
  pick(i, force) {
    const A = this.R.all(), E = this.el;
    if (!A.length) return;
    i = clamp(i | 0, 0, A.length - 1); E.frame.value = String(i);
    const f = A[i];
    this.g.ui.set('shLbl', E.lbl, fmt(f.dist) + ' m');
    if (i === this.picI && this.pic && !force) return;
    const want = this.want = i;
    this.R.decode(f.b).then((im) => {
      if (want !== this.want || !im || this.kind !== 'image') return;
      if (this.pic && this.pic.close && this.pic !== im) this.pic.close();
      this.pic = im; this.picI = i;
      this.R.still(this.cx, E.cv.width, E.cv.height, im, this.info);
      if (E.dl.disabled) this.texts();
    });
  }
  togglePlay() { if (this.playT) this.stopPlay(); else this.startPlay(); }
  startPlay() {
    const E = this.el, A = this.R.all();
    if (A.length < 2) return;
    let i = +E.frame.value; if (i >= A.length - 1) i = 0;
    E.play.classList.add('on');
    const step = () => {
      this.pick(i);
      if (++i >= A.length) { this.stopPlay(); return; }
      this.playT = setTimeout(step, clamp((A[i].t - A[i - 1].t) * 1000, 40, 90));    // real speed, the timelapse part a little faster
    };
    step();
  }
  stopPlay() { clearTimeout(this.playT); this.playT = 0; this.el.play.classList.remove('on'); }
  // Video, before it is made: its plan plays in the preview, in a loop.
  loop() {
    const E = this.el, T = this.R.timeline(this.speed), S = T.seq, cache = new Map(), t0 = performance.now();
    const W = E.cv.width, H = E.cv.height;
    let last = null;
    const frame = () => {
      if (this.kind !== 'video' || this.busy || this.file || !this.open) return;
      const t = ((performance.now() - t0) / 1000) % T.total, a = this.R.at(T, t);
      if (a.i >= 0 && !cache.has(a.i)) { const i = a.i; cache.set(i, null); this.R.decode(S[i].f.b).then((im) => { if (cache.has(i)) cache.set(i, im); else if (im && im.close) im.close(); }); }
      for (const k of cache.keys()) if (k < a.i - 2 || k > a.i + 40) { const im = cache.get(k); if (im && im.close && im !== last) im.close(); cache.delete(k); }
      const im = cache.get(a.i); if (im) last = im;
      if (a.ph === 3) this.R.card(this.cx, W, H, last, this.info, clamp((t - T.intro - T.main - T.end) / 0.5, 0, 1));
      else if (a.i >= 0) this.R.frame(this.cx, W, H, last, this.info, S[a.i].f.dist, a.ph, t, T.badge);
      this.anim = requestAnimationFrame(frame);
    };
    if (!S.length) { this.R.card(this.cx, W, H, null, this.info, 1); return; }
    frame();
  }
  makeVideo() {
    if (this.busy || this.kind !== 'video') return;
    const E = this.el, o = { speed: this.speed, fmt: this.fmt, res: this.res };
    this.busy = true; cancelAnimationFrame(this.anim); this.anim = 0; this.texts();
    const go = () => {
      if (!this.busy) return;
      if (this.R.pending > 0) { setTimeout(go, 100); return; }                     // last pictures still encoding
      this.R.make(this.info, o, (p) => { if (this.busy) this.makeLabel(p); },
        (out) => { if (this.busy) this.cx.drawImage(out, 0, 0, E.cv.width, E.cv.height); })
        .then((f) => this.made(f, o)).catch(() => this.made(null, o));
    };
    go();
  }
  made(f, o) {
    if (!this.busy || o.speed !== this.speed || o.fmt !== this.fmt || o.res !== this.res) return;
    this.busy = false;
    if (!f) { this.texts(); this.paint(); return; }
    this.file = f; this.url = URL.createObjectURL(f);
    const v = this.el.vid; v.src = this.url; v.classList.remove('hidden'); this.el.cv.classList.add('hidden');
    v.muted = true; v.play().catch(() => {});
    this.texts();
    Analytics.event('share_make', { kind: 'video', speed: o.speed, fmt: o.fmt, res: o.res });
  }
  // The file to send: the video made, or the screenshot drawn now at full size.
  current() {
    if (this.kind === 'video') return this.file;
    if (this.kind === 'image') return this.R.imageFile(this.pic, this.info, this.fmt);
    return null;
  }
  download() {
    const f = this.current();
    if (!f) return;
    const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    this.flash(this.el.dl, 'shSaved', 'shDownload');
    Analytics.event('share', { kind: this.kind, via: 'download' });
  }
  send() {
    const f = this.current(), text = this.g.shareText();
    if (!f) return;
    let canFiles;
    try { canFiles = !!(navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { canFiles = false; }
    if (navigator.share) {
      Analytics.event('share', { kind: this.kind, via: canFiles ? 'share' : 'text' });
      navigator.share(canFiles ? { files: [f], text, title: 'GYROLL' } : { text, title: 'GYROLL' }).catch(() => {});
      return;
    }
    // no share sheet (most desktops): save the file and copy the text with the link
    this.download();
    try { if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => this.flash(this.el.share, 'shCopied', 'shShare'), () => {}); } catch (e) { /* ignore */ }
  }
  flash(b, key, back) {
    const s = b.querySelector('span'); s.textContent = tr(key);
    clearTimeout(b._t); b._t = setTimeout(() => { s.textContent = tr(back); }, 2200);
  }
}
