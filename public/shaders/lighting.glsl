// Standard studio lighting — white/grey material, two lights + specular + Fresnel rim.
// Inject via: // INCLUDE_LIGHTING
//
// Usage: vec3 col = stdLighting(pos, nor, rd);
//   pos — world-space hit point
//   nor — surface normal facing the camera (flip two-sided normals before calling)
//   rd  — normalised ray direction (pointing away from camera)
//
// Background colour is vec3(0.0). Gamma must be applied by the caller:
//   col = pow(max(col, 0.0), vec3(0.4545));

vec3 stdLighting(vec3 pos, vec3 nor, vec3 rd) {
  // Key light
  vec3  lk = normalize(vec3(0.6, 1.0, 0.7));
  float dk = max(dot(nor, lk), 0.0);

  // Fill light
  vec3  lf = normalize(vec3(-0.8, 0.3, 0.5));
  float df = max(dot(nor, lf), 0.0) * 0.28;

  // Diffuse + ambient
  vec3 mate = vec3(0.88);
  vec3 col  = mate * (0.13 + dk * 0.84 + df);

  // Specular (Blinn-Phong, key light)
  vec3 hv = normalize(lk - rd);
  col += vec3(0.40) * pow(max(dot(nor, hv), 0.0), 72.0);

  // Fresnel rim
  float fr = pow(1.0 - max(dot(nor, -rd), 0.0), 4.0);
  col += vec3(0.12, 0.18, 0.38) * fr * 0.6;

  return col;
}
