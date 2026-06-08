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

// Lissajous-knotted capsule cluster — moves interestingly so time offsets produce distinct images
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 ab = b - a, ap = p - a;
  float t2 = clamp(dot(ap, ab) / dot(ab, ab), 0.0, 1.0);
  return length(ap - t2 * ab) - r;
}

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sceneSDF(vec3 p, float t) {
  // Lissajous space curve — the ratio 3:2 creates a knotted path
  float s  = t * 0.6;
  vec3 c   = vec3(0.55 * sin(s), 0.55 * sin(2.0 * s), 0.55 * cos(3.0 * s));
  vec3 c2  = vec3(0.55 * sin(s + 1.0), 0.40 * cos(s + 0.5), 0.40 * sin(2.0 * s + 0.7));

  float d1 = sdCapsule(p, c, c2, 0.20);
  float d2 = length(p - c)  - 0.22;
  float d3 = length(p - c2) - 0.16;
  return smin(smin(d1, d2, 0.15), d3, 0.12);
}

vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy, t) - sceneSDF(p - e.xyy, t),
    sceneSDF(p + e.yxy, t) - sceneSDF(p - e.yxy, t),
    sceneSDF(p + e.yyx, t) - sceneSDF(p - e.yyx, t)
  ));
}

float castRay(vec3 ro, vec3 rd, float t) {
  float dist = 0.1;
  for (int i = 0; i < 100; i++) {
    float h = sceneSDF(ro + rd * dist, t);
    if (h < 0.0006 * dist) return dist;
    dist += h * 0.85;
    if (dist > 8.0) break;
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

vec3 renderAt(vec2 uv, float t) {
  vec3 ro = vec3(0.0, 0.5, 3.0);
  vec3 rd = normalize(vec3(uv, -3.0));
  float dist = castRay(ro, rd, t);
  if (dist < 0.0) return vec3(0.0);
  vec3 pos = ro + rd * dist;
  vec3 nor = calcNormal(pos, t);
  return stdLight(pos, nor, rd);
}

vec3 render(vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

  // Base echo gap driven by amplitude
  float baseGap = 0.08 + u_amp * 0.45;

  // Spatial variation of the gap: horizontal axis by bass, vertical by treble
  // This means different screen regions live at different temporal offsets
  float spatialMod = uv.x * bass() * 0.30 - uv.y * treble() * 0.20;
  float gap = baseGap + spatialMod;

  // 4-sample composite with geometrically decreasing weights
  vec3 c0 = renderAt(uv, iTime);
  vec3 c1 = renderAt(uv, iTime - gap);
  vec3 c2 = renderAt(uv, iTime - gap * 2.0);
  vec3 c3 = renderAt(uv, iTime - gap * 3.0);

  return c0 * 0.50 + c1 * 0.28 + c2 * 0.14 + c3 * 0.08;
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
