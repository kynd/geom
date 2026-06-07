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

// Rotate p around Y axis
vec3 rotY(vec3 p, float a) {
  float c = cos(a), s = sin(a);
  return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);
}

float sceneSDF(vec3 p) {
  p = rotY(p, iTime * 0.30);
  float r = length(p);
  if (r < 0.0001) return 0.7;
  vec3 dir = p / r;

  // Azimuthal angle [0,1]
  float az = atan(dir.z, dir.x) / 6.28318 + 0.5;
  // Elevation taper: full displacement at equator, zero at poles
  float taper = 1.0 - dir.y * dir.y;

  float fftVal = fftAt(az);
  float spike  = fftVal * u_amp * 1.6 * taper;
  return r - (0.60 + spike);
}

vec3 calcNormal(vec3 p) {
  vec2 e = vec2(0.0008, 0.0);
  return normalize(vec3(
    sceneSDF(p+e.xyy) - sceneSDF(p-e.xyy),
    sceneSDF(p+e.yxy) - sceneSDF(p-e.yxy),
    sceneSDF(p+e.yyx) - sceneSDF(p-e.yyx)
  ));
}

float castRay(vec3 ro, vec3 rd) {
  float t = 0.05;
  for (int i = 0; i < 160; i++) {
    float h = sceneSDF(ro + rd * t);
    if (abs(h) < 0.0005 * t) return t;
    t += h * 0.40;
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
  vec3 ro  = vec3(0.0, 0.4, 3.0);
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
