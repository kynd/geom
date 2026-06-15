import * as THREE from 'three';

async function init() {
  const canvas = document.getElementById('canvas');
  const W = canvas.width, H = canvas.height;

  const [fragSrc, vertSrc] = await Promise.all([
    fetch('./shaders/fragment.glsl').then(r => r.text()),
    fetch('./shaders/vertex.glsl').then(r => r.text()),
  ]);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const scene = new THREE.Scene();

  const uniforms = {
    iResolution: { value: new THREE.Vector2(W, H) },
    u_ssaa:      { value: 1 },
  };

  scene.add(new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vertSrc, fragmentShader: fragSrc })
  ));

  function render() { renderer.render(scene, cam); }
  render();

  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    render();
  });
}

init();
