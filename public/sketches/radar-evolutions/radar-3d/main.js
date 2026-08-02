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
// Track prominence radar chart.
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

async function init() {
  const canvas    = document.getElementById('main-canvas');
  const ctx       = canvas.getContext('2d');
  const playBtn   = document.getElementById('play-btn');
  const seekEl    = document.getElementById('seek');
  const timeCur   = document.getElementById('time-current');
  const timeTot   = document.getElementById('time-total');
  const loadEl    = document.getElementById('loading');

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

  // ── 3D projection ──────────────────────────────────────────────────────────
  // Hand-rolled perspective projector — rotate around Z (roll), then Y (yaw),
  // then X (pitch), then project with a simple pinhole camera at fixed focal
  // distance.
  const FOCAL = 900;
  function project3(px, py, pz, rotX, rotY, rotZ, cx, cy, scale) {
    const cZ = Math.cos(rotZ), sZ = Math.sin(rotZ);
    const x0 = px*cZ - py*sZ, y0 = px*sZ + py*cZ, z0 = pz;

    const cY = Math.cos(rotY), sY = Math.sin(rotY);
    const x1 = x0*cY - z0*sY, y1 = y0, z1 = x0*sY + z0*cY;

    const cX = Math.cos(rotX), sX = Math.sin(rotX);
    const y2 = y1*cX - z1*sX, z2 = y1*sX + z1*cX;

    const denom = FOCAL + z2;
    const f = denom > FOCAL*0.15 ? FOCAL/denom : FOCAL/(FOCAL*0.15);
    return { x: cx + x1*scale*f, y: cy - y2*scale*f, f };
  }

  // ── Camera orbit: slow auto-rotation, draggable like the Composition demo's
  // orbit camera (drag adds a persistent offset; release keeps spinning). ───
  let dragBaseY = 0, dragBaseX = -0.32;
  let dragging = false, dragStartX = 0, dragStartY = 0, dragStartBaseY = 0, dragStartBaseX = 0;
  canvas.addEventListener('pointerdown', e => {
    dragging = true; canvas.classList.add('dragging');
    dragStartX = e.clientX; dragStartY = e.clientY;
    dragStartBaseY = dragBaseY; dragStartBaseX = dragBaseX;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;
    dragBaseY = dragStartBaseY + dx * 0.006;
    dragBaseX = Math.max(-1.3, Math.min(1.3, dragStartBaseX - dy * 0.006));
  });
  canvas.addEventListener('pointerup',   () => { dragging = false; canvas.classList.remove('dragging'); });
  canvas.addEventListener('pointerleave', () => { dragging = false; canvas.classList.remove('dragging'); });

  // ── History sliders ────────────────────────────────────────────────────────
  const histCountSl  = document.getElementById('p-hist-count');
  const histCountVal = document.getElementById('p-hist-count-v');
  const histSpanSl   = document.getElementById('p-hist-span');
  const histSpanVal  = document.getElementById('p-hist-span-v');
  histCountSl.addEventListener('input', () => { histCountVal.textContent = histCountSl.value; });
  histSpanSl.addEventListener('input',  () => { histSpanVal.textContent  = histSpanSl.value;  });

  const rotXSl  = document.getElementById('p-rot-x'),  rotXVal  = document.getElementById('p-rot-x-v');
  const rotYSl  = document.getElementById('p-rot-y'),  rotYVal  = document.getElementById('p-rot-y-v');
  const rotZSl  = document.getElementById('p-rot-z'),  rotZVal  = document.getElementById('p-rot-z-v');
  const fftSizeSl = document.getElementById('p-fft-size'), fftSizeVal = document.getElementById('p-fft-size-v');
  const shapeSizeSl = document.getElementById('p-shape-size'), shapeSizeVal = document.getElementById('p-shape-size-v');
  const binsSl = document.getElementById('p-bins'), binsVal = document.getElementById('p-bins-v');
  const promMoveSl = document.getElementById('p-prom-move'), promMoveVal = document.getElementById('p-prom-move-v');
  rotXSl.addEventListener('input', () => { rotXVal.textContent = rotXSl.value; });
  rotYSl.addEventListener('input', () => { rotYVal.textContent = rotYSl.value; });
  rotZSl.addEventListener('input', () => { rotZVal.textContent = rotZSl.value; });
  fftSizeSl.addEventListener('input',   () => { fftSizeVal.textContent   = fftSizeSl.value;   });
  shapeSizeSl.addEventListener('input', () => { shapeSizeVal.textContent = shapeSizeSl.value; });
  binsSl.addEventListener('input', () => { binsVal.textContent = binsSl.value; });
  promMoveSl.addEventListener('input', () => { promMoveVal.textContent = promMoveSl.value; });

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

  // AA button — decorative only; there is no shader/SSAA here, kept for
  // visual consistency with the site's standard control bar.
  document.getElementById('aa-btn').addEventListener('click', e => e.currentTarget.classList.toggle('active'));

  // Rotation is driven by frame index, not wall-clock time — so "5 frames
  // ago" has a well-defined rotation, reproducible under scrubbing/pause
  // rather than tied to when you happened to look. Each axis has its own
  // independent speed (p-rot-x/y/z, degrees/sec).

  // Hidden vertices: each of the 7 main edges is subdivided into several
  // extra points that, at fftSize = 0, sit exactly ON the straight edge (so
  // the shape is pixel-identical to the plain heptagon). They're "hidden" in
  // the sense that they never get their own dot marker, only the primary 7
  // vertices do.
  //
  // FFT-to-point mapping: each stem owns nSide extra points running away
  // from it on both sides (nSide is the p-bins slider — it also sets how
  // many of the 128 FFT bins actually get sampled, one per step). Band 0
  // (lowest) maps to the stem's own main vertex; one step away on either
  // side gets the next band up; the last point before reaching the next
  // stem's vertex (but not the vertex itself) gets the highest band. Since
  // two neighboring stems' point-chains meet along the same edge, every
  // point in the middle of an edge is reachable from both of the stems
  // bracketing it.

  // The direction of that push spins over time within the plane orthogonal
  // to that stem's own radial spoke (spanned by the fixed Z axis and the
  // tangential direction at that stem's angle), so different stems bulge in
  // different directions, and each one's direction keeps changing. Driven by
  // frame index like the rotation, so it's reproducible under scrubbing
  // rather than tied to wall-clock time.
  const DEFORM_SPIN = 0.6; // rad/sec
  function deformDir(i, fi) {
    const a = ANGLES[i];
    const phase = (i / N) * 2*Math.PI;
    const phi = phase + (fi / FPS) * DEFORM_SPIN;
    const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
    // u = (0,0,1) [plane normal], v = (-sinA, cosA, 0) [tangential] — both
    // already perpendicular to this stem's radial direction (cosA, sinA, 0).
    return { x: -Math.sin(a)*sinPhi, y: Math.cos(a)*sinPhi, z: cosPhi };
  }

  function bandForStep(k, nSide) { return Math.min(127, Math.round(k / nSide * 127)); }

  function buildRingPoints(prom, fi, sizeFrac, R, nSide) {
    const pts = [];
    const bins = STEMS.map((_, i) => sizeFrac > 0 ? fftBinsAt(i, fi) : null);
    const dirs = STEMS.map((_, i) => sizeFrac > 0 ? deformDir(i, fi) : null);

    for (let i = 0; i < N; i++) {
      const j = (i+1) % N;
      const p0x = Math.cos(ANGLES[i])*prom[i]*R, p0y = Math.sin(ANGLES[i])*prom[i]*R;
      const p1x = Math.cos(ANGLES[j])*prom[j]*R, p1y = Math.sin(ANGLES[j])*prom[j]*R;

      // Main vertex i: band 0 (lowest) of its own spectrum only.
      let vx = p0x, vy = p0y, vz = 0;
      if (sizeFrac > 0) {
        const mag = sizeFrac * R * 0.6 * (bins[i][0]*2 - 1);
        vx += dirs[i].x*mag; vy += dirs[i].y*mag; vz += dirs[i].z*mag;
      }
      pts.push({ x: vx, y: vy, z: vz, vertex: true });

      if (sizeFrac > 0) {
        for (let s = 1; s <= nSide; s++) {
          const t = s / (nSide + 1);
          // s steps away from stem i; (nSide+1-s) steps away from stem j —
          // both chains pass through this same point from opposite ends.
          const binI = bandForStep(s, nSide), binJ = bandForStep(nSide + 1 - s, nSide);
          const magI = sizeFrac * R * 0.6 * (bins[i][binI]*2 - 1);
          const magJ = sizeFrac * R * 0.6 * (bins[j][binJ]*2 - 1);
          // Each neighbor pushes independently, in its own (different,
          // spinning) direction, and the two offsets are summed rather than
          // blended into one — so the two stems can pull the same point in
          // unrelated directions instead of always compromising toward a
          // single shared push, which is what makes the surface buckle in a
          // more tangled, less uniformly-radial way.
          const ox = dirs[i].x*magI + dirs[j].x*magJ;
          const oy = dirs[i].y*magI + dirs[j].y*magJ;
          const oz = dirs[i].z*magI + dirs[j].z*magJ;
          pts.push({ x: p0x+(p1x-p0x)*t + ox, y: p0y+(p1y-p0y)*t + oy, z: oz, vertex: false });
        }
      }
    }
    return pts;
  }

  // Always draws — a scrubbable data visualization, not an autoplaying
  // animation, so it must keep reflecting the seek bar even while paused.
  function draw() {
    requestAnimationFrame(draw);
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    const cx = W*0.5, cy = H*0.5, scale = 1;
    const fi = Math.floor(audio.currentTime * FPS);

    const K        = parseInt(histCountSl.value, 10);
    const SPAN     = parseInt(histSpanSl.value, 10);
    const sizeFrac = parseFloat(fftSizeSl.value);
    const nSide    = parseInt(binsSl.value, 10);
    const promMove = parseFloat(promMoveSl.value);
    const R        = Math.min(W, H)*0.30 * parseFloat(shapeSizeSl.value);
    const ROTX_PER_FRAME = (parseFloat(rotXSl.value) * Math.PI/180) / FPS;
    const ROTY_PER_FRAME = (parseFloat(rotYSl.value) * Math.PI/180) / FPS;
    const ROTZ_PER_FRAME = (parseFloat(rotZSl.value) * Math.PI/180) / FPS;

    // Draw oldest (most-rotated-away) first so the current frame's ring
    // ends up drawn last, on top.
    for (let k = K; k >= 0; k--) {
      const fiK  = fi - k*SPAN;
      // promMove = 0 collapses every stem's radius to 0.5 (a perfect, static
      // septagon at half the full size); promMove = 1 is the full
      // prominence-driven radius.
      const prom = prominenceAt(fiK).map(p => 0.5 + promMove * (p - 0.5));
      // Same center for every layer — only the accumulated rotation differs,
      // so history spirals away in angle, not in space.
      const rotX = dragBaseX + fiK * ROTX_PER_FRAME;
      const rotY = dragBaseY + fiK * ROTY_PER_FRAME;
      const rotZ = fiK * ROTZ_PER_FRAME;
      const t     = K > 0 ? k / K : 0;
      const alpha = k === 0 ? 0.95 : Math.max(0.03, 0.85 * (1 - t) * (1 - t));

      const ringPts = buildRingPoints(prom, fiK, sizeFrac, R, nSide);
      const pts = ringPts.map(p3 => project3(p3.x, p3.y, p3.z, rotX, rotY, rotZ, cx, cy, scale));

      ctx.beginPath();
      pts.forEach((p, i) => i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y));
      ctx.closePath();
      ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
      ctx.lineWidth   = k === 0 ? 1.6 : 1;
      ctx.stroke();

      const dotR = k === 0 ? 3 : Math.max(1, 2.2*(1-t));
      pts.forEach((p, i) => {
        if (!ringPts[i].vertex) return;
        ctx.beginPath(); ctx.arc(p.x, p.y, dotR, 0, 2*Math.PI);
        ctx.fillStyle = `rgba(255,255,255,${alpha})`; ctx.fill();
      });
    }
  }
  draw();
}

init().catch(console.error);
