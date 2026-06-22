precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform int       u_shapeIndex;
uniform int       u_lighting;    // 0=rim  1=flash  2=env
uniform int       u_deformMode;
uniform float     u_ampL;
uniform float     u_ampR;
uniform float     u_ampMono;
uniform sampler2D u_histTex;
uniform sampler2D u_fftTex;
uniform sampler2D u_envMap;
uniform int       u_ssaa;
uniform float     u_rimPow;
uniform float     u_base;
uniform float     u_sssDensity;
uniform float     u_sssStr;
uniform float     u_deformP1;
uniform float     u_deformP2;
uniform float     u_histDuration;
uniform float     u_histSoften;
uniform float     u_twistAxisX;
uniform float     u_twistAxisZ;
uniform float     u_ctrlN;
uniform sampler2D u_fillTex;
uniform float     u_envScale;

// INCLUDE_SDF_FUNCTIONS
// INCLUDE_RIM_LIGHTING

float sceneSDF(vec3 p);
// INCLUDE_SDF_MARCHER

const float PI = 3.14159265359;
// INCLUDE_DEFORM

vec3 sampleEnvMap(vec3 dir) {
  float u = atan(dir.z, dir.x) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  return texture2D(u_envMap, vec2(u, v)).rgb;
}

vec3 sampleFillMap(vec3 dir) {
  float u = atan(dir.x, -dir.z) * (0.5 / PI) + 0.5 + iTime * 0.02;
  float v = asin(clamp(dir.y, -1.0, 1.0)) / PI + 0.5;
  vec2  uv = (vec2(u, v) - 0.5) / u_envScale + 0.5;
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

float sceneSDF(vec3 p) {
  float a = iTime * 0.35;
  float ca = cos(a), sa = sin(a);
  vec3 rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  vec3 dp = deformP(rp);
  float d = baseSDF(dp);
  if (u_deformMode == 1) d -= u_ampMono * u_deformP1;
  return d;
}

// Rotation-only SDF (no deformP) for smooth normal in spikes mode
float sceneSDFSmooth(vec3 p) {
  float a = iTime * 0.35;
  float ca = cos(a), sa = sin(a);
  vec3 rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  return baseSDF(rp);
}
vec3 calcNormalSmooth(vec3 pos) {
  const float eps = 0.002;
  const vec2 h = vec2(1.0, -1.0);
  return normalize(h.xyy * sceneSDFSmooth(pos + h.xyy * eps) +
                   h.yyx * sceneSDFSmooth(pos + h.yyx * eps) +
                   h.yxy * sceneSDFSmooth(pos + h.yxy * eps) +
                   h.xxx * sceneSDFSmooth(pos + h.xxx * eps));
}

vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 0.55, 3.5);
  vec3 ta = vec3(0.0, 0.08, 0.0);
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
  if (u_deformMode == 3) nor = calcNormalSmooth(pos);

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
