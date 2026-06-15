const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const TRACKS = [
  { label: 'Master', mp3: '250621_a1_mix1_master_88.2k24.mp3', bin: '250621_a1_mix1_master_88.2k24.bin' },
  { label: 'Arp',    bin: '250621_a1_mix1_arp.bin' },
  { label: 'Bass',   bin: '250621_a1_mix1_bass.bin' },
  { label: 'Hat',    bin: '250621_a1_mix1_hat.bin' },
  { label: 'Kick 1', bin: '250621_a1_mix1_kick1.bin' },
  { label: 'Kick 2', bin: '250621_a1_mix1_kick2.bin' },
  { label: 'Pad',    bin: '250621_a1_mix1_pad.bin' },
  { label: 'Snare',  bin: '250621_a1_mix1_snare.bin' },
];

const FPS            = 60;
const FFT_BINS       = 128;
const HISTORY_FRAMES = 900;
const SOUND_BASE     = '../../sound/full/';

const BLANK_FRAME = { ampL: 0, ampR: 0, fftL: new Array(FFT_BINS).fill(0), fftR: new Array(FFT_BINS).fill(0) };

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

// ── Draw helpers ──────────────────────────────────────────────────────────────

function drawAmpChannel(ctx, frames, frameIdx, x0, x1, yTop, yBtm, r, g, b, fillAlpha, strokeAlpha, key) {
  const ampH      = yBtm - yTop;
  const totalW    = x1 - x0;
  const slotW     = totalW / HISTORY_FRAMES;
  const histStart = Math.max(0, frameIdx - HISTORY_FRAMES + 1);
  const count     = frameIdx - histStart + 1;
  if (count < 1) return;

  function getY(i) {
    const fi    = histStart + i;
    const frame = frames[Math.min(fi, frames.length - 1)] || BLANK_FRAME;
    return yBtm - frame[key] * ampH;
  }

  ctx.beginPath();
  ctx.moveTo(x0, yBtm);
  for (let i = 0; i < count; i++) ctx.lineTo(x0 + i * slotW, getY(i));
  ctx.lineTo(x0 + (count - 1) * slotW, yBtm);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, yTop, 0, yBtm);
  grad.addColorStop(0, `rgba(${r},${g},${b},${fillAlpha})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0.01)`);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const x = x0 + i * slotW, y = getY(i);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.strokeStyle = `rgba(${r},${g},${b},${strokeAlpha})`;
  ctx.lineWidth   = 1;
  ctx.stroke();
}

function melDB(v) { return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 80) / 80)); }
function drawFFT(ctx, fftData, x0, panelW, yTop, yBtm, r, g, b) {
  const fftH = yBtm - yTop;
  const barW = panelW / FFT_BINS;
  for (let i = 0; i < FFT_BINS; i++) {
    const val = melDB(fftData[i] || 0);
    const bh  = val * fftH;
    ctx.fillStyle = `rgba(${r},${g},${b},1)`;
    ctx.fillRect(x0 + i * barW, yBtm - bh, Math.max(1, barW - 1), bh);
  }
}

// ── Loading UI ────────────────────────────────────────────────────────────────

function buildLoadingRows() {
  const container = document.getElementById('loading-tracks');
  return TRACKS.map(t => {
    const row = document.createElement('div');
    row.className = 'load-row';
    row.innerHTML =
      `<span class="load-name">${t.label}</span>` +
      `<div class="load-bar-bg"><div class="load-bar-fill indeterminate"></div></div>` +
      `<span class="load-pct"></span>`;
    container.appendChild(row);
    return {
      fill: row.querySelector('.load-bar-fill'),
      pct:  row.querySelector('.load-pct'),
    };
  });
}

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const frames = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    frames[i] = { amp: (f32[o] + f32[o + 1]) * 0.5, ampL: f32[o], ampR: f32[o + 1], fftL: f32.subarray(o + 2, o + 130), fftR: f32.subarray(o + 130, o + 258) };
  }
  return frames;
}

async function loadTrack(url, bar) {
  const buf    = await fetch(url).then(r => r.arrayBuffer());
  const result = parseBinary(buf);
  bar.fill.classList.remove('indeterminate');
  bar.fill.style.width = '100%';
  bar.pct.textContent  = '100%';
  return result;
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const canvas    = document.getElementById('canvas');
  const ctx       = canvas.getContext('2d');
  const playBtn   = document.getElementById('play-btn');
  const seekEl    = document.getElementById('seek');
  const timeCur   = document.getElementById('time-current');
  const timeTot   = document.getElementById('time-total');
  const loadingEl = document.getElementById('loading');

  const bars    = buildLoadingRows();
  const allData = await Promise.all(TRACKS.map((t, i) => loadTrack(SOUND_BASE + t.bin, bars[i])));

  loadingEl.classList.add('fade-out');
  loadingEl.addEventListener('transitionend', () => loadingEl.remove(), { once: true });

  const audio = new Audio(SOUND_BASE + TRACKS[0].mp3);
  audio.preload = 'auto';

  function updateBtn() {
    playBtn.innerHTML = audio.paused ? PLAY_ICON : PAUSE_ICON;
    playBtn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  }
  updateBtn();
  playBtn.addEventListener('click', () => { audio.paused ? audio.play() : audio.pause(); });
  audio.addEventListener('play',   updateBtn);
  audio.addEventListener('pause',  updateBtn);
  audio.addEventListener('ended',  updateBtn);

  let seeking = false;
  audio.addEventListener('loadedmetadata', () => { timeTot.textContent = formatTime(audio.duration); });
  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = audio.currentTime, d = audio.duration || 1;
    seekEl.value        = Math.round((t / d) * 1000);
    timeCur.textContent = formatTime(t);
  });
  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive: true });
  seekEl.addEventListener('input',  () => { timeCur.textContent = formatTime((seekEl.value / 1000) * (audio.duration || 0)); });
  seekEl.addEventListener('change', () => { audio.currentTime = (seekEl.value / 1000) * (audio.duration || 0); seeking = false; });

  // ── Draw loop ─────────────────────────────────────────────────────────────

  function draw() {
    requestAnimationFrame(draw);

    const W = canvas.width, H = canvas.height;
    const N = TRACKS.length;
    const BOTTOM_PAD = Math.round(H * 0.042);
    const H_STRIP    = (H - BOTTOM_PAD) / N;
    const VPAD       = Math.max(3, H_STRIP * 0.055);
    const COL_GAP    = Math.max(2, W * 0.003);

    const NAME_W = Math.round(W * 0.09);
    const AMP_W  = Math.round(W * 0.46);
    const FFT_W  = (W - NAME_W - AMP_W - COL_GAP * 3) / 2;

    const ampX  = NAME_W + COL_GAP;
    const fftLX = ampX + AMP_W + COL_GAP;
    const fftRX = fftLX + FFT_W + COL_GAP;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const fi = Math.floor(audio.currentTime * FPS);

    for (let t = 0; t < N; t++) {
      const frames   = allData[t];
      const frameIdx = Math.max(0, Math.min(fi, frames.length - 1));
      const frame    = frames[frameIdx] || BLANK_FRAME;
      const sy       = t * H_STRIP;
      const yTop     = sy + VPAD;
      const yBtm     = sy + H_STRIP - VPAD;

      drawAmpChannel(ctx, frames, frameIdx, ampX, ampX + AMP_W, yTop, yBtm, 110, 190, 255, 0.10, 0.70, 'ampR');
      drawAmpChannel(ctx, frames, frameIdx, ampX, ampX + AMP_W, yTop, yBtm, 255, 255, 255, 0.14, 0.88, 'ampL');

      drawFFT(ctx, frame.fftL, fftLX, FFT_W, yTop, yBtm, 255, 255, 255);
      drawFFT(ctx, frame.fftR, fftRX, FFT_W, yTop, yBtm, 110, 190, 255);

      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(fftLX, yBtm, FFT_W * 2 + COL_GAP, 1);

      const fontSize = Math.max(10, H_STRIP * 0.20);
      ctx.font         = `300 ${fontSize}px 'Sora', sans-serif`;
      ctx.fillStyle    = 'rgba(255,255,255,0.35)';
      ctx.textBaseline = 'middle';
      ctx.fillText(TRACKS[t].label, 8, sy + H_STRIP / 2);
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(ampX  - COL_GAP, sy, 1, H_STRIP);
      ctx.fillRect(fftLX - COL_GAP, sy, 1, H_STRIP);
      ctx.fillRect(fftRX - COL_GAP, sy, 1, H_STRIP);

      if (t < N - 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, sy + H_STRIP - 1, W, 1);
      }
    }
  }

  draw();
}

init();
