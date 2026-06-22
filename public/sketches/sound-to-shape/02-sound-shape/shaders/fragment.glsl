precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform int       u_shapeIndex;
uniform int       u_lighting;    // 0=rim  1=flash  2=env
uniform int       u_deformMode;  // 0–9
uniform float     u_ampL;
uniform float     u_ampR;
uniform float     u_ampMono;
uniform sampler2D u_histTex;     // 1×HIST  r=ampL g=ampR  row 0=oldest HIST-1=newest
uniform sampler2D u_fftTex;      // 128×1   r=mono mel FFT  col 0=sub-bass
uniform sampler2D u_envMap;
uniform int       u_ssaa;

// INCLUDE_SDF_FUNCTIONS

float sceneSDF(vec3 p);
// INCLUDE_SDF_MARCHER
// INCLUDE_LIGHTING

const float PI = 3.14159265359;

// ── env map ──────────────────────────────────────────────────────────────────
vec3 sampleEnvMap(vec3 dir) {
  float u = atan(dir.z, dir.x) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return texture2D(u_envMap, vec2(u, v)).rgb;
}

// ── noise (for spines) ───────────────────────────────────────────────────────
float hash3(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

// ── texture helpers ──────────────────────────────────────────────────────────
// v=0 oldest, v=1 newest  (row 0=oldest stored at bottom of texture)
float sampleHistL(float v) { return texture2D(u_histTex, vec2(0.5, v)).r; }
float sampleFFT(float u)   { return texture2D(u_fftTex,  vec2(u,   0.5)).r; }

// ── deformation (applied in shape-local space after auto-rotation) ───────────
vec3 deformP(vec3 rp) {

  // 0 = none, 1 = breathe (handled as SDF offset below)
  if (u_deformMode == 0 || u_deformMode == 1) return rp;

  // ── Category 1: current level ────────────────────────────────────────────

  // 2 = squash & stretch  (L squashes Y, R expands XZ)
  if (u_deformMode == 2) {
    float sx = 1.0 + u_ampR * 0.38;
    float sy = max(1.0 - u_ampL * 0.55, 0.15);
    return rp * vec3(sx, sy, sx);
  }

  // 3 = spines  (hash-defined bristles scaled by amplitude)
  if (u_deformMode == 3) {
    vec3 n  = normalize(rp + vec3(0.0001));
    float h = hash3(n * 5.0) * 2.0 - 1.0;
    return rp - n * h * u_ampMono * 0.55;
  }

  // ── Category 2: history ──────────────────────────────────────────────────

  // 4 = ripple up  (bottom=current, top=past → pulse travels upward)
  if (u_deformMode == 4) {
    float v    = 1.0 - clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float hist = sampleHistL(v);
    float xzL  = length(rp.xz);
    vec3  lat  = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * hist * 0.44;
  }

  // 5 = echo rings  (centre=current, periphery=past → concentric shells expand)
  if (u_deformMode == 5) {
    float r    = length(rp);
    float v    = 1.0 - clamp(r / 1.2, 0.01, 0.99);
    float hist = sampleHistL(v);
    vec3  n    = normalize(rp + vec3(0.0001));
    return rp - n * hist * 0.44;
  }

  // 6 = phase twist  (each Y slice rotated by historical amplitude at that moment)
  if (u_deformMode == 6) {
    float v     = 1.0 - clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float hist  = sampleHistL(v);
    float angle = hist * PI * 2.8;
    float c = cos(angle), s = sin(angle);
    return vec3(c * rp.x - s * rp.z, rp.y, s * rp.x + c * rp.z);
  }

  // ── Category 3: FFT ──────────────────────────────────────────────────────

  // 7 = spectral bands  (Y → FFT bin → lateral push, like a 3-D EQ)
  if (u_deformMode == 7) {
    float u    = clamp((rp.y + 1.0) * 0.5, 0.01, 0.99);
    float famp = sampleFFT(u);
    float xzL  = length(rp.xz);
    vec3  lat  = xzL > 0.001 ? vec3(rp.x, 0.0, rp.z) / xzL : vec3(1.0, 0.0, 0.0);
    return rp - lat * famp * 0.46;
  }

  // 8 = bass / treble poles  (bass inflates bottom, treble inflates top)
  if (u_deformMode == 8) {
    float bass   = sampleFFT(0.05);
    float treble = sampleFFT(0.85);
    float blend  = (rp.y + 1.0) * 0.5;
    float famp   = mix(bass, treble, blend);
    vec3  n      = normalize(rp + vec3(0.0001));
    return rp - n * famp * 0.46;
  }

  // 9 = spectral sway  (four bands drive slow-to-fast oscillations in XZ)
  if (u_deformMode == 9) {
    float sub  = sampleFFT(0.04);
    float lo   = sampleFFT(0.15);
    float mid  = sampleFFT(0.40);
    float hi   = sampleFFT(0.80);
    float dx = sin(iTime * 0.7)  * sub  * 0.50
             + sin(iTime * 1.4)  * lo   * 0.30
             + sin(iTime * 3.1)  * mid  * 0.18
             + sin(iTime * 6.3)  * hi   * 0.10;
    float dz = cos(iTime * 0.9)  * sub  * 0.50
             + cos(iTime * 1.7)  * lo   * 0.30
             + cos(iTime * 2.9)  * mid  * 0.18
             + cos(iTime * 5.5)  * hi   * 0.10;
    return rp - vec3(dx, 0.0, dz);
  }

  return rp;
}

// ── base SDF dispatch (31 shapes, same parameters as flash-light / env-map) ──
float baseSDF(vec3 rp) {
  if (u_shapeIndex == 1)  return sdSphere(rp, 0.80);
  if (u_shapeIndex == 2)  return sdBox(rp, vec3(0.56));
  if (u_shapeIndex == 3)  return sdRoundBox(rp, vec3(0.50), 0.12);
  if (u_shapeIndex == 4)  return sdBoxFrame(rp, vec3(0.56), 0.06);
  if (u_shapeIndex == 5)  return sdTorus(rp, vec2(0.55, 0.18));
  if (u_shapeIndex == 6)  return sdCappedTorus(rp, vec2(0.866, 0.500), 0.62, 0.14);
  if (u_shapeIndex == 7)  return sdLink(rp, 0.28, 0.42, 0.10);
  if (u_shapeIndex == 8)  return sdCylinder(rp, vec3(0.0, 0.0, 0.42));
  if (u_shapeIndex == 9)  return sdCone(rp - vec3(0.0, 0.44, 0.0), vec2(0.5774, 0.8165), 0.88);
  if (u_shapeIndex == 10) return sdInfiniteCone(rp, normalize(vec2(0.5, 1.0)));
  if (u_shapeIndex == 11) return sdHexPrism(rp, vec2(0.50, 0.46));
  if (u_shapeIndex == 12) return sdCapsule(rp, vec3(-0.5, -0.3, 0.0), vec3(0.5, 0.3, 0.0), 0.24);
  if (u_shapeIndex == 13) return sdVerticalCapsule(rp + vec3(0.0, 0.56, 0.0), 1.12, 0.28);
  if (u_shapeIndex == 14) return sdCappedCylinder(rp, 0.45, 0.55);
  if (u_shapeIndex == 15) return sdCappedCylinder(rp, vec3(-0.0, -0.55, 0.3), vec3(0.0, 0.55, -0.3), 0.32);
  if (u_shapeIndex == 16) return sdRoundedCylinder(rp, 0.42, 0.10, 0.50);
  if (u_shapeIndex == 17) return sdCappedCone(rp, 0.72, 0.50, 0.14);
  if (u_shapeIndex == 18) return sdCappedCone(rp, vec3(0.0, -0.55, 0.0), vec3(0.0, 0.55, 0.0), 0.50, 0.10);
  if (u_shapeIndex == 19) return sdSolidAngle(rp + vec3(0.0, 0.46, 0.0), vec2(0.866, 0.500), 0.82);
  if (u_shapeIndex == 20) return sdCutSphere(rp - vec3(0.0, 0.32, 0.0), 0.82, 0.18);
  if (u_shapeIndex == 21) return sdCutHollowSphere(rp + vec3(0.0, 0.51, 0.0), 0.82, 0.20, 0.045);
  if (u_shapeIndex == 22) return sdDeathStar(rp, 0.76, 0.40, 0.62);
  if (u_shapeIndex == 23) return sdRoundCone(rp + vec3(0.0, 0.38, 0.0), 0.32, 0.06, 1.02);
  if (u_shapeIndex == 24) return sdRoundCone(rp, vec3(-0.5, -0.5, 0.0), vec3(0.5, 0.5, 0.0), 0.32, 0.10);
  if (u_shapeIndex == 25) return sdVesicaSegment(rp, vec3(-0.55, 0.0, 0.0), vec3(0.55, 0.0, 0.0), 0.38);
  if (u_shapeIndex == 26) return sdRhombus(rp, 0.58, 0.48, 0.36, 0.06);
  if (u_shapeIndex == 27) return sdOctahedron(rp, 0.90);
  if (u_shapeIndex == 28) return sdOctahedronFast(rp, 0.90);
  if (u_shapeIndex == 29) return sdPyramid(rp + vec3(0.0, 0.44, 0.0), 0.90);
  if (u_shapeIndex == 30) return sdEllipsoid(rp, vec3(0.70, 0.46, 0.56));
  if (u_shapeIndex == 31) return sdTriPrism(rp, vec2(0.50, 0.46));
  return 1e10;
}

// ── scene SDF: auto-rotate → deform → evaluate ───────────────────────────────
float sceneSDF(vec3 p) {
  float a = iTime * 0.35;
  float ca = cos(a), sa = sin(a);
  vec3 rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  vec3 dp = deformP(rp);
  float d = baseSDF(dp);
  if (u_deformMode == 1) d -= u_ampMono * 0.38;  // breathe: SDF-space inflate
  return d;
}

// ── lighting ──────────────────────────────────────────────────────────────────
vec3 flashLight(vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);
  float a1 = iTime * 3.5;
  vec3  ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  float d1  = max(dot(nor, ld1), 0.0);
  vec3  h1  = normalize(ld1 - rd);
  float s1  = pow(max(dot(nor, h1), 0.0), 56.0);
  vec3  c1  = mat * d1 * 0.85 + vec3(0.45) * s1 * 0.45;

  float a2 = iTime * 2.1 + 1.9;
  vec3  ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  float d2  = max(dot(nor, ld2), 0.0);
  vec3  h2  = normalize(ld2 - rd);
  float s2  = pow(max(dot(nor, h2), 0.0), 56.0);
  vec3  c2  = mat * d2 * 0.85 + vec3(0.45) * s2 * 0.45;

  float aL2 = u_ampL * u_ampL;
  float aR2 = u_ampR * u_ampR;
  return c1 * max(aL2, 0.015) + c2 * aR2;
}

vec3 envLight(vec3 nor, vec3 rd) {
  vec3 mat = sampleEnvMap(nor);
  float a1 = iTime * 3.5;
  vec3  ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  float d1  = max(dot(nor, ld1), 0.0);
  vec3  h1  = normalize(ld1 - rd);
  float s1  = pow(max(dot(nor, h1), 0.0), 56.0);
  vec3  c1  = mat * d1 * 0.85 + vec3(0.50) * s1 * 0.35;

  float a2 = iTime * 2.1 + 1.9;
  vec3  ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  float d2  = max(dot(nor, ld2), 0.0);
  vec3  h2  = normalize(ld2 - rd);
  float s2  = pow(max(dot(nor, h2), 0.0), 56.0);
  vec3  c2  = mat * d2 * 0.85 + vec3(0.50) * s2 * 0.35;

  float aL2 = u_ampL * u_ampL;
  float aR2 = u_ampR * u_ampR;
  return c1 * max(aL2, 0.015) + c2 * aR2;
}

// ── render ────────────────────────────────────────────────────────────────────
vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 0.55, 3.5);
  vec3 ta = vec3(0.0, 0.08, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);

  float t; vec3 nor;
  bool hit = castRay(ro, rd, t, nor);

  if (u_lighting == 2) {
    float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
    if (!hit) return sampleEnvMap(rd) * (max(aL2, 0.015) + aR2) * 0.6;
    if (dot(nor, -rd) < 0.0) nor = -nor;
    return envLight(nor, rd);
  }

  if (!hit) return vec3(0.0);
  if (dot(nor, -rd) < 0.0) nor = -nor;
  vec3 pos = ro + t * rd;

  if (u_lighting == 1) return flashLight(nor, rd);
  return stdLighting(pos, nor, rd);   // rim = standard white/grey studio
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25, -0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, -0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25,  0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,  0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
