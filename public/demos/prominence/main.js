const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="12" height="12"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const STEMS = [
  { label: 'Arp',    bin: '250621_a1_mix1_arp.bin',   mp3: '250621_a1_mix1_arp.mp3'   },
  { label: 'Bass',   bin: '250621_a1_mix1_bass.bin',  mp3: '250621_a1_mix1_bass.mp3'  },
  { label: 'Hat',    bin: '250621_a1_mix1_hat.bin',   mp3: '250621_a1_mix1_hat.mp3'   },
  { label: 'Kick 1', bin: '250621_a1_mix1_kick1.bin', mp3: '250621_a1_mix1_kick1.mp3' },
  { label: 'Kick 2', bin: '250621_a1_mix1_kick2.bin', mp3: '250621_a1_mix1_kick2.mp3' },
  { label: 'Pad',    bin: '250621_a1_mix1_pad.bin',   mp3: '250621_a1_mix1_pad.mp3'   },
  { label: 'Snare',  bin: '250621_a1_mix1_snare.bin', mp3: '250621_a1_mix1_snare.mp3' },
];
const SOUND_BASE     = '../../sound/full/';
const FPS            = 60;
const START_TIME     = 0;
const ALPHA          = 0.92;
const BETA           = 5.0;
const HISTORY_FRAMES = 900;

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    out[i] = { ampL: f32[o], ampR: f32[o + 1] };
  }
  return out;
}

function computeOnset(frames) {
  const n = frames.length;
  const h2 = new Float32Array(n);
  let prevAmp = 0, prevOnset = 0;
  for (let i = 0; i < n; i++) {
    const amp   = (frames[i].ampL + frames[i].ampR) * 0.5;
    const delta = Math.max(0, amp - prevAmp);
    const onset = Math.max(delta, prevOnset * ALPHA);
    h2[i]     = onset;
    prevAmp   = amp;
    prevOnset = onset;
  }
  return h2;
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
    const frame = frames[Math.min(fi, frames.length - 1)];
    return yBtm - (frame ? frame[key] : 0) * ampH;
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

function drawBar(ctx, x, y, w, h, value, r, g, b) {
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  ctx.fillRect(x, y, w, h);
  const fw = Math.max(0, Math.min(1, value)) * w;
  if (fw > 0) {
    ctx.fillStyle = `rgba(${r},${g},${b},0.82)`;
    ctx.fillRect(x, y, fw, h);
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const canvas  = document.getElementById('canvas');
  const ctx     = canvas.getContext('2d');
  const playBtn = document.getElementById('play-btn');
  const seekEl  = document.getElementById('seek');
  const timeCur = document.getElementById('time-current');
  const timeTot = document.getElementById('time-total');
  const loadEl  = document.getElementById('loading');

  // ── Loading UI ────────────────────────────────────────────────────────────
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

  // ── Audio — one element per stem, muted individually ─────────────────────
  const stemAudios = STEMS.map(s => {
    const a = new Audio(SOUND_BASE + s.mp3);
    a.preload = 'auto';
    return a;
  });
  const clock = stemAudios[0]; // reference for timing/seeking/events

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
    timeTot.textContent = formatTime(clock.duration);
    seekEl.max          = '10000';
    seekEl.value        = Math.round((START_TIME / clock.duration) * 10000);
    timeCur.textContent = formatTime(START_TIME);
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

  // ── Toggle state ──────────────────────────────────────────────────────────
  const enabled = new Array(STEMS.length).fill(true);

  function applyMutes() {
    stemAudios.forEach((a, i) => { a.muted = !enabled[i]; });
  }
  applyMutes();

  canvas.style.cursor = 'pointer';
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const scX  = canvas.width  / rect.width;
    const scY  = canvas.height / rect.height;
    const cx   = (e.clientX - rect.left) * scX;
    const cy   = (e.clientY - rect.top)  * scY;

    const W          = canvas.width, H = canvas.height;
    const BOTTOM_PAD = Math.round(H * 0.042);
    const HEADER_H   = Math.round(H * 0.050);
    const H_STRIP    = (H - BOTTOM_PAD - HEADER_H) / STEMS.length;
    const NAME_W     = Math.round(W * 0.09);

    if (cx > NAME_W || cy < HEADER_H) return;
    const row = Math.floor((cy - HEADER_H) / H_STRIP);
    if (row >= 0 && row < STEMS.length) {
      enabled[row] = !enabled[row];
      applyMutes();
    }
  });

  // ── Draw loop ─────────────────────────────────────────────────────────────
  function draw() {
    requestAnimationFrame(draw);

    const W = canvas.width, H = canvas.height;
    const N = STEMS.length;

    const BOTTOM_PAD = Math.round(H * 0.042);
    const HEADER_H   = Math.round(H * 0.050);
    const H_STRIP    = (H - BOTTOM_PAD - HEADER_H) / N;
    const VPAD       = Math.max(3, H_STRIP * 0.055);
    const COL_GAP    = Math.max(2, W * 0.003);
    const RIGHT_PAD  = Math.round(W * 0.052);

    const NAME_W = Math.round(W * 0.09);
    const HIST_W = Math.round(W * 0.43);
    const BAR_W  = Math.floor((W - NAME_W - HIST_W - COL_GAP * 4 - RIGHT_PAD) / 3);

    const histX  = NAME_W + COL_GAP;
    const bar1X  = histX + HIST_W + COL_GAP;
    const bar2X  = bar1X + BAR_W + COL_GAP;
    const bar3X  = bar2X + BAR_W + COL_GAP;

    // Uniform font size for track names, column headers, and values
    const fontSize = Math.max(10, H_STRIP * 0.20);

    // Bar: thin band with inner left/right margins
    const BAR_H   = Math.round(Math.max(6, H_STRIP * 0.18));
    const VAL_W   = Math.round(Math.max(40, W * 0.038));
    const BAR_PAD = Math.round(Math.max(8, W * 0.012));   // inner horizontal margin
    const BAR_GR_W = BAR_W - VAL_W - BAR_PAD;             // graphic fill starts after BAR_PAD

    // Toggle [ON]/[OFF] — smaller font, exception to uniform rule
    const togFS = Math.round(Math.max(7, fontSize * 0.50));
    const TOG_W = Math.round(Math.max(20, togFS * 2.4));
    const TOG_H = Math.round(Math.max(12, togFS * 1.3));
    const TOG_R = Math.round(TOG_H * 0.20);
    const NAME_X = 8 + TOG_W + Math.round(W * 0.006);

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const fi = Math.floor(clock.currentTime * FPS);

    const lvl = rawData.map(frames => {
      const f = frames[Math.min(fi, frames.length - 1)];
      return (f.ampL + f.ampR) * 0.5;
    });
    const ons = onsetData.map(h2 => h2[Math.min(fi, h2.length - 1)]);

    const prominence = new Array(N).fill(0);
    const activeIdx  = STEMS.map((_, i) => i).filter(i => enabled[i]);
    if (activeIdx.length > 0) {
      const exps = activeIdx.map(i => Math.exp(BETA * (lvl[i] + ons[i])));
      const sum  = exps.reduce((a, b) => a + b, 0) || 1;
      activeIdx.forEach((i, k) => { prominence[i] = exps[k] / sum; });
    }

    // ── Column headers ──────────────────────────────────────────────────────
    const hdrMid = HEADER_H * 0.58;
    ctx.font         = `300 ${fontSize}px 'Sora', sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'left';
    ctx.fillStyle    = 'rgba(255,255,255,0.22)';
    ctx.fillText('Level', bar1X + BAR_PAD, hdrMid);
    ctx.fillStyle    = 'rgba(255,180,90,0.42)';
    ctx.fillText('Onset', bar2X + BAR_PAD, hdrMid);
    ctx.fillStyle    = 'rgba(110,190,255,0.38)';
    ctx.fillText('Prominence', bar3X + BAR_PAD, hdrMid);

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, HEADER_H - 1, W, 1);

    // ── Track rows ──────────────────────────────────────────────────────────
    for (let t = 0; t < N; t++) {
      const frames   = rawData[t];
      const frameIdx = Math.max(0, Math.min(fi, frames.length - 1));
      const sy       = HEADER_H + t * H_STRIP;
      const yTop     = sy + VPAD;
      const yBtm     = sy + H_STRIP - VPAD;
      const midY     = sy + H_STRIP * 0.5;
      const barY     = midY - BAR_H / 2;
      const on       = enabled[t];

      // History waveform
      if (on) {
        drawAmpChannel(ctx, frames, frameIdx, histX, histX + HIST_W, yTop, yBtm, 110, 190, 255, 0.10, 0.70, 'ampR');
        drawAmpChannel(ctx, frames, frameIdx, histX, histX + HIST_W, yTop, yBtm, 255, 255, 255, 0.14, 0.88, 'ampL');
      } else {
        drawAmpChannel(ctx, frames, frameIdx, histX, histX + HIST_W, yTop, yBtm, 110, 190, 255, 0.03, 0.12, 'ampR');
        drawAmpChannel(ctx, frames, frameIdx, histX, histX + HIST_W, yTop, yBtm, 255, 255, 255, 0.03, 0.18, 'ampL');
      }

      // Bar graphics — start after BAR_PAD, leave VAL_W + BAR_PAD on the right
      if (on) {
        drawBar(ctx, bar1X + BAR_PAD, barY, BAR_GR_W, BAR_H, lvl[t],     255, 255, 255);
        drawBar(ctx, bar2X + BAR_PAD, barY, BAR_GR_W, BAR_H, ons[t],      255, 180,  90);
        drawBar(ctx, bar3X + BAR_PAD, barY, BAR_GR_W, BAR_H, prominence[t], 110, 190, 255);
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        ctx.fillRect(bar1X + BAR_PAD, barY, BAR_GR_W, BAR_H);
        ctx.fillStyle = 'rgba(255,180,90,0.04)';
        ctx.fillRect(bar2X + BAR_PAD, barY, BAR_GR_W, BAR_H);
        ctx.fillStyle = 'rgba(110,190,255,0.04)';
        ctx.fillRect(bar3X + BAR_PAD, barY, BAR_GR_W, BAR_H);
      }

      // Value text — right-aligned with BAR_PAD from column edge
      ctx.font         = `300 ${fontSize}px 'Google Sans Code', monospace`;
      ctx.textAlign    = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillStyle    = on ? 'rgba(255,255,255,0.45)'  : 'rgba(255,255,255,0.15)';
      ctx.fillText(lvl[t].toFixed(2),     bar1X + BAR_W - BAR_PAD, midY);
      ctx.fillStyle    = on ? 'rgba(255,180,90,0.65)'   : 'rgba(255,180,90,0.15)';
      ctx.fillText(ons[t].toFixed(2),     bar2X + BAR_W - BAR_PAD, midY);
      ctx.fillStyle    = on ? 'rgba(110,190,255,0.55)'  : 'rgba(110,190,255,0.15)';
      ctx.fillText(prominence[t].toFixed(2), bar3X + BAR_W - BAR_PAD, midY);

      // Toggle box [ON] / [OFF] — smaller font, exception to uniform rule
      const togX = 8, togY = midY - TOG_H / 2;
      ctx.beginPath();
      ctx.roundRect(togX, togY, TOG_W, TOG_H, TOG_R);
      if (on) {
        ctx.fillStyle   = 'rgba(255,255,255,0.07)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.fillStyle   = 'rgba(255,255,255,0.82)';
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth   = 1;
        ctx.stroke();
        ctx.fillStyle   = 'rgba(255,255,255,0.28)';
      }
      ctx.font         = `300 ${togFS}px 'Sora', sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(on ? 'ON' : 'OFF', togX + TOG_W / 2, midY);

      // Track name
      ctx.font         = `300 ${fontSize}px 'Sora', sans-serif`;
      ctx.fillStyle    = on ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.20)';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(STEMS[t].label, NAME_X, midY);
      ctx.textBaseline = 'alphabetic';

      // Column dividers
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.fillRect(histX - COL_GAP * 0.5, sy, 1, H_STRIP);
      ctx.fillRect(bar1X - COL_GAP * 0.5, sy, 1, H_STRIP);
      ctx.fillRect(bar2X - COL_GAP * 0.5, sy, 1, H_STRIP);
      ctx.fillRect(bar3X - COL_GAP * 0.5, sy, 1, H_STRIP);

      if (t < N - 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        ctx.fillRect(0, sy + H_STRIP - 1, W, 1);
      }
    }
  }

  draw();
}

init().catch(console.error);
