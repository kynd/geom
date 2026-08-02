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
  const onsetData    = rawData.map(computeOnset);
  const masterFrames = parseBinary(masterBuf);

  loadEl.classList.add('fade-out');
  loadEl.addEventListener('transitionend', () => loadEl.remove(), { once: true });

  // ── Data access — pure functions of an arbitrary frame index ─────────────
  function frameAt(frames, fi) { return frames[Math.min(Math.max(fi, 0), frames.length - 1)]; }
  function levelAt(i, fi) { const f = frameAt(rawData[i], fi); return Math.min((f.ampL + f.ampR) * 0.5, 1); }
  function levelLRAt(i, fi) { const f = frameAt(rawData[i], fi); return [Math.min(f.ampL,1), Math.min(f.ampR,1)]; }
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
  function rateOfChange(i, fi, win) { return levelAt(i, fi) - levelAt(i, fi - win); }

  // ── Shared drawing helpers ────────────────────────────────────────────────
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
  function drawReferenceGrid(cx, cy, R) {
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      ctx.beginPath(); ctx.moveTo(cx, cy);
      const p = polar(cx, cy, ANGLES[i], R); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    polyPath(cx, cy, () => R); ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.stroke();
    polyPath(cx, cy, () => R/3); ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.stroke();
  }
  function polyPath(cx, cy, valueAt, angles = ANGLES) {
    ctx.beginPath();
    for (let i = 0; i < angles.length; i++) {
      const p = polar(cx, cy, angles[i], valueAt(i));
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }
  // Smooth closed Catmull-Rom spline through N points (radius per vertex).
  function splinePath(cx, cy, valueAt, angles = ANGLES) {
    const n = angles.length;
    const pts = angles.map((a, i) => polar(cx, cy, a, valueAt(i)));
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i-1+n)%n], p1 = pts[i], p2 = pts[(i+1)%n], p3 = pts[(i+2)%n];
      const cp1x = p1.x+(p2.x-p0.x)/6, cp1y = p1.y+(p2.y-p0.y)/6;
      const cp2x = p2.x-(p3.x-p1.x)/6, cp2y = p2.y-(p3.y-p1.y)/6;
      if (i === 0) ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
    }
    ctx.closePath();
  }
  function dots(cx, cy, valueAt, alpha = 0.9, radius = null, angles = ANGLES) {
    for (let i = 0; i < angles.length; i++) {
      const p = polar(cx, cy, angles[i], valueAt(i));
      const r = radius ?? Math.max(2.5, canvas.height * 0.0035);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2*Math.PI);
      ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
    }
  }

  // ── Visualization modes — every one evolves the same seven-vertex prominence
  // radar chart, adding a layer of extra data (FFT, history, onset, stereo,
  // rate of change, master level…) onto the same underlying loop-of-angles
  // shape rather than switching to a different graphic altogether. ──────────
  const MODES = [
    {
      id: 'radar', label: 'Prominence radar (reference)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.80)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'spline', label: '1. Smooth outline (spline)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        splinePath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'gradient-fill', label: '2. Gradient interior fill',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0.02)');
        polyPath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'dual-ring', label: '3. Dual ring: level + prominence',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => levelAt(i, fi)*R);
        ctx.strokeStyle = 'rgba(255,255,255,0.30)'; ctx.lineWidth = 1; ctx.stroke();
        polyPath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'onset-glow', label: '4. Onset-modulated vertex glow',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.80)'; ctx.lineWidth = 1.5; ctx.stroke();
        for (let i = 0; i < N; i++) {
          const o = Math.min(1, onsetAt(i, fi)*10);
          const p = polar(cx, cy, ANGLES[i], prom[i]*R);
          const glowR = 6 + o*30;
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
          g.addColorStop(0, `rgba(255,255,255,${0.5*o})`);
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.beginPath(); ctx.arc(p.x, p.y, glowR, 0, 2*Math.PI); ctx.fillStyle = g; ctx.fill();
        }
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'fft-comb', label: '5. FFT comb spikes (star vertices)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => prom[i]*R);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.stroke();
        const TEETH = 16;
        for (let i = 0; i < N; i++) {
          const bins = fftBinsAt(i, fi), base = ANGLES[i], baseR = prom[i]*R;
          for (let t = 0; t < TEETH; t++) {
            const bin = Math.floor(t * 128/TEETH);
            const spread = (t/(TEETH-1) - 0.5) * 0.5;
            const len = 4 + bins[bin]*36;
            const p0 = polar(cx, cy, base+spread, baseR);
            const p1 = polar(cx, cy, base+spread, baseR+len);
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = `rgba(255,255,255,${0.25+0.55*bins[bin]})`; ctx.lineWidth = 1.5; ctx.stroke();
          }
        }
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'fft-edge', label: '6. FFT-wrapped jagged edge',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        const STEPS = 10;
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const bins = fftBinsAt(i, fi), a0 = ANGLES[i], a1 = ANGLES[(i+1)%N];
          const r0 = prom[i]*R, r1 = prom[(i+1)%N]*R;
          for (let s = 0; s <= STEPS; s++) {
            const t = s/STEPS, ang = a0 + (a1-a0+ (a1<a0?2*Math.PI:0))*t;
            const baseR = r0 + (r1-r0)*t;
            const bin = Math.floor(t*127);
            const jag = bins[bin]*18;
            const p = polar(cx, cy, ang, baseR+jag);
            (i === 0 && s === 0) ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
          }
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.2; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'band-triplet', label: '7. Band-split concentric triplet',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const bands = ['treble','mid','bass'], alphas = [0.35, 0.55, 0.85];
        bands.forEach((band, bi) => {
          polyPath(cx, cy, i => (0.15 + bandEnergyAt(i, fi, band)*0.8) * R);
          ctx.strokeStyle = `rgba(255,255,255,${alphas[bi]})`; ctx.lineWidth = 1.3; ctx.stroke();
        });
        const prom = prominenceAt(fi);
        dots(cx, cy, i => prom[i]*R, 0.6, 2);
      },
    },
    {
      id: 'stereo-twin', label: '8. Stereo twin vertices (L/R split)',
      draw(cx, cy, R, fi) {
        const angles2 = [];
        for (let i = 0; i < N; i++) { angles2.push(ANGLES[i] - 0.06, ANGLES[i] + 0.06); }
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let i = 0; i < N; i++) { const p = polar(cx, cy, ANGLES[i], R); ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(p.x,p.y); ctx.stroke(); }
        polyPath(cx, cy, i => {
          const stem = Math.floor(i/2), ch = i%2, [l,r] = levelLRAt(stem, fi);
          return (ch === 0 ? l : r) * R;
        }, angles2);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1.3; ctx.stroke();
        dots(cx, cy, i => {
          const stem = Math.floor(i/2), ch = i%2, [l,r] = levelLRAt(stem, fi);
          return (ch === 0 ? l : r) * R;
        }, 0.9, 2.5, angles2);
        drawStemLabels(cx, cy, R*1.18);
        return true; // custom labels already drawn
      },
    },
    {
      id: 'history-overlay', label: '9. History ring overlay (echoes)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const LAYERS = 5, STEP = 8;
        for (let l = LAYERS; l >= 0; l--) {
          const fiL = fi - l*STEP, prom = prominenceAt(fiL);
          const shrink = 1 - l*0.05;
          polyPath(cx, cy, i => prom[i]*R*shrink);
          const alpha = l === 0 ? 0.85 : 0.45*(1-l/LAYERS);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = l === 0 ? 1.5 : 1; ctx.stroke();
        }
        const prom0 = prominenceAt(fi);
        dots(cx, cy, i => prom0[i]*R);
      },
    },
    {
      id: 'contour-terrain', label: '10. Filled contour terrain (history)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const LAYERS = 8, STEP = 6;
        for (let l = LAYERS; l >= 1; l--) {
          const promOuter = prominenceAt(fi - (l-1)*STEP);
          const promInner = prominenceAt(fi - l*STEP);
          const shrinkOuter = 1 - (l-1)*0.04, shrinkInner = 1 - l*0.04;
          ctx.beginPath();
          for (let i = 0; i < N; i++) { const p = polar(cx, cy, ANGLES[i], promOuter[i]*R*shrinkOuter); i===0?ctx.moveTo(p.x,p.y):ctx.lineTo(p.x,p.y); }
          for (let i = N-1; i >= 0; i--) { const p = polar(cx, cy, ANGLES[i], promInner[i]*R*shrinkInner); ctx.lineTo(p.x,p.y); }
          ctx.closePath();
          ctx.fillStyle = `rgba(255,255,255,${0.03 + 0.02*(LAYERS-l)})`; ctx.fill();
        }
        const prom0 = prominenceAt(fi);
        polyPath(cx, cy, i => prom0[i]*R);
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom0[i]*R);
      },
    },
    {
      id: 'edge-derivative', label: '11. Edge thickness = rate of change',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        for (let i = 0; i < N; i++) {
          const j = (i+1)%N;
          const p0 = polar(cx, cy, ANGLES[i], prom[i]*R), p1 = polar(cx, cy, ANGLES[j], prom[j]*R);
          const roc = (Math.abs(rateOfChange(i, fi, 6)) + Math.abs(rateOfChange(j, fi, 6))) * 0.5;
          ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
          ctx.lineWidth = 1 + Math.min(1, roc*10)*10;
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.stroke();
        }
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'tension-petals', label: '12. Cross-stem tension petals',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        ctx.beginPath();
        for (let i = 0; i < N; i++) {
          const j = (i+1)%N;
          const p0 = polar(cx, cy, ANGLES[i], prom[i]*R), p1 = polar(cx, cy, ANGLES[j], prom[j]*R);
          const pair = onsetAt(i, fi) * onsetAt(j, fi);
          const bulge = Math.min(1, pair*40) * R*0.18;
          const midAngle = (ANGLES[i] + ANGLES[j] + (ANGLES[j]<ANGLES[i]?2*Math.PI:0)) / 2;
          const midR = (prom[i]+prom[j])*0.5*R + bulge;
          const cp = polar(cx, cy, midAngle, midR);
          if (i === 0) ctx.moveTo(p0.x, p0.y);
          ctx.quadraticCurveTo(cp.x, cp.y, p1.x, p1.y);
        }
        ctx.closePath();
        ctx.fillStyle = 'rgba(255,255,255,0.07)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'fan-facets', label: '13. Triangulated fan facets',
      draw(cx, cy, R, fi) {
        const prom = prominenceAt(fi);
        for (let i = 0; i < N; i++) {
          const j = (i+1)%N;
          const p0 = polar(cx, cy, ANGLES[i], prom[i]*R), p1 = polar(cx, cy, ANGLES[j], prom[j]*R);
          const pairEnergy = (levelAt(i, fi) + levelAt(j, fi)) * 0.5;
          ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.closePath();
          ctx.fillStyle = `rgba(255,255,255,${0.04 + 0.22*pairEnergy})`; ctx.fill();
          ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; ctx.stroke();
        }
        dots(cx, cy, i => prom[i]*R);
        drawReferenceGrid(cx, cy, R);
      },
    },
    {
      id: 'rotating', label: '14. Rotating phase heptagon',
      draw(cx, cy, R, fi) {
        const rot = (fi/FPS) * (0.15 + masterLevelAt(fi)*0.5);
        const angles2 = ANGLES.map(a => a + rot);
        ctx.strokeStyle = 'rgba(255,255,255,0.05)'; ctx.lineWidth = 1;
        for (let i = 0; i < N; i++) { const p = polar(cx, cy, angles2[i], R); ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(p.x,p.y); ctx.stroke(); }
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => prom[i]*R, angles2);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R, 0.9, null, angles2);
        for (let i = 0; i < N; i++) {
          const p = polar(cx, cy, angles2[i], R*1.18);
          ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = "300 13px 'Sora', sans-serif";
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(STEMS[i].label, p.x, p.y);
        }
        return true;
      },
    },
    {
      id: 'breathing', label: '15. Master-scaled breathing frame',
      draw(cx, cy, R, fi) {
        const scale = 0.75 + masterLevelAt(fi)*0.4;
        const Rm = R * scale;
        drawReferenceGrid(cx, cy, Rm);
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => prom[i]*Rm);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*Rm);
      },
    },
    {
      id: 'comet-vertices', label: '16. Comet-tail vertices',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        polyPath(cx, cy, i => prom[i]*R);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1; ctx.stroke();
        const K = 16;
        for (let i = 0; i < N; i++) {
          const hist = historyLevels(i, fi, K);
          for (let k = 0; k < K; k++) {
            const age = K-1-k, p = polar(cx, cy, ANGLES[i], hist[k]*R);
            const alpha = Math.max(0, 1-age/K)*0.8, size = Math.max(1, 3.5*(1-age/K));
            ctx.beginPath(); ctx.arc(p.x, p.y, size, 0, 2*Math.PI);
            ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
          }
        }
      },
    },
    {
      id: 'bloom-halo', label: '17. Bloom halo (prominence-scaled)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        const total = prom.reduce((a,b)=>Math.max(a,b), 0);
        ctx.save();
        ctx.shadowColor = 'rgba(255,255,255,0.9)';
        ctx.shadowBlur = 10 + total*40;
        polyPath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 2; ctx.stroke();
        ctx.restore();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'edge-luma', label: '18. Frequency-textured edge banding',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        const STEPS = 14;
        for (let i = 0; i < N; i++) {
          const j = (i+1)%N;
          const binsA = fftBinsAt(i, fi), binsB = fftBinsAt(j, fi);
          for (let s = 0; s < STEPS; s++) {
            const t0 = s/STEPS, t1 = (s+1)/STEPS;
            const a0 = ANGLES[i] + (ANGLES[j]-ANGLES[i]+(ANGLES[j]<ANGLES[i]?2*Math.PI:0))*t0;
            const a1 = ANGLES[i] + (ANGLES[j]-ANGLES[i]+(ANGLES[j]<ANGLES[i]?2*Math.PI:0))*t1;
            const r0 = (prom[i]+(prom[j]-prom[i])*t0)*R, r1 = (prom[i]+(prom[j]-prom[i])*t1)*R;
            const p0 = polar(cx, cy, a0, r0), p1 = polar(cx, cy, a1, r1);
            const bin = Math.floor(((binsA.length-1)*(1-t0) + (binsB.length-1)*t0));
            const luma = binsA[Math.min(127,bin)]*(1-t0) + binsB[Math.min(127,bin)]*t0;
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = `rgba(255,255,255,${0.25+0.65*luma})`; ctx.lineWidth = 2; ctx.stroke();
          }
        }
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'ripples', label: '19. Onset shockwave ripples',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);
        const RIPPLES = 18;
        for (let k = 0; k < RIPPLES; k++) {
          const fiK = fi - k*2;
          let maxOnset = 0;
          for (let i = 0; i < N; i++) maxOnset = Math.max(maxOnset, onsetAt(i, fiK));
          const o = Math.min(1, maxOnset*10);
          if (o < 0.1) continue;
          const age = k, radius = R*(0.1 + age/RIPPLES);
          const alpha = o * Math.max(0, 1 - age/RIPPLES) * 0.5;
          ctx.beginPath(); ctx.arc(cx, cy, radius, 0, 2*Math.PI);
          ctx.strokeStyle = `rgba(255,255,255,${alpha})`; ctx.lineWidth = 2; ctx.stroke();
        }
        polyPath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5; ctx.stroke();
        dots(cx, cy, i => prom[i]*R);
      },
    },
    {
      id: 'composite', label: '20. Full composite (everything)',
      draw(cx, cy, R, fi) {
        drawReferenceGrid(cx, cy, R);
        const prom = prominenceAt(fi);

        // History ring overlay
        const LAYERS = 4, STEP = 8;
        for (let l = LAYERS; l >= 1; l--) {
          const promL = prominenceAt(fi - l*STEP), shrink = 1 - l*0.05;
          splinePath(cx, cy, i => promL[i]*R*shrink);
          ctx.strokeStyle = `rgba(255,255,255,${0.3*(1-l/LAYERS)})`; ctx.lineWidth = 1; ctx.stroke();
        }

        // Onset shockwave
        let maxOnset = 0;
        for (let i = 0; i < N; i++) maxOnset = Math.max(maxOnset, onsetAt(i, fi));
        if (maxOnset > 0.02) {
          ctx.beginPath(); ctx.arc(cx, cy, R*(0.3+Math.min(1,maxOnset*8)*0.6), 0, 2*Math.PI);
          ctx.strokeStyle = `rgba(255,255,255,${Math.min(1,maxOnset*8)*0.4})`; ctx.lineWidth = 2; ctx.stroke();
        }

        // Gradient fill + spline outline
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, 'rgba(255,255,255,0.30)'); g.addColorStop(1, 'rgba(255,255,255,0.02)');
        ctx.save(); ctx.shadowColor = 'rgba(255,255,255,0.8)'; ctx.shadowBlur = 16;
        splinePath(cx, cy, i => prom[i]*R);
        ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.8; ctx.stroke();
        ctx.restore();

        // FFT comb vertices
        const TEETH = 12;
        for (let i = 0; i < N; i++) {
          const bins = fftBinsAt(i, fi), base = ANGLES[i], baseR = prom[i]*R;
          for (let t = 0; t < TEETH; t++) {
            const bin = Math.floor(t*128/TEETH), spread = (t/(TEETH-1)-0.5)*0.4;
            const len = 4 + bins[bin]*26;
            const p0 = polar(cx, cy, base+spread, baseR), p1 = polar(cx, cy, base+spread, baseR+len);
            ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y);
            ctx.strokeStyle = `rgba(255,255,255,${0.2+0.5*bins[bin]})`; ctx.lineWidth = 1.2; ctx.stroke();
          }
        }
        dots(cx, cy, i => prom[i]*R);
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

  // ── AA button — decorative only; there is no shader/SSAA here, kept for
  // visual consistency with the site's standard control bar (matches the
  // sibling stem-radar demo, which is likewise a plain 2D canvas). ─────────
  document.getElementById('aa-btn').addEventListener('click', e => e.currentTarget.classList.toggle('active'));

  // Always draws — a scrubbable data visualization, not an autoplaying
  // animation, so it must keep reflecting the seek bar even while paused.
  function draw() {
    requestAnimationFrame(draw);
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cx = W*0.5, cy = H*0.5, R = Math.min(W, H)*0.38;
    const fi = Math.floor(audio.currentTime * FPS);
    const mode = MODES[modeIndex];
    const customLabels = mode.draw(cx, cy, R, fi);
    if (!customLabels) drawStemLabels(cx, cy, R*1.18);
  }
  draw();
}

init().catch(console.error);
