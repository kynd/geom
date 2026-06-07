precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform sampler2D u_amp_hist;  // 240×1: t=0 oldest (left edge), t=1 newest (right edge)
uniform float     u_amp;
uniform int       u_ssaa;

// INCLUDE_LIGHTING

#define MAX_STEPS 100
#define MAX_DIST  10.0
#define SURF_DIST 0.0006

float sceneSDF(vec3 p);

float sdRoundBox(vec3 p, vec3 b, float r) {
    vec3 q = abs(p) - b + r;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

float sceneSDF(vec3 p) {
    // Y=0.025 thin face toward camera; Z=0.35 gives deep top/bottom faces visible from above/below
    // r=0.022 makes the cross-section a near-capsule shape
    return sdRoundBox(p, vec3(1.07, 0.025, 0.35), 0.022);
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.0015, 0.0);
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

    float aspect = iResolution.x / iResolution.y;

    for (int s = 0; s < 4; s++) {
        vec2 off = u_ssaa == 1 ? offs[s] : vec2(0.0);
        vec2 uv = ((gl_FragCoord.xy + off) * 2.0 - iResolution.xy) / iResolution.y;

        float normX = clamp(uv.x / aspect, -1.0, 1.0);
        float barX  = normX * 1.07;

        // Centre = current (t=0.5), left = past, right = future
        float t = normX * 0.5 + 0.5;

        // 5-tap Gaussian blur across history samples for spatial smoothness
        float dt = 1.0 / 240.0;
        float energy =
            texture2D(u_amp_hist, vec2(t - 2.0 * dt, 0.5)).r * 0.0625 +
            texture2D(u_amp_hist, vec2(t -       dt, 0.5)).r * 0.25   +
            texture2D(u_amp_hist, vec2(t,             0.5)).r * 0.375  +
            texture2D(u_amp_hist, vec2(t +       dt, 0.5)).r * 0.25   +
            texture2D(u_amp_hist, vec2(t + 2.0 * dt, 0.5)).r * 0.0625;

        // Centre emphasis: 2x at normX=0, 1x outside ±1/16, smooth S-curve
        float emphasisW = smoothstep(1.0 / 16.0, 0.0, abs(normX));

        // camY < 0 = camera below bar → bar appears higher on screen when loud
        float camY = -(energy - 0.15) * 0.55 * (1.0 + emphasisW);
        vec3 ro = vec3(barX, camY, -2.2);
        // Straight rays: camY shifts bar vertically so loud columns rise, quiet ones sit near centre
        vec3 rd = normalize(vec3(0.0, uv.y, 3.5));

        float dist = 0.02;
        for (int i = 0; i < MAX_STEPS; i++) {
            float d = sceneSDF(ro + rd * dist);
            if (abs(d) < SURF_DIST || dist > MAX_DIST) break;
            dist += d * 0.5;
        }

        vec3 col = vec3(0.0);
        if (dist < MAX_DIST) {
            vec3 p = ro + rd * dist;
            vec3 n = calcNormal(p);
            if (dot(n, -rd) < 0.0) n = -n;
            float brightness = smoothstep(0.0, 0.35, energy);
            col = stdLighting(p, n, rd) * brightness;
        }
        totalCol += col;
        if (u_ssaa == 0) break;
    }

    totalCol /= u_ssaa == 1 ? 4.0 : 1.0;
    totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
    gl_FragColor = vec4(totalCol, 1.0);
}
