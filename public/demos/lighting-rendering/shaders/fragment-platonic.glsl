precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_pair;
uniform float u_t;
uniform float u_rimPow;
uniform float u_base;
uniform float u_sssDensity;
uniform float u_sssStr;
uniform int   u_ssaa;

// INCLUDE_PLATONIC_FUNCTIONS
// INCLUDE_RIM_LIGHTING

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

void main() {
  vec3 totalCol = vec3(0.0);

  vec2 offs[4];
  offs[0] = vec2(-0.25, -0.25);
  offs[1] = vec2( 0.25, -0.25);
  offs[2] = vec2(-0.25,  0.25);
  offs[3] = vec2( 0.25,  0.25);

  for (int s = 0; s < 4; s++) {
    vec2 off = u_ssaa == 1 ? offs[s] : vec2(0.0);
    vec2 uv = ((gl_FragCoord.xy + off) * 2.0 - iResolution.xy) / iResolution.y;
    vec3 ro = vec3(0.0, 0.0, -3.0);
    vec3 rd = normalize(vec3(uv, 1.5));

    float t; vec3 nor;
    vec3 col = vec3(0.0);
    if (castRay(ro, rd, t, nor)) {
      vec3 pos = ro + rd * t;
      if (dot(nor, -rd) < 0.0) nor = -nor;

      float tb = t + 0.005;
      for (int i = 0; i < 48; i++) {
        float d = sceneSDF(ro + rd * tb);
        if (d > 0.0) break;
        tb += max(-d, 0.005);
      }
      float thickness = tb - t;

      col = rimLight(pos, nor, rd, thickness);
    }
    totalCol += col;
    if (u_ssaa == 0) break;
  }

  totalCol *= u_ssaa == 1 ? 0.25 : 1.0;
  totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
  gl_FragColor = vec4(totalCol, 1.0);
}
