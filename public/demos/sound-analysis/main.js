const SOUND_FILES = [
  { value: 'arp',    label: 'arp',     base: '250621_a1_mix1_arp' },
  { value: 'bass',   label: 'bass',    base: '250621_a1_mix1_bass' },
  { value: 'hat',    label: 'hat',     base: '250621_a1_mix1_hat' },
  { value: 'kick1',  label: 'kick 1',  base: '250621_a1_mix1_kick1' },
  { value: 'kick2',  label: 'kick 2',  base: '250621_a1_mix1_kick2' },
  { value: 'pad',    label: 'pad',     base: '250621_a1_mix1_pad' },
  { value: 'snare',  label: 'snare',   base: '250621_a1_mix1_snare' },
  { value: 'master', label: 'master',  base: '250621_a1_mix1_master_88.2k24' },
];

const FPS            = 60;
const HISTORY_FRAMES = 900; // 15 seconds of amplitude history

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

let frames           = [];
let startFrame       = 0;
let currentFrame     = 0;
let isPlaying        = false;
let audio            = null;
let historyBufferL   = [];
let historyBufferR   = [];
let rafId            = null;
let currentFileName  = '';
let freqMin          = 0;
let freqMax          = 0;

// ── data helpers ─────────────────────────────────────────────────────────────

function formatHz(hz) {
  return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
}

function parseData(text) {
  const lines = text.split('\n');
  for (const l of lines) {
    const m = l.match(/^#\s*freq_min=([\d.]+)\s+freq_max=([\d.]+)/);
    if (m) { freqMin = parseFloat(m[1]); freqMax = parseFloat(m[2]); }
  }
  return lines
    .filter(l => l.trim() && !l.startsWith('#'))
    .map(l => {
      const v = l.trim().split(/\s+/).map(Number);
      const ampL = v[0], ampR = v[1];
      const fftL = v.slice(2, 130), fftR = v.slice(130, 258);
      return { ampL, ampR, fftL, fftR, amp: (ampL + ampR) * 0.5, fft: fftL };
    });
}

function findStartFrame(data, threshold = 0.0001) {
  for (let i = 0; i < data.length; i++) {
    if (data[i].amp > threshold) return i;
  }
  return 0;
}

function formatTime(frameIndex) {
  const total = frameIndex / FPS;
  const m  = Math.floor(total / 60);
  const s  = Math.floor(total % 60);
  const cs = Math.floor((total * 100) % 100);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(cs).padStart(2, '0')}`;
}

// ── drawing ───────────────────────────────────────────────────────────────────

function draw() {
  const W = canvas.width;
  const H = canvas.height;

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (!frames.length) return;
  const frame = frames[Math.min(currentFrame, frames.length - 1)];

  const PAD_X   = W * 0.04;
  const VIZ_W   = W - PAD_X * 2;
  const FFT_GAP = W * 0.015;   // gap between L and R FFT panels
  const FFT_PW  = (VIZ_W - FFT_GAP) / 2;  // width of each FFT panel

  const AMP_TOP = H * 0.18;
  const AMP_BTM = H * 0.50;
  const AMP_H   = AMP_BTM - AMP_TOP;

  const FFT_TOP = H * 0.58;
  const FFT_BTM = H * 0.92;
  const FFT_H   = FFT_BTM - FFT_TOP;

  const NUM_BINS = frame.fftL.length;
  const FONT_SM  = Math.max(11, H * 0.013);
  const FONT_MD  = Math.max(12, H * 0.015);

  const freqLabel = freqMin && freqMax
    ? `${formatHz(freqMin)} – ${formatHz(freqMax)}`
    : 'frequency →';

  // ── section labels ──
  ctx.font      = `${FONT_SM}px 'Google Sans Code', monospace`;

  // amplitude label with L / R color indicators
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('amplitude  ', PAD_X, AMP_TOP - H * 0.016);
  const ampPfxW = ctx.measureText('amplitude  ').width;
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('L', PAD_X + ampPfxW, AMP_TOP - H * 0.016);
  const lW = ctx.measureText('L').width;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillText(' / ', PAD_X + ampPfxW + lW, AMP_TOP - H * 0.016);
  const divW = ctx.measureText(' / ').width;
  ctx.fillStyle = 'rgba(110,190,255,0.85)';
  ctx.fillText('R', PAD_X + ampPfxW + lW + divW, AMP_TOP - H * 0.016);

  // FFT panel labels
  const fftLabelY = FFT_TOP - H * 0.016;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('FFT  ', PAD_X, fftLabelY);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('L', PAD_X + ctx.measureText('FFT  ').width, fftLabelY);

  const rPanelX = PAD_X + FFT_PW + FFT_GAP;
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText('FFT  ', rPanelX, fftLabelY);
  ctx.fillStyle = 'rgba(110,190,255,0.85)';
  ctx.fillText('R', rPanelX + ctx.measureText('FFT  ').width, fftLabelY);

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fillText(freqLabel, PAD_X + VIZ_W, fftLabelY);

  // ── amplitude grid lines ──
  ctx.setLineDash([4, 10]);
  ctx.lineWidth = 1;
  [0.25, 0.5, 0.75].forEach(level => {
    const y = AMP_BTM - level * AMP_H;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.beginPath(); ctx.moveTo(PAD_X, y); ctx.lineTo(PAD_X + VIZ_W, y); ctx.stroke();
  });
  ctx.setLineDash([]);

  // ── amplitude history lines ──
  function drawAmpLine(buf, fillTop, fillBot, stroke) {
    const n = buf.length;
    if (n < 2) return;
    const slotW = VIZ_W / HISTORY_FRAMES;
    ctx.beginPath();
    ctx.moveTo(PAD_X, AMP_BTM);
    for (let i = 0; i < n; i++) ctx.lineTo(PAD_X + i * slotW, AMP_BTM - buf[i] * AMP_H);
    ctx.lineTo(PAD_X + (n - 1) * slotW, AMP_BTM);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, AMP_TOP, 0, AMP_BTM);
    grad.addColorStop(0, fillTop); grad.addColorStop(1, fillBot);
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = PAD_X + i * slotW, y = AMP_BTM - buf[i] * AMP_H;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = Math.max(1, W * 0.0007);
    ctx.stroke();
  }

  drawAmpLine(historyBufferL, 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.01)', 'rgba(255,255,255,0.88)');
  drawAmpLine(historyBufferR, 'rgba(110,190,255,0.10)', 'rgba(110,190,255,0.00)', 'rgba(110,190,255,0.80)');

  // baseline
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(PAD_X, AMP_BTM, VIZ_W, 1);

  // ── FFT bar charts (L left, R right) ──
  function drawFFT(fftData, panelX, r, g, b) {
    const slotW = FFT_PW / NUM_BINS;
    const barW  = slotW * 0.72;
    for (let i = 0; i < NUM_BINS; i++) {
      const val = fftData[i];
      const bh  = val * FFT_H;
      ctx.fillStyle = `rgba(${r},${g},${b},${(0.2 + 0.8 * val).toFixed(3)})`;
      ctx.fillRect(panelX + i * slotW, FFT_BTM - bh, barW, bh);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(panelX, FFT_BTM, FFT_PW, 1);
  }

  drawFFT(frame.fftL, PAD_X,       255, 255, 255);
  drawFFT(frame.fftR, rPanelX,     110, 190, 255);

  // ── bottom info ──
  ctx.font = `${FONT_MD}px 'Google Sans Code', monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.textAlign = 'left';
  ctx.fillText(currentFileName, PAD_X, H * 0.965);
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.textAlign = 'right';
  ctx.fillText(formatTime(currentFrame), PAD_X + VIZ_W, H * 0.965);
}

// ── animation loop ────────────────────────────────────────────────────────────

function animate() {
  if (!isPlaying || !audio) { rafId = null; return; }

  currentFrame = Math.min(Math.floor(audio.currentTime * FPS), frames.length - 1);

  if (frames[currentFrame]) {
    historyBufferL.push(frames[currentFrame].ampL);
    historyBufferR.push(frames[currentFrame].ampR);
    if (historyBufferL.length > HISTORY_FRAMES) historyBufferL.shift();
    if (historyBufferR.length > HISTORY_FRAMES) historyBufferR.shift();
  }

  draw();
  rafId = requestAnimationFrame(animate);
}

// ── playback ──────────────────────────────────────────────────────────────────

function playIcon()  { return `<svg width="14" height="16" viewBox="0 0 14 16" fill="currentColor"><polygon points="0,0 14,8 0,16"/></svg>`; }
function pauseIcon() { return `<svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><rect x="0" y="0" width="4" height="16"/><rect x="8" y="0" width="4" height="16"/></svg>`; }

function setPlaying(play) {
  if (!audio) return;
  isPlaying = play;
  document.getElementById('play-btn').innerHTML = play ? pauseIcon() : playIcon();

  if (play) {
    audio.play().catch(() => {});
    rafId = requestAnimationFrame(animate);
  } else {
    audio.pause();
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  }
}

async function loadSound(fileObj) {
  setPlaying(false);
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  frames          = [];
  historyBufferL  = [];
  historyBufferR  = [];
  currentFrame    = 0;
  currentFileName = fileObj.base + '.mp3';
  freqMin         = 0;
  freqMax         = 0;

  // loading indicator
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font      = `${Math.max(12, H * 0.018)}px 'Google Sans Code', monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('loading…', W / 2, H / 2);

  const basePath = `../../sound/${fileObj.base}`;

  const res  = await fetch(`${basePath}.txt`);
  const text = await res.text();
  frames       = parseData(text);
  startFrame   = findStartFrame(frames);
  currentFrame = startFrame;
  draw();

  audio = new Audio(`${basePath}.mp3`);
  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = startFrame / FPS;
  });
  audio.addEventListener('ended', () => {
    setPlaying(false);
    currentFrame = startFrame;
    audio.currentTime = startFrame / FPS;
    draw();
  });

  document.getElementById('play-btn').innerHTML = playIcon();
}

// ── controls ──────────────────────────────────────────────────────────────────

document.getElementById('play-btn').innerHTML = playIcon();
document.getElementById('play-btn').addEventListener('click', () => {
  if (!frames.length) return;
  setPlaying(!isPlaying);
});

const soundSelect = document.getElementById('sound-select');
soundSelect.addEventListener('change', () => {
  const fileObj = SOUND_FILES.find(f => f.value === soundSelect.value) || SOUND_FILES[0];
  loadSound(fileObj);
});

loadSound(SOUND_FILES[0]);
