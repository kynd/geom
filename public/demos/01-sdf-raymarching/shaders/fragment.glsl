precision highp float;

uniform vec2 iResolution;
uniform float iTime;
uniform int u_shapeIndex;

// INCLUDE_SDF_FUNCTIONS
// INCLUDE_LIGHTING

// Forward declaration (calcNormal needs to call sceneSDF)
float sceneSDF(vec3 p);

// ---- Normal via tetrahedron sampling ----
vec3 calcNormal(vec3 p) {
  const float eps = 0.001;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * sceneSDF(p + k.xyy * eps) +
    k.yyx * sceneSDF(p + k.yyx * eps) +
    k.yxy * sceneSDF(p + k.yxy * eps) +
    k.xxx * sceneSDF(p + k.xxx * eps)
  );
}

// ---- Scene: select SDF by index ----
float sceneSDF(vec3 p) {
  float a = iTime * 0.35;
  float ca = cos(a), sa = sin(a);
  vec3 rp = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);

  if (u_shapeIndex == 1)  return sdSphere(rp, 0.80);
  if (u_shapeIndex == 2)  return sdBox(rp, vec3(0.56));
  if (u_shapeIndex == 3)  return sdRoundBox(rp, vec3(0.50), 0.12);
  if (u_shapeIndex == 4)  return sdBoxFrame(rp, vec3(0.56), 0.06);
  if (u_shapeIndex == 5)  return sdTorus(rp, vec2(0.55, 0.18));
  if (u_shapeIndex == 6)  return sdCappedTorus(rp, vec2(0.866, 0.500), 0.62, 0.14);
  if (u_shapeIndex == 7)  return sdLink(rp, 0.28, 0.42, 0.10);
  if (u_shapeIndex == 8)  return sdCylinder(rp, vec3(0.0, 0.0, 0.42));
  if (u_shapeIndex == 9)  return sdCone(rp - vec3(0.0, 0.44, 0.0), vec2(0.5774, 0.8165), 0.88);
  if (u_shapeIndex == 10) return sdInfiniteCone(rp, normalize(vec2(0.5, 1.0)));
  if (u_shapeIndex == 11) return sdPlane(rp, vec3(0.0, 1.0, 0.0), 0.55);
  if (u_shapeIndex == 12) return sdHexPrism(rp, vec2(0.50, 0.46));
  if (u_shapeIndex == 13) return sdCapsule(rp, vec3(-0.5, -0.3, 0.0), vec3(0.5, 0.3, 0.0), 0.24);
  if (u_shapeIndex == 14) return sdVerticalCapsule(rp + vec3(0.0, 0.56, 0.0), 1.12, 0.28);
  if (u_shapeIndex == 15) return sdCappedCylinder(rp, 0.45, 0.55);
  if (u_shapeIndex == 16) return sdCappedCylinder(rp, vec3(-0.0, -0.55, 0.3), vec3(0.0, 0.55, -0.3), 0.32);
  if (u_shapeIndex == 17) return sdRoundedCylinder(rp, 0.42, 0.10, 0.50);
  if (u_shapeIndex == 18) return sdCappedCone(rp, 0.72, 0.50, 0.14);
  if (u_shapeIndex == 19) return sdCappedCone(rp, vec3(0.0, -0.55, 0.0), vec3(0.0, 0.55, 0.0), 0.50, 0.10);
  if (u_shapeIndex == 20) return sdSolidAngle(rp + vec3(0.0, 0.46, 0.0), vec2(0.866, 0.500), 0.82);
  if (u_shapeIndex == 21) return sdCutSphere(rp - vec3(0.0, 0.32, 0.0), 0.82, 0.18);
  if (u_shapeIndex == 22) return sdCutHollowSphere(rp + vec3(0.0, 0.51, 0.0), 0.82, 0.20, 0.045);
  if (u_shapeIndex == 23) return sdDeathStar(rp, 0.76, 0.40, 0.62);
  if (u_shapeIndex == 24) return sdRoundCone(rp + vec3(0.0, 0.38, 0.0), 0.32, 0.06, 1.02);
  if (u_shapeIndex == 25) return sdRoundCone(rp, vec3(-0.5, -0.5, 0.0), vec3(0.5, 0.5, 0.0), 0.32, 0.10);
  if (u_shapeIndex == 26) return sdVesicaSegment(rp, vec3(-0.55, 0.0, 0.0), vec3(0.55, 0.0, 0.0), 0.38);
  if (u_shapeIndex == 27) return sdRhombus(rp, 0.58, 0.48, 0.36, 0.06);
  if (u_shapeIndex == 28) return sdOctahedron(rp, 0.90);
  if (u_shapeIndex == 29) return sdOctahedronFast(rp, 0.90);
  if (u_shapeIndex == 30) return sdPyramid(rp + vec3(0.0, 0.44, 0.0), 0.90);
  if (u_shapeIndex == 31) return udTriangle(rp, vec3(-0.6, -0.38, 0.0), vec3(0.6, -0.38, 0.0), vec3(0.0, 0.72, 0.0));
  if (u_shapeIndex == 32) return udQuad(rp, vec3(-0.55, -0.55, 0.0), vec3(0.55, -0.55, 0.0), vec3(0.55, 0.55, 0.0), vec3(-0.55, 0.55, 0.0));
  if (u_shapeIndex == 33) return sdEllipsoid(rp, vec3(0.70, 0.46, 0.56));
  if (u_shapeIndex == 34) return sdTriPrism(rp, vec2(0.50, 0.46));
  return 1e10;
}

// ---- 3D ray marching ----
vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 0.55, 3.5);
  vec3 ta = vec3(0.0, 0.08, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 3.0 * ww);

  float t    = 0.02;
  float tmax = 22.0;
  for (int i = 0; i < 256; i++) {
    float d = sceneSDF(ro + rd * t);
    if (d < 0.00003 || t > tmax) break;
    t += max(d, 0.0001);
  }

  vec3 col = vec3(0.0);

  if (t < tmax) {
    vec3 pos = ro + rd * t;
    vec3 nor = calcNormal(pos);

    col = stdLighting(pos, nor, rd);
  }

  return col;
}

void main() {
  // 4-sample SSAA (2x2 rotated grid)
  vec3 col = vec3(0.0);
  col += render3D(((gl_FragCoord.xy + vec2(-0.25, -0.25)) * 2.0 - iResolution.xy) / iResolution.y);
  col += render3D(((gl_FragCoord.xy + vec2( 0.25, -0.25)) * 2.0 - iResolution.xy) / iResolution.y);
  col += render3D(((gl_FragCoord.xy + vec2(-0.25,  0.25)) * 2.0 - iResolution.xy) / iResolution.y);
  col += render3D(((gl_FragCoord.xy + vec2( 0.25,  0.25)) * 2.0 - iResolution.xy) / iResolution.y);
  col *= 0.25;

  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
