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
  'Hyperboloid','Monkey saddle','Wave surface','Ripple','Ellipsoid',
];
const MOVING_SHAPES = [
  'Traveling ripple','Rippling torus','Wave sheet','Pulsing sphere',
  'Oscillating saddle','Gyroid','Schwartz P','Lemniscate surface',
  'Swaying ellipsoid','Tanglecube','Chmutov T₄','Rippled cone',
  'Pulsing Gaussian','Schoen I-WP','Saddle blend','Twisted torus',
  'Bumpy sphere','Wavy hyperboloid','Permuted cubic','Flipping paraboloid',
];
const FORM_MODES = [
  'Radial spectrum','Band interference','Spectrogram drum','Frequency tube',
  'Temporal shell','Harmonic rings','Spectrogram cone','Frequency terrain',
  'Spectral helix','Box ribbon',
];
const EFFECTS = {
  amplitude: [{v:1,l:'Inflate'},{v:2,l:'Squash'},{v:3,l:'Spikes'}],
  history:   [{v:4,l:'Ripple'},{v:5,l:'Rings'},{v:6,l:'Twist'}],
  frequency: [{v:7,l:'EQ'},{v:8,l:'Contour'},{v:9,l:'Shear'}],
};
const LIGHTING_OPTIONS = [
  {v:0,l:'Rim'},{v:1,l:'Flash'},{v:2,l:'Env'},
  {v:3,l:'Wave · anisotropic'},{v:4,l:'Phase portrait'},{v:5,l:'Crystal · drift'},
  {v:6,l:'Spectrogram'},{v:7,l:'Bilateral spectrogram'},
  {v:8,l:'Spectral bands · hue'},{v:9,l:'Spectral bands · hue + L'},
];
const TRACKS = [
  {value:'arp',   label:'arp',    bin:'250621_a1_mix1_arp.bin'},
  {value:'bass',  label:'bass',   bin:'250621_a1_mix1_bass.bin'},
  {value:'hat',   label:'hat',    bin:'250621_a1_mix1_hat.bin'},
  {value:'kick1', label:'kick 1', bin:'250621_a1_mix1_kick1.bin'},
  {value:'kick2', label:'kick 2', bin:'250621_a1_mix1_kick2.bin'},
  {value:'pad',   label:'pad',    bin:'250621_a1_mix1_pad.bin'},
  {value:'snare', label:'snare',  bin:'250621_a1_mix1_snare.bin'},
  {value:'master',label:'master', bin:'250621_a1_mix1_master_88.2k24.bin',
                                  mp3:'250621_a1_mix1_master_88.2k24.mp3'},
];
const SOUND_BASE = '../../sound/full/';
const FPS        = 60;
const HIST       = 256;
const PLAT_CYCLE = 5.0;
const START_TIME = 120;

const PANE_DEFAULTS = [
  { type:'form',      formMode:8, lighting:5, track:'master' },
  { type:'form',      formMode:4, lighting:5, track:'hat'    },
  { type:'frequency', category:'moving',   shapeIdx:12, effect:8, lighting:5, track:'bass' },
  { type:'amplitude', category:'platonic', shapeIdx:0, effect:3, lighting:5, track:'pad'  },
];

// ── Bloom state ───────────────────────────────────────────────────────────────

const BLOOM = { threshold: 0.1, strength: 1.0, radius: 0.35 };
let bloomMode = 'pane'; // 'pane' | 'composite'

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

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

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
  return TRACKS.map(t => {
    const row = document.createElement('div');
    row.className = 'load-row';
    row.innerHTML =
      `<span class="load-name">${t.label}</span>` +
      `<div class="load-bar-bg"><div class="load-bar-fill indeterminate"></div></div>` +
      `<span class="load-pct"></span>`;
    container.appendChild(row);
    return { fill:row.querySelector('.load-bar-fill'), pct:row.querySelector('.load-pct') };
  });
}

// ── Pane creation ─────────────────────────────────────────────────────────────

function createPane(shaders, envTex) {
  const canvas = document.createElement('canvas');
  canvas.className = 'pane-canvas';
  canvas.width  = 480;
  canvas.height = 456;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias:false });
  renderer.setSize(canvas.width, canvas.height, false);
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

  const W = canvas.width, H = canvas.height;
  const fillTarget = new THREE.WebGLRenderTarget(W, H, {
    minFilter:THREE.LinearFilter, magFilter:THREE.LinearFilter,
  });
  const offTarget = new THREE.WebGLRenderTarget(W, H, {
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
    u_envScale:     { value: 1.0 },
    u_mode:         { value: 7 },
    u_intensity:    { value: 1.0 },
    u_specTex:      { value: specTex },
    u_histHead:     { value: 1.0 },
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
    fillTarget, fillScene, fillUniforms,
    offTarget,
    scenes, shared, sdfU, platU, scalarU, movingU,
    composer: null, bloomPass: null, renderPass: null,
    miniCtx: null,
    activeScene: scenes.form,
    trackFrames: null,
    config: {},
  };
}

// ── Bloom composer per pane ───────────────────────────────────────────────────

function buildPaneComposer(pane) {
  const W = pane.canvas.width, H = pane.canvas.height;
  const renderPass = new RenderPass(pane.activeScene, pane.cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const composer   = new EffectComposer(pane.renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  pane.renderPass = renderPass;
  pane.bloomPass  = bloomPass;
  pane.composer   = composer;
}

// ── Compositor (composite bloom mode) ────────────────────────────────────────

function createCompositor(canvasEl) {
  const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias:false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam   = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const scene = new THREE.Scene();

  const meshes = [0,1,2,3].map(() => {
    const mat  = new THREE.MeshBasicMaterial({ map: null });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), mat);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, mat };
  });

  const renderPass = new RenderPass(scene, cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(1920, 996), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const composer   = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  return { canvas: canvasEl, renderer, cam, scene, meshes, composer, bloomPass };
}

// ── Per-pane UI ───────────────────────────────────────────────────────────────

function setupPaneUI(pane, paneEl, allTrackFrames, applyConfigFn) {
  const cfg    = pane.config;
  const isForm = cfg.type === 'form';
  const catOpts = [
    {v:'sdf',l:'SDF'},{v:'platonic',l:'Platonic'},
    {v:'scalar',l:'Scalar'},{v:'moving',l:'Moving scalar'},
  ];
  const catKey   = cfg.category || 'platonic';
  const shapeList= {sdf:SDF_SHAPES,platonic:PLATONIC_PAIRS,scalar:SCALAR_SURFACES,moving:MOVING_SHAPES}[catKey];
  const shapeIdx = cfg.shapeIdx ?? 0;
  const effType  = cfg.type !== 'form' ? cfg.type : 'amplitude';
  const effVal   = cfg.effect ?? EFFECTS[effType][0].v;
  const trackLabel = TRACKS.find(t=>t.value===cfg.track)?.label ?? cfg.track;

  const uiEl = document.createElement('div');
  uiEl.className = 'pane-ui';
  uiEl.innerHTML = `
    <canvas class="mini-graph" width="140" height="49"></canvas>
    <div class="pane-label">${trackLabel}</div>
    <button class="settings-btn" aria-label="Pane settings">⚙</button>
    <div class="settings-panel" hidden>
      <div class="settings-row">
        <span class="sl">Type</span>
        <select class="s-type ctrl-select">
          <option value="form"${cfg.type==='form'?' selected':''}>Form</option>
          <option value="amplitude"${cfg.type==='amplitude'?' selected':''}>Amplitude</option>
          <option value="history"${cfg.type==='history'?' selected':''}>History</option>
          <option value="frequency"${cfg.type==='frequency'?' selected':''}>Frequency</option>
        </select>
      </div>
      <div class="settings-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sl">Category</span>
        <select class="s-category ctrl-select">${buildSelect(catOpts, catKey)}</select>
      </div>
      <div class="settings-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sl">Shape</span>
        <select class="s-shape ctrl-select">${buildShapeOptions(shapeList, shapeIdx)}</select>
      </div>
      <div class="settings-row s-shape-rows" style="display:${isForm?'none':'flex'}">
        <span class="sl">Effect</span>
        <select class="s-effect ctrl-select">${buildSelect(EFFECTS[effType], effVal)}</select>
      </div>
      <div class="settings-row s-form-rows" style="display:${isForm?'flex':'none'}">
        <span class="sl">Mode</span>
        <select class="s-mode ctrl-select">
          ${FORM_MODES.map((m,i)=>`<option value="${i+1}"${(cfg.formMode??7)===(i+1)?' selected':''}>${m}</option>`).join('')}
        </select>
      </div>
      <div class="settings-row">
        <span class="sl">Lighting</span>
        <select class="s-lighting ctrl-select">${buildSelect(LIGHTING_OPTIONS, cfg.lighting??0)}</select>
      </div>
      <div class="settings-row">
        <span class="sl">Track</span>
        <select class="s-track ctrl-select">
          ${TRACKS.map(t=>`<option value="${t.value}"${t.value===cfg.track?' selected':''}>${t.label}</option>`).join('')}
        </select>
      </div>
    </div>
  `;
  paneEl.appendChild(uiEl);
  pane.miniCtx = uiEl.querySelector('.mini-graph').getContext('2d');

  const label       = uiEl.querySelector('.pane-label');
  const settingsBtn = uiEl.querySelector('.settings-btn');
  const panel       = uiEl.querySelector('.settings-panel');
  const typeSel     = uiEl.querySelector('.s-type');
  const catSel      = uiEl.querySelector('.s-category');
  const shapeSel    = uiEl.querySelector('.s-shape');
  const effectSel   = uiEl.querySelector('.s-effect');
  const modeSel     = uiEl.querySelector('.s-mode');
  const lightSel    = uiEl.querySelector('.s-lighting');
  const trackSel    = uiEl.querySelector('.s-track');
  const shapeRows   = uiEl.querySelectorAll('.s-shape-rows');
  const formRows    = uiEl.querySelectorAll('.s-form-rows');

  function showHideRows(isF) {
    shapeRows.forEach(r => r.style.display = isF ? 'none' : 'flex');
    formRows.forEach(r  => r.style.display = isF ? 'flex'  : 'none');
  }
  function populateShapeList(cat) {
    const list = {sdf:SDF_SHAPES,platonic:PLATONIC_PAIRS,scalar:SCALAR_SURFACES,moving:MOVING_SHAPES}[cat];
    shapeSel.innerHTML = list.map((n,i)=>`<option value="${i}">${n}</option>`).join('');
    shapeSel.value = '0';
  }
  function populateEffects(type) {
    const opts = EFFECTS[type] || EFFECTS.amplitude;
    effectSel.innerHTML = buildSelect(opts, opts[0].v);
  }
  function readAndApply() {
    const type = typeSel.value;
    pane.config = {
      type,
      category: catSel.value,
      shapeIdx: parseInt(shapeSel.value),
      effect:   parseInt(effectSel.value),
      formMode: parseInt(modeSel.value),
      lighting: parseInt(lightSel.value),
      track:    trackSel.value,
    };
    pane.trackFrames = allTrackFrames[trackSel.value];
    label.textContent = TRACKS.find(t=>t.value===trackSel.value)?.label ?? '';
    applyConfigFn(pane, pane.config);
  }

  settingsBtn.addEventListener('click', () => {
    const opening = panel.hidden;
    panel.hidden = !opening;
    settingsBtn.classList.toggle('open', opening);
  });
  typeSel.addEventListener('change', () => {
    const t = typeSel.value;
    showHideRows(t === 'form');
    if (t !== 'form') populateEffects(t);
    readAndApply();
  });
  catSel.addEventListener('change',    () => { populateShapeList(catSel.value); readAndApply(); });
  shapeSel.addEventListener('change',  readAndApply);
  effectSel.addEventListener('change', readAndApply);
  modeSel.addEventListener('change',   readAndApply);
  lightSel.addEventListener('change',  readAndApply);
  trackSel.addEventListener('change',  readAndApply);
}

// ── Apply config ──────────────────────────────────────────────────────────────

function applyConfig(pane, cfg) {
  const { scenes, shared, sdfU, platU, scalarU, movingU } = pane;
  shared.u_lighting.value = cfg.lighting ?? 0;

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

// ── Texture update ────────────────────────────────────────────────────────────

function updatePaneTextures(pane, audioTime) {
  const frames = pane.trackFrames;
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

// ── Mini graphs (2D canvas overlay) ──────────────────────────────────────────

function drawMiniGraphs(pane) {
  const ctx = pane.miniCtx;
  if (!ctx) return;
  const W = 140, FFT_H = 26, GAP = 3, HIST_H = 20;
  ctx.clearRect(0, 0, W, FFT_H + GAP + HIST_H);

  // FFT bars (top half)
  const BINS = 64;
  const bw = W / BINS;
  for (let i = 0; i < BINS; i++) {
    const v = pane.fftBuf[i * 2 * 4] / 255;
    const h = v * FFT_H;
    ctx.fillStyle = `rgba(255,255,255,${0.18 + v * 0.52})`;
    ctx.fillRect(i * bw, FFT_H - h, Math.max(bw - 0.5, 1), h);
  }

  // Amplitude history line (bottom half)
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  const top = FFT_H + GAP;
  for (let i = 0; i < HIST; i++) {
    const x = (i / (HIST - 1)) * W;
    const amp = pane.histBuf[i * 4 + 2] / 255;
    const y = top + HIST_H - amp * HIST_H;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── Render one pane ───────────────────────────────────────────────────────────

function renderPane(pane, wallTime, toOffTarget) {
  const { renderer,cam,fillScene,fillTarget,fillUniforms,shared,platU,activeScene } = pane;
  shared.iTime.value       = wallTime;
  fillUniforms.iTime.value = wallTime;

  if (shared.u_lighting.value >= 3) {
    fillUniforms.u_mode.value = shared.u_lighting.value - 3;
    renderer.setRenderTarget(fillTarget);
    renderer.render(fillScene, cam);
    renderer.setRenderTarget(null);
  }

  if (activeScene === pane.scenes.platonic) {
    const phase = (wallTime % PLAT_CYCLE) / PLAT_CYCLE;
    platU.u_t.value = 0.5 - 0.5 * Math.cos(phase * 2 * Math.PI);
  }

  if (toOffTarget) {
    renderer.setRenderTarget(pane.offTarget);
    renderer.render(activeScene, cam);
    renderer.setRenderTarget(null);
  } else {
    pane.renderPass.scene = activeScene;
    pane.composer.render();
  }
}

// ── Resize ────────────────────────────────────────────────────────────────────

function resizePane(pane, paneEl) {
  const W = paneEl.clientWidth  || 480;
  const H = paneEl.clientHeight || 456;
  pane.canvas.width  = W;
  pane.canvas.height = H;
  pane.canvas.style.width  = W + 'px';
  pane.canvas.style.height = H + 'px';
  pane.renderer.setSize(W, H, false);
  pane.fillTarget.setSize(W, H);
  pane.offTarget.setSize(W, H);
  pane.shared.iResolution.value.set(W, H);
  pane.fillUniforms.iResolution.value.set(W, H);
  if (pane.composer) {
    pane.composer.setSize(W, H);
    pane.bloomPass.resolution.set(W, H);
  }
}

function resizeCompositor(comp, W, H) {
  if (!W || !H) return;
  comp.canvas.width  = W;
  comp.canvas.height = H;
  comp.canvas.style.width  = W + 'px';
  comp.canvas.style.height = H + 'px';
  comp.renderer.setSize(W, H, false);
  comp.bloomPass.resolution.set(W, H);
  comp.composer.setSize(W, H);
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const panesEl     = document.getElementById('panes');
  const paneEls     = [...document.querySelectorAll('.pane')];
  const compCanvas  = document.getElementById('composite-canvas');
  const playBtn     = document.getElementById('play-btn');
  const aaBtn       = document.getElementById('aa-btn');
  const bloomBtn    = document.getElementById('bloom-btn');
  const bloomPanel  = document.getElementById('bloom-panel');
  const seekEl      = document.getElementById('seek');
  const timeCur     = document.getElementById('time-current');
  const timeTot     = document.getElementById('time-total');
  const loadingEl   = document.getElementById('loading');
  const pcBtns      = [...document.querySelectorAll('.pc-btn')];
  const bpmBtns     = [...document.querySelectorAll('.bpm-btn')];
  const bThreshold  = document.getElementById('b-threshold');
  const bStrength   = document.getElementById('b-strength');
  const bRadius     = document.getElementById('b-radius');
  const bvThreshold = document.getElementById('bv-threshold');
  const bvStrength  = document.getElementById('bv-strength');
  const bvRadius    = document.getElementById('bv-radius');

  // ── Fetch shaders ──────────────────────────────────────────────────────────
  const [
    fragSdfTmpl, fragPlatonicTmpl, fragScalarTmpl, fragMovingTmpl,
    vertSrc, sdfFuncSrc, sdfMarcherSrc, scalarMarcherSrc,
    platonicFuncSrc, movingScalarSrc, rimLightSrc, deformSrc,
    fragFillSrc, fragFormTmpl,
  ] = await Promise.all([
    fetch('../sound-shapes/shaders/fragment-sdf.glsl').then(r=>r.text()),
    fetch('../sound-shapes/shaders/fragment-platonic.glsl').then(r=>r.text()),
    fetch('../sound-shapes/shaders/fragment-scalar.glsl').then(r=>r.text()),
    fetch('../sound-shapes/shaders/fragment-moving.glsl').then(r=>r.text()),
    fetch('../sound-shapes/shaders/vertex.glsl').then(r=>r.text()),
    fetch('../../shaders/sdf-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r=>r.text()),
    fetch('../../shaders/scalar-marcher.glsl').then(r=>r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/moving-scalar-functions.glsl').then(r=>r.text()),
    fetch('../../shaders/rim-lighting.glsl').then(r=>r.text()),
    fetch('../sound-shapes/shaders/deform.glsl').then(r=>r.text()),
    fetch('../sound-fill/shaders/fragment.glsl').then(r=>r.text()),
    fetch('../sound-form/shaders/fragment.glsl').then(r=>r.text()),
  ]);

  function buildFrag(tmpl, subs) {
    let s = tmpl;
    for (const [k,v] of Object.entries(subs)) s = s.replace(k, v);
    return s;
  }
  const movingRenamed = movingScalarSrc.replace(/\bsurfaceF\b/g, 'baseScalarF');

  const shaders = {
    vert:        vertSrc,
    fragFill:    fragFillSrc,
    fragSdf:     buildFrag(fragSdfTmpl,      {'// INCLUDE_SDF_FUNCTIONS':sdfFuncSrc,'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SDF_MARCHER':sdfMarcherSrc,'// INCLUDE_DEFORM':deformSrc}),
    fragPlatonic:buildFrag(fragPlatonicTmpl, {'// INCLUDE_PLATONIC_FUNCTIONS':platonicFuncSrc,'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SDF_MARCHER':sdfMarcherSrc,'// INCLUDE_DEFORM':deformSrc}),
    fragScalar:  buildFrag(fragScalarTmpl,   {'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SCALAR_MARCHER':scalarMarcherSrc,'// INCLUDE_DEFORM':deformSrc}),
    fragMoving:  buildFrag(fragMovingTmpl,   {'// INCLUDE_RIM_LIGHTING':rimLightSrc,'// INCLUDE_SCALAR_MARCHER':scalarMarcherSrc,'// INCLUDE_DEFORM':deformSrc,'// INCLUDE_MOVING_SCALAR_FUNCTIONS':movingRenamed}),
    fragForm:    fragFormTmpl.replace('// INCLUDE_RIM_LIGHTING', rimLightSrc),
  };

  // ── Load tracks ────────────────────────────────────────────────────────────
  const bars = buildLoadingRows();
  const buffers = await Promise.all(
    TRACKS.map((t, i) =>
      fetch(SOUND_BASE + t.bin)
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
  TRACKS.forEach((t, i) => { allFrames[t.value] = parseBinary(buffers[i]); });

  loadingEl.classList.add('fade-out');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once:true });

  // ── Master audio ───────────────────────────────────────────────────────────
  const masterTrack = TRACKS.find(t => t.mp3);
  const audio = new Audio(SOUND_BASE + masterTrack.mp3);
  audio.preload = 'auto';

  let isPlaying = false, seeking = false, rafId = null;

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
  audio.addEventListener('ended', () => { isPlaying = false; updatePlayBtn(); rafId = null; });

  audio.addEventListener('loadedmetadata', () => {
    timeTot.textContent = formatTime(audio.duration);
    audio.currentTime   = START_TIME;
    seekEl.value = Math.round((START_TIME / (audio.duration || 1)) * 10000);
    timeCur.textContent = formatTime(START_TIME);
    requestAnimationFrame(() => renderAll(START_TIME));
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
    if (!isPlaying) requestAnimationFrame(() => renderAll(audio.currentTime));
  });

  // ── Env map ────────────────────────────────────────────────────────────────
  const envTex = buildEnvMapTexture(THREE, 256, 128);

  // ── Create panes ───────────────────────────────────────────────────────────
  const panes = paneEls.map((el, i) => {
    const pane = createPane(shaders, envTex);
    pane.config = { ...PANE_DEFAULTS[i] };
    pane.trackFrames = allFrames[PANE_DEFAULTS[i].track];
    el.appendChild(pane.canvas);
    applyConfig(pane, pane.config);
    setupPaneUI(pane, el, allFrames, applyConfig);
    return pane;
  });

  panes.forEach(p => buildPaneComposer(p));

  // ── Compositor ─────────────────────────────────────────────────────────────
  const compositor = createCompositor(compCanvas);

  // ── Bloom UI ───────────────────────────────────────────────────────────────
  bloomBtn.addEventListener('click', () => {
    const open = bloomPanel.hidden;
    bloomPanel.hidden = !open;
    bloomBtn.classList.toggle('active', open);
  });

  function applyBloomParams() {
    panes.forEach(p => {
      p.bloomPass.threshold = BLOOM.threshold;
      p.bloomPass.strength  = BLOOM.strength;
      p.bloomPass.radius    = BLOOM.radius;
    });
    compositor.bloomPass.threshold = BLOOM.threshold;
    compositor.bloomPass.strength  = BLOOM.strength;
    compositor.bloomPass.radius    = BLOOM.radius;
  }

  bThreshold.addEventListener('input', () => {
    BLOOM.threshold = parseFloat(bThreshold.value);
    bvThreshold.textContent = BLOOM.threshold.toFixed(2);
    applyBloomParams();
  });
  bStrength.addEventListener('input', () => {
    BLOOM.strength = parseFloat(bStrength.value);
    bvStrength.textContent = BLOOM.strength.toFixed(2);
    applyBloomParams();
  });
  bRadius.addEventListener('input', () => {
    BLOOM.radius = parseFloat(bRadius.value);
    bvRadius.textContent = BLOOM.radius.toFixed(2);
    applyBloomParams();
  });

  bpmBtns.forEach(b => b.addEventListener('click', () => {
    bloomMode = b.dataset.mode;
    bpmBtns.forEach(bb => bb.classList.toggle('active', bb === b));
    const isComp = bloomMode === 'composite';
    compCanvas.style.display = isComp ? 'block' : 'none';
    if (isComp) {
      requestAnimationFrame(() => {
        resizeCompositor(compositor, compCanvas.clientWidth, compCanvas.clientHeight);
        renderAll(audio.currentTime);
      });
    } else if (!isPlaying) {
      requestAnimationFrame(() => renderAll(audio.currentTime));
    }
  }));

  // ── SSAA ───────────────────────────────────────────────────────────────────
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    panes.forEach(p => { p.shared.u_ssaa.value = on ? 1 : 0; });
  });

  // ── Pane count ─────────────────────────────────────────────────────────────
  let activePaneCount = 4;

  function setPaneCount(n) {
    activePaneCount = n;
    panesEl.className = `layout-${n}`;
    pcBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.n) === n));
    paneEls.forEach((el, i) => el.classList.toggle('pane-visible', i < n));
    requestAnimationFrame(() => {
      paneEls.slice(0, n).forEach((el, i) => resizePane(panes[i], el));
      if (bloomMode === 'composite') {
        resizeCompositor(compositor, compCanvas.clientWidth, compCanvas.clientHeight);
      }
      renderAll(audio.currentTime);
    });
  }

  pcBtns.forEach(b => b.addEventListener('click', () => setPaneCount(parseInt(b.dataset.n))));

  // ── Compositor mesh layout helper ──────────────────────────────────────────
  function updateCompMeshes(N) {
    const w = 2 / N;
    compositor.meshes.forEach((m, i) => {
      m.mesh.visible = i < N;
      if (i < N) {
        m.mesh.scale.x    = w;
        m.mesh.position.x = -1 + w * (i + 0.5);
        if (m.mat.map !== panes[i].offTarget.texture) {
          m.mat.map = panes[i].offTarget.texture;
          m.mat.needsUpdate = true;
        }
      }
    });
  }

  // ── Render loop ────────────────────────────────────────────────────────────
  const globalStart = performance.now();

  function renderAll(audioTime) {
    const wallTime = (performance.now() - globalStart) * 0.001;
    const isComp   = bloomMode === 'composite';
    for (let i = 0; i < activePaneCount; i++) {
      updatePaneTextures(panes[i], audioTime);
      renderPane(panes[i], wallTime, isComp);
      drawMiniGraphs(panes[i]);
    }
    if (isComp) {
      updateCompMeshes(activePaneCount);
      compositor.composer.render();
    }
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    renderAll(audio.currentTime);
  }

  // ── Initial frame ──────────────────────────────────────────────────────────
  requestAnimationFrame(() => {
    paneEls.forEach((el, i) => resizePane(panes[i], el));
    renderAll(0);
  });
}

init();
