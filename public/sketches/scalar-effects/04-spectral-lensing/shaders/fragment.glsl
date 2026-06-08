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

// Torus SDF: major radius R, tube radius r
float sdTorus(vec3 p, float R, float r) {
  float q = length(vec2(length(p.xz) - R, p.y));
  return q - r;
}

// Nested torus knot-like shape: smooth union of torus + inner sphere
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float sceneSDF(vec3 p) {
  float a = iTime * 0.28;
  float ca = cos(a), sa = sin(a);
  vec3 q = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);

  float torus = sdTorus(q, 0.65, 0.28);
  float inner = sdTorus(vec3(q.x, q.z, q.y), 0.35, 0.12); // rotated torus
  return smin(torus, inner, 0.18);
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
  float t = 0.1;
  for (int i = 0; i < 120; i++) {
    float h = sceneSDF(ro + rd * t);
    if (h < 0.0005 * t) return t;
    t += h * 0.85;
    if (t > 10.0) break;
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
  vec3 ro  = vec3(0.0, 1.2, 3.2);
  vec3 rd  = normalize(vec3(uv, -3.0));

  // Spectral lensing: 8 FFT bands each bend the ray at their matching spatial frequency.
  // Low bands → broad slow bends; high bands → fine fast ripples.
  vec3 bend = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi  = float(i) / 8.0;
    float fv  = fftAt(fi);
    float sf  = 0.8 + fi * 4.0;           // spatial freq on screen
    float ph  = float(i) * 0.9;
    float amt = fv * (0.04 + u_amp * 0.10);

    // Transverse push orthogonal to the primary view axis
    bend.x += amt * sin(sf * uv.y + ph);
    bend.y += amt * cos(sf * uv.x + ph * 1.4);
  }
  // Also a radial focus/defocus from the overall amplitude
  vec2 uvLen = uv * u_amp * 0.08;
  bend.x += uvLen.x;
  bend.y += uvLen.y;

  rd = normalize(rd + bend);

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
