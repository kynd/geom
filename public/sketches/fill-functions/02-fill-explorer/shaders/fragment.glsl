precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_mode;
uniform int   u_ssaa;

const float PI = 3.14159265359;

// ── OKLCH color pipeline ──────────────────────────────────────────────────────

vec3 oklabToLinearRGB(float L, float a, float b) {
  float l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  float m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  float s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  float l  = l_ * l_ * l_;
  float m  = m_ * m_ * m_;
  float s  = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  );
}

bool inGamut(vec3 rgb) {
  return all(greaterThanEqual(rgb, vec3(-0.001))) &&
         all(lessThanEqual(rgb,    vec3( 1.001)));
}

float maxChroma(float L, float H) {
  float lo = 0.0, hi = 0.5;
  for (int i = 0; i < 20; i++) {
    float mid = (lo + hi) * 0.5;
    if (inGamut(oklabToLinearRGB(L, mid*cos(H), mid*sin(H)))) lo = mid;
    else hi = mid;
  }
  return lo;
}

vec3 lch(float L, float C, float H) {
  return clamp(oklabToLinearRGB(L, C*cos(H), C*sin(H)), 0.0, 1.0);
}

// Phase + log-magnitude → OKLCH with log-spaced lightness bands
vec3 domainColor(float phase, float logmag) {
  float band = 0.5 + 0.5 * cos(logmag / log(2.0) * 2.0 * PI);
  float L    = 0.18 + 0.70 * band;
  float C    = maxChroma(L, phase) * 0.92;
  return lch(L, C, phase);
}

// ── Complex arithmetic ───────────────────────────────────────────────────────

vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 cdiv(vec2 a, vec2 b) { float d = dot(b,b); return vec2(dot(a,b), a.y*b.x - a.x*b.y)/d; }

// Overflow-safe hyperbolic functions
float hcosh(float x) { float a = exp(min(abs(x), 80.0)); return (a + 1.0/a) * 0.5; }
float hsinh(float x) { float a = exp(min(abs(x), 80.0)); return sign(x) * (a - 1.0/a) * 0.5; }
vec2  csin(vec2 z) { return vec2(sin(z.x)*hcosh(z.y), cos(z.x)*hsinh(z.y)); }

vec2 cpow2(vec2 z) { return cmul(z, z); }
vec2 cpow4(vec2 z) { vec2 z2 = cpow2(z); return cmul(z2, z2); }
vec2 cpow5(vec2 z) { return cmul(cpow4(z), z); }

// Blaschke factor: (z - a) / (1 - conj(a)*z)
vec2 bF(vec2 z, vec2 a) {
  return cdiv(z - a, vec2(1.0,0.0) - cmul(vec2(a.x,-a.y), z));
}

// ── Mode 0 — Blaschke product ────────────────────────────────────────────────
// Two counter-rotating groups of 3 zeros inside the unit disk.
// Poles sit symmetrically outside; domain-colored by argument and log-magnitude.
vec3 mode0(vec2 uv, float t) {
  vec2 z = uv * 2.5;
  vec2 f = vec2(1.0, 0.0);
  for (int k = 0; k < 3; k++) {
    float ak = 2.0*PI*float(k)/3.0;
    f = cmul(f, bF(z, 0.42*vec2(cos(ak + t*0.25), sin(ak + t*0.25))));
    f = cmul(f, bF(z, 0.68*vec2(cos(ak - t*0.18), sin(ak - t*0.18))));
  }
  return domainColor(atan(f.y, f.x), log(max(length(f), 1e-10)));
}

// ── Mode 1 — Biomorphs ───────────────────────────────────────────────────────
// Iterating z → sin(z) + c a few times; domain-colored at the final position.
vec3 mode1(vec2 uv, float t) {
  vec2 z = uv * 1.1;
  vec2 c = 0.3 * vec2(cos(t*0.18), sin(t*0.13));
  for (int i = 0; i < 6; i++) {
    if (max(abs(z.x), abs(z.y)) > 30.0) break;
    z = csin(z) + c;
  }
  return domainColor(atan(z.y, z.x), log(max(length(z), 1e-7)));
}

// ── Mode 2 — Newton basins (z^5 − 1) ────────────────────────────────────────
// Five Newton steps toward the roots of unity; colored by nearest root.
vec3 mode2(vec2 uv, float t) {
  vec2 z = uv * 1.4;
  for (int i = 0; i < 5; i++) {
    vec2 denom = 5.0 * cpow4(z);
    if (dot(denom,denom) < 1e-12) break;
    z = z - cdiv(cpow5(z) - vec2(1.0,0.0), denom);
  }
  float minD  = 1e9;
  float nearH = 0.0;
  for (int k = 0; k < 5; k++) {
    float ang = 2.0*PI*float(k)/5.0;
    float d   = length(z - vec2(cos(ang), sin(ang)));
    if (d < minD) { minD = d; nearH = ang; }
  }
  float L = 0.20 + 0.65 * exp(-minD * 6.0);
  return lch(L, maxChroma(L, nearH) * 0.9, nearH);
}

// ── Mode 3 — L^p norm with spatially-varying p ───────────────────────────────
// Unit "circle" under L^p: square at p=1, circle at p=2, square at p→∞.
// p oscillates in space and time, deforming the metric field.
vec3 mode3(vec2 uv, float t) {
  float p = 2.0 + 1.4 * sin(uv.x*1.3 + t*0.22) * sin(uv.y*1.1 + t*0.17);
  p = max(p, 0.5);
  float ax = abs(uv.x), ay = abs(uv.y);
  float dp  = pow(pow(ax, p) + pow(ay, p), 1.0/p);
  float H   = atan(uv.y, uv.x);
  float band = 0.5 + 0.5 * cos(dp * 4.5 * PI);
  float L   = 0.15 + 0.72 * band;
  return lch(L, maxChroma(L, H) * 0.88, H);
}

// ── Mode 4 — Quasiperiodic interference ─────────────────────────────────────
// 7 plane waves at equal angular spacing; the sum never repeats exactly.
vec3 mode4(vec2 uv, float t) {
  float I = 0.0;
  for (int k = 0; k < 7; k++) {
    float ang = 2.0*PI*float(k)/7.0;
    I += cos(dot(vec2(cos(ang),sin(ang)), uv)*5.0 + float(k)*0.7 + t*0.25);
  }
  I /= 7.0; // [-1, 1]
  float H = I * PI + PI;
  float L = 0.25 + 0.55 * (0.5 + 0.5*I);
  return lch(L, maxChroma(L, H) * 0.88, H);
}

// ── Mode 5 — Chladni plate patterns ─────────────────────────────────────────
// Eigenfunctions of the square plate Laplacian; treated as a complex pair for domain coloring.
vec3 mode5(vec2 uv, float t) {
  vec2 p = uv * 0.85;
  float phi = t * 0.07;
  float re = cos(phi) * (sin(3.0*PI*p.x)*sin(5.0*PI*p.y) - sin(5.0*PI*p.x)*sin(3.0*PI*p.y));
  float im = sin(phi) * (sin(4.0*PI*p.x)*sin(7.0*PI*p.y) - sin(7.0*PI*p.x)*sin(4.0*PI*p.y));
  return domainColor(atan(im, re), log(max(length(vec2(re, im)), 1e-7)));
}

// ── Mode 6 — Complex logarithm spirals ──────────────────────────────────────
// w = ln(z) unwraps circles into lines; sin/cos applied to w produce log-spaced spirals.
vec3 mode6(vec2 uv, float t) {
  float r = max(length(uv), 1e-5);
  vec2 w   = vec2(log(r), atan(uv.y, uv.x)); // complex log
  float a  = 3.0 + 0.5*sin(t*0.12);
  float b  = 5.0 + 0.5*cos(t*0.09);
  float re = sin(w.x*a + w.y*b + t*0.2);
  float im = cos(w.x*b - w.y*a + t*0.15);
  return domainColor(atan(im, re), log(max(length(vec2(re,im)), 1e-7)));
}

// ── Mode 7 — Lyapunov exponents ─────────────────────────────────────────────
// Logistic map alternates growth rates r_x and r_y by sequence AABAB.
// Positive exponent = chaos; negative = stability.
vec3 mode7(vec2 uv, float t) {
  float aspect = iResolution.x / iResolution.y;
  float rx = clamp(2.5 + (uv.x/aspect + 1.0) * 0.75, 0.0, 4.0);
  float ry = clamp(2.5 + (uv.y        + 1.0) * 0.75, 0.0, 4.0);
  float x  = 0.5;
  for (int i = 0; i < 10; i++) { // warmup
    int s = int(mod(float(i), 5.0));
    float r = (s == 2 || s == 4) ? ry : rx;
    x = r * x * (1.0 - x);
    x = clamp(x, 1e-6, 1.0 - 1e-6);
  }
  float lam = 0.0;
  for (int i = 0; i < 30; i++) {
    int s = int(mod(float(i), 5.0));
    float r = (s == 2 || s == 4) ? ry : rx;
    x = r * x * (1.0 - x);
    x = clamp(x, 1e-6, 1.0 - 1e-6);
    lam += log(max(abs(r * (1.0 - 2.0*x)), 1e-7));
  }
  lam /= 30.0;
  float norm = clamp(lam / 2.0, -1.0, 1.0);
  // Warm hue for chaos (positive), cool for stability (negative)
  float H = norm > 0.0 ? mix(0.1, 0.6, norm) : mix(3.8, 4.5, -norm);
  float L = 0.20 + 0.50 * (0.5 + 0.5*norm);
  return lch(L, maxChroma(L, H) * 0.85, H);
}

// ── Mode 8 — Jacobi elliptic approximation ───────────────────────────────────
// Nested trig approximates doubly-periodic elliptic functions on a torus.
vec3 mode8(vec2 uv, float t) {
  vec2 p   = uv * 1.8;
  float al = 0.5 + 0.3*sin(t*0.14);
  float be = 0.6 + 0.3*cos(t*0.11);
  float re = sin(p.x + al*sin(p.y)) * cos(p.y + be*cos(p.x));
  float im = cos(p.x + be*cos(p.y)) * sin(p.y + al*sin(p.x));
  return domainColor(atan(im, re), log(max(length(vec2(re,im)), 1e-7)));
}

// ── Mode 9 — Fresnel phase rings ─────────────────────────────────────────────
// Phase e^(iπkr²) of a spherical wavefront; angular modulation breaks circular symmetry.
vec3 mode9(vec2 uv, float t) {
  float r2  = dot(uv, uv);
  float k   = 6.0 + 1.5*sin(t*0.12);
  float phi = PI * r2 * k + t * 0.4 + 1.5*sin(atan(uv.y,uv.x)*3.0 + t*0.2);
  float H   = mod(phi, 2.0*PI);
  float L   = 0.30 + 0.50 * (0.5 + 0.5*cos(phi * sqrt(2.0)));
  return lch(L, maxChroma(L, H) * 0.9, H);
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

vec3 fill(vec2 uv, float t) {
  if (u_mode == 0) return mode0(uv, t);
  if (u_mode == 1) return mode1(uv, t);
  if (u_mode == 2) return mode2(uv, t);
  if (u_mode == 3) return mode3(uv, t);
  if (u_mode == 4) return mode4(uv, t);
  if (u_mode == 5) return mode5(uv, t);
  if (u_mode == 6) return mode6(uv, t);
  if (u_mode == 7) return mode7(uv, t);
  if (u_mode == 8) return mode8(uv, t);
  return mode9(uv, t);
}

vec2 toUV(vec2 fc) {
  return (fc * 2.0 - iResolution.xy) / iResolution.y;
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = fill(toUV(gl_FragCoord.xy + vec2(-0.25,-0.25)), iTime);
    col += fill(toUV(gl_FragCoord.xy + vec2( 0.25,-0.25)), iTime);
    col += fill(toUV(gl_FragCoord.xy + vec2(-0.25, 0.25)), iTime);
    col += fill(toUV(gl_FragCoord.xy + vec2( 0.25, 0.25)), iTime);
    col *= 0.25;
  } else {
    col = fill(toUV(gl_FragCoord.xy), iTime);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
