precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_surfaceIndex;

// INCLUDE_LIGHTING

// ---- Implicit surface F(p) = 0 ----
// Y is the vertical axis. Rotation around Y applied here so calcNormal sees it too.
float surfaceF(vec3 p) {
  float a  = iTime * 0.28;
  float ca = cos(a), sa = sin(a);
  vec3  q  = vec3(ca * p.x + sa * p.z, p.y, -sa * p.x + ca * p.z);
  float x  = q.x, y = q.y, z = q.z;

  if (u_surfaceIndex == 1)  return y - x*x - z*z + 0.40;          // elliptic paraboloid
  if (u_surfaceIndex == 2)  return y - 0.85*(x*x - z*z);          // hyperbolic paraboloid
  if (u_surfaceIndex == 3)  return x*x + z*z - y*y;               // double cone
  if (u_surfaceIndex == 4)  return x*x + y*y + z*z - 0.81;        // sphere
  if (u_surfaceIndex == 5) {
    float r = sqrt(x*x + z*z) - 0.65;
    return r*r + y*y - 0.100;                                      // torus (Y axis)
  }
  if (u_surfaceIndex == 6)  return x*x + z*z - y*y - 0.45;        // hyperboloid (1 sheet)
  if (u_surfaceIndex == 7)  return y - 0.55*(x*x*x - 3.0*x*z*z); // monkey saddle
  if (u_surfaceIndex == 8)  return y - 0.40*sin(2.2*x)*cos(2.2*z);// wave surface
  if (u_surfaceIndex == 9) {
    float r = length(q.xz);
    return y - 0.38 * exp(-r * 0.9) * cos(4.5 * r);               // damped ripple
  }
  if (u_surfaceIndex == 10) return x*x/0.81 + y*y/0.36 + z*z/0.5625 - 1.0; // ellipsoid

  return 1e10;
}

// ---- Normal via tetrahedron sampling ----
vec3 calcNormal(vec3 p) {
  const float eps = 0.002;
  const vec2 k = vec2(1.0, -1.0);
  return normalize(
    k.xyy * surfaceF(p + k.xyy * eps) +
    k.yyx * surfaceF(p + k.yyx * eps) +
    k.yxy * surfaceF(p + k.yxy * eps) +
    k.xxx * surfaceF(p + k.xxx * eps)
  );
}

// ---- Ray vs sphere (returns entry/exit t; x>y means miss) ----
vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

// ---- Render one sample ----
vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.5 * ww);

  // Cull against bounding sphere
  vec2 tb = raySphere(ro, rd, 1.58);
  if (tb.x > tb.y) return vec3(0.0);

  float tMin = max(tb.x, 0.01);
  float tMax = tb.y;

  // Fixed-step march with sign-change detection
  float dt    = 0.013;
  float t     = tMin;
  float prevF = surfaceF(ro + rd * t);
  float tHit  = -1.0;

  for (int i = 0; i < 240; i++) {
    t += dt;
    if (t > tMax) break;
    float F = surfaceF(ro + rd * t);
    if (prevF * F < 0.0) {
      // Binary refinement
      float t0 = t - dt;
      float t1 = t;
      float F0 = prevF;
      for (int j = 0; j < 8; j++) {
        float tm = 0.5 * (t0 + t1);
        float Fm = surfaceF(ro + rd * tm);
        if (F0 * Fm <= 0.0) { t1 = tm; }
        else                { t0 = tm; F0 = Fm; }
      }
      tHit = 0.5 * (t0 + t1);
      break;
    }
    prevF = F;
  }

  if (tHit < 0.0) return vec3(0.0);

  vec3 pos = ro + rd * tHit;
  vec3 nor = calcNormal(pos);
  if (dot(nor, -rd) < 0.0) nor = -nor;   // two-sided surface

  return stdLighting(pos, nor, rd);
}

void main() {
  vec3 col = vec3(0.0);
  col += render3D((gl_FragCoord.xy + vec2(-0.25, -0.25) - 0.5 * iResolution) / iResolution.y);
  col += render3D((gl_FragCoord.xy + vec2( 0.25, -0.25) - 0.5 * iResolution) / iResolution.y);
  col += render3D((gl_FragCoord.xy + vec2(-0.25,  0.25) - 0.5 * iResolution) / iResolution.y);
  col += render3D((gl_FragCoord.xy + vec2( 0.25,  0.25) - 0.5 * iResolution) / iResolution.y);
  col *= 0.25;
  col  = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
