/* ============================================================Aurora core: one WebGL blob, with a CSS fallback.
   ============================================================ */
const orb = (() => {
  const wrap = $('orbWrap');
  const canvas = $('orbCanvas');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const PALETTE = {
    idle: ['#5ee7ff', '#2f7bff', '#8b5cff'],
    listening: ['#7cf7ff', '#3bb7ff', '#6e7bff'],
    thinking: ['#4f8cff', '#8a5cff', '#ff79d8'],
    speaking: ['#66e8ff', '#4c7bff', '#ff8ad8'],
    waiting: ['#ffd08a', '#ff9f5c', '#ff7b7b'],
    done: ['#7dffd4', '#35d6ff', '#4f8cff'],
    error: ['#ff8a8a', '#c05cff', '#5a6b8c'],
  };
  const hex = (s) => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
  const colors = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, v.map(hex)]));
  let cur = colors.idle.slice();
  let target = colors.idle.slice();
  let mode = 'idle';
  let mic = 0;
  let gl = null, program = null, buffer = null, uniforms = {}, raf = 0, last = 0, level = 0.12;

  const vert = `
    attribute vec2 a;
    void main() { gl_Position = vec4(a, 0.0, 1.0); }
  `;
  const frag = `
    precision highp float;
    uniform vec2 u_res;
    uniform float u_time;
    uniform float u_level;
    uniform vec3 u_c1;
    uniform vec3 u_c2;
    uniform vec3 u_c3;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash(i), b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
      for (int i = 0; i < 3; i++) { v += a * noise(p); p = r * p * 2.03; a *= 0.5; }
      return v;
    }
    void main() {
      vec2 p = (gl_FragCoord.xy * 2.0 - u_res) / min(u_res.x, u_res.y);
      p.y = -p.y;
      float t = u_time;
      float lv = clamp(u_level, 0.0, 1.0);
      vec2 q = p * (1.0 + 0.02 * sin(t * 0.6));
      q.y *= 1.0 + 0.035 * sin(t * 0.42 + 0.6);
      q.x *= 1.0 - 0.02 * sin(t * 0.42 + 0.6);
      float warp = 0.08 + 0.08 * lv;
      q += warp * vec2(
        fbm(p * 2.2 + vec2(t * 0.17, -t * 0.13)),
        fbm(p * 2.2 + vec2(-t * 0.11, t * 0.19) + 5.2)
      );
      vec2 c1 = vec2(sin(t * 0.31), cos(t * 0.27)) * 0.30;
      vec2 c2 = vec2(sin(t * 0.23 + 2.1), cos(t * 0.31 + 1.2)) * 0.33;
      vec2 c3 = vec2(sin(t * 0.37 + 4.2), cos(t * 0.29 + 3.1)) * 0.27;
      vec2 c4 = vec2(sin(t * 0.19 + 1.4), cos(t * 0.41 + 5.2)) * 0.31;
      float rr = 0.21 + lv * 0.04;
      float f = rr / (dot(q - c1, q - c1) + 0.018);
      f += (rr - 0.01) / (dot(q - c2, q - c2) + 0.018);
      f += (rr - 0.02) / (dot(q - c3, q - c3) + 0.018);
      f += (rr - 0.03) / (dot(q - c4, q - c4) + 0.018);
      float ang0 = atan(q.y, q.x);
      float lobe = 1.0 + 0.12 * sin(ang0 * 3.0 + t * 0.55) + 0.05 * sin(ang0 * 5.0 - t * 0.8) + 0.02 * sin(t * 0.9);
      f *= lobe * (1.0 + lv * 0.22);
      float body = smoothstep(1.66, 1.94, f);
      float rim = exp(-pow((f - 1.84) / 0.22, 2.0));
      float halo = smoothstep(0.40, 1.66, f) * (1.0 - body);
      float flow = sin((p.x * 3.4 - p.y * 2.8) + t * 0.8 + 1.4 * sin(p.y * 3.0 + t * 0.37));
      float flow2 = sin((p.x * 1.7 + p.y * 4.2) - t * 0.6 + 2.0 * sin(p.x * 2.2 - t * 0.5));
      float band1 = sin((p.x + p.y) * 3.4 - t * 0.9 + 0.7 * sin(p.x * 2.4 - t * 0.4));
      float band2 = sin((p.x * 2.2 - p.y * 1.8) + t * 1.1 + 0.9 * sin(p.y * 3.1 + t * 0.3));
      float n1 = noise(p * 3.6 + vec2(t * 0.28, -t * 0.21));
      float n2 = noise(p * 3.1 + vec2(-t * 0.19, t * 0.26) + 9.0);
      float filament = smoothstep(0.48, 0.78, n1) * smoothstep(0.44, 0.76, n2);
      vec3 col = mix(u_c1, u_c2, smoothstep(-0.65, 0.65, p.x * 0.9 + p.y * 0.45 + 0.2 * sin(t * 0.4)));
      col = mix(col, u_c3, smoothstep(-0.2, 0.9, p.y * 0.9 - p.x * 0.25 + 0.2 * cos(t * 0.35)));
      col = mix(col, mix(u_c3, u_c2, 0.5), smoothstep(0.15, 0.95, flow) * 0.32);
      col = mix(col, mix(u_c1, u_c3, 0.45), smoothstep(0.35, 0.95, flow2) * 0.18);
      col = mix(col, mix(u_c3, u_c1, 0.25), filament * 0.35);
      col = mix(col, col * vec3(0.72, 0.80, 0.96), filament * 0.30);
      float depth = 1.0 - smoothstep(0.0, 0.88, length(p));
      col *= 0.82 + 0.26 * depth;
      float light = smoothstep(-0.75, 0.65, -p.x * 0.45 + p.y * 0.55);
      col *= 0.88 + 0.18 * light;
      col += mix(u_c1, vec3(1.0), 0.40) * pow(max(0.0, band1), 5.0) * 0.16 * body;
      col += u_c3 * pow(max(0.0, band2), 5.0) * 0.14 * body;
      float ripple = pow(max(0.0, sin(length(p) * 16.0 - t * 1.7 + 2.2 * noise(p * 3.0 + vec2(t * 0.18, -t * 0.15)))), 4.0);
      float ripple2 = pow(max(0.0, sin(length(p) * 24.0 + t * 1.3 + 1.6 * noise(p * 4.0 - t * 0.2))), 6.0);
      col += mix(u_c1, vec3(1.0), 0.55) * ripple * 0.12 * body;
      col += u_c3 * ripple2 * 0.08 * body;
      float rimVar = 0.5 + 0.5 * noise(vec2(ang0 * 1.6 + t * 0.1, t * 0.35));
      col += u_c1 * rim * (0.32 + 0.36 * rimVar);
      float core = smoothstep(4.0, 12.0, f);
      col = mix(col, mix(u_c2, vec3(1.0), 0.55), core * 0.20);
      float spec = pow(max(0.0, 1.0 - length(p - vec2(-0.26, 0.32)) * 2.1), 8.0);
      col += vec3(1.0, 0.97, 0.92) * spec * 0.24 * body;
      col += u_c2 * halo * 0.48;
      float alpha = body * (0.86 + 0.14 * smoothstep(0.0, 0.72, length(p))) + halo * 0.38;
      float g = hash(gl_FragCoord.xy + vec2(t * 3.0));
      col += (g - 0.5) * 0.028 * body;
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), clamp(alpha, 0.0, 1.0));
    }
  `;

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      console.warn('orb shader:', gl.getShaderInfoLog(sh));
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }
  function fallback() {
    wrap.classList.add('no-webgl');
    cancelAnimationFrame(raf);
    raf = 0;
    gl = null;
  }
  function init() {
    gl = canvas.getContext('webgl', { alpha: true, antialias: true, premultipliedAlpha: false, powerPreference: 'low-power' });
    if (!gl) { fallback(); return false; }
    const vs = compile(gl.VERTEX_SHADER, vert);
    const fs = compile(gl.FRAGMENT_SHADER, frag);
    if (!vs || !fs) { fallback(); return false; }
    program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { console.warn('orb link:', gl.getProgramInfoLog(program)); fallback(); return false; }
    gl.useProgram(program);
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(program, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    ['u_res', 'u_time', 'u_level', 'u_c1', 'u_c2', 'u_c3'].forEach((k) => { uniforms[k] = gl.getUniformLocation(program, k); });
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); fallback(); });
    new ResizeObserver(resize).observe(wrap);
    resize();
    return true;
  }
  function resize() {
    if (!gl || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    const side = Math.max(2, Math.min(620, Math.round(Math.min(rect.width, rect.height) * Math.min(2, window.devicePixelRatio || 1))));
    if (canvas.width !== side || canvas.height !== side) {
      canvas.width = side;
      canvas.height = side;
      gl.viewport(0, 0, side, side);
    }
    if (uniforms.u_res) gl.uniform2f(uniforms.u_res, side, side);
    if (reduced.matches) draw(performance.now(), true);
  }
  function levelFor(t) {
    if (mode === 'listening') return 0.22 + mic * 0.64;
    if (mode === 'speaking') return 0.42 + 0.17 * Math.sin(t * 6.2) + 0.08 * Math.sin(t * 11.7);
    if (mode === 'thinking') return 0.34 + 0.09 * Math.sin(t * 1.7) + 0.04 * Math.sin(t * 4.1);
    if (mode === 'waiting') return 0.24 + 0.05 * Math.sin(t * 1.2);
    if (mode === 'done') return 0.18 + 0.06 * Math.sin(t * 0.9);
    if (mode === 'error') return 0.05;
    return 0.12 + 0.06 * Math.sin(t * 0.7);
  }
  function draw(now, still) {
    if (!gl) return;
    const t = reduced.matches ? 5.0 : now / 1000;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    const mixStep = Math.min(1, dt * 3.2);
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) cur[i][c] += (target[i][c] - cur[i][c]) * mixStep;
    const want = levelFor(t);
    level += (want - level) * Math.min(1, dt * 5);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (uniforms.u_time) gl.uniform1f(uniforms.u_time, t);
    if (uniforms.u_level) gl.uniform1f(uniforms.u_level, level);
    if (uniforms.u_c1) gl.uniform3f(uniforms.u_c1, cur[0][0], cur[0][1], cur[0][2]);
    if (uniforms.u_c2) gl.uniform3f(uniforms.u_c2, cur[1][0], cur[1][1], cur[1][2]);
    if (uniforms.u_c3) gl.uniform3f(uniforms.u_c3, cur[2][0], cur[2][1], cur[2][2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    wrap.style.setProperty('--orb-level', level.toFixed(3));
    if (!still) raf = requestAnimationFrame(draw);
  }
  function loop(now) {
    if (document.hidden) { raf = requestAnimationFrame(loop); return; }
    if (reduced.matches) { raf = 0; draw(now, true); return; }
    draw(now, false);
  }
  function setMode(next) {
    mode = PALETTE[next] ? next : 'idle';
    target = colors[mode];
    if (reduced.matches && gl) {
      cur = target.map((c) => c.slice());
      level = levelFor(5.0);
      cancelAnimationFrame(raf);
      raf = 0;
      draw(performance.now(), true);
    }
  }
  function setMic(v) { mic = Math.max(0, Math.min(1, Number(v) || 0)); }
  function start() {
    if (!init()) return;
    if (reduced.matches) { draw(performance.now(), true); return; }
    raf = requestAnimationFrame(loop);
  }
  reduced.addEventListener('change', () => {
    cancelAnimationFrame(raf); raf = 0;
    if (reduced.matches) draw(performance.now(), true);
    else if (gl) raf = requestAnimationFrame(loop);
  });
  start();
  return { setMode, setMic };
})();
