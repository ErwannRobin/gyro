
// =====================================================================
// ParticleSystem — fixed pool, swap-remove, no per-frame allocation.
// =====================================================================
class ParticleSystem {
  constructor(max) {
    this.cap = 900; this.max = Math.min(max, this.cap); this.n = 0;
    const C = this.cap;
    this.p = new Float32Array(C * 3); this.v = new Float32Array(C * 3); this.c = new Float32Array(C * 3);
    this.life = new Float32Array(C); this.ml = new Float32Array(C); this.sz = new Float32Array(C);
    this.gr = new Float32Array(C); this.dr = new Float32Array(C);
    this.out = new Float32Array((C + 400) * 8);
  }
  clear() { this.n = 0; }
  emit(x, y, z, vx, vy, vz, life, col, size, grav = 0, drag = 1) {
    if (this.n >= this.max) return;
    const i = this.n++, j = i * 3;
    this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; this.v[j] = vx; this.v[j + 1] = vy; this.v[j + 2] = vz;
    this.c[j] = col[0]; this.c[j + 1] = col[1]; this.c[j + 2] = col[2];
    this.life[i] = this.ml[i] = Math.max(0.01, life); this.sz[i] = size; this.gr[i] = grav; this.dr[i] = drag;
  }
  burst(x, y, z, count, speed, col, o = {}) {
    const life = o.life || 0.8, size = o.size || 0.12, grav = o.grav === undefined ? 12 : o.grav, up = o.up || 0;
    for (let k = 0; k < count; k++) {
      let dx = Math.random() * 2 - 1, dy = Math.random() * 2 - 1, dz = Math.random() * 2 - 1;
      const l = Math.hypot(dx, dy, dz) || 1, s = speed * (0.35 + Math.random() * 0.65);
      dx = dx / l * s + (o.vx || 0); dy = dy / l * s + up; dz = dz / l * s + (o.vz || 0);
      const c = o.mix ? (Math.random() < 0.5 ? col : o.mix) : col;
      this.emit(x, y, z, dx, dy, dz, life * (0.5 + Math.random() * 0.7), c, size * (0.6 + Math.random() * 0.8), grav, o.drag || 1.5);
    }
  }
  update(dt) {
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.kill(i); i--; continue; }
      const j = i * 3, d = 1 - this.dr[i] * dt;
      this.v[j] *= d; this.v[j + 1] = this.v[j + 1] * d - this.gr[i] * dt; this.v[j + 2] *= d;
      this.p[j] += this.v[j] * dt; this.p[j + 1] += this.v[j + 1] * dt; this.p[j + 2] += this.v[j + 2] * dt;
    }
  }
  kill(i) {
    const l = --this.n; if (i === l) return;
    const a = i * 3, b = l * 3;
    for (let k = 0; k < 3; k++) { this.p[a + k] = this.p[b + k]; this.v[a + k] = this.v[b + k]; this.c[a + k] = this.c[b + k]; }
    this.life[i] = this.life[l]; this.ml[i] = this.ml[l]; this.sz[i] = this.sz[l]; this.gr[i] = this.gr[l]; this.dr[i] = this.dr[l];
  }
  write(out, off) {
    let o = off * 8;
    for (let i = 0; i < this.n; i++) {
      const j = i * 3, t = this.life[i] / this.ml[i], a = Math.min(1, (1 - t) * 8) * t;
      out[o++] = this.p[j]; out[o++] = this.p[j + 1]; out[o++] = this.p[j + 2];
      out[o++] = this.c[j]; out[o++] = this.c[j + 1]; out[o++] = this.c[j + 2]; out[o++] = a * 1.4;
      out[o++] = this.sz[i] * (0.5 + t * 0.5);
    }
    return off + this.n;
  }
}

// =====================================================================
// Environment — zone-driven world around the track, in parallax layers:
//   foreground: trackside props passing close (pylons, rocks, neon rings…)
//   midground : structures 30–150 m away (towers, islands, monoliths…)
//   background: one slow "hero" giant per zone + sky panorama + floor
// plus dust motes, light shafts and (in CHAOS) lightning.
// =====================================================================
const zoneAt = (s) => clamp(Math.floor((s - CFG.START_S) / ZONE_LEN), 0, ZONES.length - 1);
class Environment {
  constructor() {
    this.rng = RNG(99); this.tmp = [0, 0, 0, 0]; this.model = M4.create(); this.q = [0, 0, 0, 1]; this.qx = [0, 0, 0, 1];
    this.side = []; this.mid = []; this.heroes = []; this.shafts = []; this.bolts = [];
    this.dust = null; this.dustN = 0; this.density = 1; this.sideS = 0; this.midS = 0; this.boltT = 3;
  }
  reset(T, s0, envQ, dustN, M) {
    this.side.length = 0; this.mid.length = 0; this.heroes.length = 0; this.shafts.length = 0; this.bolts.length = 0;
    this.density = clamp(envQ / 22, 0.4, 1.2);
    this.sideS = s0 - 14; this.midS = s0 - 80; this.boltT = 3;
    for (let k = 0; k < 7; k++) this.shafts.push(this.spawnShaft(T, s0 + k * 50));
    this.update(T, s0, 0, M);
    this.setDust(dustN);
  }
  setDust(n) {
    this.dustN = n; this.dust = new Float32Array(n * 4);
    for (let k = 0; k < n; k++) this.dust.set([Math.random(), Math.random(), Math.random(), Math.random()], k * 4);
  }
  frame(T, s) {
    const sc = clamp(s, 0, Math.max(0, T.length - 1));
    T.pointAt(sc, 0, 0, this.tmp); const t = this.tmp;
    return { x: t[0], y: t[1], z: t[2], th: t[3], rx: -Math.cos(t[3]), rz: Math.sin(t[3]), fx: Math.sin(t[3]), fz: Math.cos(t[3]), w: T.w[Math.floor(sc / CFG.DS) & T.mask] };
  }
  item(list, s, mesh, x, y, z, sx, sy, sz, col, o = {}) {
    list.push({ s, mesh, x, y, z, sx, sy, sz, col, emis: o.emis === undefined ? 1 : o.emis, yaw: o.yaw || 0, spin: o.spin || 0, tilt: o.tilt || 0,
      tumble: o.tumble || 0, bob: o.bob || 0, blink: !!o.blink, q: o.q || null, fogK: o.fogK || 1, drift: o.drift || null, r: o.r || Math.max(sx, sy, sz),
      // occluder shape used to hide the object when the camera gets inside it or behind it
      occ: o.occ || 'sphere', cr: o.cr || Math.max(sx, sy, sz) * 0.9, nx: o.nx || 0, nz: o.nz || 0, R: o.R || 0 });
  }

  // ------------------------------------------------------------- foreground
  // Trackside props stay clear of the track corridor (edge + 1.4 m + their own size) so the
  // chase camera, which swings wide in tight bends, rarely meets them; draw() hides the rest.
  spawnSide(T, s, M) {
    const r = this.rng, z = zoneAt(s), Z = ZONES[z], f = this.frame(T, s), sg = r.sign();
    const clear = f.w / 2 + 1.4;
    const lat = (rad, extra, side = sg) => side * (clear + rad + r.range(0, extra));
    const at = (l, h) => [f.x + f.rx * l, f.y + h, f.z + f.rz * l];
    const plane = { occ: 'plane', nx: f.fx, nz: f.fz };
    let step;
    if (z === 0) {
      if (r.chance(0.16)) { this.item(this.side, s, M.gate, f.x, f.y, f.z, 2.0, 1.7, 1, Z.c1, { yaw: f.th, emis: 1.2, ...plane }); step = 14; }
      else {
        const p = at(lat(0.3, 3), r.range(0.8, 3.6));
        this.item(this.side, s, M.cube, p[0], p[1] - 20.2, p[2], 0.2, 40, 0.2, Z.c1, { occ: 'cyl', cr: 0.3 });
        this.item(this.side, s, M.glow, p[0], p[1], p[2], 0.34, 0.34, 0.34, r.chance(0.3) ? [1, 0.25, 0.3] : Z.c1, { blink: true, emis: 1.6, cr: 0.4 });
        step = r.range(8, 13);
      }
    } else if (z === 1) {
      const n = r.chance(0.3) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const sc = r.range(0.6, 2.4), p = at(lat(sc * 1.3, 5), r.range(-3.5, 3));
        this.item(this.side, s, M.rocks[r.int(0, 2)], p[0], p[1], p[2], sc, sc * r.range(0.7, 1.1), sc, [0.62, 0.5, 0.44], { yaw: r.range(0, TAU), spin: r.range(-0.1, 0.1), bob: r.range(0.1, 0.35), cr: sc * 1.5 });
      }
      step = r.range(6, 11);
    } else if (z === 2) {
      Q.yaw(this.q, f.th); Q.fromAxisAngle(this.qx, 1, 0, 0, Math.PI / 2);
      const q = Q.mul([0, 0, 0, 1], this.q, this.qx), RR = 4.8;
      this.item(this.side, s, M.ringGlow, f.x, f.y + 1.2, f.z, RR, RR, RR, (Math.floor(s / 18) & 1) ? Z.c1 : Z.c2, { q, emis: 1.4, r: RR + 0.3, occ: 'ring', R: RR, nx: f.fx, nz: f.fz });
      if (r.chance(0.5)) { const p = at(lat(0.2, 2.5), 0); this.item(this.side, s, M.glow, p[0], p[1] - 1, p[2], 0.1, 9, 0.1, Z.c2, { emis: 1.3, occ: 'cyl', cr: 0.25 }); }
      step = r.range(15, 21);
    } else if (z === 3) {
      const sc = r.range(0.45, 1.3), p = at(lat(sc * 1.4, 4), r.range(-2.5, 3.2)), kind = r.int(0, 2);
      const col = Z.neb[r.int(0, 3)], mesh = kind === 0 ? M.sphere : kind === 1 ? M.box16 : M.torus16;
      this.item(this.side, s, mesh, p[0], p[1], p[2], sc, sc, sc, col, { yaw: r.range(0, TAU), spin: r.range(-0.8, 0.8), tumble: r.range(-0.6, 0.6), bob: r.range(0.1, 0.4), cr: sc * 1.4 });
      step = r.range(6, 10);
    } else {
      const sc = r.range(0.5, 1.5), p = at(lat(sc * 2.2, 3), r.range(-2, 3));
      this.item(this.side, s, M.shards[r.int(0, 2)], p[0], p[1], p[2], sc, sc, sc, Z.c1, { yaw: r.range(0, TAU), spin: r.range(-2, 2), tumble: r.range(-1.5, 1.5), bob: 0.3, cr: sc * 2.3 });
      if (r.chance(0.3)) { const b = at(lat(0.3, 2, -sg), r.range(1, 3)); this.item(this.side, s, M.glow, b[0], b[1], b[2], 0.3, 0.3, 0.3, [1, 0.2, 0.1], { blink: true, emis: 1.8, cr: 0.4 }); }
      step = r.range(5, 9);
    }
    return step / Math.max(0.6, this.density);
  }
  // ------------------------------------------------------------- midground
  spawnMid(T, s, M) {
    const r = this.rng, z = zoneAt(s), Z = ZONES[z], f = this.frame(T, s), sg = r.sign();
    const lat = sg * r.range(30, 150), fo = r.range(-15, 15);
    const x = f.x + f.rx * lat + f.fx * fo, zz = f.z + f.rz * lat + f.fz * fo, floor = f.y - 62;
    if (z === 0) {
      if (r.chance(0.8)) { const H = r.range(35, 100), w = r.range(6, 14); this.item(this.mid, s, M.tower, x, floor + H / 2, zz, w, H, w, r.chance(0.7) ? Z.c1 : Z.c2, { yaw: r.range(0, TAU) }); }
      else { const R = r.range(8, 20); this.item(this.mid, s, M.ring, x, f.y + r.range(-10, 25), zz, R, R, R, Z.c1, { yaw: r.range(0, TAU), tilt: r.range(0.6, 1.4), spin: r.range(-0.15, 0.15) }); }
    } else if (z === 1) {
      const sc = r.range(6, 22);
      this.item(this.mid, s, M.rocks[r.int(0, 2)], x, f.y + r.range(-38, 10), zz, sc, sc * r.range(0.6, 0.9), sc, [0.6, 0.5, 0.46], { yaw: r.range(0, TAU), bob: r.range(0.5, 1.5), spin: r.range(-0.02, 0.02) });
    } else if (z === 2) {
      if (r.chance(0.55)) { const H = r.range(20, 60); this.item(this.mid, s, M.mono, x, floor + H / 2, zz, 3, H, 3, r.chance(0.5) ? Z.c1 : Z.c2, { emis: 1.3 }); }
      else { const sc = r.range(10, 26); this.item(this.mid, s, M.pyramid, x, f.y - r.range(15, 45), zz, sc, sc, sc, r.chance(0.5) ? Z.c1 : Z.c2, { yaw: r.range(0, TAU), spin: r.range(-0.08, 0.08), emis: 1.2 }); }
    } else if (z === 3) {
      const kind = r.int(0, 2), sc = r.range(4, 14), col = Z.neb[r.int(0, 3)];
      const mesh = kind === 0 ? M.sphere : kind === 1 ? M.box16 : M.torus16;
      this.item(this.mid, s, mesh, x, f.y + r.range(-30, 22), zz, sc, sc, sc, col, { yaw: r.range(0, TAU), spin: r.range(-0.2, 0.2), tumble: r.range(-0.15, 0.15), bob: r.range(0.5, 2) });
    } else {
      if (r.chance(0.5)) { const H = r.range(25, 60); this.item(this.mid, s, M.box17, x, floor + H / 2 + r.range(0, 20), zz, r.range(2.5, 5), H, r.range(2.5, 5), Z.c1, { yaw: r.range(0, TAU), tilt: r.range(-0.45, 0.45) }); }
      else { const sc = r.range(3, 9); this.item(this.mid, s, M.shards[r.int(0, 2)], x, f.y + r.range(-20, 20), zz, sc, sc, sc, Z.c2, { yaw: r.range(0, TAU), spin: r.range(-0.5, 0.5), tumble: r.range(-0.4, 0.4) }); }
    }
    return r.range(9, 16) / this.density;
  }
  // ------------------------------------------------------------- background giants (drift slowly)
  spawnHero(T, z, s, M) {
    const r = this.rng, Z = ZONES[z], f = this.frame(T, s), sg = r.sign(), lat = sg * r.range(170, 240);
    const x = f.x + f.rx * lat, y = f.y + r.range(15, 55), zz = f.z + f.rz * lat;
    const drift = [f.fx * r.range(1.5, 3), 0, f.fz * r.range(1.5, 3)], o = { drift, fogK: 0.5 };
    const list = [];
    if (z === 0) { this.item(list, s, M.ring, x, y, zz, 70, 70, 70, Z.c1, { ...o, tilt: 1.1, spin: 0.05, emis: 1.4 }); this.item(list, s, M.glow, x, y, zz, 7, 7, 7, Z.c1, { ...o, emis: 1.2 }); }
    else if (z === 1) this.item(list, s, M.rocks[0], x, y - 20, zz, 65, 45, 65, [0.62, 0.52, 0.5], { ...o, spin: 0.01 });
    else if (z === 2) this.item(list, s, M.pyramid, x, y - 50, zz, 85, 85, 85, Z.c1, { ...o, spin: 0.04, emis: 1.5 });
    else if (z === 3) { this.item(list, s, M.sphere, x, y, zz, 42, 42, 42, [0.95, 0.95, 1], o); this.item(list, s, M.torus16, x, y, zz, 72, 72, 72, Z.c2, { ...o, tilt: 1.2, spin: 0.12 }); }
    else this.item(list, s, M.ring17, x, y, zz, 90, 90, 90, Z.c1, { ...o, tilt: 1.3, spin: 0.09, emis: 1.5 });
    this.heroes.push({ z, s, items: list });
  }
  spawnShaft(T, s) {
    const r = this.rng, f = this.frame(T, s), lat = r.range(15, 70) * r.sign();
    return { s, x: f.x + f.rx * lat, z: f.z + f.rz * lat, y: f.y - 60, w: r.range(5, 16), h: r.range(140, 200), a: r.range(0.04, 0.1) };
  }

  update(T, ballS, dt, M, onBolt) {
    if (!M) return;
    const lim = Math.max(0, T.length - 2);
    while (this.sideS < Math.min(ballS + 170, lim)) this.sideS += this.spawnSide(T, this.sideS, M);
    while (this.midS < Math.min(ballS + 340, lim)) this.midS += this.spawnMid(T, this.midS, M);
    const prune = (a, cut) => { let w = 0; for (let k = 0; k < a.length; k++) if (a[k].s > cut) a[w++] = a[k]; a.length = w; };
    prune(this.side, ballS - 30); prune(this.mid, ballS - 90);
    for (let k = 0; k < this.shafts.length; k++) if (this.shafts[k].s < ballS - 30) this.shafts[k] = this.spawnShaft(T, Math.min(lim, ballS + this.rng.range(150, 320)));
    // one hero for the current zone and one for the next, spawned far ahead
    const zc = zoneAt(ballS), zn = zoneAt(ballS + 260);
    for (const z of zc === zn ? [zc] : [zc, zn]) if (!this.heroes.some((h) => h.z === z)) this.spawnHero(T, z, Math.min(lim, z === zc ? ballS + 120 : ballS + 260), M);
    this.heroes = this.heroes.filter((h) => h.z >= zc - 0 || h.s > ballS - 150);
    if (this.heroes.length > 3) this.heroes.shift();
    for (const h of this.heroes) for (const it of h.items) if (it.drift) { it.x += it.drift[0] * dt; it.z += it.drift[2] * dt; }
    // lightning in CHAOS
    for (const b of this.bolts) b.life -= dt;
    this.bolts = this.bolts.filter((b) => b.life > 0);
    if (zc === 4 && dt > 0) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        const r = this.rng; this.boltT = r.range(2.2, 6);
        const f = this.frame(T, Math.min(lim, ballS + r.range(70, 160))), lat = r.sign() * r.range(25, 110);
        let x = f.x + f.rx * lat, y = f.y + 90, z = f.z + f.rz * lat; const pts = [];
        for (let k = 0; k < 16; k++) { pts.push([x, y, z]); x += r.range(-5, 5); y -= r.range(7, 12); z += r.range(-5, 5); }
        this.bolts.push({ pts, life: 0.28 });
        if (onBolt) onBolt();
      }
    }
  }
  draw(R, time, focus) {
    const cam = R.cam, F = R.camF;
    const one = (it, near) => {
      const dx = it.x - cam[0], dy = it.y - cam[1], dz = it.z - cam[2];
      if (dx * F[0] + dy * F[1] + dz * F[2] < -it.r * 1.5) return;          // behind the camera
      if (near && focus && Environment.occludes(it, cam, focus, time)) return;
      let q = it.q;
      if (!q) {
        Q.yaw(this.q, it.yaw + time * it.spin); q = this.q;
        const tl = it.tilt + time * it.tumble;
        if (tl) { Q.fromAxisAngle(this.qx, 1, 0, 0, tl); q = Q.mul(this.qx, this.q, this.qx); }
      }
      const by = it.bob ? Math.sin(time * 0.7 + it.s) * it.bob : 0;
      M4.fromTRS(this.model, it.x, it.y + by, it.z, q, it.sx, it.sy, it.sz);
      const e = it.blink ? it.emis * (Math.sin(time * 5 + it.s) > 0.2 ? 1 : 0.15) : it.emis;
      if (it.fogK !== 1) { R.setFogK(it.fogK); R.drawProp(it.mesh, this.model, it.col, e); R.setFogK(1); }   // far giants: own fog
      else R.addInst(it.mesh, this.model, it.col, e);
    };
    for (const h of this.heroes) for (const it of h.items) one(it);
    for (const it of this.mid) one(it);
    for (const it of this.side) one(it, true);
  }
  // True when the camera is inside the object, or the object sits between the camera and the ball.
  static occludes(it, cam, focus, time) {
    const y = it.y + (it.bob ? Math.sin(time * 0.7 + it.s) * it.bob : 0);
    const dx = cam[0] - it.x, dy = cam[1] - y, dz = cam[2] - it.z;
    if (it.occ === 'plane') return Math.abs(dx * it.nx + dz * it.nz) < 1.4;
    if (it.occ === 'ring') {
      const dn = dx * it.nx + dz * it.nz, rx = dx - it.nx * dn, rz = dz - it.nz * dn;
      return Math.abs(dn) < 1.1 && Math.abs(Math.hypot(rx, dy, rz) - it.R) < 1.1;
    }
    // distance from the object centre to the camera→ball segment (in 3D, or top view for poles)
    const cyl = it.occ === 'cyl';
    const sx = focus[0] - cam[0], sy = cyl ? 0 : focus[1] - cam[1], sz = focus[2] - cam[2];
    const px = -dx, py = cyl ? 0 : -dy, pz = -dz;
    const t = clamp((px * sx + py * sy + pz * sz) / (sx * sx + sy * sy + sz * sz || 1), 0, 1);
    const d = Math.hypot(px - sx * t, py - sy * t, pz - sz * t);
    return d < it.cr + (t < 0.05 ? 0.7 : 0.25);
  }
  writeDust(out, off, cam, time, col, drift) {
    let o = off * 8; const B = 26;
    for (let k = 0; k < this.dustN; k++) {
      const d = this.dust, j = k * 4;
      const px = cam[0] + (((d[j] * B + time * drift[0] - cam[0]) % B) + B) % B - B / 2;
      const py = cam[1] + (((d[j + 1] * B + time * drift[1] + Math.sin(time * 0.2 + k) * 0.5 - cam[1]) % B) + B) % B - B / 2;
      const pz = cam[2] + (((d[j + 2] * B - cam[2]) % B) + B) % B - B / 2;
      out[o++] = px; out[o++] = py; out[o++] = pz;
      out[o++] = col[0]; out[o++] = col[1]; out[o++] = col[2]; out[o++] = 0.25 + d[j + 3] * 0.35;
      out[o++] = 0.04 + d[j + 3] * 0.05;
    }
    return off + this.dustN;
  }
}

// =====================================================================
// FxBuilder — per-frame additive geometry (trail ribbon, halos, shafts).
// =====================================================================
class FxBuilder {
  constructor() { this.buf = new Float32Array(4000 * 10); this.n = 0; this.trail = []; for (let k = 0; k < 30; k++) this.trail.push([0, 0, 0]); this.th = 0; this.tn = 0; }
  begin(view) { this.n = 0; this.rx = view[0]; this.ry = view[4]; this.rz = view[8]; this.ux = view[1]; this.uy = view[5]; this.uz = view[9]; }
  v(x, y, z, u, w, sh, r, g, b, a) {
    if (this.n >= 4000) return;
    const o = this.n++ * 10, B = this.buf;
    B[o] = x; B[o + 1] = y; B[o + 2] = z; B[o + 3] = u; B[o + 4] = w; B[o + 5] = sh; B[o + 6] = r; B[o + 7] = g; B[o + 8] = b; B[o + 9] = a;
  }
  quad(p, q, s, t, sh, col, a, uvs) {
    this.v(p[0], p[1], p[2], uvs[0], uvs[1], sh, col[0], col[1], col[2], a);
    this.v(q[0], q[1], q[2], uvs[2], uvs[3], sh, col[0], col[1], col[2], a);
    this.v(s[0], s[1], s[2], uvs[4], uvs[5], sh, col[0], col[1], col[2], a);
    this.v(p[0], p[1], p[2], uvs[0], uvs[1], sh, col[0], col[1], col[2], a);
    this.v(s[0], s[1], s[2], uvs[4], uvs[5], sh, col[0], col[1], col[2], a);
    this.v(t[0], t[1], t[2], uvs[6], uvs[7], sh, col[0], col[1], col[2], a);
  }
  glow(x, y, z, size, col, a) {
    if (a <= 0.003) return;
    const rx = this.rx * size, ry = this.ry * size, rz = this.rz * size, ux = this.ux * size, uy = this.uy * size, uz = this.uz * size;
    this.quad([x - rx - ux, y - ry - uy, z - rz - uz], [x + rx - ux, y + ry - uy, z + rz - uz], [x + rx + ux, y + ry + uy, z + rz + uz], [x - rx + ux, y - ry + uy, z - rz + uz], 1, col, a, [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  shaft(sh, cam, col) {
    let dx = cam[0] - sh.x, dz = cam[2] - sh.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const hx = -dz * sh.w / 2, hz = dx * sh.w / 2;
    this.quad([sh.x - hx, sh.y, sh.z - hz], [sh.x + hx, sh.y, sh.z + hz], [sh.x + hx, sh.y + sh.h, sh.z + hz], [sh.x - hx, sh.y + sh.h, sh.z - hz], 2, col, sh.a, [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  pushTrail(p, dt) {
    this.th += dt;
    if (this.th < 1 / 90 && this.tn > 0) { const h = this.trail[0]; h[0] = p[0]; h[1] = p[1]; h[2] = p[2]; return; }
    this.th = 0;
    const last = this.trail.pop(); last[0] = p[0]; last[1] = p[1]; last[2] = p[2]; this.trail.unshift(last);
    this.tn = Math.min(this.tn + 1, this.trail.length);
  }
  // Foreground speed streaks: a cylinder of short lines streaming past the camera.
  speedLines(dt, cam, fwd, speed, col, alpha) {
    if (!this.lines) { this.lines = new Float32Array(44 * 3); for (let k = 0; k < 44; k++) this.lines.set([Math.random() * TAU, 2 + Math.random() * 7, Math.random() * 55], k * 3); }
    const L = this.lines, adv = speed * dt * 1.3;
    for (let k = 0; k < 44; k++) {
      const j = k * 3; L[j + 2] -= adv;
      if (L[j + 2] < -3) { L[j] = Math.random() * TAU; L[j + 1] = 2 + Math.random() * 7; L[j + 2] = 40 + Math.random() * 20; }
      if (alpha <= 0.01) continue;
      const z = L[j + 2], a = alpha * clamp((z + 3) / 5, 0, 1) * clamp((55 - z) / 20, 0, 1);
      if (a <= 0.005) continue;
      const c = Math.cos(L[j]) * L[j + 1], s = Math.sin(L[j]) * L[j + 1];
      const hx = cam[0] + fwd[0] * z + this.rx * c + this.ux * s, hy = cam[1] + fwd[1] * z + this.ry * c + this.uy * s, hz = cam[2] + fwd[2] * z + this.rz * c + this.uz * s;
      const len = 0.6 + speed * 0.1;
      const tx = hx - fwd[0] * len, ty = hy - fwd[1] * len, tz = hz - fwd[2] * len;
      let wx = fwd[1] * (hz - cam[2]) - fwd[2] * (hy - cam[1]), wy = fwd[2] * (hx - cam[0]) - fwd[0] * (hz - cam[2]), wz = fwd[0] * (hy - cam[1]) - fwd[1] * (hx - cam[0]);
      const wl = Math.hypot(wx, wy, wz) || 1, w = 0.012 * L[j + 1]; wx = wx / wl * w; wy = wy / wl * w; wz = wz / wl * w;
      this.quad([hx - wx, hy - wy, hz - wz], [hx + wx, hy + wy, hz + wz], [tx + wx, ty + wy, tz + wz], [tx - wx, ty - wy, tz - wz], 0, col, a, [1, 0, 1, 1, 0, 1, 0, 0]);
    }
  }
  // Camera-facing ribbon through arbitrary points (lightning bolts).
  polyRibbon(pts, cam, width, col, alpha) {
    let pL = null, pR = null;
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], vx = cam[0] - a[0], vy = cam[1] - a[1], vz = cam[2] - a[2];
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx; const l = Math.hypot(sx, sy, sz) || 1;
      sx = sx / l * width; sy = sy / l * width; sz = sz / l * width;
      const L = [a[0] - sx, a[1] - sy, a[2] - sz], Rr = [a[0] + sx, a[1] + sy, a[2] + sz];
      if (pL) this.quad(pL, pR, Rr, L, 0, col, alpha, [1, 0, 1, 1, 1, 1, 1, 0]);
      pL = L; pR = Rr;
    }
  }
  resetTrail(p) { for (const t of this.trail) { t[0] = p[0]; t[1] = p[1]; t[2] = p[2]; } this.tn = 0; }
  ribbon(cam, width, col, alpha) {
    if (alpha <= 0.01 || this.tn < 3) return;
    const N = this.tn;
    let prevL = null, prevR = null, prevU = 0;
    for (let k = 0; k < N - 1; k++) {
      const a = this.trail[k], b = this.trail[k + 1];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const vx = cam[0] - a[0], vy = cam[1] - a[1], vz = cam[2] - a[2];
      let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
      const l = Math.hypot(sx, sy, sz); if (l < 1e-6) continue;
      const f = 1 - k / (N - 1), w = width * (0.25 + 0.75 * f);
      sx = sx / l * w; sy = sy / l * w; sz = sz / l * w;
      const L = [a[0] - sx, a[1] - sy, a[2] - sz], Rr = [a[0] + sx, a[1] + sy, a[2] + sz];
      if (prevL) this.quad(prevL, prevR, Rr, L, 0, col, alpha, [prevU, 0, prevU, 1, f, 1, f, 0]);
      prevL = L; prevR = Rr; prevU = f;
    }
  }
}
