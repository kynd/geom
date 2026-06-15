precision highp float;

uniform vec2 iResolution;
uniform int  u_ssaa;

const float PI = 3.14159265359;

// ── OKLCH ────────────────────────────────────────────────────────────────────

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
  for (int i = 0; i < 24; i++) {
    float mid = (lo + hi) * 0.5;
    if (inGamut(oklabToLinearRGB(L, mid * cos(H), mid * sin(H)))) lo = mid;
    else hi = mid;
  }
  return lo;
}

vec3 oklchGradient(vec2 coord) {
  // x → hue 0 – 2π, y → luminosity 0 – 1 (bottom = black, top = white)
  float H = (coord.x / iResolution.x) * 2.0 * PI;
  float L = coord.y / iResolution.y;
  float C = maxChroma(L, H);
  return clamp(oklabToLinearRGB(L, C * cos(H), C * sin(H)), 0.0, 1.0);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = oklchGradient(gl_FragCoord.xy + vec2(-0.25, -0.25));
    col += oklchGradient(gl_FragCoord.xy + vec2( 0.25, -0.25));
    col += oklchGradient(gl_FragCoord.xy + vec2(-0.25,  0.25));
    col += oklchGradient(gl_FragCoord.xy + vec2( 0.25,  0.25));
    col *= 0.25;
  } else {
    col = oklchGradient(gl_FragCoord.xy);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
