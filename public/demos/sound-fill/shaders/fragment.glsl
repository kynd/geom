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

vec2 sampleSpecLR(float freq, float ageFrames) {
  float y = fract(u_histHead - (ageFrames + 1.0) / 256.0 + 2.0);
  vec4  s = texture2D(u_specTex, vec2(clamp(freq, 0.001, 0.999), y));
  return s.rg;
}

vec4 sampleEnv(float ageFrames) {
  float y = fract(u_histHead - (ageFrames + 1.0) / 256.0 + 2.0);
  return texture2D(u_envTex, vec2(0.5, y));
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

vec3 oklch(float L, float C, float H) {
  return clamp(oklabToLinearRGB(L, C*cos(H), C*sin(H)), 0.0, 1.0);
}

// ── Mode 0 — Spectrogram ──────────────────────────────────────────────────────
// Frequency on x, time scrolling upward. Bass warm red, treble cool cyan.
vec3 mode0(vec2 nUV) {
  float age = nUV.y * 255.0;
  float mag = sampleSpec(nUV.x, age);
  float H   = 0.3 + nUV.x * 2.9;
  float L   = 0.72 * pow(mag, 0.55);
  float C   = maxChroma(L, H) * mag * 0.9;
  return oklch(L, C, H);
}

// ── Mode 1 — Wave · anisotropic ───────────────────────────────────────────────
// 12 plane waves; x compressed 0.4×. Pixel x-position sweeps hue left-to-right.
vec3 mode1(vec2 uv) {
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
  return oklch(L, maxChroma(L, H) * 0.9, H);
}

// ── Mode 2 — Phase portrait ───────────────────────────────────────────────────
// Four lag values (±0.07, ±0.18) spread trajectory across all orientations.
vec3 mode2(vec2 uv) {
  float density = 0.0;
  float hueSum  = 0.0;
  for (int i = 0; i < 32; i++) {
    float t  = 0.2 + float(i) / 31.0 * 0.6;
    int   gi = int(mod(float(i), 4.0));
    float lag;
    if      (gi == 0) lag =  0.07;
    else if (gi == 1) lag = -0.07;
    else if (gi == 2) lag =  0.18;
    else              lag = -0.18;

    float w0 = sampleWave(t);
    float w1 = sampleWave(fract(t + lag + 1.0));
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
  return oklch(L, maxChroma(L, H) * density * 0.9, H);
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
  return oklch(L, maxChroma(L, H) * 0.9 * I2, H);
}

// ── Mode 4 — Circular spectrogram · hemispheres ──────────────────────────────
// Latitude encodes frequency/L-R; longitude from centre encodes time.
// Centre meridian = newest frame; left/right edges = oldest history.
vec3 mode4(vec2 nUV) {
  float theta = nUV.y * 2.0 * PI;
  float r     = abs(nUV.x - 0.5) * 2.0;   // 0=centre(newest), 1=edges(oldest)
  float age   = r * 255.0;
  float freq  = theta < PI ? theta / PI : (2.0 * PI - theta) / PI;
  vec2  lr    = sampleSpecLR(freq, age);
  float mag   = theta < PI ? lr.x : lr.y;
  if (mag < 0.005) return vec3(0.0);
  float H = mod(theta + iTime * PI * 0.2, 2.0 * PI);
  float L = 0.08 + 0.72 * mag;
  float C = maxChroma(L, H) * 0.92 * mag;
  return oklch(L, C, H);
}

// ── Mode 5 — Radial spectrum · hue · hemispheres ─────────────────────────────
// 128 FFT bins as meridian bands mirrored left/right. Bass at centre, treble at edges.
vec3 mode5(vec2 nUV) {
  float rLon = abs(nUV.x - 0.5) * 2.0;   // 0=centre(bass), 1=edges(treble)
  float gSum = 0.0, hAcc = 0.0;
  for (int k = 0; k < 128; k++) {
    float freq    = (float(k) + 0.5) / 128.0;
    float amp     = sampleFFT(freq);
    float targetR = freq;
    float d       = (rLon - targetR) / 0.004;
    float g       = exp(-d * d);
    gSum += g;
    hAcc += g * mix(4.5, 0.8, pow(amp, 0.4));
  }
  if (gSum < 0.002) return vec3(0.0);
  float H = mod(hAcc / gSum + iTime * PI * 0.2, 2.0 * PI);
  float L = 0.40;
  float C = maxChroma(L, H) * 0.90;
  return oklch(L, C, H);
}

// ── Mode 6 — Radial spectrum · hue + L · hemispheres ─────────────────────────
// 128 FFT bins as meridian bands mirrored left/right; hue and lightness encode amplitude.
vec3 mode6(vec2 nUV) {
  float rLon = abs(nUV.x - 0.5) * 2.0;
  float gSum = 0.0, hAcc = 0.0, ampAcc = 0.0;
  for (int k = 0; k < 128; k++) {
    float freq    = (float(k) + 0.5) / 128.0;
    float amp     = sampleFFT(freq);
    float targetR = freq;
    float d       = (rLon - targetR) / 0.004;
    float g       = exp(-d * d);
    gSum   += g;
    hAcc   += g * mix(4.5, 0.8, pow(amp, 0.4));
    ampAcc += g * amp;
  }
  if (gSum < 0.002) return vec3(0.0);
  float avgAmp = ampAcc / gSum;
  float H = mod(hAcc / gSum + iTime * PI * 0.2, 2.0 * PI);
  float L = 0.05 + 0.82 * pow(avgAmp, 0.5);
  float C = maxChroma(L, H) * 0.92;
  return oklch(L, C, H);
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

vec2 toUV(vec2 fc)   { return (fc * 2.0 - iResolution.xy) / iResolution.y; }
vec2 toNorm(vec2 fc) { return fc / iResolution.xy; }

vec3 fill(vec2 uv, vec2 nUV) {
  if (u_mode == 0) return mode1(uv);
  if (u_mode == 1) return mode2(uv);
  if (u_mode == 2) return mode3(uv);
  if (u_mode == 3) return mode0(nUV);
  if (u_mode == 4) return mode4(nUV);
  if (u_mode == 5) return mode5(nUV);
  return mode6(nUV);
}

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
  float presence = smoothstep(0.0, 0.025, u_amp);
  col = pow(max(col, 0.0), vec3(0.4545)) * presence;
  gl_FragColor = vec4(col, 1.0);
}
