import { Z } from './ZalpCore.js';
// WebGL2 renderer: procedural sky with parallax ridges, destructible terrain from a mask texture,
// animated water/lava, and one premultiplied sprite batch (alpha 0 in a vertex colour = additive glow).
Z.R = (function () {
    let gl, canvas, frames, atlasTex, maskTex, fsVao;
    let progSky, progTer, progWat, progSpr;
    let maskW = 1, maskH = 1;
    const view = { w: 1, h: 1, x: 0, y: 0, zoom: 1, dpr: 1 };

    const HEAD = `#version 300 es
precision highp float;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom;
out vec4 o;
float sstep(float a, float b, float x){ float t = clamp((x - a)/(b - a), 0.0, 1.0); return t*t*(3.0 - 2.0*t); }
vec2 worldPos(){ return vec2(u_cam.x + (gl_FragCoord.x - u_res.x*0.5)/u_zoom, u_cam.y + (u_res.y*0.5 - gl_FragCoord.y)/u_zoom); }
float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0 - 2.0*f);
    float a = hash(i), b = hash(i + vec2(1,0)), c = hash(i + vec2(0,1)), d = hash(i + vec2(1,1));
    return mix(mix(a,b,u.x), mix(c,d,u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ s += a*vnoise(p); p = p*2.03 + vec2(17.1, 9.2); a *= 0.5; } return s/0.9375; }
`;
    const FS_VERT = `#version 300 es
in vec2 a_pos; void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;

    const SKY = HEAD + `
uniform vec3 u_sky0, u_sky1, u_h0, u_h1, u_h2, u_cloud, u_sun;
uniform float u_time, u_wind, u_seed, u_stars;
float ridge(float x, float f, float s){ return fbm(vec2(x*f + s, s*0.37)); }
void main(){
    vec2 fc = gl_FragCoord.xy;
    float t = fc.y / u_res.y;
    vec3 col = mix(u_sky1, u_sky0, pow(clamp(t, 0.0, 1.0), 0.85));
    if (u_stars > 0.5) { vec2 sp = floor(fc / 2.0); float s = hash(sp + u_seed); col += vec3(step(0.9975, s) * sstep(0.35, 0.9, t) * (0.5 + 0.5*sin(u_time*2.0 + s*90.0))); }
    vec2 sunp = vec2(u_res.x*0.76 - u_cam.x*0.02*u_zoom, u_res.y*0.8 + u_cam.y*0.01*u_zoom);
    float sd = length(fc - sunp) / (u_res.y);
    col += u_sun * (sstep(0.075, 0.068, sd) * 0.9 + exp(-sd*7.0)*0.35);
    vec2 hp = vec2((fc.x - u_res.x*0.5)/u_zoom, (u_res.y*0.5 - fc.y)/u_zoom);
    // clouds drift with the wind
    vec2 cp = hp + u_cam*0.08 - vec2(u_wind, 0.0);
    float cd = fbm(vec2(cp.x*0.0035, cp.y*0.011) + u_seed);
    float band = sstep(260.0, -60.0, cp.y + u_cam.y*0.0) * sstep(-700.0, -300.0, cp.y);
    col = mix(col, u_cloud, sstep(0.52, 0.74, cd) * 0.75 * band);
    // three parallax ridges, far to near
    float f[3] = float[3](0.12, 0.26, 0.45);
    float base[3] = float[3](430.0, 560.0, 700.0);
    float amp[3] = float[3](360.0, 300.0, 240.0);
    float fr[3] = float[3](0.0016, 0.0024, 0.0035);
    vec3 hc[3] = vec3[3](u_h0, u_h1, u_h2);
    for (int i = 0; i < 3; i++) {
        vec2 lp = hp + u_cam*f[i] + vec2(0.0, 520.0*(1.0 - f[i]));
        float r = base[i] - ridge(lp.x, fr[i], u_seed + float(i)*13.0) * amp[i] - vnoise(vec2(lp.x*0.03, float(i)))*10.0;
        float m = sstep(r - 1.2/u_zoom, r + 1.2/u_zoom, lp.y);
        vec3 c = hc[i] * (1.0 - sstep(r, r + 600.0, lp.y) * 0.25);
        col = mix(col, c, m);
    }
    o = vec4(col, 1.0);
}`;

    const TER = HEAD + `
uniform sampler2D u_mask; uniform vec2 u_size;
uniform vec3 u_dirt0, u_dirt1, u_rock, u_top0, u_top1, u_burn, u_edge;
uniform float u_topThick;
float M(vec2 p){ return texture(u_mask, p / u_size).r; }
void main(){
    vec2 p = worldPos();
    if (p.x < 0.0 || p.x > u_size.x || p.y < 0.0) discard;
    vec2 m = texture(u_mask, p / u_size).rg;
    float a = sstep(0.32, 0.6, m.r);
    if (a < 0.01) discard;
    float topD = 99.0;
    for (int i = 1; i <= 8; i++) { if (M(p - vec2(0.0, float(i)*1.8)) < 0.5) { topD = float(i)*1.8; break; } }
    // only fairly level ground gets the top layer; steep walls stay bare
    if (topD < 99.0 && (M(p + vec2(-2.5, -topD - 4.0)) > 0.5 || M(p + vec2(2.5, -topD - 4.0)) > 0.5)) topD = 99.0;
    vec2 g = vec2(M(p + vec2(1.6, 0.0)) - M(p - vec2(1.6, 0.0)), M(p + vec2(0.0, 1.6)) - M(p - vec2(0.0, 1.6)));
    float glen = length(g);
    float edge = clamp(glen * 1.3, 0.0, 1.0);
    vec2 n = glen > 0.001 ? -g / glen : vec2(0.0, -1.0);
    float light = dot(n, normalize(vec2(-0.45, -0.9)));
    float strata = fbm(vec2(p.x*0.004, p.y*0.03));
    vec3 col = mix(u_dirt0, u_dirt1, sstep(0.35, 0.68, strata));
    float rocks = vnoise(p*0.085 + 7.3);
    col = mix(col, u_rock * (0.85 + 0.3*vnoise(p*0.4)), sstep(0.7, 0.76, rocks) * 0.9);
    col *= 0.9 + 0.2*vnoise(p*0.55);
    col *= 1.0 - sstep(0.78, 0.86, vnoise(p*0.21 + 3.0)) * 0.22;
    col *= mix(1.0, 0.7, sstep(350.0, 1250.0, p.y));
    float thick = u_topThick * (0.65 + 0.7*vnoise(vec2(p.x*0.12, 3.1)));
    if (topD < thick) {
        vec3 tc = mix(u_top0, u_top1, vnoise(vec2(p.x*0.35, p.y*0.25)));
        tc *= 0.85 + 0.3*sstep(thick, 0.0, topD);
        col = mix(col, tc, sstep(thick, thick - 2.0, topD));
    }
    col += edge * max(light, 0.0) * 0.16;
    col = mix(col, u_edge, edge * sstep(0.2, -0.7, light) * 0.4);
    col = mix(col, u_burn, clamp(m.g, 0.0, 1.0) * 0.85);
    col = mix(u_edge, col, sstep(0.32, 0.85, m.r));
    o = vec4(col * a, a);
}`;

    const WAT = HEAD + `
uniform float u_waterY, u_time, u_lava, u_alpha, u_layer;
uniform vec3 u_wTop, u_wDeep;
void main(){
    vec2 p = worldPos();
    float t = u_time;
    float ph = u_layer * 2.3;
    float wave = sin(p.x*0.017 + t*1.5 + ph)*3.4 + sin(p.x*0.043 - t*2.2 + ph)*1.5 + sin(p.x*0.11 + t*3.1)*0.6;
    float surf = u_waterY + wave - (1.0 - u_layer) * 9.0;
    if (p.y < surf) discard;
    float d = p.y - surf;
    vec3 col;
    float alpha = u_alpha;
    if (u_lava > 0.5) {
        float flow = fbm(vec2(p.x*0.012 + t*0.12, p.y*0.03 - t*0.05));
        col = mix(vec3(1.0, 0.86, 0.35), vec3(0.75, 0.14, 0.03), sstep(0.0, 70.0, d));
        col = mix(col, vec3(1.0, 0.95, 0.6), sstep(0.6, 0.85, flow) * 0.6);
        col *= mix(0.55, 1.0, u_layer);
        col = mix(col, vec3(1.0, 0.98, 0.7), sstep(2.5, 0.0, d) * u_layer);
    } else {
        col = mix(u_wTop, u_wDeep, sstep(0.0, 170.0, d));
        col += 0.06 * vnoise(vec2(p.x*0.05 + t*0.6, p.y*0.07 - t*0.35));
        col *= mix(0.62, 1.0, u_layer);
        col = mix(col, vec3(1.0), sstep(3.0, 0.0, d) * 0.75 * u_layer);
    }
    o = vec4(col * alpha, alpha);
}`;

    const SPR_V = `#version 300 es
in vec2 a_pos; in vec2 a_uv; in vec4 a_col;
uniform vec2 u_res; uniform vec2 u_cam; uniform float u_zoom;
out vec2 v_uv; out vec4 v_col;
void main(){ vec2 c = (a_pos - u_cam) * u_zoom * 2.0 / u_res; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); v_uv = a_uv; v_col = a_col; }`;
    const SPR_F = `#version 300 es
precision mediump float;
uniform sampler2D u_tex; in vec2 v_uv; in vec4 v_col; out vec4 o;
void main(){ o = texture(u_tex, v_uv) * v_col; }`;

    function compile(vs, fs) {
        const mk = (type, src) => {
            const s = gl.createShader(type);
            gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        const p = gl.createProgram();
        gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
        gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
        gl.bindAttribLocation(p, 0, 'a_pos'); gl.bindAttribLocation(p, 1, 'a_uv'); gl.bindAttribLocation(p, 2, 'a_col');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        const u = {};
        const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); }
        return { p, u };
    }

    // ---------------------------------------------------------------- sprite batch
    const MAX = 8000, FL = 8;
    const vdata = new Float32Array(MAX * 4 * FL);
    let count = 0, vbo, ibo, sprVao, solidU = 0, solidV = 0;

    function push(x, y, u, v, r, g, b, a) {
        const o = count * 4 * FL + push.k; push.k += FL;
        vdata[o] = x; vdata[o + 1] = y; vdata[o + 2] = u; vdata[o + 3] = v;
        vdata[o + 4] = r; vdata[o + 5] = g; vdata[o + 6] = b; vdata[o + 7] = a;
    }
    push.k = 0;

    // sx/sy are scale factors (negative sx mirrors); col = [r,g,b] or null; add = additive glow
    function spr(name, x, y, sx = 1, sy = 1, rot = 0, col = null, alpha = 1, add = false) {
        if (count >= MAX) flush();
        const f = frames[name];
        if (!f) return;
        const l = -f.ax * f.w * sx, rgt = (1 - f.ax) * f.w * sx, t = -f.ay * f.h * sy, btm = (1 - f.ay) * f.h * sy;
        const c = Math.cos(rot), s = Math.sin(rot);
        const r = (col ? col[0] : 1) * alpha, g = (col ? col[1] : 1) * alpha, b = (col ? col[2] : 1) * alpha, a = add ? 0 : alpha;
        push.k = 0;
        push(x + l * c - t * s, y + l * s + t * c, f.u0, f.v0, r, g, b, a);
        push(x + rgt * c - t * s, y + rgt * s + t * c, f.u1, f.v0, r, g, b, a);
        push(x + rgt * c - btm * s, y + rgt * s + btm * c, f.u1, f.v1, r, g, b, a);
        push(x + l * c - btm * s, y + l * s + btm * c, f.u0, f.v1, r, g, b, a);
        count++;
    }

    function line(x0, y0, x1, y1, w, col, alpha = 1, add = false) {
        if (count >= MAX) flush();
        const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
        const nx = (-dy / len) * w * 0.5, ny = (dx / len) * w * 0.5;
        const r = col[0] * alpha, g = col[1] * alpha, b = col[2] * alpha, a = add ? 0 : alpha;
        push.k = 0;
        push(x0 + nx, y0 + ny, solidU, solidV, r, g, b, a);
        push(x1 + nx, y1 + ny, solidU, solidV, r, g, b, a);
        push(x1 - nx, y1 - ny, solidU, solidV, r, g, b, a);
        push(x0 - nx, y0 - ny, solidU, solidV, r, g, b, a);
        count++;
    }

    function camUniforms(u) {
        gl.uniform2f(u.u_res, view.w, view.h);
        gl.uniform2f(u.u_cam, view.x, view.y);
        gl.uniform1f(u.u_zoom, view.zoom);
    }

    function flush() {
        if (!count) return;
        gl.useProgram(progSpr.p);
        camUniforms(progSpr.u);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.uniform1i(progSpr.u.u_tex, 0);
        gl.bindVertexArray(sprVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, vdata, 0, count * 4 * FL);
        gl.drawElements(gl.TRIANGLES, count * 6, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(null);
        count = 0;
    }

    // ---------------------------------------------------------------- setup
    function init(cv) {
        canvas = cv;
        gl = cv.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: true, powerPreference: 'high-performance' });
        if (!gl) throw new Error('WebGL 2 is not available');
        progSky = compile(FS_VERT, SKY);
        progTer = compile(FS_VERT, TER);
        progWat = compile(FS_VERT, WAT);
        progSpr = compile(SPR_V, SPR_F);

        fsVao = gl.createVertexArray();
        gl.bindVertexArray(fsVao);
        const fsb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, fsb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        sprVao = gl.createVertexArray();
        gl.bindVertexArray(sprVao);
        vbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, vdata.byteLength, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, FL * 4, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, FL * 4, 8);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, FL * 4, 16);
        const ind = new Uint16Array(MAX * 6);
        for (let i = 0; i < MAX; i++) { const v = i * 4, o = i * 6; ind.set([v, v + 1, v + 2, v, v + 2, v + 3], o); }
        ibo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, ind, gl.STATIC_DRAW);
        gl.bindVertexArray(null);

        const atlas = Z.Art.build();
        frames = atlas.frames;
        const sq = frames.sq; solidU = (sq.u0 + sq.u1) / 2; solidV = (sq.v0 + sq.v1) / 2;
        atlasTex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, atlasTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

        maskTex = gl.createTexture();
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        resize();
    }

    function resize() {
        view.dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = Math.max(1, Math.round(canvas.clientWidth * view.dpr));
        const h = Math.max(1, Math.round(canvas.clientHeight * view.dpr));
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        view.w = w; view.h = h;
        gl.viewport(0, 0, w, h);
    }

    function uploadMask(data, W, H) {
        maskW = W; maskH = H;
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, W, H, 0, gl.RG, gl.UNSIGNED_BYTE, data);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    function updateMask(data, x0, y0, x1, y1) {
        x0 = Math.max(0, x0 | 0); y0 = Math.max(0, y0 | 0);
        x1 = Math.min(maskW, Math.ceil(x1)); y1 = Math.min(maskH, Math.ceil(y1));
        if (x1 <= x0 || y1 <= y0) return;
        gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, maskW);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x1 - x0, y1 - y0, gl.RG, gl.UNSIGNED_BYTE, data);
        gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    }

    // theme colours are hex strings; convert once and cache on the theme
    function tc(theme) {
        if (theme._gl) return theme._gl;
        const out = {};
        for (const [k, v] of Object.entries(theme)) if (typeof v === 'string' && v[0] === '#') out[k] = Z.hex(v).slice(0, 3);
        out.hills = theme.hills.map((h) => Z.hex(h).slice(0, 3));
        return (theme._gl = out);
    }

    function setView(x, y, zoom) { view.x = x; view.y = y; view.zoom = zoom; }

    function fullscreen(prog) { gl.useProgram(prog.p); camUniforms(prog.u); return prog.u; }
    function drawFS() { gl.bindVertexArray(fsVao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null); }

    function drawSky(theme, time, wind, seed) {
        const c = tc(theme), u = fullscreen(progSky);
        gl.uniform3fv(u.u_sky0, c.sky0); gl.uniform3fv(u.u_sky1, c.sky1);
        gl.uniform3fv(u.u_h0, c.hills[0]); gl.uniform3fv(u.u_h1, c.hills[1]); gl.uniform3fv(u.u_h2, c.hills[2]);
        gl.uniform3fv(u.u_cloud, c.cloud); gl.uniform3fv(u.u_sun, c.sun);
        gl.uniform1f(u.u_time, time); gl.uniform1f(u.u_wind, wind); gl.uniform1f(u.u_seed, seed % 97);
        gl.uniform1f(u.u_stars, theme.stars ? 1 : 0);
        drawFS();
    }

    function drawTerrain(theme) {
        const c = tc(theme), u = fullscreen(progTer);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, maskTex);
        gl.uniform1i(u.u_mask, 1);
        gl.uniform2f(u.u_size, maskW, maskH);
        gl.uniform3fv(u.u_dirt0, c.dirt0); gl.uniform3fv(u.u_dirt1, c.dirt1); gl.uniform3fv(u.u_rock, c.rock);
        gl.uniform3fv(u.u_top0, c.top0); gl.uniform3fv(u.u_top1, c.top1);
        gl.uniform3fv(u.u_burn, c.burn); gl.uniform3fv(u.u_edge, c.edge);
        gl.uniform1f(u.u_topThick, theme.topThick || 9);
        drawFS();
        gl.activeTexture(gl.TEXTURE0);
    }

    function drawWater(theme, waterY, time, front) {
        const c = tc(theme), u = fullscreen(progWat);
        gl.uniform1f(u.u_waterY, waterY); gl.uniform1f(u.u_time, time);
        gl.uniform1f(u.u_lava, theme.lava ? 1 : 0);
        gl.uniform1f(u.u_alpha, front ? (theme.lava ? 1 : 0.8) : 1);
        gl.uniform1f(u.u_layer, front ? 1 : 0);
        gl.uniform3fv(u.u_wTop, c.wTop); gl.uniform3fv(u.u_wDeep, c.wDeep);
        drawFS();
    }

    function clear() { gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); }

    return { init, resize, uploadMask, updateMask, setView, drawSky, drawTerrain, drawWater, spr, line, flush, clear, view, frame: (n) => frames[n] };
})();
