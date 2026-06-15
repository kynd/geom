import * as THREE from 'three';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const MODE_NAMES = [
  'Domain coloring',
  'Biomorphs',
  'Newton basins',
  'Lᵖ norm',
  'Quasiperiodic',
  'Chladni',
  'Log spirals',
  'Lyapunov',
  'Jacobi elliptic',
  'Fresnel',
];

const MODE_DESCS = [
  'Two counter-rotating groups of zeros orbit inside the unit disk. Hue follows the argument of the Blaschke product; lightness comes from log-spaced magnitude bands.',
  'z → sin(z) + c iterated six times. The complex sine\'s exponential growth along the imaginary axis pulls colour into elongated vertical tendrils.',
  'Five Newton steps toward the roots of z⁵ − 1. Hue marks which root attracts; lightness reflects how quickly the iterate converges.',
  'Distance under (|x|ᵖ + |y|ᵖ)^(1/p). The p exponent oscillates in space and time, deforming level sets from circles to rounded squares.',
  'Seven cosine waves at equal angular spacing. The sum is organised but never exactly repeats — seven-fold symmetry with no period.',
  'Two square-plate eigenfunctions combined as a complex pair. Their zeros are the nodal lines where sand collects on a vibrating plate.',
  'w = ln(z) unwraps circles into lines and radial rays into verticals. Applying sin and cos to w produces logarithmically-spaced spiral bands.',
  'Logistic map alternates growth rates rₓ and rᵧ by sequence AABAB. Warm colours mark chaos (λ > 0); cool colours mark stability (λ < 0).',
  'sin(x + α·sin y) · cos(y + β·cos x) approximates doubly-periodic elliptic functions on a torus. α and β drift slowly over time.',
  'Phase e^(iπkr²) of a wavefront radiating outward. Concentric phase rings tighten quadratically; angular modulation breaks the circular symmetry.',
];

const CYCLE_INTERVAL = 7000; // ms per mode when cycling

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

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0 },
    u_mode:      { value: 0 },
    u_ssaa:      { value: 1 },
  };

  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc })
  ));

  // ── Mode selector ──────────────────────────────────────────────────────────
  const select = document.getElementById('mode-select');
  MODE_NAMES.forEach((name, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = name;
    select.appendChild(opt);
  });
  const cycleOpt = document.createElement('option');
  cycleOpt.value = 'cycle';
  cycleOpt.textContent = 'Cycle (auto)';
  select.appendChild(cycleOpt);

  let currentMode = 0;
  let cycling = false;
  let lastCycleMs = 0;

  const infoName = document.getElementById('info-name');
  const infoDesc = document.getElementById('info-desc');

  function setMode(i) {
    currentMode = i;
    uniforms.u_mode.value = i;
    infoName.textContent = MODE_NAMES[i];
    infoDesc.textContent = MODE_DESCS[i];
    select.value = String(i);
  }

  setMode(0);

  select.addEventListener('change', () => {
    if (select.value === 'cycle') {
      cycling = true;
      lastCycleMs = performance.now();
    } else {
      cycling = false;
      setMode(parseInt(select.value, 10));
    }
  });

  // ── Play / pause ───────────────────────────────────────────────────────────
  const playBtn = document.getElementById('play-btn');
  let isPlaying = false;
  let startTs   = performance.now();
  let pausedAt  = 0;
  let rafId     = null;

  function updatePlayBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updatePlayBtn();

  function play() {
    isPlaying = true;
    startTs   = performance.now();
    rafId     = requestAnimationFrame(frame);
    updatePlayBtn();
  }
  function pause() {
    pausedAt += (performance.now() - startTs) * 0.001;
    isPlaying  = false;
    cancelAnimationFrame(rafId);
    rafId = null;
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
    renderer.render(scene, cam);
  }

  renderer.render(scene, cam); // draw first frame; rAF starts only on play
}

init();
