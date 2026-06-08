float surfaceF(vec3 p) {
  // Slow global Y-axis rotation so every shape can be seen from all sides
  float rot = iTime * 0.22;
  float cr = cos(rot), sr = sin(rot);
  vec3 q = vec3(cr*p.x + sr*p.z, p.y, -sr*p.x + cr*p.z);
  float x = q.x, y = q.y, z = q.z;
  float t = iTime;

  // 1. Traveling ripple — damped radial wave whose phase advances with time
  if (u_surfaceIndex == 1) {
    float r = length(vec2(x, z));
    return y - 0.52*exp(-r*1.1)*cos(5.5*r - 2.2*t);
  }

  // 2. Rippling torus — major radius breathes while azimuthal waves travel around the tube
  if (u_surfaceIndex == 2) {
    float theta = atan(z, x);
    float R = 0.58 + 0.13*sin(t*0.70) + 0.05*sin(t*1.83);
    float r_t = 0.10 + 0.048*sin(3.0*theta - t*1.10) + 0.022*sin(7.0*theta + t*0.68);
    float qr = length(vec2(x, z)) - R;
    return qr*qr + y*y - r_t*r_t;
  }

  // 3. Wave sheet — product of two traveling sinusoids
  if (u_surfaceIndex == 3) {
    return y - 0.38*sin(2.1*x + t*1.1)*cos(2.1*z + t*0.7);
  }

  // 4. Pulsing sphere — quadrupolar mode: alternates between prolate and oblate via P₂(cosθ)
  if (u_surfaceIndex == 4) {
    float rlen = length(q);
    float ct = rlen > 0.001 ? q.y / rlen : 0.0;
    float P2 = 0.5*(3.0*ct*ct - 1.0);
    float amp = 0.16*sin(t*0.85) + 0.07*sin(t*2.13 + 1.0);
    float r = 0.70 + amp*P2;
    return rlen - r;
  }

  // 5. Oscillating saddle — amplitude of x²−z² breathes
  if (u_surfaceIndex == 5) {
    float A = 0.70 + 0.30*sin(t*0.75);
    return y - A*(x*x - z*z);
  }

  // 6. Gyroid — triply periodic minimal surface; spatial scale k(t) oscillates
  if (u_surfaceIndex == 6) {
    float k = 1.45 + 0.42*sin(t*0.50);
    return cos(k*x)*sin(k*y) + cos(k*y)*sin(k*z) + cos(k*z)*sin(k*x);
  }

  // 7. Schwartz P — triply periodic minimal surface; threshold c(t) shifts
  if (u_surfaceIndex == 7) {
    float c = 0.88*sin(t*0.55);
    return cos(2.0*x) + cos(2.0*y) + cos(2.0*z) - c;
  }

  // 8. Lemniscate surface — (x²+y²+z²)² = a²(x²−z²); axis a(t) oscillates
  if (u_surfaceIndex == 8) {
    float a = 0.55 + 0.18*sin(t*0.85);
    float r2 = dot(q, q);
    return r2*r2 - a*a*(x*x - z*z);
  }

  // 9. Swaying ellipsoid — elongated along Y; long axis tilts while axes breathe
  if (u_surfaceIndex == 9) {
    float wobble = 0.52*sin(t*0.47);
    float cw = cos(wobble), sw = sin(wobble);
    vec3 pw = vec3(cw*x + sw*y, -sw*x + cw*y, z);
    float a = 0.54 + 0.18*sin(t*0.70);
    float b = 0.96 + 0.26*sin(t*1.13 + 1.0);
    float c = 0.54 + 0.16*sin(t*0.85 + 2.1);
    return pw.x*pw.x/(a*a) + pw.y*pw.y/(b*b) + pw.z*pw.z/(c*c) - 1.0;
  }

  // 10. Tanglecube — degree-4 surface; constant c(t) slides the isosurface
  if (u_surfaceIndex == 10) {
    float s = 1.18;
    float u = x*s, v = y*s, w = z*s;
    float c = 10.5 + 3.2*sin(t*0.45);
    return u*u*u*u - 5.0*u*u + v*v*v*v - 5.0*v*v + w*w*w*w - 5.0*w*w + c;
  }

  // 11. Chmutov T₄ surface — sum of 4th Chebyshev polynomials; scale s(t) oscillates
  if (u_surfaceIndex == 11) {
    float s = 1.02 + 0.13*sin(t*0.58);
    float u = x*s, v = y*s, w = z*s;
    float T4u = 8.0*u*u*u*u - 8.0*u*u + 1.0;
    float T4v = 8.0*v*v*v*v - 8.0*v*v + 1.0;
    float T4w = 8.0*w*w*w*w - 8.0*w*w + 1.0;
    return T4u + T4v + T4w;
  }

  // 12. Rippled cone — cone with a sinusoidal ripple traveling along the axis
  if (u_surfaceIndex == 12) {
    float wave = y + 0.18*sin(4.5*y - 1.6*t);
    return x*x + z*z - wave*wave;
  }

  // 13. Pulsing Gaussian — height and width of a radial bump oscillate
  if (u_surfaceIndex == 13) {
    float A     = 0.52 + 0.32*sin(t*0.90);
    float sigma = 0.22 + 0.10*sin(t*1.30 + 1.0);
    float r2    = x*x + z*z;
    return y - A*exp(-r2 / (sigma*sigma));
  }

  // 14. Schoen I-WP — triply periodic surface; threshold c(t) sweeps through a family
  if (u_surfaceIndex == 14) {
    float c = 0.80*sin(t*0.50);
    return cos(2.0*x)*cos(2.0*y) + cos(2.0*y)*cos(2.0*z) + cos(2.0*z)*cos(2.0*x) - c;
  }

  // 15. Saddle blend — cross-term A(t)·xz rotates the principal curvature axes
  if (u_surfaceIndex == 15) {
    float A = 1.20*sin(t*0.65);
    return y - 0.72*(x*x - z*z + A*x*z);
  }

  // 16. Twisted torus — tube radius modulated sinusoidally around the ring angle
  if (u_surfaceIndex == 16) {
    float theta  = atan(z, x);
    float r_tube = 0.10 + 0.06*sin(4.0*theta - t*0.95);
    float R      = 0.62;
    float qr     = length(vec2(x, z)) - R;
    return qr*qr + y*y - r_tube*r_tube;
  }

  // 17. Bumpy sphere — latitude/longitude bumps rotate around the sphere
  if (u_surfaceIndex == 17) {
    float lon  = atan(z, x) - t*0.38;
    float lat  = atan(y, length(vec2(x, z)));
    float bump = 0.16*sin(3.0*lon)*sin(2.0*lat);
    float r    = 0.72 + bump;
    return dot(q, q) - r*r;
  }

  // 18. Wavy hyperboloid — sinusoidal ripple modulates the xz cross-section
  if (u_surfaceIndex == 18) {
    float A = 0.28*sin(t*0.72);
    return x*x*(1.0 + A*sin(2.8*y - t)) + z*z - y*y - 0.40;
  }

  // 19. Permuted cubic — cyclic cubic x²y + y²z + z²x = A(t)
  if (u_surfaceIndex == 19) {
    float A = 0.20 + 0.14*sin(t*0.82);
    return x*x*y + y*y*z + z*z*x - A;
  }

  // 20. Flipping paraboloid — a=sin, b=cos at same frequency: cycles bowl→saddle→inverted bowl→saddle
  if (u_surfaceIndex == 20) {
    float ph = t * 0.58;
    float a = 0.80*sin(ph);
    float b = 0.80*cos(ph + 0.55);
    return y - a*x*x - b*z*z + 0.18;
  }

  return 1e10;
}
