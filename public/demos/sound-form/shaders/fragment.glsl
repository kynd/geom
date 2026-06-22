precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform float     u_ampL;
uniform float     u_ampR;
uniform float     u_ampMono;
uniform int       u_ssaa;
uniform int       u_lighting;
uniform int       u_mode;
uniform float     u_intensity;
uniform sampler2D u_histTex;
uniform sampler2D u_fftTex;
uniform sampler2D u_specTex;
uniform float     u_histHead;
uniform sampler2D u_envMap;
uniform float     u_rimPow;
uniform float     u_base;
uniform float     u_sssDensity;
uniform float     u_sssStr;
uniform sampler2D u_fillTex;
uniform float     u_envScale;

// INCLUDE_RIM_LIGHTING

const float PI        = 3.14159265359;
const int   MAX_STEPS = 128;
const float MAX_DIST  = 5.0;
const float SURF_DIST = 0.002;

float sampleFFT(float u) {
  return texture2D(u_fftTex, vec2(clamp(u, 0.01, 0.99), 0.5)).r;
}
float sampleFFTR(float u) {
  return texture2D(u_fftTex, vec2(clamp(u, 0.01, 0.99), 0.5)).g;
}
float sampleHist(float v) {
  return texture2D(u_histTex, vec2(0.5, clamp(v, 0.01, 0.99))).r;
}
float sampleHistR(float v) {
  return texture2D(u_histTex, vec2(0.5, clamp(v, 0.01, 0.99))).g;
}
float sampleHistMono(float v) {
  return texture2D(u_histTex, vec2(0.5, clamp(v, 0.01, 0.99))).b;
}
float sampleSpec(float freq, float ageFrames) {
  float y = fract(u_histHead - (ageFrames + 1.0) / 256.0 + 2.0);
  return texture2D(u_specTex, vec2(clamp(freq, 0.01, 0.99), y)).r;
}

vec3 sampleEnvMap(vec3 dir) {
  float u = atan(dir.z, dir.x) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return texture2D(u_envMap, vec2(u, v)).rgb;
}

vec3 sampleFillMap(vec3 dir) {
  float u  = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v  = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  vec2  uv = (vec2(u, v) - 0.5) / u_envScale + 0.5;
  float uf = fract(uv.x);
  uv.x = uf < 0.5 ? uf * 2.0 : (1.0 - uf) * 2.0;
  uv.y = clamp(uv.y, 0.0, 1.0);
  vec3  c  = texture2D(u_fillTex, uv).rgb;
  return c * c;
}

vec3 flashLight(vec3 nor, vec3 rd) {
  vec3  mat = vec3(0.88);
  float a1  = iTime * 3.5;
  vec3  ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3  h1  = normalize(ld1 - rd);
  vec3  c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.45) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.45;
  float a2  = iTime * 2.1 + 1.9;
  vec3  ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3  h2  = normalize(ld2 - rd);
  vec3  c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.45) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.45;
  return c1 * max(u_ampL * u_ampL, 0.015) + c2 * (u_ampR * u_ampR);
}

vec3 envLight(vec3 nor, vec3 rd, float thickness) {
  vec3  mat = sampleEnvMap(nor);
  float a1  = iTime * 3.5;
  vec3  ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3  h1  = normalize(ld1 - rd);
  vec3  c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.35;
  float a2  = iTime * 2.1 + 1.9;
  vec3  ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3  h2  = normalize(ld2 - rd);
  vec3  c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.35;
  float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
  float amp = max(aL2, 0.015) + aR2;
  vec3  lit = c1 * max(aL2, 0.015) + c2 * aR2;
  lit += mat * exp(-thickness * u_sssDensity) * u_sssStr * amp;
  return lit;
}

vec3 fillLight(vec3 nor, vec3 rd, float thickness) {
  vec3  mat = sampleFillMap(nor);
  float a1  = iTime * 3.5;
  vec3  ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3  h1  = normalize(ld1 - rd);
  vec3  c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.35;
  float a2  = iTime * 2.1 + 1.9;
  vec3  ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3  h2  = normalize(ld2 - rd);
  vec3  c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.35;
  float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
  float amp = max(aL2, 0.015) + aR2;
  vec3  lit = c1 * max(aL2, 0.015) + c2 * aR2;
  lit += mat * exp(-thickness * u_sssDensity) * u_sssStr * amp;
  return lit;
}

// ── Mode 1: Spectral fan ─────────────────────────────────────────────────────
// Shorter cylinder; gentle X-axis swing periodically reveals the top/bottom caps.
float spectralFanSDF(vec3 p) {
  float tilt = sin(iTime * 0.35) * 0.22;
  float ct = cos(tilt), st = sin(tilt);
  vec3  q  = vec3(p.x, ct * p.y - st * p.z, st * p.y + ct * p.z);
  float phi  = atan(q.z, q.x) / (2.0 * PI) + 0.5;
  float fft  = sampleFFT(phi);
  float r    = 0.28 + 0.55 * fft * u_intensity;
  float dCyl = (length(q.xz) - r) / 2.0;
  float dH   = abs(q.y) - 0.52;
  return max(dCyl, dH);
}

// ── Mode 2: Interference rings ───────────────────────────────────────────────
float interferenceRingsSDF(vec3 p) {
  float field = 0.0;
  float lip   = 0.01;
  for (int i = 0; i < 8; i++) {
    float fi    = float(i);
    float u     = (fi + 0.5) / 8.0;
    float amp   = 0.10 + sampleFFT(u) * u_intensity * 0.45;
    float freq  = (fi + 1.0) * 1.7;
    float angle = fi * 2.39996323;
    float cosT  = 1.0 - 2.0 * (fi + 0.5) / 8.0;
    float sinT  = sqrt(max(1.0 - cosT * cosT, 0.0));
    vec3  dir   = vec3(sinT * cos(angle), cosT, sinT * sin(angle));
    field += amp * cos(freq * dot(p, dir));
    lip   += amp * freq;
  }
  float thresh = 0.25 + 0.65 * u_ampMono * u_intensity;
  return (thresh - field) / lip;
}

// ── Mode 3: Spectrogram cylinder (horizontal) ────────────────────────────────
// Horizontal cylinder along X; X = frequency, azimuth in YZ plane = time.
// Rotates around its own long axis so different time slices sweep past.
float spectrogramCylinderSDF(vec3 p) {
  float a  = iTime * 0.14;
  float ca = cos(a), sa = sin(a);
  vec3  q  = vec3(p.x, ca * p.y - sa * p.z, sa * p.y + ca * p.z);
  float yzLen = length(q.yz);
  float phi   = atan(q.y, q.z) / (2.0 * PI) + 0.5;
  float freq  = clamp((q.x + 1.0) * 0.5, 0.01, 0.99);
  float age   = (1.0 - phi) * 128.0;
  float spec  = sampleSpec(freq, age);
  float r     = 0.22 + 0.68 * spec * u_intensity;
  float dCyl  = (yzLen - r) / 3.0;
  float dH    = abs(q.x) - 1.06;
  return max(dCyl, dH);
}

// ── Mode 4: Spectral tube (dual L / R) ───────────────────────────────────────
// Two vertical tubes side by side: left = L-channel FFT, right = R-channel FFT.
float spectralTubeSDF(vec3 p) {
  float freq = clamp((p.y + 1.0) * 0.5, 0.01, 0.99);
  float rL   = 0.08 + 0.52 * sampleFFT(freq) * u_intensity;
  float rR   = 0.08 + 0.52 * sampleFFTR(freq) * u_intensity;
  float dL   = (length(vec2(p.x + 0.52, p.z)) - rL) / 3.0;
  float dR   = (length(vec2(p.x - 0.52, p.z)) - rR) / 3.0;
  float dH   = abs(p.y) - 1.04;
  return max(min(dL, dR), dH);
}

// ── Mode 5: Waveform sphere (dual L / R) ─────────────────────────────────────
// Two vertical shells: left = L-channel amplitude history, right = R-channel.
float waveformSphereSDF(vec3 p) {
  float v   = clamp((p.y + 1.0) * 0.5, 0.01, 0.99);
  float rL  = 0.08 + 0.62 * sampleHist(v) * u_intensity;
  float rR  = 0.08 + 0.62 * sampleHistR(v) * u_intensity;
  float dL  = (length(vec2(p.x + 0.52, p.z)) - rL) / 3.0;
  float dR  = (length(vec2(p.x - 0.52, p.z)) - rR) / 3.0;
  float dH  = abs(p.y) - 1.04;
  return max(min(dL, dR), dH);
}

// ── Mode 6: Harmonic rings (horizontal) ───────────────────────────────────────
// 7 mel-band tori arranged along X. Rotates around its own long axis.
float harmonicRingsSDF(vec3 p) {
  float a  = iTime * 0.18;
  float ca = cos(a), sa = sin(a);
  vec3  q  = vec3(p.x, ca * p.y - sa * p.z, sa * p.y + ca * p.z);
  float d  = 1e9;
  for (int i = 0; i < 7; i++) {
    float fi  = float(i);
    float u   = (fi + 0.5) / 7.0;
    float R   = 0.15 + 0.65 * sampleFFT(u) * u_intensity;
    float x0  = (fi / 6.0) * 2.0 - 1.0;
    float yzl = length(q.yz) - R;
    d = min(d, length(vec2(yzl, q.x - x0)) - 0.035);
  }
  return d;
}

// ── Mode 7: Spectrogram cone ──────────────────────────────────────────────────
// Tip at +Z toward camera. Wiggles around both Y (±26°) and X (±12°).
float spectrogramConeSDF(vec3 p) {
  float wH = sin(iTime * 0.25) * 0.45;
  float cH = cos(wH), sH = sin(wH);
  vec3  r1 = vec3(cH * p.x + sH * p.z, p.y, -sH * p.x + cH * p.z);
  float wV = sin(iTime * 0.31) * 0.21;
  float cV = cos(wV), sV = sin(wV);
  vec3  q  = vec3(r1.x, cV * r1.y - sV * r1.z, sV * r1.y + cV * r1.z);
  float phi  = atan(q.y, q.x) / (2.0 * PI) + 0.5;
  float zN   = clamp((q.z + 1.0) * 0.5, 0.0, 1.0);
  float age  = (1.0 - zN) * 128.0;
  float spec = sampleSpec(phi, age);
  float r    = (1.0 - zN) * (0.25 + 0.65 * spec * u_intensity);
  float dCyl = (length(q.xy) - r) / 3.0;
  float dH   = abs(q.z) - 1.04;
  return max(dCyl, dH);
}

// ── Mode 8: Spectral terrain ─────────────────────────────────────────────────
// Height map tilted 35° toward camera: X = frequency, Y = time, Z = amplitude.
float spectralTerrainSDF(vec3 p) {
  float cx = 0.8192, sx = 0.5736;
  vec3  q  = vec3(p.x, cx * p.y - sx * p.z, sx * p.y + cx * p.z);
  float freq = clamp(q.x * 0.33 + 0.5, 0.01, 0.99);
  float age  = clamp(0.5 - q.y * 0.55, 0.0, 1.0) * 128.0;
  float spec = sampleSpec(freq, age);
  float h    = -0.3 + spec * u_intensity * 0.8;
  return (q.z - h) / 3.0;
}

// ── Mode 9: Spectral helix ────────────────────────────────────────────────────
// 4-coil helix; constant rotation creates a barber-pole upward-movement illusion.
float spectralHelixSDF(vec3 p) {
  float a  = iTime * 1.5;
  float ca = cos(a), sa = sin(a);
  vec3  q  = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  float d  = 1e9;
  float R  = 0.42;
  for (int k = 0; k < 48; k++) {
    float t   = float(k) / 48.0;
    float ang = t * 8.0 * PI;
    float fft = sampleFFT(t);
    float r   = 0.025 + 0.10 * fft * u_intensity;
    vec3  c   = vec3(R * cos(ang), t * 2.0 - 1.0, R * sin(ang));
    d = min(d, length(q - c) - r);
  }
  return d;
}

// ── Mode 10: Spectral ribbon ─────────────────────────────────────────────────
// Horizontally elongated box; shell thickness = spectral change vs 48 frames ago.
// Slow swing within ±15° so long axis stays readable.
float spectralRibbonSDF(vec3 p) {
  float sw = sin(iTime * 0.20) * 0.26;
  float cs = cos(sw), ss = sin(sw);
  vec3  p2 = vec3(cs * p.x + ss * p.z, p.y, -ss * p.x + cs * p.z);
  float freq   = clamp(p2.x * 0.33 + 0.5, 0.01, 0.99);
  float fNow   = sampleFFT(freq);
  float fOld   = sampleSpec(freq, 48.0);
  float rOuter = 0.03 + max(fNow, fOld) * 0.30 * u_intensity;
  float rInner = 0.03 + min(fNow, fOld) * 0.30 * u_intensity;
  vec3  q      = abs(p2) - vec3(1.1, 0.28, 0.28);
  float dBox   = length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
  return max(dBox - rOuter, rInner - dBox) / 2.5;
}

float sceneSDF(vec3 p);

float sceneSDF(vec3 p) {
  float a  = iTime * 0.22;
  float ca = cos(a), sa = sin(a);
  vec3  rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  if (u_mode == 1)  return spectralFanSDF(rp);
  if (u_mode == 2)  return interferenceRingsSDF(rp);
  if (u_mode == 3)  return spectrogramCylinderSDF(p);
  if (u_mode == 4)  return spectralTubeSDF(p);
  if (u_mode == 5)  return waveformSphereSDF(p);
  if (u_mode == 6)  return harmonicRingsSDF(p);
  if (u_mode == 7)  return spectrogramConeSDF(p);
  if (u_mode == 8)  return spectralTerrainSDF(p);
  if (u_mode == 9)  return spectralHelixSDF(p);
  return spectralRibbonSDF(p);
}

vec3 calcNormal(vec3 pos) {
  const float eps = 0.003;
  const vec2  h   = vec2(1.0, -1.0);
  return normalize(h.xyy * sceneSDF(pos + h.xyy * eps) +
                   h.yyx * sceneSDF(pos + h.yyx * eps) +
                   h.yxy * sceneSDF(pos + h.yxy * eps) +
                   h.xxx * sceneSDF(pos + h.xxx * eps));
}

vec4 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 0.0, 2.5);
  vec3 rd = normalize(vec3(uv / 3.0, -1.0));

  float t   = 0.01;
  bool  hit = false;
  for (int i = 0; i < MAX_STEPS; i++) {
    float d = sceneSDF(ro + t * rd);
    if (d < SURF_DIST) { hit = true; break; }
    if (t > MAX_DIST)  break;
    t += max(d, SURF_DIST);
  }
  if (!hit) {
    if (u_lighting >= 2) {
      float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
      float amp = (max(aL2, 0.015) + aR2) * 0.6;
      return vec4(u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp, 1.0);
    }
    return vec4(0.0);
  }

  vec3 pos = ro + t * rd;
  vec3 nor = calcNormal(pos);
  if (dot(nor, rd) > 0.0) nor = -nor;

  if (u_lighting == 1) return vec4(flashLight(nor, rd), 1.0);

  float tb = t + 0.005;
  for (int i = 0; i < 48; i++) {
    float d = sceneSDF(ro + rd * tb);
    if (d > 0.0) break;
    tb += max(-d, 0.005);
  }
  if (u_lighting == 2) return vec4(envLight(nor, rd, tb - t), 1.0);
  if (u_lighting >= 3) return vec4(fillLight(nor, rd, tb - t), 1.0);
  return vec4(rimLight(pos, nor, rd, tb - t), 1.0);
}

void main() {
  vec2 offs[4];
  offs[0] = vec2( 0.25,  0.25);
  offs[1] = vec2(-0.25,  0.25);
  offs[2] = vec2( 0.25, -0.25);
  offs[3] = vec2(-0.25, -0.25);

  vec4 col = vec4(0.0);
  for (int s = 0; s < 4; s++) {
    if (u_ssaa == 0 && s > 0) break;
    vec2 off = u_ssaa == 1 ? offs[s] : vec2(0.0);
    vec2 uv  = ((gl_FragCoord.xy + off) * 2.0 - iResolution.xy) / iResolution.y;
    col     += render3D(uv);
  }
  col /= (u_ssaa == 1 ? 4.0 : 1.0);
  gl_FragColor = vec4(pow(max(col.rgb, vec3(0.0)), vec3(0.4545)), 1.0);
}
