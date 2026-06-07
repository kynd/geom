import * as THREE from 'three';

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

const FPS = 60;
let frames = [], startFrame = 0;
let isPlaying = false, audio = null;

function parseData(text) {
  return text.split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const v = l.trim().split(/\s+/).map(Number);
      return {
        ampL: v[0], ampR: v[1],
        fftL: v.slice(2, 130),
        amp: (v[0] + v[1]) * 0.5,
      };
    });
}

function findStartFrame(data) {
  for (let i = 0; i < data.length; i++) if (data[i].amp > 0.0001) return i;
  return 0;
}

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

async function init() {
  const canvas   = document.getElementById('canvas');
  const playBtn  = document.getElementById('play-btn');
  const selectEl = document.getElementById('sound-select');
  const W = canvas.width, H = canvas.height;

  const [fragSrc, vertSrc] = await Promise.all([
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const fftBuf = new Float32Array(128);
  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_amp:       { value: 0.0 },
    u_fft:       { value: fftBuf },
    u_ssaa:      { value: 1 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  let startTs = null, pauseStart = 0, rafId = null;

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (startTs === null) startTs = ts;
    uniforms.iTime.value = (ts - startTs) * 0.001;

    if (audio && frames.length > 0) {
      const f = frames[Math.min(Math.floor(audio.currentTime * FPS), frames.length - 1)];
      fftBuf.set(f.fftL);
      uniforms.u_amp.value = f.amp;
    }
    renderer.render(scene, cam);
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
    frames = []; fftBuf.fill(0); uniforms.u_amp.value = 0;

    const basePath = `../../../public/sound/${fileObj.base}`;
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
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });

  selectEl.addEventListener('change', () => {
    loadSound(SOUND_FILES.find(f => f.value === selectEl.value) || SOUND_FILES[0]);
  });

  loadSound(SOUND_FILES[0]);
}

init();
