import * as THREE from 'three';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const MOVING_SHAPES = [
  '1. Traveling radial damped cosine', '2. Pulsing torus', '3. Traveling sinusoidal surface',
  '4. Oscillating spheroid', '5. Pulsing saddle', '6. Pulsing gyroid',
  '7. Oscillating Schwartz P', '8. Pulsing lemniscate', '9. Tilting ellipsoid',
  '10. Pulsing tanglecube', '11. Pulsing Chmutov T₄', '12. Traveling sinusoidal cone',
  '13. Pulsing Gaussian', '14. Oscillating Schoen I-WP', '15. Tilting saddle',
  '16. Rotating torus', '17. Rotating harmonic sphere', '18. Traveling hyperboloid',
  '19. Pulsing cyclic cubic', '20. Rotating paraboloid',
];

const SDF_SHAPES = [
  'sphere', 'box', 'round box', 'box frame', 'torus', 'capped torus', 'link',
  'infinite cylinder', 'cone', 'infinite cone', 'hexagonal prism', 'capsule',
  'vertical capsule', 'capped cylinder', 'arb. cylinder', 'rounded cylinder',
  'capped cone', 'arb. capped cone', 'solid angle', 'cut sphere',
  'cut hollow sphere', 'death star', 'round cone', 'arb. round cone',
  'vesica segment', 'rhombus', 'octahedron', 'octahedron (fast)', 'pyramid',
  'ellipsoid', 'triangular prism',
];

const SCALAR_SURFACES = [
  'elliptic paraboloid', 'hyperbolic paraboloid', 'cone', 'sphere', 'torus',
  'hyperboloid', 'monkey saddle', 'wave surface', 'ripple', 'ellipsoid',
];

const PLATONIC_PAIRS = [
  'Cube / Octahedron',
  'Tetrahedron / Tetrahedron',
  'Dodecahedron / Icosahedron',
];

const MOVING_CYCLE = 5.0;

function cycleT(elapsed) {
  const p = (elapsed % 5.0) / 5.0;
  return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
}

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const nameEl   = document.getElementById('shape-name');
  const srcBtns  = Array.from(document.querySelectorAll('.src-btn'));
  const W = canvas.width, H = canvas.height;

  const [
    sdfFuncsSrc, sdfMarcherSrc, scalarMarcherSrc, movingScalarFuncsSrc,
    platonicFuncsSrc, rimLightingSrc,
    fragMovingScalarTmpl, fragSDFTmpl, fragScalarTmpl, fragPlatonicTmpl, vertSrc,
  ] = await Promise.all([
    fetch('../../shaders/sdf-functions.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/scalar-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/moving-scalar-functions.glsl').then(r => r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r => r.text()),
    fetch('../../shaders/rim-lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment-moving-scalar.glsl').then(r => r.text()),
    fetch('./shaders/fragment-sdf.glsl').then(r => r.text()),
    fetch('./shaders/fragment-scalar.glsl').then(r => r.text()),
    fetch('./shaders/fragment-platonic.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragMovingScalar = fragMovingScalarTmpl
    .replace('// INCLUDE_RIM_LIGHTING',          rimLightingSrc)
    .replace('// INCLUDE_SCALAR_MARCHER',        scalarMarcherSrc)
    .replace('// INCLUDE_MOVING_SCALAR_FUNCTIONS', movingScalarFuncsSrc);

  const fragSDF = fragSDFTmpl
    .replace('// INCLUDE_SDF_FUNCTIONS', sdfFuncsSrc)
    .replace('// INCLUDE_RIM_LIGHTING',  rimLightingSrc)
    .replace('// INCLUDE_SDF_MARCHER',   sdfMarcherSrc);

  const fragScalar = fragScalarTmpl
    .replace('// INCLUDE_RIM_LIGHTING',   rimLightingSrc)
    .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc);

  const fragPlatonic = fragPlatonicTmpl
    .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicFuncsSrc)
    .replace('// INCLUDE_RIM_LIGHTING',       rimLightingSrc)
    .replace('// INCLUDE_SDF_MARCHER',        sdfMarcherSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  function makeScene(fragSrc, uniforms) {
    const mat   = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { scene, uniforms };
  }

  const res = new THREE.Vector2(W, H);

  const lightUniforms = () => ({
    u_rimPow:     { value: 3.0 },
    u_base:       { value: 0.0 },
    u_sssDensity: { value: 2.5 },
    u_sssStr:     { value: 0.3 },
    u_ssaa:       { value: 0 },
  });

  const movingScalarScene = makeScene(fragMovingScalar, {
    iResolution:    { value: res },
    iTime:          { value: 0.0 },
    u_surfaceIndex: { value: 1 },
    ...lightUniforms(),
  });

  const sdfScene = makeScene(fragSDF, {
    iResolution:  { value: res },
    iTime:        { value: 0.0 },
    u_shapeIndex: { value: 1 },
    ...lightUniforms(),
  });

  const scalarScene = makeScene(fragScalar, {
    iResolution:    { value: res },
    iTime:          { value: 0.0 },
    u_surfaceIndex: { value: 1 },
    ...lightUniforms(),
  });

  const platonicScene = makeScene(fragPlatonic, {
    iResolution: { value: res },
    iTime:       { value: 0.0 },
    u_pair:      { value: 0 },
    u_t:         { value: 0.0 },
    ...lightUniforms(),
  });

  // Order matches parametric shapes page: SDF, Platonic, Scalar, Moving scalar (default)
  const sources = [sdfScene, platonicScene, scalarScene, movingScalarScene];
  let activeSource = 3;

  srcBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      activeSource = i;
      srcBtns.forEach((b, j) => b.classList.toggle('active', i === j));
    });
  });

  let isPlaying = false;
  let startTime = null;
  let pausedAt  = 0;
  let rafId     = null;
  let lastMovingIdx    = -1;
  let lastSdfIdx       = -1;
  let lastScalarIdx    = -1;
  let lastPlatonicPair = -1;

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function renderAt(elapsed) {
    // Moving scalar fields — cycle every MOVING_CYCLE seconds
    {
      const idx = Math.floor((elapsed % (MOVING_SHAPES.length * MOVING_CYCLE)) / MOVING_CYCLE);
      movingScalarScene.uniforms.iTime.value          = elapsed;
      movingScalarScene.uniforms.u_surfaceIndex.value = idx + 1;
      if (idx !== lastMovingIdx) { lastMovingIdx = idx; }
    }

    // SDF shapes — 1 shape per second
    {
      const idx = Math.floor(elapsed % SDF_SHAPES.length);
      sdfScene.uniforms.iTime.value        = elapsed;
      sdfScene.uniforms.u_shapeIndex.value = idx + 1;
      if (idx !== lastSdfIdx) { lastSdfIdx = idx; }
    }

    // Static scalar fields — 1 surface per second
    {
      const idx = Math.floor(elapsed % SCALAR_SURFACES.length);
      scalarScene.uniforms.iTime.value          = elapsed;
      scalarScene.uniforms.u_surfaceIndex.value = idx + 1;
      if (idx !== lastScalarIdx) { lastScalarIdx = idx; }
    }

    // Platonic — each pair runs for one 5 s morph cycle (15 s total cycle)
    {
      const pairPhase   = elapsed % 15.0;
      const pair        = Math.floor(pairPhase / 5.0);
      const pairElapsed = pairPhase % 5.0;
      platonicScene.uniforms.iTime.value  = elapsed;
      platonicScene.uniforms.u_pair.value = pair;
      platonicScene.uniforms.u_t.value    = cycleT(pairElapsed);
      if (pair !== lastPlatonicPair) { lastPlatonicPair = pair; }
    }

    // Update label for the active source (order: SDF, Platonic, Scalar, Moving)
    if (activeSource === 0) {
      nameEl.textContent = SDF_SHAPES[lastSdfIdx];
    } else if (activeSource === 1) {
      nameEl.textContent = PLATONIC_PAIRS[lastPlatonicPair];
    } else if (activeSource === 2) {
      nameEl.textContent = SCALAR_SURFACES[lastScalarIdx];
    } else {
      nameEl.textContent = MOVING_SHAPES[lastMovingIdx];
    }

    const { scene } = sources[activeSource];
    renderer.render(scene, cam);
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
    setParam('u_ssaa', on ? 1 : 0);
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });

  function setParam(name, value) {
    for (const src of sources) src.uniforms[name].value = value;
  }

  [
    ['sl-rim',   'u_rimPow',     'vl-rim',   v => v.toFixed(1)],
    ['sl-base',  'u_base',       'vl-base',  v => v.toFixed(3)],
    ['sl-sstr',  'u_sssStr',     'vl-sstr',  v => v.toFixed(2)],
    ['sl-sdens', 'u_sssDensity', 'vl-sdens', v => v.toFixed(1)],
  ].forEach(([id, uname, vid, fmt]) => {
    const input = document.getElementById(id);
    const valEl = document.getElementById(vid);
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      valEl.textContent = fmt(v);
      setParam(uname, v);
    });
  });

  updateBtn();
  renderAt(0);
}

init().catch(console.error);
