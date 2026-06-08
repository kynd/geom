precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform float u_amp;
uniform float u_fft[128];
uniform int   u_ssaa;

float fftAt(float t) {
  int i = int(clamp(t * 127.0, 0.0, 127.0));
  return u_fft[i];
}

float bass()   { return fftAt(0.04); }
float treble() { return fftAt(0.72); }
float mid()    { return fftAt(0.30); }

// 4D gyroid: cos(x)sin(y) + cos(y)sin(z) + cos(z)sin(w) + cos(w)sin(x) = 0
// Returns field value; zero set is the surface.
float gyroid4D(vec4 p) {
  return cos(p.x) * sin(p.y)
       + cos(p.y) * sin(p.z)
       + cos(p.z) * sin(p.w)
       + cos(p.w) * sin(p.x);
}

// Rotate in the XW plane of 4D space
vec4 rot4XW(vec4 p, float a) {
  float c = cos(a), s = sin(a);
  return vec4(c * p.x - s * p.w, p.y, p.z, s * p.x + c * p.w);
}

// Rotate in the YW plane
vec4 rot4YW(vec4 p, float a) {
  float c = cos(a), s = sin(a);
  return vec4(p.x, c * p.y - s * p.w, p.z, s * p.y + c * p.w);
}

// Rotate in the ZW plane
vec4 rot4ZW(vec4 p, float a) {
  float c = cos(a), s = sin(a);
  return vec4(p.x, p.y, c * p.z - s * p.w, s * p.z + c * p.w);
}

float sceneSDF(vec3 p) {
  // 3D rotation for viewing
  float a3d = iTime * 0.20;
  float ca = cos(a3d), sa = sin(a3d);
  vec3 q = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);

  // Embed 3D point into 4D (w starts at 0)
  vec4 p4 = vec4(q * 2.2, 0.0);

  // 4D rotation angles driven by audio + slow time drift
  float xwAngle = iTime * 0.35 + bass() * u_amp * 2.5;
  float ywAngle = iTime * 0.22 + treble() * u_amp * 2.0;
  float zwAngle = iTime * 0.18 + mid() * u_amp * 1.5;

  p4 = rot4XW(p4, xwAngle);
  p4 = rot4YW(p4, ywAngle);
  p4 = rot4ZW(p4, zwAngle);

  // Evaluate 4D gyroid; shell of thickness 0.12
  float g4 = gyroid4D(p4);
  float shell = abs(g4) / (2.2 * 1.733) - 0.055;

  // Bound to a 3D sphere so the field stays tractable
  float sphere = length(p) - 1.1;
  return max(shell, sphere);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
  ));
}

float castRay(vec3 ro, vec3 rd) {
  float t = 0.05;
  for (int i = 0; i < 160; i++) {
    float h = sceneSDF(ro + rd * t);
    if (abs(h) < 0.0004 * t) return t;
    t += h * 0.50;
    if (t > 8.0) break;
  }
  return -1.0;
}

vec3 stdLight(vec3 pos, vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);
  vec3 key = normalize(vec3(0.6, 1.0, 0.7));
  float dif = clamp(dot(nor, key), 0.0, 1.0) * 0.84;
  vec3 hal  = normalize(key - rd);
  float spe = pow(clamp(dot(nor, hal), 0.0, 1.0), 72.0) * 0.40;
  vec3 fill = normalize(vec3(-0.8, 0.3, 0.5));
  float dif2 = clamp(dot(nor, fill), 0.0, 1.0) * 0.28;
  float fre  = pow(clamp(1.0 + dot(nor, rd), 0.0, 1.0), 4.0);
  return mat * (0.13 + dif + dif2) + vec3(0.40) * spe + vec3(0.12, 0.18, 0.38) * 0.6 * fre;
}

vec3 render(vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  vec3 ro  = vec3(0.0, 0.5, 3.0);
  vec3 rd  = normalize(vec3(uv, -3.0));

  float t = castRay(ro, rd);
  if (t < 0.0) return vec3(0.0);
  vec3 pos = ro + rd * t;
  vec3 nor = calcNormal(pos);
  return stdLight(pos, nor, rd);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render(gl_FragCoord.xy + vec2(-0.25, -0.25));
    col += render(gl_FragCoord.xy + vec2( 0.25, -0.25));
    col += render(gl_FragCoord.xy + vec2(-0.25,  0.25));
    col += render(gl_FragCoord.xy + vec2( 0.25,  0.25));
    col *= 0.25;
  } else {
    col = render(gl_FragCoord.xy);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
