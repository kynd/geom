// Requires forward declaration in the including file: float surfaceF(vec3 p);

vec2 raySphere(vec3 ro, vec3 rd, float r) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

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

bool castRay(vec3 ro, vec3 rd, out float t, out vec3 nor) {
  vec2 tb = raySphere(ro, rd, 1.58);
  if (tb.x > tb.y) return false;
  float tMin = max(tb.x, 0.01);
  float tMax = tb.y;
  float dt   = 0.013;
  t = tMin;
  float prevF = surfaceF(ro + rd * t);
  for (int i = 0; i < 240; i++) {
    t += dt;
    if (t > tMax) return false;
    float F = surfaceF(ro + rd * t);
    if (prevF * F < 0.0) {
      float t0 = t - dt, t1 = t, F0 = prevF;
      for (int j = 0; j < 8; j++) {
        float tm = 0.5 * (t0 + t1);
        float Fm = surfaceF(ro + rd * tm);
        if (F0 * Fm <= 0.0) { t1 = tm; }
        else                { t0 = tm; F0 = Fm; }
      }
      t = 0.5 * (t0 + t1);
      nor = calcNormal(ro + rd * t);
      if (dot(nor, -rd) < 0.0) nor = -nor;
      return true;
    }
    prevF = F;
  }
  return false;
}
