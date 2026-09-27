
// =====================================================================
// Geometry: MeshBuilder (interleaved 16-float vertices), primitives,
// procedural track chunk mesher, sky panorama generator.
// Layout: pos3 nrm3 uv2 aux4 mat4
// =====================================================================
const VSTRIDE = 16;
class MeshBuilder {
  constructor(vcap = 4096) {
    this.v = new Float32Array(vcap * VSTRIDE); this.idx = new Uint16Array(vcap * 2);
    this.nv = 0; this.ni = 0;
    this.A = [1e9, 0, 0, 0];   // aux: rowS, seed, edgeA, edgeB  (rowS=1e9 → never collapses)
    this.M = [0, 0, 0, 1];     // mat: id, flags, halfWidth, emissive
  }
  grow(nv, ni) {
    if ((this.nv + nv) * VSTRIDE > this.v.length) { const n = new Float32Array(Math.max(this.v.length * 2, (this.nv + nv) * VSTRIDE)); n.set(this.v); this.v = n; }
    if (this.ni + ni > this.idx.length) { const n = new Uint16Array(Math.max(this.idx.length * 2, this.ni + ni)); n.set(this.idx); this.idx = n; }
  }
  V(px, py, pz, nx, ny, nz, u, v) {
    const o = this.nv * VSTRIDE, a = this.v, A = this.A, M = this.M;
    a[o] = px; a[o + 1] = py; a[o + 2] = pz; a[o + 3] = nx; a[o + 4] = ny; a[o + 5] = nz; a[o + 6] = u; a[o + 7] = v;
    a[o + 8] = A[0]; a[o + 9] = A[1]; a[o + 10] = A[2]; a[o + 11] = A[3];
    a[o + 12] = M[0]; a[o + 13] = M[1]; a[o + 14] = M[2]; a[o + 15] = M[3];
    return this.nv++;
  }
  tri(a, b, c) { const I = this.idx; I[this.ni++] = a; I[this.ni++] = b; I[this.ni++] = c; }
  // Quad with explicit normal(s). p: 4 points [x,y,z]; uv: 8 numbers.
  quad(p0, p1, p2, p3, n, uv, n2) {
    this.grow(4, 6);
    const m = n2 || n;
    const a = this.V(p0[0], p0[1], p0[2], n[0], n[1], n[2], uv[0], uv[1]);
    this.V(p1[0], p1[1], p1[2], n[0], n[1], n[2], uv[2], uv[3]);
    this.V(p2[0], p2[1], p2[2], m[0], m[1], m[2], uv[4], uv[5]);
    this.V(p3[0], p3[1], p3[2], m[0], m[1], m[2], uv[6], uv[7]);
    this.tri(a, a + 1, a + 2); this.tri(a, a + 2, a + 3);
  }
  // Flat-shaded quad whose normal points away from `ctr`.
  face(p0, p1, p2, p3, ctr, uv) {
    // diagonals' cross product: valid for quads and for triangles (p3 === p0)
    const ax = p2[0] - p0[0], ay = p2[1] - p0[1], az = p2[2] - p0[2];
    const bx = p3[0] - p1[0], by = p3[1] - p1[1], bz = p3[2] - p1[2];
    let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const cx = (p0[0] + p2[0]) / 2 - ctr[0], cy = (p0[1] + p2[1]) / 2 - ctr[1], cz = (p0[2] + p2[2]) / 2 - ctr[2];
    if (nx * cx + ny * cy + nz * cz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    this.quad(p0, p1, p2, p3, [nx, ny, nz], uv || [0, 0, 1, 0, 1, 1, 0, 1]);
  }
  // Hexahedron from 8 corners: c[0..3] bottom ring, c[4..7] top ring (same order).
  hexa(c, uvScale = 1) {
    const ctr = [0, 0, 0];
    for (const p of c) { ctr[0] += p[0] / 8; ctr[1] += p[1] / 8; ctr[2] += p[2] / 8; }
    const U = [0, 0, uvScale, 0, uvScale, 1, 0, 1];
    this.face(c[0], c[1], c[2], c[3], ctr, U); this.face(c[4], c[5], c[6], c[7], ctr, U);
    for (let k = 0; k < 4; k++) { const j = (k + 1) & 3; this.face(c[k], c[j], c[j + 4], c[k + 4], ctr, U); }
  }
  // Box along a segment a→b with square section `t`.
  strut(a, b, t) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const l = Math.hypot(dx, dy, dz) || 1, d = [dx / l, dy / l, dz / l];
    let px = [d[1], -d[0], 0]; if (Math.abs(d[2]) > 0.9 || Math.hypot(px[0], px[1]) < 0.1) px = [0, d[2], -d[1]];
    let pl = Math.hypot(px[0], px[1], px[2]) || 1; px = px.map((v) => v / pl);
    const py = [d[1] * px[2] - d[2] * px[1], d[2] * px[0] - d[0] * px[2], d[0] * px[1] - d[1] * px[0]];
    const c = [];
    for (const e of [a, b]) for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      c.push([e[0] + (px[0] * sx + py[0] * sy) * t, e[1] + (px[1] * sx + py[1] * sy) * t, e[2] + (px[2] * sx + py[2] * sy) * t]);
    this.hexa(c, l);
  }
}

// ---------------------------------------------------------------- primitives
const Prims = {
  sphere(seg = 36, rings = 24) {
    const mb = new MeshBuilder(seg * rings + seg + rings + 1);
    for (let y = 0; y <= rings; y++) {
      const v = y / rings, th = v * Math.PI;
      for (let x = 0; x <= seg; x++) {
        const u = x / seg, ph = u * TAU;
        const nx = Math.sin(th) * Math.cos(ph), ny = Math.cos(th), nz = Math.sin(th) * Math.sin(ph);
        mb.grow(1, 0); mb.V(nx, ny, nz, nx, ny, nz, u, v);
      }
    }
    for (let y = 0; y < rings; y++) for (let x = 0; x < seg; x++) {
      const a = y * (seg + 1) + x, b = a + seg + 1;
      mb.grow(0, 6); mb.tri(a, b, a + 1); mb.tri(a + 1, b, b + 1);
    }
    return mb;
  },
  gem() {
    const mb = new MeshBuilder(64); mb.M = [10, 0, 0, 1];
    const n = 6, top = [0, 1, 0], bot = [0, -1, 0], ring = [];
    for (let k = 0; k < n; k++) { const a = k / n * TAU; ring.push([Math.cos(a) * 0.62, 0.15, Math.sin(a) * 0.62]); }
    for (let k = 0; k < n; k++) {
      const a = ring[k], b = ring[(k + 1) % n];
      mb.face(top, a, b, top, [0, 0.1, 0]); mb.face(bot, b, a, bot, [0, 0.1, 0]);
    }
    return mb;
  },
  cylinder(seg = 16, mat = 9) {
    const mb = new MeshBuilder(seg * 8); mb.M = [mat, 0, 0, 1];
    for (let k = 0; k < seg; k++) {
      const a0 = k / seg * TAU, a1 = (k + 1) / seg * TAU;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      mb.quad([c0, 0, s0], [c1, 0, s1], [c1, 1, s1], [c0, 1, s0], [c0, 0, s0], [k / seg, 0, (k + 1) / seg, 0, (k + 1) / seg, 1, k / seg, 1], [c1, 0, s1]);
      mb.grow(3, 3);
      const t = mb.V(0, 1, 0, 0, 1, 0, 0.5, 0.95), p = mb.V(c0, 1, s0, 0, 1, 0, 0, 0.95), q = mb.V(c1, 1, s1, 0, 1, 0, 1, 0.95);
      mb.tri(t, p, q);
    }
    return mb;
  },
  box(mat, emis = 1) {
    const mb = new MeshBuilder(32); mb.M = [mat, 0, 0, emis];
    const c = [];
    for (const y of [-0.5, 0.5]) for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) c.push([x, y, z]);
    mb.hexa(c);
    return mb;
  },
  // Checkpoint gate in local frame (x lateral, y up, z along track).
  gate() {
    const mb = new MeshBuilder(256); mb.M = [11, 0, 0, 1];
    const W = 2.35, H = 2.7, t = 0.16;
    const bx = (x0, x1, y0, y1, z0, z1) => { const c = []; for (const y of [y0, y1]) for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) c.push([x, y, z]); mb.hexa(c); };
    bx(-W - t, -W + t, -0.6, H, -t, t); bx(W - t, W + t, -0.6, H, -t, t); bx(-W - t, W + t, H - t * 2, H + t, -t, t);
    mb.M = [4, 0, 0, 1.3];
    bx(-W + t, -W + t + 0.05, 0.1, H - 2 * t, -0.04, 0.04); bx(W - t - 0.05, W - t, 0.1, H - 2 * t, -0.04, 0.04);
    bx(-W + t, W - t, H - 2 * t - 0.05, H - 2 * t, -0.04, 0.04);
    return mb;
  },
  torus(R = 1, r = 0.06, seg = 48, sides = 8, mat = 11) {
    const mb = new MeshBuilder((seg + 1) * (sides + 1)); mb.M = [mat, 0, 0, 1];
    for (let i = 0; i <= seg; i++) {
      const a = i / seg * TAU, ca = Math.cos(a), sa = Math.sin(a);
      for (let j = 0; j <= sides; j++) {
        const b = j / sides * TAU, cb = Math.cos(b), sb = Math.sin(b);
        mb.grow(1, 0);
        mb.V((R + r * cb) * ca, r * sb, (R + r * cb) * sa, cb * ca, sb, cb * sa, (i % 6) / 6 + 0.02, j / sides);
      }
    }
    for (let i = 0; i < seg; i++) for (let j = 0; j < sides; j++) {
      const a = i * (sides + 1) + j, b = a + sides + 1; mb.grow(0, 6); mb.tri(a, b, a + 1); mb.tri(a + 1, b, b + 1);
    }
    return mb;
  },
};

Prims.withMat = (mb, mat, emis = 1) => { for (let i = 0; i < mb.nv; i++) { mb.v[i * VSTRIDE + 12] = mat; mb.v[i * VSTRIDE + 15] = emis; } return mb; };
// Low-poly floating rock / island: subdivided icosahedron, noisy radius, flat top, pointy bottom.
Prims.rock = (seed) => {
  const r = RNG(seed), P = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, P, 0], [1, P, 0], [-1, -P, 0], [1, -P, 0], [0, -1, P], [0, 1, P], [0, -1, -P], [0, 1, -P], [P, 0, -1], [P, 0, 1], [-P, 0, -1], [-P, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  V = V.map((v) => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; });
  const cache = new Map(), mid = (a, b) => {
    const k = a < b ? a + '_' + b : b + '_' + a; if (cache.has(k)) return cache.get(k);
    const m = [(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2], l = Math.hypot(m[0], m[1], m[2]);
    V.push([m[0] / l, m[1] / l, m[2] / l]); cache.set(k, V.length - 1); return V.length - 1;
  };
  const F2 = []; for (const [a, b, c] of F) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
  V = V.map((v) => {
    const k = 1 + r.range(-0.18, 0.18); let x = v[0] * k, y = v[1] * k, z = v[2] * k;
    if (y > 0.28) y = 0.28 + (y - 0.28) * 0.2; else if (y < 0) y *= 1.7 + r.range(0, 0.4);
    return [x, y, z];
  });
  const mb = new MeshBuilder(F2.length * 4 + 8); mb.M = [14, 0, 0, 1];
  for (const [a, b, c] of F2) mb.face(V[a], V[b], V[c], V[a], [0, 0.1, 0]);
  return mb;
};
// Coin: short cylinder (axis Y, height 1, radius 1) with both caps, gem material.
Prims.coin = (seg = 22) => {
  const mb = new MeshBuilder(seg * 12); mb.M = [10, 0, 0, 1];
  for (let k = 0; k < seg; k++) {
    const a0 = k / seg * TAU, a1 = (k + 1) / seg * TAU, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
    mb.quad([c0, -0.5, s0], [c1, -0.5, s1], [c1, 0.5, s1], [c0, 0.5, s0], [c0, 0, s0], [0, 0, 1, 0, 1, 1, 0, 1], [c1, 0, s1]);
    mb.grow(6, 6);
    for (const y of [0.5, -0.5]) {
      const n = Math.sign(y), c = mb.V(0, y, 0, 0, n, 0, 0.5, 0.5), p = mb.V(c0 * 0.999, y, s0 * 0.999, 0, n, 0, 0, 0), q = mb.V(c1 * 0.999, y, s1 * 0.999, 0, n, 0, 1, 0);
      mb.tri(c, p, q);
    }
  }
  return mb;
};
Prims.pyramid = () => {
  const mb = new MeshBuilder(40); mb.M = [15, 0, 0, 1];
  const ap = [0, 1.5, 0], B = [[-1, 0, -1], [1, 0, -1], [1, 0, 1], [-1, 0, 1]];
  for (let k = 0; k < 4; k++) mb.face(B[k], B[(k + 1) & 3], ap, B[k], [0, 0.4, 0]);
  mb.face(B[0], B[2], B[1], B[0], [0, 0.4, 0]); mb.face(B[0], B[3], B[2], B[0], [0, 0.4, 0]);
  return mb;
};
Prims.shard = (seed) => {
  const r = RNG(seed), mb = new MeshBuilder(40); mb.M = [17, 0, 0, 1];
  const top = [r.range(-0.2, 0.2), r.range(1.2, 2.2), r.range(-0.2, 0.2)], bot = [r.range(-0.2, 0.2), -r.range(0.6, 1.4), r.range(-0.2, 0.2)];
  const ring = []; for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + r.range(-0.3, 0.3), l = r.range(0.25, 0.55); ring.push([Math.cos(a) * l, r.range(-0.2, 0.3), Math.sin(a) * l]); }
  for (let k = 0; k < 4; k++) { const a = ring[k], b = ring[(k + 1) & 3]; mb.face(a, b, top, a, [0, 0.2, 0]); mb.face(b, a, bot, b, [0, 0.2, 0]); }
  return mb;
};

// ---------------------------------------------------------------- nature & country props
// Surface of revolution around Y. prof: [[radius, y], …] from bottom to top. Smooth normals, or
// faceted (low-poly, like the rocks) with `flat`. rmod(k, j) scales the radius of ring j at step k.
Prims.lathe = (mb, prof, seg, o = {}) => {
  const ox = o.x || 0, oy = o.y || 0, oz = o.z || 0, rm = o.rmod, n = prof.length;
  const P = (j, k) => { const a = k / seg * TAU, r = prof[j][0] * (rm ? rm(k % seg, j) : 1); return [ox + Math.cos(a) * r, oy + prof[j][1], oz + Math.sin(a) * r]; };
  if (o.flat) {
    for (let j = 0; j < n - 1; j++) {
      // faces point away from the axis; a flat ring faces up when it closes inwards, down when it opens outwards
      const flatRing = Math.abs(prof[j + 1][1] - prof[j][1]) < 1e-6 ? Math.sign(prof[j + 1][0] - prof[j][0]) : 0;
      const ctr = [ox, oy + (prof[j][1] + prof[j + 1][1]) / 2 + flatRing, oz];
      for (let k = 0; k < seg; k++) {
        const v0 = j / (n - 1), v1 = (j + 1) / (n - 1), uv = [k / seg, v0, (k + 1) / seg, v0, (k + 1) / seg, v1, k / seg, v1];
        if (prof[j + 1][0] < 1e-4) mb.face(P(j, k), P(j, k + 1), P(j + 1, k), P(j, k), ctr, uv);
        else if (prof[j][0] < 1e-4) mb.face(P(j, k), P(j + 1, k + 1), P(j + 1, k), P(j, k), ctr, uv);
        else mb.face(P(j, k), P(j, k + 1), P(j + 1, k + 1), P(j + 1, k), ctr, uv);
      }
    }
    return mb;
  }
  mb.grow((seg + 1) * n, seg * (n - 1) * 6);
  const base = mb.nv;
  for (let j = 0; j < n; j++) {
    const a = prof[Math.max(0, j - 1)], b = prof[Math.min(n - 1, j + 1)], tr = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tr, ty) || 1;
    for (let k = 0; k <= seg; k++) {
      const an = k / seg * TAU, c = Math.cos(an), sn = Math.sin(an), p = P(j, k);
      mb.V(p[0], p[1], p[2], c * ty / tl, -tr / tl, sn * ty / tl, k / seg, j / (n - 1));
    }
  }
  for (let j = 0; j < n - 1; j++) for (let k = 0; k < seg; k++) { const a = base + j * (seg + 1) + k, b = a + seg + 1; mb.tri(a, b, a + 1); mb.tri(a + 1, b, b + 1); }
  return mb;
};
const boxAt = (mb, x0, y0, z0, x1, y1, z1) => { const c = []; for (const y of [y0, y1]) for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]) c.push([x, y, z]); mb.hexa(c); };
const leafBlob = (mb, x, y, z, rad, r) => {
  const jit = []; for (let k = 0; k < 48; k++) jit.push(r.range(0.86, 1.14));   // one value per vertex, so faces stay joined
  return Prims.lathe(mb, [[0, -1], [0.62, -0.78], [0.95, -0.25], [0.95, 0.3], [0.62, 0.8], [0, 1]].map(([a, b]) => [a * rad, b * rad * 0.86]), 8,
    { x, y, z, flat: true, rmod: (k, j) => jit[j * 8 + k] });
};
// Conifer, 1 high with a crown radius of 1 (origin at the foot). crown0: where the branches start.
Prims.pine = (seed, crown0) => {
  const r = RNG(seed), mb = new MeshBuilder(900);
  mb.M = [20, 0, 0, 1]; Prims.lathe(mb, [[0.2, -0.05], [0.12, crown0 + 0.05], [0.05, 0.96]], 7);
  mb.M = [19, 0, 0, 1];
  const L = 6, span = 1 - crown0, h = span * 0.32;
  for (let i = 0; i < L; i++) {
    const t = i / L, y0 = crown0 + span * t * 0.86, rr = 1 - t * 0.8, jit = []; for (let k = 0; k < 9; k++) jit.push(r.range(0.78, 1.18));
    Prims.lathe(mb, [[rr * 0.2, y0 + h * 0.18], [rr, y0], [0, y0 + h]], 9, { flat: true, rmod: (k, j) => (j === 1 ? jit[k] : 1) });
  }
  return mb;
};
// Tuscan cypress: a slender flame of dark leaves (1 high, radius 1).
Prims.cypress = (seed) => {
  const r = RNG(seed), mb = new MeshBuilder(400);
  mb.M = [20, 0, 0, 1]; Prims.lathe(mb, [[0.14, -0.05], [0.1, 0.16]], 6);
  mb.M = [19, 0, 0, 1];
  const jit = []; for (let k = 0; k < 18; k++) jit.push(r.range(0.84, 1.16));
  Prims.lathe(mb, [[0, 0.1], [0.7, 0.16], [1, 0.34], [0.92, 0.56], [0.62, 0.78], [0.26, 0.93], [0, 1]], 9, { flat: true, rmod: (k, j) => jit[(k + j * 3) % 18] });
  return mb;
};
// Round leafy tree (1 high).
Prims.oak = (seed) => {
  const r = RNG(seed), mb = new MeshBuilder(900);
  mb.M = [20, 0, 0, 1]; Prims.lathe(mb, [[0.08, -0.02], [0.055, 0.5]], 6);
  mb.M = [19, 0, 0, 1];
  leafBlob(mb, 0, 0.66, 0, 0.3, r);
  for (let k = 0; k < 4; k++) { const a = k / 4 * TAU + r.range(-0.4, 0.4); leafBlob(mb, Math.cos(a) * 0.2, 0.6 + r.range(-0.05, 0.12), Math.sin(a) * 0.2, r.range(0.2, 0.26), r); }
  return mb;
};
// Wind turbine tower + nacelle, 1 high; the rotor hub sits at (0.035, 1.005, 0) and faces +X.
Prims.turbine = () => {
  const mb = new MeshBuilder(300); mb.M = [25, 0, 0, 1];
  Prims.lathe(mb, [[0.028, -0.03], [0.016, 0.99]], 10);
  boxAt(mb, -0.055, 0.99, -0.017, 0.025, 1.022, 0.017);
  return mb;
};
// Three blades in the YZ plane (length 1): they turn around X.
Prims.blades = () => {
  const mb = new MeshBuilder(120); mb.M = [25, 0, 0, 1];
  boxAt(mb, -0.05, -0.05, -0.05, 0.06, 0.05, 0.05);
  for (let k = 0; k < 3; k++) {
    const a = k / 3 * TAU, c = Math.cos(a), sn = Math.sin(a), P = (r, w, x) => [x, c * r - sn * w, sn * r + c * w];
    mb.hexa([P(0.04, -0.035, -0.012), P(0.04, 0.045, -0.012), P(1, 0.012, -0.004), P(1, -0.008, -0.004),
      P(0.04, -0.035, 0.012), P(0.04, 0.045, 0.012), P(1, 0.012, 0.004), P(1, -0.008, 0.004)]);
  }
  return mb;
};
// Hot-air balloon: striped envelope (radius 1 around the origin), ropes and a wicker basket below.
Prims.balloon = () => {
  const mb = new MeshBuilder(900); mb.M = [21, 0, 0, 1];
  Prims.lathe(mb, [[0.26, -1.02], [0.5, -0.78], [0.82, -0.4], [0.98, 0.05], [0.98, 0.42], [0.82, 0.78], [0.5, 1.02], [0, 1.1]], 24);
  mb.M = [20, 0, 0, 1];
  boxAt(mb, -0.16, -1.62, -0.16, 0.16, -1.42, 0.16);
  for (const [x, z] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) mb.strut([x * 0.15, -1.42, z * 0.15], [x * 0.19, -1.02, z * 0.19], 0.008);
  mb.M = [18, 0, 0, 1]; boxAt(mb, -0.05, -1.3, -0.05, 0.05, -1.2, 0.05);         // burner flame
  return mb;
};
// Sailboat on the water (length 1 along Z).
Prims.boat = () => {
  const mb = new MeshBuilder(200); mb.M = [25, 0, 0, 1];
  mb.hexa([[-0.06, -0.04, -0.46], [0.06, -0.04, -0.46], [0.02, -0.04, 0.44], [-0.02, -0.04, 0.44],
    [-0.15, 0.1, -0.5], [0.15, 0.1, -0.5], [0.05, 0.1, 0.5], [-0.05, 0.1, 0.5]]);
  mb.M = [20, 0, 0, 1]; mb.strut([0, 0.1, 0.08], [0, 1.15, 0.08], 0.012);
  mb.M = [26, 0, 0, 1];
  mb.face([0, 0.18, 0.06], [0, 1.1, 0.06], [0, 0.18, -0.42], [0, 0.18, 0.06], [0.1, 0.5, -0.1]);
  mb.face([0, 0.2, 0.12], [0, 1.02, 0.1], [0, 0.2, 0.46], [0, 0.2, 0.12], [0.1, 0.5, 0.3]);
  return mb;
};
// Lighthouse: banded tower, gallery and cap (1 high, radius ~0.13); the lamp is a separate glow.
Prims.lighthouse = () => {
  const mb = new MeshBuilder(400); mb.M = [22, 0, 0, 1];
  Prims.lathe(mb, [[0.13, -0.02], [0.085, 0.8]], 14);
  mb.M = [25, 0, 0, 1];
  Prims.lathe(mb, [[0.085, 0.8], [0.125, 0.8], [0.125, 0.83], [0.07, 0.83]], 14, { flat: true });
  Prims.lathe(mb, [[0.075, 0.93], [0.08, 0.93], [0.05, 0.99], [0, 1.02]], 14, { flat: true });
  return mb;
};
// Saguaro cactus (1 high).
Prims.cactus = (seed) => {
  const r = RNG(seed), mb = new MeshBuilder(500); mb.M = [24, 0, 0, 1];
  Prims.lathe(mb, [[0.11, -0.03], [0.12, 0.3], [0.115, 0.86], [0.09, 0.95], [0.05, 0.99], [0, 1]], 10);
  for (const sg of [-1, 1]) {
    const y0 = r.range(0.32, 0.5), x1 = sg * r.range(0.24, 0.3), top = r.range(0.22, 0.34);
    mb.strut([sg * 0.08, y0, 0], [x1, y0, 0], 0.05);
    Prims.lathe(mb, [[0.07, y0 - 0.05], [0.075, y0 + top * 0.7], [0.05, y0 + top * 0.92], [0, y0 + top]], 8, { x: x1 });
  }
  return mb;
};
// Mesa / butte: a flat-topped rock tower with steep eroded sides (1 high, radius 1).
Prims.mesa = (seed) => {
  const r = RNG(seed), mb = new MeshBuilder(400); mb.M = [23, 0, 0, 1];
  const jit = [], ring = []; for (let k = 0; k < 66; k++) { jit.push(r.range(0.72, 1.2)); ring.push(r.range(0.93, 1.07)); }
  Prims.lathe(mb, [[1, -0.05], [0.95, 0.35], [0.86, 0.7], [0.8, 0.94], [0.76, 1], [0, 1]], 11, { flat: true, rmod: (k, j) => jit[k] * ring[j * 11 + k] });
  return mb;
};

// Grass tuft (1 high, radius ~1): blades leaning out of a clump, each bent in two parts.
Prims.tuft = (seed) => {
  const r = RNG(seed), mb = new MeshBuilder(300); mb.M = [19, 0, 0, 1];
  for (let k = 0; k < 17; k++) {
    const a = k / 17 * TAU + r.range(-0.25, 0.25), rad = r.range(0, 0.35), h = r.range(0.5, 1), lean = r.range(0.2, 0.6) + rad, w = r.range(0.06, 0.1);
    const cx = Math.cos(a), cz = Math.sin(a), tx = -cz * w, tz = cx * w, bx = cx * rad, bz = cz * rad;
    const mx = bx + cx * lean * 0.3, mz = bz + cz * lean * 0.3, my = h * 0.55;
    const ctr = [bx - cx, -0.6, bz - cz];                 // lit side faces up and out
    mb.face([bx - tx, 0, bz - tz], [bx + tx, 0, bz + tz], [mx + tx * 0.7, my, mz + tz * 0.7], [mx - tx * 0.7, my, mz - tz * 0.7], ctr);
    mb.face([mx - tx * 0.7, my, mz - tz * 0.7], [mx + tx * 0.7, my, mz + tz * 0.7], [bx + cx * lean, h, bz + cz * lean], [mx - tx * 0.7, my, mz - tz * 0.7], ctr);
  }
  return mb;
};

// ---------------------------------------------------------------- track chunk mesher
const TrackMesher = {
  covered(T, j, u) {
    if (j < T.minIndex() || j >= T.n - 1) return false;
    return T.solidAt(j, 0.5, u) >= 0;
  },
  build(T, c, kid) {
    const CR = CFG.CHUNK_ROWS, DS = CFG.DS, TH = CFG.THICK, RIM = 0.05, RW = 0.09, M = T.mask;
    const mb = new MeshBuilder(CR * 110);
    const i0 = c * CR;
    // per-sample frame
    const fr = (i) => {
      const m = i & M, th = T.th[m], tb = Math.tan(T.bank[m]), sl = T.slope[m];
      const rx = -Math.cos(th), rz = Math.sin(th), fx = Math.sin(th), fz = Math.cos(th);
      let nx = -tb * rx - sl * fx, ny = 1, nz = -tb * rz - sl * fz; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      return { x: T.x[m], y: T.y[m], z: T.z[m], rx, rz, fx, fz, tb, w: T.w[m], n: [nx, ny, nz], s: i * DS };
    };
    const P = (f, u, h) => [f.x + f.rx * u, f.y + u * f.tb + h, f.z + f.rz * u];
    let fA = fr(i0);
    for (let i = i0; i < i0 + CR; i++) {
      const fB = fr(i + 1), m = i & M, n = T.rowN[m], flags = T.rowF[m];
      const sA = fA.s, sB = fB.s, seed = ((Math.sin(i * 12.9898) * 43758.5453) % 1 + 1) % 1;
      mb.A[0] = sA; mb.A[1] = seed;
      for (let k = 0; k < n; k++) {
        const ao = T.rowAO[m * 3 + k], bo = T.rowBO[m * 3 + k];
        const a0 = T.edgeA(i, k, 0), a1 = T.edgeA(i, k, 1), b0 = T.edgeB(i, k, 0), b1 = T.edgeB(i, k, 1);
        const mid = (a0 + b0) / 2;
        const openB = !this.covered(T, i - 1, mid), openF = !this.covered(T, i + 1, mid);
        const fl = (ao ? 0 : 1) | (bo ? 0 : 2) | (openB ? 4 : 0) | (openF ? 8 : 0) |
          (flags & RF.BOOST ? 16 : 0) | (flags & RF.CHECK ? 32 : 0) | (flags & RF.START ? 64 : 0);
        // deck top (per-vertex edges so hazard stripes follow the interval)
        mb.grow(4, 6);
        const base = mb.nv;
        const topV = (f, u, s, ea, eb) => { mb.A[2] = ea; mb.A[3] = eb; mb.M[0] = 0; mb.M[1] = fl; mb.M[2] = f.w / 2; mb.M[3] = 0; const p = P(f, u, 0); mb.V(p[0], p[1], p[2], f.n[0], f.n[1], f.n[2], s, u); };
        topV(fA, a0, sA, a0, b0); topV(fA, b0, sA, a0, b0); topV(fB, b1, sB, a1, b1); topV(fB, a1, sB, a1, b1);
        mb.tri(base, base + 1, base + 2); mb.tri(base, base + 2, base + 3);
        mb.M[1] = 0;
        // underside
        mb.M[0] = 2; mb.M[2] = fA.w / 2;
        mb.quad(P(fA, a0, -TH), P(fA, b0, -TH), P(fB, b1, -TH), P(fB, a1, -TH), [0, -1, 0], [sA, a0, sA, b0, sB, b1, sB, a1]);
        // side walls (+ raised rim on outer edges)
        const side = (u0, u1, outer, sg) => {
          const nrm = [fA.rx * sg, 0, fA.rz * sg];
          if (outer) {
            mb.M[0] = 1; mb.M[2] = fA.w / 2;
            mb.quad(P(fA, u0, RIM), P(fB, u1, RIM), P(fB, u1, -TH), P(fA, u0, -TH), nrm, [sA, 0, sB, 0, sB, 1, sA, 1]);
            const i0u = u0 - sg * RW, i1u = u1 - sg * RW;
            mb.M[0] = 6;
            mb.quad(P(fA, u0, RIM), P(fB, u1, RIM), P(fB, i1u, RIM), P(fA, i0u, RIM), [0, 1, 0], [sA, 0, sB, 0, sB, 1, sA, 1]);
            mb.quad(P(fA, i0u, RIM), P(fB, i1u, RIM), P(fB, i1u, 0), P(fA, i0u, 0), [-nrm[0], 0, -nrm[2]], [sA, 0, sB, 0, sB, 1, sA, 1]);
          } else {
            mb.M[0] = 12;
            mb.quad(P(fA, u0, 0), P(fB, u1, 0), P(fB, u1, -TH), P(fA, u0, -TH), nrm, [sA, 0, sB, 0, sB, 1, sA, 1]);
          }
        };
        side(a0, a1, ao, -1); side(b0, b1, bo, 1);
        mb.M[0] = 12;
        if (openB) mb.quad(P(fA, a0, 0), P(fA, b0, 0), P(fA, b0, -TH), P(fA, a0, -TH), [-fA.fx, 0, -fA.fz], [a0, 0, b0, 0, b0, 1, a0, 1]);
        if (openF) mb.quad(P(fB, a1, 0), P(fB, b1, 0), P(fB, b1, -TH), P(fB, a1, -TH), [fB.fx, 0, fB.fz], [a1, 0, b1, 0, b1, 1, a1, 1]);
        // guard rails
        const rail = (u0, u1, sg) => {
          mb.M[0] = 5;
          const o0 = u0 - sg * 0.02, o1 = u1 - sg * 0.02, q0 = u0 - sg * 0.1, q1 = u1 - sg * 0.1;
          mb.hexa([P(fA, o0, 0.27), P(fA, q0, 0.27), P(fB, q1, 0.27), P(fB, o1, 0.27), P(fA, o0, 0.36), P(fA, q0, 0.36), P(fB, q1, 0.36), P(fB, o1, 0.36)]);
          mb.M[0] = 4; mb.M[3] = 0.8;
          mb.hexa([P(fA, o0, 0.36), P(fA, q0, 0.36), P(fB, q1, 0.36), P(fB, o1, 0.36), P(fA, o0, 0.375), P(fA, q0, 0.375), P(fB, q1, 0.375), P(fB, o1, 0.375)]);
          if ((i & 1) === 0) {
            mb.M[0] = 3; const e = P(fA, (o0 + q0) / 2, 0.02), t = P(fA, (o0 + q0) / 2, 0.27);
            mb.strut(e, t, 0.03);
          }
        };
        // kid mode: a bumper fence on every outer edge that has no real rail: a low bar, short posts
        // and a glowing top bar as high as the ball's center
        const kidRail = (u0, u1, sg) => {
          const o0 = u0 - sg * 0.01, o1 = u1 - sg * 0.01, q0 = u0 - sg * 0.1, q1 = u1 - sg * 0.1;
          const bar = (y0, y1) => mb.hexa([P(fA, o0, y0), P(fA, q0, y0), P(fB, q1, y0), P(fB, o1, y0), P(fA, o0, y1), P(fA, q0, y1), P(fB, q1, y1), P(fB, o1, y1)]);
          mb.M[0] = 6; bar(0.03, 0.13);
          if ((i & 1) === 0) { const c = (o0 + q0) / 2; mb.strut(P(fA, c, 0.12), P(fA, c, 0.35), 0.025); }
          mb.M[0] = 7; mb.M[3] = 0.75; bar(0.34, 0.44);
          mb.M[3] = 1;
        };
        if ((flags & RF.RAIL_L) && ao) rail(a0, a1, -1); else if (kid && ao) kidRail(a0, a1, -1);
        if ((flags & RF.RAIL_R) && bo) rail(b0, b1, 1); else if (kid && bo) kidRail(b0, b1, 1);
      }
      // under-structure
      if (n > 0) {
        mb.M[0] = 3; mb.M[3] = 1;
        for (const gs of [-1, 1]) {
          const gu0 = gs * fA.w * 0.28, gu1 = gs * fB.w * 0.28;
          if (T.solidAt(i, 0.5, (gu0 + gu1) / 2) < 0) continue;
          mb.hexa([P(fA, gu0 - 0.06, -TH - 0.2), P(fA, gu0 + 0.06, -TH - 0.2), P(fB, gu1 + 0.06, -TH - 0.2), P(fB, gu1 - 0.06, -TH - 0.2),
            P(fA, gu0 - 0.06, -TH), P(fA, gu0 + 0.06, -TH), P(fB, gu1 + 0.06, -TH), P(fB, gu1 - 0.06, -TH)], 0.5);
        }
        const full = n === 1 && T.rowAO[m * 3] && T.rowBO[m * 3];
        if (full && i % 4 === 0) {
          const hw = fA.w / 2 - 0.15;
          const q = (u, h, df) => { const p = P(fA, u, h); return [p[0] + fA.fx * df, p[1], p[2] + fA.fz * df]; };
          mb.hexa([q(-hw, -TH - 0.14, 0.1), q(hw, -TH - 0.14, 0.1), q(hw, -TH - 0.14, 0.24), q(-hw, -TH - 0.14, 0.24),
            q(-hw, -TH, 0.1), q(hw, -TH, 0.1), q(hw, -TH, 0.24), q(-hw, -TH, 0.24)], 2);
        }
        if (full && i % 24 === 12) {
          const hub = P(fA, 0, -TH - 2.1);
          const l = P(fA, -fA.w * 0.28, -TH - 0.2), r = P(fA, fA.w * 0.28, -TH - 0.2);
          mb.strut(l, hub, 0.035); mb.strut(r, hub, 0.035);
          mb.strut(hub, [hub[0], hub[1] - 1.4, hub[2]], 0.05);
          mb.M[0] = 4; mb.M[3] = 1.4;
          const hb = [hub[0], hub[1] - 1.45, hub[2]];
          mb.hexa([[hb[0] - 0.09, hb[1] - 0.12, hb[2] - 0.09], [hb[0] + 0.09, hb[1] - 0.12, hb[2] - 0.09], [hb[0] + 0.09, hb[1] - 0.12, hb[2] + 0.09], [hb[0] - 0.09, hb[1] - 0.12, hb[2] + 0.09],
            [hb[0] - 0.09, hb[1] + 0.12, hb[2] - 0.09], [hb[0] + 0.09, hb[1] + 0.12, hb[2] - 0.09], [hb[0] + 0.09, hb[1] + 0.12, hb[2] + 0.09], [hb[0] - 0.09, hb[1] + 0.12, hb[2] + 0.09]]);
          mb.M[3] = 1;
        }
      }
      fA = fB;
    }
    // bounding sphere for culling
    const mA = i0 & M, mB = (i0 + CR) & M, mC = (i0 + (CR >> 1)) & M;
    const cx = T.x[mC], cy = T.y[mC], cz = T.z[mC];
    const rad = Math.max(Math.hypot(T.x[mA] - cx, T.y[mA] - cy, T.z[mA] - cz), Math.hypot(T.x[mB] - cx, T.y[mB] - cy, T.z[mB] - cz)) + 6;
    return { mb, cx, cy, cz, rad, sEnd: (i0 + CR) * DS, sStart: i0 * DS };
  },
};

// The track theme picker's model: a short banked bend with a booster and a guard rail.
TrackMesher.preview = () => {
  const T = new Track(), N = CFG.CHUNK_ROWS + 2, DS = CFG.DS;
  let th = 0, x = 0, z = 0;
  for (let i = 0; i < N; i++) {
    const s = i * DS, k = 0.055 * clamp((s - 5) / 8, 0, 1);
    T.x[i] = x; T.y[i] = 0; T.z[i] = z; T.th[i] = th; T.w[i] = 3.4; T.kap[i] = k; T.bank[i] = k * 1.8; T.slope[i] = 0;
    T.rowN[i] = 1; T.rowAO[i * 3] = T.rowBO[i * 3] = 1;
    T.rowF[i] = RF.RAIL_R | (s > 5.5 && s < 11 ? RF.BOOST : 0);
    th += k * DS; x += Math.sin(th) * DS; z += Math.cos(th) * DS;
  }
  T.n = N;
  return T;
};

// ---------------------------------------------------------------- sky panoramas (Canvas 2D → textures)
// One equirect panorama per world zone; far silhouettes are painted in, so they act as the
// infinitely distant background layer of the parallax. Z may carry a time of day (see skyZone):
// a moved sun, a warm glow for a low sun, or a night (dimmed, with stars and the moon's glow).
function makeSkyCanvases(Z, seed) {
  const W = 1024, H = 512, HZ = H / 2, r = RNG(seed);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
  const mix = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, css(Z.skyTop)); grd.addColorStop(0.28, css(Z.skyMid));
  grd.addColorStop(0.47, css(Z.horizon)); grd.addColorStop(0.53, css(Z.fog));
  grd.addColorStop(0.78, css(mix(Z.abyss, Z.fog, 0.45))); grd.addColorStop(1, css(Z.abyss));
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const blob = (x, y, rad, col, a) => {
    for (const ox of [-W, 0, W]) {
      if (x + ox + rad < 0 || x + ox - rad > W) continue;
      const rg = g.createRadialGradient(x + ox, y, 0, x + ox, y, rad);
      rg.addColorStop(0, css(col, a)); rg.addColorStop(1, css(col, 0));
      g.fillStyle = rg; g.fillRect(x + ox - rad, y - rad, rad * 2, rad * 2);
    }
  };
  // periodic 1D noise so silhouettes wrap around 360°
  const ridge = (n, amp) => { const ph = []; for (let k = 1; k <= n; k++) ph.push([r.range(0, TAU), amp / Math.pow(k, 0.9) * r.range(0.6, 1.2), k * r.int(1, 3)]); return (x) => ph.reduce((s, [p, a, f]) => s + Math.sin(x / W * TAU * f + p) * a, 0); };
  const sd = Z.sunDir, sl = Math.hypot(sd[0], sd[1], sd[2]);
  const sunX = (Math.atan2(sd[0] / sl, sd[2] / sl) / TAU + 0.5) * W, sunY = Math.acos(sd[1] / sl) / Math.PI * H;
  const nebK = { tech: 1, land: 0.5, neon: 1, abstract: 0.6, chaos: 0.7, farm: 0.05, forest: 0.1, sea: 0.04, desert: 0.08 }[Z.id];
  g.globalCompositeOperation = 'lighter';
  for (let b = 0; b < 4; b++) {
    const cx = r.range(0, W), cy = r.range(H * 0.12, H * 0.42), col = Z.neb[b % Z.neb.length];
    for (let k = 0; k < 30; k++) blob(cx + r.range(-260, 260), cy + r.range(-60, 60) * (1 + k / 40), r.range(25, 150), col, r.range(0.04, 0.1) * nebK);
  }
  const hz = g.createLinearGradient(0, H * 0.4, 0, H * 0.62);
  hz.addColorStop(0, css(Z.horizon, 0)); hz.addColorStop(0.5, css(Z.horizon, 0.35)); hz.addColorStop(1, css(Z.horizon, 0));
  g.fillStyle = hz; g.fillRect(0, H * 0.4, W, H * 0.22);
  for (let k = 0; k < 22; k++) blob(r.range(0, W), r.range(H * 0.68, H * 0.95), r.range(40, 170), Z.abyss, r.range(0.04, 0.1));
  for (let k = 0; k < 1400 * Z.stars; k++) {
    const y = Math.pow(r.next(), 1.2) * H * 0.48, x = r.range(0, W), a = r.range(0.08, 0.5);
    g.fillStyle = `rgba(255,255,255,${a})`; g.fillRect(x, y, r.chance(0.1) ? 2 : 1, 1);
  }
  g.globalCompositeOperation = 'source-over';
  const band = (col, top) => { g.fillStyle = css(col); g.fillRect(0, top, W, H * 0.6 - top); };
  // Cumulus cloud, painted on its own canvas then laid on the sky: soft white puffs as one shape,
  // shaded towards a flat grey base and on the side away from the sun.
  const cumulus = (cx, cy, w, h, lit, shade, alpha) => {
    const cw = Math.ceil(w * 1.3), ch = Math.ceil(h * 1.8), c = document.createElement('canvas'); c.width = cw; c.height = ch;
    const x = c.getContext('2d'), base = ch * 0.9, n = 6 + Math.round(w / h * 3), puffs = [];
    const side = ((sunX - cx) % W + W * 1.5) % W - W / 2 > 0 ? 1 : -1;
    for (let k = 0; k < n; k++) {
      const u = r.range(-0.38, 0.38), bump = Math.cos(u * Math.PI) ** 1.5, rad = h * (0.22 + 0.36 * bump) * r.range(0.75, 1.25);
      puffs.push([cw / 2 + u * w, base - rad * 0.45 - bump * h * r.range(0.25, 0.6), rad]);
    }
    for (const [px, py, rad] of puffs) {
      const gr = x.createRadialGradient(px, py, 0, px, py, rad);
      gr.addColorStop(0, css(lit)); gr.addColorStop(0.8, css(lit)); gr.addColorStop(1, css(lit, 0));
      x.fillStyle = gr; x.fillRect(px - rad, py - rad, rad * 2, rad * 2);
    }
    x.globalCompositeOperation = 'destination-out'; x.fillRect(0, base, cw, ch - base);
    x.globalCompositeOperation = 'source-atop';
    for (const [px, py, rad] of puffs) {                       // volume: each puff darker away from the sun
      const gr = x.createRadialGradient(px - side * rad * 0.5, py + rad * 0.45, 0, px - side * rad * 0.5, py + rad * 0.45, rad * 1.1);
      gr.addColorStop(0, css(shade, 0.28)); gr.addColorStop(1, css(shade, 0));
      x.fillStyle = gr; x.fillRect(px - rad * 2, py - rad, rad * 3, rad * 3);
    }
    const bg = x.createLinearGradient(0, base - h * 0.7, 0, base); bg.addColorStop(0, css(shade, 0)); bg.addColorStop(1, css(shade, 0.8));
    x.fillStyle = bg; x.fillRect(0, 0, cw, ch);
    g.globalAlpha = alpha;
    for (const ox of [-W, 0, W]) g.drawImage(c, cx - cw / 2 + ox, cy - base);
    g.globalAlpha = 1;
  };
  // A sky of clouds, smaller and flatter towards the horizon.
  const cloudSky = (n, lit, shade, alpha, size = 1) => {
    const y0 = H * 0.13, y1 = HZ - 10, list = [];
    for (let k = 0; k < n; k++) list.push(y0 + Math.pow(r.next(), 0.7) * (y1 - y0));
    list.sort((a, b) => b - a);                                     // far (low) clouds first
    for (const y of list) {
      const t = (y - y0) / (y1 - y0), w = lerp(230, 55, t) * r.range(0.65, 1.35) * size;
      cumulus(r.range(0, W), y, w, w * lerp(0.36, 0.2, t), lit, shade, alpha * lerp(1, 0.75, t));
    }
  };
  const streaks = (n, col, a) => {
    for (let k = 0; k < n; k++) {
      const y = r.range(H * 0.08, H * 0.3), x = r.range(0, W), w = r.range(80, 260);
      for (const ox of [-W, 0, W]) { const lg = g.createRadialGradient(x + ox, y, 0, x + ox, y, w / 2); lg.addColorStop(0, css(col, a)); lg.addColorStop(1, css(col, 0));
        g.save(); g.translate(x + ox, y); g.scale(1, r.range(0.04, 0.09)); g.translate(-x - ox, -y); g.fillStyle = lg; g.fillRect(x + ox - w / 2, y - w / 2, w, w); g.restore(); }
    }
  };
  // Draws `fn(x)` at x and at its wrapped copies near the seams.
  const wrapX = (x, w, fn) => { fn(x); if (x - w < 0) fn(x + W); if (x + w > W) fn(x - W); };
  if (Z.id === 'tech') {
    for (let L = 0; L < 3; L++) {
      const col = mix(Z.horizon, Z.skyTop, 0.35 + L * 0.2), base = HZ + 5 + L * 3;
      let x = 0;
      while (x < W) {
        const w = r.range(5, 22), h = r.range(6, 26) * (1 + L * 0.45) * (r.chance(0.12) ? 2.2 : 1);
        g.fillStyle = css(col, 0.92); g.fillRect(x, base - h, w, h + 2);
        g.fillStyle = css(Z.c1, 0.55);
        for (let k = 0; k < h * w / 40; k++) if (r.chance(0.5)) g.fillRect(x + r.range(1, w - 2), base - r.range(2, h), 1, 1);
        if (h > 40) { g.fillStyle = 'rgba(255,60,60,.9)'; g.fillRect(x + w / 2, base - h - 3, 1.5, 1.5); }
        x += w + r.range(0, 4);
      }
      band(col, base);
    }
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 7; k++) {
      const x = r.range(0, W), lg = g.createLinearGradient(0, HZ, 0, HZ - 180);
      lg.addColorStop(0, css(Z.c1, 0.14)); lg.addColorStop(1, css(Z.c1, 0));
      g.fillStyle = lg; g.beginPath(); g.moveTo(x - 2, HZ); g.lineTo(x + 2, HZ); g.lineTo(x + r.range(-40, 40), HZ - 180); g.fill();
    }
  } else if (Z.id === 'land') {
    g.globalCompositeOperation = 'lighter';
    blob(sunX, sunY, 150, Z.sun, 0.35); blob(sunX, sunY, 40, [1, 1, 1], 0.6);
    for (let k = 0; k < 16; k++) { g.fillStyle = css(Z.horizon, 0.07); g.beginPath(); g.ellipse(r.range(0, W), r.range(HZ - 90, HZ - 10), r.range(60, 200), r.range(3, 9), 0, 0, TAU); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    const layers = [[mix(Z.horizon, Z.skyMid, 0.45), 0.8, 46, 10], [mix(Z.skyMid, Z.skyTop, 0.3), 0.9, 34, 14], [mix(Z.skyTop, Z.fog, 0.35), 1, 22, 18]];
    layers.forEach(([col, a, amp, n], L) => {
      const f = ridge(n, amp), base = HZ + 4 + L * 5;
      g.fillStyle = css(col, a); g.beginPath(); g.moveTo(0, H * 0.62);
      for (let x = 0; x <= W; x += 4) g.lineTo(x, base - Math.abs(f(x)) - amp * 0.3);
      g.lineTo(W, H * 0.62); g.closePath(); g.fill();
    });
  } else if (Z.id === 'neon') {
    const sc = document.createElement('canvas'), R = 78; sc.width = sc.height = R * 2 + 4;
    const sg = sc.getContext('2d'), lg = sg.createLinearGradient(0, 2, 0, R * 2 + 2);
    lg.addColorStop(0, 'rgb(255,236,130)'); lg.addColorStop(0.55, 'rgb(255,120,110)'); lg.addColorStop(1, 'rgb(255,30,170)');
    sg.fillStyle = lg; sg.beginPath(); sg.arc(R + 2, R + 2, R, 0, TAU); sg.fill();
    sg.globalCompositeOperation = 'destination-out';
    for (let k = 0; k < 7; k++) { const y = R + 8 + k * 11; sg.fillRect(0, y, R * 2 + 4, 2 + k * 0.9); }
    if (!Z.moon) {                                   // the striped sunset sun (the moon takes its place at night)
      g.globalCompositeOperation = 'lighter'; blob(sunX, sunY - 20, 190, [1, 0.2, 0.6], 0.35);
      g.globalCompositeOperation = 'source-over';
      g.drawImage(sc, sunX - R - 2, sunY - R - 30);
    }
    const f = ridge(14, 30);
    g.fillStyle = css(Z.skyTop, 1); g.strokeStyle = css(Z.c2, 0.9); g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, H * 0.6);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, HZ + 3 - Math.max(0, f(x)) * 1.4);
    g.lineTo(W, H * 0.6); g.closePath(); g.fill();
    g.beginPath(); for (let x = 0; x <= W; x += 6) { const y = HZ + 3 - Math.max(0, f(x)) * 1.4; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); } g.stroke();
    g.strokeStyle = css(Z.c1, 0.8); g.lineWidth = 2; g.beginPath(); g.moveTo(0, HZ + 4); g.lineTo(W, HZ + 4); g.stroke();
  } else if (Z.id === 'abstract') {
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 22; k++) {
      const x = r.range(0, W), y = r.range(H * 0.12, HZ - 10), s = r.range(14, 90), col = Z.neb[k % 4];
      g.strokeStyle = css(col, r.range(0.12, 0.3)); g.lineWidth = r.range(1.5, 4);
      g.beginPath();
      const kind = k % 3;
      if (kind === 0) g.arc(x, y, s, 0, TAU);
      else { const n = kind === 1 ? 3 : 4, rot = r.range(0, TAU); for (let j = 0; j <= n; j++) { const a = rot + j / n * TAU; if (j === 0) g.moveTo(x + Math.cos(a) * s, y + Math.sin(a) * s); else g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } }
      g.stroke();
    }
    blob(sunX, sunY, 120, [1, 1, 1], 0.25);
  } else if (Z.id === 'farm') {
    g.globalCompositeOperation = 'lighter'; blob(sunX, sunY, 110, Z.sun, 0.2); g.globalCompositeOperation = 'source-over';
    streaks(10, [1, 1, 1], 0.35);
    cloudSky(22, mix([1, 1, 1], Z.sun, 0.25), mix(Z.skyMid, Z.horizon, 0.45), 0.97);
    // rolling hills: far ones hazy, near ones green, with trees, cypresses, turbines and a steeple
    const layers = [[mix(Z.horizon, [0.42, 0.58, 0.52], 0.45), 10, 4], [mix(Z.fog, [0.33, 0.52, 0.27], 0.6), 16, 5], [[0.24, 0.42, 0.18], 11, 6]];
    layers.forEach(([col, amp, n], L) => {
      const f = ridge(n, amp), base = HZ + 3 + L * 4, y = (x) => base - Math.abs(f(x)) - amp * 0.5;
      g.fillStyle = css(col); g.beginPath(); g.moveTo(0, H * 0.62);
      for (let x = 0; x <= W; x += 4) g.lineTo(x, y(x));
      g.lineTo(W, H * 0.62); g.closePath(); g.fill();
      const dark = css(mix(col, [0.05, 0.12, 0.04], 0.55));
      for (let x = r.range(0, 10); x < W; x += r.range(5, 22) / (L + 1) * 2) {
        const yy = y(x) + 1;
        g.fillStyle = dark;
        if (L === 2 && r.chance(0.3)) { g.beginPath(); g.ellipse(x, yy - 5, 1.4, 5.5, 0, 0, TAU); g.fill(); }
        else if (L > 0 && r.chance(0.6)) { const rr = L === 2 ? r.range(2, 3.6) : r.range(1.1, 1.8); g.beginPath(); g.arc(x, yy - rr, rr, 0, TAU); g.fill(); }
      }
      if (L === 0) for (let k = 0; k < 7; k++) {                       // distant wind turbines
        const x = r.range(0, W), yy = y(x), hh = r.range(9, 13), a = r.range(0, TAU);
        g.strokeStyle = css(mix(Z.horizon, [1, 1, 1], 0.5), 0.9); g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(x, yy); g.lineTo(x, yy - hh);
        for (let b = 0; b < 3; b++) { const t = a + b / 3 * TAU; g.moveTo(x, yy - hh); g.lineTo(x + Math.cos(t) * hh * 0.45, yy - hh + Math.sin(t) * hh * 0.45); }
        g.stroke();
      }
      if (L === 1) { const x = r.range(0, W), yy = y(x) + 1; g.fillStyle = css(mix(col, [0.9, 0.85, 0.75], 0.5)); g.fillRect(x - 2, yy - 9, 4, 9); g.beginPath(); g.moveTo(x - 2.5, yy - 9); g.lineTo(x, yy - 17); g.lineTo(x + 2.5, yy - 9); g.fill(); }
    });
  } else if (Z.id === 'forest') {
    g.globalCompositeOperation = 'lighter'; blob(sunX, sunY, 170, Z.sun, 0.26); blob(sunX, sunY, 50, [1, 0.95, 0.85], 0.4); g.globalCompositeOperation = 'source-over';
    streaks(14, Z.horizon, 0.3);
    cloudSky(8, mix([1, 1, 1], Z.sun, 0.4), mix(Z.skyMid, Z.fog, 0.5), 0.6, 1.3);
    // ranks of conifers fading into the morning mist, darker towards the viewer
    for (let L = 0; L < 5; L++) {
      const col = mix(mix(Z.horizon, Z.fog, 0.55), [0.05, 0.13, 0.09], L / 4), base = HZ - 4 + L * 4, sc = 1 + L * 0.4;
      g.fillStyle = css(col);
      for (let x = r.range(0, 6); x < W; ) {
        const w = r.range(4, 9) * sc, hh = r.range(9, 24) * sc;
        wrapX(x, w, (px) => { g.beginPath(); g.moveTo(px - w / 2, base + 2); g.lineTo(px - w * 0.12, base - hh * 0.72); g.lineTo(px, base - hh); g.lineTo(px + w * 0.12, base - hh * 0.72); g.lineTo(px + w / 2, base + 2); g.fill(); });
        x += w * r.range(0.35, 0.7);
      }
      g.fillRect(0, base + 1, W, H * 0.62 - base);
      const mg = g.createLinearGradient(0, base - 16, 0, base + 5); mg.addColorStop(0, css(Z.fog, 0)); mg.addColorStop(1, css(mix(Z.fog, Z.horizon, 0.3), 0.6));
      g.fillStyle = mg; g.fillRect(0, base - 16, W, 21);
    }
  } else if (Z.id === 'sea') {
    g.globalCompositeOperation = 'lighter'; blob(sunX, sunY, 110, Z.sun, 0.2); g.globalCompositeOperation = 'source-over';
    streaks(12, [1, 1, 1], 0.4);
    cloudSky(18, mix([1, 1, 1], Z.sun, 0.2), mix(Z.skyMid, Z.horizon, 0.5), 0.97);
    const sg = g.createLinearGradient(0, HZ, 0, H * 0.62); sg.addColorStop(0, css(mix(Z.horizon, Z.abyss, 0.35))); sg.addColorStop(1, css(Z.abyss));
    g.fillStyle = sg; g.fillRect(0, HZ, W, H * 0.62 - HZ);
    for (let k = 0; k < 4; k++) {                                    // islands and cliffs on the horizon
      const cx = r.range(0, W), w = r.range(40, 150), hh = r.range(5, 16), col = mix(Z.fog, [0.28, 0.38, 0.42], r.range(0.3, 0.6));
      g.fillStyle = css(col);
      wrapX(cx, w, (px) => { g.beginPath(); g.moveTo(px - w / 2, HZ + 1); for (let t = 0; t <= 1.001; t += 0.05) g.lineTo(px - w / 2 + t * w, HZ + 1 - hh * Math.pow(Math.sin(t * Math.PI), 0.6) * (0.85 + 0.15 * Math.sin(t * 17 + k))); g.lineTo(px + w / 2, HZ + 1); g.fill(); });
      if (k === 0) { g.fillStyle = '#f4f4f0'; g.fillRect(cx - 1, HZ - hh - 8, 2.2, 8); g.fillStyle = '#d83a2a'; g.fillRect(cx - 1.4, HZ - hh - 10, 3, 2.5); }
    }
    for (let k = 0; k < 12; k++) {                                   // sailboats
      const x = r.range(0, W), s2 = r.range(0.7, 1.4);
      g.fillStyle = 'rgba(250,250,245,.9)'; g.beginPath(); g.moveTo(x, HZ + 1); g.lineTo(x, HZ - 7 * s2); g.lineTo(x + 3.5 * s2, HZ + 1); g.fill();
      g.fillStyle = css(mix(Z.abyss, [0, 0, 0], 0.3)); g.fillRect(x - 2 * s2, HZ + 1, 6.5 * s2, 1.2);
    }
    g.globalCompositeOperation = 'lighter';                          // sun glitter on the water
    for (let k = 0; k < 420; k++) {
      const t = Math.pow(r.next(), 1.6), y = HZ + 1 + t * 55, x = sunX + r.range(-1, 1) * (6 + t * 70);
      g.fillStyle = css(Z.sun, r.range(0.15, 0.6) * (1 - t * 0.6)); g.fillRect(x, y, r.range(2, 7) * (0.5 + t), 1);
    }
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = css(mix(Z.horizon, [1, 1, 1], 0.4), 0.8); g.fillRect(0, HZ, W, 1);
  } else if (Z.id === 'desert') {
    g.globalCompositeOperation = 'lighter'; blob(sunX, sunY, 140, Z.sun, 0.24); blob(sunX, sunY, 40, [1, 1, 1], 0.35); g.globalCompositeOperation = 'source-over';
    streaks(8, [1, 0.95, 0.9], 0.3);
    cloudSky(6, mix([1, 1, 1], Z.sun, 0.3), mix(Z.skyMid, Z.horizon, 0.55), 0.8, 0.7);
    // mesas and buttes: flat tops, steep sides (a far hazy range, a near red one), pyramids between them
    const range = (col, base, n, hMin, hMax) => {
      const hts = new Float32Array(W + 1);
      for (let k = 0; k < n; k++) {
        const cx = r.range(0, W), w = r.chance(0.25) ? r.range(8, 20) : r.range(40, 150), hh = r.range(hMin, hMax), sl = r.range(3, 10);
        for (let dx = -w / 2 - sl; dx <= w / 2 + sl; dx++) {
          const x = Math.round(cx + dx), xi = ((x % W) + W) % W, e = Math.abs(dx) - w / 2;
          hts[xi] = Math.max(hts[xi], e <= 0 ? hh : hh * (1 - e / sl) * (0.8 + 0.2 * Math.sin(dx)));
        }
      }
      hts[W] = hts[0];
      g.fillStyle = css(col); g.beginPath(); g.moveTo(0, H * 0.62);
      for (let x = 0; x <= W; x++) g.lineTo(x, base - hts[x]);
      g.lineTo(W, H * 0.62); g.closePath(); g.fill();
    };
    range(mix(Z.horizon, [0.72, 0.52, 0.5], 0.45), HZ + 2, 9, 6, 18);
    for (let k = 0; k < 3; k++) {
      const x = r.range(0, W), w = r.range(22, 46), hh = w * 0.55, base = HZ + 3;
      g.fillStyle = css(mix(Z.horizon, [0.85, 0.66, 0.42], 0.6)); g.beginPath(); g.moveTo(x - w / 2, base); g.lineTo(x, base - hh); g.lineTo(x + w / 2, base); g.fill();
      g.fillStyle = css(mix(Z.horizon, [0.6, 0.42, 0.3], 0.6)); g.beginPath(); g.moveTo(x, base - hh); g.lineTo(x + w / 2, base); g.lineTo(x + w * 0.12, base); g.fill();
    }
    range(mix([0.66, 0.34, 0.2], Z.fog, 0.28), HZ + 7, 7, 10, 34);
    const hg = g.createLinearGradient(0, HZ - 30, 0, HZ + 12); hg.addColorStop(0, css(Z.horizon, 0)); hg.addColorStop(1, css(Z.horizon, 0.35));
    g.fillStyle = hg; g.fillRect(0, HZ - 30, W, 42);
  } else {
    for (let k = 0; k < 70; k++) blob(r.range(0, W), r.range(H * 0.08, HZ - 6), r.range(40, 140), [0.03, 0.01, 0.01], r.range(0.25, 0.5));
    g.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 14; k++) {
      g.strokeStyle = css(Z.c1, r.range(0.2, 0.45)); g.lineWidth = r.range(0.8, 2);
      let x = r.range(0, W), y = r.range(H * 0.1, HZ - 40); g.beginPath(); g.moveTo(x, y);
      for (let j = 0; j < 6; j++) { x += r.range(-25, 25); y += r.range(4, 16); g.lineTo(x, y); }
      g.stroke();
    }
    const hg = g.createLinearGradient(0, HZ - 50, 0, HZ + 30);
    hg.addColorStop(0, css(Z.horizon, 0)); hg.addColorStop(0.7, css(Z.abyss, 0.45)); hg.addColorStop(1, css(Z.horizon, 0));
    g.fillStyle = hg; g.fillRect(0, HZ - 50, W, 80);
    for (let k = 0; k < 500; k++) { g.fillStyle = css(Z.c2, r.range(0.2, 0.7)); g.fillRect(r.range(0, W), r.range(HZ - 120, HZ + 60), 1, 1); }
  }
  if (Z.dusk > 0) {                                // low sun: the horizon glows warm around it
    g.globalCompositeOperation = 'lighter';
    blob(sunX, HZ - 8, 260, [1, 0.42, 0.18], 0.16 * Z.dusk); blob(sunX, HZ - 4, 90, [1, 0.62, 0.35], 0.12 * Z.dusk);
    g.globalCompositeOperation = 'source-over';
  }
  const nk = Z.nightK || 0;
  if (nk > 0 || Z.moon) {
    // night: the whole painting dims to a moonlit blue, then stars, a faint Milky Way and the moon's glow on top
    if (nk > 0) { g.globalCompositeOperation = 'multiply'; g.fillStyle = css(NIGHT_TINT.map((v) => lerp(1, v, nk))); g.fillRect(0, 0, W, H); }
    g.globalCompositeOperation = 'lighter';
    const tilt = r.range(0, TAU);
    for (let k = 0; k < 90 * nk; k++) {
      const x = r.range(0, W), y = H * 0.22 + Math.sin(x / W * TAU + tilt) * H * 0.13 + r.range(-18, 18);
      blob(x, y, r.range(18, 60), [0.72, 0.78, 1], r.range(0.02, 0.05) * nk);
    }
    for (let k = 0; k < 1800 * nk; k++) {
      const y = Math.pow(r.next(), 1.3) * H * 0.5, a = r.range(0.1, 0.75) * (1 - y / H * 1.2);
      g.fillStyle = `rgba(${r.chance(0.2) ? '255,236,210' : '225,235,255'},${a})`; g.fillRect(r.range(0, W), y, r.chance(0.08) ? 2 : 1, 1);
    }
    if (Z.moon) { blob(sunX, sunY, 150, [0.62, 0.72, 1], 0.14); blob(sunX, sunY, 48, [0.85, 0.9, 1], 0.2); }
    g.globalCompositeOperation = 'source-over';
  }
  const down = (src, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, w, h); return c; };
  const midC = down(down(cv, 512, 256), 256, 128);
  const blurC = down(down(midC, 128, 64), 64, 32);
  return { sky: cv, mid: midC, blur: blurC };
}
