import * as THREE from 'three';
import { EffectComposer }  from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }      from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const TRACKS = [
  { label: 'Master', file: '250621_a1_mix1_master_88.2k24.mp3' },
  { label: 'Arp',    file: '250621_a1_mix1_arp.mp3' },
  { label: 'Bass',   file: '250621_a1_mix1_bass.mp3' },
  { label: 'Hat',    file: '250621_a1_mix1_hat.mp3' },
  { label: 'Kick 1', file: '250621_a1_mix1_kick1.mp3' },
  { label: 'Kick 2', file: '250621_a1_mix1_kick2.mp3' },
  { label: 'Pad',    file: '250621_a1_mix1_pad.mp3' },
  { label: 'Snare',  file: '250621_a1_mix1_snare.mp3' },
];

const SHAPES = [
  'sphere', 'box', 'round box', 'box frame', 'torus', 'capped torus', 'link',
  'infinite cylinder', 'cone', 'infinite cone', 'hexagonal prism', 'capsule',
  'vertical capsule', 'capped cylinder', 'arb. cylinder', 'rounded cylinder',
  'capped cone', 'arb. capped cone', 'solid angle', 'cut sphere',
  'cut hollow sphere', 'death star', 'round cone', 'arb. round cone',
  'vesica segment', 'rhombus', 'octahedron', 'octahedron (fast)', 'pyramid',
  'ellipsoid', 'triangular prism',
];
const PLATONIC_PAIRS = ['Cube / Octahedron', 'Tetrahedron / Tetrahedron', 'Dodecahedron / Icosahedron'];
const SURFACES       = [
  'elliptic paraboloid', 'hyperbolic paraboloid', 'cone', 'sphere', 'torus',
  'hyperboloid', 'monkey saddle', 'sinusoidal surface', 'radial damped cosine', 'ellipsoid',
];
const MOVING_SHAPES  = [
  '1. Traveling radial damped cosine', '2. Pulsing torus', '3. Traveling sinusoidal surface',
  '4. Oscillating spheroid', '5. Pulsing saddle', '6. Pulsing gyroid',
  '7. Oscillating Schwartz P', '8. Pulsing lemniscate', '9. Tilting ellipsoid',
  '10. Pulsing tanglecube', '11. Pulsing Chmutov T₄', '12. Traveling sinusoidal cone',
  '13. Pulsing Gaussian', '14. Oscillating Schoen I-WP', '15. Tilting saddle',
  '16. Rotating torus', '17. Rotating harmonic sphere', '18. Traveling hyperboloid',
  '19. Pulsing cyclic cubic', '20. Rotating paraboloid',
];
const SHAPE_DURATION = 5.0;

const MODE_NAMES = [
  'Anisotropic wave', 'Normal phase portrait', 'Drifting caustic', 'Spectrogram',
  'Bilateral spectrogram', 'Spectral hue', 'Spectral hue-lightness',
];

function cycleT(t) {
  const p = (t % SHAPE_DURATION) / SHAPE_DURATION;
  return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
}

const FFT_BINS = 256;
const HIST     = 256;

// ── Audio state ───────────────────────────────────────────────────────────────

let audioCtx        = null;
let analyserL       = null;
let analyserR       = null;
let splitter        = null;
let sourceNode      = null;
let trackChanged    = false;
let currentTrackIdx = 0;

const fftArrayL = new Uint8Array(FFT_BINS);
const fftArrayR = new Uint8Array(FFT_BINS);
const waveArray = new Uint8Array(FFT_BINS * 2);

const fftBuf  = new Uint8Array(FFT_BINS * 4);
const specBuf = new Uint8Array(FFT_BINS * HIST * 4);
const envBuf  = new Uint8Array(HIST * 4);
const wavBuf  = new Uint8Array(FFT_BINS * 2 * 4);

let histHead = 0;

function bandAvg(arr, lo, hi) {
  let s = 0;
  for (let i = lo; i <= hi; i++) s += arr[i];
  return s / (hi - lo + 1) / 255;
}

async function prebakeFirstFrame(url, uniforms, textures) {
  try {
    const resp    = await fetch(url);
    const raw     = await resp.arrayBuffer();
    const tmpCtx  = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await tmpCtx.decodeAudioData(raw);
    await tmpCtx.close();

    const N   = FFT_BINS * 2;
    const off = Math.floor(8.0 * decoded.sampleRate);
    const ch  = decoded.getChannelData(0);

    const windowed = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
      windowed[n] = (ch[off + n] || 0) * w;
    }

    const linear = new Float32Array(FFT_BINS);
    for (let k = 0; k < FFT_BINS; k++) {
      const theta = 2 * Math.PI * k / N;
      const c2    = 2 * Math.cos(theta);
      let re = 0, im = 0;
      let cp = Math.cos(-theta), c = 1;
      let sp = Math.sin(-theta), s = 0;
      for (let n = 0; n < N; n++) {
        re += windowed[n] * c;
        im -= windowed[n] * s;
        const cn = c2 * c - cp; cp = c; c = cn;
        const sn = c2 * s - sp; sp = s; s = sn;
      }
      linear[k] = Math.sqrt(re * re + im * im);
    }

    const tempFft = new Uint8Array(FFT_BINS);
    const scale   = N / 2;
    for (let k = 0; k < FFT_BINS; k++) {
      const db   = linear[k] > 0 ? 20 * Math.log10(linear[k] / scale) : -100;
      tempFft[k] = Math.max(0, Math.min(255, Math.round((db + 100) / 70 * 255)));
      fftBuf[k * 4]     = tempFft[k];
      fftBuf[k * 4 + 3] = 255;
    }
    textures.fft.needsUpdate = true;

    for (let i = 0; i < N; i++) {
      wavBuf[i * 4]     = Math.max(0, Math.min(255, Math.round(((ch[off + i] || 0) * 0.5 + 0.5) * 255)));
      wavBuf[i * 4 + 3] = 255;
    }
    textures.wav.needsUpdate = true;

    uniforms.u_bass.value   = bandAvg(tempFft, 0,   15);
    uniforms.u_mid.value    = bandAvg(tempFft, 16,  80);
    uniforms.u_treble.value = bandAvg(tempFft, 81,  200);
    uniforms.u_amp.value    = bandAvg(tempFft, 0,   FFT_BINS - 1);
  } catch (e) {
    console.warn('Audio prebake failed:', e);
  }
}

async function loadAndPlayTrack(url) {
  if (sourceNode) {
    try { sourceNode.stop(); } catch (_) {}
    sourceNode = null;
  }
  if (!audioCtx) {
    audioCtx = new AudioContext();
    const makeAnalyser = () => {
      const a = audioCtx.createAnalyser();
      a.fftSize = FFT_BINS * 2;
      a.smoothingTimeConstant = 0.75;
      return a;
    };
    analyserL = makeAnalyser();
    analyserR = makeAnalyser();
    splitter  = audioCtx.createChannelSplitter(2);
    const merger = audioCtx.createChannelMerger(2);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
    analyserL.connect(merger, 0, 0);
    analyserR.connect(merger, 0, 1);
    merger.connect(audioCtx.destination);
  } else if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  const resp = await fetch(url);
  const raw  = await resp.arrayBuffer();
  const buf  = await audioCtx.decodeAudioData(raw);
  sourceNode = audioCtx.createBufferSource();
  sourceNode.buffer = buf;
  sourceNode.loop   = true;
  sourceNode.connect(splitter);
  sourceNode.start(0);
}

function updateAudioTextures(uniforms, textures) {
  if (!analyserL || !audioCtx || audioCtx.state !== 'running') return;

  analyserL.getByteFrequencyData(fftArrayL);
  analyserR.getByteFrequencyData(fftArrayR);
  analyserL.getByteTimeDomainData(waveArray);

  // FFT texture — L in .r, R in .g
  for (let i = 0; i < FFT_BINS; i++) {
    fftBuf[i * 4]     = fftArrayL[i];
    fftBuf[i * 4 + 1] = fftArrayR[i];
    fftBuf[i * 4 + 3] = 255;
  }
  textures.fft.needsUpdate = true;

  // Spectrogram row — L in .r, R in .g
  const rowOff = histHead * FFT_BINS * 4;
  for (let i = 0; i < FFT_BINS; i++) {
    specBuf[rowOff + i * 4]     = fftArrayL[i];
    specBuf[rowOff + i * 4 + 1] = fftArrayR[i];
    specBuf[rowOff + i * 4 + 3] = 255;
  }
  textures.spec.needsUpdate = true;

  const bass   = bandAvg(fftArrayL, 0,  15);
  const mid    = bandAvg(fftArrayL, 16, 80);
  const treble = bandAvg(fftArrayL, 81, 200);
  const amp    = bandAvg(fftArrayL, 0,  FFT_BINS - 1);
  const eOff   = histHead * 4;
  envBuf[eOff]     = Math.round(bass   * 255);
  envBuf[eOff + 1] = Math.round(mid    * 255);
  envBuf[eOff + 2] = Math.round(treble * 255);
  envBuf[eOff + 3] = Math.round(amp    * 255);
  textures.env.needsUpdate = true;

  const waveLen = FFT_BINS * 2;
  for (let i = 0; i < waveLen; i++) {
    wavBuf[i * 4]     = waveArray[i];
    wavBuf[i * 4 + 3] = 255;
  }
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

  const [
    fragSrc, vertSrc,
    d3SdfTmpl, d3PlatonicTmpl, d3ScalarTmpl, d3MovingTmpl,
    sdfFuncsSrc, sdfMarcherSrc, platonicFuncsSrc, scalarMarcherSrc, movingScalarFuncsSrc,
  ] = await Promise.all([
    fetch('../sound-fill/shaders/fragment.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/vertex.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/fragment-3d.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/fragment-3d-platonic.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/fragment-3d-scalar.glsl').then(r => r.text()),
    fetch('../sound-fill/shaders/fragment-3d-moving.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-functions.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r => r.text()),
    fetch('../../shaders/scalar-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/moving-scalar-functions.glsl').then(r => r.text()),
  ]);

  const d3SdfSrc = d3SdfTmpl
    .replace('// INCLUDE_SDF_FUNCTIONS', sdfFuncsSrc)
    .replace('// INCLUDE_SDF_MARCHER',   sdfMarcherSrc);

  const d3PlatonicSrc = d3PlatonicTmpl
    .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicFuncsSrc)
    .replace('// INCLUDE_SDF_MARCHER',        sdfMarcherSrc);

  const d3ScalarSrc = d3ScalarTmpl
    .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc);

  const d3MovingSrc = d3MovingTmpl
    .replace('// INCLUDE_SCALAR_MARCHER',          scalarMarcherSrc)
    .replace('// INCLUDE_MOVING_SCALAR_FUNCTIONS', movingScalarFuncsSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam       = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const fillScene = new THREE.Scene();

  // ── Audio textures ────────────────────────────────────────────────────────

  const fftTex = new THREE.DataTexture(fftBuf, FFT_BINS, 1, THREE.RGBAFormat);
  fftTex.minFilter = fftTex.magFilter = THREE.LinearFilter;

  const specTex = new THREE.DataTexture(specBuf, FFT_BINS, HIST, THREE.RGBAFormat);
  specTex.minFilter = specTex.magFilter = THREE.LinearFilter;
  specTex.wrapS = THREE.ClampToEdgeWrapping;
  specTex.wrapT = THREE.RepeatWrapping;

  const envTex = new THREE.DataTexture(envBuf, 1, HIST, THREE.RGBAFormat);
  envTex.minFilter = envTex.magFilter = THREE.LinearFilter;
  envTex.wrapS = envTex.wrapT = THREE.RepeatWrapping;

  const wavTex = new THREE.DataTexture(wavBuf, FFT_BINS * 2, 1, THREE.RGBAFormat);
  wavTex.minFilter = wavTex.magFilter = THREE.LinearFilter;

  const textures = { fft: fftTex, spec: specTex, env: envTex, wav: wavTex };

  // ── Fill uniforms (used by fill → fillTarget → env map) ───────────────────

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 3.5 },
    u_mode:      { value: 2 },
    u_ssaa:      { value: 0 },
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

  fillScene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc })
  ));

  prebakeFirstFrame(`../../sound/highlights/${TRACKS[0].file}`, uniforms, textures);

  // ── 3D scene setup ─────────────────────────────────────────────────────────

  const fillTarget = new THREE.WebGLRenderTarget(W, H, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
  });

  function makeD3Scene(fSrc, extra) {
    const d3Uni = {
      iResolution: { value: new THREE.Vector2(W, H) },
      iTime:       { value: 3.5 },
      u_ampL:      { value: 0 },
      u_ampR:      { value: 0 },
      u_ssaa:      { value: 0 },
      u_lights:    { value: 0 },
      u_envScale:  { value: 1.0 },
      u_envTex:    { value: fillTarget.texture },
      ...extra,
    };
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: d3Uni, vertexShader: vertSrc, fragmentShader: fSrc })
    ));
    return { scene, uniforms: d3Uni };
  }

  const sdfSource      = makeD3Scene(d3SdfSrc,      { u_shapeIndex:   { value: 1 } });
  const platonicSource = makeD3Scene(d3PlatonicSrc, { u_pair: { value: 0 }, u_t: { value: 0 } });
  const scalarSource   = makeD3Scene(d3ScalarSrc,   { u_surfaceIndex: { value: 1 } });
  const movingSource   = makeD3Scene(d3MovingSrc,   { u_surfaceIndex: { value: 1 } });
  const d3Sources      = [sdfSource, platonicSource, scalarSource, movingSource];
  let activeD3Source   = 3;

  const d3RenderPass = new RenderPass(null, cam);
  const bloomPass    = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.6, 0.0);
  const composer     = new EffectComposer(renderer);
  composer.addPass(d3RenderPass);
  composer.addPass(bloomPass);

  // ── Mode selector (controls fill used as env map) ─────────────────────────
  const modeSelect = document.getElementById('mode-select');
  MODE_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    modeSelect.appendChild(opt);
  });
  modeSelect.value = '2';
  modeSelect.addEventListener('change', () => {
    uniforms.u_mode.value = parseInt(modeSelect.value, 10);
  });

  // ── Track selector ─────────────────────────────────────────────────────────
  const trackSelect = document.getElementById('track-select');
  TRACKS.forEach((t, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = t.label;
    trackSelect.appendChild(opt);
  });
  trackSelect.addEventListener('change', async () => {
    currentTrackIdx = parseInt(trackSelect.value, 10);
    if (isPlaying) {
      await loadAndPlayTrack(`../../sound/highlights/${TRACKS[currentTrackIdx].file}`);
    } else {
      trackChanged = true;
    }
  });

  // ── Shape category buttons ─────────────────────────────────────────────────
  const srcBtnsWrap = document.getElementById('d3-src-btns');
  const srcBtns     = Array.from(srcBtnsWrap.querySelectorAll('.tab-btn'));
  const shapeLabel  = document.getElementById('shape-name');

  srcBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      activeD3Source = i;
      srcBtns.forEach((b, j) => b.classList.toggle('active', i === j));
    });
  });

  // ── Lights toggle ──────────────────────────────────────────────────────────
  const lightsBtn = document.getElementById('lights-btn');
  lightsBtn.addEventListener('click', () => {
    const on = lightsBtn.classList.toggle('active');
    lightsBtn.setAttribute('aria-label', on ? 'Lights on' : 'Lights off');
    const v = on ? 1 : 0;
    for (const src of d3Sources) src.uniforms.u_lights.value = v;
  });

  // ── Bloom controls ─────────────────────────────────────────────────────────
  const bloomBtn    = document.getElementById('bloom-btn');
  const bloomSlider = document.getElementById('bloom-slider');

  bloomBtn.addEventListener('click', () => {
    const on = bloomBtn.classList.toggle('active');
    bloomBtn.setAttribute('aria-label', on ? 'Bloom on' : 'Bloom off');
    bloomPass.strength = on ? parseFloat(bloomSlider.value) : 0;
  });
  const bloomVal = document.getElementById('bloom-val');
  bloomSlider.addEventListener('input', () => {
    if (bloomBtn.classList.contains('active')) bloomPass.strength = parseFloat(bloomSlider.value);
    bloomVal.textContent = parseFloat(bloomSlider.value).toFixed(2);
  });

  // ── Env scale slider ───────────────────────────────────────────────────────
  const envScaleSlider = document.getElementById('env-scale-slider');
  const envScaleVal = document.getElementById('env-scale-val');
  envScaleSlider.addEventListener('input', () => {
    const v = parseFloat(envScaleSlider.value);
    for (const src of d3Sources) src.uniforms.u_envScale.value = v;
    envScaleVal.textContent = v.toFixed(2);
  });

  // ── Play / pause ───────────────────────────────────────────────────────────
  const playBtn = document.getElementById('play-btn');
  let isPlaying = false;
  let startTs   = performance.now();
  let pausedAt  = 3.5;

  function updatePlayBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updatePlayBtn();

  async function play() {
    if (!analyserL || trackChanged) {
      await loadAndPlayTrack(`../../sound/highlights/${TRACKS[currentTrackIdx].file}`);
      trackChanged = false;
    } else if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    isPlaying = true;
    startTs   = performance.now();
    updatePlayBtn();
  }

  async function pause() {
    isPlaying = false;
    pausedAt += (performance.now() - startTs) * 0.001;
    if (audioCtx) await audioCtx.suspend();
    updatePlayBtn();
  }

  playBtn.addEventListener('click', async () => {
    if (isPlaying) { await pause(); } else { await play(); }
  });

  // ── SSAA toggle ────────────────────────────────────────────────────────────
  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    for (const src of d3Sources) src.uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  // ── Animation loop ─────────────────────────────────────────────────────────
  function frame(ms) {
    requestAnimationFrame(frame);

    if (isPlaying) {
      uniforms.iTime.value = pausedAt + (ms - startTs) * 0.001;
      updateAudioTextures(uniforms, textures);
    }

    const t      = uniforms.iTime.value;
    const bass   = uniforms.u_bass.value;
    const treble = uniforms.u_treble.value;

    // SDF shapes
    const sdfIdx = (Math.floor(t / SHAPE_DURATION) % SHAPES.length) + 1;
    sdfSource.uniforms.iTime.value        = t;
    sdfSource.uniforms.u_ampL.value       = bass;
    sdfSource.uniforms.u_ampR.value       = treble;
    sdfSource.uniforms.u_shapeIndex.value = sdfIdx;

    // Platonic duals
    const pairPhase = t % (PLATONIC_PAIRS.length * SHAPE_DURATION);
    const pair      = Math.floor(pairPhase / SHAPE_DURATION);
    platonicSource.uniforms.iTime.value  = t;
    platonicSource.uniforms.u_ampL.value = bass;
    platonicSource.uniforms.u_ampR.value = treble;
    platonicSource.uniforms.u_pair.value = pair;
    platonicSource.uniforms.u_t.value    = cycleT(pairPhase % SHAPE_DURATION);

    // Scalar fields
    const scalarIdx = (Math.floor(t / SHAPE_DURATION) % SURFACES.length) + 1;
    scalarSource.uniforms.iTime.value          = t;
    scalarSource.uniforms.u_ampL.value         = bass;
    scalarSource.uniforms.u_ampR.value         = treble;
    scalarSource.uniforms.u_surfaceIndex.value = scalarIdx;

    // Moving scalar
    const movingIdx = (Math.floor(t / SHAPE_DURATION) % MOVING_SHAPES.length) + 1;
    movingSource.uniforms.iTime.value          = t;
    movingSource.uniforms.u_ampL.value         = bass;
    movingSource.uniforms.u_ampR.value         = treble;
    movingSource.uniforms.u_surfaceIndex.value = movingIdx;

    // Shape label
    if      (activeD3Source === 0) shapeLabel.textContent = SHAPES[sdfIdx - 1];
    else if (activeD3Source === 1) shapeLabel.textContent = PLATONIC_PAIRS[pair];
    else if (activeD3Source === 2) shapeLabel.textContent = SURFACES[scalarIdx - 1];
    else                           shapeLabel.textContent = MOVING_SHAPES[movingIdx - 1];

    // Render fill to fillTarget (used as equirectangular env map by 3D shaders)
    renderer.setRenderTarget(fillTarget);
    renderer.render(fillScene, cam);
    renderer.setRenderTarget(null);

    // Render 3D with bloom
    d3RenderPass.scene = d3Sources[activeD3Source].scene;
    composer.render();
  }
  requestAnimationFrame(frame);
}

init();
