
// =====================================================================
// Track — ring-buffered centerline samples + per-row solid intervals.
// Sample i sits at arc length s = i*DS. Row i spans samples i..i+1.
// =====================================================================
const RF = { RAIL_L: 1, RAIL_R: 2, BOOST: 4, CHECK: 8, START: 16 };

class Track {
  constructor() {
    const C = CFG.CAP;
    this.mask = C - 1;
    this.x = new Float64Array(C); this.y = new Float64Array(C); this.z = new Float64Array(C);
    this.th = new Float64Array(C); this.w = new Float32Array(C); this.bank = new Float32Array(C);
    this.kap = new Float32Array(C); this.slope = new Float32Array(C);
    this.rowN = new Uint8Array(C);
    this.rowA = new Float32Array(C * 3); this.rowB = new Float32Array(C * 3);
    this.rowAO = new Uint8Array(C * 3); this.rowBO = new Uint8Array(C * 3); // endpoint follows outer edge
    this.rowF = new Uint16Array(C);
    this.n = 0;
    this.objects = [];
    this.loc = { i: 0, t: 0, s: 0, u: 0, cx: 0, cy: 0, cz: 0, th: 0, w: 0, bank: 0, slope: 0, fx: 0, fz: 1, rx: -1, rz: 0 };
  }
  reset() { this.n = 0; this.objects.length = 0; }
  get length() { return (this.n - 1) * CFG.DS; }
  minIndex() { return Math.max(0, this.n - CFG.CAP + 2); }

  // Width-aware endpoint of interval k of row i at fraction t.
  edgeA(i, k, t) { const m = i & this.mask; return this.rowAO[m * 3 + k] ? -this.widthAt(i, t) * 0.5 : this.rowA[m * 3 + k]; }
  edgeB(i, k, t) { const m = i & this.mask; return this.rowBO[m * 3 + k] ? this.widthAt(i, t) * 0.5 : this.rowB[m * 3 + k]; }
  widthAt(i, t) { const M = this.mask; return lerp(this.w[i & M], this.w[(i + 1) & M], t); }

  // Project a world XZ point onto the centerline, starting the search at `hint`.
  locate(px, pz, hint) {
    const M = this.mask, lo = this.minIndex(), hi = this.n - 2;
    let i = clamp(hint | 0, lo, Math.max(lo, hi)), t = 0;
    for (let it = 0; it < 80; it++) {
      const a = i & M, b = (i + 1) & M;
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const L2 = dx * dx + dz * dz || 1e-6;
      t = ((px - this.x[a]) * dx + (pz - this.z[a]) * dz) / L2;
      if (t < 0 && i > lo) { i--; continue; }
      if (t >= 1 && i < hi) { i++; continue; }
      break;
    }
    const L = this.loc;
    L.out = (t < -0.02 && i <= lo) || (t > 1.02 && i >= hi);   // beyond the first/last generated sample
    t = clamp(t, 0, 1);
    const a = i & M, b = (i + 1) & M;
    L.i = i; L.t = t; L.s = (i + t) * CFG.DS;
    L.cx = lerp(this.x[a], this.x[b], t); L.cy = lerp(this.y[a], this.y[b], t); L.cz = lerp(this.z[a], this.z[b], t);
    L.th = this.th[a] + wrapAngle(this.th[b] - this.th[a]) * t;
    L.w = lerp(this.w[a], this.w[b], t); L.bank = lerp(this.bank[a], this.bank[b], t);
    L.slope = this.slope[a];
    L.fx = Math.sin(L.th); L.fz = Math.cos(L.th); L.rx = -L.fz; L.rz = L.fx;
    L.u = (px - L.cx) * L.rx + (pz - L.cz) * L.rz;
    return L;
  }
  surfaceY(L, u) { return L.cy + u * Math.tan(L.bank); }
  // Returns interval index containing u (or -1).
  solidAt(i, t, u) {
    if (i < this.minIndex() || i >= this.n - 1) return -1;
    const m = i & this.mask, n = this.rowN[m];
    for (let k = 0; k < n; k++) if (u >= this.edgeA(i, k, t) && u <= this.edgeB(i, k, t)) return k;
    return -1;
  }
  // Point on the track surface at arc length s and lateral offset u (+ height h).
  pointAt(s, u, h, out) {
    const M = this.mask, f = s / CFG.DS;
    const i = clamp(Math.floor(f), this.minIndex(), Math.max(this.minIndex(), this.n - 2)), t = clamp(f - i, 0, 1);
    const a = i & M, b = (i + 1) & M;
    const th = this.th[a] + wrapAngle(this.th[b] - this.th[a]) * t;
    const bank = lerp(this.bank[a], this.bank[b], t);
    const rx = -Math.cos(th), rz = Math.sin(th);
    out[0] = lerp(this.x[a], this.x[b], t) + rx * u;
    out[1] = lerp(this.y[a], this.y[b], t) + u * Math.tan(bank) + h;
    out[2] = lerp(this.z[a], this.z[b], t) + rz * u;
    out[3] = th;
    return out;
  }
}

// =====================================================================
// TrackGenerator — procedural endless sections with difficulty ramp.
// Sections output *targets*; actual values are rate-limited so geometry
// always stays smooth, and every hazard is validated against the real
// width at that row so a safe line always exists.
// =====================================================================
class TrackGenerator {
  constructor(track, seed) {
    this.T = track;
    this.rng = RNG(seed);
    this.th = 0; this.x = 0; this.y = 0; this.z = 0;
    this.kap = 0; this.w = 3.6; this.bank = 0; this.slope = 0;
    this.sec = null; this.k = 0;
    this.last = ''; this.afterBoost = false;
    this.nextCheck = CFG.CHECKPOINT + CFG.START_S;
    this.forceSlope = null;
    this.count = 0;
  }
  diff(s) { return clamp(Math.pow(Math.max(0, s - 60) / 2600, 0.85), 0, 1); }

  fill(uptoS) {
    while ((this.T.n - 1) * CFG.DS < uptoS) this.emit();
  }

  emit() {
    const T = this.T, DS = CFG.DS;
    if (!this.sec || this.k >= this.sec.len) { this.sec = this.nextSection(); this.k = 0; }
    const i = T.n, m = i & T.mask, s = i * DS, sec = this.sec, k = this.k;
    const tg = sec.at(k);
    // Heading guard: predict the overshoot of ramping curvature back to 0 and
    // turn back early, so |heading| < 90° always (z strictly increases: no loops).
    let tk = tg.k;
    const over = this.th + Math.sign(this.kap) * (this.kap * this.kap) / 0.112;
    if (over > 1.4 && tk > -0.03) tk = -0.03;
    if (over < -1.4 && tk < 0.03) tk = 0.03;
    // rate-limited smoothing of the shape parameters
    this.kap += clamp(tk - this.kap, -0.028, 0.028);
    this.w += clamp(tg.w - this.w, -0.07, 0.07);
    this.bank += clamp(tg.b - this.bank, -0.012, 0.012);
    if (tg.drop !== undefined) this.slope = tg.drop; else this.slope += clamp(tg.sl - this.slope, -0.006, 0.006);

    T.x[m] = this.x; T.y[m] = this.y; T.z[m] = this.z; T.th[m] = this.th;
    T.w[m] = this.w; T.bank[m] = this.bank; T.kap[m] = this.kap; T.slope[m] = this.slope;

    // default row: one full-width interval
    T.rowN[m] = 1; T.rowF[m] = 0;
    T.rowA[m * 3] = -this.w / 2; T.rowB[m * 3] = this.w / 2; T.rowAO[m * 3] = 1; T.rowBO[m * 3] = 1;
    if (sec.row) sec.row(k, m, s);
    if (s >= this.nextCheck) {
      T.rowF[m] |= RF.CHECK;
      T.objects.push({ kind: 'gate', s: s, u: 0, id: this.count++, cp: Math.round(this.nextCheck - CFG.START_S) });
      this.nextCheck += CFG.CHECKPOINT;
    }
    if (sec.spawn) sec.spawn(k, s);

    // integrate centerline
    const thMid = this.th + this.kap * DS * 0.5;
    this.x += Math.sin(thMid) * DS; this.z += Math.cos(thMid) * DS;
    this.th += this.kap * DS;
    this.y += this.slope * DS;
    T.n++;
    this.k++;
  }

  // ------------------------------------------------------------- helpers
  turnSign(angle) {
    // keep the track heading within ±80° of the main axis so it never loops back on itself
    const lim = 1.35;
    let sg = this.rng.sign();
    if (this.th > 0.45) sg = -1; else if (this.th < -0.45) sg = 1;
    if (Math.abs(this.th + sg * angle) > lim) sg = -sg;
    return sg;
  }
  gem(s, u, h = 0.55) { this.T.objects.push({ kind: 'gem', s, u, h, id: this.count++, taken: false }); }
  mk(len, at, row, spawn, name) { return { len: Math.max(2, Math.round(len / CFG.DS)), at, row, spawn, name }; }
  flat(w, sl = -0.03) { return { k: 0, w, b: 0, sl }; }

  nextSection() {
    const s = this.T.n * CFG.DS, d = this.diff(s), r = this.rng;
    const W = lerp(3.3, 2.25, d);
    if (this.T.n === 0) return this.startPad();
    if (this.breathe) { this.breathe = false; const L = lerp(9, 3, d) + r.range(0, 4); return this.mk(L, () => this.flat(W, -0.02), null, null, 'breather'); }
    this.breathe = r.chance(lerp(0.9, 0.45, d));

    if (this.afterBoost) { this.afterBoost = false; this.last = 'curve'; return this.curve(d, W, true); }
    const wts = {
      straight: lerp(2.6, 1.0, d), curve: lerp(3.0, 2.2, d), zigzag: d > 0.04 ? lerp(1.2, 2.4, d) : 0,
      narrow: d > 0.1 ? lerp(0.6, 1.5, d) : 0, banked: d > 0.14 ? lerp(0.7, 1.5, d) : 0,
      holes: d > 0.06 ? lerp(1.0, 2.0, d) : 0, gaps: d > 0.12 ? lerp(0.7, 1.3, d) : 0,
      obstacles: d > 0.16 ? lerp(0.8, 1.6, d) : 0, hairpin: d > 0.38 ? lerp(0.6, 1.2, d) : 0,
      descent: lerp(0.7, 1.0, d),
    };
    if (this.last && this.last !== 'curve') wts[this.last] *= 0.15;
    let tot = 0; for (const k in wts) tot += wts[k];
    let x = r.next() * tot, pick = 'curve';
    for (const k in wts) { x -= wts[k]; if (x <= 0) { pick = k; break; } }
    this.last = pick;
    switch (pick) {
      case 'straight': return this.straight(d, W);
      case 'zigzag': return this.zigzag(d, W);
      case 'narrow': return this.narrow(d);
      case 'banked': return this.banked(d, W);
      case 'holes': return this.holes(d);
      case 'gaps': return this.gaps(d);
      case 'obstacles': return this.obstacles(d);
      case 'hairpin': return this.hairpin(d, W);
      case 'descent': return this.descent(d, W);
      default: return this.curve(d, W, false);
    }
  }

  // ------------------------------------------------------------- sections
  startPad() {
    return this.mk(34, () => ({ k: 0, w: 3.6, b: 0, sl: -0.01 }), (k, m) => { if (k < 3) this.T.rowF[m] |= RF.START; }, null, 'start');
  }
  straight(d, W) {
    const r = this.rng, boost = r.chance(0.3 + d * 0.2), L = boost ? r.range(32, 40) : r.range(16, 30), n = Math.round(L / CFG.DS);
    const gemLane = r.range(-0.6, 0.6) * (W / 2 - 0.5), gemAt = r.chance(0.7) ? Math.round(n * 0.3) : -1;
    if (boost) this.afterBoost = true;
    return this.mk(L, () => this.flat(W, -0.035), (k, m) => {
      if (boost && k >= 4 && k < 8) this.T.rowF[m] |= RF.BOOST;
    }, (k, s) => {
      if (gemAt >= 0 && k >= gemAt && k < gemAt + 20 && (k - gemAt) % 4 === 0) this.gem(s, gemLane);
    }, 'straight');
  }
  descent(d, W) {
    const r = this.rng, L = r.range(24, 38), n = Math.round(L / CFG.DS);
    const lane = r.range(-0.5, 0.5) * (W / 2 - 0.5);
    this.afterBoost = true;
    return this.mk(L, (k) => ({ k: 0, w: W + 0.3, b: 0, sl: k < n * 0.75 ? -0.13 : -0.02 }), (k, m) => {
      if (k >= 2 && k < 6) this.T.rowF[m] |= RF.BOOST;
    }, (k, s) => { if (k > 14 && k < n - 10 && k % 6 === 0) this.gem(s, lane + Math.sin(k * 0.2) * 0.4); }, 'descent');
  }
  curve(d, W, gentle) {
    const r = this.rng;
    const kMax = gentle ? 0.05 : lerp(0.085, 0.2, d);
    const kap = r.range(gentle ? 0.03 : 0.045, kMax);
    const sg = this.turnSign(0.8);
    const ang = Math.max(0.35, Math.min(r.range(0.7, gentle ? 1.3 : 2.1), 1.4 - sg * this.th));
    const L = ang / kap;
    const rails = !gentle && kap > 0.1 && r.chance(lerp(0.8, 0.15, d));
    const gems = r.chance(0.55);
    const n = Math.round(L / CFG.DS);
    const w = W + (kap > 0.12 ? 0.25 : 0);
    return this.mk(L, () => ({ k: sg * kap, w, b: 0, sl: -0.02 }), (k, m) => {
      if (rails && k > 2 && k < n - 2) this.T.rowF[m] |= sg > 0 ? RF.RAIL_R : RF.RAIL_L;
    }, (k, s) => {
      if (gems && k > 4 && k < n - 4 && k % 5 === 0) this.gem(s, -sg * 0.35 * (w / 2 - 0.4)); // inside of the bend
    }, 'curve');
  }
  hairpin(d, W) {
    const r = this.rng, kap = lerp(0.17, 0.25, d) * r.range(0.9, 1.05), ang = r.range(1.9, 2.6);
    const sg = this.turnSign(1.0);
    const turnAng = Math.max(0.6, Math.min(ang, 1.4 - sg * this.th));
    const L = turnAng / kap, n = Math.round(L / CFG.DS);
    const rails = r.chance(lerp(0.7, 0.2, d));
    return this.mk(L + 6, (k) => ({ k: k < 12 ? 0 : sg * kap, w: W + 0.35, b: 0, sl: 0 }), (k, m) => {
      if (rails && k > 14 && k < n + 10) this.T.rowF[m] |= sg > 0 ? RF.RAIL_R : RF.RAIL_L;
    }, null, 'hairpin');
  }
  zigzag(d, W) {
    const r = this.rng, turns = r.int(3, 4 + Math.round(d * 3));
    const segL = lerp(8.5, 5, d) * r.range(0.9, 1.15);
    const kap = Math.max(0.03, Math.min(lerp(0.08, 0.2, d) * r.range(0.85, 1.05), 2 * (1.35 - Math.abs(this.th)) / segL));
    const per = Math.round(segL / CFG.DS);
    let sg = r.sign();
    // keep zigzag centered on the current heading: the first half-segment starts the swing
    if (this.th > 0.3) sg = -1; else if (this.th < -0.3) sg = 1;
    const w = W + 0.1;
    return this.mk(segL * turns + segL * 0.5, (k) => {
      const seg = Math.floor((k + per / 2) / per);
      return { k: (seg % 2 === 0 ? sg : -sg) * kap, w, b: 0, sl: -0.03 };
    }, null, (k, s) => { if (k % per === Math.floor(per / 2) && r.chance(0.4)) this.gem(s, 0); }, 'zigzag');
  }
  narrow(d) {
    const r = this.rng, wN = lerp(1.9, 1.3, d) * r.range(0.95, 1.08), L = r.range(12, 22) + d * 8;
    const wig = r.range(0.015, 0.04) * (0.5 + d), ph = r.range(0, TAU), n = Math.round(L / CFG.DS);
    return this.mk(L, (k) => ({ k: k > 8 && k < n - 4 ? Math.sin(k * 0.09 + ph) * wig : 0, w: wN, b: 0, sl: -0.025 }), null,
      (k, s) => { if (k > 10 && k % 7 === 0 && r.chance(0.6)) this.gem(s, 0); }, 'narrow');
  }
  banked(d, W) {
    const r = this.rng, bank = lerp(0.12, 0.23, d) * r.sign(), L = r.range(16, 26), n = Math.round(L / CFG.DS);
    const velodrome = r.chance(0.5);
    // velodrome: turn toward the low side (bank helps). Tilted straight: bank pushes to an edge.
    const sg = velodrome ? this.turnSign(1.0) : 1;
    const kap = velodrome ? Math.min(lerp(0.07, 0.15, d), Math.max(0, 1.4 - sg * this.th) / (L - 5)) : r.range(-0.02, 0.02);
    const b = velodrome ? -sg * Math.abs(bank) : bank;
    return this.mk(L, (k) => ({ k: k > 4 && k < n - 6 ? sg * kap : 0, w: W + 0.3, b: k < n - 8 ? b : 0, sl: -0.02 }), null,
      (k, s) => { if (k > 8 && k < n - 8 && k % 6 === 0) this.gem(s, Math.sign(b) * 0.4); }, 'banked');
  }
  holes(d) {
    const r = this.rng, W = lerp(2.9, 2.6, d), L = r.range(22, 34) + d * 10, n = Math.round(L / CFG.DS);
    const minLane = 1.12;
    // Pre-plan hole rows (index -> {type, extent}); first 10 rows let the width settle.
    const plan = new Map(); const gems = [];
    let k = 10, side = r.sign();
    while (k < n - 8) {
      const hl = Math.round(r.range(1.4, 2.2 + d * 1.0) / CFG.DS);
      const type = d > 0.3 && r.chance(0.3) ? 'center' : 'side';
      for (let j = 0; j < hl; j++) plan.set(k + j, { type, side });
      gems.push({ k: k + (hl >> 1), u: type === 'center' ? side * (W / 2 - 0.45) : -side * (W / 2 - 0.55) });
      k += hl + Math.round(r.range(lerp(8, 4.2, d), lerp(12, 6, d)) / CFG.DS);
      side = r.chance(0.75) ? -side : side;
    }
    return this.mk(L, (kk) => ({ k: 0, w: W, b: 0, sl: -0.02 }), (kk, m) => {
      const h = plan.get(kk); if (!h) return;
      const T = this.T, w = this.w, j = m * 3;
      if (h.type === 'side') {
        const keep = Math.max(minLane, w * lerp(0.52, 0.42, d));
        if (h.side > 0) { T.rowA[j] = -w / 2; T.rowAO[j] = 1; T.rowB[j] = -w / 2 + keep; T.rowBO[j] = 0; }
        else { T.rowA[j] = w / 2 - keep; T.rowAO[j] = 0; T.rowB[j] = w / 2; T.rowBO[j] = 1; }
      } else {
        const lane = Math.max(0.95, (w - lerp(0.8, 1.0, d)) / 2);
        T.rowN[m] = 2;
        T.rowA[j] = -w / 2; T.rowAO[j] = 1; T.rowB[j] = -w / 2 + lane; T.rowBO[j] = 0;
        T.rowA[j + 1] = w / 2 - lane; T.rowAO[j + 1] = 0; T.rowB[j + 1] = w / 2; T.rowBO[j + 1] = 1;
      }
    }, (kk, s) => { for (const g of gems) if (g.k === kk) this.gem(s, g.u); }, 'holes');
  }
  gaps(d) {
    const r = this.rng, W = 2.7, count = r.int(2, 2 + Math.round(d * 2));
    const pattern = []; // row states: 0 solid, 1 gap
    const push = (len, v) => { for (let j = 0; j < Math.round(len / CFG.DS); j++) pattern.push(v); };
    push(3, 0); push(1.5, 2); push(6, 0); // booster (2), then run-up
    for (let c = 0; c < count; c++) {
      push(lerp(1.0, 1.9, d) + r.range(0, 0.3), 1);
      push(c === count - 1 ? 10 : r.range(4.5, 7), 0);
    }
    const drop = 0.5;
    this.afterBoost = true;
    return this.mk(pattern.length * CFG.DS, (k) => {
      const v = pattern[k];
      if (v === 1) {
        let gl = 0; for (let j = k; j >= 0 && pattern[j] === 1; j--) gl++;
        let gr = 0; for (let j = k; j < pattern.length && pattern[j] === 1; j++) gr++;
        return { k: 0, w: W, b: 0, sl: 0, drop: -drop / ((gl + gr - 1) * CFG.DS) };
      }
      return { k: 0, w: W, b: 0, sl: 0, drop: 0 };
    }, (k, m) => {
      if (pattern[k] === 1) this.T.rowN[m] = 0;
      if (pattern[k] === 2) this.T.rowF[m] |= RF.BOOST;
    }, (k, s) => { if (pattern[k] === 1 && pattern[k - 1] === 0) this.gem(s, 0, 0.9); }, 'gaps');
  }
  obstacles(d) {
    const r = this.rng, W = lerp(3.0, 2.8, d), L = r.range(22, 32), n = Math.round(L / CFG.DS);
    const slider = d > 0.3 && r.chance(0.5);
    const ks = new Map();
    let k = 12, side = r.sign();
    while (k < n - 8) {
      if (slider && r.chance(0.5)) {
        ks.set(k, { kind: 'slider', amp: W / 2 - 0.55, period: r.range(2.4, 3.4) - d * 0.4, phase: r.range(0, TAU) });
      } else {
        // post leaving a lane of at least 1.35 m on the other side
        ks.set(k, { kind: 'post', u: side * (W / 2 - r.range(0.45, 0.75)) });
        side = -side;
      }
      k += Math.round(r.range(lerp(10, 6, d), lerp(14, 8, d)) / CFG.DS);
    }
    return this.mk(L, () => ({ k: 0, w: W, b: 0, sl: -0.02 }), null, (kk, s) => {
      const o = ks.get(kk); if (!o) return;
      if (o.kind === 'post') { this.T.objects.push({ kind: 'post', s, u: o.u, rad: 0.3, id: this.count++ }); this.gem(s, -o.u * 0.6); }
      else this.T.objects.push({ kind: 'slider', s, u: 0, rad: 0.42, amp: o.amp, period: o.period, phase: o.phase, id: this.count++ });
    }, 'obstacles');
  }
}
