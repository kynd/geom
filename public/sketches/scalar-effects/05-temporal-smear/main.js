import * as THREE from 'three';

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

const FPS = 60;
let frames = [], startFrame = 0, isPlaying = false, audio = null;

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const frames = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    frames[i] = { amp: (f32[o] + f32[o + 1]) * 0.5, ampL: f32[o], ampR: f32[o + 1], fftL: f32.subarray(o + 2, o + 130), fftR: f32.subarray(o + 130, o + 258) };
  }
  return frames;
}
function melDB(v) { return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 80) / 80)); }

function findStartFrame(data) {
  for (let i = 0; i < data.length; i++) if (data[i].amp > 0.0001) return i;
  return 0;
}

const PLAY_ICON  = `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`;
const PAUSE_ICON = `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`;

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const aaBtn    = document.getElementById('aa-btn');
  const selectEl = document.getElementById('sound-select');
  const W = canvas.width, H = canvas.height;

  const [fragSrc, vertSrc] = await Promise.all([
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const fftBuf = new Float32Array(128);
  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_amp:       { value: 0.0 },
    u_fft:       { value: fftBuf },
    u_ssaa:      { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  let startTs = null, pausedAt = 0, rafId = null;

  // Loop runs always — time advances regardless of audio state
  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (startTs === null) startTs = ts;
    uniforms.iTime.value = pausedAt + (ts - startTs) * 0.001;
    if (isPlaying && audio && frames.length > 0) {
      const idx = Math.min(Math.floor(audio.currentTime * FPS), frames.length - 1);
      const f = frames[idx];
      for (let _b = 0; _b < 128; _b++) fftBuf[_b] = melDB(f.fftL[_b]);
      uniforms.u_amp.value = f.amp;
    } else if (!isPlaying) {
      uniforms.u_amp.value *= 0.92; // decay FFT on pause
    }
    renderer.render(scene, cam);
  }

  async function loadSound(fileObj) {
    if (isPlaying) pause();
    if (audio) { audio.src = ''; audio = null; }
    frames = []; fftBuf.fill(0); uniforms.u_amp.value = 0;

    const base = `../../../sound/highlights/${fileObj.base}`;
    try {
      const resp = await fetch(`${base}.bin`);
      if (!resp.ok) throw new Error(resp.status);
      frames = parseBinary(await resp.arrayBuffer());
      startFrame = findStartFrame(frames);
    } catch {
      return; // no audio data; shape still animates
    }

    audio = new Audio(`${base}.mp3`);
    audio.addEventListener('ended', () => {
      pause();
      audio.currentTime = startFrame / FPS;
    });
    audio.currentTime = startFrame / FPS;
  }

  function play() {
    isPlaying = true;
    playBtn.innerHTML = PAUSE_ICON;
    if (rafId === null) { startTs = performance.now(); rafId = requestAnimationFrame(loop); }
    if (audio && frames.length) audio.play().catch(() => {});
  }

  function pause() {
    isPlaying = false;
    playBtn.innerHTML = PLAY_ICON;
    if (startTs !== null) { pausedAt += (performance.now() - startTs) * 0.001; startTs = null; }
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (audio) audio.pause();
  }

  playBtn.innerHTML = PLAY_ICON;
  playBtn.addEventListener('click', () => isPlaying ? pause() : play());

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  selectEl.addEventListener('change', () => loadSound(SOUND_FILES.find(f => f.value === selectEl.value)));

  loadSound(SOUND_FILES[0]);
}

init();
