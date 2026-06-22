import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildEnvMapTexture } from '../../js/oklch-envmap.js';

// ── Catalogues ────────────────────────────────────────────────────────────────

const SDF_SHAPES = [
  'Sphere','Box','Round box','Box frame','Torus','Capped torus','Link',
  'Cylinder','Cone','Infinite cone','Hex prism','Capsule',
  'Vertical capsule','Capped cylinder','Arb. cylinder','Rounded cylinder',
  'Capped cone','Arb. capped cone','Solid angle','Cut sphere',
  'Cut hollow sphere','Death star','Round cone','Arb. round cone',
  'Vesica segment','Rhombus','Octahedron','Octahedron (fast)','Pyramid',
  'Ellipsoid','Triangular prism',
  // Platonic solids
  'Cube','Tetrahedron','Dual tetrahedron','Dodecahedron','Icosahedron',
];

const EFFECTS = [
  {v:1,l:'Inflate'},{v:2,l:'Squash'},{v:3,l:'Spikes'},
  {v:4,l:'Ripple'},{v:5,l:'Rings'},{v:6,l:'Twist'},
  {v:7,l:'EQ'},{v:8,l:'Contour'},{v:9,l:'Shear'},
];

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
const START_TIME = 120;
const BLOOM      = { threshold: 0.25, strength: 2.0, radius: 0.2 };

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT = {
  shape1: 33,  track1: 'arp',  effect1: 9,   // Shear on A (left)
  shape2: 27,  track2: 'bass', effect2: 6,   // Twist on B (right)
  lighting: 3, dist: 1.0, blend: 0.6,
};

// ── Icons ─────────────────────────────────────────────────────────────────────

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

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

function melDB(v) { return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 80) / 80)); }

function makeDataTex(w, h) {
  const buf = new Uint8Array(w * h * 4);
  const tex = new THREE.DataTexture(buf, w, h, THREE.RGBAFormat);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return { buf, tex };
}

function buildOptions(items) {
  return items.map(o => `<option value="${o.v}">${o.l}</option>`).join('');
}
function buildShapeOptions(selectedIdx) {
  return SDF_SHAPES.map((n, i) =>
    `<option value="${i+1}"${i+1 === selectedIdx ? ' selected' : ''}>${n}</option>`
  ).join('');
}
function buildTrackOptions(selected) {
  return TRACKS.map(t =>
    `<option value="${t.value}"${t.value === selected ? ' selected' : ''}>${t.label}</option>`
  ).join('');
}
function buildEffectOptions(selected) {
  return EFFECTS.map(e =>
    `<option value="${e.v}"${e.v === selected ? ' selected' : ''}>${e.l}</option>`
  ).join('');
}
function buildLightingOptions(selected) {
  return LIGHTING_OPTIONS.map(o =>
    `<option value="${o.v}"${o.v === selected ? ' selected' : ''}>${o.l}</option>`
  ).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // DOM refs
  const shape1Sel   = document.getElementById('shape1-sel');
  const track1Sel   = document.getElementById('track1-sel');
  const effect1Sel  = document.getElementById('effect1-sel');
  const shape2Sel   = document.getElementById('shape2-sel');
  const track2Sel   = document.getElementById('track2-sel');
  const effect2Sel  = document.getElementById('effect2-sel');
  const sgABtn      = document.getElementById('sg-a-btn');
  const sgAPanel    = document.getElementById('sg-a-panel');
  const sgAName     = document.getElementById('sg-a-name');
  const sgBBtn      = document.getElementById('sg-b-btn');
  const sgBPanel    = document.getElementById('sg-b-panel');
  const sgBName     = document.getElementById('sg-b-name');
  const lightingSel = document.getElementById('lighting-sel');
  const distSlider      = document.getElementById('dist-slider');
  const distVal         = document.getElementById('dist-val');
  const blendSlider     = document.getElementById('blend-slider');
  const blendVal        = document.getElementById('blend-val');
  const intensitySlider = document.getElementById('intensity-slider');
  const intensityVal    = document.getElementById('intensity-val');
  const aaBtn       = document.getElementById('aa-btn');
  const bloomBtn    = document.getElementById('bloom-btn');
  const bloomPanel  = document.getElementById('bloom-panel');
  const playBtn     = document.getElementById('play-btn');
  const seekEl      = document.getElementById('seek');
  const timeCur     = document.getElementById('time-cur');
  const timeTot     = document.getElementById('time-tot');
  const loadingEl   = document.getElementById('loading');
  const canvasArea  = document.getElementById('canvas-area');
  const canvas      = document.getElementById('main-canvas');
  const bThreshold  = document.getElementById('b-threshold');
  const bStrength   = document.getElementById('b-strength');
  const bRadius     = document.getElementById('b-radius');
  const bvThreshold = document.getElementById('bv-threshold');
  const bvStrength  = document.getElementById('bv-strength');
  const bvRadius    = document.getElementById('bv-radius');

  // Populate dropdowns
  shape1Sel.innerHTML  = buildShapeOptions(DEFAULT.shape1);
  track1Sel.innerHTML  = buildTrackOptions(DEFAULT.track1);
  effect1Sel.innerHTML = buildEffectOptions(DEFAULT.effect1);
  shape2Sel.innerHTML  = buildShapeOptions(DEFAULT.shape2);
  track2Sel.innerHTML  = buildTrackOptions(DEFAULT.track2);
  effect2Sel.innerHTML = buildEffectOptions(DEFAULT.effect2);
  lightingSel.innerHTML = buildLightingOptions(DEFAULT.lighting);

  // ── Fetch shaders ──────────────────────────────────────────────────────────
  const [vertSrc, fragTmpl, sdfFuncSrc, platonicSrc, rimLightSrc, sdfMarcherSrc, fragFillSrc] = await Promise.all([
    fetch('./shaders/vertex.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-functions.glsl').then(r => r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r => r.text()),
    fetch('../../shaders/rim-lighting.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/fragment.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTmpl
    .replace('// INCLUDE_SDF_FUNCTIONS', sdfFuncSrc)
    .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicSrc)
    .replace('// INCLUDE_RIM_LIGHTING', rimLightSrc)
    .replace('// INCLUDE_SDF_MARCHER', sdfMarcherSrc);

  // ── Load tracks ────────────────────────────────────────────────────────────
  const loadingTracksEl = document.getElementById('loading-tracks');
  const bars = TRACKS.map(t => {
    const row = document.createElement('div');
    row.className = 'load-row';
    row.innerHTML =
      `<span class="load-name">${t.label}</span>` +
      `<div class="load-bar-bg"><div class="load-bar-fill indeterminate"></div></div>` +
      `<span class="load-pct"></span>`;
    loadingTracksEl.appendChild(row);
    return { fill: row.querySelector('.load-bar-fill'), pct: row.querySelector('.load-pct') };
  });

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
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });

  // ── Canvas size ────────────────────────────────────────────────────────────
  const W = canvasArea.clientWidth  || 1920;
  const H = canvasArea.clientHeight || 996;
  canvas.width  = W;
  canvas.height = H;

  // ── Audio ──────────────────────────────────────────────────────────────────
  const masterTrack = TRACKS.find(t => t.mp3);
  const audio       = new Audio(SOUND_BASE + masterTrack.mp3);
  audio.preload     = 'auto';

  let isPlaying = false, seeking = false, rafId = null;
  let startTime = null, pausedAt = 0;

  function updatePlayBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updatePlayBtn();

  function setPlaying(play) {
    if (play && !isPlaying) {
      startTime = performance.now();
      isPlaying = true;
      updatePlayBtn();
      audio.play().catch(() => {});
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else if (!play && isPlaying) {
      pausedAt += (performance.now() - startTime) * 0.001;
      isPlaying = false;
      updatePlayBtn();
      audio.pause();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }

  playBtn.addEventListener('click', () => setPlaying(!isPlaying));
  audio.addEventListener('ended', () => { isPlaying = false; updatePlayBtn(); rafId = null; });

  audio.addEventListener('loadedmetadata', () => {
    timeTot.textContent  = formatTime(audio.duration);
    audio.currentTime    = START_TIME;
    seekEl.value = Math.round((START_TIME / (audio.duration || 1)) * 10000);
    timeCur.textContent  = formatTime(START_TIME);
    requestAnimationFrame(() => renderFrame(START_TIME));
  });

  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = audio.currentTime, d = audio.duration || 1;
    seekEl.value        = Math.round((t / d) * 10000);
    timeCur.textContent = formatTime(t);
  });

  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
  seekEl.addEventListener('input', () => {
    timeCur.textContent = formatTime((seekEl.value / 10000) * (audio.duration || 0));
  });
  seekEl.addEventListener('change', () => {
    audio.currentTime = (seekEl.value / 10000) * (audio.duration || 0);
    seeking = false;
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  // ── Textures — shape 1 ─────────────────────────────────────────────────────
  const { buf: histBuf1, tex: histTex1 } = makeDataTex(1, HIST);
  const { buf: fftBuf1,  tex: fftTex1  } = makeDataTex(128, 1);

  // ── Textures — shape 2 ─────────────────────────────────────────────────────
  const { buf: histBuf2, tex: histTex2 } = makeDataTex(1, HIST);
  const { buf: fftBuf2,  tex: fftTex2  } = makeDataTex(128, 1);

  // ── Textures — fill (master track) ────────────────────────────────────────
  const { buf: histBufM, tex: histTexM } = makeDataTex(1, HIST);
  const { buf: fftBufM,  tex: fftTexM  } = makeDataTex(128, 1);
  const { buf: specBufM, tex: specTexM } = makeDataTex(128, HIST);
  const { buf: wavBufM,  tex: wavTexM  } = makeDataTex(128, 1);
  specTexM.wrapS = THREE.ClampToEdgeWrapping;
  specTexM.wrapT = THREE.RepeatWrapping;

  // ── Env map ────────────────────────────────────────────────────────────────
  const envTex = buildEnvMapTexture(THREE, 256, 128);

  // ── Renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── Fill render target ─────────────────────────────────────────────────────
  const fillTarget = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });

  // ── Fill scene ─────────────────────────────────────────────────────────────
  const fillUniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_mode:      { value: DEFAULT.lighting - 3 },
    u_ssaa:      { value: 0 },
    u_fftTex:    { value: fftTexM },
    u_specTex:   { value: specTexM },
    u_waveTex:   { value: wavTexM },
    u_envTex:    { value: histTexM },
    u_histHead:  { value: 1.0 },
    u_bass:      { value: 0.0 },
    u_mid:       { value: 0.0 },
    u_treble:    { value: 0.0 },
    u_amp:       { value: 0.0 },
  };
  const fillScene = new THREE.Scene();
  fillScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: fillUniforms, vertexShader: vertSrc, fragmentShader: fragFillSrc }),
  ));

  // ── Main uniforms ──────────────────────────────────────────────────────────
  const uniforms = {
    iResolution:    { value: new THREE.Vector2(W, H) },
    iTime:          { value: 0.0 },
    u_ssaa:         { value: 0 },
    u_lighting:     { value: DEFAULT.lighting },

    u_shape1:       { value: DEFAULT.shape1 },
    u_deform1:      { value: DEFAULT.effect1 },
    u_ampL1:        { value: 0.0 },
    u_ampR1:        { value: 0.0 },
    u_ampMono1:     { value: 0.0 },
    u_histTex1:     { value: histTex1 },
    u_fftTex1:      { value: fftTex1 },

    u_shape2:       { value: DEFAULT.shape2 },
    u_deform2:      { value: DEFAULT.effect2 },
    u_ampL2:        { value: 0.0 },
    u_ampR2:        { value: 0.0 },
    u_ampMono2:     { value: 0.0 },
    u_histTex2:     { value: histTex2 },
    u_fftTex2:      { value: fftTex2 },

    u_deformP1:     { value: 0.83 },
    u_deformP2:     { value: 0.83 },
    u_histDuration: { value: 1.0 },
    u_histSoften:   { value: 0.0 },
    u_ctrlN:        { value: 4.0 },
    u_twistAxisX:   { value: 0.0 },
    u_twistAxisZ:   { value: 0.0 },

    u_dist:         { value: DEFAULT.dist },
    u_blend:        { value: DEFAULT.blend },

    u_rimPow:       { value: 3.0 },
    u_base:         { value: 0.0 },
    u_sssDensity:   { value: 2.5 },
    u_sssStr:       { value: 0.3 },
    u_envMap:       { value: envTex },
    u_fillTex:      { value: fillTarget.texture },
    u_envScale:     { value: 1.0 },
    u_ampL:         { value: 0.0 },
    u_ampR:         { value: 0.0 },
  };

  // ── Main scene ─────────────────────────────────────────────────────────────
  const mainScene = new THREE.Scene();
  mainScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc }),
  ));

  // ── Effect composer ────────────────────────────────────────────────────────
  const renderPass = new RenderPass(mainScene, cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
  const composer   = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  // ── Texture update ─────────────────────────────────────────────────────────

  function updateHistFft(frames, idx, histBuf, fftBuf) {
    for (let row = 0; row < HIST; row++) {
      const fi = Math.max(0, idx - (HIST - 1 - row));
      const fr = frames[fi];
      const b  = row * 4;
      histBuf[b]   = Math.round(Math.min(fr.ampL, 1) * 255);
      histBuf[b+1] = Math.round(Math.min(fr.ampR, 1) * 255);
      histBuf[b+2] = Math.round(Math.min((fr.ampL + fr.ampR) * 0.5, 1) * 255);
      histBuf[b+3] = 255;
    }
    const fr = frames[idx];
    for (let bin = 0; bin < 128; bin++) {
      fftBuf[bin*4]   = Math.round(melDB(fr.fftL[bin]) * 255);
      fftBuf[bin*4+1] = Math.round(melDB(fr.fftR[bin]) * 255);
      fftBuf[bin*4+3] = 255;
    }
  }

  function updateTextures(audioTime) {
    const idx = Math.min(allFrames.master.length - 1, Math.max(0, Math.floor(audioTime * FPS)));

    const frames1 = allFrames[track1Sel.value] || allFrames.master;
    const frames2 = allFrames[track2Sel.value] || allFrames.master;
    const framesM = allFrames.master;

    const idx1 = Math.min(frames1.length - 1, idx);
    const idx2 = Math.min(frames2.length - 1, idx);

    updateHistFft(frames1, idx1, histBuf1, fftBuf1);
    updateHistFft(frames2, idx2, histBuf2, fftBuf2);

    histTex1.needsUpdate = true;
    fftTex1.needsUpdate  = true;
    histTex2.needsUpdate = true;
    fftTex2.needsUpdate  = true;

    const fr1 = frames1[idx1];
    uniforms.u_ampL1.value    = Math.min(fr1.ampL, 1);
    uniforms.u_ampR1.value    = Math.min(fr1.ampR, 1);
    uniforms.u_ampMono1.value = Math.min((fr1.ampL + fr1.ampR) * 0.5, 1);

    const fr2 = frames2[idx2];
    uniforms.u_ampL2.value    = Math.min(fr2.ampL, 1);
    uniforms.u_ampR2.value    = Math.min(fr2.ampR, 1);
    uniforms.u_ampMono2.value = Math.min((fr2.ampL + fr2.ampR) * 0.5, 1);

    const frM = framesM[idx];
    uniforms.u_ampL.value = Math.min(frM.ampL, 1);
    uniforms.u_ampR.value = Math.min(frM.ampR, 1);

    // Fill textures (master track)
    updateHistFft(framesM, idx, histBufM, fftBufM);
    for (let row = 0; row < HIST; row++) {
      const fi = Math.max(0, idx - (HIST - 1 - row));
      const fr = framesM[fi];
      const brow = row * 128 * 4;
      for (let bin = 0; bin < 128; bin++) {
        specBufM[brow + bin*4]   = Math.round(melDB(fr.fftL[bin]) * 255);
        specBufM[brow + bin*4+1] = Math.round(melDB(fr.fftR[bin]) * 255);
        specBufM[brow + bin*4+3] = 255;
      }
    }
    for (let i = 0; i < 128; i++) {
      wavBufM[i*4]   = histBufM[Math.floor(i * HIST / 128) * 4 + 2];
      wavBufM[i*4+3] = 255;
    }
    histTexM.needsUpdate = true;
    fftTexM.needsUpdate  = true;
    specTexM.needsUpdate = true;
    wavTexM.needsUpdate  = true;

    let bassSum = 0, midSum = 0, trebleSum = 0;
    for (let i = 0; i < 128; i++) {
      const v = melDB(frM.fftL[i]);
      if (i <= 15) bassSum += v; else if (i <= 80) midSum += v; else trebleSum += v;
    }
    fillUniforms.u_bass.value   = bassSum / 16;
    fillUniforms.u_mid.value    = midSum  / 65;
    fillUniforms.u_treble.value = trebleSum / 47;
    fillUniforms.u_amp.value    = Math.min((frM.ampL + frM.ampR) * 0.5, 1);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderFrame(audioTime, animTime) {
    const t = animTime !== undefined ? animTime : pausedAt;
    updateTextures(audioTime);
    uniforms.iTime.value       = t;
    fillUniforms.iTime.value   = t;

    if (uniforms.u_lighting.value >= 3) {
      fillUniforms.u_mode.value = uniforms.u_lighting.value - 3;
      renderer.setRenderTarget(fillTarget);
      renderer.render(fillScene, cam);
      renderer.setRenderTarget(null);
    }
    composer.render();
  }

  function loop() {
    rafId = requestAnimationFrame(loop);
    const animTime = pausedAt + (performance.now() - startTime) * 0.001;
    renderFrame(audio.currentTime, animTime);
  }

  // ── Controls ───────────────────────────────────────────────────────────────

  shape1Sel.addEventListener('change', () => {
    uniforms.u_shape1.value = parseInt(shape1Sel.value);
    sgAName.textContent = SDF_SHAPES[parseInt(shape1Sel.value) - 1];
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });
  track1Sel.addEventListener('change', () => {
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });
  effect1Sel.addEventListener('change', () => {
    uniforms.u_deform1.value = parseInt(effect1Sel.value);
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  shape2Sel.addEventListener('change', () => {
    uniforms.u_shape2.value = parseInt(shape2Sel.value);
    sgBName.textContent = SDF_SHAPES[parseInt(shape2Sel.value) - 1];
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });
  track2Sel.addEventListener('change', () => {
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });
  effect2Sel.addEventListener('change', () => {
    uniforms.u_deform2.value = parseInt(effect2Sel.value);
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  lightingSel.addEventListener('change', () => {
    uniforms.u_lighting.value = parseInt(lightingSel.value);
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  distSlider.addEventListener('input', () => {
    const v = parseFloat(distSlider.value);
    uniforms.u_dist.value = v;
    distVal.textContent   = v.toFixed(2);
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  blendSlider.addEventListener('input', () => {
    const v = parseFloat(blendSlider.value);
    uniforms.u_blend.value = v;
    blendVal.textContent   = v.toFixed(2);
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  intensitySlider.addEventListener('input', () => {
    const v = parseFloat(intensitySlider.value);
    uniforms.u_deformP1.value = v;
    uniforms.u_deformP2.value = v;
    intensityVal.textContent  = v.toFixed(2);
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  });

  // Gear panels (A / B shape settings)
  const sgAWrap = document.getElementById('sg-a-wrap');
  const sgBWrap = document.getElementById('sg-b-wrap');

  function closeAllPanels() {
    sgAPanel.hidden = true; sgABtn.classList.remove('open'); sgABtn.setAttribute('aria-expanded', 'false');
    sgBPanel.hidden = true; sgBBtn.classList.remove('open'); sgBBtn.setAttribute('aria-expanded', 'false');
    bloomPanel.hidden = true; bloomBtn.classList.remove('active');
  }

  function toggleSgPanel(btn, panel) {
    const wasHidden = panel.hidden;
    closeAllPanels();
    if (wasHidden) { panel.hidden = false; btn.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
  }

  sgABtn.addEventListener('click', e => { e.stopPropagation(); toggleSgPanel(sgABtn, sgAPanel); });
  sgBBtn.addEventListener('click', e => { e.stopPropagation(); toggleSgPanel(sgBBtn, sgBPanel); });

  document.addEventListener('click', e => {
    if (!sgAWrap.contains(e.target) && !sgBWrap.contains(e.target)) {
      sgAPanel.hidden = true; sgABtn.classList.remove('open'); sgABtn.setAttribute('aria-expanded', 'false');
      sgBPanel.hidden = true; sgBBtn.classList.remove('open'); sgBBtn.setAttribute('aria-expanded', 'false');
    }
  });

  bloomBtn.addEventListener('click', e => {
    e.stopPropagation();
    const open = bloomPanel.hidden;
    // close gear panels first
    sgAPanel.hidden = true; sgABtn.classList.remove('open'); sgABtn.setAttribute('aria-expanded', 'false');
    sgBPanel.hidden = true; sgBBtn.classList.remove('open'); sgBBtn.setAttribute('aria-expanded', 'false');
    bloomPanel.hidden = !open;
    bloomBtn.classList.toggle('active', open);
  });

  function applyBloom() {
    bloomPass.threshold = BLOOM.threshold;
    bloomPass.strength  = BLOOM.strength;
    bloomPass.radius    = BLOOM.radius;
    if (!isPlaying) requestAnimationFrame(() => renderFrame(audio.currentTime));
  }

  bThreshold.addEventListener('input', () => {
    BLOOM.threshold = parseFloat(bThreshold.value);
    bvThreshold.textContent = BLOOM.threshold.toFixed(2);
    applyBloom();
  });
  bStrength.addEventListener('input', () => {
    BLOOM.strength = parseFloat(bStrength.value);
    bvStrength.textContent = BLOOM.strength.toFixed(2);
    applyBloom();
  });
  bRadius.addEventListener('input', () => {
    BLOOM.radius = parseFloat(bRadius.value);
    bvRadius.textContent = BLOOM.radius.toFixed(2);
    applyBloom();
  });
}

init().catch(console.error);
