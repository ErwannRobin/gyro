
// =====================================================================
// Replay — records a light timelapse of the run (small JPEG snapshots of the
// WebGL canvas) and turns it into a short accelerated video at game over,
// using MediaRecorder on an offscreen canvas. Falls back to a score image.
// =====================================================================
class Replay {
  constructor() {
    this.snap = document.createElement('canvas'); this.snapCx = this.snap.getContext('2d');
    this.pending = 0;
    this.canVideo = typeof window.MediaRecorder === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
    this.reset();
  }
  reset() {
    if (this.job) this.job.abort = true;
    this.frames = []; this.ending = []; this.interval = 0.25; this.acc = 0; this.job = null; this.gen = (this.gen || 0) + 1;
  }
  // Must run right after the frame was rendered (the drawing buffer is still valid).
  capture(src, dt, dist, ending) {
    this.acc += dt;
    const iv = ending ? 1 / 12 : this.interval;
    if (this.acc < iv || this.pending > 4) return;
    if (ending && this.ending.length >= 26) return;
    this.acc = 0;
    const k = 640 / Math.max(src.width, src.height, 1);
    const w = Math.max(2, Math.round(src.width * k / 2) * 2), h = Math.max(2, Math.round(src.height * k / 2) * 2);
    if (this.snap.width !== w || this.snap.height !== h) { this.snap.width = w; this.snap.height = h; }
    try { this.snapCx.drawImage(src, 0, 0, w, h); } catch (e) { return; }
    this.pending++;
    const gen = this.gen;
    this.snap.toBlob((b) => {
      this.pending--;
      if (!b || gen !== this.gen) return;
      (ending ? this.ending : this.frames).push({ b, dist });
      if (!ending && this.frames.length > 90) {                          // keep a uniform timelapse of the whole run
        this.frames = this.frames.filter((_, i) => i % 2 === 0); this.interval *= 2;
      }
    }, 'image/jpeg', 0.72);
  }
  decode(blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(blob).catch(() => this.decodeImg(blob));
    return this.decodeImg(blob);
  }
  decodeImg(blob) {
    return new Promise((res) => { const u = URL.createObjectURL(blob), im = new Image(); im.onload = () => { URL.revokeObjectURL(u); res(im); }; im.onerror = () => { URL.revokeObjectURL(u); res(null); }; im.src = u; });
  }

  // info: { dist, score, best, record, tag, accent, accent2, portrait }
  async make(info, onProgress, attempt = 0) {
    const job = { abort: false }; this.job = job;
    const list = this.frames.concat(this.ending);
    const W = info.portrait ? 540 : 960, H = info.portrait ? 960 : 540;
    const out = document.createElement('canvas'); out.width = W; out.height = H;
    const g = out.getContext('2d');
    const card = async () => this.card(g, W, H, list.length ? await this.decode(list[list.length - 1].b) : null, info, 1);
    if (!this.canVideo || !list.length) {
      await card();
      const blob = await new Promise((r) => out.toBlob(r, 'image/png'));
      return blob ? new File([blob], `gyroll-${Math.floor(info.dist)}m.png`, { type: 'image/png' }) : null;
    }
    const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mime = types.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } });
    let rec, track;
    try {
      const stream = out.captureStream(30); track = stream.getVideoTracks()[0];
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 3000000 } : undefined);
    }
    catch (e) { this.canVideo = false; return this.make(info, onProgress); }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const done = new Promise((r) => { rec.onstop = r; });
    const nMain = this.frames.length, fps = Math.max(12, nMain / 7), tMain = nMain / fps, tEnd = this.ending.length / 12;
    const INTRO = 0.7, OUTRO = 2.4, total = INTRO + tMain + tEnd + OUTRO;
    const speedX = Math.max(2, Math.round(this.interval * fps));
    // sliding window of decoded frames so memory stays small
    const cache = new Map();
    const want = (i) => { if (i < 0 || i >= list.length || cache.has(i)) return; cache.set(i, this.decode(list[i].b)); };
    const get = async (i) => { want(i); const im = await cache.get(i); for (let j = i + 1; j <= i + 4; j++) want(j); for (const k of cache.keys()) if (k < i - 1) { cache.get(k).then((b) => b && b.close && b.close()); cache.delete(k); } return im; };
    const first = await get(0);
    this.frame(g, W, H, first, info, list[0].dist, 0, 0, speedX);          // prime the stream before recording
    rec.start(250);
    for (let k = 0; k < (attempt ? 30 : 4); k++) { await new Promise((r) => setTimeout(r, 40)); this.frame(g, W, H, first, info, list[0].dist, 0, 0, speedX); }
    const t0 = performance.now();
    let last = null;
    while (!job.abort) {
      const t = (performance.now() - t0) / 1000;
      if (t >= total) break;
      let i, phase;
      if (t < INTRO) { i = 0; phase = 0; }
      else if (t < INTRO + tMain) { i = Math.min(nMain - 1, Math.floor((t - INTRO) * fps)); phase = 1; }
      else if (t < INTRO + tMain + tEnd) { i = nMain + Math.min(this.ending.length - 1, Math.floor((t - INTRO - tMain) * 12)); phase = 2; }
      else { i = list.length - 1; phase = 3; }
      const im = await get(i); if (im) last = im;
      if (phase === 3) this.card(g, W, H, last, info, clamp((t - INTRO - tMain - tEnd) / 0.5, 0, 1));
      else this.frame(g, W, H, last, info, list[i].dist, phase, t, speedX);
      if (track && track.requestFrame) track.requestFrame();
      onProgress(t / total);
      await new Promise((r) => setTimeout(r, 30));
    }
    try { rec.requestData(); } catch (e) { /* ignore */ }
    rec.stop(); await done;
    for (const p of cache.values()) p.then((b) => b && b.close && b.close());
    if (job.abort) return null;
    if (!chunks.length) {                                   // some encoders need a warm-up: retry once, then use an image
      if (attempt === 0) return this.make(info, onProgress, 1);
      this.canVideo = false; const f = await this.make(info, onProgress, 2); this.canVideo = true; return f;
    }
    const type = (mime || chunks[0].type || 'video/webm').split(';')[0];
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    return new File(chunks, `gyroll-${Math.floor(info.dist)}m.${ext}`, { type });
  }
  cover(g, W, H, im) {
    if (!im) { g.fillStyle = '#05060d'; g.fillRect(0, 0, W, H); return; }
    const k = Math.max(W / im.width, H / im.height), w = im.width * k, h = im.height * k;
    g.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
  }
  font(px, w = 900) { return `${w} ${px}px -apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,Arial,sans-serif`; }
  logo(g, x, y, px, info, align = 'center') {
    g.font = this.font(px); g.textAlign = align; g.textBaseline = 'middle';
    const gr = g.createLinearGradient(x - px * 2, 0, x + px * 2, 0);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, info.accent); gr.addColorStop(1, info.accent2);
    g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = px * 0.3; g.fillStyle = gr; g.fillText('GYROLL', x, y); g.shadowBlur = 0;
  }
  frame(g, W, H, im, info, dist, phase, t, speedX) {
    this.cover(g, W, H, im);
    const top = g.createLinearGradient(0, 0, 0, H * 0.22); top.addColorStop(0, 'rgba(0,0,0,.65)'); top.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = top; g.fillRect(0, 0, W, H * 0.22);
    this.logo(g, 22, 34, 26, info, 'left');
    g.font = this.font(Math.round(W * 0.1)); g.textAlign = 'center'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,.7)'; g.shadowBlur = 12;
    g.fillText(fmt(dist) + ' m', W / 2, H * 0.11); g.shadowBlur = 0;
    g.font = this.font(18, 800); g.textAlign = 'right'; g.fillStyle = info.accent;
    g.fillText(phase === 2 ? '1×' : '⏩ ' + speedX + '×', W - 20, 34);
    if (info.tag) { g.font = this.font(14, 800); g.textAlign = 'center'; g.fillStyle = 'rgba(255,255,255,.8)'; g.fillText(info.tag, W / 2, H - 28); }
    if (phase === 0) {
      const a = 1 - clamp(t / 0.7, 0, 1);
      g.fillStyle = `rgba(5,6,13,${0.75 * a})`; g.fillRect(0, 0, W, H);
      g.globalAlpha = a; this.logo(g, W / 2, H / 2, Math.round(W * 0.16), info); g.globalAlpha = 1;
    }
  }
  card(g, W, H, im, info, a) {
    this.cover(g, W, H, im);
    g.fillStyle = `rgba(5,6,13,${0.72 * a})`; g.fillRect(0, 0, W, H);
    g.globalAlpha = a;
    const cy = H / 2, u = Math.min(W, H) / 540;
    this.logo(g, W / 2, cy - 190 * u, Math.round(62 * u), info);
    g.textAlign = 'center'; g.fillStyle = '#fff';
    if (info.record) { g.font = this.font(Math.round(26 * u)); g.fillStyle = '#ffd36b'; g.fillText(info.recordTxt, W / 2, cy - 105 * u); g.fillStyle = '#fff'; }
    g.font = this.font(Math.round(104 * u)); g.fillText(fmt(info.dist) + ' m', W / 2, cy - 10 * u);
    g.font = this.font(Math.round(24 * u), 800); g.fillText('SCORE ' + fmt(info.score), W / 2, cy + 75 * u);
    g.fillStyle = 'rgba(255,255,255,.7)'; g.font = this.font(Math.round(18 * u), 800); g.fillText('BEST ' + fmt(info.best) + ' m', W / 2, cy + 112 * u);
    if (info.tag) { g.fillStyle = info.accent; g.font = this.font(Math.round(16 * u), 800); g.fillText(info.tag, W / 2, cy + 150 * u); }
    g.fillStyle = 'rgba(255,255,255,.85)'; g.font = this.font(Math.round(20 * u), 500); g.fillText('How far can you go?', W / 2, cy + 200 * u);
    g.fillStyle = info.accent; g.font = this.font(Math.round(18 * u), 800); g.fillText(PROD_HOST, W / 2, cy + 236 * u);
    g.globalAlpha = 1;
  }
}
