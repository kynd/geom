import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildEnvMapTexture } from '../../js/oklch-envmap.js';

// ── Catalogues ────────────────────────────────────────────────────────────────

const SDF_SHAPES = [
  'Sphere','Box','Round box','Box frame','Torus','Capped torus','Link',
  'Infinite cylinder','Cone','Infinite cone','Hex prism','Capsule',
  'Vertical capsule','Capped cylinder','Arb. cylinder','Rounded cylinder',
  'Capped cone','Arb. capped cone','Solid angle','Cut sphere',
  'Cut hollow sphere','Death star','Round cone','Arb. round cone',
  'Vesica segment','Rhombus','Octahedron','Octahedron (fast)','Pyramid',
  'Ellipsoid','Triangular prism',
];
const PLATONIC_PAIRS = [
  'Cube / Octahedron','Tetrahedron / Tetrahedron','Dodecahedron / Icosahedron',
];
const SCALAR_SURFACES = [
  'Elliptic paraboloid','Hyperbolic paraboloid','Cone','Sphere','Torus',
  'Hyperboloid','Monkey saddle','Sinusoidal surface','Radial damped cosine','Ellipsoid',
];
const MOVING_SHAPES = [
  'Traveling radial damped cosine','Pulsing torus','Traveling sinusoidal surface','Oscillating spheroid',
  'Pulsing saddle','Pulsing gyroid','Oscillating Schwartz P','Pulsing lemniscate',
  'Tilting ellipsoid','Pulsing tanglecube','Pulsing Chmutov T₄','Traveling sinusoidal cone',
  'Pulsing Gaussian','Oscillating Schoen I-WP','Tilting saddle','Rotating torus',
  'Rotating harmonic sphere','Traveling hyperboloid','Pulsing cyclic cubic','Rotating paraboloid',
];
const FORM_MODES = [
  'Spectral fan','Interference rings','Spectrogram cylinder','Spectral tube',
  'Waveform sphere','Harmonic rings','Spectrogram cone','Spectral terrain',
  'Spectral helix','Spectral ribbon',
];
const EFFECTS = {
  amplitude: [{v:1,l:'Radial expansion'},{v:2,l:'Axial compression'},{v:3,l:'Normal extrusion'}],
  history:   [{v:4,l:'Radial displacement'},{v:5,l:'Banded displacement'},{v:6,l:'Axial rotation'}],
  frequency: [{v:7,l:'Spectral displacement'},{v:8,l:'Spectral contours'},{v:9,l:'Spectral shear'}],
};

const STEMS = [
  { id:'arp',   label:'Arp',    bin:'250621_a1_mix1_arp.bin'   },
  { id:'bass',  label:'Bass',   bin:'250621_a1_mix1_bass.bin'  },
  { id:'hat',   label:'Hat',    bin:'250621_a1_mix1_hat.bin'   },
  { id:'kick1', label:'Kick 1', bin:'250621_a1_mix1_kick1.bin' },
  { id:'kick2', label:'Kick 2', bin:'250621_a1_mix1_kick2.bin' },
  { id:'pad',   label:'Pad',    bin:'250621_a1_mix1_pad.bin'   },
  { id:'snare', label:'Snare',  bin:'250621_a1_mix1_snare.bin' },
];
const MASTER_MP3  = '250621_a1_mix1_master_88.2k24.mp3';
const MASTER_BIN  = '250621_a1_mix1_master_88.2k24.bin';
const SOUND_BASE  = '../../sound/full/';
const FPS         = 60;
const HIST        = 256;
const PLAT_CYCLE  = 5.0;
const START_TIME  = 0;
const ALPHA       = 0.92;
const BETA        = 5.0;
const WIN_THRESH  = 0.20;
const LIGHTING_GLOBAL = 10;

const STEM_DEFAULTS = [
  // arp
  { type:'form', formMode:7, bloom:{threshold:0.08,strength:0.90,radius:0.35} },
  // bass
  { type:'history', category:'moving', shapeIdx:2, effect:4, bloom:{threshold:0.08,strength:0.30,radius:0.45} },
  // hat
  { type:'form', formMode:4, bloom:{threshold:0.08,strength:1.55,radius:0.22} },
  // kick1
  { type:'amplitude', category:'platonic', shapeIdx:0, effect:3, bloom:{threshold:0.08,strength:0.35,radius:0.50} },
  // kick2
  { type:'amplitude', category:'moving', shapeIdx:2, effect:2, bloom:{threshold:0.08,strength:1.5,radius:0.42} },
  // pad
  { type:'form', formMode:8, bloom:{threshold:0.05,strength:1.0,radius:0.44} },
  // snare
  { type:'frequency', category:'moving', shapeIdx:4, effect:9, bloom:{threshold:0.08,strength:1.00,radius:0.30} },
];

// ── Winner state ──────────────────────────────────────────────────────────────

let currentWinnerId = 0;
let soloStemId = null;

// ── Icons ─────────────────────────────────────────────────────────────────────

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    out[i] = { ampL:f32[o], ampR:f32[o+1], fftL:f32.subarray(o+2,o+130), fftR:f32.subarray(o+130,o+258) };
  }
  return out;
}

function melDB(v) { return Math.max(0, Math.min(1, (20*Math.log10(Math.max(v,1e-5))+80)/80)); }

function computeOnset(frames) {
  const n = frames.length;
  const onset = new Float32Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const amp = (frames[i].ampL + frames[i].ampR) * 0.5;
    const delta = Math.max(0, amp - prev);
    onset[i] = (i === 0) ? delta : ALPHA * onset[i-1] + (1 - ALPHA) * delta;
    prev = amp;
  }
  return onset;
}

function buildSelect(options, selectedVal) {
  return options.map(o =>
    `<option value="${o.v}"${o.v==selectedVal?' selected':''}>${o.l}</option>`
  ).join('');
}

function buildShapeOptions(shapes, selectedIdx) {
  return shapes.map((n,i) =>
    `<option value="${i}"${i==selectedIdx?' selected':''}>${n}</option>`
  ).join('');
}

// ── Loading UI ────────────────────────────────────────────────────────────────

function buildLoadingRows() {
  const container = document.getElementById('loading-tracks');
  return STEMS.map(s => {
    const row = document.createElement('div');
    row.className = 'load-row';
    row.innerHTML =
      `<span class="load-name">${s.label}</span>` +
      `<div class="load-bar-bg"><div class="load-bar-fill indeterminate"></div></div>` +
      `<span class="load-pct"></span>`;
    container.appendChild(row);
    return { fill:row.querySelector('.load-bar-fill'), pct:row.querySelector('.load-pct') };
  });
}

// ── GLSL injection helpers ────────────────────────────────────────────────────

const CAM_DECLS = [
  'uniform mat3  u_camRot;',
  'uniform float u_camDist;',
  'uniform vec2  u_camPan;',
  'uniform vec2  u_camDir;',
  'uniform float u_collapseY;',
  'uniform sampler2D u_fillTexBg;',
  'uniform float u_waveBlendBg;',
  'uniform float u_waveBlendObj;',
  'uniform float u_rimStr;',
  'uniform float u_rimWidth;',
  'uniform float u_grayscale;',
  'uniform float u_gamma;',
  'uniform float u_overlayAmt;',
  'uniform int   u_camLight;',
  'uniform vec3  u_camFwd;',
].join('\n');

// Overlay blend mode, applied to a color with itself ("self-overlay") as a
// cheap contrast/punch boost. Injected once via injectCommon.
const OVERLAY_FN =
`float overlayChan(float a, float b) {
  return a < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
}
vec3 overlayBlend(vec3 a, vec3 b) {
  return vec3(overlayChan(a.r, b.r), overlayChan(a.g, b.g), overlayChan(a.b, b.b));
}`;

// ── Collapse injection strings ────────────────────────────────────────────────

const COLLAPSE_SF_OLD =
  'float surfaceF(vec3 p) {\n  vec3 dp = deformP(p);\n  float f = baseScalarF(dp);';
const COLLAPSE_SF_NEW =
  'float surfaceF(vec3 p) {\n' +
  '  float _ky = max(u_collapseY, 0.001); p = vec3(p.x, p.y / _ky, p.z);\n' +
  '  vec3 dp = deformP(p);\n' +
  '  float f = baseScalarF(dp) * _ky;';

const COLLAPSE_SDF_OLD =
  'float sceneSDF(vec3 p) {\n' +
  '  float a = iTime * 0.35;\n' +
  '  float ca = cos(a), sa = sin(a);\n' +
  '  vec3 rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);\n' +
  '  vec3 dp = deformP(rp);\n' +
  '  float d = baseSDF(dp);\n' +
  '  if (u_deformMode == 1) d -= u_ampMono * u_deformP1;\n' +
  '  return d;\n}';
const COLLAPSE_SDF_NEW =
  'float sceneSDF(vec3 p) {\n' +
  '  float _ky = max(u_collapseY, 0.001); p = vec3(p.x, p.y / _ky, p.z);\n' +
  '  float a = iTime * 0.35;\n' +
  '  float ca = cos(a), sa = sin(a);\n' +
  '  vec3 rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);\n' +
  '  vec3 dp = deformP(rp);\n' +
  '  float d = baseSDF(dp);\n' +
  '  if (u_deformMode == 1) d -= u_ampMono * u_deformP1;\n' +
  '  return d * _ky;\n}';

const COLLAPSE_PLAT_OLD =
  'float sceneSDF(vec3 p) {\n  // Rotate then deform in the rotated frame\n  vec3 rp;';
const COLLAPSE_PLAT_NEW =
  'float sceneSDF(vec3 p) {\n' +
  '  float _ky = max(u_collapseY, 0.001); p = vec3(p.x, p.y / _ky, p.z);\n' +
  '  // Rotate then deform in the rotated frame\n  vec3 rp;';

const FILL_MAP_BG_FN =
`vec3 sampleFillMapBg(vec3 dir) {
  float u = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  vec2  uv = (vec2(u, v) - 0.5) / u_envScale + 0.5;
  float uf = fract(uv.x);
  uv.x = uf < 0.5 ? uf * 2.0 : (1.0 - uf) * 2.0;
  uv.y = clamp(uv.y, 0.0, 1.0);
  vec3 c = texture2D(u_fillTexBg, uv).rgb;
  return c * c;
}

vec3 phaseFill(vec3 nor, vec3 rd, float thickness) {
  float _phaseLuma = dot(sampleFillMapBg(nor), vec3(0.333333));
  vec3 mat = sampleFillMap(nor) * clamp(_phaseLuma * 3.5, 0.0, 1.5);
  float a1 = iTime * 3.5;
  vec3 ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3 h1  = normalize(ld1 - rd);
  vec3 c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + sampleFillMap(h1) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.35;
  float a2 = iTime * 2.1 + 1.9;
  vec3 ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3 h2  = normalize(ld2 - rd);
  vec3 c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + sampleFillMap(h2) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.35;
  float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
  float amp = max(aL2, 0.015) + aR2;
  vec3 lit  = c1 * max(aL2, 0.015) + c2 * aR2;
  lit += mat * exp(-thickness * u_sssDensity) * u_sssStr * amp;
  return lit;
}`;

// Orbit camera replacement for look-at shaders
const CAM_LOOKAT =
`  vec3 _basero = u_camRot * vec3(0.0, 0.0, u_camDist);
  vec3 _ww0 = normalize(-_basero);
  vec3 _uu0 = normalize(cross(_ww0, vec3(0.0, 1.0, 0.0)));
  vec3 _vv0 = cross(_uu0, _ww0);
  vec3 _ta = u_camDir.x * _uu0 + u_camDir.y * _vv0;
  vec3 ww = normalize(_ta - _basero);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 ro = _basero + u_camPan.x * uu + u_camPan.y * vv;
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);`;

const CAM_FORM =
`  vec3 _basero = u_camRot * vec3(0.0, 0.0, u_camDist);
  vec3 _ww0f = normalize(-_basero);
  vec3 _uu0f = normalize(cross(_ww0f, vec3(0.0, 1.0, 0.0)));
  vec3 _vv0f = cross(_uu0f, _ww0f);
  vec3 _taf = u_camDir.x * _uu0f + u_camDir.y * _vv0f;
  vec3 _ww = normalize(_taf - _basero);
  vec3 _uu = normalize(cross(_ww, vec3(0.0, 1.0, 0.0)));
  vec3 _vv = cross(_uu, _ww);
  vec3 ro = _basero + u_camPan.x * _uu + u_camPan.y * _vv;
  vec3 rd = normalize(uv.x * _uu + uv.y * _vv + 3.0 * _ww);`;

// Miss-path replacements (vec3 shaders: sdf, platonic, scalar, moving)
const MISS_OLD_VEC3 =
  '      return u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp;';
const MISS_NEW_VEC3 =
  '      if (u_camLight == 1) {\n' +
  '        vec3 _camDir = normalize(u_camFwd);\n' +
  '        vec3 _camAniso = sampleFillMap(_camDir);\n' +
  '        vec3 _camPhase = u_lighting >= 10\n' +
  '          ? _camAniso * clamp(dot(sampleFillMapBg(_camDir), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
  '          : _camAniso;\n' +
  '        return mix(_camPhase, _camAniso, u_waveBlendBg) * amp;\n' +
  '      }\n' +
  '      if (u_lighting >= 3) {\n' +
  '        vec3 _aniso = sampleFillMap(rd);\n' +
  '        vec3 _phase = u_lighting >= 10\n' +
  '          ? _aniso * clamp(dot(sampleFillMapBg(rd), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
  '          : _aniso;\n' +
  '        return mix(_phase, _aniso, u_waveBlendBg) * amp;\n' +
  '      }\n' +
  '      return sampleEnvMap(rd) * amp;';

// Miss-path replacements (vec4 shader: form)
const MISS_OLD_VEC4 =
  '      return vec4(u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp, 1.0);';
const MISS_NEW_VEC4 =
  '      if (u_camLight == 1) {\n' +
  '        vec3 _camDir = normalize(u_camFwd);\n' +
  '        vec3 _camAniso = sampleFillMap(_camDir);\n' +
  '        vec3 _camPhase = u_lighting >= 10\n' +
  '          ? _camAniso * clamp(dot(sampleFillMapBg(_camDir), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
  '          : _camAniso;\n' +
  '        return vec4(mix(_camPhase, _camAniso, u_waveBlendBg) * amp, 1.0);\n' +
  '      }\n' +
  '      if (u_lighting >= 3) {\n' +
  '        vec3 _aniso = sampleFillMap(rd);\n' +
  '        vec3 _phase = u_lighting >= 10\n' +
  '          ? _aniso * clamp(dot(sampleFillMapBg(rd), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
  '          : _aniso;\n' +
  '        return vec4(mix(_phase, _aniso, u_waveBlendBg) * amp, 1.0);\n' +
  '      }\n' +
  '      return vec4(sampleEnvMap(rd) * amp, 1.0);';

// fillLight call replacements — blend phase portrait (0) → anisotropic wave (1), rim light added additively
const FILL_OLD_TB   = '  if (u_lighting >= 3) return fillLight(nor, rd, tb - t);';
const FILL_NEW_TB   =
  '  if (u_lighting >= 3) {\n' +
  '    vec3 _aniso = fillLight(nor, rd, tb - t);\n' +
  '    vec3 _phase = u_lighting >= 10 ? phaseFill(nor, rd, tb - t) : _aniso;\n' +
  '    return mix(_phase, _aniso, u_waveBlendObj) + rimLight(pos, nor, rd, tb - t) * u_rimStr;\n' +
  '  }';
const FILL_OLD_100  = '  if (u_lighting >= 3) return fillLight(nor, rd, 100.0);  // open / periodic: SSS suppressed';
const FILL_NEW_100  =
  '  if (u_lighting >= 3) {\n' +
  '    vec3 _aniso = fillLight(nor, rd, 100.0);\n' +
  '    vec3 _phase = u_lighting >= 10 ? phaseFill(nor, rd, 100.0) : _aniso;\n' +
  '    return mix(_phase, _aniso, u_waveBlendObj) + rimLight(pos, nor, rd, 100.0) * u_rimStr;\n' +
  '  }';
const FILL_OLD_VEC4 = '  if (u_lighting >= 3) return vec4(fillLight(nor, rd, tb - t), 1.0);';
const FILL_NEW_VEC4 =
  '  if (u_lighting >= 3) {\n' +
  '    vec3 _aniso = fillLight(nor, rd, tb - t);\n' +
  '    vec3 _phase = u_lighting >= 10 ? phaseFill(nor, rd, tb - t) : _aniso;\n' +
  '    return vec4(mix(_phase, _aniso, u_waveBlendObj) + rimLight(pos, nor, rd, tb - t) * u_rimStr, 1.0);\n' +
  '  }';

// rimLight call replacements
const RIM_OLD_TB   = '  return rimLight(pos, nor, rd, tb - t);';
const RIM_NEW_TB   = '  return rimLight(pos, nor, rd, tb - t) * u_rimStr;';
const RIM_OLD_100  = '  return rimLight(pos, nor, rd, 100.0);';
const RIM_NEW_100  = '  return rimLight(pos, nor, rd, 100.0) * u_rimStr;';
const RIM_OLD_VEC4 = '  return vec4(rimLight(pos, nor, rd, tb - t), 1.0);';
const RIM_NEW_VEC4 = '  return vec4(rimLight(pos, nor, rd, tb - t) * u_rimStr, 1.0);';

// Post-process chain, applied in each screen-output shader:
// overlay (self-overlay contrast boost) → gamma → grayscale
const GRAY_OLD_VEC3 = '  col = pow(max(col, 0.0), vec3(0.4545));\n  gl_FragColor = vec4(col, 1.0);';
const GRAY_NEW_VEC3 =
  '  col = mix(col, overlayBlend(col, col), u_overlayAmt);\n' +
  '  col = pow(max(col, 0.0), vec3(u_gamma));\n' +
  '  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), u_grayscale);\n' +
  '  gl_FragColor = vec4(col, 1.0);';
const GRAY_OLD_VEC4 = '  gl_FragColor = vec4(pow(max(col.rgb, vec3(0.0)), vec3(0.4545)), 1.0);';
const GRAY_NEW_VEC4 =
  '  vec3 _gc = mix(col.rgb, overlayBlend(col.rgb, col.rgb), u_overlayAmt);\n' +
  '  _gc = pow(max(_gc, 0.0), vec3(u_gamma));\n' +
  '  _gc = mix(_gc, vec3(dot(_gc, vec3(0.299, 0.587, 0.114))), u_grayscale);\n' +
  '  gl_FragColor = vec4(_gc, 1.0);';

function injectCommon(src) {
  src = src.replace('precision highp float;', 'precision highp float;\n' + CAM_DECLS + '\n' + OVERLAY_FN);
  src = src.replace('}\n\nvec3 flashLight(', '}\n\n' + FILL_MAP_BG_FN + '\n\nvec3 flashLight(');
  return src;
}

// ── Pane creation ─────────────────────────────────────────────────────────────

function createPane(canvas, shaders, envTex) {
  const W = canvas.width, H = canvas.height;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:false, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

  const histBuf = new Uint8Array(HIST * 4);
  const histTex = new THREE.DataTexture(histBuf, 1, HIST, THREE.RGBAFormat);
  histTex.magFilter = histTex.minFilter = THREE.LinearFilter;
  histTex.needsUpdate = true;

  const fftBuf = new Uint8Array(128 * 4);
  const fftTex = new THREE.DataTexture(fftBuf, 128, 1, THREE.RGBAFormat);
  fftTex.magFilter = fftTex.minFilter = THREE.LinearFilter;
  fftTex.needsUpdate = true;

  const specBuf = new Uint8Array(128 * HIST * 4);
  const specTex = new THREE.DataTexture(specBuf, 128, HIST, THREE.RGBAFormat);
  specTex.magFilter = specTex.minFilter = THREE.LinearFilter;
  specTex.wrapS = THREE.ClampToEdgeWrapping;
  specTex.wrapT = THREE.RepeatWrapping;
  specTex.needsUpdate = true;

  const wavBuf = new Uint8Array(128 * 4);
  const wavTex = new THREE.DataTexture(wavBuf, 128, 1, THREE.RGBAFormat);
  wavTex.magFilter = wavTex.minFilter = THREE.LinearFilter;
  wavTex.needsUpdate = true;

  const fillTarget   = new THREE.WebGLRenderTarget(W, H, {
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
  });
  const fillTargetBg = new THREE.WebGLRenderTarget(W, H, {
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
  });

  const shared = {
    iResolution:    { value: new THREE.Vector2(W,H) },
    iTime:          { value: 0.0 },
    u_ampL:         { value: 0.0 },
    u_ampR:         { value: 0.0 },
    u_ampMono:      { value: 0.0 },
    u_ssaa:         { value: 0 },
    u_lighting:     { value: LIGHTING_GLOBAL },
    u_deformMode:   { value: 3 },
    u_histTex:      { value: histTex },
    u_fftTex:       { value: fftTex },
    u_envMap:       { value: envTex },
    u_rimPow:       { value: 3.0 },
    u_base:         { value: 0.0 },
    u_sssDensity:   { value: 2.5 },
    u_sssStr:       { value: 0.3 },
    u_deformP1:     { value: 0.55 },
    u_deformP2:     { value: 0.55 },
    u_histDuration: { value: 1.0 },
    u_histSoften:   { value: 0.0 },
    u_twistAxisX:   { value: 0.0 },
    u_twistAxisZ:   { value: 0.0 },
    u_ctrlN:        { value: 4.0 },
    u_fillTex:      { value: fillTarget.texture },
    u_fillTexBg:    { value: fillTargetBg.texture },
    u_envScale:     { value: 1.0 },
    u_mode:         { value: 7 },
    u_intensity:    { value: 1.0 },
    u_specTex:      { value: specTex },
    u_histHead:     { value: 1.0 },
    u_camRot:       { value: new THREE.Matrix3() },
    u_camDist:      { value: 2.667 },
    u_camPan:       { value: new THREE.Vector2(0, 0) },
    u_camDir:       { value: new THREE.Vector2(0, 0) },
    u_collapseY:    { value: 1.0 },
    u_waveBlendBg:  { value: 0.01 },
    u_waveBlendObj: { value: 0.50 },
    u_rimStr:       { value: 0.02 },
    u_rimWidth:     { value: 0.10 },
    u_grayscale:    { value: 0.0 },
    u_gamma:        { value: 0.4545 },
    u_overlayAmt:   { value: 0.0 },
    u_camLight:     { value: 1 },
    u_camFwd:       { value: new THREE.Vector3(0, 0, -1) },
  };

  const sdfU    = { ...shared, u_shapeIndex:  { value: 1 } };
  const platU   = { ...shared, u_pair:        { value: 0 }, u_t:{ value:0.0 } };
  const scalarU = { ...shared, u_surfaceIndex:{ value: 1 } };
  const movingU = { ...shared, u_surfaceIndex:{ value: 1 } };

  function makeScene(frag, uniforms) {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2,2),
      new THREE.ShaderMaterial({ uniforms, vertexShader:shaders.vert, fragmentShader:frag }),
    ));
    return s;
  }

  const scenes = {
    sdf:      makeScene(shaders.fragSdf,      sdfU),
    platonic: makeScene(shaders.fragPlatonic,  platU),
    scalar:   makeScene(shaders.fragScalar,    scalarU),
    moving:   makeScene(shaders.fragMoving,    movingU),
    form:     makeScene(shaders.fragForm,      shared),
  };

  const fillUniforms = {
    iResolution: { value: new THREE.Vector2(W,H) },
    iTime:       { value: 0.0 },
    u_mode:      { value: 0 },
    u_ssaa:      { value: 0 },
    u_fftTex:    { value: fftTex },
    u_specTex:   { value: specTex },
    u_waveTex:   { value: wavTex },
    u_envTex:    { value: histTex },
    u_histHead:  { value: 1.0 },
    u_bass:      { value: 0.0 },
    u_mid:       { value: 0.0 },
    u_treble:    { value: 0.0 },
    u_amp:       { value: 0.0 },
  };
  const fillScene = new THREE.Scene();
  fillScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2,2),
    new THREE.ShaderMaterial({ uniforms:fillUniforms, vertexShader:shaders.vert, fragmentShader:shaders.fragFill }),
  ));

  return {
    canvas, renderer, cam,
    histBuf, histTex, fftBuf, fftTex, specBuf, specTex, wavBuf, wavTex,
    fillTarget, fillTargetBg, fillScene, fillUniforms,
    scenes, shared, sdfU, platU, scalarU, movingU,
    composer: null, bloomPass: null, renderPass: null,
    activeScene: scenes.form,
    trackFrames: null,
    config: {},
  };
}

// ── Bloom composer ────────────────────────────────────────────────────────────

function buildPaneComposer(pane) {
  const W = pane.canvas.width, H = pane.canvas.height;
  const renderPass = new RenderPass(pane.activeScene, pane.cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), 1.0, 0.35, 0.1);
  const composer   = new EffectComposer(pane.renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  pane.renderPass = renderPass;
  pane.bloomPass  = bloomPass;
  pane.composer   = composer;
}

// ── Apply config ──────────────────────────────────────────────────────────────

function applyConfig(pane, cfg) {
  const { scenes, sdfU, platU, scalarU, movingU } = pane;
  // u_lighting is global — not overridden per-stem

  if (cfg.type === 'form') {
    pane.shared.u_mode.value = cfg.formMode ?? 7;
    pane.activeScene = scenes.form;
  } else {
    pane.shared.u_deformMode.value = cfg.effect ?? 3;
    switch (cfg.category) {
      case 'sdf':
        sdfU.u_shapeIndex.value = (cfg.shapeIdx ?? 0) + 1;
        pane.activeScene = scenes.sdf; break;
      case 'platonic':
        platU.u_pair.value = cfg.shapeIdx ?? 0;
        pane.activeScene = scenes.platonic; break;
      case 'scalar':
        scalarU.u_surfaceIndex.value = (cfg.shapeIdx ?? 0) + 1;
        pane.activeScene = scenes.scalar; break;
      default:
        movingU.u_surfaceIndex.value = (cfg.shapeIdx ?? 0) + 1;
        pane.activeScene = scenes.moving; break;
    }
  }
  if (pane.renderPass) pane.renderPass.scene = pane.activeScene;
}

// ── Apply bloom ───────────────────────────────────────────────────────────────

function applyBloom(pane, bloom) {
  pane.bloomPass.threshold = bloom.threshold;
  pane.bloomPass.strength  = bloom.strength;
  pane.bloomPass.radius    = bloom.radius;
}

// ── Texture update ────────────────────────────────────────────────────────────

function updatePaneTextures(pane, frames, audioTime) {
  if (!frames || !frames.length) return;
  const { histBuf,histTex,fftBuf,fftTex,specBuf,specTex,wavBuf,wavTex,fillUniforms,shared } = pane;

  const idx = Math.min(frames.length - 1, Math.floor(audioTime * FPS));
  for (let row = 0; row < HIST; row++) {
    const fi = Math.max(0, idx - (HIST - 1 - row));
    const fr = frames[fi];
    const b  = row * 4;
    histBuf[b]   = Math.round(Math.min(fr.ampL,1)*255);
    histBuf[b+1] = Math.round(Math.min(fr.ampR,1)*255);
    histBuf[b+2] = Math.round(Math.min((fr.ampL+fr.ampR)*0.5,1)*255);
    histBuf[b+3] = 255;
    const brow = row * 128 * 4;
    for (let bin = 0; bin < 128; bin++) {
      specBuf[brow+bin*4]   = Math.round(melDB(fr.fftL[bin])*255);
      specBuf[brow+bin*4+1] = Math.round(melDB(fr.fftR[bin])*255);
      specBuf[brow+bin*4+3] = 255;
    }
  }
  histTex.needsUpdate = true;
  specTex.needsUpdate = true;

  const fr = frames[idx];
  for (let bin = 0; bin < 128; bin++) {
    fftBuf[bin*4]   = Math.round(melDB(fr.fftL[bin])*255);
    fftBuf[bin*4+1] = Math.round(melDB(fr.fftR[bin])*255);
    fftBuf[bin*4+3] = 255;
  }
  fftTex.needsUpdate = true;

  for (let i = 0; i < 128; i++) {
    wavBuf[i*4]   = histBuf[Math.floor(i*HIST/128)*4+2];
    wavBuf[i*4+3] = 255;
  }
  wavTex.needsUpdate = true;

  let bassSum=0, midSum=0, trebleSum=0;
  for (let i=0; i<128; i++) {
    const v=melDB(fr.fftL[i]);
    if (i<=15) bassSum+=v; else if (i<=80) midSum+=v; else trebleSum+=v;
  }
  fillUniforms.u_bass.value   = bassSum/16;
  fillUniforms.u_mid.value    = midSum/65;
  fillUniforms.u_treble.value = trebleSum/47;
  fillUniforms.u_amp.value    = Math.min((fr.ampL+fr.ampR)*0.5,1);

  shared.u_ampL.value    = Math.min(fr.ampL,1);
  shared.u_ampR.value    = Math.min(fr.ampR,1);
  shared.u_ampMono.value = Math.min((fr.ampL+fr.ampR)*0.5,1);
}

// ── Render pane ───────────────────────────────────────────────────────────────

function renderPane(pane, wallTime) {
  const { renderer,cam,fillScene,fillTarget,fillTargetBg,fillUniforms,shared,platU,activeScene } = pane;
  shared.iTime.value       = wallTime;
  fillUniforms.iTime.value = wallTime;

  if (shared.u_lighting.value >= 3) {
    if (shared.u_lighting.value === LIGHTING_GLOBAL) {
      // Mode 10: anisotropic wave (0) for object, phase portrait (1) for background
      fillUniforms.u_mode.value = 0;
      renderer.setRenderTarget(fillTarget);
      renderer.render(fillScene, cam);

      fillUniforms.u_mode.value = 1;
      renderer.setRenderTarget(fillTargetBg);
      renderer.render(fillScene, cam);
    } else {
      const mode = shared.u_lighting.value - 3;
      fillUniforms.u_mode.value = mode;
      renderer.setRenderTarget(fillTarget);
      renderer.render(fillScene, cam);
      fillUniforms.u_mode.value = mode;
      renderer.setRenderTarget(fillTargetBg);
      renderer.render(fillScene, cam);
    }
    renderer.setRenderTarget(null);
  }

  if (activeScene === pane.scenes.platonic) {
    const phase = (wallTime % PLAT_CYCLE) / PLAT_CYCLE;
    platU.u_t.value = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  }

  pane.renderPass.scene = activeScene;
  pane.composer.render();
}

// ── Resize pane ───────────────────────────────────────────────────────────────

function resizePane(pane) {
  const W = pane.canvas.width, H = pane.canvas.height;
  pane.renderer.setSize(W, H, false);
  pane.fillTarget.setSize(W, H);
  pane.fillTargetBg.setSize(W, H);
  pane.shared.iResolution.value.set(W, H);
  pane.fillUniforms.iResolution.value.set(W, H);
  if (pane.composer) {
    pane.composer.setSize(W, H);
    pane.bloomPass.resolution.set(W, H);
  }
}

// ── Prominence computation ────────────────────────────────────────────────────

function computeProminence(frameIdx, allFrames, onsetData) {
  const lvls = STEMS.map(s => {
    const f = allFrames[s.id][Math.min(frameIdx, allFrames[s.id].length - 1)];
    return (f.ampL + f.ampR) * 0.5;
  });
  const onsets = STEMS.map((s, i) => onsetData[i][Math.min(frameIdx, onsetData[i].length - 1)]);
  const exps = STEMS.map((_, i) => Math.exp(BETA * (lvls[i] + onsets[i])));
  const sum = exps.reduce((a, b) => a + b, 0) || 1;
  return exps.map(e => e / sum);
}

function pickWinner(scores) {
  const max = Math.max(...scores);
  if (max < WIN_THRESH) return currentWinnerId;
  return scores.indexOf(max);
}

// ── Switch to stem ────────────────────────────────────────────────────────────

function switchToStem(pane, stemId, stemConfigs, allFrames) {
  if (stemId === currentWinnerId) return;
  currentWinnerId = stemId;
  const cfg = stemConfigs[stemId];
  applyConfig(pane, cfg);
  pane.trackFrames = allFrames[STEMS[stemId].id];
  document.querySelectorAll('.sd-section[data-stem]').forEach((el, i) =>
    el.classList.toggle('sd-active', i === stemId)
  );
}

// ── Prominence chart (bar view) ───────────────────────────────────────────────

function drawProminenceChart(ctx, scores) {
  const W = 420, H = 240;
  const PAD = 14, ROW_H = (H - PAD*2) / STEMS.length;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(0,0,0,0.65)';
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 8);
  ctx.fill();
  STEMS.forEach((stem, i) => {
    const y = PAD + i * ROW_H;
    const midY = y + ROW_H * 0.5;
    const isWinner = i === currentWinnerId;
    const NAME_W = 56, BAR_X = NAME_W + 8, BAR_W = W - NAME_W - 52 - PAD;
    ctx.fillStyle = isWinner ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.font = `300 10px 'Sora', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(stem.label, PAD, midY);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(BAR_X, midY - 4, BAR_W, 8);
    ctx.fillStyle = isWinner ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.28)';
    ctx.fillRect(BAR_X, midY - 4, BAR_W * scores[i], 8);
    ctx.fillStyle = isWinner ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.28)';
    ctx.font = `10px 'Google Sans Code', monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(scores[i].toFixed(2), W - PAD, midY);
  });
}

// ── Prominence radar chart ────────────────────────────────────────────────────
// The prominence polygon lives on a flat disc in 3D (XZ plane) and is rotated
// by the same matrix driving the main camera, so it turns in sync with
// Rotation X/Y/Z and mouse-drag orbit — a real 3D object, not a flat overlay.
// No background grid — only the shape itself.

const RADAR_N      = STEMS.length;
const RADAR_ANGLES = Array.from({ length: RADAR_N }, (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / RADAR_N);
const _radarVec3   = new THREE.Vector3();

function drawRadarChart(ctx, scores, W, H, camRot3, opacity) {
  const cx = W * 0.5, cy = H * 0.5;
  const R  = Math.min(W, H) * 0.42;

  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = opacity;

  function project(angle, radiusFrac) {
    _radarVec3.set(Math.cos(angle) * radiusFrac, 0, Math.sin(angle) * radiusFrac);
    _radarVec3.applyMatrix3(camRot3);
    return { x: cx + _radarVec3.x * R, y: cy - _radarVec3.y * R };
  }

  const pts = RADAR_ANGLES.map((a, i) => project(a, scores[i]));

  // Prominence polygon (outline only, no fill)
  ctx.beginPath();
  pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.90)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Vertex dots
  const DOT_R = Math.max(2.5, R * 0.010);
  pts.forEach(p => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.fill();
  });
}

// ── Settings panel ────────────────────────────────────────────────────────────

function buildSettingsPanel(panel, stemConfigs, pane) {
  panel.innerHTML = '';

  STEMS.forEach((stem, i) => {
    const cfg = stemConfigs[i];
    const isForm = cfg.type === 'form';
    const catKey = cfg.category || 'sdf';
    const shapeList = {sdf:SDF_SHAPES,platonic:PLATONIC_PAIRS,scalar:SCALAR_SURFACES,moving:MOVING_SHAPES}[catKey];
    const effType = cfg.type !== 'form' ? cfg.type : 'amplitude';
    const effVal = cfg.effect ?? EFFECTS[effType][0].v;

    const catOpts = [
      {v:'sdf',l:'SDF'},{v:'platonic',l:'Platonic'},
      {v:'scalar',l:'Scalar'},{v:'moving',l:'Moving scalar'},
    ];

    const stemEl = document.createElement('div');
    stemEl.className = 'sd-section' + (i === currentWinnerId ? ' sd-active' : '');
    stemEl.dataset.stem = i;

    stemEl.innerHTML = `
      <div class="sd-header">
        <span class="sd-name">${stem.label}</span>
        <div class="sd-bar-bg"><div class="sd-bar-fill"></div></div>
        <div class="sd-dot"></div>
        <button class="sd-solo" data-stem="${i}">Solo</button>
      </div>
      <div class="sd-row">
        <span class="sd-label">Type</span>
        <select class="sd-select s-type">
          <option value="form"${cfg.type==='form'?' selected':''}>Form</option>
          <option value="amplitude"${cfg.type==='amplitude'?' selected':''}>Amplitude</option>
          <option value="history"${cfg.type==='history'?' selected':''}>History</option>
          <option value="frequency"${cfg.type==='frequency'?' selected':''}>Frequency</option>
        </select>
      </div>
      <div class="sd-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sd-label">Category</span>
        <select class="sd-select s-category" style="flex:1">${buildSelect(catOpts, catKey)}</select>
      </div>
      <div class="sd-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sd-label">Shape</span>
        <select class="sd-select s-shape" style="flex:1">${buildShapeOptions(shapeList, cfg.shapeIdx??0)}</select>
      </div>
      <div class="sd-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sd-label">Effect</span>
        <select class="sd-select s-effect" style="flex:1">${buildSelect(EFFECTS[effType], effVal)}</select>
      </div>
      <div class="sd-row s-form-rows" style="display:${isForm?'flex':'none'}">
        <span class="sd-label">Mode</span>
        <select class="sd-select s-mode" style="flex:1">
          ${FORM_MODES.map((m,mi)=>`<option value="${mi+1}"${(cfg.formMode??9)===(mi+1)?' selected':''}>${m}</option>`).join('')}
        </select>
      </div>
    `;

    panel.appendChild(stemEl);

    const typeSel   = stemEl.querySelector('.s-type');
    const catSel    = stemEl.querySelector('.s-category');
    const shapeSel  = stemEl.querySelector('.s-shape');
    const effectSel = stemEl.querySelector('.s-effect');
    const modeSel   = stemEl.querySelector('.s-mode');
    const shapeRows = stemEl.querySelectorAll('.s-shape-rows');
    const formRows  = stemEl.querySelectorAll('.s-form-rows');

    function showHideRows(isF) {
      shapeRows.forEach(r => r.style.display = isF ? 'none' : 'flex');
      formRows.forEach(r  => r.style.display = isF ? 'flex'  : 'none');
    }
    function populateShapeList(cat) {
      const list = {sdf:SDF_SHAPES,platonic:PLATONIC_PAIRS,scalar:SCALAR_SURFACES,moving:MOVING_SHAPES}[cat];
      shapeSel.innerHTML = list.map((n,mi)=>`<option value="${mi}">${n}</option>`).join('');
      shapeSel.value = '0';
    }
    function populateEffects(type) {
      const opts = EFFECTS[type] || EFFECTS.amplitude;
      effectSel.innerHTML = buildSelect(opts, opts[0].v);
    }
    function readAndApply() {
      const type = typeSel.value;
      stemConfigs[i] = {
        type,
        category: catSel.value,
        shapeIdx: parseInt(shapeSel.value),
        effect:   parseInt(effectSel.value),
        formMode: parseInt(modeSel.value),
      };
      if (i === currentWinnerId) applyConfig(pane, stemConfigs[i]);
    }

    typeSel.addEventListener('change', () => {
      const t = typeSel.value;
      showHideRows(t === 'form');
      if (t !== 'form') populateEffects(t);
      readAndApply();
    });
    catSel.addEventListener('change', () => { populateShapeList(catSel.value); readAndApply(); });
    shapeSel.addEventListener('change', readAndApply);
    effectSel.addEventListener('change', readAndApply);
    modeSel.addEventListener('change', readAndApply);

    stemEl.querySelector('.sd-solo').addEventListener('click', () => {
      const wasActive = soloStemId === i;
      soloStemId = wasActive ? null : i;
      panel.querySelectorAll('.sd-solo').forEach(btn => {
        btn.classList.toggle('active', !wasActive && parseInt(btn.dataset.stem) === i);
      });
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const mainCanvas    = document.getElementById('main-canvas');
  const chartCanvas   = document.getElementById('chart-canvas');
  const radarCanvas   = document.getElementById('radar-canvas');
  const resSel        = document.getElementById('res-sel');
  const chartCtx      = chartCanvas.getContext('2d');
  const radarCtx      = radarCanvas.getContext('2d');
  const settingsPanel = document.getElementById('settings-panel');
  const playBtn       = document.getElementById('play-btn');
  const aaBtn         = document.getElementById('aa-btn');
  const recBtn        = document.getElementById('rec-btn');
  const scoreBtn      = document.getElementById('score-btn');
  const radarBtn      = document.getElementById('radar-btn');
  const settingsBtn   = document.getElementById('settings-btn');
  const camLightBtn   = document.getElementById('cam-light-btn');
  const seekEl        = document.getElementById('seek');
  const timeCur       = document.getElementById('time-current');
  const timeTot       = document.getElementById('time-total');
  const loadingEl     = document.getElementById('loading');

  // ── Fetch shaders ────────────────────────────────────────────────────────
  const [
    fragSdfTmpl, fragPlatonicTmpl, fragScalarTmpl, fragMovingTmpl,
    vertSrc, sdfFuncSrc, sdfMarcherSrc, scalarMarcherSrc,
    platonicFuncSrc, movingScalarSrc, rimLightSrc, deformSrc,
    fragFillSrc, fragFormTmpl,
  ] = await Promise.all([
    fetch('../../demos/sound-shapes/shaders/fragment-sdf.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/fragment-platonic.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/fragment-scalar.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/fragment-moving.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/vertex.glsl').then(r=>r.text()),
    fetch('../../shaders/sdf-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r=>r.text()),
    fetch('../../shaders/scalar-marcher.glsl').then(r=>r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/moving-scalar-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/rim-lighting.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/deform.glsl').then(r=>r.text()),
    fetch('../../demos/sound-fill/shaders/fragment.glsl').then(r=>r.text()),
    fetch('../../demos/sound-form/shaders/fragment.glsl').then(r=>r.text()),
  ]);

  // buildFrag applies an ordered list of [old, new] string substitutions
  function buildFrag(tmpl, subs) {
    let s = tmpl;
    for (const [k,v] of subs) s = s.replace(k, v);
    return s;
  }

  const rimLightPatched = rimLightSrc.replace(
    'pow(1.0 - NdotV, u_rimPow)',
    'pow(1.0 - NdotV, mix(50.0, 1.5, u_rimWidth))'
  );

  const movingRenamed = movingScalarSrc.replace(/\bsurfaceF\b/g, 'baseScalarF');

  // Exact camera-setup blocks from each fragment source file
  const CAM_SDF_OLD =
`  vec3 ro = vec3(0.0, 0.55, 3.5);
  vec3 ta = vec3(0.0, 0.08, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);`;

  const CAM_MOVING_OLD =
`  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);`;

  const CAM_FORM_OLD =
`  vec3 ro = vec3(0.0, 0.0, 2.5);
  vec3 rd = normalize(vec3(uv / 3.0, -1.0));`;

  // Apply common GLSL patches (uniforms + sampleFillMapBg) then shader-specific subs
  function patchLookat(src) {
    return injectCommon(src)
      .replace(MISS_OLD_VEC3, MISS_NEW_VEC3)
      .replace(FILL_OLD_TB,   FILL_NEW_TB)
      .replace(FILL_OLD_100,  FILL_NEW_100)
      .replace(RIM_OLD_TB,    RIM_NEW_TB)
      .replace(RIM_OLD_100,   RIM_NEW_100)
      .replace(GRAY_OLD_VEC3, GRAY_NEW_VEC3);
  }

  function patchForm(src) {
    return injectCommon(src)
      .replace(MISS_OLD_VEC4, MISS_NEW_VEC4)
      .replace(FILL_OLD_VEC4, FILL_NEW_VEC4)
      .replace(RIM_OLD_VEC4,  RIM_NEW_VEC4)
      .replace(GRAY_OLD_VEC4, GRAY_NEW_VEC4);
  }

  const shaders = {
    vert:        vertSrc,
    fragFill:    fragFillSrc,
    fragSdf: buildFrag(patchLookat(fragSdfTmpl), [
      ['// INCLUDE_SDF_FUNCTIONS',  sdfFuncSrc],
      ['// INCLUDE_RIM_LIGHTING',   rimLightPatched],
      ['// INCLUDE_SDF_MARCHER',    sdfMarcherSrc],
      ['// INCLUDE_DEFORM',         deformSrc],
      [CAM_SDF_OLD,                 CAM_LOOKAT],
      [COLLAPSE_SDF_OLD,            COLLAPSE_SDF_NEW],
    ]),
    fragPlatonic: buildFrag(patchLookat(fragPlatonicTmpl), [
      ['// INCLUDE_PLATONIC_FUNCTIONS', platonicFuncSrc],
      ['// INCLUDE_RIM_LIGHTING',       rimLightPatched],
      ['// INCLUDE_SDF_MARCHER',        sdfMarcherSrc],
      ['// INCLUDE_DEFORM',             deformSrc],
      [CAM_SDF_OLD,                     CAM_LOOKAT],
      [COLLAPSE_PLAT_OLD,               COLLAPSE_PLAT_NEW],
    ]),
    fragScalar: buildFrag(patchLookat(fragScalarTmpl), [
      ['// INCLUDE_RIM_LIGHTING',    rimLightPatched],
      ['// INCLUDE_SCALAR_MARCHER',  scalarMarcherSrc],
      ['// INCLUDE_DEFORM',          deformSrc],
      [CAM_MOVING_OLD,               CAM_LOOKAT],
      [COLLAPSE_SF_OLD,              COLLAPSE_SF_NEW],
    ]),
    fragMoving: buildFrag(patchLookat(fragMovingTmpl), [
      ['// INCLUDE_RIM_LIGHTING',            rimLightPatched],
      ['// INCLUDE_SCALAR_MARCHER',          scalarMarcherSrc],
      ['// INCLUDE_DEFORM',                  deformSrc],
      ['// INCLUDE_MOVING_SCALAR_FUNCTIONS', movingRenamed],
      [CAM_MOVING_OLD,                       CAM_LOOKAT],
      [COLLAPSE_SF_OLD,                      COLLAPSE_SF_NEW],
    ]),
    fragForm: buildFrag(patchForm(fragFormTmpl), [
      ['// INCLUDE_RIM_LIGHTING', rimLightPatched],
      [CAM_FORM_OLD,              CAM_FORM],
    ]),
  };

  // ── Load stem bins (+ master, for getLevel/getProminence) ────────────────
  const bars = buildLoadingRows();
  const [buffers, masterBuf] = await Promise.all([
    Promise.all(
      STEMS.map((s, i) =>
        fetch(SOUND_BASE + s.bin)
          .then(r => r.arrayBuffer())
          .then(buf => {
            bars[i].fill.classList.remove('indeterminate');
            bars[i].fill.style.width = '100%';
            bars[i].pct.textContent  = '100%';
            return buf;
          })
      )
    ),
    fetch(SOUND_BASE + MASTER_BIN).then(r => r.arrayBuffer()),
  ]);

  const allFrames = {};
  STEMS.forEach((s, i) => { allFrames[s.id] = parseBinary(buffers[i]); });
  const onsetData = STEMS.map(s => computeOnset(allFrames[s.id]));
  const masterFrames = parseBinary(masterBuf);

  loadingEl.classList.add('fade-out');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once:true });

  // ── Master audio ─────────────────────────────────────────────────────────
  const audio = new Audio(SOUND_BASE + MASTER_MP3);
  audio.preload = 'auto';

  let isPlaying = false, seeking = false, rafId = null;
  let chartVisible = false;
  let radarVisible = true;
  let radarOpacity = 1;

  function updatePlayBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updatePlayBtn();

  function setPlaying(play) {
    isPlaying = play;
    updatePlayBtn();
    if (play) {
      audio.play().catch(() => {});
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else {
      audio.pause();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }

  playBtn.addEventListener('click', () => setPlaying(!isPlaying));
  audio.addEventListener('ended', () => {
    isPlaying = false;
    updatePlayBtn();
    rafId = null;
  });

  audio.addEventListener('loadedmetadata', () => {
    timeTot.textContent = formatTime(audio.duration);
    audio.currentTime   = START_TIME;
    seekEl.value = Math.round((START_TIME / (audio.duration || 1)) * 10000);
    timeCur.textContent = formatTime(START_TIME);
    seekClock(START_TIME);
    requestAnimationFrame(() => renderFrame());
  });

  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = audio.currentTime, d = audio.duration || 1;
    seekEl.value        = Math.round((t / d) * 10000);
    timeCur.textContent = formatTime(t);
  });

  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive:true });
  seekEl.addEventListener('input', () => {
    timeCur.textContent = formatTime((seekEl.value/10000)*(audio.duration||0));
  });
  seekEl.addEventListener('change', () => {
    const t = (seekEl.value / 10000) * (audio.duration || 0);
    audio.currentTime = t;
    seekClock(t);
    seeking = false;
    if (!isPlaying) requestAnimationFrame(() => renderFrame());
  });

  // ── Env map + pane ───────────────────────────────────────────────────────
  const envTex = buildEnvMapTexture(THREE, 256, 128);
  const pane   = createPane(mainCanvas, shaders, envTex);
  buildPaneComposer(pane);

  const stemConfigs = STEM_DEFAULTS.map(d => ({ ...d, bloom: { ...d.bloom } }));

  currentWinnerId = 1;
  pane.trackFrames = allFrames[STEMS[1].id];
  applyConfig(pane, stemConfigs[1]);
  applyBloom(pane, stemConfigs[1].bloom);

  // ── Embedded resize ──────────────────────────────────────────────────────
  const embedded = new URLSearchParams(location.search).has('embedded');
  if (embedded) {
    mainCanvas.width  = 960;
    mainCanvas.height = 540;
    resizePane(pane);
  }

  // ── Orbit camera ─────────────────────────────────────────────────────────
  let camYaw = 0, camPitch = 0;
  let camDist = 2.667;
  let camPanX = 0, camPanY = 0;

  // Rotation X/Y/Z are absolute angles in degrees (not rates), so they can be
  // driven directly from the animation JSON as a function of time.
  let rotX = 0, rotY = 0, rotZ = 0;
  let soundZoomStr = 0, soundPanStr = 0;
  const DEG2RAD = Math.PI / 180;

  // Sound zoom / pan are raw amounts (not strengths) — drive them directly
  // from the animation JSON via getLevel()/getProminence().
  function updateCamera() {
    const totalYaw = camYaw + rotY * DEG2RAD;
    const totalPitch = camPitch + rotX * DEG2RAD; // unclamped — rotation_x/y/z can spin freely
    const totalRoll = rotZ * DEG2RAD;
    const m = new THREE.Matrix4().makeRotationY(totalYaw);
    m.multiply(new THREE.Matrix4().makeRotationX(totalPitch));
    if (totalRoll !== 0) m.multiply(new THREE.Matrix4().makeRotationZ(totalRoll));
    pane.shared.u_camRot.value.setFromMatrix4(m);
    pane.shared.u_camDist.value = Math.max(0.5, camDist + soundZoomStr);
    pane.shared.u_camPan.value.set(camPanX + soundPanStr, camPanY);
    // Cam light: background sampled along the direction the camera is currently
    // facing (world-space), independent of bg_mix.
    pane.shared.u_camFwd.value.set(0, 0, -1).transformDirection(m);
  }
  updateCamera();

  const canvasWrap = document.querySelector('.canvas-wrap');
  const DRAG_SCALE = 1.0 / mainCanvas.width;

  let isDragging = false, isRightDrag = false, lastMX = 0, lastMY = 0;

  canvasWrap.addEventListener('contextmenu', e => e.preventDefault());
  canvasWrap.addEventListener('mousedown', e => {
    if (e.target.closest('input, button, select, textarea, #settings-panel, #env-panel, #anim-panel')) return;
    isDragging  = true;
    isRightDrag = e.button === 2;
    lastMX = e.clientX; lastMY = e.clientY;
    e.preventDefault();
  });
  document.addEventListener('mouseup', () => { isDragging = false; });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = (e.clientX - lastMX) * DRAG_SCALE * 2;
    const dy = (e.clientY - lastMY) * DRAG_SCALE * 2;
    lastMX = e.clientX; lastMY = e.clientY;
    if (isRightDrag) {
      camPanX += dx * camDist;
      camPanY -= dy * camDist;
    } else {
      camYaw  += dx * Math.PI;
      camPitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, camPitch + dy * Math.PI));
    }
    updateCamera();
    if (!isPlaying) requestAnimationFrame(() => renderFrame());
  });
  canvasWrap.addEventListener('wheel', e => {
    if (e.target.closest('#settings-panel, #env-panel, #anim-panel')) return;
    camDist = Math.max(0.5, Math.min(10.0, camDist + e.deltaY * 0.003));
    updateCamera();
    if (!isPlaying) requestAnimationFrame(() => renderFrame());
    e.preventDefault();
  }, { passive: false });

  let lastTouches = null;
  canvasWrap.addEventListener('touchstart', e => {
    lastTouches = e.touches;
    e.preventDefault();
  }, { passive: false });
  canvasWrap.addEventListener('touchmove', e => {
    if (!lastTouches) return;
    if (e.touches.length === 1 && lastTouches.length === 1) {
      const dx = (e.touches[0].clientX - lastTouches[0].clientX) * DRAG_SCALE * 2;
      const dy = (e.touches[0].clientY - lastTouches[0].clientY) * DRAG_SCALE * 2;
      camYaw  += dx * Math.PI;
      camPitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, camPitch + dy * Math.PI));
      updateCamera();
    } else if (e.touches.length === 2 && lastTouches.length === 2) {
      const d0 = Math.hypot(lastTouches[0].clientX - lastTouches[1].clientX, lastTouches[0].clientY - lastTouches[1].clientY);
      const d1 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      camDist = Math.max(0.5, Math.min(10.0, camDist * (d0 / Math.max(d1, 1))));
      updateCamera();
    }
    if (!isPlaying) requestAnimationFrame(() => renderFrame());
    lastTouches = e.touches;
    e.preventDefault();
  }, { passive: false });
  canvasWrap.addEventListener('touchend', () => { lastTouches = null; });

  // ── SSAA ─────────────────────────────────────────────────────────────────
  pane.shared.u_ssaa.value = 1; // default on
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    pane.shared.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  // ── Resolution ───────────────────────────────────────────────────────────
  const NATIVE_W = mainCanvas.width, NATIVE_H = mainCanvas.height;

  function applyResolution(val) {
    let w, h;
    if (val === 'current') {
      w = NATIVE_W; h = NATIVE_H;
    } else {
      const lines = parseInt(val, 10); // 1080 or 2160
      w = lines * 16 / 9;
      h = lines;
    }
    mainCanvas.width  = w;
    mainCanvas.height = h;
    resizePane(pane);
  }

  resSel.addEventListener('change', () => applyResolution(resSel.value));
  applyResolution(resSel.value); // apply default (Full HD)

  // ── Cam-light: background sampled from camera-facing direction (default on) ──
  // Independent of bg_mix — does not touch u_waveBlendBg.
  camLightBtn.addEventListener('click', () => {
    const active = camLightBtn.classList.toggle('active');
    camLightBtn.setAttribute('aria-label', active ? 'Light: cam' : 'Light: world');
    pane.shared.u_camLight.value = active ? 1 : 0;
  });

  // ── Scores toggle ────────────────────────────────────────────────────────
  scoreBtn.addEventListener('click', () => {
    chartVisible = scoreBtn.classList.toggle('active');
    chartCanvas.style.display = chartVisible ? 'block' : 'none';
    scoreBtn.setAttribute('aria-label', chartVisible ? 'Scores on' : 'Scores off');
  });

  // ── Radar toggle ─────────────────────────────────────────────────────────
  radarBtn.addEventListener('click', () => {
    radarVisible = radarBtn.classList.toggle('active');
    radarCanvas.style.display = radarVisible ? 'block' : 'none';
    radarBtn.setAttribute('aria-label', radarVisible ? 'Radar on' : 'Radar off');
  });

  // ── Settings / Env-and-Effects toggles (mutually exclusive) ───────────────
  const envPanel  = document.getElementById('env-panel');
  const envBtn    = document.getElementById('env-btn');
  const animPanel = document.getElementById('anim-panel');

  function closeSettingsPanel() {
    settingsPanel.hidden = true;
    settingsBtn.classList.remove('active');
  }
  function closeEnvPanel() {
    envPanel.hidden  = true;
    animPanel.hidden = true;
    envBtn.classList.remove('active');
  }

  settingsBtn.addEventListener('click', () => {
    const opening = settingsPanel.hidden;
    settingsPanel.hidden = !opening;
    settingsBtn.classList.toggle('active', opening);
    if (opening) closeEnvPanel();
  });

  envBtn.addEventListener('click', () => {
    const opening = envPanel.hidden;
    envPanel.hidden = !opening;
    animPanel.hidden = !opening;
    envBtn.classList.toggle('active', opening);
    if (opening) closeSettingsPanel();
  });

  document.getElementById('env-close').addEventListener('click', closeEnvPanel);
  document.getElementById('settings-close').addEventListener('click', closeSettingsPanel);

  buildSettingsPanel(document.getElementById('settings-panel-scroll'), stemConfigs, pane);

  // ── Side-params wiring ───────────────────────────────────────────────────
  function wireSlider(id, valId, onChange) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
      vl.textContent = parseFloat(sl.value).toFixed(2);
      onChange(parseFloat(sl.value));
    });
  }

  wireSlider('p-bg-mix',     'p-bg-mix-v',     v => { pane.shared.u_waveBlendBg.value  = v; });
  wireSlider('p-obj-mix',    'p-obj-mix-v',     v => { pane.shared.u_waveBlendObj.value = v; });
  wireSlider('p-rim',        'p-rim-v',         v => { pane.shared.u_rimStr.value        = v; });
  wireSlider('p-rim-width',  'p-rim-width-v',   v => { pane.shared.u_rimWidth.value      = v; });
  wireSlider('p-grayscale',  'p-grayscale-v',   v => { pane.shared.u_grayscale.value     = v; });
  wireSlider('p-overlay',    'p-overlay-v',     v => { pane.shared.u_overlayAmt.value     = v; });
  wireSlider('p-gamma',      'p-gamma-v',       v => { pane.shared.u_gamma.value          = v; });
  wireSlider('p-b-thresh',   'p-b-thresh-v',    v => { pane.bloomPass.threshold = v; });
  wireSlider('p-b-strength', 'p-b-strength-v',  v => { pane.bloomPass.strength  = v; });
  wireSlider('p-b-radius',   'p-b-radius-v',    v => { pane.bloomPass.radius    = v; });

  function wireOrbitSlider(id, valId, resetId, setRate) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => { vl.textContent = parseFloat(sl.value).toFixed(2); setRate(parseFloat(sl.value)); });
    document.getElementById(resetId).addEventListener('click', () => { sl.value = 0; vl.textContent = '0.00'; setRate(0); });
  }

  wireOrbitSlider('p-rot-x', 'p-rot-x-v', 'p-rot-x-r', v => { rotX = v; updateCamera(); });
  wireOrbitSlider('p-rot-y', 'p-rot-y-v', 'p-rot-y-r', v => { rotY = v; updateCamera(); });
  wireOrbitSlider('p-rot-z', 'p-rot-z-v', 'p-rot-z-r', v => { rotZ = v; updateCamera(); });
  wireOrbitSlider('p-dir-h', 'p-dir-h-v', 'p-dir-h-r', v => { pane.shared.u_camDir.value.x = v; });
  wireOrbitSlider('p-dir-v', 'p-dir-v-v', 'p-dir-v-r', v => { pane.shared.u_camDir.value.y = v; });
  wireSlider('p-s-zoom',  'p-s-zoom-v',  v => { soundZoomStr = v; });
  wireSlider('p-s-pan',   'p-s-pan-v',   v => { soundPanStr  = v; });
  wireOrbitSlider('p-collapse', 'p-collapse-v', 'p-collapse-r', v => { pane.shared.u_collapseY.value = v; });
  wireSlider('p-radar-opacity', 'p-radar-opacity-v', v => { radarOpacity = v; });

  // Apply initial slider values to uniforms
  pane.shared.u_waveBlendBg.value  = parseFloat(document.getElementById('p-bg-mix').value);
  pane.shared.u_waveBlendObj.value = parseFloat(document.getElementById('p-obj-mix').value);
  pane.shared.u_rimStr.value       = parseFloat(document.getElementById('p-rim').value);
  pane.shared.u_rimWidth.value     = parseFloat(document.getElementById('p-rim-width').value);
  pane.shared.u_grayscale.value    = parseFloat(document.getElementById('p-grayscale').value);
  pane.shared.u_overlayAmt.value   = parseFloat(document.getElementById('p-overlay').value);
  pane.shared.u_gamma.value        = parseFloat(document.getElementById('p-gamma').value);
  pane.bloomPass.threshold = parseFloat(document.getElementById('p-b-thresh').value);
  pane.bloomPass.strength  = parseFloat(document.getElementById('p-b-strength').value);
  pane.bloomPass.radius    = parseFloat(document.getElementById('p-b-radius').value);
  radarOpacity = parseFloat(document.getElementById('p-radar-opacity').value);

  // ── Parameter animation ──────────────────────────────────────────────────
  // Every Env and Effects param has a JSON-friendly identifier mapped to its
  // slider. Animating a param sets the slider and dispatches 'input', so the
  // existing wiring (value label + uniform) runs unchanged.
  const PARAM_IDS = {
    bg_mix:          'p-bg-mix',
    obj_mix:         'p-obj-mix',
    rim_light:       'p-rim',
    rim_width:       'p-rim-width',
    grayscale:       'p-grayscale',
    overlay_amount:  'p-overlay',
    gamma:           'p-gamma',
    bloom_threshold: 'p-b-thresh',
    bloom_strength:  'p-b-strength',
    bloom_radius:    'p-b-radius',
    rotation_x:      'p-rot-x',
    rotation_y:      'p-rot-y',
    rotation_z:      'p-rot-z',
    direction_h:     'p-dir-h',
    direction_v:     'p-dir-v',
    sound_zoom:      'p-s-zoom',
    sound_pan:       'p-s-pan',
    collapse_y:      'p-collapse',
    radar_opacity:   'p-radar-opacity',
  };

  // Click a param name → copy its identifier to the clipboard
  Object.entries(PARAM_IDS).forEach(([name, sliderId]) => {
    const label = document.getElementById(sliderId).closest('.sd-row').querySelector('.sd-label');
    label.title = name;
    label.addEventListener('click', () => {
      navigator.clipboard.writeText(name).catch(() => {});
      const orig = label.textContent;
      label.textContent = name;
      setTimeout(() => { label.textContent = orig; }, 800);
    });
  });

  function smoothstep(a, b, x) {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  }

  // ── Live stem data access ────────────────────────────────────────────────
  // getLevel(name) / getProminence(name) — non-case-sensitive; "master" works
  // for level (from the master bin) but has no computed prominence (always 1).
  let currentScores = STEMS.map(() => 0);

  function normalizeStemId(name) {
    return String(name).trim().toLowerCase();
  }

  function getLevel(name) {
    const id     = normalizeStemId(name);
    const frames = id === 'master' ? masterFrames : allFrames[id];
    if (!frames || !frames.length) return 0;
    const frameIdx = Math.min(Math.floor(clock.time * FPS), frames.length - 1);
    const f = frames[frameIdx];
    return Math.min((f.ampL + f.ampR) * 0.5, 1);
  }

  function getProminence(name) {
    const id = normalizeStemId(name);
    if (id === 'master') return 1;
    const idx = STEMS.findIndex(s => s.id === id);
    return idx < 0 ? 0 : (currentScores[idx] ?? 0);
  }

  // Currently prominent (winning) stem — same hysteresis logic the visual switcher uses.
  function getProminentStemId() {
    return pickWinner(currentScores);
  }
  function getProminentStemName() {
    return STEMS[getProminentStemId()].id;
  }

  const animCodeEl = document.getElementById('anim-code');
  const animErrEl  = document.getElementById('anim-error');
  let animFns = null;

  animCodeEl.value = [
    '{',
    '  "bg_mix": (t) => smoothstep(0.0, 5.0, t - 70),',
    '  "obj_mix": (t) => smoothstep(0.0, 5.0, t - 70),',
    '  "grayscale": (t) => 1.0 - smoothstep(0.0, duration, t),',
    '  "bloom_strength": (t) => getLevel("master") * 2.5,',
    '  "sound_zoom": (t) => getProminence("kick1") * 1.5,',
    '  "rotation_y": (t) => {',
    'if (getProminentStemName() == "pad" || ',
    'getProminentStemName() == "hat") {',
    'return t / duration * 30;',
    '} else {',
    'return getProminentStemId() * 32',
    ' + Math.pow(Math.max(0, t - 60)/ 60, 2) * 360',
    '}},',
    '  "rotation_x": (t) => {',
    'if (getProminentStemName() == "pad" || ',
    'getProminentStemName() == "hat") {',
    'return 0;',
    '} else {',
    'return t / duration * 360 * 20;',
    '}},',
    '  "direction_h": (t) => getLevel("master") * 2.5',
    '   * (0.25 + t / duration * 0.75) * Math.sin(t / duration * 30),',
    '"gamma": (t) => 0.25 + (Math.min(1.0, t / duration * 1.25) * 0.5),',
    '"rim_light": (t)=> (1.0 - getProminence("arp")) * 0.02,',
    '"overlay_amount": (t)=> t/duration,',
    '"radar_opacity": (t)=> (1.0 - getLevel("master")) * 0.5,',
    '}',
  ].join('\n');

  function compileAnims() {
    try {
      const build = new Function(
        'smoothstep', 'duration', 'getProminence', 'getLevel',
        'getProminentStemId', 'getProminentStemName',
        'return (' + animCodeEl.value + ');'
      );
      const obj = build(smoothstep, audio.duration || 0, getProminence, getLevel, getProminentStemId, getProminentStemName);
      if (obj === null || typeof obj !== 'object') throw new Error('Definition must be an object');
      for (const key of Object.keys(obj)) {
        if (!(key in PARAM_IDS)) throw new Error(`Unknown param "${key}". Valid: ${Object.keys(PARAM_IDS).join(', ')}`);
        if (typeof obj[key] !== 'function') throw new Error(`"${key}" must be a function of t`);
      }
      animFns = obj;
      animErrEl.textContent = '';
    } catch (err) {
      animFns = null;
      animErrEl.textContent = err.message;
    }
  }

  animCodeEl.addEventListener('input', compileAnims);
  audio.addEventListener('loadedmetadata', compileAnims); // recompile once duration is known
  compileAnims();

  function applyAnims(time) {
    if (!animFns) return;
    for (const [name, fn] of Object.entries(animFns)) {
      let v;
      try {
        v = fn(time);
      } catch (err) {
        animErrEl.textContent = `${name}: ${err.message}`;
        return;
      }
      if (typeof v !== 'number' || !isFinite(v)) continue;
      const sl = document.getElementById(PARAM_IDS[name]);
      sl.value = v;
      sl.dispatchEvent(new Event('input'));
    }
  }

  // ── Clock ────────────────────────────────────────────────────────────────
  // Single source of truth for current time and frame delta.
  // In recording mode both values are derived from recFrame so output is
  // perfectly frame-accurate at 60 fps regardless of real render speed.
  const clock = { time: START_TIME, dt: 0 };
  let lastFrameMs = performance.now();

  function seekClock(t) {
    clock.time  = t;
    lastFrameMs = performance.now(); // prevent dt spike after a seek
  }

  function tickClock() {
    const nowMs = performance.now();
    if (isRecording) {
      clock.dt   = 1 / FPS;
      clock.time = recFrame / FPS;
    } else {
      clock.dt   = Math.min((nowMs - lastFrameMs) * 0.001, 0.1);
      clock.time = audio.currentTime;
    }
    lastFrameMs = nowMs;
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  let isRecording = false;
  let recFrame = 0;
  let recDirHandle = null;

  // Offscreen canvas used to composite overlays (currently the radar chart)
  // onto the main render before writing a frame to disk. Screen-only overlays
  // like the bar chart / settings panels are intentionally left out.
  const recCanvas = document.createElement('canvas');
  const recCtx    = recCanvas.getContext('2d');
  const RADAR_REF_W = 1920, RADAR_REF_H = 1080; // canvas-wrap reference size

  function compositeRecordingFrame() {
    recCanvas.width  = mainCanvas.width;
    recCanvas.height = mainCanvas.height;
    recCtx.drawImage(mainCanvas, 0, 0, recCanvas.width, recCanvas.height);
    if (radarVisible) {
      const rw = radarCanvas.width  / RADAR_REF_W * recCanvas.width;
      const rh = radarCanvas.height / RADAR_REF_H * recCanvas.height;
      recCtx.drawImage(radarCanvas, (recCanvas.width - rw) / 2, (recCanvas.height - rh) / 2, rw, rh);
    }
    return recCanvas;
  }

  function stopRecording() {
    isRecording = false;
    recDirHandle = null;
    recBtn.classList.remove('active');
    recBtn.setAttribute('aria-label', 'Record off');
    if (isPlaying) audio.play().catch(() => {});
  }

  recBtn.addEventListener('click', async () => {
    if (!isRecording) {
      // Ask for output folder before starting
      try {
        recDirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch {
        return; // user cancelled
      }
      recFrame = Math.round(audio.currentTime * FPS);
      seekClock(audio.currentTime);
      audio.pause();
      isRecording = true;
      recBtn.classList.add('active');
      recBtn.setAttribute('aria-label', 'Record on');
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else {
      stopRecording();
    }
  });

  async function saveFrame(blob, name) {
    const fh = await recDirHandle.getFileHandle(name, { create: true });
    const w  = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }

  // ── Render loop ──────────────────────────────────────────────────────────
  function renderFrame() {
    tickClock();
    const frameIdx = Math.floor(clock.time * FPS);

    const scores = computeProminence(frameIdx, allFrames, onsetData);
    currentScores = scores;

    applyAnims(clock.time);

    const winner = soloStemId !== null ? soloStemId : pickWinner(scores);
    switchToStem(pane, winner, stemConfigs, allFrames);

    updateCamera();

    updatePaneTextures(pane, pane.trackFrames, clock.time);
    renderPane(pane, clock.time);

    if (chartVisible) drawProminenceChart(chartCtx, scores);
    if (radarVisible) drawRadarChart(radarCtx, scores, radarCanvas.width, radarCanvas.height, pane.shared.u_camRot.value, radarOpacity);

    if (!settingsPanel.hidden) {
      settingsPanel.querySelectorAll('.sd-section[data-stem]').forEach((el, i) => {
        el.querySelector('.sd-bar-fill').style.width = `${(scores[i] * 100).toFixed(1)}%`;
      });
    }
  }

  // In recording mode the loop is sequential: render → encode → write to disk → next frame.
  // Using File System Access API avoids the browser download queue entirely.
  const REC_MAX_FRAMES = 36000; // 10 min at 60 fps — hard failsafe, regardless of track length
  function loop() {
    if (isRecording) {
      if (recFrame >= REC_MAX_FRAMES || recFrame / FPS >= (audio.duration || Infinity)) {
        stopRecording();
        return;
      }
      renderFrame();
      const name = 'f' + String(recFrame).padStart(6, '0') + '.png';
      recFrame++;
      compositeRecordingFrame().toBlob(blob => {
        saveFrame(blob, name).then(() => {
          if (isRecording) rafId = requestAnimationFrame(loop);
        });
      }, 'image/png');
    } else {
      rafId = requestAnimationFrame(loop);
      renderFrame();
    }
  }

  requestAnimationFrame(() => renderFrame());
}

init();
