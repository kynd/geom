precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform int       u_pair;        // 0=cube/oct  1=tetra/tetra  2=dodec/icos
uniform float     u_t;           // morph [0,1]
uniform int       u_lighting;
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

// INCLUDE_PLATONIC_FUNCTIONS
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

vec3 envLight(vec3 nor, vec3 rd) {
  vec3 mat = sampleEnvMap(nor);
  float a1 = iTime * 3.5;
  vec3 ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  vec3 h1  = normalize(ld1 - rd);
  vec3 c1  = mat * max(dot(nor, ld1), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h1), 0.0), 56.0) * 0.35;
  float a2 = iTime * 2.1 + 1.9;
  vec3 ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  vec3 h2  = normalize(ld2 - rd);
  vec3 c2  = mat * max(dot(nor, ld2), 0.0) * 0.85 + vec3(0.50) * pow(max(dot(nor, h2), 0.0), 56.0) * 0.35;
  return c1 * max(u_ampL * u_ampL, 0.015) + c2 * (u_ampR * u_ampR);
}

float sceneSDF(vec3 p) {
  // Rotate then deform in the rotated frame
  vec3 rp;
  if (u_pair == 0) rp = rotX(iTime * 0.28) * rotY(iTime * 0.44) * p;
  else if (u_pair == 1) rp = rotX(2.1 + iTime * 0.40) * rotY(2.1 + iTime * 0.32) * p;
  else rp = rotX(4.3 + iTime * 0.20) * rotY(4.3 + iTime * 0.36) * p;

  vec3 dp = deformP(rp);

  float d;
  if (u_pair == 0) d = mix(sdCube(dp), sdOctahedron(dp), u_t);
  else if (u_pair == 1) d = mix(sdTetrahedron(dp), sdDualTetrahedron(dp), u_t);
  else d = mix(sdDodecahedron(dp), sdIcosahedron(dp), u_t);

  if (u_deformMode == 1) d -= u_ampMono * u_deformP1;
  return d;
}

// Rotation-only SDF (no deformP) for smooth normal in spikes mode
float sceneSDFSmooth(vec3 p) {
  vec3 rp;
  if (u_pair == 0) rp = rotX(iTime * 0.28) * rotY(iTime * 0.44) * p;
  else if (u_pair == 1) rp = rotX(2.1 + iTime * 0.40) * rotY(2.1 + iTime * 0.32) * p;
  else rp = rotX(4.3 + iTime * 0.20) * rotY(4.3 + iTime * 0.36) * p;
  if (u_pair == 0) return mix(sdCube(rp), sdOctahedron(rp), u_t);
  else if (u_pair == 1) return mix(sdTetrahedron(rp), sdDualTetrahedron(rp), u_t);
  return mix(sdDodecahedron(rp), sdIcosahedron(rp), u_t);
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

  if (u_lighting == 2) {
    float aL2 = u_ampL * u_ampL, aR2 = u_ampR * u_ampR;
    if (!hit) return sampleEnvMap(rd) * (max(aL2, 0.015) + aR2) * 0.6;
    if (dot(nor, -rd) < 0.0) nor = -nor;
    if (u_deformMode == 3) nor = calcNormalSmooth(ro + t * rd);
    return envLight(nor, rd);
  }
  if (!hit) return vec3(0.0);
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
