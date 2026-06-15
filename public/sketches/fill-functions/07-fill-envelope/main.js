import * as THREE from 'three';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const TRACKS = [
  { label: 'Master', mp3: '250621_a1_mix1_master_88.2k24.mp3', bin: '250621_a1_mix1_master_88.2k24.bin' },
  { label: 'Arp',    mp3: '250621_a1_mix1_arp.mp3',            bin: '250621_a1_mix1_arp.bin' },
  { label: 'Bass',   mp3: '250621_a1_mix1_bass.mp3',           bin: '250621_a1_mix1_bass.bin' },
  { label: 'Hat',    mp3: '250621_a1_mix1_hat.mp3',            bin: '250621_a1_mix1_hat.bin' },
  { label: 'Kick 1', mp3: '250621_a1_mix1_kick1.mp3',          bin: '250621_a1_mix1_kick1.bin' },
  { label: 'Kick 2', mp3: '250621_a1_mix1_kick2.mp3',          bin: '250621_a1_mix1_kick2.bin' },
  { label: 'Pad',    mp3: '250621_a1_mix1_pad.mp3',            bin: '250621_a1_mix1_pad.bin' },
  { label: 'Snare',  mp3: '250621_a1_mix1_snare.mp3',          bin: '250621_a1_mix1_snare.bin' },
];

const MODE_NAMES = [
  'Spectrogram',
  'Phase portrait',
  'Wave · anisotropic',
  'Crystal · drift',
  'Radial spectrum',
  'Waveform ring',
  'Cosine product',
  'Polar harmonics',
  'Phase modulation',
  'Circular spectrogram',
];

const MODE_DESCS = [
  'Frequency on x, time scrolling downward. Hue maps across the full 360° wheel from bass to treble.',
  'Waveform plotted against a delayed copy. Gaussian density reveals where the signal trajectory lingers.',
  '12 plane waves with x compressed 0.4×. Pixel x-position sweeps hue left-to-right across the interference.',
  '7 waves each drifting at a different rate. Nested cosine re-maps the sum into sharp bands.',
  '24 FFT bins as concentric glowing rings; radius encodes frequency, hue follows radius.',
  'Waveform mapped to a polar curve r(θ). Soft glow traces the shape — spiky on transients, smooth on tones.',
  'cos(x·fx)·cos(y·fy) with bass and treble driving the two frequencies independently.',
  'FFT bins activate angular harmonics cos(θ·n). Low bins give wide petals; treble gives fine structure.',
  'Radial cosine waves phase-shifted by the live waveform at each angle, bending rings into the signal shape.',
  'Angle encodes frequency, radius encodes time — the polar counterpart of the spectrogram.',
];

const CYCLE_INTERVAL = 9000;
const FPS      = 60;
const FFT_BINS = 256;
const HIST     = 256;
const SOUND_BASE = '../../../sound/highlights/';

// ── Texture data buffers ──────────────────────────────────────────────────────

const fftBuf  = new Uint8Array(FFT_BINS * 4);
const specBuf = new Uint8Array(FFT_BINS * HIST * 4);
const envBuf  = new Uint8Array(HIST * 4);
const wavBuf  = new Uint8Array(FFT_BINS * 2 * 4);

for (let i = 0; i < FFT_BINS * 2; i++) { wavBuf[i * 4] = 128; wavBuf[i * 4 + 3] = 255; }

let histHead = 0;

// ── Pre-computed audio data ───────────────────────────────────────────────────

let allFrames = [];
let audio     = null;

const BLANK_FRAME = { ampL: 0, ampR: 0, fftL: new Array(128).fill(0) };

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

function melAvg(bins, lo, hi) {
  let s = 0;
  for (let i = lo; i <= hi; i++) s += bins[i] || 0;
  return s / (hi - lo + 1);
}

// Spectral envelope × carrier: the Mel magnitude profile becomes an amplitude
// envelope that shapes a carrier whose frequency drifts with the midrange.
// Bass rotates the carrier's phase, producing beats when the kick hits.
function synthesizeWav(mel, bass, mid, iTime) {
  const N = FFT_BINS * 2;
  for (let n = 0; n < N; n++) {
    const t       = n / (N - 1);
    const env     = melDB(mel[Math.round(t * 127)]);
    const carrier = Math.sin(2 * Math.PI * t * (4 + mid * 10) + iTime * 2.1 + bass * Math.PI * 2);
    wavBuf[n * 4]     = Math.max(0, Math.min(255, 128 + Math.round(env * carrier * 115)));
    wavBuf[n * 4 + 3] = 255;
  }
}

function updateFromPrecomputed(frame, uniforms, textures) {
  const mel = frame.fftL;

  for (let i = 0; i < FFT_BINS; i++) {
    const t  = (i / (FFT_BINS - 1)) * 127;
    const lo = Math.floor(t), hi = Math.min(127, lo + 1);
    const v  = mel[lo] * (1 - (t - lo)) + (mel[hi] || mel[lo]) * (t - lo);
    fftBuf[i * 4]     = Math.round(melDB(v) * 255);
    fftBuf[i * 4 + 3] = 255;
  }
  textures.fft.needsUpdate = true;

  const rowOff = histHead * FFT_BINS * 4;
  for (let i = 0; i < FFT_BINS; i++) {
    specBuf[rowOff + i * 4]     = fftBuf[i * 4];
    specBuf[rowOff + i * 4 + 3] = 255;
  }
  textures.spec.needsUpdate = true;

  const bass   = melAvg(mel,  0,  12);
  const mid    = melAvg(mel, 12,  80);
  const treble = melAvg(mel, 80, 127);
  const amp    = (frame.ampL + frame.ampR) * 0.5;

  const eOff = histHead * 4;
  envBuf[eOff]     = Math.round(bass   * 255);
  envBuf[eOff + 1] = Math.round(mid    * 255);
  envBuf[eOff + 2] = Math.round(treble * 255);
  envBuf[eOff + 3] = Math.round(amp    * 255);
  textures.env.needsUpdate = true;

  synthesizeWav(mel, bass, mid, uniforms.iTime.value);
  textures.wav.needsUpdate = true;

  histHead = (histHead + 1) % HIST;
  uniforms.u_histHead.value = histHead / HIST;
  uniforms.u_bass.value    = bass;
  uniforms.u_mid.value     = mid;
  uniforms.u_treble.value  = treble;
  uniforms.u_amp.value     = amp;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const canvas = document.getElementById('canvas');
  const W = canvas.width, H = canvas.height;

  const [fragSrc, vertSrc] = await Promise.all([
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const fftTex = new THREE.DataTexture(fftBuf, FFT_BINS, 1, THREE.RGBAFormat);
  fftTex.minFilter = fftTex.magFilter = THREE.LinearFilter;

  const specTex = new THREE.DataTexture(specBuf, FFT_BINS, HIST, THREE.RGBAFormat);
  specTex.minFilter = specTex.magFilter = THREE.LinearFilter;
  specTex.wrapS = specTex.wrapT = THREE.RepeatWrapping;

  const envTex = new THREE.DataTexture(envBuf, 1, HIST, THREE.RGBAFormat);
  envTex.minFilter = envTex.magFilter = THREE.LinearFilter;
  envTex.wrapS = envTex.wrapT = THREE.RepeatWrapping;

  const wavTex = new THREE.DataTexture(wavBuf, FFT_BINS * 2, 1, THREE.RGBAFormat);
  wavTex.minFilter = wavTex.magFilter = THREE.LinearFilter;

  const textures = { fft: fftTex, spec: specTex, env: envTex, wav: wavTex };

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 3.5 },
    u_mode:      { value: 0 },
    u_ssaa:      { value: 1 },
    u_fftTex:    { value: fftTex },
    u_specTex:   { value: specTex },
    u_waveTex:   { value: wavTex },
    u_envTex:    { value: envTex },
    u_histHead:  { value: 0 },
    u_bass:      { value: 0 },
    u_mid:       { value: 0 },
    u_treble:    { value: 0 },
    u_amp:       { value: 0 },
  };

  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc })
  ));

  async function switchTrack(idx) {
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    allFrames = parseBinary(await (await fetch(SOUND_BASE + TRACKS[idx].bin)).arrayBuffer());
    audio = new Audio(SOUND_BASE + TRACKS[idx].mp3);
    audio.loop = true; audio.preload = 'auto';
    const snap = allFrames[Math.min(480, allFrames.length - 1)] || BLANK_FRAME;
    updateFromPrecomputed(snap, uniforms, textures);
  }

  // ── Mode selector ──────────────────────────────────────────────────────────
  const modeSelect = document.getElementById('mode-select');
  MODE_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i); opt.textContent = name;
    modeSelect.appendChild(opt);
  });
  const cycleOpt = document.createElement('option');
  cycleOpt.value = 'cycle'; cycleOpt.textContent = 'Cycle (auto)';
  modeSelect.appendChild(cycleOpt);

  let currentMode = 0, cycling = false, lastCycleMs = 0;
  const infoName  = document.getElementById('info-name');
  const infoDesc  = document.getElementById('info-desc');

  function setMode(i) {
    currentMode = i;
    uniforms.u_mode.value = i;
    infoName.textContent  = MODE_NAMES[i];
    infoDesc.textContent  = MODE_DESCS[i];
    modeSelect.value      = String(i);
  }
  setMode(0);

  modeSelect.addEventListener('change', () => {
    if (modeSelect.value === 'cycle') { cycling = true; lastCycleMs = performance.now(); }
    else { cycling = false; setMode(parseInt(modeSelect.value, 10)); }
  });

  // ── Track selector ─────────────────────────────────────────────────────────
  let currentTrackIdx = 0;
  const trackSelect   = document.getElementById('track-select');
  TRACKS.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = String(i); opt.textContent = t.label;
    trackSelect.appendChild(opt);
  });
  trackSelect.addEventListener('change', async () => {
    const wasPlaying = isPlaying;
    if (wasPlaying) pause();
    currentTrackIdx = parseInt(trackSelect.value, 10);
    await switchTrack(currentTrackIdx);
    renderer.render(scene, cam);
    if (wasPlaying) play();
  });

  // ── Play / pause ───────────────────────────────────────────────────────────
  const playBtn = document.getElementById('play-btn');
  let isPlaying = false, startTs = performance.now(), pausedAt = 3.5, rafId = null;

  function updatePlayBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updatePlayBtn();

  function play() {
    if (!audio) return;
    audio.play().catch(() => {});
    isPlaying = true; startTs = performance.now();
    rafId = requestAnimationFrame(frame);
    updatePlayBtn();
  }
  function pause() {
    isPlaying = false;
    pausedAt += (performance.now() - startTs) * 0.001;
    if (audio) audio.pause();
    cancelAnimationFrame(rafId); rafId = null;
    updatePlayBtn();
  }
  playBtn.addEventListener('click', () => { if (isPlaying) pause(); else play(); });

  // ── SSAA toggle ────────────────────────────────────────────────────────────
  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  // ── Animation loop ─────────────────────────────────────────────────────────
  function frame(ms) {
    rafId = requestAnimationFrame(frame);
    uniforms.iTime.value = pausedAt + (ms - startTs) * 0.001;
    if (cycling && ms - lastCycleMs > CYCLE_INTERVAL) {
      setMode((currentMode + 1) % MODE_NAMES.length);
      lastCycleMs = ms;
    }
    if (audio && allFrames.length) {
      const fi = Math.min(Math.floor(audio.currentTime * FPS), allFrames.length - 1);
      updateFromPrecomputed(allFrames[fi], uniforms, textures);
    }
    renderer.render(scene, cam);
  }

  await switchTrack(0);
  renderer.render(scene, cam); // draw first frame; rAF starts only on play
}

init();
