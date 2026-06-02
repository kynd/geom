import * as THREE from 'three';

const SOUND_FILES = [
  { value: 'arp',    label: 'arp',    base: '250621_a1_mix1_arp' },
  { value: 'bass',   label: 'bass',   base: '250621_a1_mix1_bass' },
  { value: 'hat',    label: 'hat',    base: '250621_a1_mix1_hat' },
  { value: 'kick1',  label: 'kick 1', base: '250621_a1_mix1_kick1' },
  { value: 'kick2',  label: 'kick 2', base: '250621_a1_mix1_kick2' },
  { value: 'pad',    label: 'pad',    base: '250621_a1_mix1_pad' },
  { value: 'snare',  label: 'snare',  base: '250621_a1_mix1_snare' },
  { value: 'master', label: 'master', base: '250621_a1_mix1_master_88.2k24' },
];

const FPS = 60;
let frames = [], startFrame = 0, currentFrame = 0;
let isPlaying = false, audio = null;

function parseData(text) {
  return text.split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const v = l.trim().split(/\s+/).map(Number);
      const ampL = v[0], ampR = v[1];
      const fftL = v.slice(2, 130), fftR = v.slice(130, 258);
      return { ampL, ampR, fftL, fftR, amp: (ampL + ampR) * 0.5, fft: fftL };
    });
}

function findStartFrame(data, threshold = 0.0001) {
  for (let i = 0; i < data.length; i++) if (data[i].amp > threshold) return i;
  return 0;
}

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const selectEl = document.getElementById('sound-select');
  const W = canvas.width, H = canvas.height;

  const [lightSrc, fragTmpl, vertSrc] = await Promise.all([
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);
  const fragSrc = fragTmpl.replace('// INCLUDE_LIGHTING', lightSrc);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 128-sample amplitude history: index 0 = oldest, index 127 = newest
  const ampHistData = new Uint8Array(128 * 4);
  const ampHistTex  = new THREE.DataTexture(ampHistData, 128, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  ampHistTex.magFilter = THREE.LinearFilter;
  ampHistTex.minFilter = THREE.LinearFilter;
  ampHistTex.needsUpdate = true;
  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_amp_hist:  { value: ampHistTex },
    u_amp:       { value: 0.0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  let startTs = null;
  function loop(ts) {
    requestAnimationFrame(loop);
    if (startTs === null) startTs = ts;
    uniforms.iTime.value = (ts - startTs) * 0.001;

    if (isPlaying && audio)
      currentFrame = Math.min(Math.floor(audio.currentTime * FPS), frames.length - 1);

    if (frames.length > 0) {
      const f = frames[Math.min(currentFrame, frames.length - 1)];
      // Shift history left (drop oldest), append current amplitude at index 127
      ampHistData.copyWithin(0, 4, 128 * 4);
      ampHistData[127 * 4]     = Math.round(f.amp * 255);
      ampHistData[127 * 4 + 3] = 255;
      ampHistTex.needsUpdate = true;
      uniforms.u_amp.value = f.amp;
    }
    renderer.render(scene, cam);
  }
  requestAnimationFrame(loop);

  function setPlaying(play) {
    if (!audio) return;
    isPlaying = play;
    playBtn.innerHTML = play ? pauseIcon() : playIcon();
    if (play) audio.play().catch(() => {});
    else audio.pause();
  }

  async function loadSound(fileObj) {
    setPlaying(false);
    if (audio) { audio.pause(); audio.src = ''; audio = null; }
    frames = []; currentFrame = 0; ampHistData.fill(0); ampHistTex.needsUpdate = true;

    const basePath = `../../sound/${fileObj.base}`;
    frames     = parseData(await fetch(`${basePath}.txt`).then(r => r.text()));
    startFrame = findStartFrame(frames);
    currentFrame = startFrame;

    audio = new Audio(`${basePath}.wav`);
    audio.addEventListener('loadedmetadata', () => { audio.currentTime = startFrame / FPS; });
    audio.addEventListener('ended', () => {
      setPlaying(false);
      currentFrame = startFrame;
      audio.currentTime = startFrame / FPS;
    });
    playBtn.innerHTML = playIcon();
  }

  playBtn.innerHTML = playIcon();
  playBtn.addEventListener('click', () => { if (frames.length) setPlaying(!isPlaying); });
  selectEl.addEventListener('change', () => {
    loadSound(SOUND_FILES.find(f => f.value === selectEl.value) || SOUND_FILES[0]);
  });
  loadSound(SOUND_FILES[0]);
}

init();
