precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform float     u_ampL;
uniform float     u_ampR;
uniform int       u_ssaa;
uniform sampler2D u_histTex;
uniform vec3      u_ro;
uniform int       u_shape;    // 0=tube  1=sphere  2=cone
uniform float     u_radius;
uniform float     u_height;   // half-length for tube/cone (ignored for sphere)
uniform float     u_bump;     // max radial displacement from sound
uniform int       u_lighting; // 0=flash  1=rim  2=hue

const float PI    = 3.14159265359;
// Fixed world-space azimuth where the "current moment" face sits.
// Matches the initial camera direction atan(5.5,2.8) so the front
// face shows the newest data on load; orbiting reveals older frames.
const float T_CAM = 1.0997;

float sceneSDF(vec3 p);
// INCLUDE_SDF_MARCHER
// INCLUDE_LIGHTING

vec3 hsvToRgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// Shared texture lookup — freq (0=bass, 1=treble) and bump height h.
void sampleTex(vec3 p, out float freq, out float h) {
  float theta    = atan(p.z, p.x);
  float age_frac = mod(T_CAM - theta, 2.0 * PI) / (2.0 * PI);
  if (u_shape == 1) {
    // Sphere: latitude-based frequency
    freq = clamp(p.y / max(u_radius, 0.001) * 0.5 + 0.5, 0.0, 1.0);
  } else {
    float L = max(u_height, 0.001);
    freq = clamp((p.y + L) / (2.0 * L), 0.0, 1.0);
  }
  h = texture2D(u_histTex, vec2(freq, 1.0 - age_frac)).r;
}

float tubeSDF(vec3 p) {
  float L = u_height;
  float R = u_radius;
  float r = length(p.xz);
  float freq, h;
  sampleTex(p, freq, h);
  vec2 q = vec2(r - (R + u_bump * h), abs(p.y) - L);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0));
}

float sphereSDF(vec3 p) {
  float freq, h;
  sampleTex(p, freq, h);
  return length(p) - (u_radius + u_bump * h);
}

float coneSDF(vec3 p) {
  float L  = u_height;
  float Rb = u_radius;
  float r  = length(p.xz);
  float freq, h;
  sampleTex(p, freq, h);
  // Cone: tip at y=+L, base (radius Rb) at y=-L.
  // yc clamps so exterior points project onto the nearest cap.
  float yc    = clamp(p.y, -L, L);
  float Reff  = Rb * (L - yc) / max(2.0 * L, 0.001);
  float Rfull = Reff + u_bump * h;
  bool inside = r < Rfull && p.y > -L && p.y < L;
  float d     = length(vec2(r - Rfull, p.y - yc));
  return inside ? -d : d;
}

float sceneSDF(vec3 p) {
  if (u_shape == 1) return sphereSDF(p);
  if (u_shape == 2) return coneSDF(p);
  return tubeSDF(p);
}

// ── Lighting modes ────────────────────────────────────────────────────────────

vec3 flashLight(vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);
  float a1  = iTime * 3.5;
  vec3  ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  float d1  = max(dot(nor, ld1), 0.0);
  vec3  h1  = normalize(ld1 - rd);
  float s1  = pow(max(dot(nor, h1), 0.0), 56.0);
  vec3 col1 = mat * d1 * 0.85 + vec3(0.45) * s1 * 0.45;
  float a2  = iTime * 2.1 + 1.9;
  vec3  ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  float d2  = max(dot(nor, ld2), 0.0);
  vec3  h2  = normalize(ld2 - rd);
  float s2  = pow(max(dot(nor, h2), 0.0), 56.0);
  vec3 col2 = mat * d2 * 0.85 + vec3(0.45) * s2 * 0.45;
  float ampL2 = u_ampL * u_ampL;
  float ampR2 = u_ampR * u_ampR;
  return col1 * max(ampL2, 0.08) + col2 * max(ampR2, 0.02);
}

// Back-rim: dark front with a strong Fresnel glow, modulated by a directional
// back-light so the rim wraps around the shadow side of the silhouette.
vec3 rimLight(vec3 nor, vec3 rd) {
  float viewDot = max(dot(nor, -rd), 0.0);

  // Near-black ambient so the front face reads as dark
  vec3 col = vec3(0.88) * viewDot * 0.06;

  // Subtle key diffuse for shape legibility
  vec3  lk = normalize(vec3(0.6, 1.0, 0.7));
  col += vec3(0.88) * max(dot(nor, lk), 0.0) * 0.10;

  // Fresnel rim — strongest at silhouette edges
  float fr = pow(1.0 - viewDot, 2.5);

  // Weight by back-light direction (behind camera) so the rim is
  // brightest where the surface is about to turn away from us
  vec3  backDir = normalize(-u_ro + vec3(0.0, 0.4, 0.0));
  float backW   = max(dot(-nor, backDir) * 0.5 + 0.5, 0.0);

  col += vec3(0.35, 0.65, 1.0) * fr * backW * 3.0;
  return col;
}

// Hue: same structure as stdLighting but with frequency-mapped colour.
vec3 hueLight(vec3 nor, vec3 rd, float freq) {
  vec3 col = hsvToRgb(vec3(freq * 0.82, 0.85, 1.0));

  // Key light
  vec3  lk = normalize(vec3(0.6, 1.0, 0.7));
  float dk = max(dot(nor, lk), 0.0);

  // Fill light
  vec3  lf = normalize(vec3(-0.8, 0.3, 0.5));
  float df = max(dot(nor, lf), 0.0) * 0.28;

  vec3 result = col * (0.13 + dk * 0.84 + df);

  // Specular (white, same as stdLighting)
  vec3 hv = normalize(lk - rd);
  result += vec3(0.40) * pow(max(dot(nor, hv), 0.0), 72.0);

  // Fresnel rim (tinted toward hue)
  float fr = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);
  result += (col * 0.5 + vec3(0.12, 0.18, 0.38) * 0.5) * fr * 0.6;

  return result;
}

// ── Render ────────────────────────────────────────────────────────────────────

vec3 render3D(vec2 uv) {
  vec3 ro = u_ro;
  vec3 ta = vec3(0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);
  float t; vec3 nor;
  if (!castRay(ro, rd, t, nor)) return vec3(0.0);
  if (dot(nor, -rd) < 0.0) nor = -nor;
  vec3 pos = ro + t * rd;

  if (u_lighting == 2) {
    float freq, h;
    sampleTex(pos, freq, h);
    return hueLight(nor, rd, freq);
  }
  if (u_lighting == 1) return rimLight(nor, rd);
  return flashLight(nor, rd);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25,-0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,-0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25, 0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, 0.25))*2.0 - iResolution.xy)/iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
