import * as THREE from 'three';

const SOUND_FILES = [
  { value: 'arp',    label: 'arp',    base: '250621_a1_mix1_arp' },
  { value: 'bass',   label: 'bass',   base: '250621_a1_mix1_bass' },
  { value: 'hat',    label: 'hat',    base: '250621_a1_mix1_hat' },
  { value: 'kick1',  label: 'kick 1', base: '250621_a1_mix1_kick1' },
  { value: 'kick2',  label: 'kick 2', base: '250621_a1_mix1_kick2' },
  { value: 'pad',    label: 'pad',    base: '250621_a1_mix1_pad' },
  { value: 'snare',  label: 'snare',  base: '250621_a1_mix1_snare' },
  { value: 'master', label: 'master', base: '250621_a1_mix1_master_88.2k24' },
];

const FPS            = 60;
const NUM_BANDS      = 128;
const HISTORY_FRAMES = 300; // 5 seconds

let frames = [], startFrame = 0, currentFrame = 0;
let isPlaying = false, audio = null;

function parseData(text) {
  return text.split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const v = l.trim().split(/\s+/).map(Number);
      const ampL = v[0], ampR = v[1];
      const fftL = v.slice(2, 130), fftR = v.slice(130, 258);
      return { ampL, ampR, fftL, fftR, amp: (ampL + ampR) * 0.5, fft: fftL };
    });
}

function findStartFrame(data, threshold = 0.0001) {
  for (let i = 0; i < data.length; i++) if (data[i].amp > threshold) return i;
  return 0;
}

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const selectEl = document.getElementById('sound-select');
  const W = canvas.width, H = canvas.height;

  const [lightSrc, fragTmpl, vertSrc] = await Promise.all([
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);
  const fragSrc = fragTmpl.replace('// INCLUDE_LIGHTING', lightSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // History texture: width=NUM_BANDS, height=HISTORY_FRAMES, RGBA Uint8
  // Row 0 = current frame (newest), row HISTORY_FRAMES-1 = oldest
  const histData    = new Uint8Array(NUM_BANDS * HISTORY_FRAMES * 4);
  const histTexture = new THREE.DataTexture(
    histData, NUM_BANDS, HISTORY_FRAMES,
    THREE.RGBAFormat, THREE.UnsignedByteType
  );
  histTexture.minFilter = THREE.LinearFilter;
  histTexture.magFilter = THREE.LinearFilter;
  histTexture.needsUpdate = true;

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_history:   { value: histTexture },
    u_amp:       { value: 0.0 },
    u_ssaa:      { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  let startTs = null, pauseStart = 0, rafId = null;

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (startTs === null) startTs = ts;
    uniforms.iTime.value = (ts - startTs) * 0.001;
    currentFrame = Math.min(Math.floor(audio.currentTime * FPS), frames.length - 1);
    if (frames.length > 0) {
      const f = frames[Math.min(currentFrame, frames.length - 1)];
      uniforms.u_amp.value = f.amp;
      histData.copyWithin(NUM_BANDS * 4, 0, NUM_BANDS * (HISTORY_FRAMES - 1) * 4);
      for (let b = 0; b < NUM_BANDS; b++) {
        histData[b * 4]     = Math.round(f.fftL[b] * 255);
        histData[b * 4 + 1] = Math.round(f.fftR[b] * 255);
        histData[b * 4 + 3] = 255;
      }
      histTexture.needsUpdate = true;
    }
    renderer.render(scene, cam);
  }

  function setPlaying(play) {
    if (!audio) return;
    isPlaying = play;
    playBtn.innerHTML = play ? pauseIcon() : playIcon();
    if (play) {
      if (pauseStart > 0) { startTs += performance.now() - pauseStart; pauseStart = 0; }
      audio.play().catch(() => {});
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else {
      audio.pause();
      pauseStart = performance.now();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }

  async function loadSound(fileObj) {
    const wasPlaying = isPlaying;
    setPlaying(false);
    startTs = null; pauseStart = 0;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    frames = []; currentFrame = 0;
    histData.fill(0);
    histTexture.needsUpdate = true;

    const basePath = `../../sound/${fileObj.base}`;
    frames     = parseData(await fetch(`${basePath}.txt`).then(r => r.text()));
    startFrame = findStartFrame(frames);
    currentFrame = startFrame;

    audio = new Audio(`${basePath}.mp3`);
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = startFrame / FPS;
      if (wasPlaying) setPlaying(true);
    });
    audio.addEventListener('ended', () => {
      setPlaying(false);
      currentFrame = startFrame;
      audio.currentTime = startFrame / FPS;
    });
    if (!wasPlaying) playBtn.innerHTML = playIcon();
  }

  playBtn.innerHTML = playIcon();
  playBtn.addEventListener('click', () => { if (frames.length) setPlaying(!isPlaying); });

  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });
  selectEl.addEventListener('change', () => {
    loadSound(SOUND_FILES.find(f => f.value === selectEl.value) || SOUND_FILES[0]);
  });
  loadSound(SOUND_FILES[0]);
}

init();
