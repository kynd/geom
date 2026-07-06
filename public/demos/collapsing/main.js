import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ── Shape data ────────────────────────────────────────────────────────────────

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
const SHAPE_LISTS = { sdf: SDF_SHAPES, platonic: PLATONIC_PAIRS, scalar: SCALAR_SURFACES, moving: MOVING_SHAPES };

const EFFECTS_BY_TYPE = {
  amplitude: [{ v:1,l:'Radial expansion'      },{ v:2,l:'Axial compression'   },{ v:3,l:'Normal extrusion'    }],
  history:   [{ v:4,l:'Radial displacement'   },{ v:5,l:'Banded displacement' },{ v:6,l:'Axial rotation'      }],
  frequency: [{ v:7,l:'Spectral displacement' },{ v:8,l:'Spectral contours'   },{ v:9,l:'Spectral shear'      }],
};

const DEFAULT_TYPE   = 'history';
const DEFAULT_CAT    = 'moving';
const DEFAULT_SHAPE  = 2;   // Traveling sinusoidal surface
const DEFAULT_EFFECT = 4;   // Radial displacement

const SOUND_BASE = '../../sound/full/';
const MASTER_MP3 = '250621_a1_mix1_master_88.2k24.mp3';
const HIST       = 256;
const FFT_BINS   = 128;
const LIGHTING   = 10;

// ── Shader collapse-Y injection strings ──────────────────────────────────────

// Moving / Scalar: inject into surfaceF
const COLLAPSE_SF_OLD =
  'float surfaceF(vec3 p) {\n  vec3 dp = deformP(p);\n  float f = baseScalarF(dp);';
const COLLAPSE_SF_NEW =
  'float surfaceF(vec3 p) {\n' +
  '  float _ky = max(u_collapseY, 0.001); p = vec3(p.x, p.y / _ky, p.z);\n' +
  '  vec3 dp = deformP(p);\n' +
  '  float f = baseScalarF(dp) * _ky;';

// SDF: inject at start of sceneSDF (full function replacement so we can fix return)
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

// Platonic: inject y-scale before rotations
const COLLAPSE_PLAT_OLD =
  'float sceneSDF(vec3 p) {\n  // Rotate then deform in the rotated frame\n  vec3 rp;';
const COLLAPSE_PLAT_NEW =
  'float sceneSDF(vec3 p) {\n' +
  '  float _ky = max(u_collapseY, 0.001); p = vec3(p.x, p.y / _ky, p.z);\n' +
  '  // Rotate then deform in the rotated frame\n  vec3 rp;';

// ── Play / pause ──────────────────────────────────────────────────────────────

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

let isPlaying = false;
let rafId     = null;
let audioEl   = null;
let audioCtx  = null;
let analyser  = null;
const freqBuf = new Uint8Array(1024);

// ── Rolling buffers ───────────────────────────────────────────────────────────

let histHead = 0;
const specHistory = Array.from({ length: HIST }, () => new Uint8Array(FFT_BINS));
const ampHistBuf  = new Uint8Array(HIST * 4);   // 1×HIST amplitude history (r=L, g=R)
const fftBuf      = new Uint8Array(FFT_BINS * 4);
const specBuf     = new Uint8Array(FFT_BINS * HIST * 4);
const wavBuf      = new Uint8Array(FFT_BINS * 4);

// ── Orbit camera ──────────────────────────────────────────────────────────────

const camState = { theta: 0.3, phi: 0.0, dist: 2.667, panX: 0, panY: 0 };
let drag = null;

function setupOrbit(canvas) {
  canvas.addEventListener('mousedown', e => {
    drag = { x: e.clientX, y: e.clientY, shift: e.shiftKey,
             theta0: camState.theta, phi0: camState.phi,
             panX0: camState.panX, panY0: camState.panY };
  });
  window.addEventListener('mousemove', e => {
    if (!drag) return;
    const dx = (e.clientX - drag.x) * 0.005;
    const dy = (e.clientY - drag.y) * 0.005;
    if (drag.shift) {
      camState.panX = drag.panX0 - dx * 0.6;
      camState.panY = drag.panY0 + dy * 0.6;
    } else {
      camState.theta = drag.theta0 + dx;
      camState.phi   = Math.max(-1.4, Math.min(1.4, drag.phi0 + dy));
    }
  });
  window.addEventListener('mouseup', () => { drag = null; });
  canvas.addEventListener('wheel', e => {
    camState.dist = Math.max(0.5, Math.min(8, camState.dist + e.deltaY * 0.003));
  }, { passive: true });
}

function camMatrix() {
  const cp = Math.cos(camState.phi), sp = Math.sin(camState.phi);
  const ct = Math.cos(camState.theta), st = Math.sin(camState.theta);
  const m = new THREE.Matrix3();
  m.set(ct, 0, -st, sp*st, cp, sp*ct, cp*st, -sp, cp*ct);
  return m;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async function main() {
  const canvas      = document.getElementById('main-canvas');
  const playBtn     = document.getElementById('play-btn');
  const aaBtn       = document.getElementById('aa-btn');
  const typeSel     = document.getElementById('type-sel');
  const catSel      = document.getElementById('cat-sel');
  const shapeSel    = document.getElementById('shape-sel');
  const effectSel   = document.getElementById('effect-sel');
  const collSl      = document.getElementById('collapse-sl');
  const collVal     = document.getElementById('collapse-val');
  const loading     = document.getElementById('loading');
  const seekEl      = document.getElementById('seek');
  const timeCurrent = document.getElementById('time-current');
  const timeTotal   = document.getElementById('time-total');

  // Embedded resize
  if (new URLSearchParams(location.search).has('embedded')) {
    canvas.width = 960; canvas.height = 540;
  }
  const W = canvas.width, H = canvas.height;

  // ── Renderer ────────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  setupOrbit(canvas);
  const cam2d = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

  // ── Textures ─────────────────────────────────────────────────────────────────
  const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, format: THREE.RGBAFormat };
  const fillTarget   = new THREE.WebGLRenderTarget(W, H, rtOpts);
  const fillTargetBg = new THREE.WebGLRenderTarget(W, H, rtOpts);

  const ampHistTex = new THREE.DataTexture(ampHistBuf, 1,        HIST,    THREE.RGBAFormat, THREE.UnsignedByteType);
  const fftTex     = new THREE.DataTexture(fftBuf,     FFT_BINS, 1,       THREE.RGBAFormat, THREE.UnsignedByteType);
  const specTex    = new THREE.DataTexture(specBuf,    FFT_BINS, HIST,    THREE.RGBAFormat, THREE.UnsignedByteType);
  const wavTex     = new THREE.DataTexture(wavBuf,     FFT_BINS, 1,       THREE.RGBAFormat, THREE.UnsignedByteType);

  // ── Fetch shaders ────────────────────────────────────────────────────────────
  const [
    fragMovingTmpl, fragScalarTmpl, fragSdfTmpl, fragPlatonicTmpl,
    vertSrc, deformSrc, fragFillSrc,
    movingScalarSrc, rimLightSrc, scalarMarcherSrc, sdfMarcherSrc,
    sdfFuncSrc, platonicFuncSrc,
  ] = await Promise.all([
    fetch('../../demos/sound-shapes/shaders/fragment-moving.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/fragment-scalar.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/fragment-sdf.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/fragment-platonic.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/vertex.glsl').then(r=>r.text()),
    fetch('../../demos/sound-shapes/shaders/deform.glsl').then(r=>r.text()),
    fetch('../../demos/sound-fill/shaders/fragment.glsl').then(r=>r.text()),
    fetch('../../shaders/moving-scalar-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/rim-lighting.glsl').then(r=>r.text()),
    fetch('../../shaders/scalar-marcher.glsl').then(r=>r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r=>r.text()),
    fetch('../../shaders/sdf-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r=>r.text()),
  ]);

  const movingRenamed = movingScalarSrc.replace(/\bsurfaceF\b/g, 'baseScalarF');
  const rimLightPatched = rimLightSrc.replace(
    'pow(1.0 - NdotV, u_rimPow)',
    'pow(1.0 - NdotV, mix(50.0, 1.5, u_rimWidth))'
  );

  // ── Shared shader patches ────────────────────────────────────────────────────

  const EXTRA_UNIFORMS = [
    'uniform mat3  u_camRot;',
    'uniform float u_camDist;',
    'uniform vec2  u_camPan;',
    'uniform sampler2D u_fillTexBg;',
    'uniform float u_waveBlendBg;',
    'uniform float u_waveBlendObj;',
    'uniform float u_rimStr;',
    'uniform float u_rimWidth;',
    'uniform float u_grayscale;',
    'uniform float u_collapseY;',
  ].join('\n');

  // Camera replacement — same for all shader types
  const CAM_NEW =
`  vec3 _basero = u_camRot * vec3(0.0, 0.0, u_camDist);
  vec3 ww = normalize(-_basero);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 ro = _basero + u_camPan.x * uu + u_camPan.y * vv;
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);`;

  const CAM_MOVING_OLD =
`  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);`;

  const CAM_SDF_OLD =
`  vec3 ro = vec3(0.0, 0.55, 3.5);
  vec3 ta = vec3(0.0, 0.08, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);`;

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

  // Miss (same string in all shaders)
  const MISS_OLD = '      return u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp;';
  const MISS_NEW =
    '      if (u_lighting >= 3) {\n' +
    '        vec3 _aniso = sampleFillMap(rd);\n' +
    '        vec3 _phase = u_lighting >= 10\n' +
    '          ? _aniso * clamp(dot(sampleFillMapBg(rd), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
    '          : _aniso;\n' +
    '        return mix(_phase, _aniso, u_waveBlendBg) * amp;\n' +
    '      }\n' +
    '      return sampleEnvMap(rd) * amp;';

  // Fill/rim — open-surface shaders (moving, scalar)
  const FILL_OPEN_OLD = '  if (u_lighting >= 3) return fillLight(nor, rd, 100.0);  // open';
  // SDF / Platonic shaders use thickness = tb - t
  const FILL_SDF_OLD  = '  if (u_lighting >= 3) return fillLight(nor, rd, tb - t);';

  function makeFillNew(thickness) {
    return (
      '  if (u_lighting >= 3) {\n' +
      `    vec3 _aniso = fillLight(nor, rd, ${thickness});\n` +
      `    vec3 _phase = u_lighting >= 10 ? phaseFill(nor, rd, ${thickness}) : _aniso;\n` +
      `    return mix(_phase, _aniso, u_waveBlendObj) + rimLight(pos, nor, rd, ${thickness}) * u_rimStr;\n` +
      '  }'
    );
  }

  function makeRimNew(thickness) {
    return `  return rimLight(pos, nor, rd, ${thickness}) * u_rimStr;`;
  }

  const GRAY_OLD = '  col = pow(max(col, 0.0), vec3(0.4545));\n  gl_FragColor = vec4(col, 1.0);';
  const GRAY_NEW =
    '  col = pow(max(col, 0.0), vec3(0.4545));\n' +
    '  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), u_grayscale);\n' +
    '  gl_FragColor = vec4(col, 1.0);';

  function commonPatches(src, camOld, fillOld, rimOld, thickness) {
    return src
      .replace('precision highp float;', 'precision highp float;\n' + EXTRA_UNIFORMS)
      .replace('}\n\nvec3 flashLight(', '}\n\n' + FILL_MAP_BG_FN + '\n\nvec3 flashLight(')
      .replace(MISS_OLD, MISS_NEW)
      .replace(fillOld, makeFillNew(thickness))
      .replace(rimOld,  makeRimNew(thickness))
      .replace(GRAY_OLD, GRAY_NEW)
      .replace(camOld,  CAM_NEW);
  }

  // ── Build each category's fragment shader ────────────────────────────────────

  const fragMoving = commonPatches(
    fragMovingTmpl
      .replace(COLLAPSE_SF_OLD, COLLAPSE_SF_NEW)
      .replace('// INCLUDE_SCALAR_MARCHER',          scalarMarcherSrc)
      .replace('// INCLUDE_DEFORM',                  deformSrc)
      .replace('// INCLUDE_MOVING_SCALAR_FUNCTIONS', movingRenamed)
      .replace('// INCLUDE_RIM_LIGHTING',            rimLightPatched),
    CAM_MOVING_OLD,
    '  if (u_lighting >= 3) return fillLight(nor, rd, 100.0);  // open / periodic: SSS suppressed',
    '  return rimLight(pos, nor, rd, 100.0);',
    '100.0'
  );

  const fragScalar = commonPatches(
    fragScalarTmpl
      .replace(COLLAPSE_SF_OLD, COLLAPSE_SF_NEW)
      .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc)
      .replace('// INCLUDE_DEFORM',         deformSrc)
      .replace('// INCLUDE_RIM_LIGHTING',   rimLightPatched),
    CAM_MOVING_OLD,
    '  if (u_lighting >= 3) return fillLight(nor, rd, 100.0);  // open surfaces: SSS suppressed',
    '  return rimLight(pos, nor, rd, 100.0);',
    '100.0'
  );

  const fragSdf = commonPatches(
    fragSdfTmpl
      .replace(COLLAPSE_SDF_OLD, COLLAPSE_SDF_NEW)
      .replace('// INCLUDE_SDF_FUNCTIONS', sdfFuncSrc)
      .replace('// INCLUDE_SDF_MARCHER',   sdfMarcherSrc)
      .replace('// INCLUDE_DEFORM',        deformSrc)
      .replace('// INCLUDE_RIM_LIGHTING',  rimLightPatched),
    CAM_SDF_OLD,
    FILL_SDF_OLD,
    '  return rimLight(pos, nor, rd, tb - t);',
    'tb - t'
  );

  const fragPlatonic = commonPatches(
    fragPlatonicTmpl
      .replace(COLLAPSE_PLAT_OLD, COLLAPSE_PLAT_NEW)
      .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicFuncSrc)
      .replace('// INCLUDE_SDF_MARCHER',        sdfMarcherSrc)
      .replace('// INCLUDE_DEFORM',             deformSrc)
      .replace('// INCLUDE_RIM_LIGHTING',       rimLightPatched),
    CAM_SDF_OLD,
    FILL_SDF_OLD,
    '  return rimLight(pos, nor, rd, tb - t);',
    'tb - t'
  );

  // ── Fill shader scene (renders to fill/fillBg targets) ──────────────────────
  const fillUniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0 },
    u_fftTex:    { value: fftTex  },
    u_specTex:   { value: specTex },
    u_waveTex:   { value: wavTex  },
    u_envTex:    { value: null },
    u_histHead:  { value: 0 },
    u_bass:      { value: 0 },
    u_mid:       { value: 0 },
    u_treble:    { value: 0 },
    u_amp:       { value: 0 },
    u_waveBlend: { value: 0 },
    u_mode:      { value: 0 },
  };
  const fillScene = new THREE.Scene();
  fillScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2,2),
    new THREE.ShaderMaterial({ uniforms: fillUniforms, vertexShader: vertSrc, fragmentShader: fragFillSrc }),
  ));

  // ── Shared 3D uniforms ───────────────────────────────────────────────────────
  const shared = {
    iResolution:    { value: new THREE.Vector2(W, H) },
    iTime:          { value: 0 },
    u_ampL:         { value: 0 },
    u_ampR:         { value: 0 },
    u_ampMono:      { value: 0 },
    u_ssaa:         { value: 0 },
    u_lighting:     { value: LIGHTING },
    u_rimPow:       { value: 3.0 },
    u_base:         { value: 0.0 },
    u_sssDensity:   { value: 2.5 },
    u_sssStr:       { value: 0.3 },
    u_deformMode:   { value: DEFAULT_EFFECT },
    u_deformP1:     { value: 0.25 },
    u_deformP2:     { value: 0.0 },
    u_histDuration: { value: 1.0 },
    u_histSoften:   { value: 0.0 },
    u_twistAxisX:   { value: 0.0 },
    u_twistAxisZ:   { value: 0.0 },
    u_ctrlN:        { value: 4.0 },
    u_fillTex:      { value: fillTarget.texture },
    u_fillTexBg:    { value: fillTargetBg.texture },
    u_histTex:      { value: ampHistTex },
    u_fftTex:       { value: fftTex },
    u_envMap:       { value: null },
    u_envScale:     { value: 1.0 },
    u_mode:         { value: 7 },
    u_intensity:    { value: 1.0 },
    u_camRot:       { value: new THREE.Matrix3() },
    u_camDist:      { value: 2.667 },
    u_camPan:       { value: new THREE.Vector2(0, 0) },
    u_waveBlendBg:  { value: 0.00 },
    u_waveBlendObj: { value: 0.00 },
    u_rimStr:       { value: 0.55 },
    u_rimWidth:     { value: 0.23 },
    u_grayscale:    { value: 1.00 },
    u_collapseY:    { value: 1.0 },
    // Shape indices (each shader uses the relevant one)
    u_surfaceIndex: { value: DEFAULT_SHAPE + 1 },
    u_shapeIndex:   { value: 1 },
    u_pair:         { value: 0 },
    u_t:            { value: 0.5 },
  };

  // ── Materials and render scene ───────────────────────────────────────────────
  const matMap = {
    moving:   new THREE.ShaderMaterial({ uniforms: shared, vertexShader: vertSrc, fragmentShader: fragMoving }),
    scalar:   new THREE.ShaderMaterial({ uniforms: shared, vertexShader: vertSrc, fragmentShader: fragScalar }),
    sdf:      new THREE.ShaderMaterial({ uniforms: shared, vertexShader: vertSrc, fragmentShader: fragSdf }),
    platonic: new THREE.ShaderMaterial({ uniforms: shared, vertexShader: vertSrc, fragmentShader: fragPlatonic }),
  };

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2), matMap[DEFAULT_CAT]);
  const renderScene = new THREE.Scene();
  renderScene.add(quad);

  // ── Composer / bloom ─────────────────────────────────────────────────────────
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(renderScene, cam2d));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 2.30, 0.45, 0.08);
  composer.addPass(bloomPass);

  // ── Selector population helpers ──────────────────────────────────────────────
  function populateShapes(cat) {
    const list = SHAPE_LISTS[cat];
    shapeSel.innerHTML = '';
    list.forEach((n, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = n;
      if (cat === DEFAULT_CAT && i === DEFAULT_SHAPE) o.selected = true;
      shapeSel.appendChild(o);
    });
    applyShapeSelection(cat);
  }

  function populateEffects(type) {
    const list = EFFECTS_BY_TYPE[type];
    quad.material = matMap[catSel.value];
    populateShapes(catSel.value);
    const cur = parseInt(effectSel.value) || DEFAULT_EFFECT;
    effectSel.innerHTML = '';
    list.forEach(e => {
      const o = document.createElement('option');
      o.value = e.v; o.textContent = e.l;
      if (e.v === cur) o.selected = true;
      effectSel.appendChild(o);
    });
    shared.u_deformMode.value = parseInt(effectSel.value);
  }

  function applyShapeSelection(cat) {
    const idx = parseInt(shapeSel.value);
    if      (cat === 'sdf')      shared.u_shapeIndex.value   = idx + 1;
    else if (cat === 'platonic') shared.u_pair.value         = idx;
    else                         shared.u_surfaceIndex.value = idx + 1;
  }

  populateShapes(DEFAULT_CAT);
  populateEffects(DEFAULT_TYPE);

  // ── Selector event handlers ──────────────────────────────────────────────────
  typeSel.addEventListener('change', () => populateEffects(typeSel.value));

  catSel.addEventListener('change', () => {
    quad.material = matMap[catSel.value];
    populateShapes(catSel.value);
  });

  shapeSel.addEventListener('change', () => applyShapeSelection(catSel.value));

  effectSel.addEventListener('change', () => {
    shared.u_deformMode.value = parseInt(effectSel.value);
  });

  // ── Collapse slider ──────────────────────────────────────────────────────────
  collSl.addEventListener('input', () => {
    const v = parseFloat(collSl.value);
    shared.u_collapseY.value = v;
    collVal.textContent = v.toFixed(2);
  });

  // ── Lighting / bloom sliders ─────────────────────────────────────────────────
  function bindParam(id, valId, uniform) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value);
      shared[uniform].value = v;
      vl.textContent = v.toFixed(2);
    });
  }
  function bindBloom(id, valId, prop) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value);
      bloomPass[prop] = v;
      vl.textContent = v.toFixed(2);
    });
  }
  bindParam('p-bg-mix',    'p-bg-mix-v',    'u_waveBlendBg');
  bindParam('p-obj-mix',   'p-obj-mix-v',   'u_waveBlendObj');
  bindParam('p-rim',       'p-rim-v',       'u_rimStr');
  bindParam('p-rim-width', 'p-rim-width-v', 'u_rimWidth');
  bindParam('p-grayscale', 'p-grayscale-v', 'u_grayscale');
  bindBloom('p-b-thresh',   'p-b-thresh-v',   'threshold');
  bindBloom('p-b-strength', 'p-b-strength-v', 'strength');
  bindBloom('p-b-radius',   'p-b-radius-v',   'radius');

  // ── SSAA toggle ──────────────────────────────────────────────────────────────
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    shared.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  // ── Audio ────────────────────────────────────────────────────────────────────
  function fmt(s) {
    const m = Math.floor(s / 60), ss = Math.floor(s % 60);
    return `${m}:${String(ss).padStart(2, '0')}`;
  }

  function createAudio() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    audioEl  = new Audio(SOUND_BASE + MASTER_MP3);
    audioEl.crossOrigin = 'anonymous';
    const src = audioCtx.createMediaElementSource(audioEl);
    analyser  = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.5;
    src.connect(analyser);
    analyser.connect(audioCtx.destination);
    audioEl.addEventListener('loadedmetadata', () => { timeTotal.textContent = fmt(audioEl.duration); });
    audioEl.addEventListener('timeupdate', () => {
      if (audioEl.duration && !seekEl.matches(':active')) {
        seekEl.value = (audioEl.currentTime / audioEl.duration) * 10000;
        timeCurrent.textContent = fmt(audioEl.currentTime);
      }
    });
  }

  seekEl.addEventListener('input', () => {
    if (!audioEl) return;
    audioEl.currentTime = (seekEl.value / 10000) * (audioEl.duration || 0);
    timeCurrent.textContent = fmt(audioEl.currentTime);
  });

  function melDB(v) { return Math.max(0, Math.min(1, (20*Math.log10(Math.max(v/255, 1e-5))+80)/80)); }

  function updateAudio() {
    if (!analyser) return;
    analyser.getByteFrequencyData(freqBuf);

    // FFT texture (128 log-spaced bins)
    for (let i = 0; i < FFT_BINS; i++) {
      const srcBin = Math.round(Math.pow(i / FFT_BINS, 1.5) * 512);
      const raw = freqBuf[Math.min(srcBin, 1023)];
      fftBuf[i*4] = fftBuf[i*4+1] = raw;
      fftBuf[i*4+3] = 255;
    }
    fftTex.needsUpdate = true;

    // Spectral history (specTex, for fill shader)
    const row = histHead % HIST;
    for (let i = 0; i < FFT_BINS; i++) {
      const srcBin = Math.round(Math.pow(i / FFT_BINS, 1.5) * 512);
      specHistory[row][i] = freqBuf[Math.min(srcBin, 1023)];
    }
    for (let r = 0; r < HIST; r++) {
      const srcRow = (histHead - r + HIST * 2) % HIST;
      const rd = specHistory[srcRow];
      const base = r * FFT_BINS * 4;
      for (let i = 0; i < FFT_BINS; i++) {
        specBuf[base + i*4] = specBuf[base + i*4+1] = rd[i];
        specBuf[base + i*4+3] = 255;
      }
    }
    specTex.needsUpdate = true;

    // Amplitude history (ampHistTex, for deform modes 4-6)
    let total = 0;
    for (let i = 0; i < 512; i++) total += freqBuf[i];
    const amp = Math.min(total / (512 * 255), 1);
    const amp8 = Math.floor(amp * 255);
    ampHistBuf[row * 4]     = amp8; // L
    ampHistBuf[row * 4 + 1] = amp8; // R (mono)
    ampHistBuf[row * 4 + 3] = 255;
    ampHistTex.needsUpdate = true;

    histHead = (histHead + 1) % (HIST * 100);

    // Waveform
    const timeBuf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(timeBuf);
    for (let i = 0; i < FFT_BINS; i++) {
      wavBuf[i*4] = timeBuf[Math.floor(i * analyser.fftSize / FFT_BINS)];
      wavBuf[i*4+3] = 255;
    }
    wavTex.needsUpdate = true;

    // Scalars
    let bassSum=0, midSum=0, trebleSum=0;
    for (let i=0; i<FFT_BINS; i++) {
      const v = melDB(fftBuf[i*4]);
      if      (i <= 15) bassSum   += v;
      else if (i <= 80) midSum    += v;
      else              trebleSum += v;
    }
    fillUniforms.u_bass.value   = bassSum / 16;
    fillUniforms.u_mid.value    = midSum  / 65;
    fillUniforms.u_treble.value = trebleSum / 47;
    fillUniforms.u_amp.value    = amp;
    fillUniforms.u_histHead.value = (histHead % HIST) / HIST;

    shared.u_ampL.value = shared.u_ampR.value = shared.u_ampMono.value = amp;
  }

  // ── Play / pause ─────────────────────────────────────────────────────────────
  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updateBtn();

  playBtn.addEventListener('click', () => {
    if (!audioCtx) createAudio();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    isPlaying = !isPlaying;
    if (isPlaying) { audioEl.play(); loop(); }
    else           { audioEl.pause(); cancelAnimationFrame(rafId); rafId = null; }
    updateBtn();
  });

  // ── Render loop ───────────────────────────────────────────────────────────────
  const globalStart = performance.now();

  function loop() {
    rafId = requestAnimationFrame(loop);
    const wallTime = (performance.now() - globalStart) * 0.001;

    updateAudio();

    shared.iTime.value       = wallTime;
    fillUniforms.iTime.value = wallTime;
    shared.u_camRot.value    = camMatrix();
    shared.u_camDist.value   = camState.dist;
    shared.u_camPan.value.set(camState.panX, camState.panY);

    fillUniforms.u_mode.value = 0;
    renderer.setRenderTarget(fillTarget);
    renderer.render(fillScene, cam2d);
    fillUniforms.u_mode.value = 1;
    renderer.setRenderTarget(fillTargetBg);
    renderer.render(fillScene, cam2d);
    renderer.setRenderTarget(null);

    composer.render();
  }

  loading.classList.add('fade-out');
  setTimeout(() => { loading.style.display = 'none'; }, 600);

})();
