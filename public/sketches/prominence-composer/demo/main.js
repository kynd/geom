import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildEnvMapTexture } from '../../../js/oklch-envmap.js';

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
const LIGHTING_OPTIONS = [
  {v:0,l:'Rim lighting'},{v:1,l:'Amplitude flash'},{v:2,l:'Environment map'},
  {v:3,l:'Anisotropic wave'},{v:4,l:'Normal phase portrait'},{v:5,l:'Drifting caustic'},
  {v:6,l:'Spectrogram'},{v:7,l:'Bilateral spectrogram'},
  {v:8,l:'Spectral hue'},{v:9,l:'Spectral hue-lightness'},
  {v:10,l:'Phase + anisotropic'},
];

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
const SOUND_BASE  = '../../../sound/full/';
const FPS         = 60;
const HIST        = 256;
const PLAT_CYCLE  = 5.0;
const START_TIME  = 0;
const ALPHA       = 0.92;   // onset decay
const BETA        = 5.0;    // prominence sharpness
const WIN_THRESH  = 0.20;   // min prominence to switch winner

const STEM_DEFAULTS = [
  // arp
  { type:'form', formMode:7 },
  // bass
  { type:'history', category:'moving', shapeIdx:13, effect:4 },
  // hat
  { type:'form', formMode:4 },
  // kick1
  { type:'amplitude', category:'moving', shapeIdx:0, effect:1 },
  // kick2
  { type:'amplitude', category:'moving', shapeIdx:2, effect:2 },
  // pad
  { type:'form', formMode:8 },
  // snare
  { type:'frequency', category:'moving', shapeIdx:4, effect:9 },
];

const GLOBAL_DEFAULT = {
  lighting: 3,
  bloom: { threshold: 0.08, strength: 1.0, radius: 0.35 },
  waveBlendBg:  0.0,
  waveBlendObj: 0.0,
};

// ── Winner state ──────────────────────────────────────────────────────────────

let currentWinnerId = 0;
let soloStemId = null;

// ── Orbit state ───────────────────────────────────────────────────────────────

let camTheta   = 0.3;
let camPhi     = 0.15;
let camDist    = 3.2;
let camPanX    = 0.0;
let camPanY    = 0.0;
let camLightCam = false; // false = world-fixed ("fix"), true = camera-relative ("rotate")
const CAM_DIST_MIN = 1.0;
const CAM_DIST_MAX = 8.0;

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

// ── Pane creation ─────────────────────────────────────────────────────────────

function createPane(canvas, shaders, envTex) {
  const W = canvas.width, H = canvas.height;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:false });
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
    u_lighting:     { value: 0 },
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
    u_camDist:      { value: 3.2 },
    u_camPan:       { value: new THREE.Vector2() },
    u_lightRot:     { value: new THREE.Matrix3() },
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
    u_waveBlend: { value: 0.0 },
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
    waveBlendBg: 0.0,
    waveBlendObj: 0.0,
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
  const { scenes, shared, sdfU, platU, scalarU, movingU } = pane;

  if (cfg.type === 'form') {
    shared.u_mode.value = cfg.formMode ?? 7;
    pane.activeScene = scenes.form;
  } else {
    shared.u_deformMode.value = cfg.effect ?? 3;
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

// ── Apply global settings ─────────────────────────────────────────────────────

function applyGlobal(pane, globalCfg) {
  pane.shared.u_lighting.value = globalCfg.lighting;
  applyBloom(pane, globalCfg.bloom);
  pane.waveBlendBg  = globalCfg.waveBlendBg;
  pane.waveBlendObj = globalCfg.waveBlendObj;
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
  const { renderer,cam,fillScene,fillTarget,fillUniforms,shared,platU,activeScene } = pane;
  shared.iTime.value       = wallTime;
  fillUniforms.iTime.value = wallTime;

  if (shared.u_lighting.value >= 3) {
    fillUniforms.u_mode.value = shared.u_lighting.value - 3;
    fillUniforms.u_waveBlend.value = pane.waveBlendBg;
    renderer.setRenderTarget(pane.fillTargetBg);
    renderer.render(fillScene, cam);
    fillUniforms.u_waveBlend.value = pane.waveBlendObj;
    renderer.setRenderTarget(fillTarget);
    renderer.render(fillScene, cam);
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
  applyConfig(pane, stemConfigs[stemId]);
  pane.trackFrames = allFrames[STEMS[stemId].id];
  document.querySelectorAll('.sp-stem').forEach((el, i) =>
    el.classList.toggle('active', i === stemId)
  );
}

// ── Prominence chart ──────────────────────────────────────────────────────────

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
    // name
    ctx.fillStyle = isWinner ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)';
    ctx.font = `300 10px 'Sora', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(stem.label, PAD, midY);
    // bar bg
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(BAR_X, midY - 4, BAR_W, 8);
    // bar fill
    ctx.fillStyle = isWinner ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.28)';
    ctx.fillRect(BAR_X, midY - 4, BAR_W * scores[i], 8);
    // value
    ctx.fillStyle = isWinner ? 'rgba(255,255,255,0.70)' : 'rgba(255,255,255,0.28)';
    ctx.font = `10px 'Google Sans Code', monospace`;
    ctx.textAlign = 'right';
    ctx.fillText(scores[i].toFixed(2), W - PAD, midY);
  });
}

// ── Settings panel ────────────────────────────────────────────────────────────

function buildSettingsPanel(panel, stemConfigs, globalConfig, pane) {
  panel.innerHTML = '';

  // ── Global section ──────────────────────────────────────────────────────
  const globalEl = document.createElement('div');
  globalEl.className = 'sp-global';
  globalEl.innerHTML = `
    <div class="sp-row">
      <span class="sp-label">Lighting</span>
      <select class="sp-select sg-lighting">${buildSelect(LIGHTING_OPTIONS, globalConfig.lighting)}</select>
    </div>
    <div class="sp-row sg-wave-row" style="display:${globalConfig.lighting === 10 ? 'flex' : 'none'}">
      <span class="sp-label">Bg</span>
      <input type="range" class="sp-slider sg-wave-blend-bg" min="0" max="1" step="0.01" value="${globalConfig.waveBlendBg}" style="width:60px">
      <span class="sp-val sg-wave-blend-bg-val">${globalConfig.waveBlendBg.toFixed(2)}</span>
      <span class="sp-label" style="margin-left:6px">Obj</span>
      <input type="range" class="sp-slider sg-wave-blend-obj" min="0" max="1" step="0.01" value="${globalConfig.waveBlendObj}" style="width:60px">
      <span class="sp-val sg-wave-blend-obj-val">${globalConfig.waveBlendObj.toFixed(2)}</span>
    </div>
    <div class="sp-row">
      <span class="sp-label">Bloom T</span>
      <input type="range" class="sp-slider sg-b-threshold" min="0" max="1" step="0.01" value="${globalConfig.bloom.threshold}">
      <span class="sp-val sg-bv-threshold">${globalConfig.bloom.threshold.toFixed(2)}</span>
      <span class="sp-label" style="margin-left:4px">S</span>
      <input type="range" class="sp-slider sg-b-strength" min="0" max="3" step="0.05" value="${globalConfig.bloom.strength}">
      <span class="sp-val sg-bv-strength">${globalConfig.bloom.strength.toFixed(2)}</span>
      <span class="sp-label" style="margin-left:4px">R</span>
      <input type="range" class="sp-slider sg-b-radius" min="0" max="1" step="0.01" value="${globalConfig.bloom.radius}">
      <span class="sp-val sg-bv-radius">${globalConfig.bloom.radius.toFixed(2)}</span>
    </div>
  `;
  panel.appendChild(globalEl);

  const gDivider = document.createElement('hr');
  gDivider.style.cssText = 'border:none;border-top:1px solid rgba(255,255,255,0.10);margin:4px 0 6px';
  panel.appendChild(gDivider);

  const gLightSel   = globalEl.querySelector('.sg-lighting');
  const gWaveRow      = globalEl.querySelector('.sg-wave-row');
  const gWaveBlendBg  = globalEl.querySelector('.sg-wave-blend-bg');
  const gWaveBlendBgV = globalEl.querySelector('.sg-wave-blend-bg-val');
  const gWaveBlendObj = globalEl.querySelector('.sg-wave-blend-obj');
  const gWaveBlendObjV= globalEl.querySelector('.sg-wave-blend-obj-val');
  const gbThresh    = globalEl.querySelector('.sg-b-threshold');
  const gbStrength  = globalEl.querySelector('.sg-b-strength');
  const gbRadius    = globalEl.querySelector('.sg-b-radius');
  const gbvThresh   = globalEl.querySelector('.sg-bv-threshold');
  const gbvStr      = globalEl.querySelector('.sg-bv-strength');
  const gbvRad      = globalEl.querySelector('.sg-bv-radius');

  gLightSel.addEventListener('change', () => {
    globalConfig.lighting = parseInt(gLightSel.value);
    gWaveRow.style.display = globalConfig.lighting === 10 ? 'flex' : 'none';
    applyGlobal(pane, globalConfig);
  });
  gWaveBlendBg.addEventListener('input', () => {
    globalConfig.waveBlendBg = parseFloat(gWaveBlendBg.value);
    gWaveBlendBgV.textContent = globalConfig.waveBlendBg.toFixed(2);
    pane.waveBlendBg = globalConfig.waveBlendBg;
  });
  gWaveBlendObj.addEventListener('input', () => {
    globalConfig.waveBlendObj = parseFloat(gWaveBlendObj.value);
    gWaveBlendObjV.textContent = globalConfig.waveBlendObj.toFixed(2);
    pane.waveBlendObj = globalConfig.waveBlendObj;
  });
  gbThresh.addEventListener('input', () => {
    globalConfig.bloom.threshold = parseFloat(gbThresh.value);
    gbvThresh.textContent = globalConfig.bloom.threshold.toFixed(2);
    applyBloom(pane, globalConfig.bloom);
  });
  gbStrength.addEventListener('input', () => {
    globalConfig.bloom.strength = parseFloat(gbStrength.value);
    gbvStr.textContent = globalConfig.bloom.strength.toFixed(2);
    applyBloom(pane, globalConfig.bloom);
  });
  gbRadius.addEventListener('input', () => {
    globalConfig.bloom.radius = parseFloat(gbRadius.value);
    gbvRad.textContent = globalConfig.bloom.radius.toFixed(2);
    applyBloom(pane, globalConfig.bloom);
  });

  // ── Per-stem sections ───────────────────────────────────────────────────
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
    stemEl.className = 'sp-stem' + (i === currentWinnerId ? ' active' : '');
    stemEl.dataset.idx = i;

    stemEl.innerHTML = `
      <div class="sp-stem-header">
        <div class="sp-stem-name">${stem.label}</div>
        <div class="sp-prominence-bar-bg"><div class="sp-prominence-bar-fill"></div></div>
        <div class="sp-active-dot"></div>
        <button class="sp-solo-btn" data-stem="${i}">Solo</button>
      </div>
      <div class="sp-row">
        <span class="sp-label">Type</span>
        <select class="sp-select s-type">
          <option value="form"${cfg.type==='form'?' selected':''}>Form</option>
          <option value="amplitude"${cfg.type==='amplitude'?' selected':''}>Amplitude</option>
          <option value="history"${cfg.type==='history'?' selected':''}>History</option>
          <option value="frequency"${cfg.type==='frequency'?' selected':''}>Frequency</option>
        </select>
      </div>
      <div class="sp-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sp-label">Category</span>
        <select class="sp-select s-category">${buildSelect(catOpts, catKey)}</select>
        <span class="sp-label" style="margin-left:4px">Shape</span>
        <select class="sp-select s-shape">${buildShapeOptions(shapeList, cfg.shapeIdx??0)}</select>
        <span class="sp-label" style="margin-left:4px">Effect</span>
        <select class="sp-select s-effect">${buildSelect(EFFECTS[effType], effVal)}</select>
      </div>
      <div class="sp-row s-form-rows" style="display:${isForm?'flex':'none'}">
        <span class="sp-label">Mode</span>
        <select class="sp-select s-mode">
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
      if (i === currentWinnerId) {
        applyConfig(pane, stemConfigs[i]);
      }
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

    stemEl.querySelector('.sp-solo-btn').addEventListener('click', () => {
      const wasActive = soloStemId === i;
      soloStemId = wasActive ? null : i;
      panel.querySelectorAll('.sp-solo-btn').forEach(btn => {
        btn.classList.toggle('active', !wasActive && parseInt(btn.dataset.stem) === i);
      });
    });
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const mainCanvas    = document.getElementById('main-canvas');
  const chartCanvas   = document.getElementById('chart-canvas');
  const chartCtx      = chartCanvas.getContext('2d');
  const settingsPanel = document.getElementById('settings-panel');
  const playBtn       = document.getElementById('play-btn');
  const aaBtn         = document.getElementById('aa-btn');
  const scoreBtn      = document.getElementById('score-btn');
  const settingsBtn   = document.getElementById('settings-btn');
  const camLightBtn   = document.getElementById('cam-light-btn');
  const seekEl      = document.getElementById('seek');
  const timeCur     = document.getElementById('time-current');
  const timeTot     = document.getElementById('time-total');
  const loadingEl   = document.getElementById('loading');

  // ── Fetch shaders ────────────────────────────────────────────────────────
  const [
    fragSdfTmpl, fragPlatonicTmpl, fragScalarTmpl, fragMovingTmpl,
    vertSrc, sdfFuncSrc, sdfMarcherSrc, scalarMarcherSrc,
    platonicFuncSrc, movingScalarSrc, rimLightSrc, deformSrc,
    fragFillSrc, fragFormTmpl,
  ] = await Promise.all([
    fetch('../../../demos/sound-shapes/shaders/fragment-sdf.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-shapes/shaders/fragment-platonic.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-shapes/shaders/fragment-scalar.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-shapes/shaders/fragment-moving.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-shapes/shaders/vertex.glsl').then(r=>r.text()),
    fetch('../../../shaders/sdf-functions.glsl').then(r=>r.text()),
    fetch('../../../shaders/sdf-marcher.glsl').then(r=>r.text()),
    fetch('../../../shaders/scalar-marcher.glsl').then(r=>r.text()),
    fetch('../../../shaders/platonic-functions.glsl').then(r=>r.text()),
    fetch('../../../shaders/moving-scalar-functions.glsl').then(r=>r.text()),
    fetch('../../../shaders/rim-lighting.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-shapes/shaders/deform.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-fill/shaders/fragment.glsl').then(r=>r.text()),
    fetch('../../../demos/sound-form/shaders/fragment.glsl').then(r=>r.text()),
  ]);

  function buildFrag(tmpl, subs) {
    let s = tmpl;
    for (const [k,v] of Object.entries(subs)) s = s.replace(k, v);
    return s;
  }

  function injectOrbit(src) {
    src = src.replace(
      'precision highp float;',
      'precision highp float;\nuniform mat3 u_camRot;\nuniform float u_camDist;\nuniform vec2 u_camPan;\nuniform mat3 u_lightRot;\nuniform sampler2D u_fillTexBg;'
    );
    // Inject sampleFillMapBg alongside sampleFillMap (same projection, different texture)
    src = src.replace(
      '  vec3 c = texture2D(u_fillTex, uv).rgb;\n  return c * c;\n}',
      '  vec3 c = texture2D(u_fillTex, uv).rgb;\n  return c * c;\n}\n\nvec3 sampleFillMapBg(vec3 dir) {\n  float u = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5 + iTime * 0.02;\n  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;\n  vec2  uv = (vec2(u, v) - 0.5) / u_envScale + 0.5;\n  float uf = fract(uv.x);\n  uv.x = uf < 0.5 ? uf * 2.0 : (1.0 - uf) * 2.0;\n  uv.y = clamp(uv.y, 0.0, 1.0);\n  vec3 c = texture2D(u_fillTexBg, uv).rgb;\n  return c * c;\n}'
    );
    // Background miss path uses fillTexBg; object lighting (fillLight) uses fillTex
    src = src.replace(
      'sampleFillMap(rd) * amp',
      'sampleFillMapBg(rd) * amp'
    );
    src = src.replace(
      /vec3 ro = vec3\([^)]+\);/,
      'vec3 ro = u_camRot * vec3(0.0, 0.0, u_camDist);'
    );
    src = src.replace(
      /vec3 vv = cross\(uu, ww\);/,
      'vec3 vv = cross(uu, ww);\n  ro += uu * u_camPan.x + vv * u_camPan.y;'
    );
    // Before the first lighting call, inject lnor/lrd in lighting space.
    // u_lightRot = identity (world-fixed) or transpose(camRot) (camera-relative).
    // Original nor/rd stay untouched so the SSS thickness trace loop is unaffected.
    src = src.replace(
      '  if (u_lighting == 1) return flashLight(nor, rd);',
      '  vec3 lnor = normalize(u_lightRot * nor);\n  vec3 lrd = normalize(u_lightRot * rd);\n  if (u_lighting == 1) return flashLight(lnor, lrd);'
    );
    src = src.replace(/envLight\(nor, rd,/g,  'envLight(lnor, lrd,');
    src = src.replace(/fillLight\(nor, rd,/g, 'fillLight(lnor, lrd,');
    src = src.replace(/rimLight\(pos, nor, rd,/g, 'rimLight(pos, lnor, lrd,');
    return src;
  }
  const movingRenamed = movingScalarSrc.replace(/\bsurfaceF\b/g, 'baseScalarF');

  const shaders = {
    vert:        vertSrc,
    fragFill:    fragFillSrc,
    fragSdf:     injectOrbit(buildFrag(fragSdfTmpl,      {'// INCLUDE_SDF_FUNCTIONS':sdfFuncSrc,'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SDF_MARCHER':sdfMarcherSrc,'// INCLUDE_DEFORM':deformSrc})),
    fragPlatonic:injectOrbit(buildFrag(fragPlatonicTmpl, {'// INCLUDE_PLATONIC_FUNCTIONS':platonicFuncSrc,'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SDF_MARCHER':sdfMarcherSrc,'// INCLUDE_DEFORM':deformSrc})),
    fragScalar:  injectOrbit(buildFrag(fragScalarTmpl,   {'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SCALAR_MARCHER':scalarMarcherSrc,'// INCLUDE_DEFORM':deformSrc})),
    fragMoving:  injectOrbit(buildFrag(fragMovingTmpl,   {'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SCALAR_MARCHER':scalarMarcherSrc,'// INCLUDE_DEFORM':deformSrc,'// INCLUDE_MOVING_SCALAR_FUNCTIONS':movingRenamed})),
    fragForm:    injectOrbit(fragFormTmpl.replace('// INCLUDE_RIM_LIGHTING', rimLightSrc)),
  };

  // ── Load stem bins ───────────────────────────────────────────────────────
  const bars = buildLoadingRows();
  const buffers = await Promise.all(
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
  );

  const allFrames = {};
  STEMS.forEach((s, i) => { allFrames[s.id] = parseBinary(buffers[i]); });

  // Compute onset data for all stems
  const onsetData = STEMS.map(s => computeOnset(allFrames[s.id]));

  loadingEl.classList.add('fade-out');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once:true });

  // ── Master audio ─────────────────────────────────────────────────────────
  const audio = new Audio(SOUND_BASE + MASTER_MP3);
  audio.preload = 'auto';

  let isPlaying = false, seeking = false, rafId = null;
  let chartVisible = false;

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
    requestAnimationFrame(() => renderFrame(START_TIME));
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
    audio.currentTime = (seekEl.value/10000)*(audio.duration||0);
    seeking = false;
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  // ── Env map + pane ───────────────────────────────────────────────────────
  const envTex = buildEnvMapTexture(THREE, 256, 128);
  const pane = createPane(mainCanvas, shaders, envTex);
  buildPaneComposer(pane);

  // Deep-copy stem defaults so settings panel can mutate them
  const stemConfigs = STEM_DEFAULTS.map(d => ({ ...d }));

  // Global lighting + bloom config
  const globalConfig = { ...GLOBAL_DEFAULT, bloom: { ...GLOBAL_DEFAULT.bloom } };

  // Apply initial config
  currentWinnerId = 0;
  pane.trackFrames = allFrames[STEMS[0].id];
  applyConfig(pane, stemConfigs[0]);
  applyGlobal(pane, globalConfig);

  // ── Embedded resize ──────────────────────────────────────────────────────
  const embedded = new URLSearchParams(location.search).has('embedded');
  if (embedded) {
    mainCanvas.width  = 960;
    mainCanvas.height = 540;
    resizePane(pane);
  }

  // ── SSAA ─────────────────────────────────────────────────────────────────
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    pane.shared.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  // ── Camera light toggle ───────────────────────────────────────────────────
  camLightBtn.addEventListener('click', () => {
    camLightCam = camLightBtn.classList.toggle('active');
    camLightBtn.setAttribute('aria-label', camLightCam ? 'Light: camera' : 'Light: world');
    updateCamUniforms();
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  // ── Scores toggle ────────────────────────────────────────────────────────
  scoreBtn.addEventListener('click', () => {
    chartVisible = scoreBtn.classList.toggle('active');
    chartCanvas.style.display = chartVisible ? 'block' : 'none';
    scoreBtn.setAttribute('aria-label', chartVisible ? 'Scores on' : 'Scores off');
  });

  // ── Settings toggle ──────────────────────────────────────────────────────
  settingsBtn.addEventListener('click', () => {
    const opening = settingsPanel.hidden;
    settingsPanel.hidden = !opening;
    settingsBtn.classList.toggle('active', opening);
  });

  // ── Build settings panel ──────────────────────────────────────────────────
  buildSettingsPanel(settingsPanel, stemConfigs, globalConfig, pane);

  // ── Orbit controls ────────────────────────────────────────────────────────
  function updateCamUniforms() {
    const ct = Math.cos(camTheta), st = Math.sin(camTheta);
    const cp = Math.cos(camPhi),   sp = Math.sin(camPhi);
    pane.shared.u_camRot.value.set(
      ct,  -st * sp,  st * cp,
      0,    cp,       sp,
      -st, -ct * sp,  ct * cp
    );
    pane.shared.u_camDist.value = camDist;
    pane.shared.u_camPan.value.set(camPanX, camPanY);
    if (camLightCam) {
      pane.shared.u_lightRot.value.copy(pane.shared.u_camRot.value).transpose();
    } else {
      pane.shared.u_lightRot.value.identity();
    }
  }
  updateCamUniforms();
  mainCanvas.style.cursor = 'grab';

  let isDragging = false, lastMX = 0, lastMY = 0;
  mainCanvas.addEventListener('mousedown', e => {
    isDragging = true; lastMX = e.clientX; lastMY = e.clientY;
    mainCanvas.style.cursor = e.shiftKey ? 'move' : 'grabbing';
  });
  window.addEventListener('mouseup', () => { isDragging = false; mainCanvas.style.cursor = 'grab'; });
  window.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx = e.clientX - lastMX;
    const dy = e.clientY - lastMY;
    if (e.shiftKey) {
      const sensitivity = camDist * 0.0015;
      camPanX -= dx * sensitivity;
      camPanY += dy * sensitivity;
    } else {
      camTheta -= dx * 0.005;
      camPhi = Math.max(-1.4, Math.min(1.4, camPhi - dy * 0.005));
    }
    lastMX = e.clientX; lastMY = e.clientY;
    updateCamUniforms();
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });
  mainCanvas.addEventListener('wheel', e => {
    e.preventDefault();
    camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, camDist * (1 + e.deltaY * 0.001)));
    updateCamUniforms();
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  }, { passive: false });

  let lastPinchDist = 0;
  mainCanvas.addEventListener('touchstart', e => {
    if (e.touches.length === 1) { isDragging = true; lastMX = e.touches[0].clientX; lastMY = e.touches[0].clientY; }
    if (e.touches.length === 2) lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  }, { passive: true });
  mainCanvas.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && isDragging) {
      camTheta -= (e.touches[0].clientX - lastMX) * 0.005;
      camPhi = Math.max(-1.4, Math.min(1.4, camPhi - (e.touches[0].clientY - lastMY) * 0.005));
      lastMX = e.touches[0].clientX; lastMY = e.touches[0].clientY;
      updateCamUniforms();
      if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
    }
    if (e.touches.length === 2 && lastPinchDist) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      camDist = Math.max(CAM_DIST_MIN, Math.min(CAM_DIST_MAX, camDist * (lastPinchDist / d)));
      lastPinchDist = d;
      updateCamUniforms();
      if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
    }
  }, { passive: true });
  mainCanvas.addEventListener('touchend', () => { isDragging = false; lastPinchDist = 0; });

  // ── Render loop ──────────────────────────────────────────────────────────
  const globalStart = performance.now();

  function renderFrame(audioTime) {
    const wallTime = (performance.now() - globalStart) * 0.001;
    const frameIdx = Math.floor(audioTime * FPS);

    // Compute prominence and pick winner
    const scores = computeProminence(frameIdx, allFrames, onsetData);
    const winner = soloStemId !== null ? soloStemId : pickWinner(scores);
    switchToStem(pane, winner, stemConfigs, allFrames);

    // Update textures and render
    updatePaneTextures(pane, pane.trackFrames, audioTime);
    renderPane(pane, wallTime);

    // Draw chart if visible
    if (chartVisible) drawProminenceChart(chartCtx, scores);

    // Update prominence bars in settings panel
    if (!settingsPanel.hidden) {
      settingsPanel.querySelectorAll('.sp-stem').forEach((el, i) => {
        el.querySelector('.sp-prominence-bar-fill').style.width = `${(scores[i] * 100).toFixed(1)}%`;
      });
    }
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    renderFrame(audio.currentTime);
  }

  // ── Initial static frame ─────────────────────────────────────────────────
  requestAnimationFrame(() => renderFrame(START_TIME));
}

init();
