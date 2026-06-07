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
float mid()    { return fftAt(0.22); }
float treble() { return fftAt(0.72); }

// Box fold: clamp then reflect
vec3 boxFold(vec3 p, float sz) {
  return clamp(p, -sz, sz) * 2.0 - p;
}
// Sphere fold: reflect inside inner sphere, scale near it
vec3 sphereFold(vec3 p, float minR, float fixedR) {
  float r2 = dot(p, p);
  float m  = fixedR * fixedR / max(r2, minR * minR);
  return p * m;
}

float mandelbox(vec3 pos) {
  float bassE   = bass() * u_amp;
  float midE    = mid()  * u_amp;

  // Scale driven by bass: 1.9 (quiet) to 2.8 (loud)
  float sc      = 1.90 + bassE * 0.90;
  // Fold size shrinks slightly with mid
  float foldSz  = 1.0 - midE * 0.25;
  float minR    = 0.30;
  float fixedR  = 1.0;

  vec3 p   = pos;
  float dr = 1.0;

  for (int i = 0; i < 8; i++) {
    p  = boxFold(p, foldSz);
    p  = sphereFold(p, minR, fixedR);
    p  = p * sc + pos;
    dr = dr * abs(sc) + 1.0;
  }
  return (length(p) - abs(sc - 1.0) * (float(1) - pow(abs(sc), -8.0)) / (abs(sc) - 1.0)) / abs(dr);
}

float sceneSDF(vec3 p) {
  // Slow rotation around Y
  float a  = iTime * 0.20;
  float c  = cos(a), s = sin(a);
  p = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
  // Scale the domain so the object fits in view
  return mandelbox(p * 0.5) * 0.5;
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(
    sceneSDF(p+e.xyy) - sceneSDF(p-e.xyy),
    sceneSDF(p+e.yxy) - sceneSDF(p-e.yxy),
    sceneSDF(p+e.yyx) - sceneSDF(p-e.yyx)
  ));
}

float castRay(vec3 ro, vec3 rd) {
  float t = 0.1;
  for (int i = 0; i < 128; i++) {
    float h = sceneSDF(ro + rd * t);
    if (abs(h) < 0.0010 * t) return t;
    t += h * 0.55;
    if (t > 14.0) break;
  }
  return -1.0;
}

vec3 stdLight(vec3 nor, vec3 rd) {
  vec3 mat     = vec3(0.88);
  vec3 keyDir  = normalize(vec3(0.6, 1.0, 0.7));
  float dif    = clamp(dot(nor, keyDir), 0.0, 1.0) * 0.84;
  vec3  hal    = normalize(keyDir - rd);
  float spe    = pow(clamp(dot(nor, hal), 0.0, 1.0), 72.0);
  vec3  fillDir = normalize(vec3(-0.8, 0.3, 0.5));
  float dif2   = clamp(dot(nor, fillDir), 0.0, 1.0) * 0.28;
  vec3  col    = mat * (0.13 + dif + dif2) + vec3(0.40) * spe;
  float fre    = pow(clamp(1.0 + dot(nor, rd), 0.0, 1.0), 4.0);
  col += vec3(0.12, 0.18, 0.38) * 0.6 * fre;
  return col;
}

vec3 render(vec2 fragCoord) {
  vec2 uv  = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  vec3 ro  = vec3(0.0, 0.3, 3.5);
  vec3 rd  = normalize(vec3(uv, -3.0));

  vec3 col = vec3(0.0);
  float t  = castRay(ro, rd);
  if (t > 0.0) {
    vec3 pos = ro + rd * t;
    vec3 nor = calcNormal(pos);
    col = stdLight(nor, rd);
  }
  return col;
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    vec2 offs[4];
    offs[0] = vec2(-0.25, -0.25);
    offs[1] = vec2( 0.25, -0.25);
    offs[2] = vec2(-0.25,  0.25);
    offs[3] = vec2( 0.25,  0.25);
    col = vec3(0.0);
    for (int s = 0; s < 4; s++) col += render(gl_FragCoord.xy + offs[s]);
    col *= 0.25;
  } else {
    col = render(gl_FragCoord.xy);
  }
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}
