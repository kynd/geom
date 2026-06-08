import * as THREE from 'three';

const SHAPES = [
  { name: '1. Traveling ripple',    eq: 'y = e⁻ʳ cos(5r − 2t)' },
  { name: '2. Rippling torus',      eq: '(√(x²+z²) − R(t))² + y² = r_t(θ,t)²' },
  { name: '3. Wave sheet',          eq: 'y = sin(2x+t) cos(2z+0.7t)' },
  { name: '4. Pulsing sphere',      eq: '|p| = r₀ + A(t)·P₂(cosθ)' },
  { name: '5. Oscillating saddle',  eq: 'y = A(t)(x² − z²)' },
  { name: '6. Gyroid',              eq: 'cos(k(t)x)sin(k(t)y) + … = 0' },
  { name: '7. Schwartz P',          eq: 'cos 2x + cos 2y + cos 2z = c(t)' },
  { name: '8. Lemniscate surface',  eq: '(x²+y²+z²)² = a(t)²(x²−z²)' },
  { name: '9. Swaying ellipsoid',   eq: 'x²/a² + y²/b² + z²/c² = 1, axis tilts' },
  { name: '10. Tanglecube',         eq: 'x⁴−5x² + y⁴−5y² + z⁴−5z² + c(t) = 0' },
  { name: '11. Chmutov T₄',         eq: 'T₄(sx) + T₄(sy) + T₄(sz) = 0, s(t)' },
  { name: '12. Rippled cone',        eq: 'x²+z² = (y + A sin(4y−t))²' },
  { name: '13. Pulsing Gaussian',    eq: 'y = A(t) e^(−r²/σ(t)²)' },
  { name: '14. Schoen I-WP',         eq: 'cos 2x cos 2y + cos 2y cos 2z + cos 2z cos 2x = c(t)' },
  { name: '15. Saddle blend',        eq: 'y = x² − z² + A(t)·xz' },
  { name: '16. Twisted torus',       eq: 'tube r = r₀ + ε sin(4θ − t)' },
  { name: '17. Bumpy sphere',        eq: '|p| = 1 + A sin(3λ−t) sin(2φ)' },
  { name: '18. Wavy hyperboloid',    eq: 'x²+z² − y² + A sin(4y−t) = c' },
  { name: '19. Permuted cubic',      eq: 'x²y + y²z + z²x = A(t)' },
  { name: '20. Flipping paraboloid', eq: 'y = sin(t)x² + cos(t+φ)z²' },
];

const CYCLE_DUR = 5.0;

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

async function init() {
  const canvas  = document.getElementById('canvas');
  const playBtn = document.getElementById('play-btn');
  const aaBtn   = document.getElementById('aa-btn');
  const select  = document.getElementById('shape-select');
  const nameEl  = document.getElementById('shape-name');
  const funcEl  = document.getElementById('shape-func');
  const W = canvas.width, H = canvas.height;

  const [scalarMarcherSrc, lightingSrc, movingScalarFuncsSrc, fragTemplate, vertSrc] = await Promise.all([
    fetch('../../shaders/scalar-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('../../shaders/moving-scalar-functions.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTemplate
    .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc)
    .replace('// INCLUDE_LIGHTING', lightingSrc)
    .replace('// INCLUDE_MOVING_SCALAR_FUNCTIONS', movingScalarFuncsSrc);

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

  let isPlaying = false, startTime = null, pausedAt = 0, rafId = null, lastIdx = -1;

  function shapeIndexAt(t) {
    const locked = parseInt(select.value);
    if (locked > 0) return locked - 1;
    return Math.floor(t / CYCLE_DUR) % SHAPES.length;
  }

  function renderAt(t) {
    uniforms.iTime.value = t;
    const idx = shapeIndexAt(t);
    uniforms.u_surfaceIndex.value = idx + 1;
    if (idx !== lastIdx) {
      nameEl.textContent = SHAPES[idx].name;
      funcEl.textContent = SHAPES[idx].eq;
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
    playBtn.innerHTML = PAUSE_ICON;
    playBtn.setAttribute('aria-label', 'Pause');
  }

  function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    pausedAt += (performance.now() - startTime) * 0.001;
    startTime = null;
    cancelAnimationFrame(rafId); rafId = null;
    playBtn.innerHTML = PLAY_ICON;
    playBtn.setAttribute('aria-label', 'Play');
  }

  playBtn.innerHTML = PLAY_ICON;
  playBtn.addEventListener('click', () => isPlaying ? pause() : play());

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  select.addEventListener('change', () => {
    lastIdx = -1;
    renderAt(pausedAt);
  });

  renderAt(0);
}

init().catch(console.error);
