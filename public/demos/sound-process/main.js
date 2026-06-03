const SOUND_FILES = [
  { value: 'arp',    base: '250621_a1_mix1_arp' },
  { value: 'bass',   base: '250621_a1_mix1_bass' },
  { value: 'hat',    base: '250621_a1_mix1_hat' },
  { value: 'kick1',  base: '250621_a1_mix1_kick1' },
  { value: 'kick2',  base: '250621_a1_mix1_kick2' },
  { value: 'master', base: '250621_a1_mix1_master_88.2k24' },
  { value: 'pad',    base: '250621_a1_mix1_pad' },
  { value: 'snare',  base: '250621_a1_mix1_snare' },
];

const FPS            = 60;
const K              = 100;   // log steepness
const HISTORY_FRAMES = 720;   // 12 seconds of amplitude history

const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');

let frames        = [];
let startFrame    = 0;
let currentFrame  = 0;
let useLog        = false;
let isPlaying     = false;
let audio         = null;
let historyBuffer = [];
let rafId         = null;
let freqMin       = 0;
let freqMax       = 0;

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

function logTransform(x) {
  return Math.log(1 + K * x) / Math.log(1 + K);
}

function xform(x) {
  return useLog ? logTransform(x) : x;
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

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  if (!frames.length) return;
  const frame = frames[Math.min(currentFrame, frames.length - 1)];

  const PAD_X    = W * 0.042;
  const VIZ_W    = W - PAD_X * 2;
  const FFT_TOP  = H * 0.185;
  const FFT_BTM  = H * 0.630;
  const FFT_H    = FFT_BTM - FFT_TOP;
  const HIST_TOP = H * 0.700;
  const HIST_BTM = H * 0.855;
  const HIST_H   = HIST_BTM - HIST_TOP;
  const NUM_BINS = frame.fft.length;
  const FONT_SM  = Math.max(11, H * 0.013);
  const FONT_POS = Math.max(12, H * 0.015);

  // ── FFT bars ──
  const slotW = VIZ_W / NUM_BINS;
  const barW  = slotW * 0.75;

  ctx.font      = `${FONT_SM}px 'Google Sans Code', monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('FFT', PAD_X, FFT_TOP - H * 0.016);
  ctx.textAlign = 'right';
  ctx.fillText(freqMin && freqMax ? `${formatHz(freqMin)} – ${formatHz(freqMax)}` : 'frequency →', PAD_X + VIZ_W, FFT_TOP - H * 0.016);

  for (let i = 0; i < NUM_BINS; i++) {
    const val = xform(frame.fft[i]);
    const bh  = val * FFT_H;
    const x   = PAD_X + i * slotW;
    ctx.fillStyle = `rgba(255,255,255,${(0.25 + 0.75 * val).toFixed(3)})`;
    ctx.fillRect(x, FFT_BTM - bh, barW, bh);
  }

  // baseline
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(PAD_X, FFT_BTM, VIZ_W, 1);

  // ── amplitude history ──
  ctx.font      = `${FONT_SM}px 'Google Sans Code', monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('amplitude', PAD_X, HIST_TOP - H * 0.016);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText('← 12 s', PAD_X + VIZ_W, HIST_TOP - H * 0.016);

  const hSlotW = VIZ_W / HISTORY_FRAMES;
  for (let i = 0; i < historyBuffer.length; i++) {
    const val   = xform(historyBuffer[i]);
    const bh    = val * HIST_H;
    const x     = PAD_X + i * hSlotW;
    const age   = historyBuffer.length - 1 - i; // 0 = newest
    const alpha = (1 - age / HISTORY_FRAMES) * 0.9;
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.fillRect(x, HIST_BTM - bh, Math.max(1, hSlotW - 0.4), bh);
  }

  // baseline
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(PAD_X, HIST_BTM, VIZ_W, 1);

  // ── position ──
  ctx.font      = `${FONT_POS}px 'Google Sans Code', monospace`;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.fillText(formatTime(currentFrame), PAD_X, H * 0.940);
}

// ── playback ──────────────────────────────────────────────────────────────────

function animate() {
  if (!isPlaying || !audio) { rafId = null; return; }

  currentFrame = Math.min(Math.floor(audio.currentTime * FPS), frames.length - 1);

  if (frames[currentFrame]) {
    historyBuffer.push(frames[currentFrame].amp);
    if (historyBuffer.length > HISTORY_FRAMES) historyBuffer.shift();
  }

  draw();
  rafId = requestAnimationFrame(animate);
}

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
  // stop and clean up
  setPlaying(false);
  if (audio) { audio.pause(); audio.src = ''; audio = null; }
  frames        = [];
  historyBuffer = [];
  currentFrame  = 0;
  freqMin       = 0;
  freqMax       = 0;

  // loading placeholder
  const W = canvas.width, H = canvas.height;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font      = `${Math.max(12, H * 0.018)}px 'Google Sans Code', monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('loading…', W / 2, H / 2);

  const base = `../../sound/${fileObj.base}`;

  // fetch data
  const res  = await fetch(`${base}.txt`);
  const text = await res.text();
  frames       = parseData(text);
  startFrame   = findStartFrame(frames);
  currentFrame = startFrame;
  draw();

  // prepare audio
  audio = new Audio(`${base}.mp3`);
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

const logToggle = document.getElementById('log-toggle');
logToggle.addEventListener('click', () => {
  useLog = !useLog;
  logToggle.classList.toggle('active', useLog);
  if (!isPlaying) draw();
});

const soundSelect = document.getElementById('sound-select');
soundSelect.addEventListener('change', () => {
  const fileObj = SOUND_FILES.find(f => f.value === soundSelect.value) || SOUND_FILES[0];
  loadSound(fileObj);
});

// initial load
loadSound(SOUND_FILES[0]);
