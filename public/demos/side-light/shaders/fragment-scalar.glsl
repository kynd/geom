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
vec3 sideLight(vec3 nor, vec3 rd) {
  vec3 mat = vec3(0.88);

  vec3 leftDir  = normalize(vec3(-1.2, 0.2, -1.0));
  float diffL   = max(dot(nor, leftDir), 0.0);
  vec3 halfL    = normalize(leftDir - rd);
  float specL   = pow(max(dot(nor, halfL), 0.0), 48.0);
  vec3 colLeft  = mat * diffL * 0.90 + vec3(0.40) * specL * 0.40;

  vec3 rightDir = normalize(vec3(1.2, 0.2, -1.0));
  float diffR   = max(dot(nor, rightDir), 0.0);
  vec3 halfR    = normalize(rightDir - rd);
  float specR   = pow(max(dot(nor, halfR), 0.0), 48.0);
  vec3 colRight = mat * diffR * 0.90 + vec3(0.40) * specR * 0.40;

  return colLeft * u_ampL + colRight * u_ampR;
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
  return sideLight(nor, rd);
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
