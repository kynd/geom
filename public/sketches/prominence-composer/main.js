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
const LIGHTING_OPTIONS = [
  {v:0,l:'Rim lighting'},{v:1,l:'Amplitude flash'},{v:2,l:'Environment map'},
  {v:3,l:'Anisotropic wave'},{v:4,l:'Normal phase portrait'},{v:5,l:'Drifting caustic'},
  {v:6,l:'Spectrogram'},{v:7,l:'Bilateral spectrogram'},
  {v:8,l:'Spectral hue'},{v:9,l:'Spectral hue-lightness'},
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
const SOUND_BASE  = '../../sound/full/';
const FPS         = 60;
const HIST        = 256;
const PLAT_CYCLE  = 5.0;
const START_TIME  = 0;
const ALPHA       = 0.92;   // onset decay
const BETA        = 5.0;    // prominence sharpness
const WIN_THRESH  = 0.20;   // min prominence to switch winner

const STEM_DEFAULTS = [
  // arp
  { type:'form', formMode:7, lighting:3, bloom:{threshold:0.08,strength:0.90,radius:0.35} },
  // bass
  { type:'history', category:'moving', shapeIdx:13, effect:4, lighting:3, bloom:{threshold:0.08,strength:0.30,radius:0.45} },
  // hat
  { type:'form', formMode:4, lighting:4, bloom:{threshold:0.08,strength:1.55,radius:0.22} },
  // kick1
  { type:'amplitude', category:'moving', shapeIdx:0, effect:1, lighting:3, bloom:{threshold:0.08,strength:0.35,radius:0.50} },
  // kick2
  { type:'amplitude', category:'moving', shapeIdx:2, effect:2, lighting:3, bloom:{threshold:0.08,strength:1.5,radius:0.42} },
  // pad
  { type:'form',      formMode:8, lighting:3, bloom:{threshold:0.05,strength:1.0,radius:0.44} },
  // snare
  { type:'frequency', category:'moving', shapeIdx:4, effect:9, lighting:3, bloom:{threshold:0.08,strength:1.00,radius:0.30} },
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

  const fillTarget = new THREE.WebGLRenderTarget(W, H, {
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

  pane.renderPass.scene = activeScene;
  pane.composer.render();
}

// ── Resize pane ───────────────────────────────────────────────────────────────

function resizePane(pane) {
  const W = pane.canvas.width, H = pane.canvas.height;
  pane.renderer.setSize(W, H, false);
  pane.fillTarget.setSize(W, H);
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
  applyBloom(pane, cfg.bloom);
  pane.trackFrames = allFrames[STEMS[stemId].id];
  document.querySelectorAll('.sd-section[data-stem]').forEach((el, i) =>
    el.classList.toggle('sd-active', i === stemId)
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

function buildSettingsPanel(panel, stemConfigs, pane, allFrames) {
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
        <span class="sd-label">Lighting</span>
        <select class="sd-select s-lighting" style="flex:1">${buildSelect(LIGHTING_OPTIONS, cfg.lighting??0)}</select>
      </div>
      <div class="sd-row">
        <span class="sd-label">Type</span>
        <select class="sd-select s-type" style="flex:1">
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
      <div style="font-family:'Sora',sans-serif;font-size:9px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:rgba(255,255,255,0.25);margin:6px 0 2px">Bloom</div>
      <div class="sd-row" style="flex-wrap:wrap;row-gap:4px">
        <span class="sd-label">Threshold</span>
        <input type="range" class="sl-track sd-sl s-b-threshold" min="0" max="1" step="0.01" value="${cfg.bloom.threshold}">
        <span class="sd-val s-bv-threshold">${cfg.bloom.threshold.toFixed(2)}</span>
        <span class="sd-label" style="width:auto;padding-left:6px">Strength</span>
        <input type="range" class="sl-track sd-sl s-b-strength" min="0" max="3" step="0.05" value="${cfg.bloom.strength}">
        <span class="sd-val s-bv-strength">${cfg.bloom.strength.toFixed(2)}</span>
        <span class="sd-label" style="width:auto;padding-left:6px">Radius</span>
        <input type="range" class="sl-track sd-sl s-b-radius" min="0" max="1" step="0.01" value="${cfg.bloom.radius}">
        <span class="sd-val s-bv-radius">${cfg.bloom.radius.toFixed(2)}</span>
      </div>
    `;

    panel.appendChild(stemEl);

    // Wire up controls
    const typeSel    = stemEl.querySelector('.s-type');
    const lightSel   = stemEl.querySelector('.s-lighting');
    const catSel     = stemEl.querySelector('.s-category');
    const shapeSel   = stemEl.querySelector('.s-shape');
    const effectSel  = stemEl.querySelector('.s-effect');
    const modeSel    = stemEl.querySelector('.s-mode');
    const shapeRows  = stemEl.querySelectorAll('.s-shape-rows');
    const formRows   = stemEl.querySelectorAll('.s-form-rows');
    const bThresh    = stemEl.querySelector('.s-b-threshold');
    const bStrength  = stemEl.querySelector('.s-b-strength');
    const bRadius    = stemEl.querySelector('.s-b-radius');
    const bvThresh   = stemEl.querySelector('.s-bv-threshold');
    const bvStrength = stemEl.querySelector('.s-bv-strength');
    const bvRadius   = stemEl.querySelector('.s-bv-radius');

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
        lighting: parseInt(lightSel.value),
        bloom: stemConfigs[i].bloom,
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
    lightSel.addEventListener('change', readAndApply);

    bThresh.addEventListener('input', () => {
      stemConfigs[i].bloom.threshold = parseFloat(bThresh.value);
      bvThresh.textContent = stemConfigs[i].bloom.threshold.toFixed(2);
      if (i === currentWinnerId) applyBloom(pane, stemConfigs[i].bloom);
    });
    bStrength.addEventListener('input', () => {
      stemConfigs[i].bloom.strength = parseFloat(bStrength.value);
      bvStrength.textContent = stemConfigs[i].bloom.strength.toFixed(2);
      if (i === currentWinnerId) applyBloom(pane, stemConfigs[i].bloom);
    });
    bRadius.addEventListener('input', () => {
      stemConfigs[i].bloom.radius = parseFloat(bRadius.value);
      bvRadius.textContent = stemConfigs[i].bloom.radius.toFixed(2);
      if (i === currentWinnerId) applyBloom(pane, stemConfigs[i].bloom);
    });

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
  const mainCanvas  = document.getElementById('main-canvas');
  const chartCanvas = document.getElementById('chart-canvas');
  const chartCtx    = chartCanvas.getContext('2d');
  const settingsPanel = document.getElementById('settings-panel');
  const playBtn     = document.getElementById('play-btn');
  const aaBtn       = document.getElementById('aa-btn');
  const scoreBtn    = document.getElementById('score-btn');
  const settingsBtn = document.getElementById('settings-btn');
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
  const stemConfigs = STEM_DEFAULTS.map(d => ({
    ...d,
    bloom: { ...d.bloom },
  }));

  // Apply initial config
  currentWinnerId = 0;
  pane.trackFrames = allFrames[STEMS[0].id];
  applyConfig(pane, stemConfigs[0]);
  applyBloom(pane, stemConfigs[0].bloom);

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
  buildSettingsPanel(settingsPanel, stemConfigs, pane, allFrames);

  // ── Panel close button ────────────────────────────────────────────────────
  {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'panel-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      settingsPanel.hidden = true;
      settingsBtn.classList.remove('active');
    });
    settingsPanel.insertBefore(closeBtn, settingsPanel.firstChild);
  }

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
      settingsPanel.querySelectorAll('.sd-section[data-stem]').forEach((el, i) => {
        el.querySelector('.sd-bar-fill').style.width = `${(scores[i] * 100).toFixed(1)}%`;
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
