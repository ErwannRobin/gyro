
// =====================================================================
// Renderer — WebGL1 forward renderer with optional bloom post chain.
// =====================================================================
class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    const opts = { alpha: false, antialias: false, depth: true, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' };
    const gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.post = true; this.bloomDiv = 4;
    this.w = 1; this.h = 1;
    this.vp = M4.create(); this.invVP = M4.create(); this.view = M4.create(); this.proj = M4.create();
    this.ident = M4.create(); this.tmpM = M4.create();
    this.cam = [0, 0, 0]; this.camF = [0, 0, 1];
    this.theme = null;
    this.zA = 0; this.zB = 0; this.zMix = 0; this.flash = 0;
    this.Z = { fog: [0, 0, 0], abyss: [0, 0, 0], skyMid: [0, 0, 0], sun: [1, 1, 1], stars: 1, dust: [1, 1, 1], c1: [1, 1, 1], c2: [1, 1, 1],
      floorA: [0, 0, 0], floorB: [1, 1, 1], shafts: 1, drift: [0, 0] };
    this.sunDir = new Float32Array([0, 1, 0]);
    this.initGL();
  }

  initGL() {
    const gl = this.gl;
    // Instanced drawing batches repeated scenery into a few draw calls (WebGL1 extension,
    // needs 10 vertex attributes); otherwise every object is drawn on its own.
    const ext = window.GYROLL_NO_INSTANCING ? null : gl.getExtension('ANGLE_instanced_arrays');
    this.inst = ext && gl.getParameter(gl.MAX_VERTEX_ATTRIBS) >= 10 ? ext : null;
    const litAttrs = ['a_pos', 'a_nrm', 'a_uv', 'a_aux', 'a_mat'];
    this.pLit = this.inst ? this.program('#define INST\n' + VS_LIT, FS_LIT, litAttrs.concat(['a_m0', 'a_m1', 'a_m2', 'a_m3', 'a_ic'])) : this.program(VS_LIT, FS_LIT, litAttrs);
    if (this.inst) for (let i = 5; i < 10; i++) this.inst.vertexAttribDivisorANGLE(i, 1);
    this.instBuf = gl.createBuffer(); this.batches = new Map(); this.drawCalls = 0;
    this.pBall = this.program(VS_BALL, FS_BALL, ['a_pos', 'a_nrm']);
    this.pSky = this.program(VS_SKY, FS_SKY, ['a_pos']);
    this.pPts = this.program(VS_PTS, FS_PTS, ['a_pos', 'a_col', 'a_size']);
    this.pFx = this.program(VS_FX, FS_FX, ['a_pos', 'a_uv', 'a_col']);
    this.pBright = this.program(VS_POST, FS_BRIGHT, ['a_pos']);
    this.pBlur = this.program(VS_POST, FS_BLUR, ['a_pos']);
    this.pComp = this.program(VS_POST, FS_COMPOSITE, ['a_pos']);
    this.pFloor = this.program(VS_FLOOR, FS_FLOOR, ['a_pos']);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.triBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.meshes = {
      ball: this.upload(Prims.sphere(40, 28)), gem: this.upload(Prims.gem()), post: this.upload(Prims.cylinder(18, 9)),
      slider: this.upload(Prims.box(8)), gate: this.upload(Prims.gate()), mono: this.upload(Prims.box(11)),
      ring: this.upload(Prims.torus(1, 0.035, 64, 6)), cube: this.upload(Prims.box(3)),
      tower: this.upload(Prims.box(13)), pyramid: this.upload(Prims.pyramid()),
      rocks: [1, 2, 3].map((k) => this.upload(Prims.rock(k * 17))), shards: [1, 2, 3].map((k) => this.upload(Prims.shard(k * 29))),
      sphere: this.upload(Prims.withMat(Prims.sphere(22, 14), 16)), box16: this.upload(Prims.box(16)), box17: this.upload(Prims.box(17)),
      glow: this.upload(Prims.box(18)), ringGlow: this.upload(Prims.torus(1, 0.05, 56, 6, 18)), torus16: this.upload(Prims.torus(1, 0.22, 40, 12, 16)),
      ring17: this.upload(Prims.torus(1, 0.08, 40, 6, 17)),
    };
    this.dynBuf = gl.createBuffer();
    this.ptsBuf = gl.createBuffer();
    this.starBuf = null;
    this.zoneTex = [];
    this.fbo = null;
    this.enabled = 0;
    this.makeStars();
  }

  program(vsSrc, fsSrc, attribs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vsSrc)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fsSrc));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('Link: ' + gl.getProgramInfoLog(p));
    const cache = {};
    return { p, u: (n) => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
  }
  use(pr) { if (this.cur !== pr) { this.gl.useProgram(pr.p); this.cur = pr; } return pr; }
  attribs(n) {
    const gl = this.gl;
    for (let i = 0; i < 10; i++) {
      const want = i < n, has = (this.enabled >> i) & 1;
      if (want && !has) gl.enableVertexAttribArray(i); else if (!want && has) gl.disableVertexAttribArray(i);
    }
    this.enabled = (1 << n) - 1;
  }

  upload(mb) {
    const gl = this.gl;
    const vbo = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, mb.v.subarray(0, mb.nv * VSTRIDE), gl.STATIC_DRAW);
    const ibo = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mb.idx.subarray(0, mb.ni), gl.STATIC_DRAW);
    return { vbo, ibo, count: mb.ni };
  }
  free(mesh) { if (!mesh) return; this.gl.deleteBuffer(mesh.vbo); this.gl.deleteBuffer(mesh.ibo); mesh.count = 0; }
  bindMesh(mesh, n) {
    const gl = this.gl, S = VSTRIDE * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.vbo); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.ibo);
    this.attribs(n);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, S, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, S, 12);
    if (n > 2) {
      gl.vertexAttribPointer(2, 2, gl.FLOAT, false, S, 24);
      gl.vertexAttribPointer(3, 4, gl.FLOAT, false, S, 32);
      gl.vertexAttribPointer(4, 4, gl.FLOAT, false, S, 48);
    }
  }

  makeTex(src, repeat) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  setTheme(theme) { this.theme = theme; }
  makeStars() {
    const gl = this.gl, r = RNG(1234), N = 900, d = new Float32Array(N * 8);
    for (let k = 0; k < N; k++) {
      let x, y, z, l;
      do { x = r.range(-1, 1); y = r.range(-0.35, 1); z = r.range(-1, 1); l = Math.hypot(x, y, z); } while (l < 0.1 || l > 1);
      const R = 700 / l, tint = r.next();
      d.set([x * R, y * R, z * R, lerp(0.75, 1, tint), lerp(0.85, 0.95, tint), 1, r.range(0.25, 0.95), r.range(1.5, 4.5)], k * 8);
    }
    this.starBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuf); gl.bufferData(gl.ARRAY_BUFFER, d, gl.STATIC_DRAW);
    this.starCount = N;
  }
  // Zone panoramas are built lazily (one per call) so start-up stays fast.
  ensureZone(i) {
    if (this.zoneTex[i]) return false;
    const c = makeSkyCanvases(ZONES[i], 11 + i * 7);
    this.zoneTex[i] = { sky: this.makeTex(c.sky, true), mid: this.makeTex(c.mid, true), blur: this.makeTex(c.blur, true) };
    return true;
  }
  // Blend zone a → b by k: palette uniforms + which panoramas to sample.
  setZones(a, b, k) {
    this.ensureZone(a); if (k > 0) this.ensureZone(b);
    this.zA = a; this.zB = k > 0 ? b : a; this.zMix = k > 0 ? k : 0;
    const A = ZONES[a], B = ZONES[this.zB], Z = this.Z, m = this.zMix;
    const mixv = (o, x, y) => { o[0] = lerp(x[0], y[0], m); o[1] = lerp(x[1], y[1], m); o[2] = lerp(x[2], y[2], m); };
    for (const key of ['fog', 'abyss', 'skyMid', 'sun', 'dust', 'c1', 'c2', 'floorA', 'floorB']) mixv(Z[key], A[key], B[key]);
    Z.stars = lerp(A.stars, B.stars, m); Z.shafts = lerp(A.shafts, B.shafts, m);
    Z.drift[0] = lerp(A.drift[0], B.drift[0], m); Z.drift[1] = lerp(A.drift[1], B.drift[1], m);
    const na = Math.hypot(...A.sunDir), nb = Math.hypot(...B.sunDir);
    const x = lerp(A.sunDir[0] / na, B.sunDir[0] / nb, m), y = lerp(A.sunDir[1] / na, B.sunDir[1] / nb, m), z = lerp(A.sunDir[2] / na, B.sunDir[2] / nb, m);
    const l = Math.hypot(x, y, z) || 1;
    this.sunDir[0] = x / l; this.sunDir[1] = y / l; this.sunDir[2] = z / l;
  }
  bindZoneTex(p, key, uA, uB, unitA, unitB) {
    const gl = this.gl, A = this.zoneTex[this.zA], B = this.zoneTex[this.zB] || A;
    gl.activeTexture(gl.TEXTURE0 + unitA); gl.bindTexture(gl.TEXTURE_2D, A[key]); gl.uniform1i(p.u(uA), unitA);
    gl.activeTexture(gl.TEXTURE0 + unitB); gl.bindTexture(gl.TEXTURE_2D, B[key]); gl.uniform1i(p.u(uB), unitB);
    gl.activeTexture(gl.TEXTURE0);
  }

  // ------------------------------------------------------------- framebuffers
  resize(cssW, cssH, scale) {
    const w = Math.max(2, Math.round(cssW * scale)), h = Math.max(2, Math.round(cssH * scale));
    if (w === this.w && h === this.h && !!this.fbo === this.post) return;
    this.w = w; this.h = h; this.cv.width = w; this.cv.height = h;
    this.freeFBO();
    if (this.post) this.makeFBOs();
  }
  freeFBO() {
    const gl = this.gl;
    if (!this.fbo) return;
    for (const f of [this.fbo, this.fbA, this.fbB]) { gl.deleteFramebuffer(f.fb); gl.deleteTexture(f.tex); if (f.rb) gl.deleteRenderbuffer(f.rb); }
    this.fbo = this.fbA = this.fbB = null;
  }
  makeFB(w, h, depth) {
    const gl = this.gl;
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    let rb = null;
    if (depth) {
      rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    }
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, rb, w, h, ok };
  }
  makeFBOs() {
    this.fbo = this.makeFB(this.w, this.h, true);
    const bw = Math.max(2, Math.round(this.w / this.bloomDiv)), bh = Math.max(2, Math.round(this.h / this.bloomDiv));
    this.fbA = this.makeFB(bw, bh, false); this.fbB = this.makeFB(bw, bh, false);
    if (!this.fbo.ok || !this.fbA.ok || !this.fbB.ok) { this.freeFBO(); this.post = false; }
  }

  // ------------------------------------------------------------- frame
  setCamera(eye, target, roll, fovY, near, far) {
    const aspect = this.w / this.h;
    M4.perspective(this.proj, fovY, aspect, near, far);
    M4.lookAt(this.view, eye, target, [0, 1, 0], roll);
    M4.mul(this.vp, this.proj, this.view);
    M4.invert(this.invVP, this.vp);
    this.cam[0] = eye[0]; this.cam[1] = eye[1]; this.cam[2] = eye[2];
    const fx = target[0] - eye[0], fy = target[1] - eye[1], fz = target[2] - eye[2], l = Math.hypot(fx, fy, fz) || 1;
    this.camF[0] = fx / l; this.camF[1] = fy / l; this.camF[2] = fz / l;
  }

  begin(time) {
    const gl = this.gl;
    this.time = time; this.cur = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.post && this.fbo ? this.fbo.fb : null);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // sky
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const Z = this.Z, p = this.use(this.pSky);
    gl.uniformMatrix4fv(p.u('u_invVP'), false, this.invVP);
    gl.uniform3fv(p.u('u_sunDir'), this.sunDir); gl.uniform3fv(p.u('u_sunCol'), Z.sun);
    gl.uniform1f(p.u('u_time'), time % 100); gl.uniform1f(p.u('u_mix'), this.zMix); gl.uniform1f(p.u('u_flash'), this.flash);
    this.bindZoneTex(p, 'sky', 'u_env', 'u_env2', 0, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf); this.attribs(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // stars (at infinity, additive)
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const q = this.use(this.pPts);
    gl.uniformMatrix4fv(q.u('u_vp'), false, this.vp); gl.uniform3fv(q.u('u_off'), this.cam);
    gl.uniform1f(q.u('u_px'), this.h); gl.uniform1f(q.u('u_persp'), 0); gl.uniform1f(q.u('u_time'), time % 1000); gl.uniform1f(q.u('u_k'), Z.stars);
    this.bindPts(this.starBuf);
    gl.drawArrays(gl.POINTS, 0, this.starCount);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL);
  }
  drawFloor(y, time) {
    const gl = this.gl, Z = this.Z, A = ZONES[this.zA], B = ZONES[this.zB], p = this.use(this.pFloor);
    gl.uniformMatrix4fv(p.u('u_vp'), false, this.vp); gl.uniform3fv(p.u('u_cam'), this.cam); gl.uniform1f(p.u('u_y'), y);
    gl.uniform1f(p.u('u_time'), time % 1000); gl.uniform1f(p.u('u_stA'), A.floor); gl.uniform1f(p.u('u_stB'), B.floor); gl.uniform1f(p.u('u_mix'), this.zMix);
    gl.uniform3fv(p.u('u_aA'), A.floorA); gl.uniform3fv(p.u('u_bA'), A.floorB); gl.uniform3fv(p.u('u_aB'), B.floorA); gl.uniform3fv(p.u('u_bB'), B.floorB);
    gl.uniform3fv(p.u('u_fogCol'), Z.fog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf); this.attribs(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  bindPts(buf) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf); this.attribs(3);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 32, 28);
  }

  // Shared lit-shader uniforms for this frame.
  litSetup(o) {
    const gl = this.gl, T = this.theme, Z = this.Z, p = this.use(this.pLit);
    gl.uniformMatrix4fv(p.u('u_vp'), false, this.vp);
    gl.uniform3fv(p.u('u_cam'), this.cam); gl.uniform3fv(p.u('u_sunDir'), this.sunDir); gl.uniform3fv(p.u('u_sunCol'), Z.sun);
    gl.uniform3fv(p.u('u_fogCol'), Z.fog); gl.uniform3fv(p.u('u_abyss'), Z.abyss); gl.uniform3fv(p.u('u_skyMid'), Z.skyMid);
    gl.uniform3fv(p.u('u_deckA'), T.deckA); gl.uniform3fv(p.u('u_deckB'), T.deckB); gl.uniform3fv(p.u('u_trim'), T.trim);
    gl.uniform3fv(p.u('u_under'), T.under); gl.uniform3fv(p.u('u_metal'), T.metal);
    gl.uniform3fv(p.u('u_accent'), T.accent); gl.uniform3fv(p.u('u_accent2'), T.accent2); gl.uniform3fv(p.u('u_hazard'), T.hazard);
    gl.uniform1f(p.u('u_pattern'), T.pattern); gl.uniform1f(p.u('u_gloss'), T.gloss);
    gl.uniform1f(p.u('u_time'), o.time % 1000); gl.uniform1f(p.u('u_fogDen'), o.fogDen); gl.uniform1f(p.u('u_fogBase'), o.fogBase);
    gl.uniform4fv(p.u('u_ball'), o.ball); gl.uniform3fv(p.u('u_ballGlow'), o.ballGlow);
    gl.uniform1f(p.u('u_ballLight'), o.ballLight); gl.uniform1f(p.u('u_shadow'), o.shadow);
    gl.uniform1f(p.u('u_collapse'), o.collapse);
    gl.uniform3fv(p.u('u_color'), [1, 1, 1]); gl.uniform1f(p.u('u_emis'), 1); gl.uniform1f(p.u('u_fogK'), 1);
    this.setInstConst(this.ident, [1, 1, 1], 1);
    this.bindZoneTex(p, 'blur', 'u_env', 'u_env2', 0, 1); gl.uniform1f(p.u('u_envMix'), this.zMix);
    gl.uniformMatrix4fv(p.u('u_model'), false, this.ident);
  }
  // Culls chunks behind the camera or beyond fog range.
  drawChunk(ch) {
    const dx = ch.cx - this.cam[0], dy = ch.cy - this.cam[1], dz = ch.cz - this.cam[2];
    const d = dx * this.camF[0] + dy * this.camF[1] + dz * this.camF[2];
    if (d < -ch.rad || Math.hypot(dx, dy, dz) - ch.rad > 330) return;
    this.bindMesh(ch.mesh, 5);
    this.gl.drawElements(this.gl.TRIANGLES, ch.mesh.count, this.gl.UNSIGNED_SHORT, 0);
  }
  // With instancing on, a single object uses constant attribute values (arrays 5–9 disabled).
  setInstConst(m, c, e) {
    if (!this.inst) return;
    const gl = this.gl;
    gl.vertexAttrib4f(5, m[0], m[1], m[2], m[3]); gl.vertexAttrib4f(6, m[4], m[5], m[6], m[7]);
    gl.vertexAttrib4f(7, m[8], m[9], m[10], m[11]); gl.vertexAttrib4f(8, m[12], m[13], m[14], m[15]);
    gl.vertexAttrib4f(9, c[0], c[1], c[2], e);
  }
  drawProp(mesh, model, color, emis) {
    const gl = this.gl, p = this.pLit;
    if (this.inst) this.setInstConst(model, color, emis);
    else { gl.uniformMatrix4fv(p.u('u_model'), false, model); gl.uniform3fv(p.u('u_color'), color); gl.uniform1f(p.u('u_emis'), emis); }
    this.bindMesh(mesh, 5);
    gl.drawElements(gl.TRIANGLES, mesh.count, gl.UNSIGNED_SHORT, 0);
  }
  // Queue one instance of `mesh`; flushBatches() draws each mesh's queue at once.
  addInst(mesh, model, color, emis) {
    let b = this.batches.get(mesh);
    if (!b) { b = { mesh, data: new Float32Array(20 * 32), n: 0 }; this.batches.set(mesh, b); }
    if ((b.n + 1) * 20 > b.data.length) { const d = new Float32Array(b.data.length * 2); d.set(b.data); b.data = d; }
    const o = b.n * 20, d = b.data;
    d.set(model, o); d[o + 16] = color[0]; d[o + 17] = color[1]; d[o + 18] = color[2]; d[o + 19] = emis;
    b.n++;
  }
  flushBatches() {
    const gl = this.gl, p = this.pLit;
    for (const b of this.batches.values()) {
      if (!b.n) continue;
      if (this.inst) {
        this.bindMesh(b.mesh, 5);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
        gl.bufferData(gl.ARRAY_BUFFER, b.data.subarray(0, b.n * 20), gl.DYNAMIC_DRAW);
        for (let i = 0; i < 5; i++) gl.vertexAttribPointer(5 + i, 4, gl.FLOAT, false, 80, i * 16);
        this.attribs(10);
        this.inst.drawElementsInstancedANGLE(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_SHORT, 0, b.n);
        this.attribs(5);
      } else {
        this.bindMesh(b.mesh, 5);
        for (let k = 0; k < b.n; k++) {
          const o = k * 20;
          gl.uniformMatrix4fv(p.u('u_model'), false, b.data.subarray(o, o + 16));
          gl.uniform3f(p.u('u_color'), b.data[o + 16], b.data[o + 17], b.data[o + 18]); gl.uniform1f(p.u('u_emis'), b.data[o + 19]);
          gl.drawElements(gl.TRIANGLES, b.mesh.count, gl.UNSIGNED_SHORT, 0);
        }
      }
      b.n = 0;
    }
  }
  setFogK(k) { this.gl.uniform1f(this.pLit.u('u_fogK'), k); }
  endLit() {
    this.flushBatches();
    if (this.inst) this.setInstConst(this.ident, [1, 1, 1], 1);
    else this.gl.uniformMatrix4fv(this.pLit.u('u_model'), false, this.ident);
  }

  drawBall(model, skin, speed, fade) {
    const gl = this.gl, T = this.theme, p = this.use(this.pBall);
    gl.uniformMatrix4fv(p.u('u_vp'), false, this.vp); gl.uniformMatrix4fv(p.u('u_model'), false, model);
    const Z = this.Z;
    gl.uniform3fv(p.u('u_cam'), this.cam); gl.uniform3fv(p.u('u_sunDir'), this.sunDir); gl.uniform3fv(p.u('u_sunCol'), Z.sun);
    gl.uniform3fv(p.u('u_floor'), T.deckA); gl.uniform3fv(p.u('u_accent'), T.accent); gl.uniform3fv(p.u('u_skyMid'), Z.skyMid); gl.uniform3fv(p.u('u_abyss'), Z.abyss);
    gl.uniform3fv(p.u('u_base'), skin.base); gl.uniform3fv(p.u('u_glowCol'), skin.glow); gl.uniform1f(p.u('u_type'), skin.type);
    gl.uniform1f(p.u('u_time'), this.time % 1000); gl.uniform1f(p.u('u_speed'), speed); gl.uniform1f(p.u('u_fade'), fade);
    this.bindZoneTex(p, 'mid', 'u_env', 'u_env2', 0, 1); this.bindZoneTex(p, 'blur', 'u_envBlur', 'u_envBlur2', 2, 3);
    gl.uniform1f(p.u('u_envMix'), this.zMix);
    this.bindMesh(this.meshes.ball, 2);
    gl.drawElements(gl.TRIANGLES, this.meshes.ball.count, gl.UNSIGNED_SHORT, 0);
  }

  beginAdditive() { const gl = this.gl; gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); }
  drawFx(data, nverts) {
    if (nverts <= 0) return;
    const gl = this.gl, p = this.use(this.pFx);
    gl.uniformMatrix4fv(p.u('u_vp'), false, this.vp);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, nverts * 10), gl.DYNAMIC_DRAW);
    this.attribs(3);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 40, 0); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 40, 12); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 40, 24);
    gl.drawArrays(gl.TRIANGLES, 0, nverts);
  }
  drawPoints(data, n) {
    if (n <= 0) return;
    const gl = this.gl, p = this.use(this.pPts);
    gl.uniformMatrix4fv(p.u('u_vp'), false, this.vp); gl.uniform3fv(p.u('u_off'), [0, 0, 0]);
    gl.uniform1f(p.u('u_px'), this.h * 0.9); gl.uniform1f(p.u('u_persp'), 1); gl.uniform1f(p.u('u_k'), 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ptsBuf); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 8), gl.DYNAMIC_DRAW);
    this.bindPts(this.ptsBuf);
    gl.drawArrays(gl.POINTS, 0, n);
  }
  endAdditive() { const gl = this.gl; gl.disable(gl.BLEND); gl.depthMask(true); }

  finish(o) {
    if (!this.post || !this.fbo) return;
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.triBuf); this.attribs(1);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    const pass = (fb, prog, tex, setup) => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb ? fb.fb : null);
      gl.viewport(0, 0, fb ? fb.w : this.w, fb ? fb.h : this.h);
      const p = this.use(prog);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(p.u('u_tex'), 0);
      setup(p);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    const A = this.fbA, B = this.fbB;
    pass(A, this.pBright, this.fbo.tex, (p) => gl.uniform2f(p.u('u_px'), this.bloomDiv / 2 / this.w, this.bloomDiv / 2 / this.h));
    pass(B, this.pBlur, A.tex, (p) => gl.uniform2f(p.u('u_dir'), 1.4 / A.w, 0));
    pass(A, this.pBlur, B.tex, (p) => gl.uniform2f(p.u('u_dir'), 0, 1.4 / A.h));
    pass(B, this.pBlur, A.tex, (p) => gl.uniform2f(p.u('u_dir'), 2.6 / A.w, 0));
    pass(A, this.pBlur, B.tex, (p) => gl.uniform2f(p.u('u_dir'), 0, 2.6 / A.h));
    pass(null, this.pComp, this.fbo.tex, (p) => {
      gl.uniform1i(p.u('u_scene'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, A.tex); gl.uniform1i(p.u('u_bloom'), 1); gl.activeTexture(gl.TEXTURE0);
      gl.uniform1f(p.u('u_bloomK'), o.bloom); gl.uniform1f(p.u('u_blur'), o.blur); gl.uniform1f(p.u('u_ca'), o.ca);
      gl.uniform1f(p.u('u_time'), this.time % 100); gl.uniform2f(p.u('u_center'), o.cx, o.cy);
    });
  }
}
