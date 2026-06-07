import * as THREE from 'three';

const SURFACES = [
  {
    id: 1,
    label: 'Ripple Sphere',
    desc: 'Concentric shells around a sphere. Wave frequency tracks the midrange, amplitude tracks overall loudness — quiet passages compress to a smooth ball, busy ones fracture into rings.',
  },
  {
    id: 2,
    label: 'Bass Bloom',
    desc: 'A sphere that simply inflates on each kick. The radius is a direct mapping of bass energy, so every beat gives a single clean pulse of volume.',
  },
  {
    id: 3,
    label: 'Audio Torus',
    desc: 'A torus whose major radius grows with bass and whose tube thickness grows with treble. Low hits expand the ring outward; high hits fatten the tube.',
  },
  {
    id: 4,
    label: 'Standing Wave',
    desc: 'y = A·sin(kx)·cos(kz) — a classic standing-wave surface. Midrange drives the spatial frequency k; overall amplitude drives the height A. Still water looks like a smooth paraboloid; loud passages corrugate it.',
  },
  {
    id: 5,
    label: 'Spectral Ridges',
    desc: 'Eight frequency bands each raise a concentric ring of terrain. The result is a target-like height field where inner rings respond to bass and outer rings to treble.',
  },
  {
    id: 6,
    label: 'Monkey Saddle',
    desc: 'y = A(x³ − 3xz²), the classic three-valley saddle. Bass energy scales the amplitude A, so the surface is flat at silence and throws three sharp arms at peak bass.',
  },
  {
    id: 7,
    label: 'Hyperboloid',
    desc: 'x² + z² − y² = R. Overall loudness drives R, morphing between a thin waist and a wide double-cone. At zero the hyperboloid degenerates to a cone; loud signals open it into a broad barrel.',
  },
  {
    id: 8,
    label: 'Treble Bumps',
    desc: 'A sphere covered in high-frequency angular bumps. Treble energy controls bump amplitude, so the surface is smooth on pads and covered in spikes on hi-hats.',
  },
  {
    id: 9,
    label: 'Lissajous Knot',
    desc: 'An implicit tube wrapping a 3:2:1 Lissajous space curve. Midrange shifts the phase of the curve; treble controls the tube radius. The shape is kinked and knotted rather than convex.',
  },
  {
    id: 10,
    label: 'Capsule Cluster',
    desc: 'Three cylindrical capsules along X, Y, Z sharing a union. Loudness scales the tube radius, merging them into a fat rounded cross at high levels and separating them into three thin rods at silence.',
  },
  {
    id: 11,
    label: 'Complex Power Shell',
    desc: 'The modulus surface of z^n in the complex plane, lifted to 3D. Bass drives the exponent n — at low n it looks like a sphere; as bass rises the surface sprouts n-fold rotational symmetry.',
  },
  {
    id: 12,
    label: 'Roman Surface',
    desc: 'x²y² + y²z² + z²x² = r⁴, Steiner\'s Roman surface. A self-intersecting quartic with tetrahedral symmetry. Loudness controls r, scaling the structure between a point and a pinched pillow.',
  },
  {
    id: 13,
    label: 'Frequency Spiral',
    desc: 'A helical torus — a tube wrapped around a vertical helix whose pitch grows with bass. The spring tightens on kick hits and relaxes between them.',
  },
  {
    id: 14,
    label: 'Superellipsoid',
    desc: '(|x|^e + |y|^e + |z|^e)^(1/e) = 1. Exponent e is driven by bass: at e=1 it\'s an octahedron, at e=2 a sphere, at high e a rounded cube. Each kick deforms the shape through this family.',
  },
  {
    id: 15,
    label: 'Scherk Surface',
    desc: 'cos(ay) = cos(ax)·cos(az) — a classical minimal surface. Midrange drives the spatial frequency; overall amplitude offsets the equation, collapsing the open tunnels at peak loudness.',
  },
  {
    id: 16,
    label: 'Imaginary Cubic',
    desc: 'y = A·Im((x+iy)³) = A(3x²y − y³). The imaginary part of the complex cube, forming a three-lobed propeller. Bass drives A, spinning the lobes from flat to dramatic.',
  },
  {
    id: 17,
    label: 'Azimuthal Waves',
    desc: 'r² = 0.6 + B·cos(n·θ) in spherical coordinates. Treble drives n (the number of petals) and amplitude drives B. At silence it\'s a sphere; loud passages fold it into a flower with treble-controlled petal count.',
  },
  {
    id: 18,
    label: 'Nested Shells',
    desc: 'Three concentric spherical shells, each driven by a different FFT band. When the bands are balanced all three shells glow at once; on a kick only the innermost shell expands, on treble only the outermost.',
  },
  {
    id: 19,
    label: 'Audio Gyroid',
    desc: 'cos(x)sin(y) + cos(y)sin(z) + cos(z)sin(x) = k, a triply-periodic minimal surface. Loudness shifts k, opening and closing the tunnels — at silence the gyroid is thin-walled; at peak loudness it collapses to disconnected blobs.',
  },
  {
    id: 20,
    label: 'Bass Kuen',
    desc: 'A quartic surface modeled on the Kuen surface, a non-Euclidean pseudosphere. Bass controls height and treble controls the twisting coefficient, producing saddle-like geometry that crinkles dramatically on complex audio.',
  },
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

const FPS = 60;
let frames = [], startFrame = 0, isPlaying = false, audio = null;

function parseData(text) {
  return text.split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const v = l.trim().split(/\s+/).map(Number);
      return {
        ampL: v[0], ampR: v[1],
        fftL: v.slice(2, 130), fftR: v.slice(130, 258),
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
  const surfSel  = document.getElementById('surface-select');
  const soundSel = document.getElementById('sound-select');
  const descEl   = document.getElementById('desc');
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
    u_ampL:      { value: 0.0 },
    u_ampR:      { value: 0.0 },
    u_fft:       { value: fftBuf },
    u_surface:   { value: 1 },
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
      uniforms.u_amp.value  = f.amp;
      uniforms.u_ampL.value = f.ampL;
      uniforms.u_ampR.value = f.ampR;
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

    const basePath = `../../public/sound/${fileObj.base}`;
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

  function updateDesc() {
    const id  = parseInt(surfSel.value, 10);
    const def = SURFACES.find(s => s.id === id);
    descEl.textContent = def ? def.desc : '';
  }

  surfSel.addEventListener('change', () => {
    uniforms.u_surface.value = parseInt(surfSel.value, 10);
    updateDesc();
  });

  soundSel.addEventListener('change', () => {
    loadSound(SOUND_FILES.find(f => f.value === soundSel.value) || SOUND_FILES[0]);
  });

  const aaBtn = document.getElementById('aa-btn');
  aaBtn.addEventListener('click', () => {
    const on = aaBtn.classList.toggle('active');
    uniforms.u_ssaa.value = on ? 1 : 0;
    aaBtn.setAttribute('aria-label', on ? 'Antialiasing on' : 'Antialiasing off');
    aaBtn.textContent = on ? 'Antialias ON' : 'Antialias OFF';
  });

  playBtn.innerHTML = playIcon();
  playBtn.addEventListener('click', () => { if (frames.length) setPlaying(!isPlaying); });

  updateDesc();
  loadSound(SOUND_FILES[0]);
}

init();
