import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

async function init() {
  const canvas     = document.getElementById('canvas');
  const playBtn    = document.getElementById('play-btn');
  const aaBtn      = document.getElementById('aa-btn');
  const colorBtn   = document.getElementById('color-btn');
  const bloomRange = document.getElementById('bloom-range');

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

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    iTime:       { value: 0.0 },
    u_ssaa:      { value: 0 },
    u_tStart:    { value: 1.0 },
    u_tEnd:      { value: 3.0 },
    u_waveSpeed: { value: 5.0 },
    u_render:    { value: 0 },
  };

  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));

  const composer  = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cam));
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), 0.8, 0.5, 0.5);
  composer.addPass(bloomPass);

  let isPlaying = false;
  let startTime = null;
  let pausedAt  = 0;
  let rafId     = null;

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function frame(ts) {
    rafId = requestAnimationFrame(frame);
    if (startTime === null) startTime = ts;
    uniforms.iTime.value = (pausedAt + (ts - startTime) * 0.001) * 1.8;
    composer.render();
  }

  function play() {
    isPlaying = true;
    startTime = null;
    updateBtn();
    if (!rafId) rafId = requestAnimationFrame(frame);
  }

  function pause() {
    if (startTime !== null) pausedAt += (performance.now() - startTime) * 0.001;
    startTime = null;
    isPlaying = false;
    cancelAnimationFrame(rafId);
    rafId = null;
    updateBtn();
  }

  playBtn.addEventListener('click', () => { isPlaying ? pause() : play(); });

  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
  });

  colorBtn.addEventListener('click', () => {
    const on = colorBtn.classList.toggle('active');
    uniforms.u_render.value = on ? 1 : 0;
    colorBtn.setAttribute('aria-label', on ? 'Color mode on' : 'Rim light mode on');
  });

  bloomRange.addEventListener('input', () => {
    bloomPass.strength = parseFloat(bloomRange.value);
  });

  // Render first frame paused
  uniforms.iTime.value = 0;
  composer.render();
  updateBtn();
}

init();
