precision highp float;

uniform vec2      iResolution;
uniform float     iTime;
uniform sampler2D u_amp_hist;  // 128×1, amplitude history: left=oldest, right=newest
uniform float     u_amp;

// INCLUDE_LIGHTING

#define MAX_STEPS 80
#define MAX_DIST  10.0
#define SURF_DIST 0.0008

float sceneSDF(vec3 p);

float sdBox(vec3 p, vec3 b) {
    vec3 q = abs(p) - b;
    return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sceneSDF(vec3 p) {
    return sdBox(p, vec3(3.2, 0.03, 0.6));
}

vec3 calcNormal(vec3 p) {
    const vec2 e = vec2(0.002, 0.0);
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

        // Screen x → bar x position and history lookup [0, 1]
        float normX = clamp(uv.x / aspect, -1.0, 1.0);
        float barX  = normX * 3.2;
        float t     = normX * 0.5 + 0.5;  // [0=oldest, 1=newest]

        // Amplitude at this moment in history drives the camera orbit angle
        float energy = texture2D(u_amp_hist, vec2(t, 0.5)).r;

        // Per-column camera orbits in the YZ plane around (barX, 0, 0)
        // Base spin + audio kick on top
        float camR  = 2.2;
        float angle = iTime * 0.7 + energy * 7.0;
        vec3  ro    = vec3(barX, camR * sin(angle), -camR * cos(angle));

        vec3 fwd    = normalize(vec3(barX, 0.0, 0.0) - ro);
        vec3 up_dir = normalize(cross(fwd, vec3(1.0, 0.0, 0.0)));

        vec3 rd = normalize(fwd * 3.5 + uv.y * up_dir);

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
