precision highp float;

uniform vec2  iResolution;
uniform float iTime;
uniform float u_fft[128];   // L channel
uniform float u_fft_R[128]; // R channel
uniform float u_amp;
uniform int   u_ssaa;

// INCLUDE_LIGHTING

#define MAX_STEPS 64
#define MAX_DIST  20.0
#define SURF_DIST 0.003

float sceneSDF(vec3 p);

float waveHeight(vec2 xz) {
    float r  = length(xz);
    // Smooth L→R blend across the horizontal axis: left=L, centre=mix, right=R
    float lr = smoothstep(-2.5, 2.5, xz.x);
    float h  = 0.0;
    // Bass: large concentric swells
    h += mix(u_fft[0],  u_fft_R[0],  lr) * 0.26 * sin(r * 1.0  - iTime * 0.45);
    h += mix(u_fft[8],  u_fft_R[8],  lr) * 0.20 * sin(r * 1.7  - iTime * 0.60 + 1.3);
    h += mix(u_fft[16], u_fft_R[16], lr) * 0.16 * sin(r * 2.6  - iTime * 0.75 + 2.7);
    h += mix(u_fft[24], u_fft_R[24], lr) * 0.12 * sin(r * 3.8  - iTime * 0.90 + 0.9);
    // Mids
    h += mix(u_fft[32], u_fft_R[32], lr) * 0.08 * sin(r * 5.5  - iTime * 1.10 + 4.2);
    h += mix(u_fft[48], u_fft_R[48], lr) * 0.06 * sin(r * 8.0  - iTime * 1.30 + 5.8);
    h += mix(u_fft[64], u_fft_R[64], lr) * 0.04 * sin(r * 12.0 - iTime * 1.55 + 2.1);
    // Highs: fine rings
    h += mix(u_fft[80], u_fft_R[80], lr) * 0.025 * sin(r * 18.0 - iTime * 1.80 + 3.5);
    h += mix(u_fft[96], u_fft_R[96], lr) * 0.015 * sin(r * 28.0 - iTime * 2.10 + 1.4);
    return h;
}

float sceneSDF(vec3 p) {
    return p.y - waveHeight(p.xz);
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.003, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
}

// Grazing light: volume-driven intensity for strobe effect — quiet=black, loud=overexposed
vec3 grazingLight(vec3 p, vec3 n, vec3 rd) {
    float lum = pow(clamp(u_amp * 2.0, 0.0, 1.0), 1.5) * 3.0;
    vec3  lk = normalize(vec3(1.0, 0.09, 0.4));   // ~5° above horizontal
    float dk = max(dot(n, lk), 0.0);
    vec3  lf = normalize(vec3(-0.5, 0.15, -0.4));
    float df = max(dot(n, lf), 0.0) * 0.06;
    vec3  col = vec3(0.90) * (dk * 0.99 + df);    // zero ambient — pure black in shadows
    vec3  hv  = normalize(lk - rd);
    col += vec3(0.80) * pow(max(dot(n, hv), 0.0), 96.0);
    return col * lum;
}

void main() {
    vec3 totalCol = vec3(0.0);

    vec2 offs[4];
    offs[0] = vec2(-0.25, -0.25);
    offs[1] = vec2( 0.25, -0.25);
    offs[2] = vec2(-0.25,  0.25);
    offs[3] = vec2( 0.25,  0.25);

    for (int s = 0; s < 4; s++) {
        vec2 off = u_ssaa == 1 ? offs[s] : vec2(0.0);
        vec2 uv = ((gl_FragCoord.xy + off) * 2.0 - iResolution.xy) / iResolution.y;

        // Camera directly overhead, looking straight down
        vec3 ro  = vec3(0.0, 4.5, 0.0);
        vec3 fwd = vec3(0.0, -1.0, 0.0);
        vec3 rgt = vec3(1.0,  0.0, 0.0);
        vec3 up  = vec3(0.0,  0.0, 1.0);
        vec3 rd  = normalize(fwd * 3.0 + uv.x * rgt + uv.y * up);

        float t = 0.02;
        for (int i = 0; i < MAX_STEPS; i++) {
            float d = sceneSDF(ro + rd * t);
            if (abs(d) < SURF_DIST || t > MAX_DIST) break;
            t += d * 0.6;
        }

        vec3 col = vec3(0.0);
        if (t < MAX_DIST) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p);
            if (dot(n, -rd) < 0.0) n = -n;
            col = grazingLight(p, n, rd);
        }
        totalCol += col;
        if (u_ssaa == 0) break;
    }

    totalCol /= u_ssaa == 1 ? 4.0 : 1.0;
    totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
    gl_FragColor = vec4(totalCol, 1.0);
}
