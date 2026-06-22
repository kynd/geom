precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_ssaa;

// Per-stem shape index and softmax prominence weight
uniform int   u_s0, u_s1, u_s2, u_s3, u_s4, u_s5, u_s6;
uniform float u_w0, u_w1, u_w2, u_w3, u_w4, u_w5, u_w6;

// INCLUDE_LIGHTING

float surfaceF(vec3 p);
// INCLUDE_SCALAR_MARCHER

float shapeFunc(vec3 p, int idx) {
  float rot = iTime * 0.25;
  float cr = cos(rot), sr = sin(rot);
  vec3 q = vec3(cr*p.x + sr*p.z, p.y, -sr*p.x + cr*p.z);
  float x = q.x, y = q.y, z = q.z;
  float t = iTime;

  // ── Static ────────────────────────────────────────────────────────────────
  if (idx == 1)  return y - x*x - z*z + 0.40;
  if (idx == 2)  return y - 0.85*(x*x - z*z);
  if (idx == 3)  return x*x + z*z - y*y;
  if (idx == 4)  return x*x + y*y + z*z - 0.81;
  if (idx == 5)  { float r = sqrt(x*x + z*z) - 0.65; return r*r + y*y - 0.100; }
  if (idx == 6)  return x*x + z*z - y*y - 0.45;
  if (idx == 7)  return y - 0.55*(x*x*x - 3.0*x*z*z);
  if (idx == 8)  return y - 0.40*sin(2.2*x)*cos(2.2*z);
  if (idx == 9)  { float r = length(q.xz); return y - 0.38*exp(-r*0.9)*cos(4.5*r); }
  if (idx == 10) return x*x/0.81 + y*y/0.36 + z*z/0.5625 - 1.0;

  // ── Moving ────────────────────────────────────────────────────────────────
  if (idx == 11) { float r = length(vec2(x,z)); return y - 0.52*exp(-r*1.1)*cos(5.5*r - 2.2*t); }

  if (idx == 12) {
    float theta = atan(z, x);
    float R  = 0.58 + 0.13*sin(t*0.70) + 0.05*sin(t*1.83);
    float rt = 0.10 + 0.048*sin(3.0*theta - t*1.10) + 0.022*sin(7.0*theta + t*0.68);
    float qr = length(vec2(x,z)) - R;
    return qr*qr + y*y - rt*rt;
  }

  if (idx == 13) return y - 0.38*sin(2.1*x + t*1.1)*cos(2.1*z + t*0.7);

  if (idx == 14) {
    float rlen = length(q);
    float ct   = rlen > 0.001 ? q.y / rlen : 0.0;
    float P2   = 0.5*(3.0*ct*ct - 1.0);
    float amp  = 0.16*sin(t*0.85) + 0.07*sin(t*2.13 + 1.0);
    return rlen - (0.70 + amp*P2);
  }

  if (idx == 15) { float A = 0.70 + 0.30*sin(t*0.75); return y - A*(x*x - z*z); }
  if (idx == 16) { float k = 1.45 + 0.42*sin(t*0.50); return cos(k*x)*sin(k*y) + cos(k*y)*sin(k*z) + cos(k*z)*sin(k*x); }
  if (idx == 17) { float c = 0.88*sin(t*0.55); return cos(2.0*x) + cos(2.0*y) + cos(2.0*z) - c; }

  if (idx == 18) {
    float a  = 0.55 + 0.18*sin(t*0.85);
    float r2 = dot(q, q);
    return r2*r2 - a*a*(x*x - z*z);
  }

  if (idx == 19) {
    float wobble = 0.52*sin(t*0.47);
    float cw = cos(wobble), sw = sin(wobble);
    vec3 pw = vec3(cw*x + sw*y, -sw*x + cw*y, z);
    float a = 0.54 + 0.18*sin(t*0.70);
    float b = 0.96 + 0.26*sin(t*1.13 + 1.0);
    float c = 0.54 + 0.16*sin(t*0.85 + 2.1);
    return pw.x*pw.x/(a*a) + pw.y*pw.y/(b*b) + pw.z*pw.z/(c*c) - 1.0;
  }

  if (idx == 20) {
    float s = 1.18; float u = x*s, v = y*s, w = z*s;
    float c = 10.5 + 3.2*sin(t*0.45);
    return u*u*u*u - 5.0*u*u + v*v*v*v - 5.0*v*v + w*w*w*w - 5.0*w*w + c;
  }

  if (idx == 21) {
    float s = 1.02 + 0.13*sin(t*0.58);
    float u = x*s, v = y*s, w = z*s;
    return (8.0*u*u*u*u - 8.0*u*u + 1.0) + (8.0*v*v*v*v - 8.0*v*v + 1.0) + (8.0*w*w*w*w - 8.0*w*w + 1.0);
  }

  if (idx == 22) { float wave = y + 0.18*sin(4.5*y - 1.6*t); return x*x + z*z - wave*wave; }

  if (idx == 23) {
    float A     = 0.52 + 0.32*sin(t*0.90);
    float sigma = 0.22 + 0.10*sin(t*1.30 + 1.0);
    return y - A*exp(-(x*x + z*z) / (sigma*sigma));
  }

  if (idx == 24) { float c = 0.80*sin(t*0.50); return cos(2.0*x)*cos(2.0*y) + cos(2.0*y)*cos(2.0*z) + cos(2.0*z)*cos(2.0*x) - c; }
  if (idx == 25) { float A = 1.20*sin(t*0.65); return y - 0.72*(x*x - z*z + A*x*z); }

  if (idx == 26) {
    float theta = atan(z, x);
    float rt    = 0.10 + 0.06*sin(4.0*theta - t*0.95);
    float qr    = length(vec2(x,z)) - 0.62;
    return qr*qr + y*y - rt*rt;
  }

  if (idx == 27) {
    float lon  = atan(z, x) - t*0.38;
    float lat  = atan(y, length(vec2(x,z)));
    float bump = 0.16*sin(3.0*lon)*sin(2.0*lat);
    return dot(q, q) - (0.72 + bump)*(0.72 + bump);
  }

  if (idx == 28) { float A = 0.28*sin(t*0.72); return x*x*(1.0 + A*sin(2.8*y - t)) + z*z - y*y - 0.40; }
  if (idx == 29) { float A = 0.20 + 0.14*sin(t*0.82); return x*x*y + y*y*z + z*z*x - A; }

  if (idx == 30) {
    float ph = t * 0.58;
    return y - 0.80*sin(ph)*x*x - 0.80*cos(ph + 0.55)*z*z + 0.18;
  }

  return 1e10;
}

// Weights are softmax prominence scores — always sum to 1
float surfaceF(vec3 p) {
  return u_w0 * shapeFunc(p, u_s0)
       + u_w1 * shapeFunc(p, u_s1)
       + u_w2 * shapeFunc(p, u_s2)
       + u_w3 * shapeFunc(p, u_s3)
       + u_w4 * shapeFunc(p, u_s4)
       + u_w5 * shapeFunc(p, u_s5)
       + u_w6 * shapeFunc(p, u_s6);
}

vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);
  float t; vec3 nor;
  if (!castRay(ro, rd, t, nor)) return vec3(0.0);
  return stdLighting(ro + rd * t, nor, rd);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25,-0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,-0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25, 0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, 0.25))*2.0 - iResolution.xy)/iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy*2.0 - iResolution.xy)/iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
