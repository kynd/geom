# Geom — Technical Reference

This is a working log and sketchbook for a music video for *Musical Architecture* by Yaporigami (Yu Miyashita). Every page explores math, geometry, or shader techniques driven by pre-computed audio data. See `writing-style-guide.md` for prose conventions.

---

## Stack

| Layer | Choice |
|---|---|
| Site framework | Astro 4.x, `output: 'static'` |
| 3D / shaders | Three.js `0.169.0` via CDN importmap |
| Shader language | GLSL ES 1.00 (WebGL 1) |
| Fonts | `Sora` (body/labels) + `Google Sans Code` (code/signatures) via Google Fonts |
| Math rendering | KaTeX via CDN |

---

## Directory layout

```
/
├── src/
│   ├── pages/                  ← Astro pages (.astro, .mdx)
│   │   └── sketches/           ← sketch pages (dev-only, not built to prod)
│   ├── layouts/
│   │   └── PageLayout.astro    ← shared shell: sidebar nav, fonts, iframe embed logic
│   └── content/pages/          ← MDX content collection (production pages)
│
├── public/
│   ├── demos/                  ← production demo pages
│   │   └── <name>/
│   │       ├── index.html
│   │       ├── main.js
│   │       └── shaders/
│   │           ├── vertex.glsl
│   │           ├── fragment.glsl
│   │           └── sdf-functions.glsl   ← per-demo reusable SDF helpers
│   ├── sketches/               ← in-progress demos (excluded from production build)
│   │   └── <name>/<demo>/
│   ├── shaders/                ← shared GLSL libraries (included via fetch)
│   │   ├── lighting.glsl
│   │   ├── sdf-functions.glsl
│   │   ├── sdf-marcher.glsl
│   │   └── …
│   └── sound/                  ← pre-computed audio analysis data (.bin) + MP3s
│
├── CLAUDE.md                   ← agent instructions
├── documentation.md            ← this file
└── writing-style-guide.md
```

Demo folder names are **kebab-case only** — no numeric prefix. Keep folder names in sync with display names; rename the folder when a demo is renamed.

---

## Demo architecture

### Canvas and resolution

Every demo uses a **1920 × 1080** canvas at full screen. When embedded in a page as an iframe the canvas is resized to **960 × 540** (same 16:9 ratio). An inline script in `index.html` handles this before `main.js` runs, by checking `?embedded` in the URL:

```html
<script>
  if (new URLSearchParams(location.search).has('embedded')) {
    const canvas = document.getElementById('canvas');
    canvas.width = 960; canvas.height = 540;
    // …also resize .canvas-wrap
  }
</script>
```

`main.js` reads `canvas.width` / `canvas.height` after the fact and gets the correct size automatically — no CSS transform scaling, no 2× overlay mismatch.

### Three.js shader quad (raymarching demos)

Shader demos render a full-screen `PlaneGeometry(2, 2)` with a `ShaderMaterial`. The renderer must disable its own colour correction:

```js
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
```

Gamma (`pow(col, vec3(0.4545))`) is applied manually at the end of `main()` in the fragment shader.

### Shader file loading

Shader files are fetched at runtime and concatenated before passing to Three.js. The fragment shader may contain these placeholders, which `main.js` replaces with fetched source:

| Placeholder | Replaced with |
|---|---|
| `// INCLUDE_SDF_FUNCTIONS` | `./shaders/sdf-functions.glsl` |
| `// INCLUDE_LIGHTING` | `../../shaders/lighting.glsl` |

The shared `lighting.glsl` lives at `public/shaders/` and is fetched as a relative path two levels up from the demo folder.

---

## GLSL coordinate system

All fragment shaders use **aspect-correct normalised coordinates**:

```glsl
vec2 uv = (gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y;
```

- `y` spans −1.0 to +1.0
- `x` spans −aspect to +aspect (±1.778 for 16:9)
- The same normalised value for any given screen position at both 960×540 and 1920×1080 — no resolution-dependent math needed.

Camera focal length for raymarching must be **3.0** with this system (it was 1.5 when y ∈ [−0.5, 0.5]).

**4-sample SSAA** offsets ±0.25 px:

```glsl
vec2 uv = ((gl_FragCoord.xy + offset) * 2.0 - iResolution.xy) / iResolution.y;
```

### GLSL rules

- `half` is a reserved word — use `hsize`, `hw`, etc.
- Always forward-declare `float sceneSDF(vec3 p);` before `calcNormal` in the fragment shader.
- Reusable SDF primitives live in `shaders/sdf-functions.glsl`; keep `fragment.glsl` lean.
- `sdf-functions.glsl` must define `dot2(vec2)` and `dot2(vec3)` helpers at the top.
- SDF shape indices in `sceneSDF` start at **1** (not 0); `main.js` adds `+ 1` when assigning `u_shapeIndex`.

---

## Rendering style

All raymarching demos use the same **white/grey studio look** via the shared `public/shaders/lighting.glsl`, which exposes:

```glsl
vec3 stdLighting(vec3 pos, vec3 nor, vec3 rd);
```

Call it on every surface hit. Lighting parameters:

| Element | Value |
|---|---|
| Material colour | `vec3(0.88)` |
| Ambient | `0.13` |
| Key light direction | `normalize(vec3(0.6, 1.0, 0.7))` |
| Key diffuse coefficient | `0.84` |
| Fill light direction | `normalize(vec3(-0.8, 0.3, 0.5))` |
| Fill diffuse coefficient | `0.28` |
| Specular colour | `vec3(0.40)` |
| Specular power | `72` |
| Fresnel rim | `vec3(0.12, 0.18, 0.38) × 0.6`, power `4` |
| Gamma correction | `pow(max(col, 0.0), vec3(0.4545))` in `main()` |

Background is `vec3(0.0)` (black). The authoritative values live in `public/shaders/lighting.glsl` — edit there to change all demos at once.

---

## UI conventions

### HTML structure

```html
<div class="canvas-wrap">      <!-- position: relative wrapper -->
  <canvas id="canvas"></canvas>
  <div id="overlay"></div>     <!-- position: absolute, inset: 0; pointer-events: none -->
  <button id="play-btn"></button>
  <button id="aa-btn" class="active">Antialias</button>
</div>
```

All overlay text and labels go inside `#overlay`. Controls (`play-btn`, `aa-btn`) are siblings of `#overlay` inside `.canvas-wrap`.

### Play / Pause button

Sits in the top-right corner of the canvas (`top: 32px; right: 32px`), 48 × 48 px circle.

```js
const PLAY_ICON  = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><polygon points="1,0 10,6 1,12"/></svg>';
const PAUSE_ICON = '<svg viewBox="0 0 10 12" fill="currentColor" width="14" height="14"><rect x="0" y="0" width="3.5" height="12"/><rect x="6.5" y="0" width="3.5" height="12"/></svg>';
```

Elapsed time pattern:
- `play()`: record `startTime = performance.now()`, launch `requestAnimationFrame` loop.
- `pause()`: accumulate `pausedAt += (now - startTime) * 0.001`, cancel the rAF.
- Inside the frame: `const t = pausedAt + (now - startTime) * 0.001`.

**All demos start paused.** No demo may run (advance time, update uniforms, or animate) without explicit user interaction. The only permitted work before a play click is:

1. **Drawing a single initial frame** — call `renderer.render(scene, cam)` once at the end of `init()`, after all shaders and data are ready, so the embed looks like a poster frame rather than a black box.
2. **Async asset loading** — fetching shaders, audio `.bin` data files, and audio MP3s in the background is allowed; it must not trigger animation.

The `requestAnimationFrame` loop must **not** be started at init. `play()` starts it; `pause()` cancels it with `cancelAnimationFrame(rafId)`. The frame function must never self-perpetuate when paused — either use the pattern `rafId = requestAnimationFrame(frame)` at the top of the frame body (so `cancelAnimationFrame` in `pause()` stops the next tick), or bail early and set `rafId = null`.

The previous rule ("Animation demos start playing") is **removed**. All demos start paused, showing a play icon.

### SSAA toggle

Sits left of the play button (`top: 32px; right: 96px`), pill-shaped. Default: **on** (`class="active"`). Each fragment shader declares `uniform int u_ssaa;`. When off, the shader skips the 4-sample loop and renders one centre sample.

### Labels

- Font: `Sora` 12 px for names, `Google Sans Code` for function signatures
- Position: bottom-left inside `#overlay` (`left: 56px; bottom: 56px`)
- Colour: `#ffffff`

---

## Audio rule: pre-computed data only

**All demos must drive audio-reactive visuals from the pre-computed `.bin` files. Real-time audio processing is forbidden.**

Never use `AudioContext`, `AnalyserNode`, `createAnalyser()`, `getByteFrequencyData()`, `getByteTimeDomainData()`, or any Web Audio API for analysis. These produce different results across browsers, add latency, and make the visuals non-deterministic.

The correct pattern:
- Play audio with `new Audio(url)` (HTMLAudioElement) — no AudioContext.
- Drive the current frame index from `Math.floor(audio.currentTime * FPS)`.
- Look up FFT and amplitude values from the pre-loaded frame array.

The `.bin` files already contain everything needed: per-frame RMS amplitude (L + R) and 128 Mel-band magnitudes. Raw waveform data is not available; modes that require a waveform signal should approximate from amplitude or be redesigned.

---

## Sound data format

Pre-computed audio analysis lives in `public/sound/`. Each `.bin` file is raw little-endian `float32` — no header, no parsing overhead. Each frame is 258 × 4 = 1032 bytes. Column layout within a frame:

```
offset 0        = L-channel RMS amplitude (0–1)
offset 1        = R-channel RMS amplitude (0–1)
offset 2..129   = L-channel Mel bands (128 bins, 20–6848 Hz, linear amplitude)
offset 130..257 = R-channel Mel bands (128 bins, 20–6848 Hz, linear amplitude)
```

60 fps. L and R channels share the same global normalisation so their magnitudes are directly comparable. Mel values are linear amplitude (not dB); apply `20 * log10(max(v, 1e-5))` at runtime if you need a perceptual scale.

Load and parse with `parseBinary`:

```js
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
// Usage: frames = parseBinary(await fetch(url).then(r => r.arrayBuffer()));
```

`fftL` is a zero-copy `Float32Array` view into the original buffer — do not hold references across track switches.

Frame index from `audio.currentTime`:

```js
const frameIndex = Math.floor(audio.currentTime * 60);
```

Sound files are referenced with a relative path from the demo directory. From `public/sketches/<name>/<demo>/`:

```js
const SOUND_BASE = '../../../sound/';
```

### Track set — `250621_a1_mix1`

Eight stems from the track *Musical Architecture* by Yaporigami (~4 min each):

| Stem suffix | Label | Full frames |
|---|---|---|
| `_master_88.2k24` | Master | 14 437 |
| `_arp` | Arp | 14 422 |
| `_bass` | Bass | 14 422 |
| `_hat` | Hat | 14 422 |
| `_kick1` | Kick 1 | 14 422 |
| `_kick2` | Kick 2 | 14 422 |
| `_pad` | Pad | 14 422 |
| `_snare` | Snare | 14 422 |

### File layout in `public/sound/`

Files are organised into subdirectories by variant. Each stem appears under every folder with the same base filename — the folder name conveys what it is.

```
public/sound/
├── full/           {base}.bin / .mp3 / .png / _L.png / _R.png   — full ~4-min track
├── highlights/     {base}.bin / .mp3 / .png / _L.png / _R.png   — best 60-s window
├── 0_00_1_00/      {base}.bin / .mp3 / .png / _L.png / _R.png   — 0:00–1:00
├── 1_00_2_00/      {base}.bin / .mp3 / .png / _L.png / _R.png   — 1:00–2:00
├── 2_00_3_00/      {base}.bin / .mp3 / .png / _L.png / _R.png   — 2:00–3:00
└── 3_00_4_00/      {base}.bin / .mp3 / .png / _L.png / _R.png   — 3:00–4:00
```

Demos that visualise short loops (warp, ridge, sound-wave, sound-analysis, sound-fill, all sketch demos) point to `highlights/`. The multitrack visualiser points to `full/` so it can show the complete track with seek.

### How the data files are produced

**Original WAVs and full-length analysis** live in `sound/original/` and are not committed to the repo (too large). Each WAV was analysed once with `public/sound/process_audio.py`, which uses [librosa](https://librosa.org) to compute per-frame RMS amplitude and 128-bin Mel-band magnitudes, writing intermediate `.txt` files:

```
python3 public/sound/process_audio.py
# place WAV files in public/sound/ first; writes .txt + spectrogram .png beside each WAV
```

The resulting `.txt` files in `sound/original/` are the authoritative source for all downstream variants. They are not used at runtime — only as input to the pipeline scripts below.

**Generating `full/` and segment folders** — run `sound/generate_audio.py` once the originals are in place:

```
python3 sound/generate_audio.py
```

This script reads from `sound/original/`, writes `.bin` files to `public/sound/full/` and the four `public/sound/<seg>/` folders, and regenerates spectrogram PNGs for every output. It is safe to re-run — it overwrites outputs in place.

**Generating `highlights/`** — produced by `sound/trim_audio.py`, which finds the densest 60-second window per stem (highest average amplitude) and writes `.bin` files to `public/sound/highlights/`. Re-run to refresh highlight crops:

```
python3 sound/trim_audio.py
```

Dependencies for all three scripts: `numpy`, `Pillow`, `librosa` (process_audio.py only), and `ffmpeg` on `PATH`.

---

## Sketch system

A **sketch** is experimental or in-progress work. Sketches are visible in local development but excluded from the GitHub Pages build.

| Asset | Location |
|---|---|
| Astro page | `src/pages/sketches/<name>.astro` |
| Demo assets | `public/sketches/<name>/<demo>/` |

Nav entries for sketches go in the `sketchItems` array in `PageLayout.astro`, guarded by `import.meta.env.DEV`. The production build script (`npm run build:prod`) deletes `dist/sketches/` after `astro build`, so sketch pages never reach GitHub Pages.

---

## Page navigation

Every new Astro page must be added to the `navItems` array in `src/layouts/PageLayout.astro`. Optional per-page sub-links (anchor links within a page) go in the conditional block that follows `navItems.map(...)`, keyed by `slug`.

---

## Math in MDX

KaTeX is loaded from CDN. Delimiters: inline `\( … \)`, block `\[ … \]`.

In `.mdx` files, remark strips bare backslash-punctuation sequences. Write delimiters as JSX expressions:

```jsx
{"\\("} x^2 {"\\)"}
```

Curly braces inside LaTeX use HTML entities: `&#123;` and `&#125;`.
