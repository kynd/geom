// Rim (back) lighting with SSS — bright silhouette edges + thin-area glow.
// Inject via: // INCLUDE_RIM_LIGHTING
//
// Required uniforms (declare before the include):
//   uniform float u_rimPow;     — rim edge exponent        (default 3.0)
//   uniform float u_base;       — face-on ambient           (default 0.0)
//   uniform float u_sssDensity; — SSS thickness falloff     (default 2.5)
//   uniform float u_sssStr;     — SSS strength              (default 0.3)
//
// Usage: vec3 col = rimLight(pos, nor, rd, thickness);
//   pos       — world-space hit point
//   nor       — surface normal facing the camera (flip two-sided normals before calling)
//   rd        — normalised ray direction (pointing away from camera)
//   thickness — distance through the interior to the back face;
//               pass a large value (e.g. 100.0) to suppress SSS on open surfaces
//
// Background colour is vec3(0.0). Gamma must be applied by the caller.

vec3 rimLight(vec3 pos, vec3 nor, vec3 rd, float thickness) {
  float NdotV = abs(dot(nor, -rd));
  float rim   = pow(1.0 - NdotV, u_rimPow);
  float base  = NdotV * NdotV * u_base;
  float sss   = exp(-thickness * u_sssDensity);
  return vec3(base)
       + vec3(0.92, 0.96, 1.00) * rim
       + vec3(0.92, 0.96, 1.00) * sss * u_sssStr;
}
