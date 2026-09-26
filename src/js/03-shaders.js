
// =====================================================================
// Shaders (GLSL ES 1.0 / WebGL1 for maximum device coverage)
// =====================================================================
const GLSL_COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ return noise(p)*0.55 + noise(p*2.07+3.1)*0.28 + noise(p*4.3+7.7)*0.17; }
float bit(float f, float b){ return mod(floor(f / b + 0.001), 2.0); }
vec2 equirect(vec3 d){ return vec2(atan(d.x, d.z) * 0.15915494 + 0.5, acos(clamp(d.y, -1.0, 1.0)) * 0.31830989); }
`;

// Lit surfaces: track chunks + props. Materials selected by a_mat.x
const VS_LIT = `
attribute vec3 a_pos; attribute vec3 a_nrm; attribute vec2 a_uv; attribute vec4 a_aux; attribute vec4 a_mat;
#ifdef INST
attribute vec4 a_m0; attribute vec4 a_m1; attribute vec4 a_m2; attribute vec4 a_m3; attribute vec4 a_ic;
#else
uniform mat4 u_model; uniform vec3 u_color; uniform float u_emis;
#endif
uniform mat4 u_vp; uniform float u_collapse; uniform float u_time;
varying vec3 v_wp; varying vec3 v_n; varying vec2 v_uv; varying vec4 v_aux; varying vec4 v_mat; varying float v_warn; varying vec4 v_ic;
void main(){
#ifdef INST
  mat4 model = mat4(a_m0, a_m1, a_m2, a_m3); v_ic = a_ic;      // per-instance transform + color/emissive
#else
  mat4 model = u_model; v_ic = vec4(u_color, u_emis);
#endif
  vec4 wp = model * vec4(a_pos, 1.0);
  vec3 n = (model * vec4(a_nrm, 0.0)).xyz;
  float dt = u_collapse - a_aux.x;          // seconds-ish since this row started falling
  v_warn = 0.0;
  if (dt > -3.0 && a_aux.x < 1e8) {
    if (dt > 0.0) {
      float t = dt * 0.2;
      float sd = a_aux.y - 0.5;
      wp.y -= 9.0 * t * t + t * 1.5;
      wp.x += sd * t * 3.0; wp.z += sd * t * 2.0;
      float a = sd * t * 2.5; float c = cos(a), s = sin(a);
      n = vec3(n.x * c - n.y * s, n.x * s + n.y * c, n.z);
      v_warn = 1.0;
    } else {
      float k = 1.0 + dt / 3.0;
      wp.y += sin(u_time * 47.0 + a_aux.y * 40.0) * 0.018 * k * k;
      v_warn = k * k;
    }
  }
  v_wp = wp.xyz; v_n = n; v_uv = a_uv; v_aux = a_aux; v_mat = a_mat;
  gl_Position = u_vp * wp;
}`;

const FS_LIT = GLSL_COMMON + `
varying vec3 v_wp; varying vec3 v_n; varying vec2 v_uv; varying vec4 v_aux; varying vec4 v_mat; varying float v_warn; varying vec4 v_ic;
uniform vec3 u_cam; uniform vec3 u_sunDir; uniform vec3 u_sunCol; uniform vec3 u_fogCol; uniform vec3 u_abyss; uniform vec3 u_skyMid;
uniform vec3 u_deckA; uniform vec3 u_deckB; uniform vec3 u_trim; uniform vec3 u_under; uniform vec3 u_metal;
uniform vec3 u_accent; uniform vec3 u_accent2; uniform vec3 u_hazard;
uniform float u_pattern; uniform float u_gloss; uniform float u_time; uniform float u_fogDen; uniform float u_fogBase;
uniform vec4 u_ball; uniform vec3 u_ballGlow; uniform float u_ballLight; uniform float u_shadow;
uniform float u_fogK;
uniform sampler2D u_env; uniform sampler2D u_env2; uniform float u_envMix;

vec3 envLookup(vec3 d){ vec2 q = equirect(d); return mix(texture2D(u_env, q).rgb, texture2D(u_env2, q).rgb, u_envMix); }

vec3 deck(vec2 uv, float seed, out float gloss){
  vec3 c; gloss = u_gloss;
  if (u_pattern < 0.5) {            // carbon twill
    vec2 q = uv * 7.0; float tw = step(0.5, fract((floor(q.x) + floor(q.y)) * 0.5));
    float fib = sin((tw > 0.5 ? q.x : q.y) * 18.85) * 0.5 + 0.5;
    c = mix(u_deckB, u_deckA, tw * 0.6 + fib * 0.4);
    gloss *= 0.8 + 0.2 * fib;
  } else if (u_pattern < 1.5) {     // brushed metal plates
    float st = noise(vec2(uv.x * 0.7, uv.y * 90.0)) * 0.6 + noise(vec2(uv.x * 3.0, uv.y * 260.0)) * 0.4;
    float plate = hash(vec2(floor(uv.x * 0.5), floor(uv.y * 1.2 + 10.0)));
    c = mix(u_deckB, u_deckA, st * 0.7 + plate * 0.3);
  } else if (u_pattern < 2.5) {     // wood boards
    float board = floor(uv.y * 2.6 + 20.0);
    float off = hash(vec2(board, 3.0)) * 7.0;
    float plank = floor((uv.x + off) / 3.0);
    float h = hash(vec2(board, plank));
    float grain = fbm(vec2((uv.x + off) * 0.9, uv.y * 14.0 + h * 9.0));
    float rings = sin(grain * 18.0 + uv.y * 30.0) * 0.5 + 0.5;
    c = mix(u_deckB, u_deckA, 0.35 + h * 0.4 + rings * 0.25);
    float seam = smoothstep(0.035, 0.0, abs(fract(uv.y * 2.6) - 0.0)) + smoothstep(0.96, 1.0, fract(uv.y * 2.6));
    float seam2 = smoothstep(0.02, 0.0, abs(fract((uv.x + off) / 3.0) - 0.0) * 3.0);
    c *= 1.0 - 0.55 * clamp(seam + seam2, 0.0, 1.0);
  } else {                           // marble
    float f = fbm(uv * vec2(0.35, 0.8) + seed * 0.1);
    float vein = pow(1.0 - abs(sin((uv.x * 0.45 + uv.y * 1.2 + f * 5.0) * 1.7)), 14.0);
    float vein2 = pow(1.0 - abs(sin((uv.x * 0.9 - uv.y * 0.6 + f * 7.0) * 2.3)), 22.0);
    c = mix(u_deckA, u_deckB, clamp(vein * 0.8 + vein2 * 0.5 + f * 0.25, 0.0, 1.0));
  }
  return c;
}

void main(){
  vec3 N = normalize(v_n + vec3(0.0, 1e-5, 0.0));
  vec3 V = normalize(u_cam - v_wp);
  float mat = v_mat.x, flags = v_mat.y, halfW = v_mat.z;
  vec3 base = u_metal; float gloss = 0.4; float spec = 0.5; vec3 emis = vec3(0.0); float glow = 0.0; float metal = 0.3;

  if (mat < 0.5) {                                   // deck top
    float s = v_uv.x, u = v_uv.y;
    base = deck(v_uv, v_aux.y, gloss); spec = 0.6;
    float seamD = abs(fract(s * 0.5) - 0.5) * 2.0;    // plank joints every 2 m
    float jt = smoothstep(0.012, 0.0, abs(seamD - 1.0) * 1.0) ;
    base *= 1.0 - 0.6 * smoothstep(0.985, 1.0, seamD);
    float dEdge = halfW - abs(u);
    // trim band along outer edges
    float band = smoothstep(0.2, 0.18, dEdge);
    base = mix(base, u_trim * 0.8, band * 0.75);
    // rivets
    vec2 rv = vec2(fract(s) - 0.5, dEdge - 0.1);
    float rr = length(rv);
    float riv = smoothstep(0.038, 0.028, rr) * step(dEdge, 0.2);
    base = mix(base, u_trim * 1.25 + 0.15, riv); spec += riv * 2.0;
    // center guide dashes (subtle, give speed feeling)
    float dash = step(0.55, fract(s * 0.5)) * smoothstep(0.03, 0.015, abs(u));
    emis += u_accent * dash * 0.55; glow += dash * 0.35;
    // edge light line
    float el = smoothstep(0.05, 0.0, abs(dEdge - 0.21));
    emis += u_accent * el * 0.9; glow += el * 0.6;
    // hazard stripes near hole edges / gap edges
    float hz = 0.0;
    if (bit(flags, 1.0) > 0.5) hz = max(hz, smoothstep(0.26, 0.24, u - v_aux.z));
    if (bit(flags, 2.0) > 0.5) hz = max(hz, smoothstep(0.26, 0.24, v_aux.w - u));
    float rowT = (s - v_aux.x) / 0.5;
    if (bit(flags, 4.0) > 0.5) hz = max(hz, smoothstep(0.62, 0.55, rowT));
    if (bit(flags, 8.0) > 0.5) hz = max(hz, smoothstep(0.38, 0.45, rowT));
    if (hz > 0.0) {
      float str = step(0.5, fract((s + u) * 2.2));
      base = mix(base, mix(vec3(0.03), u_hazard, str), hz);
      emis += u_hazard * hz * str * 0.25;
    }
    // booster chevrons
    if (bit(flags, 16.0) > 0.5) {
      float ch = fract(s * 0.9 - abs(u) * 0.7 - u_time * 2.6);
      float c1 = smoothstep(0.0, 0.08, ch) * smoothstep(0.5, 0.36, ch);
      float lane = smoothstep(halfW - 0.18, halfW - 0.3, abs(u));
      base = mix(base, base * 0.3, lane);
      emis += u_accent2 * c1 * lane * 2.2; glow += c1 * lane * 1.2;
    }
    if (bit(flags, 32.0) > 0.5) {                    // checkpoint line
      float cl = smoothstep(0.2, 0.0, abs(fract(s * 0.5 + 0.5) - 0.5) - 0.02);
      emis += mix(u_accent, vec3(1.0), 0.4) * 1.3; glow += 0.9;
    }
    if (bit(flags, 64.0) > 0.5) {                    // start checkers
      float ck = mod(floor(s * 3.0) + floor(u * 3.0 + 30.0), 2.0);
      base = mix(vec3(0.05), vec3(0.92), ck);
    }
  } else if (mat < 1.5) {                             // outer side wall with light strip
    float v = v_uv.y;
    base = u_trim * 0.4; gloss = 0.45; spec = 0.5; metal = 0.8;
    float strip = smoothstep(0.1, 0.03, abs(v - 0.42));
    float pulse = 0.55 + 0.45 * sin(v_uv.x * 0.8 - u_time * 5.0);
    emis += u_accent * strip * (0.6 + 0.9 * pulse); glow += strip * pulse;
    base *= 1.0 - 0.4 * smoothstep(0.7, 0.72, v);
    float vent = step(0.8, v) * step(0.5, fract(v_uv.x * 5.0));
    base *= 1.0 - 0.3 * vent;
  } else if (mat < 2.5) {                             // underside panels
    base = u_under; gloss = 0.2; spec = 0.2;
    float g = max(smoothstep(0.03, 0.0, abs(fract(v_uv.x * 0.5) - 0.5) - 0.47), smoothstep(0.03, 0.0, abs(fract(v_uv.y * 0.8) - 0.5) - 0.47));
    base *= 1.0 - 0.5 * g;
  } else if (mat < 3.5) {                             // mechanical parts
    base = u_metal; gloss = 0.55; spec = 1.0; metal = 0.9;
    base *= 0.8 + 0.3 * noise(v_uv * vec2(6.0, 18.0));
  } else if (mat < 4.5) {                             // accent light
    float bl = 0.65 + 0.35 * sin(u_time * 3.0 + v_aux.y * 20.0);
    base = u_accent * 0.2; emis = u_accent * (1.4 * v_mat.w) * bl; glow = 1.0 * bl;
  } else if (mat < 5.5) {                             // rails (chrome)
    base = mix(u_trim, vec3(0.9), 0.5); gloss = 0.95; spec = 2.0; metal = 1.0;
  } else if (mat < 6.5) {                             // raised rim
    base = u_trim; gloss = 0.8; spec = 1.6; metal = 0.9;
  } else if (mat < 7.5) {                             // accent2 light
    base = u_accent2 * 0.2; emis = u_accent2 * 1.5 * v_mat.w; glow = 1.0;
  } else if (mat < 8.5) {                             // hazard striped prop (sliders)
    float str = step(0.5, fract((v_uv.x + v_uv.y) * 4.0));
    base = mix(vec3(0.05), u_hazard, str); gloss = 0.7; spec = 1.2;
    emis += u_hazard * str * 0.15;
  } else if (mat < 9.5) {                             // generic prop colored by uniform
    base = v_ic.rgb; gloss = 0.75; spec = 1.4; metal = 0.7;
    float band = smoothstep(0.04, 0.0, abs(v_uv.y - 0.82) - 0.05);
    emis += u_accent * band * 1.6; glow += band;
  } else if (mat < 10.5) {                            // gem
    base = v_ic.rgb * 0.55; gloss = 0.9; spec = 1.6; metal = 0.5;
    float facet = abs(dot(N, normalize(vec3(0.3, 0.8, 0.5))));
    emis = v_ic.rgb * (0.28 + 0.35 * facet + 0.12 * sin(u_time * 5.0 + v_wp.x)) * v_ic.a; glow = 0.7;
  } else if (mat < 11.5) {                            // gate / monolith frame lights
    float e = max(smoothstep(0.1, 0.0, min(v_uv.x, 1.0 - v_uv.x)), smoothstep(0.1, 0.0, min(v_uv.y, 1.0 - v_uv.y)));
    base = u_metal * 0.5; gloss = 0.6; spec = 1.0;
    emis = v_ic.rgb * e * 1.8 * v_ic.a; glow = e * v_ic.a;
  } else if (mat < 12.5) {                            // hole walls / caps: dark + hazard glow line
    base = u_under * 0.7; gloss = 0.2; spec = 0.3;
    float top = smoothstep(0.16, 0.02, v_uv.y);
    emis += u_hazard * top * 1.1; glow += top * 0.8;
  } else if (mat < 13.5) {                            // tower with lit windows
    base = vec3(0.05, 0.06, 0.08); gloss = 0.5; spec = 0.6; metal = 0.6;
    vec2 w = v_uv * vec2(7.0, 44.0);
    vec2 f = fract(w);
    float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.25, f.y) * step(f.y, 0.75);
    float on = step(0.55, hash(floor(w) + floor(v_wp.xz * 0.01)));
    float band = smoothstep(0.03, 0.0, abs(fract(v_uv.y * 3.0) - 0.5) - 0.47);
    emis = v_ic.rgb * (win * on * 0.9 + band * 1.2) * v_ic.a; glow = win * on * 0.5 + band;
  } else if (mat < 14.5) {                            // floating rock / island with grass top
    float grass = smoothstep(0.55, 0.8, N.y);
    float n = noise(v_wp.xz * 0.8 + v_wp.y);
    base = mix(v_ic.rgb * (0.45 + 0.25 * n), vec3(0.3, 0.52, 0.22) * (0.8 + 0.3 * n), grass); gloss = 0.1; spec = 0.15; metal = 0.0;
  } else if (mat < 15.5) {                            // neon wire triangles
    float e = min(min(1.0 - v_uv.x, v_uv.x - v_uv.y), v_uv.y);
    float ln = smoothstep(0.05, 0.0, e);
    base = vec3(0.02); gloss = 0.8; spec = 0.8;
    emis = v_ic.rgb * (ln * 2.2 + 0.06) * v_ic.a; glow = ln;
  } else if (mat < 16.5) {                            // glossy abstract primitives
    base = v_ic.rgb; gloss = 0.95; spec = 2.0; metal = 0.55;
    emis = v_ic.rgb * 0.08 * v_ic.a;
  } else if (mat < 17.5) {                            // chaos shard with glowing cracks
    base = vec3(0.07, 0.04, 0.04); gloss = 0.7; spec = 1.2; metal = 0.6;
    float c = abs(noise(v_wp.xz * 1.7 + v_wp.y * 1.3) * 2.0 - 1.0);
    float crack = smoothstep(0.1, 0.0, c) * (0.7 + 0.3 * sin(u_time * 6.0 + v_wp.y));
    emis = v_ic.rgb * crack * 2.0 * v_ic.a; glow = crack;
  } else {                                            // solid glow
    base = vec3(0.0); gloss = 0.0; spec = 0.0;
    emis = v_ic.rgb * v_ic.a; glow = clamp(v_ic.a * 0.8, 0.0, 1.0);
  }

  // collapse warning tint
  if (v_warn > 0.0) { emis += vec3(1.0, 0.12, 0.2) * v_warn * 0.8 * (0.6 + 0.4 * sin(u_time * 20.0)); glow += v_warn * 0.5; }

  // ---- lighting
  vec3 L = u_sunDir;
  float ndl = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float sp = pow(max(dot(N, H), 0.0), mix(16.0, 180.0, gloss)) * spec;
  vec3 amb = mix(u_abyss * 0.35, u_skyMid * 0.9 + 0.08, N.y * 0.5 + 0.5);
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
  vec3 R = reflect(-V, N);
  vec3 env = envLookup(R);
  vec3 col = base * (amb * 0.75 + u_sunCol * ndl * 0.95) * (1.0 - metal * 0.45);
  col += env * (mix(0.04, 0.55, metal) * gloss + fres * gloss * 0.6) * mix(vec3(1.0), base * 1.6 + 0.2, metal * 0.6);
  col += u_sunCol * sp;

  // ball: contact shadow + light spill
  vec3 d = v_wp - u_ball.xyz;
  float hgt = max(0.0, -d.y);
  if (N.y > 0.3) {
    float r = u_ball.w * (1.05 + hgt * 0.25);
    float sh = smoothstep(r * 1.25, r * 0.15, length(d.xz)) * u_shadow * clamp(1.4 - hgt * 0.35, 0.0, 1.0);
    col *= 1.0 - sh * 0.72;
  }
  float bd = length(d);
  col += u_ballGlow * (u_ballLight / (1.0 + bd * bd * 1.8)) * max(dot(N, -d / max(bd, 0.001)), 0.0);

  col += emis;
  // ---- fog (distance + abyss haze)
  float dist = length(v_wp - u_cam);
  float fog = 1.0 - exp(-dist * u_fogDen);
  float below = clamp((u_fogBase - v_wp.y) * 0.009, 0.0, 1.0);
  fog = clamp((fog + below * 0.7) * u_fogK, 0.0, 1.0);
  vec3 fc = mix(u_fogCol, u_abyss * 0.8, below);
  col = mix(col, fc, fog);
  gl_FragColor = vec4(col, clamp(glow * (1.0 - fog), 0.0, 1.0));
}`;

// Ball: env reflections, fresnel, dynamic highlight, several material types.
const VS_BALL = `
attribute vec3 a_pos; attribute vec3 a_nrm;
uniform mat4 u_vp; uniform mat4 u_model;
varying vec3 v_wp; varying vec3 v_n; varying vec3 v_on;
void main(){ vec4 wp = u_model * vec4(a_pos, 1.0); v_wp = wp.xyz; v_n = normalize((u_model * vec4(a_nrm, 0.0)).xyz); v_on = a_nrm; gl_Position = u_vp * wp; }`;

const FS_BALL = GLSL_COMMON + `
varying vec3 v_wp; varying vec3 v_n; varying vec3 v_on;
uniform vec3 u_cam; uniform vec3 u_sunDir; uniform vec3 u_sunCol; uniform vec3 u_floor; uniform vec3 u_accent; uniform vec3 u_skyMid; uniform vec3 u_abyss;
uniform vec3 u_base; uniform vec3 u_glowCol; uniform float u_type; uniform float u_time; uniform float u_speed; uniform float u_fade;
uniform sampler2D u_env; uniform sampler2D u_envBlur; uniform sampler2D u_env2; uniform sampler2D u_envBlur2; uniform float u_envMix;
vec3 env(vec3 d){ vec2 q = equirect(d); return mix(texture2D(u_env, q).rgb, texture2D(u_env2, q).rgb, u_envMix); }
vec3 envB(vec3 d){ vec2 q = equirect(d); return mix(texture2D(u_envBlur, q).rgb, texture2D(u_envBlur2, q).rgb, u_envMix); }
vec3 world(vec3 R, bool blur){
  vec3 e = blur ? envB(R) : env(R);
  // lower hemisphere reflects the track deck and its light strips
  float fl = smoothstep(0.02, -0.3, R.y);
  float stripes = smoothstep(0.92, 1.0, abs(sin(atan(R.x, R.z) * 3.0)));
  vec3 flo = u_floor * (0.35 + 0.4 * max(-R.y, 0.0)) + u_accent * stripes * 0.35 * smoothstep(-0.1, -0.35, R.y);
  return mix(e, flo, fl * 0.9);
}
void main(){
  vec3 N = normalize(v_n), V = normalize(u_cam - v_wp), R = reflect(-V, N);
  vec3 o = normalize(v_on);
  float ndv = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 3.0);
  vec3 L = u_sunDir;
  float spec = pow(max(dot(R, L), 0.0), 220.0) * 5.0 + pow(max(dot(R, L), 0.0), 24.0) * 0.35;
  vec3 L2 = normalize(vec3(-L.x, 0.4, -L.z));
  spec += pow(max(dot(R, L2), 0.0), 90.0) * 0.8;
  float ndl = max(dot(N, L), 0.0);
  vec3 amb = mix(u_abyss * 0.3, u_skyMid + 0.1, N.y * 0.5 + 0.5);
  vec3 col; float glow = 0.0;
  if (u_type < 0.5) {                          // polished metal
    vec3 e = world(R, false);
    col = e * u_base * (1.25 + 0.6 * fres) + u_base * amb * 0.18;
    float ring = smoothstep(0.035, 0.0, abs(o.y)) + smoothstep(0.02, 0.0, abs(o.x)) * 0.6;
    col *= 1.0 - ring * 0.55;
    col += ring * u_glowCol * 0.15;
  } else if (u_type < 1.5) {                   // glass
    vec3 T = refract(-V, N, 0.72);
    vec3 inner = envB(T) * u_base * 0.9;
    float core = pow(max(dot(-T, normalize(V)), 0.0), 3.0);
    float swirl = sin(o.x * 7.0 + sin(o.y * 5.0 + u_time * 0.5) * 2.0 + o.z * 4.0);
    inner += u_glowCol * (0.25 + 0.25 * swirl) * core;
    col = mix(inner, world(R, false), 0.1 + fres * 0.85);
    glow = 0.35;
  } else if (u_type < 2.5) {                   // plasma core
    float veins = pow(1.0 - abs(sin(o.x * 6.0 + sin(o.y * 7.0 + u_time * 1.3) * 1.6 + o.z * 3.0)), 10.0);
    veins += pow(1.0 - abs(sin(o.z * 9.0 - o.y * 4.0 + u_time * 0.7)), 16.0) * 0.6;
    col = u_base * (amb * 0.4 + ndl * 0.3) + world(R, true) * (0.12 + fres * 0.6);
    col += u_glowCol * veins * (1.3 + u_speed * 0.8);
    glow = veins * 0.9;
  } else {                                     // candy plastic with stripe
    float stripe = smoothstep(0.34, 0.3, abs(o.y));
    vec3 b = mix(vec3(0.97), u_base, stripe);
    float dot2 = smoothstep(0.24, 0.2, length(o.xz - vec2(0.0, 0.0)) ) * step(0.5, abs(o.y));
    b = mix(b, u_base * 0.7, dot2);
    col = b * (amb * 0.55 + u_sunCol * ndl * 0.8) + world(R, true) * (0.06 + fres * 0.5);
  }
  col += u_sunCol * spec;
  col += u_glowCol * fres * (0.25 + u_speed * 0.6);
  gl_FragColor = vec4(col * u_fade, clamp(glow + spec * 0.15 + u_speed * fres * 0.5, 0.0, 1.0));
}`;

// Sky: fullscreen triangle sampling the pre-rendered equirect panorama.
const VS_SKY = `attribute vec2 a_pos; varying vec2 v_p; void main(){ v_p = a_pos; gl_Position = vec4(a_pos, 0.9999, 1.0); }`;
const FS_SKY = GLSL_COMMON + `
varying vec2 v_p; uniform mat4 u_invVP; uniform sampler2D u_env; uniform sampler2D u_env2; uniform float u_mix; uniform float u_flash;
uniform vec3 u_sunDir; uniform vec3 u_sunCol; uniform float u_time;
void main(){
  vec4 a = u_invVP * vec4(v_p, -1.0, 1.0); vec4 b = u_invVP * vec4(v_p, 1.0, 1.0);
  vec3 d = normalize(b.xyz / b.w - a.xyz / a.w);
  vec2 q = equirect(d);
  vec3 col = u_mix < 0.002 ? texture2D(u_env, q).rgb : mix(texture2D(u_env, q).rgb, texture2D(u_env2, q).rgb, u_mix);
  col += vec3(0.75, 0.7, 1.0) * u_flash * (0.35 + 0.65 * smoothstep(-0.1, 0.5, d.y));
  float sd = max(dot(d, u_sunDir), 0.0);
  col += u_sunCol * (pow(sd, 900.0) * 3.0 + pow(sd, 60.0) * 0.25);
  col += (hash(v_p * 431.0 + u_time) - 0.5) * 0.012;
  gl_FragColor = vec4(col, clamp(pow(sd, 600.0) * 1.5, 0.0, 1.0));
}`;

// Floor far below the track (midground/background parallax layer), one style per zone.
const VS_FLOOR = `
attribute vec2 a_pos; uniform mat4 u_vp; uniform vec3 u_cam; uniform float u_y; varying vec3 v_wp;
void main(){ v_wp = vec3(u_cam.x + a_pos.x * 950.0, u_y, u_cam.z + a_pos.y * 950.0); gl_Position = u_vp * vec4(v_wp, 1.0); }`;
const FS_FLOOR = GLSL_COMMON + `
varying vec3 v_wp; uniform vec3 u_cam; uniform float u_time; uniform float u_stA; uniform float u_stB; uniform float u_mix;
uniform vec3 u_aA; uniform vec3 u_bA; uniform vec3 u_aB; uniform vec3 u_bB; uniform vec3 u_fogCol;
vec3 styleCol(float st, vec2 p, vec3 A, vec3 B, float aa, out float glow){
  glow = 0.0;
  if (st < 0.5) {                                   // tech: panels, light seams, blinking beacons
    vec2 d = abs(fract(p / 24.0 + 0.5) - 0.5); float ln = smoothstep(aa * 0.5, 0.0, min(d.x, d.y));
    vec2 d2 = abs(fract(p / 6.0 + 0.5) - 0.5); float sub = smoothstep(aa * 2.0, 0.0, min(d2.x, d2.y));
    float cell = hash(floor(p / 6.0));
    float lt = step(0.95, cell) * (0.5 + 0.5 * sin(u_time * 2.5 + cell * 40.0));
    float pulse = 0.6 + 0.4 * sin(p.y * 0.02 - u_time * 1.5);
    glow = ln * 0.7 * pulse + lt;
    return A * (0.75 + 0.35 * cell) + B * (ln * 0.8 * pulse + sub * 0.12 + lt * 0.9);
  } else if (st < 1.5) {                            // sea of clouds
    vec2 q = p * 0.0045 + vec2(u_time * 0.006, u_time * 0.002);
    float n = fbm(q * 2.0) * 0.6 + fbm(q * 7.0 + 3.1) * 0.4;
    float c = smoothstep(0.32, 0.78, n);
    return mix(A * 0.62, B, c);
  } else if (st < 2.5) {                            // synthwave grid
    vec2 d = abs(fract(p / 9.0 + 0.5) - 0.5); float ln = smoothstep(aa, 0.0, min(d.x, d.y));
    float pulse = 0.55 + 0.45 * sin(p.y * 0.03 - u_time * 4.0);
    glow = ln * pulse;
    return A + B * ln * (0.6 + pulse);
  } else if (st < 3.5) {                            // abstract: soft concentric rings
    float r = length(p - vec2(0.0, floor(p.y / 400.0) * 400.0 + 200.0));
    float ring = smoothstep(aa * 6.0, 0.0, abs(fract(r / 36.0) - 0.5) - 0.44);
    float n = noise(p * 0.004);
    glow = ring * 0.3;
    return mix(A, B, 0.25 + 0.35 * n) + B * ring * 0.35;
  } else {                                          // chaos: lava cracks
    float n = abs(noise(p * 0.035) * 2.0 - 1.0);
    float n2 = abs(noise(p * 0.11 + 7.0) * 2.0 - 1.0);
    float crack = smoothstep(0.09, 0.0, n) + smoothstep(0.05, 0.0, n2) * 0.6;
    float pulse = 0.65 + 0.35 * sin(u_time * 2.0 + p.x * 0.01);
    glow = crack * pulse;
    return A + B * crack * 1.4 * pulse;
  }
}
void main(){
  vec2 p = v_wp.xz;
  float dist = length(v_wp - u_cam);
  float aa = clamp(dist * 0.0018, 0.012, 0.3);
  float gA, gB = 0.0;
  vec3 col = styleCol(u_stA, p, u_aA, u_bA, aa, gA);
  if (u_mix > 0.002) { vec3 c2 = styleCol(u_stB, p, u_aB, u_bB, aa, gB); col = mix(col, c2, u_mix); gA = mix(gA, gB, u_mix); }
  float fog = 1.0 - exp(-dist * 0.0042);
  gl_FragColor = vec4(mix(col, u_fogCol, fog), clamp(gA * (1.0 - fog), 0.0, 1.0));
}`;

// Point sprites: stars, dust, particles (additive).
const VS_PTS = `
attribute vec3 a_pos; attribute vec4 a_col; attribute float a_size;
uniform mat4 u_vp; uniform vec3 u_off; uniform float u_px; uniform float u_persp; uniform float u_time; uniform float u_k;
varying vec4 v_col;
void main(){
  vec4 p = u_vp * vec4(a_pos + u_off, 1.0);
  gl_Position = p;
  float tw = u_persp > 0.5 ? 1.0 : 0.6 + 0.4 * sin(u_time * (1.0 + a_size) + a_pos.x * 13.0);
  gl_PointSize = u_persp > 0.5 ? clamp(a_size * u_px / max(p.w, 0.05), 1.0, 90.0) : a_size * u_px * 0.0016;
  v_col = vec4(a_col.rgb, a_col.a * tw * u_k);
}`;
const FS_PTS = `
precision mediump float; varying vec4 v_col;
void main(){ vec2 c = gl_PointCoord * 2.0 - 1.0; float d = dot(c, c); if (d > 1.0) discard;
  float a = (1.0 - d); a = a * a * v_col.a; gl_FragColor = vec4(v_col.rgb * a, a * 0.6); }`;

// Additive FX geometry: trail ribbon, glows, light shafts.
const VS_FX = `
attribute vec3 a_pos; attribute vec3 a_uv; attribute vec4 a_col;
uniform mat4 u_vp; varying vec3 v_uv; varying vec4 v_col;
void main(){ v_uv = a_uv; v_col = a_col; gl_Position = u_vp * vec4(a_pos, 1.0); }`;
const FS_FX = `
precision mediump float; varying vec3 v_uv; varying vec4 v_col;
void main(){
  float a;
  if (v_uv.z < 0.5) { float x = 1.0 - abs(v_uv.y * 2.0 - 1.0); a = x * x * v_uv.x; }                    // ribbon
  else if (v_uv.z < 1.5) { vec2 c = v_uv.xy * 2.0 - 1.0; float d = max(1.0 - dot(c, c), 0.0); a = d * d * d; } // radial glow
  else { float x = 1.0 - abs(v_uv.x * 2.0 - 1.0); a = x * x * smoothstep(0.0, 0.35, v_uv.y) * smoothstep(1.0, 0.5, v_uv.y); } // shaft
  a *= v_col.a;
  gl_FragColor = vec4(v_col.rgb * a, a * 0.5);
}`;

// Post: bright/glow extraction, separable blur, final composite.
const VS_POST = `attribute vec2 a_pos; varying vec2 v_uv; void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const FS_BRIGHT = `
precision mediump float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_px;
void main(){
  vec4 s = texture2D(u_tex, v_uv + u_px * vec2(-0.5, -0.5)) + texture2D(u_tex, v_uv + u_px * vec2(0.5, -0.5))
         + texture2D(u_tex, v_uv + u_px * vec2(-0.5, 0.5)) + texture2D(u_tex, v_uv + u_px * vec2(0.5, 0.5));
  s *= 0.25;
  float l = dot(s.rgb, vec3(0.3, 0.55, 0.15));
  gl_FragColor = vec4(s.rgb * (s.a * 0.9 + smoothstep(0.75, 1.0, l) * 0.5), 1.0);
}`;
const FS_BLUR = `
precision mediump float; varying vec2 v_uv; uniform sampler2D u_tex; uniform vec2 u_dir;
void main(){
  vec3 c = texture2D(u_tex, v_uv).rgb * 0.227;
  c += (texture2D(u_tex, v_uv + u_dir * 1.385).rgb + texture2D(u_tex, v_uv - u_dir * 1.385).rgb) * 0.316;
  c += (texture2D(u_tex, v_uv + u_dir * 3.231).rgb + texture2D(u_tex, v_uv - u_dir * 3.231).rgb) * 0.070;
  gl_FragColor = vec4(c, 1.0);
}`;
const FS_COMPOSITE = `
precision mediump float; varying vec2 v_uv;
uniform sampler2D u_scene; uniform sampler2D u_bloom; uniform float u_bloomK; uniform float u_blur; uniform float u_ca; uniform float u_time; uniform vec2 u_center;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec2 dir = v_uv - u_center; float r = length(dir);
  vec3 c;
  if (u_blur > 0.001) {
    vec2 st = dir * u_blur * 0.035 * smoothstep(0.1, 0.6, r);
    c = texture2D(u_scene, v_uv).rgb * 0.3 + texture2D(u_scene, v_uv - st).rgb * 0.25 + texture2D(u_scene, v_uv - st * 2.0).rgb * 0.25 + texture2D(u_scene, v_uv - st * 3.0).rgb * 0.2;
  } else c = texture2D(u_scene, v_uv).rgb;
  if (u_ca > 0.001) {
    vec2 o = dir * u_ca * 0.012 * r;
    c.r = mix(c.r, texture2D(u_scene, v_uv + o).r, 0.8); c.b = mix(c.b, texture2D(u_scene, v_uv - o).b, 0.8);
  }
  c += texture2D(u_bloom, v_uv).rgb * u_bloomK;
  c = c / (1.0 + max(max(c.r, c.g), c.b) * 0.08);     // soft shoulder
  c += (h(v_uv * 731.0 + fract(u_time)) - 0.5) * 0.02;
  gl_FragColor = vec4(c, 1.0);
}`;
