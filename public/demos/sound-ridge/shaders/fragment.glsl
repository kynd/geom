precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform sampler2D u_history; // width=128 (bands), height=HISTORY (frames), RGBA Uint8
uniform float     u_amp;

// INCLUDE_LIGHTING

#define MAX_STEPS 200
#define MAX_DIST  36.0
#define SURF_DIST 0.001

float sceneSDF(vec3 p);

// Blur constants: 2.5-pixel radius in each axis
const float HF = 2.5 / 128.0;
const float VF = 2.5 / 300.0;

// ch: vec4 channel mask — vec4(1,0,0,0) = L (stored in .r), vec4(0,1,0,0) = R (stored in .g)
float sampleChan(vec2 uv, vec4 ch) {
    return dot(texture2D(u_history, uv                   ), ch) * 0.50
         + dot(texture2D(u_history, uv + vec2( HF, 0.0) ), ch) * 0.125
         + dot(texture2D(u_history, uv + vec2(-HF, 0.0) ), ch) * 0.125
         + dot(texture2D(u_history, uv + vec2(0.0,  VF) ), ch) * 0.125
         + dot(texture2D(u_history, uv + vec2(0.0, -VF) ), ch) * 0.125;
}

float ridgeHeight(vec2 xz) {
    // xz.y in [0, 15] → time [0, 1]
    float ft = clamp(xz.y / 15.0, 0.0, 1.0);
    float v;
    if (xz.x < 0.0) {
        // Left half: L channel, flipped — lowest freq at centre (x=0), highest at left edge (x=-2)
        float fx = clamp(-xz.x * 0.5, 0.0, 1.0);
        v = sampleChan(vec2(fx, ft), vec4(1.0, 0.0, 0.0, 0.0));
    } else {
        // Right half: R channel, normal — lowest freq at centre (x=0), highest at right edge (x=2)
        float fx = clamp(xz.x * 0.5, 0.0, 1.0);
        v = sampleChan(vec2(fx, ft), vec4(0.0, 1.0, 0.0, 0.0));
    }
    float t = smoothstep(0.04, 0.80, v);
    return sqrt(t) * 1.1;
}

float sceneSDF(vec3 p) {
    return p.y - ridgeHeight(p.xz);
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.004, 0.0);
    return normalize(vec3(
        sceneSDF(p + e.xyy) - sceneSDF(p - e.xyy),
        sceneSDF(p + e.yxy) - sceneSDF(p - e.yxy),
        sceneSDF(p + e.yyx) - sceneSDF(p - e.yyx)
    ));
}

void main() {
    vec3 totalCol = vec3(0.0);

    vec2 offs[4];
    offs[0] = vec2(-0.25, -0.25);
    offs[1] = vec2( 0.25, -0.25);
    offs[2] = vec2(-0.25,  0.25);
    offs[3] = vec2( 0.25,  0.25);

    for (int s = 0; s < 4; s++) {
        // fc ∈ [-1,1]×[-1,1] (both axes normalised to screen half-height)
        vec2 fc = ((gl_FragCoord.xy + offs[s]) * 2.0 - iResolution.xy) / iResolution.xy;

        // Orthographic camera — all rays parallel
        // fc.x * 2.0  →  world x ∈ [-2, 2]  (screen width = freq range exactly)
        // fc.y * 3.0  →  sweeps height/depth axis so bottom=z≈0, top=z≈15
        vec3 fwd = normalize(vec3(0.0, -0.42, 1.0));
        vec3 rgt = vec3(1.0, 0.0, 0.0);
        vec3 up  = normalize(cross(fwd, rgt));   // (0, ~0.922, ~0.387)
        vec3 rd  = fwd;
        vec3 ro  = vec3(0.0, 4.5, -3.0) + rgt * (fc.x * 2.0) + up * (fc.y * 3.0);

        float t = 0.02;
        for (int i = 0; i < MAX_STEPS; i++) {
            float d = sceneSDF(ro + rd * t);
            if (abs(d) < SURF_DIST || t > MAX_DIST) break;
            t += d * 0.35;
        }

        vec3 col = vec3(0.0);
        if (t < MAX_DIST) {
            vec3 p = ro + rd * t;
            vec3 n = calcNormal(p);
            if (dot(n, -rd) < 0.0) n = -n;
            col = stdLighting(p, n, rd);
            col *= exp(-t * 0.02);
        }
        totalCol += col;
    }

    totalCol /= 4.0;
    totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
    gl_FragColor = vec4(totalCol, 1.0);
}
