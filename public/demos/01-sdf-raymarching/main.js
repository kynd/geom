import * as THREE from 'three';

const SHAPES = [
  { name: 'sphere',              func: 'sdSphere( p, r )',                         duration: 1.0 },
  { name: 'box',                 func: 'sdBox( p, b )',                            duration: 1.0 },
  { name: 'round box',           func: 'sdRoundBox( p, b, r )',                    duration: 1.0 },
  { name: 'box frame',           func: 'sdBoxFrame( p, b, e )',                    duration: 1.0 },
  { name: 'torus',               func: 'sdTorus( p, t )',                          duration: 1.0 },
  { name: 'capped torus',        func: 'sdCappedTorus( p, sc, ra, rb )',           duration: 1.0 },
  { name: 'link',                func: 'sdLink( p, le, r1, r2 )',                  duration: 1.0 },
  { name: 'infinite cylinder',   func: 'sdCylinder( p, c )',                       duration: 1.0 },
  { name: 'cone',                func: 'sdCone( p, c, h )',                        duration: 1.0 },
  { name: 'infinite cone',       func: 'sdInfiniteCone( p, c )',                   duration: 1.0 },
  { name: 'hexagonal prism',     func: 'sdHexPrism( p, h )',                       duration: 1.0 },
  { name: 'capsule',             func: 'sdCapsule( p, a, b, r )',                  duration: 1.0 },
  { name: 'vertical capsule',    func: 'sdVerticalCapsule( p, h, r )',             duration: 1.0 },
  { name: 'capped cylinder',     func: 'sdCappedCylinder( p, r, h )',              duration: 1.0 },
  { name: 'arb. cylinder',       func: 'sdCappedCylinder( p, a, b, r )',           duration: 1.0 },
  { name: 'rounded cylinder',    func: 'sdRoundedCylinder( p, ra, rb, h )',        duration: 1.0 },
  { name: 'capped cone',         func: 'sdCappedCone( p, h, r1, r2 )',            duration: 1.0 },
  { name: 'arb. capped cone',    func: 'sdCappedCone( p, a, b, ra, rb )',         duration: 1.0 },
  { name: 'solid angle',         func: 'sdSolidAngle( p, c, ra )',                 duration: 1.0 },
  { name: 'cut sphere',          func: 'sdCutSphere( p, r, h )',                   duration: 1.0 },
  { name: 'cut hollow sphere',   func: 'sdCutHollowSphere( p, r, h, t )',          duration: 1.0 },
  { name: 'death star',          func: 'sdDeathStar( p, ra, rb, d )',              duration: 1.0 },
  { name: 'round cone',          func: 'sdRoundCone( p, r1, r2, h )',              duration: 1.0 },
  { name: 'arb. round cone',     func: 'sdRoundCone( p, a, b, r1, r2 )',          duration: 1.0 },
  { name: 'vesica segment',      func: 'sdVesicaSegment( p, a, b, w )',            duration: 1.0 },
  { name: 'rhombus',             func: 'sdRhombus( p, la, lb, h, ra )',            duration: 1.0 },
  { name: 'octahedron',          func: 'sdOctahedron( p, s )',                     duration: 1.0 },
  { name: 'octahedron (fast)',   func: 'sdOctahedronFast( p, s )  [approx]',       duration: 1.0 },
  { name: 'pyramid',             func: 'sdPyramid( p, h )',                        duration: 1.0 },
  { name: 'ellipsoid',           func: 'sdEllipsoid( p, r )  [approx]',            duration: 1.0 },
  { name: 'triangular prism',    func: 'sdTriPrism( p, h )  [approx]',             duration: 1.0 },
];

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

async function init() {
  const canvas  = document.getElementById('canvas');
  const playBtn = document.getElementById('play-btn');
  const W = canvas.width;
  const H = canvas.height;

  const [sdfSrc, sdfMarcherSrc, lightingSrc, fragTemplate, vertSrc] = await Promise.all([
    fetch('../../shaders/sdf-functions.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTemplate
    .replace('// INCLUDE_SDF_FUNCTIONS', sdfSrc)
    .replace('// INCLUDE_SDF_MARCHER', sdfMarcherSrc)
    .replace('// INCLUDE_LIGHTING', lightingSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    iResolution:  { value: new THREE.Vector2(W, H) },
    iTime:        { value: 0.0 },
    u_shapeIndex: { value: 1 },
    u_ssaa:       { value: 0 },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  const nameEl = document.getElementById('shape-name');
  const funcEl = document.getElementById('shape-func');

  const offsets = [];
  let total = 0;
  for (const s of SHAPES) { offsets.push(total); total += s.duration; }

  function shapeIndexAtTime(t) {
    const wrapped = t % total;
    for (let i = SHAPES.length - 1; i >= 0; i--) {
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
    const idx = shapeIndexAtTime(t);
    uniforms.u_shapeIndex.value = idx + 1;
    if (idx !== lastIdx) {
      nameEl.textContent = SHAPES[idx].name;
      funcEl.textContent = SHAPES[idx].func;
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
