import * as THREE from 'three';

const STEMS = [
  { label: 'Arp',    bin: '250621_a1_mix1_arp.bin',   mp3: '250621_a1_mix1_arp.mp3'   },
  { label: 'Bass',   bin: '250621_a1_mix1_bass.bin',  mp3: '250621_a1_mix1_bass.mp3'  },
  { label: 'Hat',    bin: '250621_a1_mix1_hat.bin',   mp3: '250621_a1_mix1_hat.mp3'   },
  { label: 'Kick 1', bin: '250621_a1_mix1_kick1.bin', mp3: '250621_a1_mix1_kick1.mp3' },
  { label: 'Kick 2', bin: '250621_a1_mix1_kick2.bin', mp3: '250621_a1_mix1_kick2.mp3' },
  { label: 'Pad',    bin: '250621_a1_mix1_pad.bin',   mp3: '250621_a1_mix1_pad.mp3'   },
  { label: 'Snare',  bin: '250621_a1_mix1_snare.bin', mp3: '250621_a1_mix1_snare.mp3' },
];

const SHAPES = [
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

// Default shape assignment per stem
const DEFAULT_SHAPES = [13, 22, 3, 1, 27, 30, 21];

const SOUND_BASE = '../../sound/full/';
const FPS   = 60;
const ALPHA = 0.92;
const BETA  = 5.0;
let FLOOR = 0.25;
const N     = STEMS.length;

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const stride = 258, n = (f32.length / stride) | 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    out[i] = { ampL: f32[o], ampR: f32[o + 1] };
  }
  return out;
}

function computeOnset(frames) {
  const out = new Float32Array(frames.length);
  let prevAmp = 0, prevOnset = 0;
  for (let i = 0; i < frames.length; i++) {
    const amp   = (frames[i].ampL + frames[i].ampR) * 0.5;
    const delta = Math.max(0, amp - prevAmp);
    const onset = Math.max(delta, prevOnset * ALPHA);
    out[i] = onset; prevAmp = amp; prevOnset = onset;
  }
  return out;
}

function buildShapeSelect(defaultIdx) {
  const sel = document.createElement('select');
  sel.className = 'shape-sel';
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
    sel.appendChild(og);
  }
  return sel;
}

async function init() {
  const canvas      = document.getElementById('canvas');
  const playBtn     = document.getElementById('play-btn');
  const aaBtn       = document.getElementById('aa-btn');
  const seekEl      = document.getElementById('seek');
  const timeCur     = document.getElementById('time-current');
  const timeTot     = document.getElementById('time-total');
  const loadEl      = document.getElementById('loading');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const W = canvas.width, H = canvas.height;

  // ── Loading UI ─────────────────────────────────────────────────────────────
  const loadContainer = document.getElementById('loading-tracks');
  const loadBars = STEMS.map(s => {
    const row = document.createElement('div');
    row.className = 'load-row';
    row.innerHTML =
      `<span class="load-name">${s.label}</span>` +
      `<div class="load-bar-bg"><div class="load-bar-fill indeterminate"></div></div>` +
      `<span class="load-pct"></span>`;
    loadContainer.appendChild(row);
    return { fill: row.querySelector('.load-bar-fill'), pct: row.querySelector('.load-pct') };
  });

  const rawData = await Promise.all(
    STEMS.map((s, i) =>
      fetch(SOUND_BASE + s.bin).then(r => r.arrayBuffer()).then(buf => {
        loadBars[i].fill.classList.remove('indeterminate');
        loadBars[i].fill.style.width = '100%';
        loadBars[i].pct.textContent  = '100%';
        return parseBinary(buf);
      })
    )
  );
  const onsetData = rawData.map(computeOnset);

  loadEl.classList.add('fade-out');
  loadEl.addEventListener('transitionend', () => loadEl.remove(), { once: true });

  // ── Audio ──────────────────────────────────────────────────────────────────
  const stemAudios = STEMS.map(s => { const a = new Audio(SOUND_BASE + s.mp3); a.preload = 'auto'; return a; });
  const clock = stemAudios[0];

  function stemPlay()  { stemAudios.forEach(a => a.play().catch(() => {})); }
  function stemPause() { stemAudios.forEach(a => a.pause()); }
  function stemSeek(t) { stemAudios.forEach(a => { a.currentTime = t; }); }
  function syncDrift() {
    const t = clock.currentTime;
    stemAudios.forEach(a => { if (Math.abs(a.currentTime - t) > 0.25) a.currentTime = t; });
  }

  // ── Three.js ───────────────────────────────────────────────────────────────
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
    u_ssaa:      { value: 0 },
    u_s0: { value: DEFAULT_SHAPES[0] }, u_w0: { value: 1/N },
    u_s1: { value: DEFAULT_SHAPES[1] }, u_w1: { value: 1/N },
    u_s2: { value: DEFAULT_SHAPES[2] }, u_w2: { value: 1/N },
    u_s3: { value: DEFAULT_SHAPES[3] }, u_w3: { value: 1/N },
    u_s4: { value: DEFAULT_SHAPES[4] }, u_w4: { value: 1/N },
    u_s5: { value: DEFAULT_SHAPES[5] }, u_w5: { value: 1/N },
    u_s6: { value: DEFAULT_SHAPES[6] }, u_w6: { value: 1/N },
  };
  const shapeU  = [uniforms.u_s0, uniforms.u_s1, uniforms.u_s2, uniforms.u_s3, uniforms.u_s4, uniforms.u_s5, uniforms.u_s6];
  const weightU = [uniforms.u_w0, uniforms.u_w1, uniforms.u_w2, uniforms.u_w3, uniforms.u_w4, uniforms.u_w5, uniforms.u_w6];

  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));

  // ── Settings panel ─────────────────────────────────────────────────────────
  let soloStem = -1;
  const soloButtons = [];

  function setSolo(i) {
    soloStem = soloStem === i ? -1 : i;
    soloButtons.forEach((btn, j) => btn.classList.toggle('active', j === soloStem));
  }

  const selects = STEMS.map((s, i) => {
    const row = document.createElement('div');
    row.className = 'stem-row';
    const label = document.createElement('span');
    label.className = 'stem-name';
    label.textContent = s.label;
    const sel = buildShapeSelect(DEFAULT_SHAPES[i]);
    sel.addEventListener('change', () => { shapeU[i].value = parseInt(sel.value); });
    const soloBtn = document.createElement('button');
    soloBtn.className = 'solo-btn';
    soloBtn.textContent = 'Solo';
    soloBtn.addEventListener('click', () => setSolo(i));
    soloButtons.push(soloBtn);
    row.appendChild(label);
    row.appendChild(sel);
    row.appendChild(soloBtn);
    settingsPanel.appendChild(row);
    return sel;
  });

  // Alpha (floor) slider at the bottom of the settings panel
  const alphaDivider = document.createElement('div');
  alphaDivider.className = 'alpha-divider';
  settingsPanel.appendChild(alphaDivider);

  const alphaRow = document.createElement('div');
  alphaRow.className = 'stem-row alpha-row';
  const alphaLabel = document.createElement('span');
  alphaLabel.className = 'stem-name alpha-label';
  alphaLabel.textContent = 'Floor α';
  const alphaSlider = document.createElement('input');
  alphaSlider.type = 'range'; alphaSlider.min = '0'; alphaSlider.max = '100';
  alphaSlider.value = '25'; alphaSlider.step = '1'; alphaSlider.className = 'floor-range';
  const alphaValEl = document.createElement('span');
  alphaValEl.className = 'floor-val';
  alphaValEl.textContent = '0.25';
  alphaSlider.addEventListener('input', () => {
    FLOOR = parseInt(alphaSlider.value) / 100;
    alphaValEl.textContent = FLOOR.toFixed(2);
  });
  alphaRow.appendChild(alphaLabel);
  alphaRow.appendChild(alphaSlider);
  alphaRow.appendChild(alphaValEl);
  settingsPanel.appendChild(alphaRow);

  // Weight indicator bars
  const weightsEl = document.getElementById('stem-weights');
  const swRows = STEMS.map((s, i) => {
    const row = document.createElement('div');
    row.className = 'sw-row';
    const nameEl = document.createElement('span');
    nameEl.className = 'sw-name';
    nameEl.textContent = s.label;
    const barsEl = document.createElement('div');
    barsEl.className = 'sw-bars';
    const softBar = document.createElement('div');
    softBar.className = 'sw-bar sw-bar-soft';
    const finalBar = document.createElement('div');
    finalBar.className = 'sw-bar sw-bar-final';
    barsEl.appendChild(softBar);
    barsEl.appendChild(finalBar);
    row.appendChild(nameEl);
    row.appendChild(barsEl);
    weightsEl.appendChild(row);
    return { softBar, finalBar };
  });

  settingsBtn.addEventListener('click', () => {
    const open = settingsPanel.classList.toggle('open');
    settingsBtn.classList.toggle('open', open);
    settingsBtn.setAttribute('aria-expanded', String(open));
  });

  // ── Play / pause ───────────────────────────────────────────────────────────
  let isPlaying = false;

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updateBtn();

  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    isPlaying ? stemPlay() : stemPause();
    updateBtn();
  });
  clock.addEventListener('ended', () => { isPlaying = false; updateBtn(); });

  clock.addEventListener('loadedmetadata', () => {
    stemSeek(0);
    timeTot.textContent = formatTime(clock.duration);
    seekEl.max = '10000'; seekEl.value = '0';
    timeCur.textContent = '0:00';
  });

  let seeking = false;
  clock.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = clock.currentTime, d = clock.duration || 1;
    seekEl.value = Math.round((t / d) * 10000);
    timeCur.textContent = formatTime(t);
    syncDrift();
  });
  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
  seekEl.addEventListener('input',  () => { timeCur.textContent = formatTime((seekEl.value / 10000) * (clock.duration || 0)); });
  seekEl.addEventListener('change', () => { stemSeek((seekEl.value / 10000) * (clock.duration || 0)); seeking = false; });

  // ── SSAA ───────────────────────────────────────────────────────────────────
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  // ── Render loop ────────────────────────────────────────────────────────────
  let iTime = 0, lastMs = null;

  function frame(ms) {
    requestAnimationFrame(frame);
    if (lastMs !== null && isPlaying) iTime += (ms - lastMs) * 0.001;
    lastMs = ms;

    const fi = Math.min(Math.floor(clock.currentTime * FPS), rawData[0].length - 1);
    const lvl = rawData.map(f  => { const fr = f[fi]; return (fr.ampL + fr.ampR) * 0.5; });
    const ons = onsetData.map(h => h[fi]);

    let softWeights, finalWeights;
    if (soloStem >= 0) {
      softWeights  = Array.from({ length: N }, (_, i) => i === soloStem ? 1.0 : 0.0);
      finalWeights = softWeights.slice();
    } else {
      const exps   = Array.from({ length: N }, (_, i) => Math.exp(BETA * (lvl[i] + ons[i])));
      const expSum = exps.reduce((a, b) => a + b, 0) || 1;
      softWeights  = exps.map(e => e / expSum);
      const maxW   = Math.max(...softWeights);
      const tau    = FLOOR * maxW;
      const sparse = softWeights.map(w => w >= tau ? w : 0);
      const sparseSum = sparse.reduce((a, b) => a + b, 0) || 1;
      finalWeights = sparse.map(w => w / sparseSum);
    }
    weightU.forEach((u, i) => { u.value = finalWeights[i]; });
    swRows.forEach((r, i) => {
      r.softBar.style.transform  = `scaleX(${softWeights[i]})`;
      r.finalBar.style.transform = `scaleX(${finalWeights[i]})`;
    });

    uniforms.iTime.value = iTime;
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);
}

init().catch(console.error);
