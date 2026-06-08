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

// Row of spheres along X — camera sees a different height per column
float sdSphere(vec3 p, float r) { return length(p) - r; }

float sceneSDF(vec3 p) {
  // One sphere at origin; column effect comes from camera, not scene
  return sdSphere(p, 0.45);
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

vec3 render(vec2 fragCoord) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;

  // Map x screen position to FFT bin [0,1]
  float xNorm   = uv.x / 1.778 * 0.5 + 0.5;  // screen x → [0,1]
  float fftVal  = fftAt(xNorm) * u_amp;

  // Camera tilts up by fftVal, then adds a slow oscillation
  float tiltY   = fftVal * 1.20;

  // Also compress the sphere vertically based on fft:
  // when a column's FFT bin is loud, the camera aims higher,
  // revealing the top of the sphere. When quiet, it looks straight on.

  // Build camera look-at: standard position, look toward offset target
  vec3 ro  = vec3(0.0, 0.0, 3.0);
  vec3 ta  = vec3(0.0, tiltY, 0.0);
  vec3 ww  = normalize(ta - ro);
  vec3 uu  = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv  = cross(uu, ww);
  vec3 rd  = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);

  // Background: draw a subtle grid to visualise the column structure
  // Columns boundaries glow slightly
  float colW    = 1.778 / 128.0;
  float colFrac = fract(uv.x / colW + 0.5) - 0.5;
  float gridLine = smoothstep(0.45, 0.40, abs(colFrac)) * 0.04 * fftVal;

  vec3 col = vec3(gridLine);
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
