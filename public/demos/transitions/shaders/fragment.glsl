precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_ssaa;
uniform float u_tStart;
uniform float u_tEnd;
uniform float u_waveSpeed;
uniform int   u_render;

const float PI = 3.14159265359;

float tanhApprox(float x) {
  float ex = exp(x);
  float emx = exp(-x);
  return (ex - emx) / (ex + emx);
}

// --- OKLCH Pipeline ---

vec3 oklabToLinear(float L, float a, float b) {
  float l_ = L + 0.3963377774*a + 0.2158037573*b;
  float m_ = L - 0.1055613458*a - 0.0638541728*b;
  float s_ = L - 0.0894841775*a - 1.2914855480*b;
  float l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  return vec3(
     4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
  );
}

bool inGamut(vec3 rgb) {
  return (rgb.r >= -0.001 && rgb.r <= 1.001 &&
          rgb.g >= -0.001 && rgb.g <= 1.001 &&
          rgb.b >= -0.001 && rgb.b <= 1.001);
}

float maxChroma(float L, float H) {
  float lo = 0.0, hi = 0.4;
  for (int i = 0; i < 16; i++) {
    float mid = (lo + hi) * 0.5;
    if (inGamut(oklabToLinear(L, mid*cos(H), mid*sin(H)))) lo = mid; else hi = mid;
  }
  return lo;
}

vec3 oklch(float L, float C, float H) {
  return clamp(oklabToLinear(L, C*cos(H), C*sin(H)), 0.0, 1.0);
}

// --- Wave Interference Field ---

vec2 waveSum(vec2 p, float t) {
  float wt  = t * u_waveSpeed;
  vec2  z   = p * 2.2;
  vec2  sum = vec2(0.0);

  float amp0 = smoothstep(-1.0, 1.0, wt);
  float phi0 = z.x * 5.0 - wt * 0.50;
  sum += amp0 * vec2(cos(phi0), sin(phi0));

  for (int k = 1; k < 7; k++) {
    float fk  = float(k + 1);
    float t0k = float(k) * 0.5;
    float amp = smoothstep(t0k, t0k + 1.0, wt);
    float a   = wt * 0.07 * fk + float(k) * 0.897;
    float r2  = 0.55 + 0.15 * sin(float(k) * 1.3);
    vec2  src = r2 * vec2(cos(a), sin(a));
    float d   = length(z - src);
    float phi = d * 5.0 - wt * 0.18 * fk;
    sum += amp * vec2(cos(phi), sin(phi)) / (1.0 + d * d * 1.5);
  }
  return sum;
}

float mapH(vec2 p, float t) {
  return tanhApprox(waveSum(p, t).x * 0.50) * 0.26;
}

// --- Scene ---

vec3 fill(vec2 uv, float t) {
  float loopTime  = mod(t, 6.0);
  float t_norm    = clamp((loopTime - u_tStart) / (u_tEnd - u_tStart), 0.0, 1.0);
  float ease_norm = t_norm * t_norm * t_norm * (t_norm * (t_norm * 6.0 - 15.0) + 10.0);

  float stripW   = mix(0.010, 2.0, ease_norm);
  float cam_ease = mix(0.3, 1.0, ease_norm);
  vec3  ro       = mix(vec3(0.0, -1.0, -1.41), vec3(0.0, -0.9, -1.5), cam_ease);

  vec3 up = vec3(0.0, 0.0, -1.0);
  vec3 ww = normalize(-ro);
  vec3 uu = normalize(cross(ww, up));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.5 * ww);

  float stepFactor = (ro.y - (-1.0)) / (-0.9 - (-1.0));
  float dt         = mix(0.005, 0.018, clamp(stepFactor, 0.0, 1.0));
  float tt         = 0.01;

  vec3  hitPos   = vec3(1e9);
  float prevSign = sign(ro.z - mapH(ro.xy, t));

  for (int i = 0; i < 240; i++) {
    vec3  p       = ro + tt * rd;
    if (p.z > 0.7 || p.y > 2.5) break;
    float curSign = sign(p.z - mapH(p.xy, t));
    if (curSign != prevSign) {
      float t0 = tt - dt, t1 = tt;
      for (int j = 0; j < 8; j++) {
        float tm = (t0 + t1) * 0.5;
        vec3  pm = ro + tm * rd;
        if (sign(pm.z - mapH(pm.xy, t)) == prevSign) t0 = tm; else t1 = tm;
      }
      hitPos = ro + (t0 + t1) * 0.5 * rd;
      break;
    }
    prevSign = curSign;
    tt += dt;
  }

  if (hitPos.x > 1e8) return vec3(0.0);

  float absDist    = abs(hitPos.y);
  float solidCoreW = stripW * 0.25;
  float featherW   = mix(0.04, 0.25, ease_norm) * (1.0 + stripW * 0.5);
  float inStrip    = 1.0 - smoothstep(solidCoreW, stripW + featherW, absDist);

  if (inStrip < 0.001) return vec3(0.0);

  float e   = 0.005;
  vec3  nor = normalize(vec3(
    mapH(hitPos.xy - vec2(e, 0.0), t) - mapH(hitPos.xy + vec2(e, 0.0), t),
    mapH(hitPos.xy - vec2(0.0, e), t) - mapH(hitPos.xy + vec2(0.0, e), t),
    2.0 * e
  ));

  vec3 col;
  if (u_render == 0) {
    float NdotV = abs(dot(nor, -rd));
    float rim   = pow(1.0 - NdotV, 3.0);
    float sss   = pow(max(0.0, dot(rd, nor)), 3.5) * 0.25;
    col = vec3(0.015 + rim * 0.90 + sss);
  } else {
    float nH = atan(nor.y, nor.x);
    float nL = 0.20 + 0.55 * clamp(nor.z, 0.0, 1.0);
    col = oklch(nL, maxChroma(nL, nH), nH);
  }

  return col * inStrip;
}

vec2 toUV(vec2 fc) {
  return (fc * 2.0 - iResolution.xy) / iResolution.y;
}

void main() {
  float t = iTime;
  vec3 col;
  if (u_ssaa == 1) {
    col  = fill(toUV(gl_FragCoord.xy + vec2(-0.25, -0.25)), t);
    col += fill(toUV(gl_FragCoord.xy + vec2( 0.25, -0.25)), t);
    col += fill(toUV(gl_FragCoord.xy + vec2(-0.25,  0.25)), t);
    col += fill(toUV(gl_FragCoord.xy + vec2( 0.25,  0.25)), t);
    col *= 0.25;
  } else {
    col = fill(toUV(gl_FragCoord.xy), t);
  }
  gl_FragColor = vec4(pow(max(col, 0.0), vec3(0.4545)), 1.0);
}
