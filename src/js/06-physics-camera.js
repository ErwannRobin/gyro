
// =====================================================================
// Ball + Physics — world-space rolling sphere constrained to the deck.
// =====================================================================
class Ball {
  constructor() { this.p = [0, 0, 0]; this.v = [0, 0, 0]; this.q = [0, 0, 0, 1]; this.w = [0, 0, 0]; this.reset(); }
  reset() {
    this.p.fill(0); this.v.fill(0); this.q[0] = this.q[1] = this.q[2] = 0; this.q[3] = 1; this.w.fill(0);
    this.grounded = true; this.lost = false; this.s = 0; this.u = 0; this.hint = 0; this.air = 0;
    this.boost = 0; this.hop = 0; this.lastPad = -99; this.speed = 0; this.surfY = 0; this.support = true;
  }
}

class Physics {
  // roll: the track theme's rolling feel (null = hard deck; grass: drag, wobble and tufts)
  constructor(track, ev) { this.T = track; this.ev = ev; this.collapseS = -1e9; this.time = 0; this.tmp = [0, 0, 0, 0]; this.roll = null; }

  supported(L) {
    if (L.out || L.s < this.collapseS) return false;
    return this.T.solidAt(L.i, L.t, L.u) >= 0;
  }

  step(b, ix, iy, camYaw, dt) {
    const T = this.T, R = CFG.R, G = CFG.G;
    this.time += dt;
    if (b.lost) {                                  // free fall into the abyss
      if (b.p[1] < b.surfY - 150) { b.v.fill(0); return; }
      b.v[1] -= G * dt; b.v[0] *= 1 - 0.3 * dt; b.v[2] *= 1 - 0.3 * dt;
      b.p[0] += b.v[0] * dt; b.p[1] += b.v[1] * dt; b.p[2] += b.v[2] * dt;
      Q.integrate(b.q, b.w[0], b.w[1], b.w[2], dt);
      return;
    }
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw), rx = -fz, rz = fx;
    const ax = (rx * ix + fx * iy) * CFG.ACC, az = (rz * ix + fz * iy) * CFG.ACC;
    let L = T.locate(b.p[0], b.p[2], b.hint);
    b.hint = L.i;
    b.boost = Math.max(0, b.boost - dt);
    b.hop = Math.max(0, b.hop - dt);

    if (b.grounded) {
      const k = G * 0.714, tb = Math.tan(L.bank);
      const gA = -k * L.slope, gL = -k * tb;
      // No speed cap: the forward push fades with speed (halved at VFADE) but never stops.
      // Braking and steering keep their full strength.
      let iax = ax, iaz = az;
      const sp0 = Math.hypot(b.v[0], b.v[2]);
      if (sp0 > 0.5) {
        const ux = b.v[0] / sp0, uz = b.v[2] / sp0, along = iax * ux + iaz * uz;
        if (along > 0) { const cut = along * sp0 * sp0 / (CFG.VFADE * CFG.VFADE + sp0 * sp0); iax -= ux * cut; iaz -= uz * cut; }
      }
      b.v[0] += (iax + L.fx * gA + L.rx * gL) * dt;
      b.v[2] += (iaz + L.fz * gA + L.rz * gL) * dt;
      // rolling resistance: stronger when slow (so the ball settles), light at speed; grass adds its own
      const sp = Math.hypot(b.v[0], b.v[2]), Rl = this.roll;
      const damp = 1 - (0.05 + 0.2 * Math.exp(-sp / 6) + (Rl ? Rl.drag * (1 + sp / 12) : 0) + (Math.abs(ix) + Math.abs(iy) < 0.05 && sp < 1.2 ? 1.4 : 0)) * dt;
      b.v[0] *= damp; b.v[2] *= damp;
      if (Rl) {                                      // uneven ground: a sideways push that wanders along the track
        const n = Math.sin(L.s * 1.7 + 1.3) * Math.sin(L.s * 0.63 + 0.4) + 0.5 * Math.sin(L.s * 3.1 + 2);
        const a = Rl.wobble * n * Math.min(1, sp / 8) * dt;
        b.v[0] += L.rx * a; b.v[2] += L.rz * a;
      }
      const py = b.p[1];
      b.p[0] += b.v[0] * dt; b.p[2] += b.v[2] * dt;
      L = T.locate(b.p[0], b.p[2], b.hint); b.hint = L.i;
      this.rails(b, L);
      this.props(b, L);
      if (!b.grounded) { /* jumped a safety rail: the airborne branch takes over */ } else if (this.supported(L)) {
        b.p[1] = T.surfaceY(L, L.u) + R;
        b.v[1] = clamp((b.p[1] - py) / dt, -30, 30);
        const m = L.i & T.mask;
        if ((T.rowF[m] & RF.BOOST) && Math.abs(L.i - b.lastPad) > 8) {
          b.lastPad = L.i;
          // boosters also steady the ball: half of the sideways drift is removed
          const vf = b.v[0] * L.fx + b.v[2] * L.fz, vl = b.v[0] * L.rx + b.v[2] * L.rz;
          const add = Math.max(0, Math.max(CFG.VBOOST, vf + 5) - vf);
          b.v[0] += L.fx * add - L.rx * vl * 0.5; b.v[2] += L.fz * add - L.rz * vl * 0.5; b.boost = 1.3;
          this.ev.boost(b);
        }
      } else {
        b.grounded = false; b.air = 0;
      }
    } else {
      b.air += dt;
      b.v[1] -= G * dt;
      b.p[0] += b.v[0] * dt; b.p[1] += b.v[1] * dt; b.p[2] += b.v[2] * dt;
      L = T.locate(b.p[0], b.p[2], b.hint); b.hint = L.i;
      const sy = T.surfaceY(L, L.u);
      if (b.p[1] - R <= sy + 0.02 && b.v[1] <= 0 && this.supported(L)) {
        const depth = sy - (b.p[1] - R);
        if (depth < R * 1.05) {                      // forgiving: catch the lip if the center is still above it
          b.p[1] = sy + R;
          const imp = -b.v[1];
          if (imp > 5) { b.v[1] = imp * 0.26; } else { b.v[1] = 0; b.grounded = true; }
          this.ev.land(b, imp);
        } else { b.lost = true; this.ev.lost(b, 'side'); }
      } else if (b.p[1] < sy - 1.1) { b.lost = true; this.ev.lost(b, 'fall'); }
      this.rails(b, L);
    }
    // rolling without slipping: w = (n x v) / R
    if (b.grounded) { b.w[0] = b.v[2] / R; b.w[1] = 0; b.w[2] = -b.v[0] / R; }
    Q.integrate(b.q, b.w[0], b.w[1], b.w[2], dt);
    b.s = L.s; b.u = L.u; b.surfY = T.surfaceY(L, L.u);
    b.support = this.supported(L);
    b.speed = Math.hypot(b.v[0], b.v[2]);
    for (let j = 0; j < 3; j++) if (!Number.isFinite(b.p[j]) || !Number.isFinite(b.v[j])) { b.v.fill(0); b.p[j] = fin(b.p[j]); b.lost = true; }
  }

  // Real rails (tall, on some bends) always hold. Safety rails (kid mode, star power) hold
  // moderate bumps only: hit them too hard and the ball jumps over.
  rails(b, L) {
    const T = this.T, m = L.i & T.mask, real = T.rowF[m] & (RF.RAIL_L | RF.RAIL_R);
    const f = real | (this.kid || this.star ? RF.RAIL_L | RF.RAIL_R : 0);
    if (!f || b.p[1] > b.surfY + 1.2) return;
    const hw = L.w / 2 - 0.1, R = CFG.R;
    const n = T.rowN[m]; if (!n) return;
    let side = 0, pen = 0;
    if ((f & RF.RAIL_R) && T.rowBO[m * 3 + n - 1] && L.u + R > hw) { side = 1; pen = L.u + R - hw; }
    if ((f & RF.RAIL_L) && T.rowAO[m * 3] && L.u - R < -hw) { side = -1; pen = -hw - (L.u - R); }
    if (!side || pen > 0.6) return;
    const soft = !(real & (side > 0 ? RF.RAIL_R : RF.RAIL_L));
    if (soft && (b.hop > 0 || !b.grounded)) return;       // already jumping over it
    const nx = -L.rx * side, nz = -L.rz * side;        // normal pointing back to the track
    const vn = b.v[0] * nx + b.v[2] * nz;
    // kid rails are as high as the ball's center: they take a harder hit, and the ball must jump higher to clear them
    const brk = this.kid ? CFG.KID_RAIL_BREAK : CFG.RAIL_BREAK;
    if (soft && -vn > brk) {
      b.hop = 0.6; b.grounded = false; b.air = 0; b.v[1] = (this.kid ? 4.8 : 2) + (-vn - brk) * 0.25;
      this.ev.railJump(b, -vn, [b.p[0] - nx * CFG.R, b.p[1], b.p[2] - nz * CFG.R]);
      return;
    }
    b.p[0] += nx * pen; b.p[2] += nz * pen;
    if (vn < 0) {
      b.v[0] -= nx * vn * 1.38; b.v[2] -= nz * vn * 1.38;
      b.v[0] *= 0.97; b.v[2] *= 0.97;
      if (-vn > 0.8) this.ev.hit(b, -vn, [b.p[0] - nx * CFG.R, b.p[1], b.p[2] - nz * CFG.R]);
    }
  }

  props(b, L) {
    const T = this.T, R = CFG.R, Rl = this.roll;
    for (const o of T.objects) {
      if (Math.abs(o.s - L.s) > 3) continue;
      if (o.kind === 'tuft') {
        if (Rl && o.hit < 0 && Math.abs(o.s - L.s) < 0.6 && Math.abs(o.u - L.u) < 0.6) this.tuft(b, L, o, Rl);
        continue;
      }
      if ((o.kind !== 'post' && o.kind !== 'slider') || o.broken) continue;
      // near miss: the obstacle is behind now, the ball came close and never touched it
      if (o.near !== undefined && !o.nearDone && L.s > o.s + 0.8) { o.nearDone = true; if (!o.touched) this.ev.nearMiss(b, o); }
      let ou = o.u, ovx = 0, ovz = 0;
      if (o.kind === 'slider') {
        const ph = TAU * this.time / o.period + o.phase;
        ou = o.amp * Math.sin(ph);
        const du = o.amp * Math.cos(ph) * TAU / o.period;
        T.pointAt(o.s, 0, 0, this.tmp);
        ovx = -Math.cos(this.tmp[3]) * du; ovz = Math.sin(this.tmp[3]) * du;
      }
      T.pointAt(o.s, ou, 0, this.tmp);
      const dx = b.p[0] - this.tmp[0], dz = b.p[2] - this.tmp[2], d = Math.hypot(dx, dz), min = R + o.rad;
      if (d >= min) { if (d - min < CFG.NEAR && b.speed >= CFG.NEAR_V && !(o.near <= d - min)) o.near = d - min; continue; }
      if (d < 1e-5) continue;
      o.touched = true;
      if (this.star) {                               // star power: the ball smashes through
        o.broken = this.time; b.v[0] *= 0.96; b.v[2] *= 0.96;
        this.ev.smash(b, o, [this.tmp[0], b.p[1], this.tmp[2]]);
        continue;
      }
      const nx = dx / d, nz = dz / d;
      b.p[0] += nx * (min - d); b.p[2] += nz * (min - d);
      const rvx = b.v[0] - ovx, rvz = b.v[2] - ovz, vn = rvx * nx + rvz * nz;
      if (vn < 0) {
        b.v[0] -= nx * vn * 1.5; b.v[2] -= nz * vn * 1.5;
        if (-vn > 0.6) this.ev.hit(b, -vn, [this.tmp[0] + nx * o.rad, b.p[1], this.tmp[2] + nz * o.rad]);
      }
    }
  }

  // A grass tuft slows the ball and kicks it away sideways; with star power the ball mows it flat instead.
  tuft(b, L, o, Rl) {
    o.hit = this.time;
    const sp = Math.hypot(b.v[0], b.v[2]);
    if (this.star) { o.cut = true; this.ev.tuft(b, o, sp, true); return; }
    const sg = Math.sign(L.u - o.u) || (o.id & 1 ? 1 : -1), kick = Math.min(2.2, Rl.tuftKick + sp * 0.06);
    b.v[0] = b.v[0] * Rl.tuftSlow + L.rx * sg * kick; b.v[2] = b.v[2] * Rl.tuftSlow + L.rz * sg * kick;
    this.ev.tuft(b, o, sp, false);
  }
}

// =====================================================================
// CameraRig — smoothed chase cam with anticipation, roll, FOV kick, a push-in for slow motion and a
// light rumble at top speed. Fingers can move it: on the
// menu a drag walks it around the ball and a pinch zooms; in gyroscope play a drag swings it around
// the ball (it eases back behind once the finger lifts) and a pinch sets the chase distance. After
// a fall the camera drops after the ball; on the game over screen the phone turns it around the ball.
// =====================================================================
const ZOOM_PLAY = [0.6, 3], ZOOM_MENU = [0.38, 3.4];   // chase (play) and orbit (menu) distance factor ranges
class CameraRig {
  constructor() {
    this.pos = [0, 3, -6]; this.look = [0, 0, 0]; this.yaw = 0; this.roll = 0; this.fov = 1.2;
    this.shake = 0; this.kick = 0; this.focus = 0; this.rush = 0; this.mode = 'orbit'; this.t = 0; this.prevYaw = 0; this.yawRate = 0;
    this.eye = [0, 0, 0]; this.tgt = [0, 0, 0]; this.tmp = [0, 0, 0, 0];
    this.gyroLook = null;                           // menu look-around from the phone: { yaw, pitch }
    this.orbA = null; this.orbH = 2.3;
    this.zoom = 1; this.zoomM = 1;                 // chase distance factor (play) and orbit distance factor (menu)
    this.offYaw = 0; this.offPitch = 0; this.held = false; this.relT = 9;   // play look-around
    this.mYaw = 0; this.mH = 0; this.swingK = 1;   // menu: drag offsets; the slow automatic swing stops once dragged
    this.fb = [0, 0, 0]; this.fYaw = 0; this.fPitch = 0;   // fall: where the camera would be, and the phone's turn around the ball
    this.endView = false; this.lookUp = 0;                  // fall: the game over screen is up (the camera settles near the ball)
  }
  fall() { this.mode = 'fall'; for (let j = 0; j < 3; j++) this.fb[j] = this.pos[j]; this.fYaw = this.fPitch = this.lookUp = 0; this.endView = false; }
  menuDrag(dx, dy) {
    if (this.swingK > 0 && !this.gyroLook) {       // keep the view where the swing had taken it
      this.mYaw += Math.sin(this.t * 0.13) * 0.95 * this.swingK; this.mH += Math.sin(this.t * 0.21) * 0.6 * this.swingK;
    }
    this.swingK = 0;
    this.mYaw -= dx * 0.007; this.mH = clamp(this.mH + dy * 0.018, -2, 8.7);
  }
  lookDrag(dx, dy) {
    this.offYaw = clamp(this.offYaw - dx * 0.007, -Math.PI, Math.PI); this.offPitch = clamp(this.offPitch + dy * 0.006, -0.45, 1.1);
    this.relT = 0;
  }
  zoomBy(f, menu) {
    const Z = menu ? ZOOM_MENU : ZOOM_PLAY;
    if (menu) this.zoomM = clamp(this.zoomM * f, Z[0], Z[1]);
    else this.zoom = clamp(this.zoom * f, Z[0], Z[1]);
  }
  params(aspect, speed) {
    const portrait = aspect < 0.9;
    speed = Math.min(speed, 24);                  // past ~86 km/h, speed lines and blur carry the feeling
    return {
      dist: (portrait ? 5.7 : 5.2) + speed * 0.1,
      height: (portrait ? 3.0 : 2.5) + speed * 0.04,
      fov: ((portrait ? 72 : 56) + speed * 0.75) * Math.PI / 180,
    };
  }
  snap(ball, T, aspect) {
    T.pointAt(ball.s + 3, 0, 0, this.tmp);
    this.yaw = this.tmp[3]; this.prevYaw = this.yaw; this.roll = 0;
    const P = this.params(aspect, 0), fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    this.pos[0] = ball.p[0] - fx * P.dist; this.pos[1] = ball.p[1] + P.height; this.pos[2] = ball.p[2] - fz * P.dist;
    this.look[0] = ball.p[0] + fx * 3; this.look[1] = ball.p[1]; this.look[2] = ball.p[2] + fz * 3;
    this.fov = P.fov;
  }
  update(dt, ball, T, aspect) {
    this.t += dt;
    const sp = ball.speed, P = this.params(aspect, sp);
    if (this.mode === 'follow') {
      T.pointAt(ball.s + 1, 0, 0, this.tmp); const thB = this.tmp[3];
      T.pointAt(ball.s + 4 + sp * 0.4, 0, 0, this.tmp); const thA = this.tmp[3];
      let ty = thB + wrapAngle(thA - thB) * 0.65;
      const vd = wrapAngle(Math.atan2(ball.v[0], ball.v[2]) - ty);
      if (sp > 3 && Math.abs(vd) < 1.1) ty += vd * clamp((sp - 3) / 20, 0, 0.22);   // ignore when rolling backwards
      this.yaw += wrapAngle(ty - this.yaw) * damp(3.4, dt);
      const yr = wrapAngle(this.yaw - this.prevYaw) / Math.max(dt, 1e-4); this.prevYaw = this.yaw;
      this.yawRate = lerp(this.yawRate, yr, damp(6, dt));
      this.roll = lerp(this.roll, clamp(-this.yawRate * 0.09 * (0.4 + sp / 14), -0.16, 0.16), damp(4, dt));
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      if (this.held) this.relT = 0; else if ((this.relT += dt) > 0.8) { const k = damp(2.4, dt); this.offYaw -= this.offYaw * k; this.offPitch -= this.offPitch * k; }
      const D = Math.hypot(P.dist, P.height) * this.zoom, e = clamp(Math.atan2(P.height, P.dist) + this.offPitch, 0.05, 1.35), a = this.yaw + this.offYaw;
      const tx = ball.p[0] - Math.sin(a) * Math.cos(e) * D, ty2 = ball.p[1] + Math.sin(e) * D, tz = ball.p[2] - Math.cos(a) * Math.cos(e) * D;
      const kxz = damp(7.5, dt), ky = damp(4.2, dt);
      this.pos[0] = lerp(this.pos[0], tx, kxz); this.pos[2] = lerp(this.pos[2], tz, kxz); this.pos[1] = lerp(this.pos[1], ty2, ky);
      // look down the track; the further the camera swings away, the more it looks at the ball itself
      const la = 3 + sp * 0.28, lk = clamp(Math.abs(this.offYaw) / 0.9 + Math.abs(this.offPitch) / 1.1, 0, 1);
      const lx = ball.p[0] + fx * la * (1 - lk), ly = ball.p[1] + 0.2, lz = ball.p[2] + fz * la * (1 - lk);
      const kl = damp(10, dt);
      this.look[0] = lerp(this.look[0], lx, kl); this.look[1] = lerp(this.look[1], ly, kl); this.look[2] = lerp(this.look[2], lz, kl);
      this.fov = lerp(this.fov, P.fov + this.kick * 0.16 - this.focus * 0.13, damp(this.focus > 0.05 ? 6 : 3, dt));
    } else if (this.mode === 'fall') {
      const B = this.fb, L = this.gyroLook, kg = damp(5, dt);
      if (!this.endView) B[1] = lerp(B[1], Math.max(ball.p[1] + 3.5, B[1] - 40), damp(1.1, dt));
      else {                                        // game over screen: settle a few meters away, a little above the ball
        let dx = B[0] - ball.p[0], dz = B[2] - ball.p[2], hr = Math.hypot(dx, dz);
        if (hr < 0.5) { dx = -Math.sin(this.yaw); dz = -Math.cos(this.yaw); hr = 1; }
        const k = damp(1.4, dt), h = lerp(Math.hypot(B[0] - ball.p[0], B[2] - ball.p[2]), 6.5, k);
        B[0] = ball.p[0] + dx / hr * h; B[2] = ball.p[2] + dz / hr * h; B[1] = lerp(B[1], ball.p[1] + 2, k);
      }
      // turning the phone walks the camera around the ball, tilting it raises or lowers it (as on the menu)
      this.fYaw = lerp(this.fYaw, L ? -L.yaw : 0, kg); this.fPitch = lerp(this.fPitch, L ? -L.pitch : 0, kg);
      const dx = B[0] - ball.p[0], dy = B[1] - ball.p[1], dz = B[2] - ball.p[2], hr = Math.hypot(dx, dz), D = Math.hypot(hr, dy);
      const a = Math.atan2(dx, dz) + this.fYaw, e = clamp(Math.atan2(dy, hr) + this.fPitch, -0.25, 1.5);
      this.pos[0] = ball.p[0] + Math.sin(a) * Math.cos(e) * D; this.pos[1] = ball.p[1] + Math.sin(e) * D; this.pos[2] = ball.p[2] + Math.cos(a) * Math.cos(e) * D;
      // on the game over screen the view looks above the ball: the ball sits low, under the result
      const kl = damp(6, dt);
      this.lookUp = lerp(this.lookUp, this.endView ? (aspect < 0.9 ? 3.7 : 1.8) : 0, damp(1.4, dt));
      for (let j = 0; j < 3; j++) this.look[j] = lerp(this.look[j], ball.p[j] + (j === 1 ? this.lookUp : 0), kl);
      this.roll = lerp(this.roll, 0, damp(2, dt));
      this.fov = lerp(this.fov, P.fov * 0.8, damp(1.5, dt));
    } else {                                          // attract mode: slow swing behind the ball, looking down the track
      T.pointAt(ball.s + 2, 0, 0, this.tmp);
      // with the phone's motion, turning / tilting it walks the camera around the ball instead
      const th = this.tmp[3], L = this.gyroLook, zm = this.zoomM, r = 6.4 * zm, sw = this.swingK, fast = L || this.held;
      const ta = th + Math.PI + (L ? -L.yaw : Math.sin(this.t * 0.13) * 0.95 * sw) + this.mYaw;
      const th2 = clamp((L ? clamp(2.3 - L.pitch * 7, 0.5, 11) : 2.3 + Math.sin(this.t * 0.21) * 0.6 * sw) + this.mH, 0.3, 11);
      if (this.orbA === null) this.orbA = ta;
      this.orbA += wrapAngle(ta - this.orbA) * damp(fast ? 6 : 1.6, dt); this.orbH = lerp(this.orbH, th2, damp(fast ? 5 : 1.6, dt));
      const a = this.orbA, tx = ball.p[0] + Math.sin(a) * r, tz = ball.p[2] + Math.cos(a) * r;
      const k = damp(fast ? 8 : 1.6, dt);
      this.pos[0] = lerp(this.pos[0], tx, k); this.pos[1] = lerp(this.pos[1], ball.p[1] + this.orbH * zm, k); this.pos[2] = lerp(this.pos[2], tz, k);
      const vd = L || !sw ? a + Math.PI : th, lo = L || !sw ? clamp(this.orbH - 2.3, -2, 6) * 0.5 : 0;   // look past the ball, the way the camera faces
      const lx = ball.p[0] + Math.sin(vd) * 5 * zm, ly = ball.p[1] + (1.7 - lo) * zm, lz = ball.p[2] + Math.cos(vd) * 5 * zm;
      this.look[0] = lerp(this.look[0], lx, k); this.look[1] = lerp(this.look[1], ly, k); this.look[2] = lerp(this.look[2], lz, k);
      this.yaw = th; this.prevYaw = th;
      this.roll = lerp(this.roll, Math.sin(this.t * 0.13) * 0.06, k); this.fov = lerp(this.fov, P.fov, k);
    }
    this.kick = Math.max(0, this.kick - dt * 1.5);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    const sh = this.shake * this.shake * 0.35 + (this.mode === 'follow' ? this.rush * 0.022 : 0);
    const n = (f) => Math.sin(this.t * f) * Math.sin(this.t * f * 1.37 + 1.3);
    this.eye[0] = this.pos[0] + n(41) * sh; this.eye[1] = this.pos[1] + n(37) * sh; this.eye[2] = this.pos[2] + n(45) * sh;
    this.tgt[0] = this.look[0]; this.tgt[1] = this.look[1]; this.tgt[2] = this.look[2];
    for (let j = 0; j < 3; j++) { this.eye[j] = fin(this.eye[j]); this.tgt[j] = fin(this.tgt[j], this.eye[j] + (j === 2 ? 1 : 0)); }
  }
}
