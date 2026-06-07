const float PHI = 1.61803398875;
const float S3  = 0.57735027;  // 1/sqrt(3)

mat3 rotX(float a) {
  float c = cos(a), s = sin(a);
  return mat3(1.0,0.0,0.0, 0.0,c,-s, 0.0,s,c);
}
mat3 rotY(float a) {
  float c = cos(a), s = sin(a);
  return mat3(c,0.0,s, 0.0,1.0,0.0, -s,0.0,c);
}

// All shapes normalised to circumradius = 1

float sdCube(vec3 p) {
  vec3 q = abs(p) - vec3(S3);
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

// sdOctahedron(vec3) — unit circumradius, distinct from sdOctahedron(vec3,float) in sdf-functions
float sdOctahedron(vec3 p) {
  p = abs(p);
  float m = p.x + p.y + p.z - 1.0;
  vec3 q;
  if      (3.0*p.x < m) q = p.xyz;
  else if (3.0*p.y < m) q = p.yzx;
  else if (3.0*p.z < m) q = p.zxy;
  else                  return m * S3;
  float k = clamp(0.5*(q.z - q.y + 1.0), 0.0, 1.0);
  return length(vec3(q.x, q.y - 1.0 + k, q.z - k));
}

float sdTetrahedron(vec3 p) {
  float d = max(max(p.x+p.y-p.z, p.x-p.y+p.z), max(-p.x+p.y+p.z, -p.x-p.y-p.z));
  return d * S3 - 0.33333333;
}

float sdDualTetrahedron(vec3 p) {
  float d = max(max(p.x+p.y+p.z, p.x-p.y-p.z), max(-p.x+p.y-p.z, -p.x-p.y+p.z));
  return d * S3 - 0.33333333;
}

float sdDodecahedron(vec3 p) {
  const float N   = 1.90211303;
  const float RIN = 0.79465448;
  vec3 q = abs(p);
  float a = (q.y + PHI*q.z) / N;
  float b = (q.x + PHI*q.y) / N;
  float c = (PHI*q.x + q.z) / N;
  return max(max(a, b), c) - RIN;
}

float sdIcosahedron(vec3 p) {
  const float RIN = 0.79465448;
  vec3 q = abs(p);
  float dA = (q.x + q.y + q.z) * S3;
  float dB = (PHI*q.y + q.z/PHI) * S3;
  float dC = (q.x/PHI + PHI*q.z) * S3;
  float dD = (PHI*q.x + q.y/PHI) * S3;
  return max(max(dA, dB), max(dC, dD)) - RIN;
}
