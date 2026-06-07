precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform float u_amp;
uniform float u_ampL;
uniform float u_ampR;
uniform float u_fft[128];
uniform int   u_surface;
uniform int   u_ssaa;

// ---- helpers -------------------------------------------------------

float fftAt(float norm) {
  int i = int(clamp(norm * 128.0, 0.0, 127.0));
  return u_fft[i];
}

float bass()  { return fftAt(0.04); }
float mid()   { return fftAt(0.20); }
float treble(){ return fftAt(0.70); }

// ---- scalar field definitions --------------------------------------
// All surfaces intersect zero. Camera-facing normal is ensured by
// the marcher. Each field is evaluated in rotated coords q.

float field(vec3 q, float t) {
  float x = q.x, y = q.y, z = q.z;
  float r2 = x*x + y*y + z*z;
  float r  = sqrt(r2);
  float b  = bass(), m  = mid(), tr = treble(), a = u_amp;

  // 1 — ripple sphere: pulsing concentric shells
  if (u_surface == 1) {
    float freq = 4.0 + m * 6.0;
    return r - 0.7 - 0.18 * sin(freq * r - t * 3.0) * (0.3 + a * 0.7);
  }

  // 2 — bass bloom: sphere that inflates on kick
  if (u_surface == 2) {
    return r - 0.55 - b * 0.55;
  }

  // 3 — audio torus: major radius driven by bass, minor by treble
  if (u_surface == 3) {
    float R = 0.55 + b * 0.35;
    float rxy = sqrt(x*x + z*z) - R;
    return rxy*rxy + y*y - (0.12 + tr * 0.14) * (0.12 + tr * 0.14);
  }

  // 4 — standing wave surface: y = A*sin(kx)*cos(kz)
  if (u_surface == 4) {
    float k = 2.5 + m * 2.0;
    float A = 0.22 + a * 0.30;
    return y - A * sin(k * x) * cos(k * z);
  }

  // 5 — spectral ridges: each freq band lifts a ring of terrain
  if (u_surface == 5) {
    float h = 0.0;
    for (int i = 0; i < 8; i++) {
      float fi = float(i);
      float ri = 0.15 + fi * 0.10;
      float rr = sqrt(x*x + z*z) - ri;
      h += fftAt(fi / 8.0) * exp(-rr*rr * 18.0) * 0.28;
    }
    return y - h;
  }

  // 6 — monkey saddle with bass twist: y = x^3 - 3xz^2, amplitude by bass
  if (u_surface == 6) {
    float A = 0.5 + b * 0.6;
    return y - A * (x*x*x - 3.0*x*z*z);
  }

  // 7 — hyperboloid breathing: x²+z²-y² = R(t)
  if (u_surface == 7) {
    return x*x + z*z - y*y - (0.35 + a * 0.40);
  }

  // 8 — treble fog sphere: small high-freq bumps on sphere surface
  if (u_surface == 8) {
    float base = r - 0.65;
    float theta = atan(z, x);
    float phi   = acos(clamp(y / max(r, 0.001), -1.0, 1.0));
    float bumps = tr * 0.18 * sin(12.0 * theta) * sin(8.0 * phi);
    return base - bumps;
  }

  // 9 — Lissajous knot surface: implicit tube around a space curve
  if (u_surface == 9) {
    float s = t * 0.4;
    vec3 c = vec3(0.5 * sin(s + m * 1.0),
                  0.5 * sin(2.0*s + b * 1.5),
                  0.5 * cos(3.0*s));
    vec3 d = q - c;
    return dot(d, d) - (0.10 + tr * 0.08) * (0.10 + tr * 0.08);
  }

  // 10 — capsule cluster: union of amp-scaled capsules along axes
  if (u_surface == 10) {
    float radius = 0.18 + a * 0.22;
    float len = 0.50;
    float dx = length(vec2(y, z)) - radius; float cx = abs(x) - len;
    float dy = length(vec2(x, z)) - radius; float cy = abs(y) - len;
    float dz = length(vec2(x, y)) - radius; float cz = abs(z) - len;
    float sdX = length(vec2(max(cx, 0.0), max(dx, 0.0))) + min(max(cx, dx), 0.0);
    float sdY = length(vec2(max(cy, 0.0), max(dy, 0.0))) + min(max(cy, dy), 0.0);
    float sdZ = length(vec2(max(cz, 0.0), max(dz, 0.0))) + min(max(cz, dz), 0.0);
    return min(sdX, min(sdY, sdZ));
  }

  // 11 — complex |z|=1 shell: |x+iy|^n + |z|^2 surface in 3D embedding
  if (u_surface == 11) {
    float n = 2.0 + b * 3.0;
    float rxy = sqrt(x*x + y*y);
    float ang = atan(y, x) * n;
    float cx = rxy * cos(ang), cy = rxy * sin(ang);
    return sqrt(cx*cx + cy*cy + z*z) - (0.60 + a * 0.20);
  }

  // 12 — Steiner surface: x²y² + y²z² + z²x² = r⁴ (roman surface)
  if (u_surface == 12) {
    float R4 = (0.28 + a * 0.18);
    R4 = R4 * R4 * R4 * R4;
    return x*x*y*y + y*y*z*z + z*z*x*x - R4;
  }

  // 13 — frequency spiral: tube wrapping a helix, pitch from bass
  if (u_surface == 13) {
    float pitch = 0.20 + b * 0.22;
    float angle = atan(z, x);
    float wrapped_y = mod(y + pitch * 10.0, pitch * 2.0) - pitch;
    float rx = sqrt(x*x + z*z) - (0.45 + m * 0.20);
    return rx*rx + wrapped_y*wrapped_y - (0.08 + tr * 0.08) * (0.08 + tr * 0.08);
  }

  // 14 — superellipsoid with audio exponent
  if (u_surface == 14) {
    float e = 1.0 + b * 3.0;
    float ax = abs(x), ay = abs(y), az = abs(z);
    return pow(pow(ax, e) + pow(ay, e) + pow(az, e), 1.0/e) - 0.65;
  }

  // 15 — Scherk minimal surface variant: cos(ay)=cos(ax)*cos(az)
  if (u_surface == 15) {
    float sc = 1.8 + m * 1.2;
    return cos(sc * y) - cos(sc * x) * cos(sc * z) - (a * 0.15);
  }

  // 16 — imaginary part of z^3: Im((x+iy)^3) = 3x^2*y - y^3
  if (u_surface == 16) {
    float A = 0.45 + b * 0.40;
    return y - A * (3.0*x*x*y - y*y*y);
  }

  // 17 — Bohemian dome: (x²+y²) + z² = r² + 2r*cos(theta)*z modulation
  if (u_surface == 17) {
    float freq = 3.0 + tr * 5.0;
    float amp2 = 0.20 + a * 0.30;
    return r2 - 0.6 - amp2 * cos(freq * atan(z, x));
  }

  // 18 — nested shells, each driven by a different FFT band
  if (u_surface == 18) {
    float s1 = abs(r - 0.30 - fftAt(0.10) * 0.25);
    float s2 = abs(r - 0.55 - fftAt(0.35) * 0.25);
    float s3 = abs(r - 0.80 - fftAt(0.65) * 0.25);
    return min(s1, min(s2, s3)) - 0.04;
  }

  // 19 — amplitude-gated gyroid: cos(x)sin(y)+cos(y)sin(z)+cos(z)sin(x) = 0
  if (u_surface == 19) {
    float sc = 2.8 + m * 1.5;
    return cos(sc*x)*sin(sc*y) + cos(sc*y)*sin(sc*z) + cos(sc*z)*sin(sc*x) - (a * 0.5 - 0.25);
  }

  // 20 — audio Kuen surface approximation: parametric saddle with bass height
  if (u_surface == 20) {
    float sc = 1.4 + tr * 0.8;
    float h = 0.35 + b * 0.40;
    return y*y + (x*x + z*z - h*h) * (x*x + z*z) - sc * x * z * (x*x - z*z);
  }

  return 1e10;
}

// ---- scalar marcher ------------------------------------------------

float surfaceF(vec3 p);

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b*b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b-h, -b+h);
}

vec3 calcNormal(vec3 p) {
  const float eps = 0.002;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * surfaceF(p + k.xyy*eps) +
    k.yyx * surfaceF(p + k.yyx*eps) +
    k.yxy * surfaceF(p + k.yxy*eps) +
    k.xxx * surfaceF(p + k.xxx*eps)
  );
}

bool castRay(vec3 ro, vec3 rd, out float t, out vec3 nor) {
  vec2 tb = raySphere(ro, rd, 1.7);
  if (tb.x > tb.y) return false;
  float tMin = max(tb.x, 0.01);
  float tMax = tb.y;
  float dt = 0.012;
  t = tMin;
  float prevF = surfaceF(ro + rd * t);
  for (int i = 0; i < 280; i++) {
    t += dt;
    if (t > tMax) return false;
    float F = surfaceF(ro + rd * t);
    if (prevF * F < 0.0) {
      float t0 = t-dt, t1 = t, F0 = prevF;
      for (int j = 0; j < 8; j++) {
        float tm = 0.5*(t0+t1);
        float Fm = surfaceF(ro + rd * tm);
        if (F0 * Fm <= 0.0) { t1 = tm; }
        else                { t0 = tm; F0 = Fm; }
      }
      t   = 0.5*(t0+t1);
      nor = calcNormal(ro + rd * t);
      if (dot(nor, -rd) < 0.0) nor = -nor;
      return true;
    }
    prevF = F;
  }
  return false;
}

float surfaceF(vec3 p) {
  float a = iTime * 0.22;
  float ca = cos(a), sa = sin(a);
  vec3 q = vec3(ca*p.x + sa*p.z, p.y, -sa*p.x + ca*p.z);
  return field(q, iTime);
}

// ---- lighting ------------------------------------------------------

vec3 stdLight(vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);
  vec3 key = normalize(vec3(0.6, 1.0, 0.7));
  float diff = max(dot(nor, key), 0.0) * 0.84;
  vec3 half1 = normalize(key - rd);
  float spec = pow(max(dot(nor, half1), 0.0), 72.0) * 0.40;
  vec3 fill = normalize(vec3(-0.8, 0.3, 0.5));
  float diff2 = max(dot(nor, fill), 0.0) * 0.28;
  float NdotV = abs(dot(nor, -rd));
  vec3 rim = vec3(0.12, 0.18, 0.38) * 0.6 * pow(1.0 - NdotV, 4.0);
  return mat * (0.13 + diff + diff2) + vec3(0.40) * spec + rim;
}

vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x*uu + uv.y*vv + 3.0*ww);

  float t; vec3 nor;
  if (!castRay(ro, rd, t, nor)) return vec3(0.0);
  return stdLight(nor, rd);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25,-0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,-0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25, 0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, 0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
