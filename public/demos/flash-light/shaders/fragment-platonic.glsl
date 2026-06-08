precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_pair;
uniform float u_t;
uniform float u_ampL;
uniform float u_ampR;
uniform int   u_ssaa;

// INCLUDE_PLATONIC_FUNCTIONS

float sceneSDF(vec3 p);
// INCLUDE_SDF_MARCHER

float sceneSDF(vec3 p) {
  if (u_pair == 0) {
    p = rotX(iTime * 0.28) * rotY(iTime * 0.44) * p;
    return mix(sdCube(p), sdOctahedron(p), u_t);
  }
  if (u_pair == 1) {
    p = rotX(2.1 + iTime * 0.40) * rotY(2.1 + iTime * 0.32) * p;
    return mix(sdTetrahedron(p), sdDualTetrahedron(p), u_t);
  }
  p = rotX(4.3 + iTime * 0.20) * rotY(4.3 + iTime * 0.36) * p;
  return mix(sdDodecahedron(p), sdIcosahedron(p), u_t);
}

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

void main() {
  vec3 totalCol = vec3(0.0);

  vec2 offs[4];
  offs[0] = vec2(-0.25, -0.25);
  offs[1] = vec2( 0.25, -0.25);
  offs[2] = vec2(-0.25,  0.25);
  offs[3] = vec2( 0.25,  0.25);

  for (int s = 0; s < 4; s++) {
    vec2 off = u_ssaa == 1 ? offs[s] : vec2(0.0);
    vec2 uv  = ((gl_FragCoord.xy + off) * 2.0 - iResolution.xy) / iResolution.y;
    vec3 ro  = vec3(0.0, 0.0, -3.0);
    vec3 rd  = normalize(vec3(uv, 1.5));

    float t; vec3 nor;
    vec3 col = vec3(0.0);
    if (castRay(ro, rd, t, nor)) {
      if (dot(nor, -rd) < 0.0) nor = -nor;
      col = flashLight(nor, rd);
    }
    totalCol += col;
    if (u_ssaa == 0) break;
  }

  totalCol *= u_ssaa == 1 ? 0.25 : 1.0;
  totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
  gl_FragColor = vec4(totalCol, 1.0);
}
