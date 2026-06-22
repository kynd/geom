import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { buildEnvMapTexture } from '../../js/oklch-envmap.js';

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
const HIST = 256;

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

function melDB(v) {
  return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 80) / 80));
}

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

async function init() {
  const canvas      = document.getElementById('canvas');
  const playBtn     = document.getElementById('play-btn');
  const aaBtn       = document.getElementById('aa-btn');
  const soundSel    = document.getElementById('sound-select');
  const modeSel     = document.getElementById('mode-select');
  const lightingSel = document.getElementById('lighting-select');
  const W = canvas.width, H = canvas.height;

  const [fragTmpl, vertSrc, rimLightSrc, fillFragSrc] = await Promise.all([
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('../sound-shapes/shaders/vertex.glsl').then(r => r.text()),
    fetch('../../shaders/rim-lighting.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/fragment.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTmpl.replace('// INCLUDE_RIM_LIGHTING', rimLightSrc);

  const histBuf = new Uint8Array(1 * HIST * 4);
  const histTex = new THREE.DataTexture(histBuf, 1, HIST, THREE.RGBAFormat);
  histTex.magFilter = THREE.LinearFilter;
  histTex.minFilter = THREE.LinearFilter;
  histTex.needsUpdate = true;

  const fftBuf = new Uint8Array(128 * 4);
  const fftTex = new THREE.DataTexture(fftBuf, 128, 1, THREE.RGBAFormat);
  fftTex.magFilter = THREE.LinearFilter;
  fftTex.minFilter = THREE.LinearFilter;
  fftTex.needsUpdate = true;

  const specBuf = new Uint8Array(128 * HIST * 4);
  const specTex = new THREE.DataTexture(specBuf, 128, HIST, THREE.RGBAFormat);
  specTex.magFilter = THREE.LinearFilter;
  specTex.minFilter = THREE.LinearFilter;
  specTex.wrapS = THREE.ClampToEdgeWrapping;
  specTex.wrapT = THREE.RepeatWrapping;
  specTex.needsUpdate = true;

  const wavBuf = new Uint8Array(128 * 4);
  const wavTex = new THREE.DataTexture(wavBuf, 128, 1, THREE.RGBAFormat);
  wavTex.magFilter = THREE.LinearFilter;
  wavTex.minFilter = THREE.LinearFilter;
  wavTex.needsUpdate = true;

  const envTex = buildEnvMapTexture(THREE, 256, 128);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const fillTarget = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    iResolution:  { value: new THREE.Vector2(W, H) },
    iTime:        { value: 0.0 },
    u_ampL:       { value: 0.0 },
    u_ampR:       { value: 0.0 },
    u_ampMono:    { value: 0.0 },
    u_ssaa:       { value: 0 },
    u_lighting:   { value: 9 },
    u_mode:       { value: 7 },
    u_intensity:  { value: 1.0 },
    u_histTex:    { value: histTex },
    u_fftTex:     { value: fftTex },
    u_envMap:     { value: envTex },
    u_rimPow:     { value: 3.0 },
    u_base:       { value: 0.0 },
    u_sssDensity: { value: 2.5 },
    u_sssStr:     { value: 0.3 },
    u_fillTex:    { value: fillTarget.texture },
    u_envScale:   { value: 1.0 },
    u_specTex:    { value: specTex },
    u_histHead:   { value: 1.0 },
  };

  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc }),
  ));

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
  fillScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms: fillUniforms, vertexShader: vertSrc, fragmentShader: fillFragSrc }),
  ));

  const renderPass = new RenderPass(scene, cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.5, 0.1);
  const composer   = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);

  let frames = [], audio = null, isPlaying = false;
  const globalStart = performance.now();

  function updateTextures(audioTime) {
    if (!frames.length) return;
    const idx = Math.min(frames.length - 1, Math.floor(audioTime * FPS));
    for (let row = 0; row < HIST; row++) {
      const fi   = Math.max(0, idx - (HIST - 1 - row));
      const fr   = frames[fi];
      const base = row * 4;
      histBuf[base]     = Math.round(Math.min(fr.ampL, 1) * 255);
      histBuf[base + 1] = Math.round(Math.min(fr.ampR, 1) * 255);
      histBuf[base + 2] = Math.round(Math.min((fr.ampL + fr.ampR) * 0.5, 1) * 255);
      histBuf[base + 3] = 255;
      const brow = row * 128 * 4;
      for (let bin = 0; bin < 128; bin++) {
        specBuf[brow + bin * 4]     = Math.round(melDB(fr.fftL[bin]) * 255);
        specBuf[brow + bin * 4 + 1] = Math.round(melDB(fr.fftR[bin]) * 255);
        specBuf[brow + bin * 4 + 3] = 255;
      }
    }
    histTex.needsUpdate = true;
    specTex.needsUpdate = true;
    const fr = frames[idx];
    for (let bin = 0; bin < 128; bin++) {
      fftBuf[bin * 4]     = Math.round(melDB(fr.fftL[bin]) * 255);
      fftBuf[bin * 4 + 1] = Math.round(melDB(fr.fftR[bin]) * 255);
      fftBuf[bin * 4 + 3] = 255;
    }
    fftTex.needsUpdate = true;
    for (let i = 0; i < 128; i++) {
      wavBuf[i * 4]     = histBuf[Math.floor(i * HIST / 128) * 4 + 2];
      wavBuf[i * 4 + 3] = 255;
    }
    wavTex.needsUpdate = true;
    let bassSum = 0, midSum = 0, trebleSum = 0;
    for (let i = 0; i < 128; i++) {
      const v = melDB(fr.fftL[i]);
      if (i <= 15) bassSum += v; else if (i <= 80) midSum += v; else trebleSum += v;
    }
    fillUniforms.u_bass.value   = bassSum / 16;
    fillUniforms.u_mid.value    = midSum / 65;
    fillUniforms.u_treble.value = trebleSum / 47;
    fillUniforms.u_amp.value    = Math.min((fr.ampL + fr.ampR) * 0.5, 1);
  }

  let rafId = null;

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    const wallTime  = (ts - globalStart) * 0.001;
    const audioTime = audio ? audio.currentTime : 0;
    const fr = frames.length > 0
      ? frames[Math.min(Math.floor(audioTime * FPS), frames.length - 1)]
      : null;

    uniforms.iTime.value     = wallTime;
    uniforms.u_ampL.value    = fr ? Math.min(fr.ampL, 1) : 0;
    uniforms.u_ampR.value    = fr ? Math.min(fr.ampR, 1) : 0;
    uniforms.u_ampMono.value = fr ? Math.min((fr.ampL + fr.ampR) * 0.5, 1) : 0;
    if (fr) updateTextures(audioTime);

    fillUniforms.iTime.value = wallTime;
    if (uniforms.u_lighting.value >= 3) {
      fillUniforms.u_mode.value = uniforms.u_lighting.value - 3;
      renderer.setRenderTarget(fillTarget);
      renderer.render(fillScene, cam);
      renderer.setRenderTarget(null);
    }

    composer.render();
  }

  function setPlaying(play) {
    isPlaying = play;
    playBtn.innerHTML = play ? pauseIcon() : playIcon();
    if (play) {
      if (rafId === null) rafId = requestAnimationFrame(loop);
      if (audio) audio.play().catch(() => {});
    } else {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      if (audio) audio.pause();
    }
  }

  async function loadSound(fileObj) {
    const wasPlaying = isPlaying;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    isPlaying = false;
    frames = [];
    histBuf.fill(0); fftBuf.fill(0);
    specBuf.fill(0); wavBuf.fill(0);
    histTex.needsUpdate = true; fftTex.needsUpdate = true;
    specTex.needsUpdate = true; wavTex.needsUpdate = true;

    const basePath = `../../sound/highlights/${fileObj.base}`;
    frames = parseBinary(await fetch(`${basePath}.bin`).then(r => r.arrayBuffer()));
    const startFrame = findStartFrame(frames);

    audio = new Audio(`${basePath}.mp3`);
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = startFrame / FPS;
      if (wasPlaying) setPlaying(true);
    });
    audio.addEventListener('ended', () => {
      isPlaying = false;
      playBtn.innerHTML = playIcon();
      audio.currentTime = findStartFrame(frames) / FPS;
    });
    playBtn.innerHTML = playIcon();
  }

  playBtn.innerHTML = playIcon();
  playBtn.addEventListener('click', () => {
    if (frames.length) setPlaying(!isPlaying);
  });

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  modeSel.addEventListener('change', () => {
    uniforms.u_mode.value = parseInt(modeSel.value);
  });

  lightingSel.addEventListener('change', () => {
    uniforms.u_lighting.value = parseInt(lightingSel.value);
  });

  soundSel.addEventListener('change', () => {
    const f = SOUND_FILES.find(x => x.value === soundSel.value) || SOUND_FILES[0];
    loadSound(f);
  });

  document.getElementById('intensity-slider').addEventListener('input', e => {
    const v = parseFloat(e.target.value);
    uniforms.u_intensity.value = v;
    document.getElementById('intensity-val').textContent = v.toFixed(2);
  });

  document.getElementById('bloom-strength').addEventListener('input', e => {
    bloomPass.strength = parseFloat(e.target.value);
    document.getElementById('bloom-strength-val').textContent = bloomPass.strength.toFixed(2);
  });
  document.getElementById('bloom-threshold').addEventListener('input', e => {
    bloomPass.threshold = parseFloat(e.target.value);
    document.getElementById('bloom-threshold-val').textContent = bloomPass.threshold.toFixed(2);
  });

  if (uniforms.u_lighting.value >= 3) {
    fillUniforms.u_mode.value = uniforms.u_lighting.value - 3;
    renderer.setRenderTarget(fillTarget);
    renderer.render(fillScene, cam);
    renderer.setRenderTarget(null);
  }
  composer.render();
  loadSound(SOUND_FILES.find(x => x.value === 'master'));
}

init();
