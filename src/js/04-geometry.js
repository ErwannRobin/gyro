
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

// ---------------------------------------------------------------- track chunk mesher
const TrackMesher = {
  covered(T, j, u) {
    if (j < T.minIndex() || j >= T.n - 1) return false;
    return T.solidAt(j, 0.5, u) >= 0;
  },
  build(T, c) {
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
        if ((flags & RF.RAIL_L) && ao) rail(a0, a1, -1);
        if ((flags & RF.RAIL_R) && bo) rail(b0, b1, 1);
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

// ---------------------------------------------------------------- sky panoramas (Canvas 2D → textures)
// One equirect panorama per world zone; far silhouettes are painted in, so they act as the
// infinitely distant background layer of the parallax.
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
  const nebK = { tech: 1, land: 0.5, neon: 1, abstract: 0.6, chaos: 0.7 }[Z.id];
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
    g.globalCompositeOperation = 'lighter'; blob(sunX, sunY - 20, 190, [1, 0.2, 0.6], 0.35);
    g.globalCompositeOperation = 'source-over';
    g.drawImage(sc, sunX - R - 2, sunY - R - 30);
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
  const down = (src, w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(src, 0, 0, w, h); return c; };
  const midC = down(down(cv, 512, 256), 256, 128);
  const blurC = down(down(midC, 128, 64), 64, 32);
  return { sky: cv, mid: midC, blur: blurC };
}
