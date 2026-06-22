import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const SOUND_FILES = [
  { value: 'arp',    base: '250621_a1_mix1_arp' },
  { value: 'bass',   base: '250621_a1_mix1_bass' },
  { value: 'hat',    base: '250621_a1_mix1_hat' },
  { value: 'kick1',  base: '250621_a1_mix1_kick1' },
  { value: 'kick2',  base: '250621_a1_mix1_kick2' },
  { value: 'pad',    base: '250621_a1_mix1_pad' },
  { value: 'snare',  base: '250621_a1_mix1_snare' },
  { value: 'master', base: '250621_a1_mix1_master_88.2k24' },
];

const FPS  = 60;
const BINS = 128;  // mel frequency bins (columns in texture)
// 16 beats at 170 BPM @ 60 fps: one texture row per audio frame, one full cycle per wrap
const HIST = Math.ceil(16 * 60 * FPS / 170);  // = 339

// Camera orbits at fixed distance from origin via world-space rotations.
// Horizontal drag → world Y axis; vertical drag → world X axis.
// Stored as a 3×3 row-major rotation matrix. Camera position = col-2 × CAM_DIST.
const CAM_DIST = Math.sqrt(2.8 ** 2 + 5.5 ** 2);
const initPhi  = Math.atan2(2.8, 5.5);            // ≈ 0.4708 rad
const cp = Math.cos(initPhi), sp = Math.sin(initPhi);
// Ry(initPhi): maps (0,0,1) → (sp,0,cp) = initial camera direction
let camMat = [cp, 0, sp,  0, 1, 0,  -sp, 0, cp];
let camElevAngle = 0;                              // tracks cumulative X-rotation for clamping

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const frames = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    frames[i] = {
      ampL: f32[o],
      ampR: f32[o + 1],
      fftL: f32.subarray(o + 2,   o + 130),
      fftR: f32.subarray(o + 130, o + 258),
    };
  }
  return frames;
}

function findStartFrame(frames) {
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].ampL + frames[i].ampR > 0.0001) return i;
  }
  return 0;
}

// Convert linear mel-bin amplitude to a normalised 0–1 value using a dB scale.
function melDB(v) {
  return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 80) / 80));
}

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const aaBtn    = document.getElementById('aa-btn');
  const selectEl = document.getElementById('sound-select');
  const W = canvas.width, H = canvas.height;

  const [fragTmpl, sdfMarcherSrc, lightingSrc, vertSrc] = await Promise.all([
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('../../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);
  const fragSrc = fragTmpl
    .replace('// INCLUDE_SDF_MARCHER', sdfMarcherSrc)
    .replace('// INCLUDE_LIGHTING', lightingSrc);

  // History texture: BINS wide × HIST tall, R channel stores melDB value 0–255.
  // Row 0 = oldest frame, row HIST-1 = newest frame.
  const histBuf = new Uint8Array(BINS * HIST * 4);
  const histTex = new THREE.DataTexture(histBuf, BINS, HIST, THREE.RGBAFormat);
  histTex.magFilter = THREE.LinearFilter;
  histTex.minFilter = THREE.LinearFilter;
  histTex.needsUpdate = true;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_ampL:      { value: 0.0 },
    u_ampR:      { value: 0.0 },
    u_ssaa:      { value: 0 },
    u_histTex:   { value: histTex },
    u_ro:        { value: new THREE.Vector3(2.8, 0.0, 5.5) },
    u_shape:     { value: 0 },
    u_radius:    { value: 0.55 },
    u_height:    { value: 1.2 },
    u_bump:      { value: 0.22 },
    u_lighting:  { value: 0 },
  };

  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc }),
  ));

  const renderPass = new RenderPass(scene, cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), 1.2, 0.6, 0.0);
  const composer   = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  let frames = [], startFrame = 0;
  let isPlaying = false, audio = null;
  let startTs = null, pausedAt = 0, rafId = null;

  function updateHistTex(audioTime) {
    if (!frames.length) return;
    const currentIdx = Math.min(frames.length - 1, Math.floor(audioTime * FPS));
    for (let row = 0; row < HIST; row++) {
      const fi = Math.max(0, currentIdx - (HIST - 1 - row));
      const fr = frames[fi];
      for (let bin = 0; bin < BINS; bin++) {
        const v = Math.round(melDB((fr.fftL[bin] + fr.fftR[bin]) * 0.5) * 255);
        histBuf[(row * BINS + bin) * 4 + 0] = v;
        histBuf[(row * BINS + bin) * 4 + 3] = 255;
      }
    }
    histTex.needsUpdate = true;
  }

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    const elapsed   = isPlaying && startTs !== null
      ? pausedAt + (ts - startTs) * 0.001
      : pausedAt;
    const audioTime = audio ? audio.currentTime : 0;
    const fr        = frames.length > 0
      ? frames[Math.min(Math.floor(audioTime * FPS), frames.length - 1)]
      : null;

    uniforms.iTime.value  = elapsed;
    uniforms.u_ampL.value = fr ? fr.ampL : 0;
    uniforms.u_ampR.value = fr ? fr.ampR : 0;
    updateHistTex(audioTime);
    composer.render();
  }

  function setPlaying(play) {
    if (!audio || !frames.length) return;
    isPlaying = play;
    playBtn.innerHTML = play ? pauseIcon() : playIcon();
    if (play) {
      startTs = performance.now();
      audio.play().catch(() => {});
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else {
      if (startTs !== null) pausedAt += (performance.now() - startTs) * 0.001;
      startTs = null;
      audio.pause();
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  async function loadSound(fileObj) {
    const wasPlaying = isPlaying;
    if (startTs !== null) pausedAt += (performance.now() - startTs) * 0.001;
    startTs  = null;
    pausedAt = 0;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    isPlaying = false;
    frames    = [];

    const basePath = `../../../sound/highlights/${fileObj.base}`;
    frames     = parseBinary(await fetch(`${basePath}.bin`).then(r => r.arrayBuffer()));
    startFrame = findStartFrame(frames);

    audio = new Audio(`${basePath}.mp3`);
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = startFrame / FPS;
      if (wasPlaying) setPlaying(true);
    });
    audio.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.innerHTML = playIcon();
      audio.currentTime = startFrame / FPS;
    });
    playBtn.innerHTML = playIcon();
  }

  playBtn.innerHTML = playIcon();
  playBtn.addEventListener('click', () => { if (frames.length) setPlaying(!isPlaying); });

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  selectEl.addEventListener('change', () => {
    loadSound(SOUND_FILES.find(f => f.value === selectEl.value) || SOUND_FILES[0]);
  });

  const heightRow = document.getElementById('height-row');
  document.querySelectorAll('.shape-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const shape = parseInt(btn.dataset.shape);
      uniforms.u_shape.value = shape;
      // Height control only meaningful for tube (0) and cone (2)
      heightRow.style.opacity = shape === 1 ? '0.3' : '1';
      heightRow.style.pointerEvents = shape === 1 ? 'none' : 'all';
      if (!isPlaying && !rafId) composer.render();
    });
  });

  document.querySelectorAll('.light-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.light-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      uniforms.u_lighting.value = parseInt(btn.dataset.light);
      if (!isPlaying && !rafId) composer.render();
    });
  });

  document.getElementById('radius-slider').addEventListener('input', e => {
    uniforms.u_radius.value = parseFloat(e.target.value);
    document.getElementById('radius-val').textContent = parseFloat(e.target.value).toFixed(2);
    if (!isPlaying && !rafId) composer.render();
  });

  document.getElementById('height-slider').addEventListener('input', e => {
    uniforms.u_height.value = parseFloat(e.target.value);
    document.getElementById('height-val').textContent = parseFloat(e.target.value).toFixed(2);
    if (!isPlaying && !rafId) composer.render();
  });

  document.getElementById('bump-slider').addEventListener('input', e => {
    uniforms.u_bump.value = parseFloat(e.target.value);
    document.getElementById('bump-val').textContent = parseFloat(e.target.value).toFixed(2);
    if (!isPlaying && !rafId) composer.render();
  });

  document.getElementById('bloom-strength').addEventListener('input', e => {
    bloomPass.strength = parseFloat(e.target.value);
    document.getElementById('bloom-strength-val').textContent = bloomPass.strength.toFixed(2);
  });
  document.getElementById('bloom-threshold').addEventListener('input', e => {
    bloomPass.threshold = parseFloat(e.target.value);
    document.getElementById('bloom-threshold-val').textContent = bloomPass.threshold.toFixed(2);
  });

  function updateCamera() {
    // Camera position is the third column of camMat scaled by CAM_DIST
    uniforms.u_ro.value.set(
      camMat[2] * CAM_DIST,
      camMat[5] * CAM_DIST,
      camMat[8] * CAM_DIST,
    );
    if (!isPlaying && !rafId) composer.render();
  }

  // Apply a world-Y rotation to camMat in-place (horizontal drag)
  function rotateWorldY(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = camMat;
    camMat = [
      c*m[0]+s*m[6],  c*m[1]+s*m[7],  c*m[2]+s*m[8],
      m[3],           m[4],           m[5],
      -s*m[0]+c*m[6], -s*m[1]+c*m[7], -s*m[2]+c*m[8],
    ];
  }

  // Apply a world-X rotation to camMat in-place (vertical drag)
  function rotateWorldX(angle) {
    const c = Math.cos(angle), s = Math.sin(angle);
    const m = camMat;
    camMat = [
      m[0],            m[1],            m[2],
      c*m[3]-s*m[6],  c*m[4]-s*m[7],  c*m[5]-s*m[8],
      s*m[3]+c*m[6],  s*m[4]+c*m[7],  s*m[5]+c*m[8],
    ];
  }

  // Mouse orbit — world-space X and Y axis rotations
  let dragActive = false, dragX = 0, dragY = 0;
  canvas.addEventListener('pointerdown', e => {
    dragActive = true;
    dragX = e.clientX;
    dragY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragActive) return;
    const dx = e.clientX - dragX;
    const dy = e.clientY - dragY;
    dragX = e.clientX;
    dragY = e.clientY;
    const scale = Math.PI / canvas.clientWidth;
    if (dx !== 0) rotateWorldY(-dx * scale);
    if (dy !== 0) {
      // Clamp total elevation to avoid camera-up singularity
      const newElev = Math.max(-Math.PI * 0.44, Math.min(Math.PI * 0.44, camElevAngle + dy * scale));
      const delta = newElev - camElevAngle;
      camElevAngle = newElev;
      if (delta !== 0) rotateWorldX(delta);
    }
    updateCamera();
  });
  canvas.addEventListener('pointerup', () => {
    dragActive = false;
    canvas.style.cursor = 'grab';
  });
  canvas.addEventListener('pointercancel', () => {
    dragActive = false;
    canvas.style.cursor = 'grab';
  });

  composer.render();
  loadSound(SOUND_FILES[0]);
}

init();
