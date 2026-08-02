const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';

const STEMS = [
  { id:'arp',   label:'Arp',    bin:'250621_a1_mix1_arp.bin'   },
  { id:'bass',  label:'Bass',   bin:'250621_a1_mix1_bass.bin'  },
  { id:'hat',   label:'Hat',    bin:'250621_a1_mix1_hat.bin'   },
  { id:'kick1', label:'Kick 1', bin:'250621_a1_mix1_kick1.bin' },
  { id:'kick2', label:'Kick 2', bin:'250621_a1_mix1_kick2.bin' },
  { id:'pad',   label:'Pad',    bin:'250621_a1_mix1_pad.bin'   },
  { id:'snare', label:'Snare',  bin:'250621_a1_mix1_snare.bin' },
];
const MASTER_MP3 = '250621_a1_mix1_master_88.2k24.mp3';
const MASTER_BIN = '250621_a1_mix1_master_88.2k24.bin';
const SOUND_BASE = '../../../sound/full/';
const FPS        = 60;
const ALPHA      = 0.92;
const BETA       = 5.0;
const N          = STEMS.length;

// Vertex angles: start at top (−π/2), clockwise — same convention as the
// Track prominence radar chart (public/demos/stem-radar).
const ANGLES = Array.from({ length: N }, (_, i) => -Math.PI / 2 + (2 * Math.PI * i) / N);

function formatTime(s) {
  if (!isFinite(s) || s < 0) return '0:00';
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
}

function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const stride = 258, n = (f32.length / stride) | 0;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * stride;
    out[i] = { ampL:f32[o], ampR:f32[o+1], fftL:f32.subarray(o+2,o+130), fftR:f32.subarray(o+130,o+258) };
  }
  return out;
}

function melDB(v) { return Math.max(0, Math.min(1, (20*Math.log10(Math.max(v,1e-5))+80)/80)); }

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

function polar(cx, cy, angle, r) { return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }; }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return d; }

async function init() {
  const canvas    = document.getElementById('main-canvas');
  const ctx       = canvas.getContext('2d');
  const playBtn   = document.getElementById('play-btn');
  const seekEl    = document.getElementById('seek');
  const timeCur   = document.getElementById('time-current');
  const timeTot   = document.getElementById('time-total');
  const loadEl    = document.getElementById('loading');
  const vizSelect = document.getElementById('viz-select');

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

  const [rawData, masterBuf] = await Promise.all([
    Promise.all(STEMS.map((s, i) =>
      fetch(SOUND_BASE + s.bin)
        .then(r => r.arrayBuffer())
        .then(buf => {
          loadBars[i].fill.classList.remove('indeterminate');
          loadBars[i].fill.style.width = '100%';
          loadBars[i].pct.textContent  = '100%';
          return parseBinary(buf);
        })
    )),
    fetch(SOUND_BASE + MASTER_BIN).then(r => r.arrayBuffer()),
  ]);
  const onsetData   = rawData.map(computeOnset);
  const masterFrames = parseBinary(masterBuf);

  loadEl.classList.add('fade-out');
  loadEl.addEventListener('transitionend', () => loadEl.remove(), { once: true });

  // ── Data access — pure functions of an arbitrary frame index, so any
  // visualization can look at the past (history/trails) without keeping its
  // own running state. ──────────────────────────────────────────────────────
  function frameAt(frames, fi) { return frames[Math.min(Math.max(fi, 0), frames.length - 1)]; }
  function levelAt(i, fi) { const f = frameAt(rawData[i], fi); return Math.min((f.ampL + f.ampR) * 0.5, 1); }
  function onsetAt(i, fi) { const arr = onsetData[i]; return arr[Math.min(Math.max(fi, 0), arr.length - 1)]; }
  function masterLevelAt(fi) { const f = frameAt(masterFrames, fi); return Math.min((f.ampL + f.ampR) * 0.5, 1); }
  function prominenceAt(fi) {
    const exps = STEMS.map((_, i) => Math.exp(BETA * (levelAt(i, fi) + onsetAt(i, fi))));
    const sum  = exps.reduce((a, b) => a + b, 0) || 1;
    return exps.map(e => e / sum);
  }
  function fftBinsAt(i, fi) {
    const f = frameAt(rawData[i], fi), out = new Float32Array(128);
    for (let b = 0; b < 128; b++) out[b] = melDB((f.fftL[b] + f.fftR[b]) * 0.5);
    return out;
  }
  function bandEnergyAt(i, fi, band) {
    const bins = fftBinsAt(i, fi);
    const [lo, hi] = band === 'bass' ? [0,15] : band === 'mid' ? [16,80] : [81,127];
    let sum = 0; for (let b = lo; b <= hi; b++) sum += bins[b];
    return sum / (hi - lo + 1);
  }
  function historyLevels(i, fi, n) {
    const out = new Array(n);
    for (let k = 0; k < n; k++) out[k] = levelAt(i, fi - (n - 1 - k));
    return out;
  }

  function drawStemLabels(cx, cy, LR) {
    const fontSize = Math.round(Math.max(11, canvas.height * 0.018));
    ctx.font = `300 ${fontSize}px 'Sora', sans-serif`;
    for (let i = 0; i < N; i++) {
      const cos = Math.cos(ANGLES[i]), sin = Math.sin(ANGLES[i]);
      const p = polar(cx, cy, ANGLES[i], LR);
      ctx.textAlign    = cos > 0.3 ? 'left' : cos < -0.3 ? 'right' : 'center';
      ctx.textBaseline = sin > 0.3 ? 'top'  : sin < -0.3 ? 'bottom' : 'middle';
      ctx.fillStyle    = 'rgba(255,255,255,0.50)';
      ctx.fillText(STEMS[i].label, p.x, p.y);
    }
  }

  function closedPolyPath(cx, cy, valueAt) {
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const p = polar(cx, cy, ANGLES[i], valueAt(i));
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  // ── Visualization modes ───────────────────────────────────────────────────
  // Each maps all N stems onto a loop of angles from the center, in the same
  // spirit as the prominence radar chart — but encodes different signals
  // (level, prominence, onset, FFT bands/bins, history) with different marks.
  const MODES = [
    {
      id: 'radar', label: 'Prominence radar (reference)',
      draw(cx, cy, R, fi) {
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let i = 0; i < N; i++) {
          ctx.beginPath(); ctx.moveTo(cx, cy);
          const p = polar(cx, cy, ANGLES[i], R); ctx.lineTo(p.x, p.y); ctx.stroke();
        }
        closedPolyPath(cx, cy, () => R); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke();
        closedPolyPath(cx, cy, () => R / 3); ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.stroke();
        const prom = prominenceAt(fi);
        closedPolyPath(cx, cy, i => prom[i] * R);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.80)'; ctx.lineWidth = 1.5; ctx.stroke();
        const DOT_R = Math.max(2.5, R * 0.010);
        for (let i = 0; i < N; i++) {
          const p = polar(cx, cy, ANGLES[i], prom[i] * R);
          ctx.beginPath(); ctx.arc(p.x, p.y, DOT_R, 0, 2*Math.PI); ctx.fillStyle = 'rgba(255,255,255,0.90)'; ctx.fill();
        }
      },
    },
    {
      id: 'spokes', label: 'Level spokes',
      draw(cx, cy, R, fi) {
        ctx.lineCap = 'round';
        for (let i = 0; i < N; i++) {
          const lvl = levelAt(i, fi), r = 10 + lvl * R;
          const p = polar(cx, cy, ANGLES[i], r);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.65*lvl})`; ctx.lineWidth = 14; ctx.stroke();
        }
        ctx.lineCap = 'butt';
      },
    },
    {
      id: 'petals', label: 'Prominence petals',
      draw(cx, cy, R, fi) {
        const prom = prominenceAt(fi);
        for (let i = 0; i < N; i++) {
          const a = ANGLES[i], len = 20 + prom[i]*R, w = 10 + prom[i]*40, perp = a + Math.PI/2;
          const tip = polar(cx, cy, a, len), mid = polar(cx, cy, a, len*0.5);
          const s1 = { x: mid.x+Math.cos(perp)*w, y: mid.y+Math.sin(perp)*w };
          const s2 = { x: mid.x-Math.cos(perp)*w, y: mid.y-Math.sin(perp)*w };
          ctx.beginPath(); ctx.moveTo(cx, cy);
          ctx.quadraticCurveTo(s1.x, s1.y, tip.x, tip.y);
          ctx.quadraticCurveTo(s2.x, s2.y, cx, cy); ctx.closePath();
          ctx.fillStyle = `rgba(255,255,255,${0.12+0.35*prom[i]})`; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        }
      },
    },
    {
      id: 'onset-rings', label: 'Onset flash rings',
      draw(cx, cy, R, fi) {
        for (let i = 0; i < N; i++) {
          const o = Math.min(1, onsetAt(i, fi)*10), a = ANGLES[i], width = (2*Math.PI/N)*0.6;
          const r = R * (0.35 + 0.6*o);
          ctx.beginPath(); ctx.arc(cx, cy, r, a-width/2, a+width/2);
          ctx.strokeStyle = `rgba(255,255,255,${0.15+0.8*o})`; ctx.lineWidth = 4+10*o; ctx.stroke();
        }
      },
    },
    {
      id: 'oscilloscope', label: 'Circular oscilloscope',
      draw(cx, cy, R, fi) {
        ctx.beginPath(); ctx.arc(cx, cy, R*0.45, 0, 2*Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.stroke();
        const K = 48;
        for (let i = 0; i < N; i++) {
          const a0 = ANGLES[i] - Math.PI/N, a1 = ANGLES[i] + Math.PI/N;
          const hist = historyLevels(i, fi, K);
          ctx.beginPath();
          for (let k = 0; k < K; k++) {
            const t = k/(K-1), ang = a0 + (a1-a0)*t, rad = R*0.45 + hist[k]*R*0.45;
            const p = polar(cx, cy, ang, rad);
            k === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          }
          ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2; ctx.stroke();
        }
      },
    },
    {
      id: 'freq-wheel', label: 'Frequency wheel',
      draw(cx, cy, R, fi) {
        for (let i = 0; i < N; i++) {
          const bins = fftBinsAt(i, fi), a0 = ANGLES[i] - Math.PI/N, a1 = ANGLES[i] + Math.PI/N;
          const start = polar(cx, cy, a0, R*0.3), end = polar(cx, cy, a1, R*0.3);
          ctx.beginPath();
          ctx.moveTo(start.x, start.y);
          for (let b = 0; b < 128; b++) {
            const t = b/127, ang = a0 + (a1-a0)*t, rad = R*0.3 + bins[b]*R*0.65;
            const p = polar(cx, cy, ang, rad); ctx.lineTo(p.x, p.y);
          }
          ctx.lineTo(end.x, end.y);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.70)'; ctx.lineWidth = 1.5; ctx.stroke();
        }
      },
    },
    {
      id: 'fft-bars', label: 'FFT radial bars',
      draw(cx, cy, R, fi) {
        const GROUPS = 24;
        for (let i = 0; i < N; i++) {
          const bins = fftBinsAt(i, fi), a0 = ANGLES[i] - Math.PI/N, a1 = ANGLES[i] + Math.PI/N;
          for (let g = 0; g < GROUPS; g++) {
            const lo = Math.floor(g*128/GROUPS), hi = Math.floor((g+1)*128/GROUPS);
            let s = 0; for (let b = lo; b < hi; b++) s += bins[b]; const v = s/(hi-lo);
            const angMid = a0 + (a1-a0)*(g+0.5)/GROUPS;
            const p0 = polar(cx, cy, angMid, R*0.28), p1 = polar(cx, cy, angMid, R*0.28 + v*R*0.6);
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
            ctx.lineWidth = ((a1-a0)/GROUPS) * R*0.28 * 1.4;
            ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
          }
        }
      },
    },
    {
      id: 'band-petals', label: 'Band petals (bass/mid/treble)',
      draw(cx, cy, R, fi) {
        const OFFS = [ -0.14, 0, 0.14 ], BANDS = ['treble','mid','bass'];
        for (let i = 0; i < N; i++) {
          BANDS.forEach((band, bi) => {
            const a = ANGLES[i] + OFFS[bi], e = bandEnergyAt(i, fi, band);
            const len = 12 + e*R*0.6, w = 6 + e*18, perp = a + Math.PI/2;
            const tip = polar(cx, cy, a, len), mid = polar(cx, cy, a, len*0.5);
            const s1 = { x: mid.x+Math.cos(perp)*w, y: mid.y+Math.sin(perp)*w };
            const s2 = { x: mid.x-Math.cos(perp)*w, y: mid.y-Math.sin(perp)*w };
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.quadraticCurveTo(s1.x, s1.y, tip.x, tip.y);
            ctx.quadraticCurveTo(s2.x, s2.y, cx, cy); ctx.closePath();
            ctx.fillStyle = `rgba(255,255,255,${0.10 + 0.06*bi + 0.25*e})`; ctx.fill();
          });
        }
      },
    },
    {
      id: 'donut', label: 'Prominence donut',
      draw(cx, cy, R, fi) {
        const prom = prominenceAt(fi);
        let cursor = -Math.PI/2;
        for (let i = 0; i < N; i++) {
          const width = prom[i] * 2*Math.PI;
          ctx.beginPath();
          ctx.arc(cx, cy, R*0.65, cursor, cursor+width);
          ctx.arc(cx, cy, R*0.35, cursor+width, cursor, true);
          ctx.closePath();
          ctx.fillStyle = `rgba(255,255,255,${0.16 + (i%2)*0.10})`; ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2; ctx.stroke();
          const midAng = cursor + width/2;
          const lp = polar(cx, cy, midAng, R*0.5);
          ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.font = "300 12px 'Sora', sans-serif";
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          if (width > 0.25) ctx.fillText(STEMS[i].label, lp.x, lp.y);
          cursor += width;
        }
      },
      skipLabels: true,
    },
    {
      id: 'shells', label: 'Level ring stack (history shells)',
      draw(cx, cy, R, fi) {
        const SHELLS = 6, STEP = 6;
        for (let m = SHELLS-1; m >= 0; m--) {
          const fiM = fi - m*STEP, prom = prominenceAt(fiM), Rm = R * (1 - m/SHELLS*0.7);
          closedPolyPath(cx, cy, i => prom[i]*Rm);
          ctx.strokeStyle = `rgba(255,255,255,${0.55*(1-m/SHELLS)+0.05})`; ctx.lineWidth = 1.2; ctx.stroke();
        }
      },
    },
    {
      id: 'comet', label: 'Comet trail dots',
      draw(cx, cy, R, fi) {
        const K = 24;
        for (let i = 0; i < N; i++) {
          const hist = historyLevels(i, fi, K);
          for (let k = 0; k < K; k++) {
            const age = K-1-k, r = hist[k]*R, p = polar(cx, cy, ANGLES[i], r);
            const alpha = Math.max(0, 1-age/K)*0.85, size = Math.max(1, 4*(1-age/K));
            ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, 2*Math.PI);
            ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
          }
        }
      },
    },
    {
      id: 'compass', label: 'Compass needles',
      draw(cx, cy, R, fi) {
        for (let i = 0; i < N; i++) {
          const o = onsetAt(i, fi);
          const wobble = Math.sin(fi*0.3 + i*2.1) * Math.min(0.3, o*3);
          const ang = ANGLES[i] + wobble, len = 20 + levelAt(i, fi)*R;
          const p = polar(cx, cy, ang, len);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 3; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2*Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
        }
      },
    },
    {
      id: 'master-satellites', label: 'Master pulse + satellites',
      draw(cx, cy, R, fi) {
        const mLvl = masterLevelAt(fi);
        ctx.beginPath(); ctx.arc(cx, cy, 20 + mLvl*60, 0, 2*Math.PI);
        ctx.fillStyle = `rgba(255,255,255,${0.15+0.3*mLvl})`; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
        const prom = prominenceAt(fi);
        for (let i = 0; i < N; i++) {
          const lvl = levelAt(i, fi), r = R*0.3 + prom[i]*R*0.65, p = polar(cx, cy, ANGLES[i], r);
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
          ctx.lineWidth = 1 + lvl*4; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke();
          ctx.beginPath(); ctx.arc(p.x, p.y, 4+lvl*8, 0, 2*Math.PI);
          ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fill();
        }
      },
    },
    {
      id: 'starburst', label: 'Starburst impulse',
      draw(cx, cy, R, fi) {
        for (let i = 0; i < N; i++) {
          const o = Math.min(1, onsetAt(i, fi)*10);
          if (o < 0.05) continue;
          const base = ANGLES[i], sparks = 5;
          for (let s = 0; s < sparks; s++) {
            const off = (s-(sparks-1)/2)*0.05, len = R*0.15 + o*R*0.6;
            const p0 = polar(cx, cy, base+off, R*0.1), p1 = polar(cx, cy, base+off, len);
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = `rgba(255,255,255,${o*0.9})`; ctx.lineWidth = 2; ctx.stroke();
          }
        }
      },
    },
    {
      id: 'bloom', label: 'Level bloom (3-layer)',
      draw(cx, cy, R, fi) {
        function slowAvg(i) { const h = historyLevels(i, fi, 90); return h.reduce((a,b)=>a+b,0)/h.length; }
        closedPolyPath(cx, cy, i => levelAt(i, fi)*R);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.stroke();
        const prom = prominenceAt(fi);
        closedPolyPath(cx, cy, i => prom[i]*R);
        ctx.strokeStyle = 'rgba(255,255,255,0.65)'; ctx.lineWidth = 1.5; ctx.stroke();
        closedPolyPath(cx, cy, i => slowAvg(i)*R);
        ctx.setLineDash([4,4]);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.setLineDash([]);
      },
    },
    {
      id: 'halo', label: 'Spectral halo',
      draw(cx, cy, R, fi) {
        const SAMPLES = 240;
        ctx.beginPath();
        for (let s = 0; s <= SAMPLES; s++) {
          const ang = -Math.PI/2 + (2*Math.PI*s)/SAMPLES;
          let radius = 0, wsum = 0;
          for (let i = 0; i < N; i++) {
            const d = angDiff(ang, ANGLES[i]), w = Math.max(0, Math.cos(d*N/2));
            const e = bandEnergyAt(i, fi, 'bass')*0.4 + bandEnergyAt(i, fi, 'mid')*0.4 + bandEnergyAt(i, fi, 'treble')*0.2;
            radius += w*e; wsum += w;
          }
          const r = R*0.55 + (wsum>0 ? radius/wsum : 0)*R*0.35;
          const p = polar(cx, cy, ang, r);
          s === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 2; ctx.stroke();
      },
    },
    {
      id: 'ribbon', label: 'Ribbon loop (smooth blob)',
      draw(cx, cy, R, fi) {
        const pts = STEMS.map((_, i) => polar(cx, cy, ANGLES[i], 10 + levelAt(i, fi)*R));
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const p0 = pts[(i-1+N)%N], p1 = pts[i], p2 = pts[(i+1)%N], p3 = pts[(i+2)%N];
          const cp1x = p1.x+(p2.x-p0.x)/6, cp1y = p1.y+(p2.y-p0.y)/6;
          const cp2x = p2.x-(p3.x-p1.x)/6, cp2y = p2.y-(p3.y-p1.y)/6;
          if (i === 0) ctx.moveTo(p1.x, p1.y);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2; ctx.stroke();
      },
    },
    {
      id: 'clock', label: 'Prominence clock',
      draw(cx, cy, R, fi) {
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2*Math.PI);
        ctx.strokeStyle = 'rgba(255,255,255,0.10)'; ctx.stroke();
        const prom = prominenceAt(fi);
        let vx = 0, vy = 0;
        for (let i = 0; i < N; i++) {
          vx += Math.cos(ANGLES[i])*prom[i]; vy += Math.sin(ANGLES[i])*prom[i];
          const p = polar(cx, cy, ANGLES[i], R);
          ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 2*Math.PI); ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fill();
        }
        const mag = Math.sqrt(vx*vx + vy*vy), ang = Math.atan2(vy, vx);
        const tip = polar(cx, cy, ang, mag*R*1.6);
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tip.x, tip.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3; ctx.stroke();
        ctx.beginPath(); ctx.arc(tip.x, tip.y, 5, 0, 2*Math.PI); ctx.fillStyle = '#fff'; ctx.fill();
      },
    },
    {
      id: 'trails', label: 'History trails (ghost radar)',
      draw(cx, cy, R, fi) {
        const GHOSTS = 8, STEP = 4;
        for (let g = GHOSTS; g >= 0; g--) {
          const fiG = fi - g*STEP, prom = prominenceAt(fiG);
          closedPolyPath(cx, cy, i => prom[i]*R);
          const alpha = g === 0 ? 0.85 : 0.5*(1-g/GHOSTS);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = g === 0 ? 1.5 : 1; ctx.stroke();
        }
      },
    },
    {
      id: 'fft-waterfall', label: 'FFT circular waterfall',
      draw(cx, cy, R, fi) {
        const prom = prominenceAt(fi);
        const order = STEMS.map((_, i) => i).sort((a,b) => prom[b]-prom[a]);
        order.forEach((i, rank) => {
          const ringR = R * (0.25 + (N-rank)/N*0.7), bins = fftBinsAt(i, fi), SAMPLES = 128;
          ctx.beginPath();
          for (let b = 0; b < SAMPLES; b++) {
            const ang = -Math.PI/2 + (2*Math.PI*b)/SAMPLES, rr = ringR + bins[b]*14;
            const p = polar(cx, cy, ang, rr);
            b === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          }
          ctx.closePath();
          ctx.strokeStyle = `rgba(255,255,255,${0.25+0.5*prom[i]})`; ctx.lineWidth = 1.5; ctx.stroke();
          const lp = polar(cx, cy, ANGLES[i], ringR);
          ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.font = "300 12px 'Sora', sans-serif";
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(STEMS[i].label, lp.x + 6, lp.y);
        });
      },
      skipLabels: true,
    },
    {
      id: 'fireflies', label: 'Amplitude fireflies',
      draw(cx, cy, R, fi) {
        const K = 30;
        for (let i = 0; i < N; i++) {
          const hist = historyLevels(i, fi, K);
          for (let k = 0; k < K; k++) {
            const age = K-1-k, t = age/K;
            const ang = ANGLES[i] + Math.sin(k*12.9+i)*0.06*t;
            const r = R*0.15 + hist[k]*R*0.5 + t*R*0.35;
            const p = polar(cx, cy, ang, r);
            const alpha = Math.max(0, 1-t)*0.8, size = Math.max(0.5, 3*(1-t));
            ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, 2*Math.PI);
            ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
          }
        }
      },
    },
  ];

  vizSelect.innerHTML = MODES.map((m, i) => `<option value="${i}">${m.label}</option>`).join('');
  let modeIndex = 0;
  vizSelect.addEventListener('change', () => { modeIndex = parseInt(vizSelect.value, 10); });

  // ── Master audio (playback + clock) ───────────────────────────────────────
  const audio = new Audio(SOUND_BASE + MASTER_MP3);
  audio.preload = 'auto';

  let isPlaying = false, seeking = false;
  function updateBtn() {
    playBtn.innerHTML = isPlaying ? PAUSE_ICON : PLAY_ICON;
    playBtn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }
  updateBtn();

  playBtn.addEventListener('click', () => {
    isPlaying = !isPlaying;
    isPlaying ? audio.play().catch(() => {}) : audio.pause();
    updateBtn();
  });
  audio.addEventListener('ended', () => { isPlaying = false; updateBtn(); });

  audio.addEventListener('loadedmetadata', () => {
    audio.currentTime = 0;
    timeTot.textContent = formatTime(audio.duration);
    seekEl.value = '0';
    timeCur.textContent = formatTime(0);
  });

  audio.addEventListener('timeupdate', () => {
    if (seeking) return;
    const t = audio.currentTime, d = audio.duration || 1;
    seekEl.value = Math.round((t/d)*10000);
    timeCur.textContent = formatTime(t);
  });
  seekEl.addEventListener('mousedown',  () => { seeking = true; });
  seekEl.addEventListener('touchstart', () => { seeking = true; }, { passive:true });
  seekEl.addEventListener('input',  () => { timeCur.textContent = formatTime((seekEl.value/10000)*(audio.duration||0)); });
  seekEl.addEventListener('change', () => { audio.currentTime = (seekEl.value/10000)*(audio.duration||0); seeking = false; });

  // Always draws — this is a scrubbable data visualization (like the radar
  // chart it's based on), not an autoplaying animation, so it must keep
  // reflecting the seek bar / current frame even while audio is paused.
  function draw() {
    requestAnimationFrame(draw);
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cx = W*0.5, cy = H*0.5, R = Math.min(W, H)*0.38;
    const fi = Math.floor(audio.currentTime * FPS);
    const mode = MODES[modeIndex];
    mode.draw(cx, cy, R, fi);
    if (!mode.skipLabels) drawStemLabels(cx, cy, R*1.18);
  }
  draw();
}

init().catch(console.error);
