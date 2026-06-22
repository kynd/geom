const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const STEMS = [
  { label: 'Arp',    bin: '250621_a1_mix1_arp.bin',   mp3: '250621_a1_mix1_arp.mp3'   },
  { label: 'Bass',   bin: '250621_a1_mix1_bass.bin',  mp3: '250621_a1_mix1_bass.mp3'  },
  { label: 'Hat',    bin: '250621_a1_mix1_hat.bin',   mp3: '250621_a1_mix1_hat.mp3'   },
  { label: 'Kick 1', bin: '250621_a1_mix1_kick1.bin', mp3: '250621_a1_mix1_kick1.mp3' },
  { label: 'Kick 2', bin: '250621_a1_mix1_kick2.bin', mp3: '250621_a1_mix1_kick2.mp3' },
  { label: 'Pad',    bin: '250621_a1_mix1_pad.bin',   mp3: '250621_a1_mix1_pad.mp3'   },
  { label: 'Snare',  bin: '250621_a1_mix1_snare.bin', mp3: '250621_a1_mix1_snare.mp3' },
];

const SOUND_BASE = '../../sound/full/';
const FPS        = 60;
const START_TIME = 0;
const ALPHA      = 0.92;
const BETA       = 5.0;
const N          = STEMS.length;

// Vertex angles: start at top (−π/2), clockwise
const ANGLES = Array.from({ length: N }, (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / N);

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function parseBinary(buffer) {
  const f32    = new Float32Array(buffer);
  const stride = 258;
  const n      = (f32.length / stride) | 0;
  const out    = new Array(n);
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
    out[i]     = onset;
    prevAmp    = amp;
    prevOnset  = onset;
  }
  return out;
}

async function init() {
  const canvas  = document.getElementById('canvas');
  const ctx     = canvas.getContext('2d');
  const playBtn = document.getElementById('play-btn');
  const seekEl  = document.getElementById('seek');
  const timeCur = document.getElementById('time-current');
  const timeTot = document.getElementById('time-total');
  const loadEl  = document.getElementById('loading');

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
      fetch(SOUND_BASE + s.bin)
        .then(r => r.arrayBuffer())
        .then(buf => {
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

  // Audio — all stems play simultaneously
  const stemAudios = STEMS.map(s => {
    const a = new Audio(SOUND_BASE + s.mp3);
    a.preload = 'auto';
    return a;
  });
  const clock = stemAudios[0];

  function stemPlay()  { stemAudios.forEach(a => a.play().catch(() => {})); }
  function stemPause() { stemAudios.forEach(a => a.pause()); }
  function stemSeek(t) { stemAudios.forEach(a => { a.currentTime = t; }); }

  function syncDrift() {
    const t = clock.currentTime;
    stemAudios.forEach(a => {
      if (Math.abs(a.currentTime - t) > 0.25) a.currentTime = t;
    });
  }

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
    stemSeek(START_TIME);
    timeTot.textContent  = formatTime(clock.duration);
    seekEl.max           = '10000';
    seekEl.value         = '0';
    timeCur.textContent  = formatTime(START_TIME);
  });

  let seeking = false;
  clock.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = clock.currentTime, d = clock.duration || 1;
    seekEl.value        = Math.round((t / d) * 10000);
    timeCur.textContent = formatTime(t);
    syncDrift();
  });
  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
  seekEl.addEventListener('input',  () => { timeCur.textContent = formatTime((seekEl.value / 10000) * (clock.duration || 0)); });
  seekEl.addEventListener('change', () => { stemSeek((seekEl.value / 10000) * (clock.duration || 0)); seeking = false; });

  function draw() {
    requestAnimationFrame(draw);

    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W * 0.5;
    const cy = H * 0.5;
    const R  = Math.min(W, H) * 0.38;   // outer reference radius
    const LR = R * 1.18;                 // label radius (fixed)

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const fi  = Math.floor(clock.currentTime * FPS);
    const clamp = arr => Math.min(fi, arr.length - 1);

    const lvl = rawData.map(f  => { const fr = f[clamp(f)];    return (fr.ampL + fr.ampR) * 0.5; });
    const ons = onsetData.map(h => h[clamp(h)]);

    // Combined softmax prominence
    const prom = new Array(N).fill(0);
    const exps = Array.from({ length: N }, (_, i) => Math.exp(BETA * (lvl[i] + ons[i])));
    const sum  = exps.reduce((a, b) => a + b, 0) || 1;
    exps.forEach((e, i) => { prom[i] = e / sum; });

    // ── Reference grid ──────────────────────────────────────────────────────

    // Radial spokes
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth   = 1;
    for (let i = 0; i < N; i++) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(ANGLES[i]) * R, cy + Math.sin(ANGLES[i]) * R);
      ctx.stroke();
    }

    // Outer reference heptagon
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = cx + Math.cos(ANGLES[i]) * R;
      const y = cy + Math.sin(ANGLES[i]) * R;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Inner ring at 1/3 R
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = cx + Math.cos(ANGLES[i]) * R / 3;
      const y = cy + Math.sin(ANGLES[i]) * R / 3;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.stroke();

    // ── Prominence polygon ───────────────────────────────────────────────────

    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const r = prom[i] * R;
      const x = cx + Math.cos(ANGLES[i]) * r;
      const y = cy + Math.sin(ANGLES[i]) * r;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle   = 'rgba(255,255,255,0.06)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.80)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Vertex dots
    const DOT_R = Math.max(2.5, R * 0.010);
    for (let i = 0; i < N; i++) {
      const r = prom[i] * R;
      const x = cx + Math.cos(ANGLES[i]) * r;
      const y = cy + Math.sin(ANGLES[i]) * r;
      ctx.beginPath();
      ctx.arc(x, y, DOT_R, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.90)';
      ctx.fill();
    }

    // ── Labels at fixed positions ────────────────────────────────────────────

    const fontSize = Math.round(Math.max(11, H * 0.018));
    ctx.font         = `300 ${fontSize}px 'Sora', sans-serif`;

    for (let i = 0; i < N; i++) {
      const cos = Math.cos(ANGLES[i]);
      const sin = Math.sin(ANGLES[i]);
      const lx  = cx + cos * LR;
      const ly  = cy + sin * LR;

      ctx.textAlign    = cos > 0.3 ? 'left' : cos < -0.3 ? 'right' : 'center';
      ctx.textBaseline = sin > 0.3 ? 'top'  : sin < -0.3 ? 'bottom' : 'middle';
      ctx.fillStyle    = 'rgba(255,255,255,0.50)';
      ctx.fillText(STEMS[i].label, lx, ly);
    }
  }

  draw();
}

init().catch(console.error);
