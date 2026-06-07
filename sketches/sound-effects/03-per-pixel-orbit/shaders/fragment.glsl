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

float sdTorus(vec3 p, float R, float r) {
  vec2 q = vec2(length(p.xz) - R, p.y);
  return length(q) - r;
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float sceneSDF(vec3 p) {
  // Slow rotation
  float a = iTime * 0.30;
  float c = cos(a), s = sin(a);
  p = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
  // Torus with gently pulsing tube
  float treble = fftAt(0.72) * u_amp;
  return sdTorus(p, 0.65, 0.22 + treble * 0.12);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sceneSDF(p+e.xyy) - sceneSDF(p-e.xyy),
    sceneSDF(p+e.yxy) - sceneSDF(p-e.yxy),
    sceneSDF(p+e.yyx) - sceneSDF(p-e.yyx)
  ));
}

float castRay(vec3 ro, vec3 rd) {
  float t = 0.1;
  for (int i = 0; i < 96; i++) {
    float h = sceneSDF(ro + rd * t);
    if (abs(h) < 0.0005) return t;
    t += h;
    if (t > 12.0) break;
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

// Per-pixel orbit: each pixel samples the scene from a shifted camera origin.
// The shift is derived from the screen-space polar angle, mapped to an FFT bin.
vec3 render(vec2 fragCoord) {
  vec2 uv  = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

  // Pixel polar angle on screen → FFT bin
  float screenAng = atan(uv.y, uv.x) / 6.28318 + 0.5;
  float screenR   = length(uv) / 1.778;  // normalise to [0, ~1] for 16:9
  float fftVal    = fftAt(screenAng) * u_amp;

  // Displacement magnitude grows with distance from center (edges shift more)
  float dispMag   = fftVal * 0.55 * screenR;

  // Displacement direction: perpendicular to the viewing axis, rotated by screen angle
  // plus a slow time drift so it doesn't look static
  float driftAng  = screenAng * 6.28318 + iTime * 0.15;
  vec2  disp2D    = vec2(cos(driftAng), sin(driftAng)) * dispMag;

  // Shift ray origin laterally (camera offset in world XY)
  vec3 ro = vec3(0.0 + disp2D.x, 0.4 + disp2D.y, 3.2);
  vec3 rd = normalize(vec3(uv, -3.0));

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
