import * as THREE from 'three';

const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

// Smooth full-period cosine oscillation: 0 → 1 → 0 over 5 s, zero velocity at both ends
function cycleT(elapsed) {
  const p = (elapsed % 5.0) / 5.0;
  return 0.5 - 0.5 * Math.cos(p * Math.PI * 2);
}

async function init() {
  const canvas  = document.getElementById('canvas');
  const playBtn = document.getElementById('play-btn');
  const W = canvas.width, H = canvas.height;
  const vpW = Math.floor(W / 3);

  const [platonicSrc, sdfMarcherSrc, lightSrc, fragTmpl, vertSrc] = await Promise.all([
    fetch('../../shaders/platonic-functions.glsl').then(r => r.text()),
    fetch('../../shaders/sdf-marcher.glsl').then(r => r.text()),
    fetch('../../shaders/lighting.glsl').then(r => r.text()),
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  renderer.autoClear = false;

  const scenes = [0, 1, 2].map(pair => {
    const fragSrc = fragTmpl
      .replace('// PAIR is injected as a #define (0=cube/oct, 1=tet/tet, 2=dodec/icos)',
               `#define PAIR ${pair}`)
      .replace('// INCLUDE_PLATONIC_FUNCTIONS', platonicSrc)
      .replace('// INCLUDE_SDF_MARCHER', sdfMarcherSrc)
      .replace('// INCLUDE_LIGHTING', lightSrc);

    const uniforms = {
      iResolution: { value: new THREE.Vector2(vpW, H) },
      iTime:       { value: 0.0 },
      u_vpx:       { value: pair * vpW },
      u_t:         { value: 0.0 },
      u_ssaa:      { value: 0 },
    };

    const mat  = new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    const scene = new THREE.Scene();
    scene.add(mesh);
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    return { scene, cam, uniforms, x: pair * vpW };
  });

  let isPlaying = false;
  let startTime = null;
  let pausedAt  = 0;
  let rafId     = null;

  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function renderAtTime(elapsed) {
    const t = cycleT(elapsed);
    renderer.clear();
    scenes.forEach(s => {
      s.uniforms.iTime.value = elapsed;
      s.uniforms.u_t.value   = t;
      renderer.setViewport(s.x, 0, vpW, H);
      renderer.setScissor(s.x, 0, vpW, H);
      renderer.setScissorTest(true);
      renderer.render(s.scene, s.cam);
    });
  }

  function frame(ms) {
    rafId = requestAnimationFrame(frame);
    renderAtTime(pausedAt + (ms - startTime) * 0.001);
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
    scenes.forEach(s => { s.uniforms.u_ssaa.value = on ? 1 : 0; });
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });

  updateBtn();
  renderAtTime(0);
}

init();
