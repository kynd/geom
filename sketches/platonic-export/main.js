import * as THREE from 'three';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="13" height="13"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="13" height="13"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

// Smooth full-period cosine oscillation: 0 → 1 → 0 over 5 s
function cycleT(elapsed) {
  const p = (elapsed % 5.0) / 5.0;
  return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
}

const FPS       = 30;
const PAIRS     = 3;
const REPEATS   = 2;
const PAIR_DUR  = 5.0;                       // seconds per pair
const CYCLE_DUR = PAIRS * PAIR_DUR;          // 15 s per full sweep
const TOTAL_DUR = PAIRS * REPEATS * PAIR_DUR; // 30 s
const TOTAL_F   = FPS * TOTAL_DUR;           // 900 frames

async function init() {
  const canvas    = document.getElementById('canvas');
  const playBtn   = document.getElementById('play-btn');
  const recordBtn = document.getElementById('record-btn');
  const recText   = document.getElementById('rec-text');
  const recLabel  = document.getElementById('rec-label');

  const W = canvas.width, H = canvas.height; // 1280 × 1280

  const [platonicSrc, rimSrc, marcherSrc, fragTmpl, vertSrc] = await Promise.all([
    fetch('../../public/shaders/platonic-functions.glsl').then(r => r.text()),
    fetch('../../public/shaders/rim-lighting.glsl').then(r => r.text()),
    fetch('../../public/shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../public/demos/lighting-rendering/shaders/fragment-platonic.glsl').then(r => r.text()),
    fetch('../../public/demos/lighting-rendering/shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTmpl
    .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicSrc)
    .replace('// INCLUDE_RIM_LIGHTING',       rimSrc)
    .replace('// INCLUDE_SDF_MARCHER',        marcherSrc);

  // preserveDrawingBuffer required for canvas.toBlob() after render
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const uniforms = {
    iResolution:  { value: new THREE.Vector2(W, H) },
    iTime:        { value: 0.0 },
    u_pair:       { value: 0 },
    u_t:          { value: 0.0 },
    u_rimPow:     { value: 3.0 },
    u_base:       { value: 0.0 },
    u_sssDensity: { value: 2.5 },
    u_sssStr:     { value: 0.3 },
    u_ssaa:       { value: 1 },   // SSAA on by default
  };

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  function renderAt(t) {
    const pairPhase   = t % CYCLE_DUR;
    const pair        = Math.floor(pairPhase / PAIR_DUR);
    const pairElapsed = pairPhase % PAIR_DUR;
    uniforms.iTime.value  = t;
    uniforms.u_pair.value = pair;
    uniforms.u_t.value    = cycleT(pairElapsed);
    renderer.render(scene, cam);
  }

  // ---- Playback ----
  let isPlaying = false, startTime = null, pausedAt = 0, rafId = null;

  function updatePlayBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function frame(ms) {
    rafId = requestAnimationFrame(frame);
    renderAt(pausedAt + (ms - startTime) * 0.001);
  }

  function play() {
    if (isPlaying) return;
    isPlaying = true;
    startTime = performance.now();
    rafId = requestAnimationFrame(frame);
    updatePlayBtn();
  }

  function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    pausedAt += (performance.now() - startTime) * 0.001;
    startTime = null;
    cancelAnimationFrame(rafId);
    rafId = null;
    updatePlayBtn();
  }

  playBtn.addEventListener('click', () => isPlaying ? pause() : play());

  // ---- Recording ----
  let isRecording = false;

  recordBtn.addEventListener('click', async () => {
    if (isRecording) return;

    if (!window.showDirectoryPicker) {
      alert('File System Access API is required. Use Chrome or Edge.');
      return;
    }

    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
    } catch (e) {
      if (e.name !== 'AbortError') console.error(e);
      return;
    }

    const wasPlaying = isPlaying;
    if (isPlaying) pause();

    isRecording = true;
    recordBtn.disabled = true;
    recLabel.textContent = `0 / ${TOTAL_F}`;

    for (let f = 0; f < TOTAL_F; f++) {
      renderAt(f / FPS);

      const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.95));
      const name = `frame_${String(f).padStart(6, '0')}.jpg`;
      const fh   = await dirHandle.getFileHandle(name, { create: true });
      const wr   = await fh.createWritable();
      await wr.write(blob);
      await wr.close();

      recLabel.textContent = `${f + 1} / ${TOTAL_F}`;
      // Yield to browser every 5 frames to keep UI responsive
      if (f % 5 === 4) await new Promise(r => setTimeout(r, 0));
    }

    isRecording = false;
    recordBtn.disabled = false;
    recText.textContent = 'Record';
    recLabel.textContent = `✓ ${TOTAL_F} frames saved`;

    if (wasPlaying) play();
  });

  play();
}

init().catch(console.error);
