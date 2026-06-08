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

// Superellipsoid SDF (morph between octahedron and sphere driven by midrange)
float sdSuperellipsoid(vec3 p, float e) {
  // |x|^e + |y|^e + |z|^e = 1
  // Approximated via Newton's method for the surface
  // Simpler: use box-sphere blend
  float box    = max(max(abs(p.x), abs(p.y)), abs(p.z)) - 0.55;
  float sphere = length(p) - 0.68;
  return mix(sphere, box, clamp(e, 0.0, 1.0));
}

float sceneSDF(vec3 p, float t) {
  // Rotation speed varies mildly with mid energy
  float mid  = fftAt(0.22);
  float spd  = 0.28 + mid * u_amp * 0.30;
  float a    = t * spd;
  float c = cos(a), s = sin(a);
  p = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z);

  // Tilt on X axis — driven by treble
  float treble = fftAt(0.72) * u_amp * 0.6;
  float cx = cos(treble), sx = sin(treble);
  p = vec3(p.x, cx*p.y - sx*p.z, sx*p.y + cx*p.z);

  float mid2 = fftAt(0.22) * u_amp;
  return sdSuperellipsoid(p, mid2 * 0.9);
}

vec3 calcNormal(vec3 p, float t) {
  vec2 e = vec2(0.001, 0.0);
  return normalize(vec3(
    sceneSDF(p+e.xyy, t) - sceneSDF(p-e.xyy, t),
    sceneSDF(p+e.yxy, t) - sceneSDF(p-e.yxy, t),
    sceneSDF(p+e.yyx, t) - sceneSDF(p-e.yyx, t)
  ));
}

float castRay(vec3 ro, vec3 rd, float t) {
  float dist = 0.1;
  for (int i = 0; i < 96; i++) {
    float h = sceneSDF(ro + rd * dist, t);
    if (abs(h) < 0.0005) return dist;
    dist += h;
    if (dist > 12.0) break;
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

vec3 renderAt(vec2 fragCoord, float t, float weight) {
  vec2 uv = (fragCoord * 2.0 - iResolution.xy) / iResolution.y;
  vec3 ro  = vec3(0.0, 0.3, 3.0);
  vec3 rd  = normalize(vec3(uv, -3.0));

  float dist = castRay(ro, rd, t);
  if (dist < 0.0) return vec3(0.0);
  vec3 pos = ro + rd * dist;
  vec3 nor = calcNormal(pos, t);
  return stdLight(nor, rd) * weight;
}

vec3 render(vec2 fragCoord) {
  // Echo gap scales with amplitude: tight at silence, wide at peak
  float gap = 0.06 + u_amp * 0.50;

  vec3 col = vec3(0.0);
  // 4 echoes: weights decrease exponentially
  col += renderAt(fragCoord, iTime,            1.00);
  col += renderAt(fragCoord, iTime - gap,       0.55);
  col += renderAt(fragCoord, iTime - gap*2.0,   0.28);
  col += renderAt(fragCoord, iTime - gap*3.0,   0.12);

  // Normalise so echoes don't blow out white
  col /= 1.00 + 0.55 + 0.28 + 0.12;
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
