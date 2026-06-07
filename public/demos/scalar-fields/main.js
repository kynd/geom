import * as THREE from 'three';

const SURFACES = [
  { name: 'elliptic paraboloid',      func: 'y = x² + z²',                duration: 1.0 },
  { name: 'hyperbolic paraboloid',    func: 'y = x² − z²',                duration: 1.0 },
  { name: 'cone',                     func: 'y² = x² + z²',               duration: 1.0 },
  { name: 'sphere',                   func: 'x² + y² + z² = r²',          duration: 1.0 },
  { name: 'torus',                    func: '(√(x²+z²) − R)² + y² = r²', duration: 1.0 },
  { name: 'hyperboloid',              func: 'x² + z² − y² = r²',          duration: 1.0 },
  { name: 'monkey saddle',            func: 'y = x³ − 3xz²',              duration: 1.0 },
  { name: 'wave surface',             func: 'y = sin(x) cos(z)',           duration: 1.0 },
  { name: 'ripple',                   func: 'y = e⁻ʳ cos(r)',             duration: 1.0 },
  { name: 'ellipsoid',                func: 'x²/a² + y²/b² + z²/c² = 1', duration: 1.0 },
];

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

async function init() {
  const canvas  = document.getElementById('canvas');
  const playBtn = document.getElementById('play-btn');
  const W = canvas.width;
  const H = canvas.height;

  const [scalarMarcherSrc, lightingSrc, fragTemplate, vertSrc] = await Promise.all([
    fetch('../../shaders/scalar-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTemplate
    .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc)
    .replace('// INCLUDE_LIGHTING', lightingSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    iResolution:    { value: new THREE.Vector2(W, H) },
    iTime:          { value: 0.0 },
    u_surfaceIndex: { value: 1 },
    u_ssaa:         { value: 1 },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const nameEl = document.getElementById('shape-name');
  const funcEl = document.getElementById('shape-func');

  const offsets = [];
  let total = 0;
  for (const s of SURFACES) { offsets.push(total); total += s.duration; }

  function surfaceIndexAtTime(t) {
    const wrapped = t % total;
    for (let i = SURFACES.length - 1; i >= 0; i--) {
      if (wrapped >= offsets[i]) return i;
    }
    return 0;
  }

  let isPlaying = false;
  let startTime = null;
  let pausedAt  = 0;
  let rafId     = null;
  let lastIdx   = -1;

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function renderAt(t) {
    uniforms.iTime.value = t;
    const idx = surfaceIndexAtTime(t);
    uniforms.u_surfaceIndex.value = idx + 1;
    if (idx !== lastIdx) {
      nameEl.textContent = SURFACES[idx].name;
      funcEl.textContent = SURFACES[idx].func;
      lastIdx = idx;
    }
    renderer.render(scene, camera);
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
    updateBtn();
  }

  function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    pausedAt += (performance.now() - startTime) * 0.001;
    startTime = null;
    cancelAnimationFrame(rafId);
    rafId = null;
    updateBtn();
  }

  playBtn.addEventListener('click', () => isPlaying ? pause() : play());

  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });

  renderAt(0);
  updateBtn();
}

init().catch(console.error);
