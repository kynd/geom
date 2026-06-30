#!/usr/bin/env python3
"""
apply_mel_db.py — applies log (dB) mapping to Mel values at the point of use
in every visualization demo so the perceptual scale matches real-time FFT.

Formula: melDB(v) = clamp((20·log10(max(v,1e-5)) + 100) / 70, 0, 1)

Run from repo root:
    python3 sound/apply_mel_db.py
"""
import re, os

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

MEL_DB = "\nfunction melDB(v) { return Math.max(0, Math.min(1, (20 * Math.log10(Math.max(v, 1e-5)) + 80) / 80)); }"

# ── helpers ───────────────────────────────────────────────────────────────────

def path(*parts):
    return os.path.join(REPO, *parts)

def edit(fpath, transforms):
    with open(fpath) as f:
        src = f.read()
    orig = src
    for old, new in transforms:
        if isinstance(old, str):
            src = src.replace(old, new)
        else:
            src = old.sub(new, src)
    if src == orig:
        print(f'  WARN unchanged: {os.path.relpath(fpath, REPO)}')
        return
    with open(fpath, 'w') as f:
        f.write(src)
    print(f'  ok: {os.path.relpath(fpath, REPO)}')

def insert_mel_db_after_parse_binary(fpath):
    """Inserts melDB function after the closing brace of parseBinary."""
    with open(fpath) as f:
        src = f.read()
    if 'function melDB' in src:
        return src  # already present
    # parseBinary always ends with this exact sequence
    marker = '  return frames;\n}'
    idx = src.find(marker)
    if idx == -1:
        print(f'  WARN: parseBinary end not found in {os.path.relpath(fpath, REPO)}')
        return src
    insert_at = idx + len(marker)
    src = src[:insert_at] + MEL_DB + src[insert_at:]
    return src

def write(fpath, src):
    with open(fpath, 'w') as f:
        f.write(src)
    print(f'  ok: {os.path.relpath(fpath, REPO)}')

# ── 1. Files using fftBuf.set(f.fftL) — scalar-effects + sound-effects ───────

SET_SINGLE_FILES = [
    path('public/sketches/scalar-effects/01-pixel-orbit/main.js'),
    path('public/sketches/scalar-effects/02-spectral-warp/main.js'),
    path('public/sketches/scalar-effects/03-4d-section/main.js'),
    path('public/sketches/scalar-effects/04-spectral-lensing/main.js'),
    path('public/sketches/scalar-effects/05-temporal-smear/main.js'),
    path('public/sketches/scalar-effects/06-ifs-fold/main.js'),
    path('public/sketches/sound-effects/01-spectral-hedgehog/main.js'),
    path('public/sketches/sound-effects/02-bass-fold/main.js'),
    path('public/sketches/sound-effects/03-per-pixel-orbit/main.js'),
    path('public/sketches/sound-effects/04-temporal-echo/main.js'),
    path('public/sketches/sound-effects/05-ray-warp/main.js'),
    path('public/sketches/sound-effects/06-fft-columns/main.js'),
]

for fpath in SET_SINGLE_FILES:
    src = insert_mel_db_after_parse_binary(fpath)
    src = src.replace(
        'fftBuf.set(f.fftL);',
        'for (let _b = 0; _b < 128; _b++) fftBuf[_b] = melDB(f.fftL[_b]);'
    )
    write(fpath, src)

# ── 2. sound-wave — two channels ─────────────────────────────────────────────

fpath = path('public/demos/sound-wave/main.js')
src = insert_mel_db_after_parse_binary(fpath)
src = src.replace(
    '      fftBuf.set(f.fftL);\n      fftBufR.set(f.fftR);',
    '      for (let _b = 0; _b < 128; _b++) { fftBuf[_b] = melDB(f.fftL[_b]); fftBufR[_b] = melDB(f.fftR[_b]); }'
)
write(fpath, src)

# ── 3. sound-analysis — bar chart val ─────────────────────────────────────────

fpath = path('public/demos/sound-analysis/main.js')
src = insert_mel_db_after_parse_binary(fpath)
src = src.replace(
    '      const val = fftData[i];\n      const bh  = val * FFT_H;',
    '      const val = melDB(fftData[i]);\n      const bh  = val * FFT_H;'
)
write(fpath, src)

# ── 4. ridge — Uint8 DataTexture ──────────────────────────────────────────────

fpath = path('public/demos/ridge/main.js')
src = insert_mel_db_after_parse_binary(fpath)
src = src.replace(
    'histData[b * 4]     = Math.round(f.fftL[b] * 255);\n        histData[b * 4 + 1] = Math.round(f.fftR[b] * 255);',
    'histData[b * 4]     = Math.round(melDB(f.fftL[b]) * 255);\n        histData[b * 4 + 1] = Math.round(melDB(f.fftR[b]) * 255);'
)
write(fpath, src)

# ── 5. sound-fill-data and sound-fill-3d-data ──────────────────────────────────

for fpath in [
    path('public/demos/sound-fill-data/main.js'),
    path('public/demos/sound-fill-3d-data/main.js'),
]:
    src = insert_mel_db_after_parse_binary(fpath)
    src = src.replace(
        'fftBuf[i * 4]     = Math.round(v * 255);',
        'fftBuf[i * 4]     = Math.round(melDB(v) * 255);'
    )
    write(fpath, src)

# ── 6. sketch fill-functions 05, 07, 08 ───────────────────────────────────────

for fpath in [
    path('public/sketches/fill-functions/05-sound-fill-data/main.js'),
    path('public/sketches/fill-functions/07-fill-envelope/main.js'),
    path('public/sketches/fill-functions/08-fill-bandsplit/main.js'),
]:
    src = insert_mel_db_after_parse_binary(fpath)
    src = src.replace(
        'fftBuf[i * 4]     = Math.round(v * 255);',
        'fftBuf[i * 4]     = Math.round(melDB(v) * 255);'
    )
    write(fpath, src)

# ── 7. fill-harmonic/06 — mel values in synthesizeWav ─────────────────────────

fpath = path('public/sketches/fill-functions/06-fill-harmonic/main.js')
src = insert_mel_db_after_parse_binary(fpath)
# mel[k] used as harmonic amplitude in synthesizeWav
src = src.replace(
    '      w += mel[k] * Math.sin(',
    '      w += melDB(mel[k]) * Math.sin('
)
write(fpath, src)

# ── 8. fill-envelope/07 — envelope lookup ─────────────────────────────────────
# Already covered by step 6 (Uint8 texture path).
# The `env = mel[Math.round(t * 127)]` feeds the fill amplitude — apply melDB there too.

fpath = path('public/sketches/fill-functions/07-fill-envelope/main.js')
with open(fpath) as f:
    src = f.read()
src = src.replace(
    'const env     = mel[Math.round(t * 127)];',
    'const env     = melDB(mel[Math.round(t * 127)]);'
)
with open(fpath, 'w') as f:
    f.write(src)
print(f'  ok (env): {os.path.relpath(fpath, REPO)}')

# ── 9. multitrack/04 — bar chart + fix loadTrack to binary ───────────────────

fpath = path('public/sketches/fill-functions/04-multitrack/main.js')
with open(fpath) as f:
    src = f.read()

# Add melDB after the drawFFT function (no parseBinary in this file)
if 'function melDB' not in src:
    src = src.replace(
        'function drawFFT(ctx, fftData, x0, panelW, yTop, yBtm, r, g, b) {',
        MEL_DB[1:] + '\nfunction drawFFT(ctx, fftData, x0, panelW, yTop, yBtm, r, g, b) {'
    )

# Apply melDB in bar chart
src = src.replace(
    '    const val = fftData[i] || 0;',
    '    const val = melDB(fftData[i] || 0);'
)

# Fix loadTrack: replace text-based parsing with binary parseBinary
# Add parseBinary + replace loadTrack body
PARSE_BIN_FN = """\
function parseBinary(buffer) {
  const f32 = new Float32Array(buffer);
  const N = 258, n = (f32.length / N) | 0;
  const frames = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * N;
    frames[i] = { amp: (f32[o] + f32[o + 1]) * 0.5, ampL: f32[o], ampR: f32[o + 1], fftL: f32.subarray(o + 2, o + 130), fftR: f32.subarray(o + 130, o + 258) };
  }
  return frames;
}"""

OLD_LOAD_TRACK = """\
async function loadTrack(url, bar) {
  const res  = await fetch(url);
  const text = await res.text();   // decode fully before parsing (async I/O, doesn't block UI)

  // Switch bar from indeterminate to parse progress
  bar.fill.classList.remove('indeterminate');
  bar.fill.style.width = '0%';

  const lines  = text.split('\\n').filter(l => l.trim() && !l.startsWith('#'));
  const result = [];
  const CHUNK  = 300;   // rows per yield — keeps frame budget well under 16 ms

  for (let i = 0; i < lines.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, lines.length);
    for (let j = i; j < end; j++) {
      const v = lines[j].split(/\\s+/);
      result.push({
        ampL: +v[0] || 0,
        ampR: +v[1] || 0,
        fftL: v.slice(2, 130).map(Number),
        fftR: v.slice(130, 258).map(Number),
      });
    }
    const pct = Math.round((end / lines.length) * 100);
    bar.fill.style.width = pct + '%';
    bar.pct.textContent  = pct + '%';
    await new Promise(r => setTimeout(r, 0));   // yield to event loop
  }

  bar.fill.style.width = '100%';
  bar.pct.textContent  = '100%';
  return result;
}"""

NEW_LOAD_TRACK = """\
async function loadTrack(url, bar) {
  const buf    = await fetch(url).then(r => r.arrayBuffer());
  const result = parseBinary(buf);
  bar.fill.classList.remove('indeterminate');
  bar.fill.style.width = '100%';
  bar.pct.textContent  = '100%';
  return result;
}"""

if 'function parseBinary' not in src:
    src = src.replace(
        '// Fetch the text file, then parse it asynchronously in chunks so the main\n// thread stays responsive. Progress bar reflects parse progress (the slow part).\n' + OLD_LOAD_TRACK,
        PARSE_BIN_FN + '\n\n' + NEW_LOAD_TRACK
    )
else:
    src = src.replace(
        '// Fetch the text file, then parse it asynchronously in chunks so the main\n// thread stays responsive. Progress bar reflects parse progress (the slow part).\n' + OLD_LOAD_TRACK,
        NEW_LOAD_TRACK
    )

# Update comment in init
src = src.replace(
    '  // Load 8 text files in parallel; each parses asynchronously with progress',
    '  // Load 8 binary files in parallel'
)

with open(fpath, 'w') as f:
    f.write(src)
print(f'  ok: {os.path.relpath(fpath, REPO)}')

print('\n✓ done')
