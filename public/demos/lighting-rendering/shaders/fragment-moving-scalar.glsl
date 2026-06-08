precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform int   u_surfaceIndex;
uniform float u_rimPow;
uniform float u_base;
uniform float u_sssDensity;
uniform float u_sssStr;
uniform int   u_ssaa;

// INCLUDE_RIM_LIGHTING

float surfaceF(vec3 p);
// INCLUDE_SCALAR_MARCHER
// INCLUDE_MOVING_SCALAR_FUNCTIONS

vec3 render3D(vec2 uv) {
  vec3 ro = vec3(0.0, 1.2, 3.0);
  vec3 ta = vec3(0.0, 0.0, 0.0);
  vec3 ww = normalize(ta - ro);
  vec3 uu = normalize(cross(ww, vec3(0.0, 1.0, 0.0)));
  vec3 vv = cross(uu, ww);
  vec3 rd = normalize(uv.x*uu + uv.y*vv + 3.0*ww);

  float t; vec3 nor;
  if (!castRay(ro, rd, t, nor)) return vec3(0.0);
  vec3 pos = ro + rd * t;
  if (dot(nor, -rd) < 0.0) nor = -nor;
  return rimLight(pos, nor, rd, 100.0);
}

void main() {
  vec3 col;
  if (u_ssaa == 1) {
    col  = render3D(((gl_FragCoord.xy + vec2(-0.25,-0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25,-0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2(-0.25, 0.25))*2.0 - iResolution.xy)/iResolution.y);
    col += render3D(((gl_FragCoord.xy + vec2( 0.25, 0.25))*2.0 - iResolution.xy)/iResolution.y);
    col *= 0.25;
  } else {
    col = render3D((gl_FragCoord.xy*2.0 - iResolution.xy)/iResolution.y);
  }
  col = pow(max(col, 0.0), vec3(0.4545));
  gl_FragColor = vec4(col, 1.0);
}
