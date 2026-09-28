import { test, expect } from '@playwright/test';
import { openGame, teleport } from './helpers.js';

const ZONES_N = 9;

test('all nine worlds render without WebGL errors and with few draw calls', async ({ page }) => {
  const errors = await openGame(page);
  await page.evaluate(() => { const g = window.__game; g.halt = true; for (let i = 0; i < ZONES.length; i++) g.R.ensureZone(i); g.startRun('keys'); });
  for (let z = 0; z < ZONES_N; z++) {
    const d = 120 + z * 500;
    await page.evaluate(teleport, d);
    const r = await page.evaluate(() => {
      const g = window.__game, gl = g.R.gl; let calls = 0, probeCalls = 0;
      const wrap = (o, k) => { const f = o[k].bind(o); o[k] = (...a) => { calls++; return f(...a); }; return () => { o[k] = f; }; };
      for (let k = 0; k < 20; k++) g.tick(1 / 60, false);
      g.render();                                               // first frame fills all six probe faces
      const undo = [wrap(gl, 'drawElements'), wrap(gl, 'drawArrays')];
      if (g.R.inst) undo.push(wrap(g.R.inst, 'drawElementsInstancedANGLE'));
      const rp = g.renderProbe; g.renderProbe = function (lit) { const c0 = calls; rp.call(this, lit); probeCalls = calls - c0; };
      g.render();
      g.renderProbe = rp; undo.forEach((u) => u());
      return { err: gl.getError(), calls: calls - probeCalls, probeCalls, faces: g.quality.cur.faces, ready: g.R.probeReady, zone: g.zoneIdx, inst: !!g.R.inst };
    });
    expect(r.err).toBe(0);
    expect(r.zone).toBe(z);
    expect(r.ready).toBe(true);
    if (r.inst) { expect(r.calls).toBeLessThan(60); expect(r.probeCalls / r.faces).toBeLessThan(30); }
  }
  // after the last world the list starts again
  await page.evaluate(teleport, 120 + ZONES_N * 500);
  expect(await page.evaluate(() => { const g = window.__game; for (let k = 0; k < 5; k++) g.tick(1 / 60, false); return [ZONES.length, g.zoneIdx, zoneAt(g.ball.s)]; })).toEqual([ZONES_N, 0, 0]);
  expect(errors).toEqual([]);
});

test('share builds a video of the run from the rendered pictures', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(async () => {
    const g = window.__game, R = g.replay;
    g.halt = true;                                              // the test drives the frames; keep the live loop out of the timing
    for (let k = 0; k < 10; k++) { g.tick(1 / 30, true); R.capture(g.canvas, 0.5, 10 * k, 10, k > 7); await new Promise((res) => setTimeout(res, 80)); }
    const info = { dist: 123, score: 4567, best: 200, record: true, recordTxt: 'NEW RECORD', tag: '', accent: '#4ef2ff', accent2: '#ff4fd8' };
    const f = await R.make(info, { speed: 'fast', fmt: 'wide', res: 480 }, () => {});
    return f && { type: f.type, size: f.size, name: f.name, pics: R.all().length };
  });
  expect(r).not.toBeNull();
  expect(r.pics).toBe(10);
  expect(r.type).toMatch(/^video\/(mp4|webm)$/);
  expect(r.name).toMatch(/^gyroll-123m\.(mp4|webm)$/);
  expect(r.size).toBeGreaterThan(10000);
});

// The ball's reflection cube map must match what a camera sees in every direction: sampling the
// probe along each view ray has to give back the sky drawn directly (a mirrored face would not).
test('the reflection probe is oriented like the real world', async ({ page }) => {
  await openGame(page);
  const r = await page.evaluate(() => {
    const g = window.__game, R = g.R, gl = R.gl; g.halt = true;
    const eye = [0, 5, 0], W = 96;
    R.makeProbe(128);
    for (let f = 0; f < 6; f++) R.probeFace(eye, f, 1);
    R.endProbe(6);
    const P = R.program(VS_SKY, GLSL_COMMON + `varying vec2 v_p; uniform mat4 u_invVP; uniform samplerCube u_c; uniform float u_flip;
      void main(){ vec4 a = u_invVP * vec4(v_p, -1.0, 1.0); vec4 b = u_invVP * vec4(v_p, 1.0, 1.0);
      vec3 d = normalize(b.xyz / b.w - a.xyz / a.w); d.x *= u_flip; gl_FragColor = vec4(textureCube(u_c, d).rgb, 1.0); }`, ['a_pos']);
    const shot = (draw) => { draw(); const px = new Uint8Array(W * W * 4); gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, px); return px; };
    const out = [];
    for (const dir of [[1, 0.2, 0.3], [-0.4, -0.3, -1], [0.2, 0.9, 0.1], [-1, 0.1, 0.5]]) {
      R.setCamera(eye, [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]], 0, 1.2, 0.1, 1000);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, W);
      M4.perspective(R.proj, 1.2, 1, 0.1, 1000); M4.mul(R.vp, R.proj, R.view); M4.invert(R.invVP, R.vp);
      const sky = shot(() => R.drawSky(1, false));
      const cube = (flip) => shot(() => {
        R.cur = null; gl.useProgram(P.p); gl.uniformMatrix4fv(P.u('u_invVP'), false, R.invVP); gl.uniform1f(P.u('u_flip'), flip);
        gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_CUBE_MAP, R.probe.tex); gl.uniform1i(P.u('u_c'), 4); gl.activeTexture(gl.TEXTURE0);
        gl.bindBuffer(gl.ARRAY_BUFFER, R.triBuf); R.attribs(1); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0); gl.disable(gl.DEPTH_TEST);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      });
      const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) d += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); return d / (a.length / 4) / 3; };
      out.push({ same: diff(sky, cube(1)), mirrored: diff(sky, cube(-1)) });
    }
    return { out, err: gl.getError() };
  });
  expect(r.err).toBe(0);
  for (const o of r.out) {
    expect(o.same).toBeLessThan(4);                             // mean error in 0–255 units
    expect(o.mirrored).toBeGreaterThan(o.same * 2);
  }
});
