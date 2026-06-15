// Reusable OKLCH-based environment map generator.
// Mapping: azimuth angle → hue, elevation angle → luminosity.
// At each (H, L) cell the chroma is the maximum that fits inside the sRGB gamut.
// The returned DataTexture stores *linear* RGB values (no gamma encoding).
// Usage: import { buildEnvMapTexture } from '../../js/oklch-envmap.js';
//        const tex = buildEnvMapTexture(THREE, 256, 128);

function oklabToLinearRGB(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l  = l_ * l_ * l_;
  const m  = m_ * m_ * m_;
  const s  = s_ * s_ * s_;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}

function inGamut(r, g, b) {
  return r >= -0.001 && r <= 1.001 &&
         g >= -0.001 && g <= 1.001 &&
         b >= -0.001 && b <= 1.001;
}

function maxChromaForLH(L, H) {
  let lo = 0, hi = 0.5;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) * 0.5;
    const [r, g, b] = oklabToLinearRGB(L, mid * Math.cos(H), mid * Math.sin(H));
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
    // row 0 = bottom (elevation -π/2, L=0=black), row height-1 = top (elevation +π/2, L=1=white)
    const L = row / (height - 1);

    for (let col = 0; col < width; col++) {
      const H = (col / width) * TWO_PI;
      const C = maxChromaForLH(L, H);
      const [r, g, b] = oklabToLinearRGB(L, C * Math.cos(H), C * Math.sin(H));

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
