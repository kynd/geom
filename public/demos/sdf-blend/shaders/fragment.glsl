precision highp float;

// ── Core uniforms ──────────────────────────────────────────────────────────────
uniform vec2      iResolution;
uniform float     iTime;
uniform int       u_ssaa;
uniform int       u_lighting;

// ── Shape A ────────────────────────────────────────────────────────────────────
uniform int       u_shape1;
uniform int       u_deform1;
uniform float     u_ampL1;
uniform float     u_ampR1;
uniform float     u_ampMono1;
uniform sampler2D u_histTex1;
uniform sampler2D u_fftTex1;

// ── Shape B ────────────────────────────────────────────────────────────────────
uniform int       u_shape2;
uniform int       u_deform2;
uniform float     u_ampL2;
uniform float     u_ampR2;
uniform float     u_ampMono2;
uniform sampler2D u_histTex2;
uniform sampler2D u_fftTex2;

// ── Shared deform params ───────────────────────────────────────────────────────
uniform float     u_deformP1;
uniform float     u_deformP2;
uniform float     u_histDuration;
uniform float     u_histSoften;
uniform float     u_ctrlN;
uniform float     u_twistAxisX;
uniform float     u_twistAxisZ;

// ── Scene ──────────────────────────────────────────────────────────────────────
uniform float     u_dist;
uniform float     u_blend;

// ── Lighting ───────────────────────────────────────────────────────────────────
uniform float     u_rimPow;
uniform float     u_base;
uniform float     u_sssDensity;
uniform float     u_sssStr;
uniform sampler2D u_envMap;
uniform sampler2D u_fillTex;
uniform float     u_envScale;
// Master amplitude for lighting effects
uniform float     u_ampL;
uniform float     u_ampR;

const float PI = 3.14159265359;

// INCLUDE_SDF_FUNCTIONS
// INCLUDE_PLATONIC_FUNCTIONS
// INCLUDE_RIM_LIGHTING

// ── opSmoothUnion ─────────────────────────────────────────────────────────────
float opSmoothUnion(float d1, float d2, float k) {
  float h = clamp(0.5 + 0.5 * (d2 - d1) / k, 0.0, 1.0);
  return mix(d2, d1, h) - k * h * (1.0 - h);
}

// ── Shape dispatch (parameterized) ────────────────────────────────────────────
float baseSDF(vec3 rp, int idx) {
  if (idx == 1)  return sdSphere(rp, 0.80);
  if (idx == 2)  return sdBox(rp, vec3(0.56));
  if (idx == 3)  return sdRoundBox(rp, vec3(0.50), 0.12);
  if (idx == 4)  return sdBoxFrame(rp, vec3(0.56), 0.06);
  if (idx == 5)  return sdTorus(rp, vec2(0.55, 0.18));
  if (idx == 6)  return sdCappedTorus(rp, vec2(0.866, 0.500), 0.62, 0.14);
  if (idx == 7)  return sdLink(rp, 0.28, 0.42, 0.10);
  if (idx == 8)  return sdCylinder(rp, vec3(0.0, 0.0, 0.42));
  if (idx == 9)  return sdCone(rp - vec3(0.0, 0.44, 0.0), vec2(0.5774, 0.8165), 0.88);
  if (idx == 10) return sdInfiniteCone(rp, normalize(vec2(0.5, 1.0)));
  if (idx == 11) return sdHexPrism(rp, vec2(0.50, 0.46));
  if (idx == 12) return sdCapsule(rp, vec3(-0.5, -0.3, 0.0), vec3(0.5, 0.3, 0.0), 0.24);
  if (idx == 13) return sdVerticalCapsule(rp + vec3(0.0, 0.56, 0.0), 1.12, 0.28);
  if (idx == 14) return sdCappedCylinder(rp, 0.45, 0.55);
  if (idx == 15) return sdCappedCylinder(rp, vec3(0.0, -0.55, 0.3), vec3(0.0, 0.55, -0.3), 0.32);
  if (idx == 16) return sdRoundedCylinder(rp, 0.42, 0.10, 0.50);
  if (idx == 17) return sdCappedCone(rp, 0.72, 0.50, 0.14);
  if (idx == 18) return sdCappedCone(rp, vec3(0.0, -0.55, 0.0), vec3(0.0, 0.55, 0.0), 0.50, 0.10);
  if (idx == 19) return sdSolidAngle(rp + vec3(0.0, 0.46, 0.0), vec2(0.866, 0.500), 0.82);
  if (idx == 20) return sdCutSphere(rp - vec3(0.0, 0.32, 0.0), 0.82, 0.18);
  if (idx == 21) return sdCutHollowSphere(rp + vec3(0.0, 0.51, 0.0), 0.82, 0.20, 0.045);
  if (idx == 22) return sdDeathStar(rp, 0.76, 0.40, 0.62);
  if (idx == 23) return sdRoundCone(rp + vec3(0.0, 0.38, 0.0), 0.32, 0.06, 1.02);
  if (idx == 24) return sdRoundCone(rp, vec3(-0.5, -0.5, 0.0), vec3(0.5, 0.5, 0.0), 0.32, 0.10);
  if (idx == 25) return sdVesicaSegment(rp, vec3(-0.55, 0.0, 0.0), vec3(0.55, 0.0, 0.0), 0.38);
  if (idx == 26) return sdRhombus(rp, 0.58, 0.48, 0.36, 0.06);
  if (idx == 27) return sdOctahedron(rp, 0.90);
  if (idx == 28) return sdOctahedronFast(rp, 0.90);
  if (idx == 29) return sdPyramid(rp + vec3(0.0, 0.44, 0.0), 0.90);
  if (idx == 30) return sdEllipsoid(rp, vec3(0.70, 0.46, 0.56));
  if (idx == 31) return sdTriPrism(rp, vec2(0.50, 0.46));
  // Platonic solids (circumradius normalised to 1, scaled to 0.85)
  if (idx == 32) return sdCube(rp / 0.85) * 0.85;
  if (idx == 33) return sdTetrahedron(rp / 0.85) * 0.85;
  if (idx == 34) return sdDualTetrahedron(rp / 0.85) * 0.85;
  if (idx == 35) return sdDodecahedron(rp / 0.85) * 0.85;
  if (idx == 36) return sdIcosahedron(rp / 0.85) * 0.85;
  return 1e10;
}

// ── Deform helpers for Shape A ────────────────────────────────────────────────

float _a1Hist(float v) { return texture2D(u_histTex1, vec2(0.5, v)).r; }
float _a1FFT(float u)  { return texture2D(u_fftTex1, vec2(u, 0.5)).r; }

float _a1SampleHist(float rawV) {
  float v = rawV * u_histDuration;
  if (u_histSoften < 0.001) return _a1Hist(v);
  float st = u_histSoften * 0.04;
  return _a1Hist(clamp(v-st*2.0,0.0,1.0))*0.0625
       + _a1Hist(clamp(v-st,    0.0,1.0))*0.25
       + _a1Hist(v)                       *0.375
       + _a1Hist(clamp(v+st,    0.0,1.0))*0.25
       + _a1Hist(clamp(v+st*2.0,0.0,1.0))*0.0625;
}

float _a1SpectralCurve(float t) {
  int n = max(int(u_ctrlN + 0.5), 2);
  float ft = clamp(t, 0.0, 1.0) * float(n - 1);
  int seg = int(ft); if (seg >= n - 1) seg = n - 2;
  float lt = ft - float(seg);
  float p0 = _a1FFT(clamp(float(max(seg-1,0))    / float(max(n-1,1)), 0.01, 0.99));
  float p1 = _a1FFT(clamp(float(seg)              / float(max(n-1,1)), 0.01, 0.99));
  float p2 = _a1FFT(clamp(float(min(seg+1,n-1))  / float(max(n-1,1)), 0.01, 0.99));
  float p3 = _a1FFT(clamp(float(min(seg+2,n-1))  / float(max(n-1,1)), 0.01, 0.99));
  float t2 = lt*lt, t3 = t2*lt;
  return clamp(0.5*((2.0*p1)+(-p0+p2)*lt+(2.0*p0-5.0*p1+4.0*p2-p3)*t2+(-p0+3.0*p1-3.0*p2+p3)*t3), 0.0, 1.0);
}

float _hashV(vec3 p) {
  p = fract(p * 0.3183099 + 0.1); p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

vec3 deformA(vec3 rp) {
  if (u_deform1 == 0 || u_deform1 == 1) return rp;
  if (u_deform1 == 2) {
    float sx = 1.0 + u_ampR1 * u_deformP1;
    float sy = max(1.0 - u_ampL1 * u_deformP2, 0.05);
    return rp * vec3(sx, sy, sx);
  }
  if (u_deform1 == 3) {
    vec3 n = normalize(rp + vec3(0.0001));
    return rp - n * (_hashV(n * 5.0) * 2.0 - 1.0) * u_ampMono1 * u_deformP1;
  }
  if (u_deform1 == 4) {
    float v = 1.0 - clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float h = _a1SampleHist(v);
    float xzL = length(rp.xz);
    vec3 lat = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * h * u_deformP1;
  }
  if (u_deform1 == 5) {
    float r = length(rp);
    float h = _a1SampleHist(1.0 - clamp(r / 1.2, 0.01, 0.99));
    return rp - normalize(rp + vec3(0.0001)) * h * u_deformP1;
  }
  if (u_deform1 == 6) {
    vec3 axis = normalize(vec3(u_twistAxisX, 1.0, u_twistAxisZ));
    float v = 1.0 - clamp((dot(rp, axis) + 1.0) * 0.5, 0.01, 0.99);
    float angle = _a1SampleHist(v) * PI * u_deformP1;
    float c = cos(angle), s = sin(angle);
    return rp * c - cross(axis, rp) * s + axis * dot(axis, rp) * (1.0 - c);
  }
  if (u_deform1 == 7) {
    float f = _a1FFT(clamp((rp.y + 1.0) * 0.5, 0.01, 0.99));
    float xzL = length(rp.xz);
    vec3 lat = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * f * u_deformP1;
  }
  if (u_deform1 == 8) {
    float t = clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    return rp - normalize(rp + vec3(0.0001)) * _a1SpectralCurve(t) * u_deformP1;
  }
  if (u_deform1 == 9) {
    float dx = (_a1FFT(0.08) - _a1FFT(0.92)) * rp.y;
    float dz = (_a1FFT(0.25) - _a1FFT(0.75)) * rp.y;
    float rot = iTime * 0.12;
    float cr = cos(rot), sr = sin(rot);
    return rp + vec3(cr*dx - sr*dz, 0.0, sr*dx + cr*dz) * u_deformP1;
  }
  return rp;
}

// ── Deform helpers for Shape B ────────────────────────────────────────────────

float _b2Hist(float v) { return texture2D(u_histTex2, vec2(0.5, v)).r; }
float _b2FFT(float u)  { return texture2D(u_fftTex2, vec2(u, 0.5)).r; }

float _b2SampleHist(float rawV) {
  float v = rawV * u_histDuration;
  if (u_histSoften < 0.001) return _b2Hist(v);
  float st = u_histSoften * 0.04;
  return _b2Hist(clamp(v-st*2.0,0.0,1.0))*0.0625
       + _b2Hist(clamp(v-st,    0.0,1.0))*0.25
       + _b2Hist(v)                       *0.375
       + _b2Hist(clamp(v+st,    0.0,1.0))*0.25
       + _b2Hist(clamp(v+st*2.0,0.0,1.0))*0.0625;
}

float _b2SpectralCurve(float t) {
  int n = max(int(u_ctrlN + 0.5), 2);
  float ft = clamp(t, 0.0, 1.0) * float(n - 1);
  int seg = int(ft); if (seg >= n - 1) seg = n - 2;
  float lt = ft - float(seg);
  float p0 = _b2FFT(clamp(float(max(seg-1,0))    / float(max(n-1,1)), 0.01, 0.99));
  float p1 = _b2FFT(clamp(float(seg)              / float(max(n-1,1)), 0.01, 0.99));
  float p2 = _b2FFT(clamp(float(min(seg+1,n-1))  / float(max(n-1,1)), 0.01, 0.99));
  float p3 = _b2FFT(clamp(float(min(seg+2,n-1))  / float(max(n-1,1)), 0.01, 0.99));
  float t2 = lt*lt, t3 = t2*lt;
  return clamp(0.5*((2.0*p1)+(-p0+p2)*lt+(2.0*p0-5.0*p1+4.0*p2-p3)*t2+(-p0+3.0*p1-3.0*p2+p3)*t3), 0.0, 1.0);
}

vec3 deformB(vec3 rp) {
  if (u_deform2 == 0 || u_deform2 == 1) return rp;
  if (u_deform2 == 2) {
    float sx = 1.0 + u_ampR2 * u_deformP1;
    float sy = max(1.0 - u_ampL2 * u_deformP2, 0.05);
    return rp * vec3(sx, sy, sx);
  }
  if (u_deform2 == 3) {
    vec3 n = normalize(rp + vec3(0.0001));
    return rp - n * (_hashV(n * 5.0) * 2.0 - 1.0) * u_ampMono2 * u_deformP1;
  }
  if (u_deform2 == 4) {
    float v = 1.0 - clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float h = _b2SampleHist(v);
    float xzL = length(rp.xz);
    vec3 lat = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * h * u_deformP1;
  }
  if (u_deform2 == 5) {
    float r = length(rp);
    float h = _b2SampleHist(1.0 - clamp(r / 1.2, 0.01, 0.99));
    return rp - normalize(rp + vec3(0.0001)) * h * u_deformP1;
  }
  if (u_deform2 == 6) {
    vec3 axis = normalize(vec3(u_twistAxisX, 1.0, u_twistAxisZ));
    float v = 1.0 - clamp((dot(rp, axis) + 1.0) * 0.5, 0.01, 0.99);
    float angle = _b2SampleHist(v) * PI * u_deformP1;
    float c = cos(angle), s = sin(angle);
    return rp * c - cross(axis, rp) * s + axis * dot(axis, rp) * (1.0 - c);
  }
  if (u_deform2 == 7) {
    float f = _b2FFT(clamp((rp.y + 1.0) * 0.5, 0.01, 0.99));
    float xzL = length(rp.xz);
    vec3 lat = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * f * u_deformP1;
  }
  if (u_deform2 == 8) {
    float t = clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    return rp - normalize(rp + vec3(0.0001)) * _b2SpectralCurve(t) * u_deformP1;
  }
  if (u_deform2 == 9) {
    float dx = (_b2FFT(0.08) - _b2FFT(0.92)) * rp.y;
    float dz = (_b2FFT(0.25) - _b2FFT(0.75)) * rp.y;
    float rot = iTime * 0.12;
    float cr = cos(rot), sr = sin(rot);
    return rp + vec3(cr*dx - sr*dz, 0.0, sr*dx + cr*dz) * u_deformP1;
  }
  return rp;
}

// ── Shape evaluators ──────────────────────────────────────────────────────────

float evalShapeA(vec3 p) {
  vec3 q = p + vec3(u_dist * 0.5, 0.0, 0.0);
  float d = baseSDF(deformA(q), u_shape1);
  if (u_deform1 == 1) d -= u_ampMono1 * u_deformP1;
  return d;
}

float evalShapeB(vec3 p) {
  vec3 q = p - vec3(u_dist * 0.5, 0.0, 0.0);
  float d = baseSDF(deformB(q), u_shape2);
  if (u_deform2 == 1) d -= u_ampMono2 * u_deformP1;
  return d;
}

// Smooth (undeformed) variants for spikes normal
float evalShapeASmooth(vec3 p) {
  return baseSDF(p + vec3(u_dist * 0.5, 0.0, 0.0), u_shape1);
}
float evalShapeBSmooth(vec3 p) {
  return baseSDF(p - vec3(u_dist * 0.5, 0.0, 0.0), u_shape2);
}

float sceneSDF(vec3 p) {
  return opSmoothUnion(evalShapeA(p), evalShapeB(p), u_blend);
}

float sceneSDFSmooth(vec3 p) {
  return opSmoothUnion(evalShapeASmooth(p), evalShapeBSmooth(p), u_blend);
}

vec3 calcNormalSmooth(vec3 pos) {
  const float eps = 0.002;
  const vec2 h = vec2(1.0, -1.0);
  return normalize(
    h.xyy * sceneSDFSmooth(pos + h.xyy * eps) +
    h.yyx * sceneSDFSmooth(pos + h.yyx * eps) +
    h.yxy * sceneSDFSmooth(pos + h.yxy * eps) +
    h.xxx * sceneSDFSmooth(pos + h.xxx * eps)
  );
}

// ── Forward declaration required by INCLUDE_SDF_MARCHER ──────────────────────

// INCLUDE_SDF_MARCHER

// ── Env / fill map sampling ───────────────────────────────────────────────────

vec3 sampleEnvMap(vec3 dir) {
  float u = atan(dir.z, dir.x) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return texture2D(u_envMap, vec2(u, v)).rgb;
}

vec3 sampleFillMap(vec3 dir) {
  float u = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  vec2 uv = (vec2(u, v) - 0.5) / u_envScale + 0.5;
  float uf = fract(uv.x);
  uv.x = uf < 0.5 ? uf * 2.0 : (1.0 - uf) * 2.0;
  uv.y = clamp(uv.y, 0.0, 1.0);
  vec3 c = texture2D(u_fillTex, uv).rgb;
  return c * c;
}

vec3 flashLight(vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);
  float a1 = iTime * 3.5;
  vec3 ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3 h1  = normalize(ld1 - rd);
  vec3 c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.45) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.45;
  float a2 = iTime * 2.1 + 1.9;
  vec3 ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3 h2  = normalize(ld2 - rd);
  vec3 c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.45) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.45;
  return c1 * max(u_ampL * u_ampL, 0.015) + c2 * (u_ampR * u_ampR);
}

vec3 envLight(vec3 nor, vec3 rd, float thickness) {
  vec3 mat = sampleEnvMap(nor);
  float a1 = iTime * 3.5;
  vec3 ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3 h1  = normalize(ld1 - rd);
  vec3 c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.35;
  float a2 = iTime * 2.1 + 1.9;
  vec3 ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3 h2  = normalize(ld2 - rd);
  vec3 c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.35;
  float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
  float amp = max(aL2, 0.015) + aR2;
  vec3 lit  = c1 * max(aL2, 0.015) + c2 * aR2;
  lit += mat * exp(-thickness * u_sssDensity) * u_sssStr * amp;
  return lit;
}

vec3 fillLight(vec3 nor, vec3 rd, float thickness) {
  vec3 mat = sampleFillMap(nor);
  float a1 = iTime * 3.5;
  vec3 ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3 h1  = normalize(ld1 - rd);
  vec3 c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.35;
  float a2 = iTime * 2.1 + 1.9;
  vec3 ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3 h2  = normalize(ld2 - rd);
  vec3 c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.35;
  float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
  float amp = max(aL2, 0.015) + aR2;
  vec3 lit  = c1 * max(aL2, 0.015) + c2 * aR2;
  lit += mat * exp(-thickness * u_sssDensity) * u_sssStr * amp;
  return lit;
}

// ── Main render ───────────────────────────────────────────────────────────────

vec3 render3D(vec2 uv) {
  float ang   = iTime * 0.30;          // full 360° every ~21 s
  float sway  = sin(iTime * 0.45);     // vertical sway ~14 s period
  float r     = 3.6;
  vec3 ro = vec3(sin(ang) * r, 0.28 + 0.22 * sway, cos(ang) * r);
  vec3 ta = vec3(0.0, 0.06 * sway, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);

  float t; vec3 nor;
  bool hit = castRay(ro, rd, t, nor);

  if (!hit) {
    if (u_lighting >= 2) {
      float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
      float amp = (max(aL2, 0.015) + aR2) * 0.6;
      return u_lighting >= 3 ? sampleFillMap(rd) * amp : sampleEnvMap(rd) * amp;
    }
    return vec3(0.0);
  }
  if (dot(nor, -rd) < 0.0) nor = -nor;
  vec3 pos = ro + t * rd;
  bool useSpikesNor = (u_deform1 == 3 || u_deform2 == 3);
  if (useSpikesNor) nor = calcNormalSmooth(pos);

  if (u_lighting == 1) return flashLight(nor, rd);

  float tb = t + 0.005;
  for (int i = 0; i < 48; i++) {
    float d = sceneSDF(ro + rd * tb);
    if (d > 0.0) break;
    tb += max(-d, 0.005);
  }
  if (u_lighting == 2) return envLight(nor, rd, tb - t);
  if (u_lighting >= 3) return fillLight(nor, rd, tb - t);
  return rimLight(pos, nor, rd, tb - t);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25,-0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,-0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25, 0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, 0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
