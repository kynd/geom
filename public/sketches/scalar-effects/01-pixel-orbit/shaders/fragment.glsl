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

// Gyroid shell intersected with sphere
float sceneSDF(vec3 p) {
  float sc = 2.8;
  float gyroid = abs(dot(sin(p * sc), cos(p.yzx * sc))) / (sc * 1.733) - 0.06;
  float sphere = length(p) - 1.15;
  return max(gyroid, sphere);
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
  for (int i = 0; i < 128; i++) {
    float h = sceneSDF(ro + rd * t);
    if (abs(h) < 0.0004 * t) return t;
    t += h * 0.55;
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

  // Nominal camera
  vec3 ro = vec3(0.0, 0.6, 3.2);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);

  // Per-pixel camera displacement: screen angle → FFT bin → lateral offset
  float screenAng = atan(uv.y, uv.x);
  float normAng   = screenAng / 6.28318 + 0.5;
  float fval      = fftAt(normAng);
  float disp      = fval * (0.2 + u_amp * 1.4);

  // Displace camera in the plane spanned by uu and vv (perpendicular to view axis)
  vec3 dispDir = cos(screenAng) * uu + sin(screenAng) * vv;
  vec3 ro_pix  = ro + dispDir * disp;

  // Retarget toward scene center with slight screen-space lean
  vec3 rd = normalize(ta - ro_pix + (uv.x * uu + uv.y * vv) * 0.25);

  float t = castRay(ro_pix, rd);
  if (t < 0.0) return vec3(0.0);
  vec3 pos = ro_pix + rd * t;
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
