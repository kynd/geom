precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform float u_vpx;
uniform float u_t;
uniform int   u_ssaa;

// PAIR is injected as a #define (0=cube/oct, 1=tet/tet, 2=dodec/icos)
// INCLUDE_PLATONIC_FUNCTIONS
// INCLUDE_LIGHTING

float sceneSDF(vec3 p);
// INCLUDE_SDF_MARCHER

float sceneSDF(vec3 p) {
#if PAIR == 0
  p = rotX(iTime * 0.28) * rotY(iTime * 0.44) * p;
  return mix(sdCube(p), sdOctahedron(p), u_t);
#elif PAIR == 1
  p = rotX(2.1 + iTime * 0.40) * rotY(2.1 + iTime * 0.32) * p;
  return mix(sdTetrahedron(p), sdDualTetrahedron(p), u_t);
#else
  p = rotX(4.3 + iTime * 0.20) * rotY(4.3 + iTime * 0.36) * p;
  return mix(sdDodecahedron(p), sdIcosahedron(p), u_t);
#endif
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
    vec2 fc = gl_FragCoord.xy + off;
    fc.x -= u_vpx;
    vec2 uv = (fc * 2.0 - iResolution.xy) / iResolution.y;

    vec3 ro = vec3(0.0, 0.0, -3.0);
    vec3 rd = normalize(vec3(uv, 1.5));

    float t; vec3 nor;
    vec3 col = vec3(0.0);
    if (castRay(ro, rd, t, nor)) {
      vec3 p = ro + rd * t;
      if (dot(nor, -rd) < 0.0) nor = -nor;
      col = stdLighting(p, nor, rd);
    }
    totalCol += col;
    if (u_ssaa == 0) break;
  }

  totalCol /= u_ssaa == 1 ? 4.0 : 1.0;
  totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
  gl_FragColor = vec4(totalCol, 1.0);
}
