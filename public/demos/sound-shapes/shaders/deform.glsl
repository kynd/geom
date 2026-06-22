// deform.glsl — spatial deformation functions shared across all shape categories
// Required uniforms (declared in each fragment shader, not here):
//   uniform int       u_deformMode;
//   uniform float     u_deformP1, u_deformP2;
//   uniform float     u_histDuration;   // 0.05–1.0: fraction of history window
//   uniform float     u_histSoften;     // 0–1: Gaussian blur strength over history
//   uniform float     u_twistAxisX;     // X component of twist axis (Y=1 baseline)
//   uniform float     u_twistAxisZ;     // Z component of twist axis (Y=1 baseline)
//   uniform float     u_ctrlN;          // 2–8: control points for mode 8 spline
//   uniform float     u_ampL, u_ampR, u_ampMono;
//   uniform sampler2D u_histTex;        // 1×HIST  r=ampL  row0=oldest
//   uniform sampler2D u_fftTex;         // 128×1   r=mono mel FFT  col0=sub-bass
//   uniform float     iTime;
//   const float       PI;
//
// u_deformP1 / u_deformP2 meanings per mode:
//   1 inflate:   p1=intensity (applied in sceneSDF/surfaceF, not deformP)
//   2 squash:    p1=width X/Z, p2=height Y
//   3 spikes:    p1=intensity (normals lit on undeformed surface)
//   4 ripple:    p1=intensity
//   5 rings:     p1=intensity
//   6 twist:     p1=angle multiplier
//   7 EQ bands:  p1=intensity
//   8 spectrum:  p1=intensity (N-band Catmull-Rom spline over FFT)
//   9 shear:     p1=intensity (opposing frequency pairs drive per-axis skew)

float _hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float _sampleHistL(float v) { return texture2D(u_histTex, vec2(0.5, v)).r; }
float _sampleFFT  (float u) { return texture2D(u_fftTex,  vec2(u,   0.5)).r; }

// History sample with duration scaling and 5-tap Gaussian softening
float _sampleHist(float rawV) {
  float v = rawV * u_histDuration;
  if (u_histSoften < 0.001) return _sampleHistL(v);
  float step = u_histSoften * 0.04;
  return _sampleHistL(clamp(v - step*2.0, 0.0, 1.0)) * 0.0625
       + _sampleHistL(clamp(v - step,     0.0, 1.0)) * 0.25
       + _sampleHistL(v)                              * 0.375
       + _sampleHistL(clamp(v + step,     0.0, 1.0)) * 0.25
       + _sampleHistL(clamp(v + step*2.0, 0.0, 1.0)) * 0.0625;
}

// Sample FFT at the i-th of n evenly-spaced control points
float _fftCtrl(int i, int n) {
  float u = float(i) / float(max(n - 1, 1));
  return _sampleFFT(clamp(u, 0.01, 0.99));
}

// Catmull-Rom spline over n FFT control points evaluated at t in [0,1]
float spectralCurve(float t) {
  int n = max(int(u_ctrlN + 0.5), 2);
  float ft = clamp(t, 0.0, 1.0) * float(n - 1);
  int seg = int(ft);
  if (seg >= n - 1) seg = n - 2;
  float lt = ft - float(seg);
  float p0 = _fftCtrl(max(seg - 1, 0),     n);
  float p1 = _fftCtrl(seg,                  n);
  float p2 = _fftCtrl(min(seg + 1, n - 1), n);
  float p3 = _fftCtrl(min(seg + 2, n - 1), n);
  float t2 = lt * lt, t3 = t2 * lt;
  return clamp(0.5 * ((2.0*p1) + (-p0+p2)*lt + (2.0*p0-5.0*p1+4.0*p2-p3)*t2 + (-p0+3.0*p1-3.0*p2+p3)*t3), 0.0, 1.0);
}

vec3 deformP(vec3 rp) {

  // 0 = none, 1 = inflate (offset applied in sceneSDF/surfaceF, not here)
  if (u_deformMode == 0 || u_deformMode == 1) return rp;

  // ── Current level ──────────────────────────────────────────────────────────

  // 2 = squash  (p1=width X/Z factor, p2=height Y factor)
  if (u_deformMode == 2) {
    float sx = 1.0 + u_ampR * u_deformP1;
    float sy = max(1.0 - u_ampL * u_deformP2, 0.05);
    return rp * vec3(sx, sy, sx);
  }

  // 3 = spikes  (p1=intensity) — render3D overrides nor with the undeformed normal
  if (u_deformMode == 3) {
    vec3  n = normalize(rp + vec3(0.0001));
    float h = _hash3(n * 5.0) * 2.0 - 1.0;
    return rp - n * h * u_ampMono * u_deformP1;
  }

  // ── History ────────────────────────────────────────────────────────────────

  // 4 = ripple  (p1=intensity)
  if (u_deformMode == 4) {
    float v   = 1.0 - clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float h   = _sampleHist(v);
    float xzL = length(rp.xz);
    vec3  lat = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * h * u_deformP1;
  }

  // 5 = rings  (p1=intensity)
  if (u_deformMode == 5) {
    float r = length(rp);
    float v = 1.0 - clamp(r / 1.2, 0.01, 0.99);
    float h = _sampleHist(v);
    vec3  n = normalize(rp + vec3(0.0001));
    return rp - n * h * u_deformP1;
  }

  // 6 = twist  (p1=angle multiplier; axis = normalize(u_twistAxisX, 1, u_twistAxisZ))
  if (u_deformMode == 6) {
    vec3  axis  = normalize(vec3(u_twistAxisX, 1.0, u_twistAxisZ));
    float proj  = dot(rp, axis);
    float v     = 1.0 - clamp((proj + 1.0) * 0.5, 0.01, 0.99);
    float angle = _sampleHist(v) * PI * u_deformP1;
    float c = cos(angle), s = sin(angle);
    return rp * c - cross(axis, rp) * s + axis * dot(axis, rp) * (1.0 - c);
  }

  // ── FFT ────────────────────────────────────────────────────────────────────

  // 7 = EQ bands  (p1=intensity)
  if (u_deformMode == 7) {
    float u   = clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float f   = _sampleFFT(u);
    float xzL = length(rp.xz);
    vec3  lat = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * f * u_deformP1;
  }

  // 8 = spectrum  (p1=intensity, u_ctrlN=control points; Catmull-Rom over FFT bins)
  if (u_deformMode == 8) {
    float t = clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float f = spectralCurve(t) * u_deformP1;
    vec3  n = normalize(rp + vec3(0.0001));
    return rp - n * f;
  }

  // 9 = shear  (p1=intensity)
  // Spectral pairs drive opposing lateral displacement that slowly rotates in XZ,
  // so the lean direction changes over time rather than always tilting the same way.
  if (u_deformMode == 9) {
    float xLo = _sampleFFT(0.08);
    float xHi = _sampleFFT(0.92);
    float zLo = _sampleFFT(0.25);
    float zHi = _sampleFFT(0.75);
    float dx  = (xLo - xHi) * rp.y;
    float dz  = (zLo - zHi) * rp.y;
    float rot = iTime * 0.12;
    float cr  = cos(rot), sr = sin(rot);
    return rp + vec3(cr*dx - sr*dz, 0.0, sr*dx + cr*dz) * u_deformP1;
  }

  return rp;
}
