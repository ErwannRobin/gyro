
'use strict';
/* =====================================================================
   GYROLL — endless tilt-controlled marble run.
   Single-file game: WebGL renderer, custom physics, procedural track,
   Web Audio synthesis. No external resources.
   ===================================================================== */

// ---------------------------------------------------------------- utils
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const fin = (v, d = 0) => (Number.isFinite(v) ? v : d);
const TAU = Math.PI * 2;
const wrapAngle = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
const fmt = (n) => Math.floor(Math.max(0, n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
// Integer hash to [0, 1): the same result on every device.
const ihash = (a) => { a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); a = Math.imul(a ^ (a >>> 16), 0x45d9f3b); return ((a ^ (a >>> 16)) >>> 0) / 4294967296; };

// Deterministic PRNG (mulberry32) so a run's track is reproducible from a seed.
function RNG(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    chance: (p) => next() < p,
    sign: () => (next() < 0.5 ? -1 : 1),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
  };
}

const Store = {
  get(k, d) { try { const v = localStorage.getItem('gyroll.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('gyroll.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ---------------------------------------------------------------- mat4 (column-major)
const M4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },
  perspective(out, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    out.fill(0);
    out[0] = f / aspect; out[5] = f; out[10] = (far + near) * nf; out[11] = -1; out[14] = 2 * far * near * nf;
    return out;
  },
  // View matrix from eye/target/up plus an extra roll around the view axis.
  lookAt(out, e, t, up, roll) {
    let zx = e[0] - t[0], zy = e[1] - t[1], zz = e[2] - t[2];
    let l = Math.hypot(zx, zy, zz) || 1; zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz) || 1; xx /= l; xy /= l; xz /= l;
    let yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    if (roll) {
      const c = Math.cos(roll), s = Math.sin(roll);
      const nx = [xx * c + yx * s, xy * c + yy * s, xz * c + yz * s];
      const ny = [yx * c - xx * s, yy * c - xy * s, yz * c - xz * s];
      xx = nx[0]; xy = nx[1]; xz = nx[2]; yx = ny[0]; yy = ny[1]; yz = ny[2];
    }
    out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
    out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
    out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
    out[12] = -(xx * e[0] + xy * e[1] + xz * e[2]);
    out[13] = -(yx * e[0] + yy * e[1] + yz * e[2]);
    out[14] = -(zx * e[0] + zy * e[1] + zz * e[2]);
    out[15] = 1;
    return out;
  },
  mul(out, a, b) {
    const r = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
      r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
    }
    out.set(r); return out;
  },
  invert(out, m) {
    const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
    const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return out;
    det = 1 / det;
    out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return out;
  },
  // Model matrix = T * R(quat) * S
  fromTRS(out, px, py, pz, q, sx, sy, sz) {
    const x = q[0], y = q[1], z = q[2], w = q[3];
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    out[0] = (1 - (yy + zz)) * sx; out[1] = (xy + wz) * sx; out[2] = (xz - wy) * sx; out[3] = 0;
    out[4] = (xy - wz) * sy; out[5] = (1 - (xx + zz)) * sy; out[6] = (yz + wx) * sy; out[7] = 0;
    out[8] = (xz + wy) * sz; out[9] = (yz - wx) * sz; out[10] = (1 - (xx + yy)) * sz; out[11] = 0;
    out[12] = px; out[13] = py; out[14] = pz; out[15] = 1;
    return out;
  },
};
const Q = {
  fromAxisAngle(out, ax, ay, az, a) { const s = Math.sin(a / 2); out[0] = ax * s; out[1] = ay * s; out[2] = az * s; out[3] = Math.cos(a / 2); return out; },
  yaw(out, a) { return Q.fromAxisAngle(out, 0, 1, 0, a); },
  mul(out, a, b) {
    const ax = a[0], ay = a[1], az = a[2], aw = a[3], bx = b[0], by = b[1], bz = b[2], bw = b[3];
    out[0] = aw * bx + ax * bw + ay * bz - az * by; out[1] = aw * by - ax * bz + ay * bw + az * bx;
    out[2] = aw * bz + ax * by - ay * bx + az * bw; out[3] = aw * bw - ax * bx - ay * by - az * bz;
    return out;
  },
  // Integrate angular velocity w (world space) into quaternion q.
  integrate(q, wx, wy, wz, dt) {
    const x = q[0], y = q[1], z = q[2], w = q[3], h = 0.5 * dt;
    q[0] += h * (wx * w + wy * z - wz * y);
    q[1] += h * (wy * w + wz * x - wx * z);
    q[2] += h * (wz * w + wx * y - wy * x);
    q[3] += h * (-wx * x - wy * y - wz * z);
    const l = Math.hypot(q[0], q[1], q[2], q[3]);
    if (!(l > 1e-6) || !Number.isFinite(l)) { q[0] = q[1] = q[2] = 0; q[3] = 1; return; }
    q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
  },
};

// ---------------------------------------------------------------- track / ball skins
// Track themes style the plank: deck pattern 0 carbon weave, 1 brushed metal, 2 wood, 3 marble, 4 lawn.
// `roll` changes how the ball rolls on it (grass: more drag, an uneven ground and tufts that bump the ball).
const TRACK_THEMES = [
  { name: { fr: 'NÉON CARBONE', en: 'NEON CARBON' }, pattern: 0, deckA: hex(0x151a26), deckB: hex(0x0b0e16), trim: hex(0x8a93a8), under: hex(0x1a1f2c),
    metal: hex(0x3b4356), accent: hex(0x4ef2ff), accent2: hex(0xff4fd8), hazard: hex(0xffc93c), gloss: 0.55,
    swatch: 'linear-gradient(135deg,#0b0e16,#1b2233 55%,#4ef2ff 56%,#4ef2ff 64%,#0b0e16 65%)' },
  { name: { fr: 'ACIER & OR', en: 'STEEL & GOLD' }, pattern: 1, deckA: hex(0x9aa1ab), deckB: hex(0x6d737d), trim: hex(0xe0b060), under: hex(0x2a2d33),
    metal: hex(0x5a5f69), accent: hex(0xffb347), accent2: hex(0xff5e3a), hazard: hex(0xffd23c), gloss: 0.8,
    swatch: 'linear-gradient(135deg,#6d737d,#b9c0ca 55%,#e0b060 56%,#e0b060 64%,#6d737d 65%)' },
  { name: { fr: 'JOUET BOIS', en: 'WOODEN TOY' }, pattern: 2, deckA: hex(0xb07a45), deckB: hex(0x7a4a22), trim: hex(0xd8b25a), under: hex(0x3a2414),
    metal: hex(0xb08a3a), accent: hex(0x9dff6a), accent2: hex(0xff5a5a), hazard: hex(0xff4a3a), gloss: 0.35,
    swatch: 'linear-gradient(135deg,#7a4a22,#c08a52 55%,#9dff6a 56%,#9dff6a 64%,#7a4a22 65%)' },
  { name: { fr: 'MARBRE GLACE', en: 'ICE MARBLE' }, pattern: 3, deckA: hex(0xd6dce6), deckB: hex(0x98a4ba), trim: hex(0xd0e4ff), under: hex(0x3a4458),
    metal: hex(0x8a98b0), accent: hex(0x8a7aff), accent2: hex(0x4ad8ff), hazard: hex(0xff5a8a), gloss: 0.9,
    swatch: 'linear-gradient(135deg,#a8b4c8,#f2f5fa 55%,#8a7aff 56%,#8a7aff 64%,#a8b4c8 65%)' },
  { name: { fr: 'GAZON', en: 'GRASS' }, pattern: 4, deckA: hex(0x86c850), deckB: hex(0x2d6420), trim: hex(0xe2d9bd), under: hex(0x3b2818),
    metal: hex(0x6e5236), accent: hex(0xfff27a), accent2: hex(0xff7ab8), hazard: hex(0xff6a3a), gloss: 0.12,
    roll: { drag: 0.05, wobble: 1.6, tuftSlow: 0.86, tuftKick: 0.75 },
    swatch: 'linear-gradient(135deg,#2d6420,#86c850 55%,#fff27a 56%,#fff27a 64%,#2d6420 65%)' },
];
// Ball skins: type 0 polished metal, 1 glass, 2 plasma, 3 candy plastic; rough = surface roughness (0 = mirror)
const BALL_SKINS = [
  { name: { fr: 'CHROME', en: 'CHROME' }, type: 0, rough: 0.025, base: hex(0xe8edf5), glow: hex(0x9fe8ff), swatch: 'radial-gradient(circle at 35% 30%,#fff,#aab4c4 40%,#3a4250 75%,#cfd8e6)' },
  { name: { fr: 'VERRE', en: 'GLASS' }, type: 1, rough: 0.0, base: hex(0x8ff0ff), glow: hex(0x4ef2ff), swatch: 'radial-gradient(circle at 35% 30%,#fff,#bff7ff 25%,rgba(80,200,255,.5) 60%,#1a6a9a)' },
  { name: { fr: 'OR', en: 'GOLD' }, type: 0, rough: 0.07, base: hex(0xffc85a), glow: hex(0xffd36b), swatch: 'radial-gradient(circle at 35% 30%,#fffbe0,#ffcf5a 35%,#8a5a10 75%,#ffe08a)' },
  { name: { fr: 'PLASMA', en: 'PLASMA' }, type: 2, rough: 0.03, base: hex(0x1a1030), glow: hex(0xff4fd8), swatch: 'radial-gradient(circle at 35% 30%,#ff9ae8,#6a1a8a 40%,#10081a 70%,#ff4fd8)' },
  { name: { fr: 'BONBON', en: 'CANDY' }, type: 3, rough: 0.07, base: hex(0xff3a5a), glow: hex(0xff8a9a), swatch: 'radial-gradient(circle at 35% 30%,#fff,#ff6a80 30%,#c01a3a 75%,#ff8aa0)' },
];

// ---------------------------------------------------------------- world zones
// The world changes every 500 m and the list loops. Each zone owns its sky, fog (haze: its density,
// 1 by default), floor far below, structures, trackside props and a slow "hero" object. Names are never shown.
const ZONE_LEN = 500;
const ZONES = [
  { id: 'tech', skyTop: hex(0x02040c), skyMid: hex(0x0a1a30), horizon: hex(0x1e4a6a), abyss: hex(0x1a6a8a), fog: hex(0x0c2033),
    neb: [hex(0x1a4a8a), hex(0x0e6a8a), hex(0x2a3a7a), hex(0x3aa0c0)], sun: hex(0xcfeeff), sunDir: [-0.35, 0.5, 0.8], stars: 1.0,
    c1: hex(0x4ef2ff), c2: hex(0x2a8aff), dust: hex(0x9fe8ff), drift: [0.3, 0.05], floor: 0, floorA: hex(0x07121c), floorB: hex(0x3ad8ff), shafts: 0.9,
    // by day the city stands under a clear blue sky (its palette above is the night one)
    day: { skyTop: hex(0x1f5fae), skyMid: hex(0x5d9fd8), horizon: hex(0xcde8f4), abyss: hex(0x557fa0), fog: hex(0x86b0cc), haze: 0.45,
      neb: [hex(0xffffff), hex(0xeaf6ff), hex(0xdcecf8), hex(0xfff6ea)], sun: hex(0xfff3dc), stars: 0, dust: hex(0xeaf8ff),
      floorA: hex(0x3c5c74), floorB: hex(0xc8f6ff), shafts: 0.5 } },
  // countryside: a sunny patchwork of fields, cypress rows, wind turbines and hot-air balloons
  { id: 'farm', skyTop: hex(0x1a56b0), skyMid: hex(0x5a98dc), horizon: hex(0xbfdcf0), abyss: hex(0x6a8a58), fog: hex(0x9dbdd0), haze: 0.55,
    neb: [hex(0xffffff), hex(0xfff2dc), hex(0xdfe8f5), hex(0xffe8c8)], sun: hex(0xfff2d8), sunDir: [-0.55, 0.62, -0.55], stars: 0,
    c1: hex(0xffd36b), c2: hex(0xff5a48), dust: hex(0xfffbe0), drift: [0.5, 0.12], floor: 5, floorA: hex(0x5a8a36), floorB: hex(0xd9b85a), shafts: 0.45 },
  { id: 'land', skyTop: hex(0x1a1a40), skyMid: hex(0x5a3a6a), horizon: hex(0xf09a6a), abyss: hex(0xffc8a0), fog: hex(0x7a5a78),
    neb: [hex(0xf0a070), hex(0xd070a0), hex(0x7a6ab0), hex(0xffd0a0)], sun: hex(0xffe2b8), sunDir: [0.45, 0.2, 0.87], stars: 0.25,
    c1: hex(0xffc070), c2: hex(0xff7aa8), dust: hex(0xfff0c0), drift: [0.6, 0.15], floor: 1, floorA: hex(0xe8b8b0), floorB: hex(0xfff0e0), shafts: 1.2 },
  // forest: giant conifers in the morning mist, light shafts and fireflies
  { id: 'forest', skyTop: hex(0x1d4866), skyMid: hex(0x6898ae), horizon: hex(0xe6d4a4), abyss: hex(0x2c4a38), fog: hex(0x6e867e), haze: 0.95,
    neb: [hex(0xf0e4c4), hex(0xc8d8d0), hex(0xa8c0b4), hex(0xfff0d0)], sun: hex(0xffe4b0), sunDir: [-0.4, 0.28, 0.87], stars: 0,
    c1: hex(0xffe98a), c2: hex(0x9dff8a), dust: hex(0xfff2b0), drift: [0.15, 0.08], floor: 6, floorA: hex(0x1d3d22), floorB: hex(0x5f8f3a), shafts: 1.7 },
  { id: 'neon', skyTop: hex(0x05010f), skyMid: hex(0x1a0530), horizon: hex(0xff2a8a), abyss: hex(0x3a0a5a), fog: hex(0x1c0833),
    neb: [hex(0xff2aa0), hex(0x2a4aff), hex(0x8a2aff), hex(0x00e0ff)], sun: hex(0xffc0e8), sunDir: [0.0, 0.14, 1.0], stars: 0.8,
    c1: hex(0xff2ad0), c2: hex(0x2af0ff), dust: hex(0xff8af0), drift: [0.2, 0.1], floor: 2, floorA: hex(0x0a0218), floorB: hex(0xff2ad0), shafts: 0.5 },
  // sea: open water far below, sea stacks, channel beacons, sailboats and lighthouses
  { id: 'sea', skyTop: hex(0x1052a2), skyMid: hex(0x4f9ce2), horizon: hex(0xcbe5f7), abyss: hex(0x1d5d88), fog: hex(0x92bfde), haze: 0.6,
    neb: [hex(0xffffff), hex(0xeef6ff), hex(0xdcebf8), hex(0xfff8ee)], sun: hex(0xfff6e0), sunDir: [0.72, 0.3, 0.62], stars: 0,
    c1: hex(0xff4a3a), c2: hex(0x3aff9a), dust: hex(0xf4fbff), drift: [0.9, 0.06], floor: 7, floorA: hex(0x0c4a78), floorB: hex(0xb8e2fa), shafts: 0.35 },
  // desert: golden dunes, mesas, pyramids, hoodoos and cacti
  { id: 'desert', skyTop: hex(0x28589c), skyMid: hex(0x7ea8d8), horizon: hex(0xeecb94), abyss: hex(0xc88a4c), fog: hex(0xdcb884), haze: 0.7,
    neb: [hex(0xffe8c0), hex(0xffd0a0), hex(0xf8c090), hex(0xffffff)], sun: hex(0xfff0d0), sunDir: [-0.62, 0.32, 0.72], stars: 0,
    c1: hex(0xffb347), c2: hex(0x3ad6c8), dust: hex(0xffe2ae), drift: [1.5, 0.06], floor: 8, floorA: hex(0xc4843f), floorB: hex(0xf4cc8c), shafts: 0.6 },
  { id: 'abstract', skyTop: hex(0x1e1e3c), skyMid: hex(0x6a6aa0), horizon: hex(0xd8c8e8), abyss: hex(0xe8e0ff), fog: hex(0x8a84b0),
    neb: [hex(0xffc0e0), hex(0xc0e0ff), hex(0xe0ffe0), hex(0xfff0c0)], sun: hex(0xffffff), sunDir: [-0.4, 0.6, 0.6], stars: 0.15,
    c1: hex(0xffffff), c2: hex(0xffa0d0), dust: hex(0xffffff), drift: [0.1, 0.2], floor: 3, floorA: hex(0xb8b0d8), floorB: hex(0xffffff), shafts: 1.0 },
  { id: 'chaos', skyTop: hex(0x050000), skyMid: hex(0x200406), horizon: hex(0x8a1a0a), abyss: hex(0xff3a0a), fog: hex(0x2a0806),
    neb: [hex(0xa0200a), hex(0x601010), hex(0xff5a1a), hex(0x401030)], sun: hex(0xff8a5a), sunDir: [0.3, 0.3, 0.9], stars: 0.4,
    c1: hex(0xff3a1a), c2: hex(0xffa020), dust: hex(0xffa050), drift: [0.4, 1.8], floor: 4, floorA: hex(0x120202), floorB: hex(0xff4a10), shafts: 0.3 },
];

// ---------------------------------------------------------------- time of day
// The setting: 'real' follows the local clock, 'day' keeps each world's own sun, 'night' puts a
// moon in its place, 'system' follows the device's dark mode.
const TOD_MODES = ['real', 'day', 'night', 'system'];
const MOON_MONTH = 29.530588853, NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const SOUTH_TZ = /^(Australia|Antarctica)\/|^Pacific\/(Auckland|Chatham|Fiji|Noumea|Tongatapu)|^America\/(Argentina|Santiago|Sao_Paulo|Montevideo|Asuncion)|^Africa\/(Johannesburg|Maputo|Harare|Windhoek|Lusaka|Gaborone)|^Indian\/(Reunion|Mauritius)/;
// Where the sun (or the moon) stands, how dark the night is, how warm a low sun is, and the moon's
// phase. The real clock uses a place at 45° of latitude (south of the equator when the time zone
// says so) without asking for the location. The track heads towards the equator (+z): the sun rises
// on the left and sets on the right, and its path is squeezed towards the front (turn angle and
// height × 0.55) so it shows in the view more often.
function skyState(mode, date = new Date(), dark = false) {
  if (mode === 'system') mode = dark ? 'night' : 'day';
  const age = ((((date.getTime() - NEW_MOON) / 864e5) % MOON_MONTH) + MOON_MONTH) % MOON_MONTH;
  const S = {
    mode, night: mode === 'night' ? 1 : 0, dusk: 0, dir: null, moon: mode === 'night',
    // angle between the sunlight on the moon and the viewer (0 = full moon), kept to a visible crescent
    phase: Math.min(2.4, Math.abs(Math.PI - age / MOON_MONTH * TAU)), side: age < MOON_MONTH / 2 ? 1 : -1,
  };
  if (mode === 'real') {
    let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
    const y = date.getFullYear(), std = Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset());
    const doy = (Date.UTC(y, date.getMonth(), date.getDate()) - Date.UTC(y, 0, 0)) / 864e5, rad = Math.PI / 180, lat = 45 * rad;
    const decl = -23.44 * rad * Math.cos(TAU * (doy + 10) / 365) * (SOUTH_TZ.test(tz) ? -1 : 1);
    const H = (date.getHours() + date.getMinutes() / 60 - (date.getTimezoneOffset() < std ? 1 : 0) - 12) * 15 * rad;   // summer time removed
    const el = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
    const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(H));   // from north, east positive
    const deg = el / rad, n = clamp((2 - deg) / 10, 0, 1);
    S.night = n * n * (3 - 2 * n); S.moon = S.night >= 0.5;
    S.dusk = S.moon ? 0 : clamp(1 - Math.abs(deg - 2) / 14, 0, 1);
    const a = Math.PI + wrapAngle((S.moon ? az : az + Math.PI) - (SOUTH_TZ.test(tz) ? Math.PI : 0)) * 0.55;   // the moon stands opposite the sun
    const e = S.moon ? Math.max(0.2, -el * 0.55) : Math.max(-0.03, el * 0.55);
    S.dir = [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)];
  }
  S.key = [mode, S.moon ? 1 : 0, S.dir ? S.dir.map((v) => Math.round(v * 16)).join(',') : '-', Math.round(S.night * 8), Math.round(S.dusk * 8)].join(':');
  return S;
}
// A world's palette under a time of day. Night dims it to a moonlit blue (worlds that are already
// dark barely change) and swaps sunlight for moonlight; a low sun warms the light and the horizon.
// A dark world with a `day` palette (the city) switches to it as the sun comes up.
// `paint` keeps the original colours for the sky painting, which gets dimmed as a whole instead.
const NIGHT_TINT = [0.12, 0.16, 0.33], MOON_LIGHT = [0.62, 0.72, 1.0], DUSK_SUN = [1.0, 0.56, 0.3];
function skyZone(Z0, S) {
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const dayK = Z0.day ? 1 - S.night : 0, Z = Object.assign({}, Z0);
  if (dayK > 0) for (const key in Z0.day) {
    const a = Z0[key], b = Z0.day[key];
    Z[key] = typeof b === 'number' ? lerp(a === undefined ? 1 : a, b, dayK) : typeof b[0] === 'number' ? mixc(a, b, dayK) : dayK > 0.5 ? b : a;
  }
  const lum = Z.skyMid[0] * 0.2126 + Z.skyMid[1] * 0.7152 + Z.skyMid[2] * 0.0722, zd = clamp((lum - 0.05) / 0.3, 0, 1);
  const k = S.night * zd, dk = S.dusk * (1 - S.night);
  const g = (c, w = 1) => [c[0] * lerp(1, NIGHT_TINT[0], k * w), c[1] * lerp(1, NIGHT_TINT[1], k * w), c[2] * lerp(1, NIGHT_TINT[2], k * w)];
  const moonCol = mixc(Z.sun, MOON_LIGHT, 0.5 + 0.5 * zd).map((v) => v * lerp(0.8, 0.55, zd));
  const sun = S.moon ? mixc(Z.sun, moonCol, S.night) : mixc(Z.sun, DUSK_SUN, dk * 0.75);
  const sunDir = S.dir || Z.sunDir;
  return Object.assign({}, Z, {
    sunDir, moon: S.moon, sun, stars: Math.max(Z.stars, S.night * 0.5), shafts: Z.shafts * (1 - 0.7 * k), dayK,
    skyTop: g(Z.skyTop), skyMid: g(Z.skyMid), horizon: g(mixc(Z.horizon, [1, 0.62, 0.4], dk * 0.35)), abyss: g(Z.abyss), fog: g(Z.fog),
    floorA: g(Z.floorA), floorB: g(Z.floorB, 0.85), dust: g(Z.dust, 0.5),
    paint: Object.assign({}, Z, { sunDir, moon: S.moon, nightK: k, dusk: dk, dayK }),
  });
}

// ---------------------------------------------------------------- i18n
const I18N = {
  fr: {
    play: 'JOUER', music: 'MUSIQUE', sfx: 'EFFETS', options: 'OPTIONS', done: 'OK', control: 'CONTRÔLE',
    tod: 'MOMENT DE LA JOURNÉE', todReal: 'TEMPS RÉEL', todDay: 'JOUR', todNight: 'NUIT', todSystem: 'SYSTÈME',
    modeRandom: 'ENTRAÎNEMENT', modeDaily: 'DÉFI DU JOUR', infoRandom: 'Parcours sans fin · vous repartez du dernier checkpoint', infoContinue: 'Reprise au checkpoint {d} m', newTrack: '↻ RÉINITIALISER LE PARCOURS', infoDaily: 'Même parcours pour tous · {date}',
    track: 'PISTE', ball: 'BILLE', pause: 'PAUSE', resume: 'REPRENDRE', recal: 'RECALIBRER LE GYROSCOPE', mainMenu: 'MENU PRINCIPAL',
    gameOver: 'GAME OVER', newRecord: 'NOUVEAU RECORD', retry: 'REJOUER', menu: 'MENU',
    share: 'PARTAGER MON SCORE', shareBusy: 'PRÉPARATION DE LA VIDÉO…', shareSaved: 'VIDÉO ENREGISTRÉE ✓', shareReady: 'PARTAGER LA VIDÉO ▶', shareImg: 'PARTAGER MON SCORE',
    shareText: 'J’ai roulé {d} m sur GYROLL (score {s}) ! Tu fais mieux ?', shareDaily: 'Défi du jour {date}',
    calib: 'CALIBRATION', calibSub: 'Tenez le téléphone dans une position naturelle', ready: 'PRÊT ?',
    touchHint: 'Glissez le doigt pour guider la bille', camHint: 'Glissez pour tourner la caméra · pincez pour zoomer', keysHint: 'Flèches / WASD / ZQSD · ou glisser à la souris',
    permDenied: 'Accès au gyroscope refusé — contrôle tactile activé.', permNone: 'Gyroscope indisponible — contrôle tactile activé.',
    ctrlTilt: 'GYROSCOPE', ctrlTouch: 'TACTILE', ctrlKeys: 'CLAVIER', record: 'NOUVEAU RECORD !', dailyTag: 'DÉFI DU JOUR · {date}', randomTag: 'ENTRAÎNEMENT',
    kid: 'MODE ENFANT · RAILS LATÉRAUX', kidInfo: 'Des petits rails rattrapent la bille sur les côtés', kidBadge: '🛡 Réalisé avec les rails latéraux', kidShare: 'avec les rails latéraux', kidTag: 'RAILS', tooFast: 'TROP VITE !',
    star: 'STAR POWER', starGo: 'LEVEZ D’UN COUP ↑', starGoTouch: 'TAPEZ 2 FOIS', starGoKeys: 'ESPACE', starReady: 'STAR POWER PRÊT !',
    starOn: '★ STAR POWER ★', starActive: '★ SCORE ×2', starEnd: 'FIN DU STAR POWER', combo: 'PIÈCES ×{n}', comboLost: 'SÉRIE PERDUE',
    install: 'INSTALLER L’APPLI', iosInstall: 'Touchez Partager ⎋ puis « Sur l’écran d’accueil ».',
    noGL: 'WebGL est indisponible sur cet appareil / navigateur. Activez l’accélération matérielle ou essayez un Chrome / Safari récent.',
    about: 'À PROPOS', close: 'Fermer', aboutKicker: 'L’HISTOIRE', statLines: 'LIGNES DE CODE', statSize: 'Ko · UN SEUL index.html', statLibs: 'BIBLIOTHÈQUE',
    aboutLead: 'Une course de bille sans fin, que l’on guide en inclinant son téléphone. La piste flotte dans le vide, tourne, se rétrécit et s’effondre derrière vous. Jusqu’où irez-vous ?',
    aboutP1: 'GYROLL est né le 25 septembre 2026 d’un seul long prompt, écrit en français : un jeu 3D complet dans un unique fichier HTML, sans bibliothèque ni fichier externe. Erwann Robin l’a ensuite façonné, prompt après prompt, avec Claude Code : neuf mondes, le défi du jour, le star power, le mode enfant, des billes miroirs, le soleil et la lune.',
    aboutP2: 'Tout tient dans ce seul fichier : HTML, CSS, JavaScript, shaders GLSL, musique et sons créés à la volée. La piste, les mondes et les ciels sont générés par le code, et le jeu marche hors ligne.',
    linkRepo: 'Code source sur GitHub', linkX: 'Suivre @diwann', aboutFoot: 'Open source · licence MIT',
  },
  en: {
    play: 'PLAY', music: 'MUSIC', sfx: 'SFX', options: 'OPTIONS', done: 'DONE', control: 'CONTROLS',
    tod: 'TIME OF DAY', todReal: 'REAL TIME', todDay: 'DAY', todNight: 'NIGHT', todSystem: 'SYSTEM',
    modeRandom: 'TRAINING', modeDaily: 'DAILY RUN', infoRandom: 'Endless track · you restart at the last checkpoint', infoContinue: 'Back at the {d} m checkpoint', newTrack: '↻ RESET TRACK', infoDaily: 'Same track for everyone · {date}',
    track: 'TRACK', ball: 'BALL', pause: 'PAUSE', resume: 'RESUME', recal: 'RECALIBRATE GYROSCOPE', mainMenu: 'MAIN MENU',
    gameOver: 'GAME OVER', newRecord: 'NEW RECORD', retry: 'PLAY AGAIN', menu: 'MENU',
    share: 'SHARE MY SCORE', shareBusy: 'PREPARING VIDEO…', shareSaved: 'VIDEO SAVED ✓', shareReady: 'SHARE THE VIDEO ▶', shareImg: 'SHARE MY SCORE',
    shareText: 'I rolled {d} m in GYROLL (score {s})! Can you beat it?', shareDaily: 'Daily run {date}',
    calib: 'CALIBRATION', calibSub: 'Hold your phone in a natural position', ready: 'READY?',
    touchHint: 'Drag your finger to steer the ball', camHint: 'Drag to turn the camera · pinch to zoom', keysHint: 'Arrows / WASD · or drag with the mouse',
    permDenied: 'Gyroscope access denied — touch control enabled.', permNone: 'Gyroscope unavailable — touch control enabled.',
    ctrlTilt: 'GYROSCOPE', ctrlTouch: 'TOUCH', ctrlKeys: 'KEYBOARD', record: 'NEW RECORD!', dailyTag: 'DAILY RUN · {date}', randomTag: 'TRAINING',
    kid: 'KID MODE · SIDE RAILS', kidInfo: 'Small rails catch the ball on the sides', kidBadge: '🛡 Achieved with side rails on', kidShare: 'with side rails on', kidTag: 'RAILS', tooFast: 'TOO FAST!',
    star: 'STAR POWER', starGo: 'FLICK PHONE UP ↑', starGoTouch: 'DOUBLE-TAP', starGoKeys: 'PRESS SPACE', starReady: 'STAR POWER READY!',
    starOn: '★ STAR POWER ★', starActive: '★ SCORE ×2', starEnd: 'STAR POWER OVER', combo: 'COINS ×{n}', comboLost: 'STREAK LOST',
    install: 'INSTALL THE APP', iosInstall: 'Tap Share ⎋, then “Add to Home Screen”.',
    noGL: 'WebGL is not available on this device / browser. Enable hardware acceleration or try a recent Chrome / Safari.',
    about: 'ABOUT', close: 'Close', aboutKicker: 'THE STORY', statLines: 'LINES OF CODE', statSize: 'KB · ONE index.html', statLibs: 'LIBRARIES',
    aboutLead: 'An endless marble run you steer by tilting your phone. The track floats in the void, twists, narrows and falls apart behind you. How far can you go?',
    aboutP1: 'GYROLL started on 25 September 2026 with one long prompt, written in French: a complete 3D game in a single HTML file, with no libraries and no assets. Erwann Robin then shaped it prompt after prompt with Claude Code: nine worlds, the daily run, star power, kid mode, mirror-like marbles, the sun and the moon.',
    aboutP2: 'Everything lives in that one file: HTML, CSS, JavaScript, GLSL shaders, and music and sounds made on the fly. The track, the worlds and the skies are generated by code, and the game works offline.',
    linkRepo: 'Source code on GitHub', linkX: 'Follow @diwann', aboutFoot: 'Open source · MIT license',
  },
};
let LANG = 'en';
function detectLang() {
  const saved = Store.get('lang', null);
  if (saved === 'fr' || saved === 'en') return saved;
  const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'en']);
  return String(list[0] || 'en').toLowerCase().startsWith('fr') ? 'fr' : 'en';
}
const tr = (key, vars) => {
  let s = (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
  return s;
};

// ---------------------------------------------------------------- about
// Size of the built index.html, shown on the About screen: scripts/build.mjs writes the numbers.
const BUILD_INFO = { lines: 0, kb: 0 };
const REPO_URL = 'https://github.com/ErwannRobin/gyro';
const X_URL = 'https://x.com/diwann';

// ---------------------------------------------------------------- production URL
// Used in shared scores (text, video end card). "?mode=daily" opens the daily run directly.
const PROD_URL = 'https://gyroll.vercel.app/';
const PROD_HOST = PROD_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');

// ---------------------------------------------------------------- analytics
// Cookieless Vercel Web Analytics, loaded only on the production host and never when
// "Do Not Track" is on. Forks and local copies send nothing.
const Analytics = {
  on: false,
  init() {
    try {
      if (location.hostname !== PROD_HOST || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
      window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
      const s = document.createElement('script'); s.defer = true; s.src = '/_vercel/insights/script.js';
      document.head.appendChild(s);
      this.on = true;
    } catch (e) { this.on = false; }
  },
  event(name, data) { if (this.on) try { window.va('event', { name, data }); } catch (e) { /* ignore */ } },
};

// ---------------------------------------------------------------- daily run
// Same seed for every player on the same UTC day.
const dayKey = () => new Date().toISOString().slice(0, 10);
function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
const dailySeed = (key) => hashStr('gyroll-daily-' + key);
function dayLabel(key) {
  const d = new Date(key + 'T12:00:00Z');
  try { return d.toLocaleDateString(LANG === 'fr' ? 'fr-FR' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }); } catch (e) { return key; }
}

// ---------------------------------------------------------------- tuning
const CFG = {
  DS: 0.5,               // track sample spacing (m)
  CHUNK_ROWS: 64,        // rows per mesh chunk (32 m)
  CAP: 8192,             // ring buffer capacity (samples)
  AHEAD: 230,            // generate this far ahead of the ball (m)
  BEHIND: 70,            // keep this much track behind (m)
  THICK: 0.34,           // plank thickness
  R: 0.42,               // ball radius
  G: 24,                 // gravity
  ACC: 15,               // tilt acceleration at full input
  VMAX: 14,              // reference speed (score/visual tiers)
  VFADE: 13,             // speed at which the forward push is halved (it never reaches 0)
  RAIL_BREAK: 6.5,       // sideways impact (m/s) above which the ball jumps a star power safety rail
  KID_RAIL_BREAK: 9,     // the same for the higher kid mode rails
  VBOOST: 20,            // boost speed
  CHECKPOINT: 250,       // meters between checkpoints
  COIN_POWER: 0.07,      // star gauge gained per coin (× coin multiplier)
  COIN_STEP: 4,          // coins in a row needed for each coin multiplier step
  STAR_TIME: 6.5,        // seconds a full star gauge lasts once triggered
  START_S: 8,            // ball spawn arc length
};
