import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const SHAPES = [
  'sphere', 'box', 'round box', 'box frame', 'torus', 'capped torus', 'link',
  'infinite cylinder', 'cone', 'infinite cone', 'hexagonal prism', 'capsule',
  'vertical capsule', 'capped cylinder', 'arb. cylinder', 'rounded cylinder',
  'capped cone', 'arb. capped cone', 'solid angle', 'cut sphere',
  'cut hollow sphere', 'death star', 'round cone', 'arb. round cone',
  'vesica segment', 'rhombus', 'octahedron', 'octahedron (fast)', 'pyramid',
  'ellipsoid', 'triangular prism',
];

const SURFACES = [
  'elliptic paraboloid', 'hyperbolic paraboloid', 'cone', 'sphere', 'torus',
  'hyperboloid', 'monkey saddle', 'wave surface', 'ripple', 'ellipsoid',
];

const PLATONIC_PAIRS = [
  'Cube / Octahedron',
  'Tetrahedron / Tetrahedron',
  'Dodecahedron / Icosahedron',
];

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

const SHAPE_DURATION = 5.0;
const FPS = 60;

function cycleT(t) {
  const p = (t % 5.0) / 5.0;
  return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
}

let frames = [], startFrame = 0;
let isPlaying = false, audio = null;

function parseData(text) {
  return text.split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const v = l.trim().split(/\s+/).map(Number);
      return { ampL: v[0], ampR: v[1] };
    });
}

function findStartFrame(data, threshold = 0.0001) {
  for (let i = 0; i < data.length; i++) if (data[i].ampL + data[i].ampR > threshold) return i;
  return 0;
}

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const selectEl = document.getElementById('sound-select');
  const shapeLbl = document.getElementById('shape-label');
  const srcBtns  = Array.from(document.querySelectorAll('.src-btn'));
  const W = canvas.width, H = canvas.height;

  const [
    sdfFuncsSrc, sdfMarcherSrc, scalarMarcherSrc, platonicFuncsSrc,
    fragSDFTmpl, fragScalarTmpl, fragPlatonicTmpl, vertSrc,
  ] = await Promise.all([
    fetch('../../shaders/sdf-functions.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/scalar-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/platonic-functions.glsl').then(r => r.text()),
    fetch('./shaders/fragment-sdf.glsl').then(r => r.text()),
    fetch('./shaders/fragment-scalar.glsl').then(r => r.text()),
    fetch('./shaders/fragment-platonic.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const fragSDF = fragSDFTmpl
    .replace('// INCLUDE_SDF_FUNCTIONS', sdfFuncsSrc)
    .replace('// INCLUDE_SDF_MARCHER',   sdfMarcherSrc);

  const fragScalar = fragScalarTmpl
    .replace('// INCLUDE_SCALAR_MARCHER', scalarMarcherSrc);

  const fragPlatonic = fragPlatonicTmpl
    .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicFuncsSrc)
    .replace('// INCLUDE_SDF_MARCHER',        sdfMarcherSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const renderPass = new RenderPass(null, cam);
  const bloomPass  = new UnrealBloomPass(new THREE.Vector2(W, H), 1.2, 0.6, 0.0);
  const composer   = new EffectComposer(renderer);
  composer.addPass(renderPass);
  composer.addPass(bloomPass);
  const res = new THREE.Vector2(W, H);

  function makeScene(fragSrc, uniforms) {
    const mat   = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
    return { scene, uniforms };
  }

  const ampUniforms = () => ({
    iResolution:  { value: res },
    iTime:        { value: 0.0 },
    u_ampL:       { value: 0.0 },
    u_ampR:       { value: 0.0 },
    u_ssaa:       { value: 1 },
  });

  const sdfScene = makeScene(fragSDF, {
    ...ampUniforms(),
    u_shapeIndex: { value: 1 },
  });

  const scalarScene = makeScene(fragScalar, {
    ...ampUniforms(),
    u_surfaceIndex: { value: 1 },
  });

  const platonicScene = makeScene(fragPlatonic, {
    ...ampUniforms(),
    u_pair: { value: 0 },
    u_t:    { value: 0.0 },
  });

  const sources = [sdfScene, scalarScene, platonicScene];
  let activeSource = 0;

  srcBtns.forEach((btn, i) => {
    btn.addEventListener('click', () => {
      activeSource = i;
      srcBtns.forEach((b, j) => b.classList.toggle('active', i === j));
    });
  });

  let startTs = null, pauseStart = 0, rafId = null;

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (startTs === null) startTs = ts;
    const elapsed = (ts - startTs) * 0.001;

    const audioTime = audio ? audio.currentTime : 0;
    let ampL = 0, ampR = 0;
    if (audio && frames.length > 0) {
      const f = frames[Math.min(Math.floor(audioTime * FPS), frames.length - 1)];
      ampL = f.ampL;
      ampR = f.ampR;
    }

    // SDF
    const sdfIdx = (Math.floor(audioTime / SHAPE_DURATION) % SHAPES.length) + 1;
    sdfScene.uniforms.iTime.value        = elapsed;
    sdfScene.uniforms.u_shapeIndex.value = sdfIdx;
    sdfScene.uniforms.u_ampL.value       = ampL;
    sdfScene.uniforms.u_ampR.value       = ampR;

    // Scalar
    const scalarIdx = (Math.floor(audioTime / SHAPE_DURATION) % SURFACES.length) + 1;
    scalarScene.uniforms.iTime.value          = elapsed;
    scalarScene.uniforms.u_surfaceIndex.value = scalarIdx;
    scalarScene.uniforms.u_ampL.value         = ampL;
    scalarScene.uniforms.u_ampR.value         = ampR;

    // Platonic
    const pairPhase   = audioTime % (PLATONIC_PAIRS.length * SHAPE_DURATION);
    const pair        = Math.floor(pairPhase / SHAPE_DURATION);
    const pairElapsed = pairPhase % SHAPE_DURATION;
    platonicScene.uniforms.iTime.value = elapsed;
    platonicScene.uniforms.u_pair.value = pair;
    platonicScene.uniforms.u_t.value    = cycleT(pairElapsed);
    platonicScene.uniforms.u_ampL.value = ampL;
    platonicScene.uniforms.u_ampR.value = ampR;

    // Label
    if (activeSource === 0)      shapeLbl.textContent = SHAPES[sdfIdx - 1];
    else if (activeSource === 1) shapeLbl.textContent = SURFACES[scalarIdx - 1];
    else                         shapeLbl.textContent = PLATONIC_PAIRS[pair];

    renderPass.scene = sources[activeSource].scene;
    composer.render();
  }

  function setPlaying(play) {
    if (!audio) return;
    isPlaying = play;
    playBtn.innerHTML = play ? pauseIcon() : playIcon();
    if (play) {
      if (pauseStart > 0) { startTs += performance.now() - pauseStart; pauseStart = 0; }
      audio.play().catch(() => {});
      if (!rafId) rafId = requestAnimationFrame(loop);
    } else {
      audio.pause();
      pauseStart = performance.now();
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    }
  }

  async function loadSound(fileObj) {
    const wasPlaying = isPlaying;
    setPlaying(false);
    startTs = null; pauseStart = 0;
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    frames = [];
    for (const src of sources) {
      src.uniforms.u_ampL.value = 0.0;
      src.uniforms.u_ampR.value = 0.0;
    }

    const basePath = `../../sound/${fileObj.base}`;
    frames     = parseData(await fetch(`${basePath}.txt`).then(r => r.text()));
    startFrame = findStartFrame(frames);

    audio = new Audio(`${basePath}.mp3`);
    audio.addEventListener('loadedmetadata', () => {
      audio.currentTime = startFrame / FPS;
      if (wasPlaying) setPlaying(true);
    });
    audio.addEventListener('ended', () => {
      setPlaying(false);
      audio.currentTime = startFrame / FPS;
    });
    if (!wasPlaying) playBtn.innerHTML = playIcon();
  }

  playBtn.innerHTML = playIcon();
  playBtn.addEventListener('click', () => { if (frames.length) setPlaying(!isPlaying); });

  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    for (const src of sources) src.uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });

  selectEl.addEventListener('change', () => {
    loadSound(SOUND_FILES.find(f => f.value === selectEl.value) || SOUND_FILES[0]);
  });

  loadSound(SOUND_FILES[0]);
}

init();
