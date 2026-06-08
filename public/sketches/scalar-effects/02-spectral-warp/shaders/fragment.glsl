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

// Superellipsoid: (|x|^e + |y|^e + |z|^e)^(1/e) - r
// Good shape for warping — sharp edges at low e, round at e=2
float sdSuper(vec3 p, float e) {
  float ax = abs(p.x), ay = abs(p.y), az = abs(p.z);
  return pow(pow(ax, e) + pow(ay, e) + pow(az, e), 1.0 / e) - 0.70;
}

float sceneSDF(vec3 p) {
  // Slow world rotation
  float a = iTime * 0.25;
  float ca = cos(a), sa = sin(a);
  vec3 q = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);

  // Spectral warp: sum of 8 sinusoidal vector fields, one per FFT octave
  // Each component oscillates at a different spatial frequency and direction
  vec3 warp = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    float fi   = float(i) / 8.0;
    float fval = fftAt(fi);
    float sf   = 1.5 + fi * 5.0;          // spatial frequency grows with audio freq
    float ph   = float(i) * 0.7854;       // phase offset per band (pi/4 steps)
    float amt  = fval * (0.05 + u_amp * 0.25);

    // Each band pushes in a distinct direction rotated by phase
    warp.x += amt * sin(sf * q.y + ph);
    warp.y += amt * sin(sf * q.z + ph * 1.3);
    warp.z += amt * sin(sf * q.x + ph * 0.7);
  }

  vec3 wq = q + warp;
  float e = 2.5; // slightly rounded cube baseline
  return sdSuper(wq, e);
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
    if (abs(h) < 0.0005 * t) return t;
    t += h * 0.50;
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
  vec3 ro  = vec3(0.0, 0.8, 3.0);
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
