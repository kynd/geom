// Requires forward declaration in the including file: float sceneSDF(vec3 p);

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

bool castRay(vec3 ro, vec3 rd, out float t, out vec3 nor) {
  t = 0.02;
  for (int i = 0; i < 256; i++) {
    float d = sceneSDF(ro + rd * t);
    if (d < 0.00003) {
      nor = calcNormal(ro + rd * t);
      return true;
    }
    if (t > 22.0) break;
    t += max(d, 0.0001);
  }
  return false;
}
