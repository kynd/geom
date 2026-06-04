precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform sampler2D u_amp_hist;  // 1920×1: t=0 oldest, t=1 newest (centre of screen)
uniform float     u_amp;

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
    // Long axis X, short Y, medium depth Z — cross-section is a rounded rectangle
    return sdRoundBox(p, vec3(1.07, 0.025, 0.20), 0.010);
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
        vec2 uv = ((gl_FragCoord.xy + offs[s]) * 2.0 - iResolution.xy) / iResolution.y;

        // normX in [-1,1] across the screen (aspect-corrected)
        float normX = clamp(uv.x / aspect, -1.0, 1.0);
        float barX  = normX * 1.07;

        // Symmetric display: centre = newest frame (t=1), edges = oldest (t=0)
        float t      = 1.0 - abs(normX);
        float energy = texture2D(u_amp_hist, vec2(t, 0.5)).r;

        // Base camera orbit in the YZ plane around (barX, 0, 0)
        float camR  = 2.2;
        float angle = iTime * 0.7 + energy * 7.0;
        vec3  ro    = vec3(barX, camR * sin(angle), -camR * cos(angle));

        // Pre-rotation up direction (perpendicular to fwd and X axis)
        vec3 fwd0 = normalize(vec3(barX, 0.0, 0.0) - ro);
        vec3 up0  = normalize(cross(fwd0, vec3(1.0, 0.0, 0.0)));

        // Warp: translate camera in up0 near centre; envelope decays over ~1/16 screen width
        // sigma = 1/16 of normX range → 1/(2*sigma^2) ≈ 128
        float warpEnv = exp(-normX * normX * 128.0);
        ro += up0 * (u_amp * 1.5 * warpEnv);

        // Recompute view direction from warped position
        vec3 fwd    = normalize(vec3(barX, 0.0, 0.0) - ro);
        vec3 up_dir = normalize(cross(fwd, vec3(1.0, 0.0, 0.0)));
        vec3 rd     = normalize(fwd * 3.5 + uv.y * up_dir);

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
    }

    totalCol /= 4.0;
    totalCol = pow(max(totalCol, 0.0), vec3(0.4545));
    gl_FragColor = vec4(totalCol, 1.0);
}
