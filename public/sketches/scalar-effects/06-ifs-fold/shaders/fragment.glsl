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

float mid()  { return fftAt(0.25); }

// IFS folded SDF — octahedron + box folds iterated n times
// Based on Mandelbox-adjacent folding: each fold creates mirror copies
float sceneSDF(vec3 p) {
  float a = iTime * 0.18;
  float ca = cos(a), sa = sin(a);
  vec3 q = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);

  // Fold parameters driven by audio
  int   nFolds  = 1 + int(u_amp * 5.5);   // 1–6 iterations
  float scale   = 1.8 + mid() * 0.9;      // scale per fold: 1.8–2.7
  float offset  = 0.85;                    // fold offset (kept constant for stability)

  float r = 1.0; // scale accumulator for correct distance normalization
  vec3 z = q;

  for (int i = 0; i < 7; i++) {
    if (i >= nFolds) break;

    // Octahedron fold: reflect across each face plane (|x|+|y|+|z|=1 type)
    z = abs(z);
    if (z.x < z.y) z.xy = z.yx;
    if (z.x < z.z) z.xz = z.zx;
    if (z.y < z.z) z.yz = z.zy;

    // Box fold: clamp and reflect (Mandelbox-style)
    z = clamp(z, -offset, offset) * 2.0 - z;

    // Scale and translate
    z = z * scale - vec3(offset) * (scale - 1.0);
    r *= scale;
  }

  // SDF on the folded domain — sphere at origin
  float d = (length(z) - 0.55) / r;
  return d;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0008, 0.0);
  return normalize(vec3(
    sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
    sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
    sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
  ));
}

float castRay(vec3 ro, vec3 rd) {
  float t = 0.05;
  for (int i = 0; i < 200; i++) {
    float h = sceneSDF(ro + rd * t);
    if (abs(h) < 0.0003 * t) return t;
    t += h * 0.55;
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
  vec3 ro  = vec3(0.0, 0.5, 4.0);
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
