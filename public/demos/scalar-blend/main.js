import * as THREE from 'three';

const SHAPES = [
  // Static — no time-varying internal parameters
  { idx:  1, label: 'Elliptic paraboloid',  group: 'Static' },
  { idx:  2, label: 'Hyperbolic paraboloid', group: 'Static' },
  { idx:  3, label: 'Cone',                 group: 'Static' },
  { idx:  4, label: 'Sphere',               group: 'Static' },
  { idx:  5, label: 'Torus',                group: 'Static' },
  { idx:  6, label: 'Hyperboloid',          group: 'Static' },
  { idx:  7, label: 'Monkey saddle',        group: 'Static' },
  { idx:  8, label: 'Wave surface',         group: 'Static' },
  { idx:  9, label: 'Ripple',               group: 'Static' },
  { idx: 10, label: 'Ellipsoid',            group: 'Static' },
  // Moving — parameters animate with time
  { idx: 11, label: 'Traveling ripple',     group: 'Moving' },
  { idx: 12, label: 'Rippling torus',       group: 'Moving' },
  { idx: 13, label: 'Wave sheet',           group: 'Moving' },
  { idx: 14, label: 'Pulsing sphere',       group: 'Moving' },
  { idx: 15, label: 'Oscillating saddle',   group: 'Moving' },
  { idx: 16, label: 'Gyroid',               group: 'Moving' },
  { idx: 17, label: 'Schwartz P',           group: 'Moving' },
  { idx: 18, label: 'Lemniscate',           group: 'Moving' },
  { idx: 19, label: 'Swaying ellipsoid',    group: 'Moving' },
  { idx: 20, label: 'Tanglecube',           group: 'Moving' },
  { idx: 21, label: 'Chmutov T₄',          group: 'Moving' },
  { idx: 22, label: 'Rippled cone',         group: 'Moving' },
  { idx: 23, label: 'Pulsing Gaussian',     group: 'Moving' },
  { idx: 24, label: 'Schoen I-WP',         group: 'Moving' },
  { idx: 25, label: 'Saddle blend',         group: 'Moving' },
  { idx: 26, label: 'Twisted torus',        group: 'Moving' },
  { idx: 27, label: 'Bumpy sphere',         group: 'Moving' },
  { idx: 28, label: 'Wavy hyperboloid',     group: 'Moving' },
  { idx: 29, label: 'Permuted cubic',       group: 'Moving' },
  { idx: 30, label: 'Flipping paraboloid',  group: 'Moving' },
];

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

function buildSelect(el, defaultIdx) {
  const groups = {};
  for (const s of SHAPES) {
    if (!groups[s.group]) groups[s.group] = [];
    groups[s.group].push(s);
  }
  for (const [groupName, shapes] of Object.entries(groups)) {
    const og = document.createElement('optgroup');
    og.label = groupName;
    for (const s of shapes) {
      const opt = document.createElement('option');
      opt.value = s.idx;
      opt.textContent = s.label;
      if (s.idx === defaultIdx) opt.selected = true;
      og.appendChild(opt);
    }
    el.appendChild(og);
  }
}

async function init() {
  const canvas     = document.getElementById('canvas');
  const playBtn    = document.getElementById('play-btn');
  const aaBtn      = document.getElementById('aa-btn');
  const selectA    = document.getElementById('shape-a');
  const selectB    = document.getElementById('shape-b');
  const blendSlider = document.getElementById('blend-slider');
  const W = canvas.width, H = canvas.height;

  buildSelect(selectA, 4);   // default A: Sphere
  buildSelect(selectB, 16);  // default B: Gyroid

  const [scalarMarcherSrc, lightingSrc, fragTemplate, vertSrc] = await Promise.all([
    fetch('../../shaders/scalar-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragSrc = fragTemplate
    .replace('// INCLUDE_LIGHTING', lightingSrc)
    .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_shapeA:    { value: 4 },
    u_shapeB:    { value: 16 },
    u_blend:     { value: 0.5 },
    u_ssaa:      { value: 0 },
  };

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  selectA.addEventListener('change', () => { uniforms.u_shapeA.value = parseInt(selectA.value); });
  selectB.addEventListener('change', () => { uniforms.u_shapeB.value = parseInt(selectB.value); });
  blendSlider.addEventListener('input', () => { uniforms.u_blend.value = blendSlider.value / 1000; });

  let isPlaying = false;
  let startTime = null;
  let pausedAt  = 0;
  let rafId     = null;

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function frame(ms) {
    rafId = requestAnimationFrame(frame);
    uniforms.iTime.value = pausedAt + (ms - startTime) * 0.001;
    renderer.render(scene, camera);
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
    cancelAnimationFrame(rafId);
    rafId = null;
    updateBtn();
  }

  playBtn.addEventListener('click', () => isPlaying ? pause() : play());

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  renderer.render(scene, camera);
  updateBtn();
}

init().catch(console.error);
