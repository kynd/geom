// Reusable LAB-based environment map generator.
// Mapping: azimuth angle → hue, elevation angle → luminosity.
// At each (H, L) cell the chroma is the maximum that fits inside the sRGB gamut.
// The returned DataTexture stores *linear* RGB values (no gamma encoding).
// Usage: import { buildEnvMapTexture } from '../../js/lab-envmap.js';
//        const tex = buildEnvMapTexture(THREE, 256, 128);

const D65 = [0.9504492182750991, 1.0, 1.0889166484304715];
const EPSILON = 216 / 24389;
const KAPPA   = 24389 / 27;

function labToXYZ(L, a, b) {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const rx = fx ** 3 > EPSILON ? fx ** 3 : (fx * 116 - 16) / KAPPA;
  const ry = L > KAPPA * EPSILON ? ((L + 16) / 116) ** 3 : L / KAPPA;
  const rz = fz ** 3 > EPSILON ? fz ** 3 : (fz * 116 - 16) / KAPPA;
  return [D65[0] * rx, D65[1] * ry, D65[2] * rz];
}

function xyzToLinearRGB(x, y, z) {
  return [
     3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
     0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

function inGamut(r, g, b) {
  return r >= -0.001 && r <= 1.001 &&
         g >= -0.001 && g <= 1.001 &&
         b >= -0.001 && b <= 1.001;
}

function maxChromaForLH(L, H) {
  let lo = 0, hi = 200;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const [x, y, z] = labToXYZ(L, mid * Math.cos(H), mid * Math.sin(H));
    const [r, g, b] = xyzToLinearRGB(x, y, z);
    if (inGamut(r, g, b)) lo = mid; else hi = mid;
  }
  return lo;
}

// width  = azimuth resolution (wraps horizontally)
// height = elevation resolution (clamped vertically)
export function buildEnvMapTexture(THREE, width = 256, height = 128) {
  const data   = new Uint8Array(width * height * 4);
  const TWO_PI = Math.PI * 2;

  for (let row = 0; row < height; row++) {
    // row 0 = bottom (elevation -π/2, L=0=black), row height-1 = top (elevation +π/2, L=100=white)
    const L = (row / (height - 1)) * 100;

    for (let col = 0; col < width; col++) {
      const H = (col / width) * TWO_PI;   // hue angle matches azimuth angle
      const C = maxChromaForLH(L, H);
      const [x, y, z] = labToXYZ(L, C * Math.cos(H), C * Math.sin(H));
      const [r, g, b] = xyzToLinearRGB(x, y, z);

      const idx = (row * width + col) * 4;
      data[idx + 0] = Math.round(Math.max(0, Math.min(1, r)) * 255);
      data[idx + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      data[idx + 2] = Math.round(Math.max(0, Math.min(1, b)) * 255);
      data[idx + 3] = 255;
    }
  }

  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.wrapS     = THREE.RepeatWrapping;
  texture.wrapT     = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}
