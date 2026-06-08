precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_surfaceIndex;
uniform float u_ampL;
uniform float u_ampR;
uniform int   u_ssaa;

float surfaceF(vec3 p);
// INCLUDE_SCALAR_MARCHER

float surfaceF(vec3 p) {
  float a  = iTime * 0.28;
  float ca = cos(a), sa = sin(a);
  vec3  q  = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  float x  = q.x, y = q.y, z = q.z;

  if (u_surfaceIndex == 1)  return y - x*x - z*z + 0.40;
  if (u_surfaceIndex == 2)  return y - 0.85*(x*x - z*z);
  if (u_surfaceIndex == 3)  return x*x + z*z - y*y;
  if (u_surfaceIndex == 4)  return x*x + y*y + z*z - 0.81;
  if (u_surfaceIndex == 5) {
    float r = sqrt(x*x + z*z) - 0.65;
    return r*r + y*y - 0.100;
  }
  if (u_surfaceIndex == 6)  return x*x + z*z - y*y - 0.45;
  if (u_surfaceIndex == 7)  return y - 0.55*(x*x*x - 3.0*x*z*z);
  if (u_surfaceIndex == 8)  return y - 0.40*sin(2.2*x)*cos(2.2*z);
  if (u_surfaceIndex == 9) {
    float r = length(q.xz);
    return y - 0.38 * exp(-r * 0.9) * cos(4.5 * r);
  }
  if (u_surfaceIndex == 10) return x*x/0.81 + y*y/0.36 + z*z/0.5625 - 1.0;
  return 1e10;
}

// Camera at +Z, back-lights are placed at −Z
vec3 flashLight(vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);

  // Light 1: faster orbit around Y axis
  float a1 = iTime * 3.5;
  vec3 ld1 = normalize(vec3(sin(a1), 0.35, cos(a1)));
  float d1 = max(dot(nor, ld1), 0.0);
  vec3  h1 = normalize(ld1 - rd);
  float s1 = pow(max(dot(nor, h1), 0.0), 56.0);
  vec3 col1 = mat * d1 * 0.85 + vec3(0.45) * s1 * 0.45;

  // Light 2: slower orbit, offset phase
  float a2 = iTime * 2.1 + 1.9;
  vec3 ld2 = normalize(vec3(sin(a2), 0.20, cos(a2)));
  float d2 = max(dot(nor, ld2), 0.0);
  vec3  h2 = normalize(ld2 - rd);
  float s2 = pow(max(dot(nor, h2), 0.0), 56.0);
  vec3 col2 = mat * d2 * 0.85 + vec3(0.45) * s2 * 0.45;

  // Light 1 always faintly on; light 2 fully driven by ampR
  float ampL2 = u_ampL * u_ampL;
  float ampR2 = u_ampR * u_ampR;
  return col1 * max(ampL2, 0.015) + col2 * ampR2;
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
  // castRay already flips the normal for scalar surfaces
  return flashLight(nor, rd);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25, -0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, -0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25,  0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,  0.25)) * 2.0 - iResolution.xy) / iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy * 2.0 - iResolution.xy) / iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
