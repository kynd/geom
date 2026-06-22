precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform int       u_surfaceIndex;
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

// INCLUDE_RIM_LIGHTING

// baseScalarF is provided by the (renamed) moving-scalar-functions content.
// surfaceF wraps it with deformP.
float baseScalarF(vec3 p);
float surfaceF(vec3 p);
// INCLUDE_SCALAR_MARCHER

const float PI = 3.14159265359;
// INCLUDE_DEFORM

// surfaceF definition — wraps deformP around the underlying function
float surfaceF(vec3 p) {
  vec3 dp = deformP(p);
  float f = baseScalarF(dp);
  if (u_deformMode == 1) f -= u_ampMono * u_deformP1;
  return f;
}

// INCLUDE_MOVING_SCALAR_FUNCTIONS

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

// Smooth normal using baseScalarF (no deformP) for spikes mode
vec3 calcNormalSmooth(vec3 pos) {
  const float eps = 0.002;
  const vec2 h = vec2(1.0, -1.0);
  return normalize(h.xyy * baseScalarF(pos + h.xyy * eps) +
                   h.yyx * baseScalarF(pos + h.yyx * eps) +
                   h.yxy * baseScalarF(pos + h.yxy * eps) +
                   h.xxx * baseScalarF(pos + h.xxx * eps));
}

vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
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
  return rimLight(pos, nor, rd, 100.0);  // open / periodic surfaces: no SSS
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
