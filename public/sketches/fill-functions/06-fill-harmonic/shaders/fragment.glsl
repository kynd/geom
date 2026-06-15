precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_mode;
uniform int   u_ssaa;

uniform sampler2D u_fftTex;
uniform sampler2D u_specTex;
uniform sampler2D u_waveTex;
uniform sampler2D u_envTex;

uniform float u_histHead;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_amp;

const float PI = 3.14159265359;

// ── Audio helpers ─────────────────────────────────────────────────────────────

float sampleFFT(float freq) {
  return texture2D(u_fftTex, vec2(clamp(freq, 0.001, 0.999), 0.5)).r;
}

float sampleSpec(float freq, float ageFrames) {
  float y = fract(u_histHead - (ageFrames + 1.0) / 256.0 + 2.0);
  return texture2D(u_specTex, vec2(clamp(freq, 0.001, 0.999), y)).r;
}

float sampleWave(float t) {
  return texture2D(u_waveTex, vec2(clamp(t, 0.001, 0.999), 0.5)).r * 2.0 - 1.0;
}

// ── OKLCH ────────────────────────────────────────────────────────────────────

vec3 oklabToLinearRGB(float L, float a, float b) {
  float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  float s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  float l  = l_ * l_ * l_;
  float m  = m_ * m_ * m_;
  float s  = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

bool inGamut(vec3 rgb) {
  return all(greaterThanEqual(rgb, vec3(-0.001))) &&
         all(lessThanEqual(rgb,    vec3( 1.001)));
}

float maxChroma(float L, float H) {
  float lo = 0.0, hi = 0.5;
  for (int i = 0; i < 20; i++) {
    float mid = (lo + hi) * 0.5;
    if (inGamut(oklabToLinearRGB(L, mid*cos(H), mid*sin(H)))) lo = mid;
    else hi = mid;
  }
  return lo;
}

vec3 lch(float L, float C, float H) {
  return clamp(oklabToLinearRGB(L, C*cos(H), C*sin(H)), 0.0, 1.0);
}

// ── Mode 0 — Spectrogram ──────────────────────────────────────────────────────
// Frequency on x, time scrolling downward. Full hue wheel bass→treble.
vec3 mode0(vec2 nUV) {
  float freq = nUV.x;
  float age  = (1.0 - nUV.y) * 255.0;
  float mag  = sampleSpec(freq, age);
  float H    = freq * 2.0 * PI;
  float L    = 0.08 + 0.72 * mag;
  float C    = maxChroma(L, H) * 0.92 * mag;
  return lch(L, C, H);
}

// ── Mode 1 — Phase portrait ───────────────────────────────────────────────────
// w(t) vs w(t+τ) for 32 samples; Gaussian density reveals trajectory.
vec3 mode1(vec2 uv) {
  float density = 0.0;
  float hueSum  = 0.0;
  for (int i = 0; i < 32; i++) {
    float t  = float(i) / 31.0;
    float w0 = sampleWave(t);
    float w1 = sampleWave(t + 0.08);
    vec2  pt = vec2(w0, w1) * 0.85;
    float dx = uv.x - pt.x;
    float dy = uv.y - pt.y;
    float g  = exp(-(dx*dx + dy*dy) * 60.0);
    density += g;
    hueSum  += g * t;
  }
  density = min(density * 0.7, 1.0);
  if (density < 0.002) return vec3(0.0);
  float H = hueSum / max(density * 32.0, 1e-6) * 2.0 * PI;
  H = mix(H, u_bass * PI * 0.5, 0.3);
  float L = 0.12 + 0.68 * density;
  return lch(L, maxChroma(L, H) * density * 0.9, H);
}

// ── Mode 2 — Wave · anisotropic ───────────────────────────────────────────────
// 12 plane waves; x compressed 0.4×. Pixel x sweeps hue left-to-right.
vec3 mode2(vec2 uv) {
  vec2  uvS = vec2(uv.x * 0.4, uv.y);
  float I   = 0.0;
  for (int k = 0; k < 12; k++) {
    float freq = (float(k) + 0.5) / 12.0;
    float amp  = sampleFFT(freq);
    float ang  = 2.0 * PI * float(k) / 12.0;
    float sf   = 2.0 + amp * 6.5;
    I += amp * cos(dot(vec2(cos(ang), sin(ang)), uvS) * sf + iTime * (0.35 + amp));
  }
  I /= 12.0;
  float H = mod(uv.x * 0.8 + I * PI + iTime * 0.1, 2.0 * PI);
  float L = 0.20 + 0.58 * (0.5 + 0.5 * I);
  return lch(L, maxChroma(L, H) * 0.9, H);
}

// ── Mode 3 — Crystal · drift ──────────────────────────────────────────────────
// 7 waves each drifting at a different rate; cos(I·3π) sharpens into bands.
vec3 mode3(vec2 uv) {
  float I = 0.0, H = 0.0;
  for (int k = 0; k < 7; k++) {
    float fk    = (float(k) + 0.5) / 7.0;
    float amp   = sampleFFT(fk);
    float ang   = 2.0 * PI * float(k) / 7.0;
    float sf    = 1.8 + amp * 5.5;
    float drift = float(k + 1) * 0.73 * iTime;
    float wave  = amp * cos(dot(vec2(cos(ang), sin(ang)), uv) * sf + drift);
    I += wave;
    H += abs(wave) * fk;
  }
  I /= 7.0;
  float I2 = 0.5 + 0.5 * cos(I * 3.0 * PI);
  H = mod(H * 2.0 * PI + iTime * 0.25, 2.0 * PI);
  float L = 0.18 + 0.62 * I2;
  return lch(L, maxChroma(L, H) * 0.9 * I2, H);
}

// ── Mode 4 — Radial spectrum ──────────────────────────────────────────────────
// 24 FFT bins as concentric glowing rings; radius encodes frequency.
vec3 mode4(vec2 uv) {
  float r      = length(uv);
  float theta  = atan(uv.y, uv.x);
  float bright = 0.0;
  for (int k = 0; k < 24; k++) {
    float freq    = (float(k) + 0.5) / 24.0;
    float amp     = sampleFFT(freq);
    float targetR = 0.08 + freq * 0.88;
    float d       = (r - targetR) / 0.018;
    bright += amp * exp(-d * d);
  }
  bright = clamp(bright, 0.0, 1.0);
  if (bright < 0.002) return vec3(0.0);
  float H = mod(r * 1.5 * PI + theta * 0.15 + iTime * 0.08, 2.0 * PI);
  float L = 0.08 + 0.72 * bright;
  return lch(L, maxChroma(L, H) * bright * 0.92, H);
}

// ── Mode 5 — Waveform ring ────────────────────────────────────────────────────
// Waveform as polar curve r(θ) = 0.55 + wave(θ/2π)·0.3; Gaussian glow.
vec3 mode5(vec2 uv) {
  float r     = length(uv);
  float theta = atan(uv.y, uv.x);
  float t     = mod(theta / (2.0 * PI) + 1.0, 1.0);
  float wav   = sampleWave(t);
  float ringR = 0.55 + wav * 0.30;
  float d     = r - ringR;
  float glow  = exp(-d * d * 500.0) * (0.6 + 0.4 * abs(wav));
  float bright = clamp(glow, 0.0, 1.0);
  if (bright < 0.002) return vec3(0.0);
  float H = mod(theta + PI + iTime * 0.08, 2.0 * PI);
  float L = 0.10 + 0.70 * bright;
  return lch(L, maxChroma(L, H) * bright * 0.90, H);
}

// ── Mode 6 — Cosine product ───────────────────────────────────────────────────
// cos(x·fx)·cos(y·fy); bass and treble drive the two spatial frequencies.
vec3 mode6(vec2 uv) {
  float fx = (2.0 + u_bass   * 7.0) * PI;
  float fy = (2.0 + u_treble * 7.0) * PI;
  float cx = cos(uv.x * fx + iTime * 0.30);
  float cy = cos(uv.y * fy + iTime * 0.38);
  float I  = cx * cy;
  float v  = 0.5 + 0.5 * I;
  float H  = mod(atan(uv.y, uv.x) + PI + iTime * 0.10, 2.0 * PI);
  float L  = 0.10 + 0.72 * v;
  return lch(L, maxChroma(L, H) * v * 0.90, H);
}

// ── Mode 7 — Polar harmonics ──────────────────────────────────────────────────
// Σ fft[k]·cos(θ·(k+2)); bass activates wide petals, treble fine structure.
vec3 mode7(vec2 uv) {
  float r     = length(uv);
  float theta = atan(uv.y, uv.x);
  float I     = 0.0;
  for (int k = 0; k < 12; k++) {
    float freq = (float(k) + 0.5) / 12.0;
    float amp  = sampleFFT(freq);
    float n    = float(k + 2);
    I += amp * cos(theta * n + iTime * (0.08 + freq * 0.15));
  }
  I /= 12.0;
  float v  = I * 0.5 + 0.5;
  float H  = mod(theta + PI + r * PI + iTime * 0.10, 2.0 * PI);
  float L  = 0.08 + 0.72 * v;
  return lch(L, maxChroma(L, H) * v * 0.92, H);
}

// ── Mode 8 — Phase modulation ─────────────────────────────────────────────────
// Radial cosine phase-shifted by live waveform at each angle, bending rings.
vec3 mode8(vec2 uv) {
  float r     = length(uv);
  float theta = atan(uv.y, uv.x);
  float t     = mod(theta / (2.0 * PI) + 1.0, 1.0);
  float wav   = sampleWave(t);
  float f     = (3.0 + u_bass * 6.0 + u_treble * 3.0) * PI;
  float A     = 0.5 + u_amp * 1.2;
  float phase = r * f + wav * A * PI;
  float I     = 0.5 + 0.5 * cos(phase);
  float H     = mod(theta + PI + r * 0.5 * PI + iTime * 0.12, 2.0 * PI);
  float L     = 0.10 + 0.68 * I;
  return lch(L, maxChroma(L, H) * I * 0.92, H);
}

// ── Mode 9 — Circular spectrogram ─────────────────────────────────────────────
// Angle = frequency; radius = time (edge = now, centre = oldest).
vec3 mode9(vec2 uv) {
  float r     = clamp(length(uv), 0.001, 1.0);
  float theta = mod(atan(uv.y, uv.x) + 2.0 * PI, 2.0 * PI);
  float freq  = theta / (2.0 * PI);
  float age   = (1.0 - r) * 255.0;
  float mag   = sampleSpec(freq, age);
  float H     = theta;
  float L     = 0.08 + 0.72 * mag;
  float C     = maxChroma(L, H) * 0.92 * mag;
  return lch(L, C, H);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

vec3 fill(vec2 uv, vec2 nUV) {
  if (u_mode == 0) return mode0(nUV);
  if (u_mode == 1) return mode1(uv);
  if (u_mode == 2) return mode2(uv);
  if (u_mode == 3) return mode3(uv);
  if (u_mode == 4) return mode4(uv);
  if (u_mode == 5) return mode5(uv);
  if (u_mode == 6) return mode6(uv);
  if (u_mode == 7) return mode7(uv);
  if (u_mode == 8) return mode8(uv);
  return mode9(uv);
}

vec2 toUV(vec2 fc)   { return (fc * 2.0 - iResolution.xy) / iResolution.y; }
vec2 toNorm(vec2 fc) { return fc / iResolution.xy; }

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = fill(toUV(gl_FragCoord.xy + vec2(-0.25,-0.25)), toNorm(gl_FragCoord.xy + vec2(-0.25,-0.25)));
    col += fill(toUV(gl_FragCoord.xy + vec2( 0.25,-0.25)), toNorm(gl_FragCoord.xy + vec2( 0.25,-0.25)));
    col += fill(toUV(gl_FragCoord.xy + vec2(-0.25, 0.25)), toNorm(gl_FragCoord.xy + vec2(-0.25, 0.25)));
    col += fill(toUV(gl_FragCoord.xy + vec2( 0.25, 0.25)), toNorm(gl_FragCoord.xy + vec2( 0.25, 0.25)));
    col *= 0.25;
  } else {
    col = fill(toUV(gl_FragCoord.xy), toNorm(gl_FragCoord.xy));
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
