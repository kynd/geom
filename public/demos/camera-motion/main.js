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
const DEFAULT_FORM_IDX = 6; // Spectrogram cone

const SHAPE_LISTS = { sdf: SDF_SHAPES, platonic: PLATONIC_PAIRS, scalar: SCALAR_SURFACES, moving: MOVING_SHAPES };
const EFFECTS = {
  amplitude: [{v:1,l:'Radial expansion'},{v:2,l:'Axial compression'},{v:3,l:'Normal extrusion'}],
  history:   [{v:4,l:'Radial displacement'},{v:5,l:'Banded displacement'},{v:6,l:'Axial rotation'}],
  frequency: [{v:7,l:'Spectral displacement'},{v:8,l:'Spectral contours'},{v:9,l:'Spectral shear'}],
};

const STEMS = [
  { id:'master', label:'Master', bin:'250621_a1_mix1_master_88.2k24.bin' },
  { id:'arp',    label:'Arp',    bin:'250621_a1_mix1_arp.bin'            },
  { id:'bass',   label:'Bass',   bin:'250621_a1_mix1_bass.bin'           },
  { id:'hat',    label:'Hat',    bin:'250621_a1_mix1_hat.bin'            },
  { id:'kick1',  label:'Kick 1', bin:'250621_a1_mix1_kick1.bin'          },
  { id:'kick2',  label:'Kick 2', bin:'250621_a1_mix1_kick2.bin'          },
  { id:'pad',    label:'Pad',    bin:'250621_a1_mix1_pad.bin'            },
  { id:'snare',  label:'Snare',  bin:'250621_a1_mix1_snare.bin'          },
];
const SOUND_BASE = '../../sound/full/';
const MASTER_MP3 = SOUND_BASE + '250621_a1_mix1_master_88.2k24.mp3';

const HIST        = 256;
const FFT_BINS    = 128;
const FPS         = 60;
const PLAT_CYCLE  = 5.0;
const LIGHTING_GLOBAL = 10;

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

function fmt(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s/60)}:${Math.floor(s%60).toString().padStart(2,'0')}`;
}
function melDB(v) { return Math.max(0, Math.min(1, (20*Math.log10(Math.max(v, 1e-5))+80)/80)); }

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    out[i] = { ampL: f32[o], ampR: f32[o+1], fftL: f32.subarray(o+2, o+130), fftR: f32.subarray(o+130, o+258) };
  }
  return out;
}

// ── GLSL injection ────────────────────────────────────────────────────────────

const CAM_DECLS = [
  'uniform mat3  u_camRot;',
  'uniform float u_camDist;',
  'uniform vec2  u_camPan;',
  'uniform vec2  u_camDir;',
  'uniform sampler2D u_fillTexBg;',
  'uniform float u_waveBlendBg;',
  'uniform float u_waveBlendObj;',
  'uniform float u_rimStr;',
  'uniform float u_rimWidth;',
  'uniform float u_grayscale;',
].join('\n');

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

const MISS_OLD_VEC3 = '      return u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp;';
const MISS_NEW_VEC3 =
  '      if (u_lighting >= 3) {\n' +
  '        vec3 _aniso = sampleFillMap(rd);\n' +
  '        vec3 _phase = u_lighting >= 10\n' +
  '          ? _aniso * clamp(dot(sampleFillMapBg(rd), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
  '          : _aniso;\n' +
  '        return mix(_phase, _aniso, u_waveBlendBg) * amp;\n' +
  '      }\n' +
  '      return sampleEnvMap(rd) * amp;';

const MISS_OLD_VEC4 = '      return vec4(u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp, 1.0);';
const MISS_NEW_VEC4 =
  '      if (u_lighting >= 3) {\n' +
  '        vec3 _aniso = sampleFillMap(rd);\n' +
  '        vec3 _phase = u_lighting >= 10\n' +
  '          ? _aniso * clamp(dot(sampleFillMapBg(rd), vec3(0.333333)) * 3.5, 0.0, 1.5)\n' +
  '          : _aniso;\n' +
  '        return vec4(mix(_phase, _aniso, u_waveBlendBg) * amp, 1.0);\n' +
  '      }\n' +
  '      return vec4(sampleEnvMap(rd) * amp, 1.0);';

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
const FILL_OLD_100B = '  if (u_lighting >= 3) return fillLight(nor, rd, 100.0);  // open surfaces: SSS suppressed';
const FILL_NEW_100B = FILL_NEW_100;

const FILL_OLD_VEC4 = '  if (u_lighting >= 3) return vec4(fillLight(nor, rd, tb - t), 1.0);';
const FILL_NEW_VEC4 =
  '  if (u_lighting >= 3) {\n' +
  '    vec3 _aniso = fillLight(nor, rd, tb - t);\n' +
  '    vec3 _phase = u_lighting >= 10 ? phaseFill(nor, rd, tb - t) : _aniso;\n' +
  '    return vec4(mix(_phase, _aniso, u_waveBlendObj) + rimLight(pos, nor, rd, tb - t) * u_rimStr, 1.0);\n' +
  '  }';

const RIM_OLD_TB   = '  return rimLight(pos, nor, rd, tb - t);';
const RIM_NEW_TB   = '  return rimLight(pos, nor, rd, tb - t) * u_rimStr;';
const RIM_OLD_100  = '  return rimLight(pos, nor, rd, 100.0);';
const RIM_NEW_100  = '  return rimLight(pos, nor, rd, 100.0) * u_rimStr;';
const RIM_OLD_VEC4 = '  return vec4(rimLight(pos, nor, rd, tb - t), 1.0);';
const RIM_NEW_VEC4 = '  return vec4(rimLight(pos, nor, rd, tb - t) * u_rimStr, 1.0);';

const GRAY_OLD_VEC3 = '  col = pow(max(col, 0.0), vec3(0.4545));\n  gl_FragColor = vec4(col, 1.0);';
const GRAY_NEW_VEC3 =
  '  col = pow(max(col, 0.0), vec3(0.4545));\n' +
  '  col = mix(col, vec3(dot(col, vec3(0.299, 0.587, 0.114))), u_grayscale);\n' +
  '  gl_FragColor = vec4(col, 1.0);';
const GRAY_OLD_VEC4 = '  gl_FragColor = vec4(pow(max(col.rgb, vec3(0.0)), vec3(0.4545)), 1.0);';
const GRAY_NEW_VEC4 =
  '  vec3 _gc = pow(max(col.rgb, vec3(0.0)), vec3(0.4545));\n' +
  '  _gc = mix(_gc, vec3(dot(_gc, vec3(0.299, 0.587, 0.114))), u_grayscale);\n' +
  '  gl_FragColor = vec4(_gc, 1.0);';

function injectCommon(src) {
  src = src.replace('precision highp float;', 'precision highp float;\n' + CAM_DECLS);
  src = src.replace('}\n\nvec3 flashLight(', '}\n\n' + FILL_MAP_BG_FN + '\n\nvec3 flashLight(');
  return src;
}

function buildFrag(tmpl, subs) {
  let s = tmpl;
  for (const [k, v] of subs) s = s.replace(k, v);
  return s;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function init() {
  const canvas      = document.getElementById('main-canvas');
  const W = canvas.width, H = canvas.height;
  const playBtn     = document.getElementById('play-btn');
  const aaBtn       = document.getElementById('aa-btn');
  const camLightBtn = document.getElementById('cam-light-btn');
  const typeSel     = document.getElementById('type-sel');
  const catSel      = document.getElementById('cat-sel');
  const catSep      = document.getElementById('cat-sep');
  const shapeSel    = document.getElementById('shape-sel');
  const effectSel   = document.getElementById('effect-sel');
  const effectSep   = document.getElementById('effect-sep');
  const stemSel     = document.getElementById('stem-sel');
  const seekEl      = document.getElementById('seek');
  const timeCur     = document.getElementById('time-current');
  const timeTot     = document.getElementById('time-total');
  const loadingEl   = document.getElementById('loading');
  const loadBarFill = document.getElementById('loading-bar-fill');

  // ── Load stem bins ────────────────────────────────────────────────────────────
  let loaded = 0;
  const allFrames = {};
  await Promise.all(STEMS.map(s =>
    fetch(SOUND_BASE + s.bin)
      .then(r => r.arrayBuffer())
      .then(buf => {
        allFrames[s.id] = parseBinary(buf);
        loaded++;
        loadBarFill.style.width = `${(loaded / STEMS.length) * 100}%`;
      })
  ));

  // ── Fetch shaders ─────────────────────────────────────────────────────────────
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

  const rimLightPatched = rimLightSrc.replace(
    'pow(1.0 - NdotV, u_rimPow)',
    'pow(1.0 - NdotV, mix(50.0, 1.5, u_rimWidth))'
  );
  const movingRenamed = movingScalarSrc.replace(/\bsurfaceF\b/g, 'baseScalarF');

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

  function patchLookat(src) {
    return injectCommon(src)
      .replace(MISS_OLD_VEC3, MISS_NEW_VEC3)
      .replace(FILL_OLD_TB,   FILL_NEW_TB)
      .replace(FILL_OLD_100,  FILL_NEW_100)
      .replace(FILL_OLD_100B, FILL_NEW_100B)
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

  const fragSdf = buildFrag(patchLookat(fragSdfTmpl), [
    ['// INCLUDE_SDF_FUNCTIONS',  sdfFuncSrc],
    ['// INCLUDE_RIM_LIGHTING',   rimLightPatched],
    ['// INCLUDE_SDF_MARCHER',    sdfMarcherSrc],
    ['// INCLUDE_DEFORM',         deformSrc],
    [CAM_SDF_OLD,                 CAM_LOOKAT],
  ]);
  const fragPlatonic = buildFrag(patchLookat(fragPlatonicTmpl), [
    ['// INCLUDE_PLATONIC_FUNCTIONS', platonicFuncSrc],
    ['// INCLUDE_RIM_LIGHTING',       rimLightPatched],
    ['// INCLUDE_SDF_MARCHER',        sdfMarcherSrc],
    ['// INCLUDE_DEFORM',             deformSrc],
    [CAM_SDF_OLD,                     CAM_LOOKAT],
  ]);
  const fragScalar = buildFrag(patchLookat(fragScalarTmpl), [
    ['// INCLUDE_RIM_LIGHTING',   rimLightPatched],
    ['// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc],
    ['// INCLUDE_DEFORM',         deformSrc],
    [CAM_MOVING_OLD,              CAM_LOOKAT],
  ]);
  const fragMoving = buildFrag(patchLookat(fragMovingTmpl), [
    ['// INCLUDE_RIM_LIGHTING',            rimLightPatched],
    ['// INCLUDE_SCALAR_MARCHER',          scalarMarcherSrc],
    ['// INCLUDE_DEFORM',                  deformSrc],
    ['// INCLUDE_MOVING_SCALAR_FUNCTIONS', movingRenamed],
    [CAM_MOVING_OLD,                       CAM_LOOKAT],
  ]);
  const fragForm = buildFrag(patchForm(fragFormTmpl), [
    ['// INCLUDE_RIM_LIGHTING', rimLightPatched],
    [CAM_FORM_OLD,              CAM_FORM],
  ]);

  // ── Three.js setup ────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const cam2d = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

  // ── Textures ──────────────────────────────────────────────────────────────────
  const histBuf = new Uint8Array(HIST * 4);
  const histTex = new THREE.DataTexture(histBuf, 1, HIST, THREE.RGBAFormat);
  histTex.magFilter = histTex.minFilter = THREE.LinearFilter;

  const fftBuf = new Uint8Array(FFT_BINS * 4);
  const fftTex = new THREE.DataTexture(fftBuf, FFT_BINS, 1, THREE.RGBAFormat);
  fftTex.magFilter = fftTex.minFilter = THREE.LinearFilter;

  const specBuf = new Uint8Array(FFT_BINS * HIST * 4);
  const specTex = new THREE.DataTexture(specBuf, FFT_BINS, HIST, THREE.RGBAFormat);
  specTex.magFilter = specTex.minFilter = THREE.LinearFilter;
  specTex.wrapS = THREE.ClampToEdgeWrapping;
  specTex.wrapT = THREE.RepeatWrapping;

  const wavBuf = new Uint8Array(FFT_BINS * 4);
  const wavTex = new THREE.DataTexture(wavBuf, FFT_BINS, 1, THREE.RGBAFormat);
  wavTex.magFilter = wavTex.minFilter = THREE.LinearFilter;

  const fillTarget   = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const fillTargetBg = new THREE.WebGLRenderTarget(W, H, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });

  const envTex = buildEnvMapTexture(THREE, 256, 128);

  // ── Shared uniforms ───────────────────────────────────────────────────────────
  const shared = {
    iResolution:    { value: new THREE.Vector2(W, H) },
    iTime:          { value: 0.0 },
    u_ampL:         { value: 0.0 },
    u_ampR:         { value: 0.0 },
    u_ampMono:      { value: 0.0 },
    u_ssaa:         { value: 0 },
    u_lighting:     { value: LIGHTING_GLOBAL },
    u_deformMode:   { value: 4 },
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
    u_mode:         { value: DEFAULT_FORM_IDX + 1 },
    u_intensity:    { value: 1.0 },
    u_specTex:      { value: specTex },
    u_histHead:     { value: 1.0 },
    u_camRot:       { value: new THREE.Matrix3() },
    u_camDist:      { value: 2.667 },
    u_camPan:       { value: new THREE.Vector2(0, 0) },
    u_camDir:       { value: new THREE.Vector2(0, 0) },
    u_waveBlendBg:  { value: 0.01 },
    u_waveBlendObj: { value: 0.50 },
    u_rimStr:       { value: 0.02 },
    u_rimWidth:     { value: 0.10 },
    u_grayscale:    { value: 0.0 },
  };

  const sdfU    = { ...shared, u_shapeIndex:   { value: 1 } };
  const platU   = { ...shared, u_pair:         { value: 0 }, u_t: { value: 0.0 } };
  const scalarU = { ...shared, u_surfaceIndex: { value: 1 } };
  const movingU = { ...shared, u_surfaceIndex: { value: 1 } };

  function makeScene(frag, uniforms) {
    const s = new THREE.Scene();
    s.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: frag })));
    return s;
  }

  const scenes = {
    sdf:      makeScene(fragSdf,      sdfU),
    platonic: makeScene(fragPlatonic,  platU),
    scalar:   makeScene(fragScalar,    scalarU),
    moving:   makeScene(fragMoving,    movingU),
    form:     makeScene(fragForm,      shared),
  };

  const fillUniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
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
  fillScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2), new THREE.ShaderMaterial({ uniforms: fillUniforms, vertexShader: vertSrc, fragmentShader: fragFillSrc })));

  let activeScene = scenes.form;
  const renderPass = new RenderPass(activeScene, cam2d);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), 0.90, 0.35, 0.08);
  const composer   = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  // ── Audio analysis from stem bins ─────────────────────────────────────────────
  let activeStemId = STEMS[0].id; // Master default

  function updateAudio(audioTime) {
    const frames = allFrames[activeStemId];
    if (!frames || !frames.length) return { amp: 0, bass: 0, treble: 0 };

    const idx = Math.min(frames.length - 1, Math.floor(audioTime * FPS));

    // Amplitude history
    for (let row = 0; row < HIST; row++) {
      const fi = Math.max(0, idx - (HIST - 1 - row));
      const fr = frames[fi];
      const b  = row * 4;
      histBuf[b]   = Math.round(Math.min(fr.ampL, 1) * 255);
      histBuf[b+1] = Math.round(Math.min(fr.ampR, 1) * 255);
      histBuf[b+2] = Math.round(Math.min((fr.ampL + fr.ampR) * 0.5, 1) * 255);
      histBuf[b+3] = 255;
      const brow = row * FFT_BINS * 4;
      for (let bin = 0; bin < FFT_BINS; bin++) {
        specBuf[brow + bin*4]   = Math.round(melDB(fr.fftL[bin]) * 255);
        specBuf[brow + bin*4+1] = Math.round(melDB(fr.fftR[bin]) * 255);
        specBuf[brow + bin*4+3] = 255;
      }
    }
    histTex.needsUpdate = true;
    specTex.needsUpdate = true;

    const fr = frames[idx];
    for (let bin = 0; bin < FFT_BINS; bin++) {
      fftBuf[bin*4]   = Math.round(melDB(fr.fftL[bin]) * 255);
      fftBuf[bin*4+1] = Math.round(melDB(fr.fftR[bin]) * 255);
      fftBuf[bin*4+3] = 255;
    }
    fftTex.needsUpdate = true;

    for (let i = 0; i < FFT_BINS; i++) {
      wavBuf[i*4]   = histBuf[Math.floor(i * HIST / FFT_BINS) * 4 + 2];
      wavBuf[i*4+3] = 255;
    }
    wavTex.needsUpdate = true;

    const amp = Math.min((fr.ampL + fr.ampR) * 0.5, 1);
    let bassSum = 0, midSum = 0, trebleSum = 0;
    for (let i = 0; i < FFT_BINS; i++) {
      const v = melDB(fr.fftL[i]);
      if      (i <= 15) bassSum   += v;
      else if (i <= 80) midSum    += v;
      else              trebleSum += v;
    }
    const bass   = bassSum / 16;
    const mid    = midSum  / 65;
    const treble = trebleSum / 47;

    fillUniforms.u_bass.value   = bass;
    fillUniforms.u_mid.value    = mid;
    fillUniforms.u_treble.value = treble;
    fillUniforms.u_amp.value    = amp;

    shared.u_ampL.value    = Math.min(fr.ampL, 1);
    shared.u_ampR.value    = Math.min(fr.ampR, 1);
    shared.u_ampMono.value = amp;

    return { amp, bass, treble };
  }

  // ── Shape / effect selectors ──────────────────────────────────────────────────
  function populateShapes(list, defaultIdx) {
    shapeSel.innerHTML = list.map((n, i) =>
      `<option value="${i}"${i === defaultIdx ? ' selected' : ''}>${n}</option>`
    ).join('');
  }

  function populateEffects(type, defaultVal) {
    effectSel.innerHTML = EFFECTS[type].map(e =>
      `<option value="${e.v}"${e.v === defaultVal ? ' selected' : ''}>${e.l}</option>`
    ).join('');
  }

  function applySelection() {
    const type = typeSel.value;
    const isForm = type === 'form';
    if (isForm) {
      shared.u_mode.value = parseInt(shapeSel.value) + 1;
      activeScene = scenes.form;
    } else {
      shared.u_deformMode.value = parseInt(effectSel.value);
      const idx = parseInt(shapeSel.value);
      switch (catSel.value) {
        case 'sdf':      sdfU.u_shapeIndex.value = idx + 1;  activeScene = scenes.sdf;      break;
        case 'platonic': platU.u_pair.value = idx;           activeScene = scenes.platonic;  break;
        case 'scalar':   scalarU.u_surfaceIndex.value = idx + 1; activeScene = scenes.scalar; break;
        default:         movingU.u_surfaceIndex.value = idx + 1; activeScene = scenes.moving; break;
      }
    }
    renderPass.scene = activeScene;
  }

  function onTypeChange() {
    const isForm = typeSel.value === 'form';
    catSel.style.display    = isForm ? 'none' : '';
    catSep.style.display    = isForm ? 'none' : '';
    effectSel.style.display = isForm ? 'none' : '';
    effectSep.style.display = isForm ? 'none' : '';
    if (isForm) {
      populateShapes(FORM_MODES, DEFAULT_FORM_IDX);
    } else {
      populateShapes(SHAPE_LISTS[catSel.value] || MOVING_SHAPES, 0);
      populateEffects(typeSel.value, EFFECTS[typeSel.value][0].v);
    }
    applySelection();
  }

  typeSel.addEventListener('change', onTypeChange);
  catSel.addEventListener('change', () => { populateShapes(SHAPE_LISTS[catSel.value], 0); applySelection(); });
  shapeSel.addEventListener('change', applySelection);
  effectSel.addEventListener('change', applySelection);

  // Initialize: form default
  catSel.style.display    = 'none';
  catSep.style.display    = 'none';
  effectSel.style.display = 'none';
  effectSep.style.display = 'none';
  populateShapes(FORM_MODES, DEFAULT_FORM_IDX);
  applySelection();

  // ── Stem slider ───────────────────────────────────────────────────────────────
  stemSel.addEventListener('change', () => {
    activeStemId = stemSel.value;
  });

  // ── Camera state ──────────────────────────────────────────────────────────────
  let camYaw = 0, camPitch = 0, camDist = 2.667, camPanX = 0, camPanY = 0;

  // Accumulated motion (separate from user mouse state)
  let motionYaw = 0, motionPitch = 0, motionRoll = 0;
  let orbitRateX = 0, orbitRateY = 0, orbitRateZ = 0; // rad/s
  let soundZoomStr = 0, soundPanStr = 0;

  function updateCamera(amp, bass, treble, wallTime) {
    const totalYaw   = camYaw   + motionYaw;
    const totalPitch = camPitch + motionPitch;
    const totalRoll  = motionRoll;

    const m = new THREE.Matrix4().makeRotationY(totalYaw);
    m.multiply(new THREE.Matrix4().makeRotationX(totalPitch));
    if (totalRoll !== 0) m.multiply(new THREE.Matrix4().makeRotationZ(totalRoll));
    shared.u_camRot.value.setFromMatrix4(m);

    // Sound zoom: positive strength zooms in with amplitude
    const zoomOffset = soundZoomStr > 0 ? -amp * soundZoomStr * 1.5 : 0;
    shared.u_camDist.value = Math.max(0.5, camDist + zoomOffset);

    // Sound pan: uses bass/treble differential + fast oscillation for shake
    if (soundPanStr > 0) {
      const shakeX = (bass - treble) * soundPanStr * 0.4
                   + Math.sin(wallTime * 23.7) * amp * soundPanStr * 0.15;
      const shakeY = (amp - 0.5) * Math.sin(wallTime * 17.3) * soundPanStr * 0.2;
      shared.u_camPan.value.set(camPanX + shakeX, camPanY + shakeY);
    } else {
      shared.u_camPan.value.set(camPanX, camPanY);
    }
  }

  // Mouse orbit
  const canvasWrap = document.querySelector('.canvas-wrap');
  const DRAG_SCALE = 1.0 / canvas.width;
  let isDragging = false, isRightDrag = false, lastMX = 0, lastMY = 0;

  canvasWrap.addEventListener('contextmenu', e => e.preventDefault());
  canvasWrap.addEventListener('mousedown', e => {
    if (e.target.closest('input, button, select')) return;
    isDragging = true; isRightDrag = e.button === 2;
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
    if (!isPlaying) renderFrame(audioEl.currentTime);
  });
  canvasWrap.addEventListener('wheel', e => {
    camDist = Math.max(0.5, Math.min(10.0, camDist + e.deltaY * 0.003));
    if (!isPlaying) renderFrame(audioEl.currentTime);
    e.preventDefault();
  }, { passive: false });

  let lastTouches = null;
  canvasWrap.addEventListener('touchstart', e => { lastTouches = e.touches; e.preventDefault(); }, { passive: false });
  canvasWrap.addEventListener('touchmove', e => {
    if (!lastTouches) return;
    if (e.touches.length === 1 && lastTouches.length === 1) {
      const dx = (e.touches[0].clientX - lastTouches[0].clientX) * DRAG_SCALE * 2;
      const dy = (e.touches[0].clientY - lastTouches[0].clientY) * DRAG_SCALE * 2;
      camYaw  += dx * Math.PI;
      camPitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, camPitch + dy * Math.PI));
    } else if (e.touches.length === 2 && lastTouches.length === 2) {
      const d0 = Math.hypot(lastTouches[0].clientX - lastTouches[1].clientX, lastTouches[0].clientY - lastTouches[1].clientY);
      const d1 = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      camDist = Math.max(0.5, Math.min(10.0, camDist * (d0 / Math.max(d1, 1))));
    }
    if (!isPlaying) renderFrame(audioEl.currentTime);
    lastTouches = e.touches;
    e.preventDefault();
  }, { passive: false });
  canvasWrap.addEventListener('touchend', () => { lastTouches = null; });

  // ── Audio playback ────────────────────────────────────────────────────────────
  const audioEl = new Audio(MASTER_MP3);
  audioEl.preload = 'auto';

  let isPlaying = false, rafId = null, seeking = false;
  const globalStart = performance.now();

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updateBtn();

  function setPlaying(play) {
    isPlaying = play;
    updateBtn();
    if (play) {
      audioEl.play().catch(() => {});
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else {
      audioEl.pause();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }

  playBtn.addEventListener('click', () => setPlaying(!isPlaying));
  audioEl.addEventListener('ended', () => { isPlaying = false; updateBtn(); rafId = null; });

  audioEl.addEventListener('loadedmetadata', () => {
    timeTot.textContent = fmt(audioEl.duration);
    loadingEl.classList.add('fade-out');
    loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });
    renderFrame(0);
  });
  audioEl.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = audioEl.currentTime, d = audioEl.duration || 1;
    seekEl.value = Math.round((t / d) * 10000);
    timeCur.textContent = fmt(t);
  });
  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
  seekEl.addEventListener('input', () => { timeCur.textContent = fmt((seekEl.value/10000)*(audioEl.duration||0)); });
  seekEl.addEventListener('change', () => {
    audioEl.currentTime = (seekEl.value/10000)*(audioEl.duration||0);
    seeking = false;
    if (!isPlaying) renderFrame(audioEl.currentTime);
  });

  // ── Buttons ───────────────────────────────────────────────────────────────────
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    shared.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  const bgMixEl = document.getElementById('p-bg-mix');
  camLightBtn.addEventListener('click', () => {
    const active = camLightBtn.classList.toggle('active');
    camLightBtn.setAttribute('aria-label', active ? 'Light: cam' : 'Light: world');
    shared.u_waveBlendBg.value = active ? 0.0 : parseFloat(bgMixEl.value);
  });

  // ── Params sliders ────────────────────────────────────────────────────────────
  function wireSlider(id, valId, onChange) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
      vl.textContent = parseFloat(sl.value).toFixed(2);
      onChange(parseFloat(sl.value));
    });
  }

  wireSlider('p-bg-mix',     'p-bg-mix-v',     v => { shared.u_waveBlendBg.value  = v; });
  wireSlider('p-obj-mix',    'p-obj-mix-v',     v => { shared.u_waveBlendObj.value = v; });
  wireSlider('p-rim',        'p-rim-v',         v => { shared.u_rimStr.value        = v; });
  wireSlider('p-rim-width',  'p-rim-width-v',   v => { shared.u_rimWidth.value      = v; });
  wireSlider('p-grayscale',  'p-grayscale-v',   v => { shared.u_grayscale.value     = v; });
  wireSlider('p-b-thresh',   'p-b-thresh-v',    v => { bloomPass.threshold = v; });
  wireSlider('p-b-strength', 'p-b-strength-v',  v => { bloomPass.strength  = v; });
  wireSlider('p-b-radius',   'p-b-radius-v',    v => { bloomPass.radius    = v; });

  // Camera motion sliders + reset buttons
  function wireOrbitSlider(id, valId, resetId, setRate) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(valId);
    sl.addEventListener('input', () => {
      vl.textContent = parseFloat(sl.value).toFixed(2);
      setRate(parseFloat(sl.value));
    });
    document.getElementById(resetId).addEventListener('click', () => {
      sl.value = 0;
      vl.textContent = '0.00';
      setRate(0);
    });
  }

  wireOrbitSlider('p-orb-x', 'p-orb-x-v', 'p-orb-x-r', v => { orbitRateX = v * 0.5; });
  wireOrbitSlider('p-orb-y', 'p-orb-y-v', 'p-orb-y-r', v => { orbitRateY = v * 0.5; });
  wireOrbitSlider('p-orb-z', 'p-orb-z-v', 'p-orb-z-r', v => { orbitRateZ = v * 0.5; });
  wireOrbitSlider('p-dir-h', 'p-dir-h-v', 'p-dir-h-r', v => { shared.u_camDir.value.x = v; });
  wireOrbitSlider('p-dir-v', 'p-dir-v-v', 'p-dir-v-r', v => { shared.u_camDir.value.y = v; });
  wireSlider('p-s-zoom', 'p-s-zoom-v', v => { soundZoomStr = v; });
  wireSlider('p-s-pan',  'p-s-pan-v',  v => { soundPanStr  = v; });

  // Apply initial values
  shared.u_waveBlendBg.value  = parseFloat(bgMixEl.value);
  shared.u_waveBlendObj.value = parseFloat(document.getElementById('p-obj-mix').value);
  shared.u_rimStr.value       = parseFloat(document.getElementById('p-rim').value);
  shared.u_rimWidth.value     = parseFloat(document.getElementById('p-rim-width').value);
  shared.u_grayscale.value    = parseFloat(document.getElementById('p-grayscale').value);
  bloomPass.threshold = parseFloat(document.getElementById('p-b-thresh').value);
  bloomPass.strength  = parseFloat(document.getElementById('p-b-strength').value);
  bloomPass.radius    = parseFloat(document.getElementById('p-b-radius').value);

  // ── Render loop ───────────────────────────────────────────────────────────────
  let lastFrameMs = performance.now();

  function renderFrame(audioTime) {
    const nowMs    = performance.now();
    const dt       = Math.min((nowMs - lastFrameMs) * 0.001, 0.1);
    lastFrameMs    = nowMs;
    const wallTime = (nowMs - globalStart) * 0.001;

    // Accumulate constant orbit motion
    motionPitch += orbitRateX * dt;
    motionYaw   += orbitRateY * dt;
    motionRoll  += orbitRateZ * dt;
    // Clamp total pitch to avoid gimbal issues
    const clampedPitch = Math.max(-Math.PI/2 + 0.01, Math.min(Math.PI/2 - 0.01, camPitch + motionPitch));
    motionPitch = clampedPitch - camPitch;

    shared.iTime.value       = wallTime;
    fillUniforms.iTime.value = wallTime;

    const { amp, bass, treble } = updateAudio(audioTime);

    updateCamera(amp, bass, treble, wallTime);

    // Fill targets
    fillUniforms.u_mode.value = 0;
    renderer.setRenderTarget(fillTarget);
    renderer.render(fillScene, cam2d);
    fillUniforms.u_mode.value = 1;
    renderer.setRenderTarget(fillTargetBg);
    renderer.render(fillScene, cam2d);
    renderer.setRenderTarget(null);

    if (activeScene === scenes.platonic) {
      platU.u_t.value = 0.5 - 0.5 * Math.cos(((wallTime % PLAT_CYCLE) / PLAT_CYCLE) * 2 * Math.PI);
    }

    renderPass.scene = activeScene;
    composer.render();
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    renderFrame(audioEl.currentTime);
  }

  audioEl.load();
}

init();
