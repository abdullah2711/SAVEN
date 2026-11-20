/* ============================================================================
   SA7EN ambient field
   Two independent canvas effects, no dependencies, no network:
     mountAsh(canvas)   WebGL fragment shader — graphite / ash / chalk drift
     mountDust(canvas)  Canvas2D particle field — plum dust with depth parallax
   Both pause off-screen and on hidden tabs, both honour reduced motion by
   drawing a single still frame, both cap their frame rate.
   ========================================================================= */

const REDUCED = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const DPR = () => Math.min(devicePixelRatio || 1, 1.5);

function fit(canvas, scale) {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width * scale));
  const h = Math.max(1, Math.round(rect.height * scale));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  return { w, h, cssW: rect.width, cssH: rect.height };
}

/* --------------------------------------------------------------- ash shader */
const VERT = `
attribute vec2 a;
void main(){ gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 u_res;
uniform float u_time;
uniform float u_intensity;

float hash(vec2 p){
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float v = 0.0, amp = 0.5;
  for (int i = 0; i < 5; i++){
    v += amp * noise(p);
    p = p * 2.03 + vec2(11.3, 7.7);
    amp *= 0.5;
  }
  return v;
}

void main(){
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  float t = u_time * 0.012;

  // Domain warp: two slow fields bending each other, so the surface drifts
  // like ash on water instead of pulsing like a gradient.
  vec2 q = vec2(fbm(p * 1.6 + vec2(0.0, t)), fbm(p * 1.6 + vec2(5.2, -t)));
  vec2 r = vec2(fbm(p * 2.4 + q * 1.7 + vec2(1.7, 9.2) + t * 0.6),
                fbm(p * 2.4 + q * 1.4 + vec2(8.3, 2.8) - t * 0.5));
  float f = fbm(p * 1.9 + r * 1.25);

  // Graphite -> ash -> chalk, with the light pooled to the upper left.
  vec3 deep   = vec3(0.043, 0.031, 0.047);
  vec3 plum   = vec3(0.129, 0.082, 0.106);
  vec3 ash    = vec3(0.235, 0.196, 0.216);
  vec3 chalk  = vec3(0.560, 0.505, 0.474);

  vec3 col = mix(deep, plum, smoothstep(0.15, 0.62, f));
  col = mix(col, ash, smoothstep(0.52, 0.86, f) * 0.85);

  float light = smoothstep(0.58, 0.95, f + (1.0 - uv.y) * 0.10 + (1.0 - uv.x) * 0.06);
  col = mix(col, chalk, light * 0.30);

  // Fine grain and a soft vignette keep it from banding on large screens.
  float grain = hash(uv * u_res * 0.5 + u_time) - 0.5;
  col += grain * 0.030;
  float d = distance(uv, vec2(0.42, 0.40));
  col *= 1.0 - smoothstep(0.35, 1.05, d) * 0.55;

  col *= u_intensity;
  gl_FragColor = vec4(col, 1.0);
}
`;

export function mountAsh(canvas, { intensity = 1, fps = 30 } = {}) {
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    powerPreference: 'low-power', preserveDrawingBuffer: false,
  });
  const fallback = () => {
    canvas.style.display = 'none';
    canvas.closest('.ambient')?.setAttribute('data-fallback', 'true');
  };
  if (!gl) { fallback(); return () => {}; }

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { gl.deleteShader(s); return null; }
    return s;
  };
  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { fallback(); return () => {}; }

  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { fallback(); return () => {}; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const uRes = gl.getUniformLocation(prog, 'u_res');
  const uTime = gl.getUniformLocation(prog, 'u_time');
  const uInt = gl.getUniformLocation(prog, 'u_intensity');
  gl.uniform1f(uInt, intensity);

  let raf = 0, start = performance.now(), last = 0, visible = true, dead = false;
  const still = REDUCED();

  const draw = (ms) => {
    const t = (ms - start) / 1000;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const loop = (ms) => {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (ms - last < 1000 / fps) return;
    last = ms;
    const { w, h } = fit(canvas, Math.min(DPR() * 0.6, 0.9));
    if (gl.drawingBufferWidth !== w || gl.drawingBufferHeight !== h) { /* no-op: sized below */ }
    draw(ms);
  };

  const resize = () => {
    const { w, h } = fit(canvas, Math.min(DPR() * 0.6, 0.9));
    canvas.width = w; canvas.height = h;
    draw(performance.now());
  };

  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && still) draw(performance.now());
  }, { threshold: 0.01 });
  io.observe(canvas);

  const onVis = () => { if (!document.hidden && still) draw(performance.now()); };
  document.addEventListener('visibilitychange', onVis);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  resize();
  if (still) draw(performance.now());
  else { start = performance.now(); raf = requestAnimationFrame(loop); }

  return () => {
    dead = true; cancelAnimationFrame(raf);
    ro.disconnect(); io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  };
}

/* --------------------------------------------------------------- plum dust */
export function mountDust(canvas, { density = 0.00022, max = 170, fps = 30 } = {}) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  // Seeded so the composition is identical on every load.
  let seed = 0x5a7e71;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const TONES = ['201,158,176', '154,98,119', '122,74,94', '233,209,216'];
  const SPRITE = 48;
  const sprite = document.createElement('canvas');
  sprite.width = sprite.height = SPRITE;
  {
    const sc = sprite.getContext('2d');
    const g = sc.createRadialGradient(SPRITE / 2, SPRITE / 2, 0, SPRITE / 2, SPRITE / 2, SPRITE / 2);
    g.addColorStop(0, 'rgba(255,247,250,0.95)');
    g.addColorStop(0.35, 'rgba(233,209,216,0.55)');
    g.addColorStop(1, 'rgba(201,158,176,0)');
    sc.fillStyle = g;
    sc.fillRect(0, 0, SPRITE, SPRITE);
  }

  let particles = [];
  let w = 1, h = 1, dpr = 1;
  let px = 0, py = 0, tx = 0, ty = 0;
  let raf = 0, last = 0, dead = false, visible = true;
  const still = REDUCED();

  function build() {
    const count = Math.round(Math.min(max, Math.max(36, w * h * density)));
    particles = Array.from({ length: count }, () => {
      const depth = rnd();
      return {
        x: rnd(), y: rnd(),
        r: 0.5 + rnd() * (depth > 0.72 ? 2.1 : 1.1),
        depth,
        vy: 0.0000025 + depth * 0.000010,
        sway: 0.0015 + rnd() * 0.004,
        phase: rnd() * Math.PI * 2,
        freq: 0.12 + rnd() * 0.28,
        tone: TONES[Math.floor(rnd() * TONES.length)],
        alpha: 0.16 + depth * 0.34,
        twinkle: 0.4 + rnd() * 1.6,
      };
    });
  }

  function resize() {
    dpr = DPR();
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, rect.width);
    h = Math.max(1, rect.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    build();
    render(performance.now(), 0);
  }

  function render(ms, dt) {
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    const t = ms / 1000;
    px += (tx - px) * 0.045;
    py += (ty - py) * 0.045;

    for (const p of particles) {
      if (!still) {
        p.y -= p.vy * dt;
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
      }
      const drift = Math.sin(t * p.freq + p.phase) * p.sway * 40;
      const x = p.x * w + drift + px * (8 + p.depth * 18);
      const y = p.y * h + py * (6 + p.depth * 14);
      const glow = 1 + Math.sin(t * p.twinkle + p.phase) * 0.18;
      const size = p.r * 8.5 * glow * (0.75 + p.depth * 0.6);

      ctx.globalAlpha = Math.min(0.7, p.alpha * glow);
      ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);

      if (p.depth > 0.82) {
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = 'rgba(' + p.tone + ',1)';
        ctx.beginPath();
        ctx.arc(x, y, p.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  function loop(ms) {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    if (!visible || document.hidden) return;
    if (ms - last < 1000 / fps) return;
    const dt = last ? Math.min(64, ms - last) : 16;
    last = ms;
    render(ms, dt);
  }

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    tx = ((e.clientX - r.left) / Math.max(1, r.width) - 0.5) * 2;
    ty = ((e.clientY - r.top) / Math.max(1, r.height) - 0.5) * 2;
  };
  const onLeave = () => { tx = 0; ty = 0; };

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.01 });
  io.observe(canvas);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerleave', onLeave);

  resize();
  // Paint one frame synchronously so the first impression is never an empty
  // canvas, even if the first animation frame is delayed.
  render(performance.now(), 0);
  if (!still) raf = requestAnimationFrame(loop);

  return () => {
    dead = true; cancelAnimationFrame(raf);
    io.disconnect(); ro.disconnect();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerleave', onLeave);
  };
}

export function mountAmbient(root) {
  const shader = root.querySelector('[data-shader]');
  const dust = root.querySelector('[data-dust]');
  const kill = [];
  if (shader) kill.push(mountAsh(shader, { intensity: 0.96 }));
  if (dust) kill.push(mountDust(dust));
  return () => kill.forEach((fn) => fn());
}
