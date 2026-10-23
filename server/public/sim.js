'use strict';

/* ============================================================
   Helpers
   ============================================================ */
const $ = (id) => document.getElementById(id);
const h = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const icon = (name, cls) => '<svg class="ic' + (cls ? ' ' + cls : '') + '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
const unique = (arr) => [...new Set(arr || [])];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[._-]+/g, ' ');

const state = {
  devices: [], tasks: [], stageTask: null, activeTaskId: null,
  busy: false, listening: false, coreOk: null, agentOk: null, payload: null,
  handledApprovals: new Set(), handledQuestions: new Set(),
  answering: false, initialLoaded: false,
  stepNodes: new Map(), stepsTaskId: null, phoneSig: '', logSig: '', planSig: '', artifactSig: '',
  gateTotal: 1, opener: null, drawerOpen: false,
};

const voice = {
  supported: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  rec: null, recognizing: false, want: false, handsFree: false,
  listening: false, capturing: false, muted: false, speaking: false,
  level: 0, meterStream: null, meterCtx: null, meterAnalyser: null, meterData: null,
  meterRaf: 0, meterToken: 0, captureTimer: 0, restartTimer: 0,
  submitTimer: 0, draft: '', wakeOnly: false,
  speechToken: 0, speechTimer: 0, submitting: false, demo: 0, notice: '', noticeTimer: 0, heard: new Set(),
};
try { voice.muted = localStorage.getItem('reach-voice-muted') === '1'; } catch { /* storage may be blocked */ }

const SCENARIOS = [
  { id: 'capture', icon: 'phone', label: 'Capture my iPhone screen', kind: 'screen',
    goal: 'Capture a screenshot of my connected iPhone and describe the UI layout you see' },
  { id: 'clipboard', icon: 'clipboard', label: 'Save my clipboard as a note', kind: 'clipboard',
    goal: 'Read the text on my MacBook clipboard and save it into a new text note in my Documents/REACH folder' },
  { id: 'gate', icon: 'shield', label: 'Write a diagnostics note', kind: 'file', asks: true,
    goal: "Create a diagnostics note in Documents/REACH listing today's date and how many files are in my Documents folder" },
  { id: 'transcribe', icon: 'wave', label: 'Transcribe the sync recording', kind: 'audio',
    goal: 'Transcribe the product sync recording on my MacBook and save it as meeting minutes' },
  { id: 'github', icon: 'globe', label: 'Summarize my GitHub profile', kind: 'web',
    goal: 'Search the web for my GitHub profile and summarize what I last shipped' },
];

const PAYLOAD_STATUS = {
  queued: 'QUEUED', running: 'ROUTING', awaiting_approval: 'AWAITING_APPROVAL', awaiting_input: 'AWAITING_INPUT',
  completed: 'COMPLETED', failed: 'FAILED', cancelled: 'CANCELLED', denied: 'DENIED',
};

const ACTION_TITLES = {
  screenshot: 'Capture iPhone screen', ios_screenshot: 'Capture iPhone screen',
  create_document: 'Create document', open_document: 'Open document',
  read_file: 'Read file', write_file: 'Write file', search_files: 'Search files', list_files: 'List files',
  move_file: 'Move file', delete_file: 'Delete file', verify_file: 'Verify file', download_asset: 'Download file',
  get_clipboard: 'Read clipboard', set_clipboard: 'Write clipboard', clipboard_read: 'Read clipboard', clipboard_write: 'Write clipboard',
  ios_paste: 'Read iPhone clipboard', ios_copy: 'Write iPhone clipboard',
  open_url: 'Open page', launch_application: 'Launch app',
  read_audio: 'Read recording', capture_audio: 'Record audio', transcribe: 'Transcribe audio', audio_transcribe: 'Transcribe audio',
  ios_list: 'Read device info', ios_info: 'Read device info', ios_list_files: 'Browse iPhone files',
  ios_pull_file: 'Pull file from iPhone', ios_push_file: 'Send file to iPhone', ios_apps: 'List iPhone apps',
  ios_launch: 'Launch iPhone app', ios_button: 'Press iPhone button',
  inspect_windows: 'Inspect windows', type_text: 'Type text', send_hotkey: 'Send hotkey', focus_window: 'Focus window',
};
const CAP_LABELS = {
  ios_screenshot: 'Screenshot', ios_pull_file: 'Pull file', ios_push_file: 'Push file', ios_paste: 'Clipboard', ios_copy: 'Clipboard',
  ios_list: 'Device info', ios_info: 'Device info', ios_list_files: 'Files', ios_apps: 'Apps', ios_launch: 'Launch', ios_button: 'Buttons',
};

/* ============================================================
   Text + path utilities
   ============================================================ */
function plain(text) {
  return String(text == null ? '' : text)
    .replace(/```\w*\n?/g, '').replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1').replace(/^#{1,6}\s+/gm, '').replace(/\s+/g, ' ').trim();
}
function short(text, max) {
  const s = plain(text);
  return s.length > max ? s.slice(0, Math.max(0, max - 1)).trimEnd() + '…' : s;
}
function firstSentence(text, max) {
  const s = plain(text);
  const m = s.match(/^.*?[.!?](?=\s|$)/);
  return short(m ? m[0] : s, max);
}
function clipRaw(text, max) {
  let s = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const sp = s.lastIndexOf(' ');
  if (sp > max * 0.7) s = s.slice(0, sp);
  s = s.replace(/[\s,;:.-]+$/, '') + '…';
  if ((s.match(/`/g) || []).length % 2) s = s.replace(/`([^`]*)$/, '$1');
  if ((s.match(/\*\*/g) || []).length % 2) s = s.replace(/\*\*([^*]*)$/, '$1');
  return s;
}
function richText(el, text) {
  el.replaceChildren();
  String(text == null ? '' : text).replace(/\s+/g, ' ').trim().split(/(`[^`]+`|\*\*[^*]+\*\*)/g).forEach((part) => {
    if (!part) return;
    if (part.length > 2 && part[0] === '`' && part[part.length - 1] === '`') el.append(h('code', null, part.slice(1, -1)));
    else if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) el.append(document.createTextNode(part.slice(2, -2)));
    else el.append(document.createTextNode(part.replace(/\*\*/g, '')));
  });
}
function retrigger(el, cls) {
  cls = cls || 'swap';
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}
function setRich(el, text) {
  const key = String(text);
  if (el.dataset.key === key) return;
  el.dataset.key = key;
  richText(el, text);
  retrigger(el);
}
function humanize(s) {
  const t = String(s == null ? '' : s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_.-]+/g, ' ').trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}
function cleanUri(uri) { return String(uri == null ? '' : uri).replace(/^(file|computer):\/\//i, ''); }
function fileName(path) { const p = cleanUri(path); return p.split(/[\\/]/).filter(Boolean).pop() || p; }
function tildePath(path) {
  return cleanUri(path).replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~').replace(/^[A-Za-z]:\\Users\\[^\\]+/, '~');
}
function dirOf(path) {
  const p = tildePath(path).replace(/[\\/]+$/, '');
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return i > 0 ? p.slice(0, i) : '';
}
function clockParts() {
  const d = new Date();
  return {
    time: d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s?[AP]M/i, ''),
    date: d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }),
  };
}
function relativeTime(iso) {
  if (!iso) return 'no sync yet';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
function formatDuration(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  return ms < 1000 ? Math.round(ms) + 'ms' : (ms / 1000).toFixed(1) + 's';
}
function announce(text) {
  const live = $('sr-live');
  live.textContent = '';
  requestAnimationFrame(() => { live.textContent = plain(text); });
}
async function copyText(text, btn, doneLabel, resetLabel) {
  try {
    await navigator.clipboard.writeText(text);
    if (btn) { btn.textContent = doneLabel || 'Copied'; setTimeout(() => { btn.textContent = resetLabel; }, 1500); }
  } catch {
    if (btn) { btn.textContent = 'Copy failed'; setTimeout(() => { btn.textContent = resetLabel; }, 1600); }
  }
}
function actionTitle(name) {
  const raw = String(name == null ? '' : name).trim();
  if (!raw) return 'Working';
  const seg = raw.split('.').pop().toLowerCase();
  if (ACTION_TITLES[seg]) return ACTION_TITLES[seg];
  const full = raw.toLowerCase().replace(/\./g, '_');
  if (ACTION_TITLES[full]) return ACTION_TITLES[full];
  const ns = raw.includes('.') ? raw.split('.')[0].toLowerCase() : '';
  if (ns === 'web' && seg === 'search') return 'Search the web';
  if (ns === 'browser') return 'Browser: ' + humanize(seg).toLowerCase();
  return humanize(seg) || 'Working';
}
function describeArgs(args, max) {
  if (!args || typeof args !== 'object') return [];
  const skip = /^(content|body|markdown|text|data|html|bytes)$/i;
  return Object.entries(args)
    .filter(([k, v]) => !skip.test(k) && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') && String(v).trim() !== '')
    .slice(0, max || 3)
    .map(([k, v]) => [humanize(k), short(String(v), 72)]);
}
function artifactInfo(uri) {
  const clean = cleanUri(uri);
  const isDir = /[\\/]$/.test(clean);
  const name = fileName(clean) || clean;
  const lower = name.toLowerCase();
  let ic = 'file';
  if (isDir) ic = 'folder';
  else if (/\.(png|jpe?g|webp|gif|heic)$/.test(lower)) ic = 'image';
  else if (/\.(wav|mp3|m4a|flac)$/.test(lower)) ic = 'wave';
  return { name, where: isDir ? tildePath(clean).replace(/[\\/]+$/, '') : (dirOf(clean) || tildePath(clean)), icon: ic, isDir, full: clean };
}
function isRemoteImage(uri) { return !!uri && /^https?:/i.test(uri) && /\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(uri); }

/* ============================================================
   Aurora core: one WebGL blob, with a CSS fallback.
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

/* ============================================================
   Task semantics
   ============================================================ */
function goalOf(task) { return String(task.goal || task.task || task.input || task.intent || task.prompt || '').trim(); }
function actionsOf(task) { return (task.trace || []).filter((a) => !String(a.name || '').startsWith('reach.')); }
function isTerminal(status) { return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'denied'; }
function elapsedForTask(task) {
  const start = Date.parse(task.createdAt || '');
  const end = Date.parse(task.updatedAt || '');
  return Number.isFinite(start) && Number.isFinite(end) && end >= start ? end - start : null;
}
function kindFromGoal(goal) {
  const g = String(goal || '').toLowerCase();
  if (/screenshot|iphone|ui layout|screen of/.test(g)) return 'screen';
  if (/clipboard|paste|copied/.test(g)) return 'clipboard';
  if (/transcribe|recording|minutes|meeting/.test(g)) return 'audio';
  if (/github|web|browser|profile/.test(g)) return 'web';
  if (/diagnostic|document|note|create|write|delete|move/.test(g)) return 'file';
  return 'generic';
}
function kindOf(task, actions) {
  const names = norm(actions.map((a) => a.name).concat(task.pendingApproval ? [task.pendingApproval.actionName] : []).join(' '));
  if (/screenshot|screen capture/.test(names)) return 'screen';
  if (/clipboard|ios copy|ios paste/.test(names)) return 'clipboard';
  if (/transcribe|read audio|capture audio/.test(names)) return 'audio';
  if (/browser|open url|web search|navigate/.test(names)) return 'web';
  if (/create document|write file|delete file|move file|document/.test(names)) return 'file';
  if (names.trim()) return 'generic';
  return kindFromGoal(goalOf(task));
}
function phoneInvolved(task, actions, kind) {
  const names = norm(actions.map((a) => a.name).concat(task.pendingApproval ? [task.pendingApproval.actionName] : []).join(' '));
  if (/ios|iphone/.test(names)) return true;
  return !names.trim() && kind === 'screen';
}
function outcomeTone(task) {
  if (task.status !== 'completed') return null;
  const k = String((task.outcome && task.outcome.kind) || 'complete').toLowerCase();
  if (k === 'partial' || k === 'unverified') return 'warn';
  if (k === 'cannot' || k === 'failed') return 'bad';
  return 'ok';
}
function statusMeta(task) {
  const tone = outcomeTone(task);
  switch (task.status) {
    case 'awaiting_approval': return { label: 'Needs approval', cls: 'warn' };
    case 'awaiting_input': return { label: 'Needs input', cls: 'warn' };
    case 'queued': return { label: 'Queued', cls: '' };
    case 'running': return { label: 'Running', cls: 'run' };
    case 'completed': {
      const k = String((task.outcome && task.outcome.kind) || '').toLowerCase();
      if (tone === 'warn') return { label: k === 'unverified' ? 'Unverified' : 'Partial', cls: 'warn' };
      if (tone === 'bad') return { label: 'Blocked', cls: 'bad' };
      return { label: 'Verified', cls: 'ok' };
    }
    case 'denied': case 'failed': return { label: 'Blocked', cls: 'bad' };
    case 'cancelled': return { label: 'Stopped', cls: '' };
    default: return { label: 'Unknown', cls: '' };
  }
}
function errorText(task) {
  const oc = task.outcome || {};
  return task.error || oc.reason || oc.summary || 'The mesh stopped before the handoff completed.';
}
function clipboardText(task) {
  const actions = [...(task.trace || [])].reverse();
  const clip = actions.find((a) => /clipboard|ios_copy|ios_paste/i.test(String(a.name || '')) && a.args && typeof a.args.text === 'string');
  if (clip) return String(clip.args.text);
  return '';
}
function riskInfo(cls, name) {
  const t = norm(String(cls || '') + ' ' + String(name || ''));
  if (/delete|remove/.test(t)) return { label: 'Deletes files', tone: 'bad' };
  if (/upload|s3|network/.test(t)) return { label: 'Sends data off this device', tone: 'warn' };
  if (/clipboard/.test(t)) return { label: 'Reads your clipboard', tone: 'warn' };
  if (/screenshot|screen/.test(t)) return { label: 'Captures your screen', tone: 'warn' };
  if (/write|create|move|document|save/.test(t)) return { label: 'Writes to your files', tone: 'warn' };
  return { label: humanize(cls) || 'Needs your approval', tone: 'warn' };
}

function deriveView(task) {
  const pending = task.pendingApproval || null;
  const pin = task.pendingInput || null;
  const actions = actionsOf(task);
  const failed = task.status === 'failed' || task.status === 'denied' || task.status === 'cancelled';
  const tone = outcomeTone(task);
  const uri = task.evidence && task.evidence.artifactUri;
  let mode, look;
  if (pending) { mode = 'gate'; look = 'gate'; }
  else if (pin) { mode = 'input'; look = 'input'; }
  else if (task.status === 'completed') { if (tone === 'bad') { mode = 'error'; look = 'bad'; } else { mode = 'done'; look = tone; } }
  else if (failed) { mode = 'error'; look = 'bad'; }
  else { mode = 'busy'; look = 'busy'; }
  const kind = kindOf(task, actions);
  const v = {
    pending, pin, actions, failed, tone, uri, mode, look, kind,
    act: actions.length ? actions[actions.length - 1] : null,
    phone: phoneInvolved(task, actions, kind),
  };
  v.stages = stagesFor(task, v);
  return v;
}
function stagesFor(task, v) {
  const has = v.actions.length > 0;
  let st;
  if (v.pending) st = ['done', 'done', 'alert', 'todo'];
  else if (task.status === 'completed') st = ['done', 'done', 'done', v.tone === 'warn' ? 'alert' : v.tone === 'bad' ? 'bad' : 'done'];
  else if (v.pin) st = ['alert', 'todo', 'todo', 'todo'];
  else if (has) st = ['done', 'done', 'done', 'active'];
  else st = ['done', 'active', 'todo', 'todo'];
  if (v.failed) {
    let idx = st.findIndex((s) => s === 'active' || s === 'alert');
    if (task.status === 'denied') idx = 2;
    else if (idx < 0) idx = has ? 3 : 1;
    st = st.map((s, i) => (i < idx ? 'done' : i === idx ? 'bad' : 'todo'));
  }
  return st;
}
function planLabel(p) {
  if (p == null) return '';
  if (typeof p === 'string') return p;
  return String(p.title || p.description || p.summary || p.step || p.text || p.intent || p.action || p.tool || p.name || '');
}

/* ============================================================
   Devices
   ============================================================ */
function meshParts() {
  const devices = state.devices;
  const mac = devices.find((d) => (d.capabilities || []).some((c) => !String(c).startsWith('ios_'))) || devices[0] || null;
  const allCaps = unique(devices.flatMap((d) => d.capabilities || []));
  const phoneCaps = unique(devices.flatMap((d) => (d.capabilities || []).filter((c) => String(c).startsWith('ios_'))));
  const macCaps = mac ? unique((mac.capabilities || []).filter((c) => !String(c).startsWith('ios_'))) : [];
  return { mac, allCaps, phoneCaps, macCaps, nodes: (mac ? 1 : 0) + (phoneCaps.length ? 1 : 0) };
}
function macLabel() { const m = meshParts().mac; return m ? (m.name || m.id) : 'Laptop'; }
function deviceName(id) {
  if (!id) return null;
  const d = state.devices.find((x) => x.id === id);
  if (d) return d.name || d.id;
  return String(id).replace(/^(dev_|device_)/, '').replace(/[_-]+/g, ' ');
}
function deviceStatus(d) {
  if (!d) return { line: 'Waiting for the laptop agent', dot: 'off', led: 'Standby', tag: '' };
  if (d.paused) return { line: 'Paused · heartbeat live', dot: 'warn', led: 'Paused', tag: 'warn' };
  if (d.available) return { line: 'Online · synced ' + relativeTime(d.lastHeartbeatAt), dot: 'ok', led: 'Live', tag: 'ok' };
  return { line: 'Offline · last sync ' + relativeTime(d.lastHeartbeatAt), dot: 'bad', led: 'Offline', tag: 'bad' };
}
function renderMacActions(mac) {
  const box = $('macActions');
  const sig = mac ? mac.id + ':' + !!mac.paused : 'none';
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren();
  if (!mac) return;
  const mk = (label, run, cls) => {
    const b = h('button', 'link-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.onclick = run;
    box.append(b);
    return b;
  };
  mk(mac.paused ? 'Resume' : 'Pause', () => { void deviceAction(mac.id, mac.paused ? 'resume' : 'pause'); });
  mk('Inspect', () => {
    const cur = state.devices.find((d) => d.id === mac.id) || mac;
    inspectNode({ source: 'device_registry', node: {
      id: cur.id, name: cur.name, paused: !!cur.paused, available: !!cur.available,
      last_sync: relativeTime(cur.lastHeartbeatAt), capabilities: cur.capabilities || [],
    } });
  });
  const rev = mk('Revoke', () => {
    if (rev.dataset.armed) { clearTimeout(rev._t); void deviceAction(mac.id, 'revoke'); return; }
    rev.dataset.armed = '1';
    rev.textContent = 'Confirm revoke';
    rev.classList.add('armed');
    rev._t = setTimeout(() => { delete rev.dataset.armed; rev.textContent = 'Revoke'; rev.classList.remove('armed'); }, 3200);
  }, 'danger');
}
function renderPhoneTools(caps) {
  const box = $('phoneTools');
  const labels = unique(caps.map((c) => CAP_LABELS[c] || humanize(String(c).replace(/^ios_/, ''))));
  const sig = labels.join('|');
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.replaceChildren();
  labels.slice(0, 4).forEach((l) => box.append(h('span', 'mini-chip', l)));
  if (labels.length > 4) box.append(h('span', 'mini-chip more', '+' + (labels.length - 4)));
}
function renderDevices() {
  const parts = meshParts();
  const st = deviceStatus(parts.mac);
  $('macName').textContent = parts.mac ? (parts.mac.name || parts.mac.id) : 'Laptop';
  $('macDot').className = 'dot ' + st.dot;
  $('macSub').textContent = parts.mac ? st.line + ' · ' + parts.macCaps.length + ' tools' : st.line;
  const led = $('macLed');
  led.textContent = st.led;
  led.className = 'tag ' + st.tag;
  renderMacActions(parts.mac);
  const hasPhone = parts.phoneCaps.length > 0;
  $('phoneDot').className = 'dot ' + (hasPhone ? 'ok' : 'off');
  $('phoneSub').textContent = hasPhone ? 'Paired · ' + parts.phoneCaps.length + ' tools' : 'Not connected';
  $('phoneHint').hidden = hasPhone;
  renderPhoneTools(parts.phoneCaps);
  if (!state.stageTask) { idleLog(); renderPhone(null, null); }
  updateMeshPill();
}
async function refreshDevices() {
  try {
    const res = await fetch('/devices');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const list = await res.json();
    state.devices = Array.isArray(list) ? list : [];
    renderDevices();
  } catch {
    if (!state.devices.length) renderDevices();
  }
}
async function deviceAction(id, verb) {
  try {
    const res = await fetch('/devices/' + encodeURIComponent(id) + '/' + verb, { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    announce('Device ' + verb + ' request accepted.');
  } catch {
    announce('The core did not accept the device change.');
  }
  await refreshDevices();
}
function inspectNode(payload) {
  setPayload(payload);
  openDrawer('trace');
  announce('Device payload shown in Trace.');
}
function updateMeshPill() {
  const dot = $('meshDot'), text = $('meshText');
  const parts = meshParts();
  let cls = 'ok', msg;
  if (state.coreOk === null) { cls = 'warn'; msg = 'Connecting…'; }
  else if (state.coreOk === false) { cls = 'bad'; msg = 'Core offline'; }
  else if (!parts.mac) { cls = 'warn'; msg = 'No devices yet'; }
  else if (parts.mac.paused) { cls = 'warn'; msg = 'Paused · ' + parts.allCaps.length + ' tools'; }
  else if (!parts.mac.available) { cls = 'bad'; msg = 'Laptop offline'; }
  else msg = 'Live · ' + parts.nodes + (parts.nodes === 1 ? ' device' : ' devices') + ' · ' + parts.allCaps.length + ' tools';
  dot.className = 'dot ' + cls;
  text.textContent = msg;
}

/* ============================================================
   Mac log + clipboard
   ============================================================ */
function setLog(lines) {
  const sig = JSON.stringify(lines);
  if (sig === state.logSig) return;
  state.logSig = sig;
  const box = $('macLog');
  box.replaceChildren();
  (lines || []).slice(0, 3).forEach((line) => {
    const li = h('li');
    li.dataset.tone = line.tone || '';
    li.append(h('i'), h('span', null, short(line.text, 64)));
    box.append(li);
  });
}
function idleLog() {
  const parts = meshParts();
  if (!parts.mac) setLog([{ text: 'Waiting for the laptop agent', tone: 'warn' }, { text: 'Start it with npm run dev:agent', tone: '' }]);
  else setLog([
    { text: parts.macCaps.length + ' tools mounted', tone: 'ok' },
    { text: 'Mesh handshake healthy', tone: '' },
    { text: 'Waiting for a command', tone: '' },
  ]);
  setClipboard('', false);
}
function logFor(task, v) {
  const lines = [];
  (task.events || []).slice(-3).forEach((e) => {
    lines.push({
      text: plain(e.summary),
      tone: e.status === 'failed' ? 'err' : e.status === 'awaiting_approval' || e.status === 'awaiting_input' ? 'warn' : 'ok',
    });
  });
  if (!lines.length && v.act) lines.push({ text: actionTitle(v.act.name) + (v.act.ok === false ? ' failed' : ' dispatched'), tone: v.act.ok === false ? 'err' : 'ok' });
  if (v.pending) lines.push({ text: 'Held for approval: ' + actionTitle(v.pending.actionName), tone: 'warn' });
  return lines.slice(-3);
}
function setClipboard(text, hasContent) {
  $('macClipboard').textContent = text || 'Sealed until a task reads it.';
  $('macClipboardCard').classList.toggle('has-content', !!hasContent);
}
function renderClipboard(task, v) {
  const clip = clipboardText(task);
  if (clip) setClipboard(short(clip, 140), true);
  else if (v.kind === 'clipboard' && v.mode === 'gate') setClipboard('Waiting for your approval to read it.', true);
  else if (v.kind === 'clipboard' && v.mode === 'busy') setClipboard('Reading the clipboard…', true);
  else setClipboard('', false);
}

/* ============================================================
   iPhone preview
   ============================================================ */
function phoneLock(cap) {
  const c = clockParts();
  const w = h('div', 'ph');
  w.append(h('div', 'ph-time', c.time), h('div', 'ph-date', c.date), h('div', 'ph-cap', cap));
  return w;
}
function phoneBadge(name, tone, msg) {
  const w = h('div', 'ph');
  const ic = h('div', 'ph-ic ' + (tone || ''));
  ic.innerHTML = icon(name);
  w.append(ic);
  if (msg) w.append(h('div', 'ph-msg', msg));
  return w;
}
function renderPhone(task, v) {
  const parts = meshParts();
  const connected = parts.phoneCaps.length > 0;
  let view;
  if (!task || !v) view = { t: 'lock', cap: connected ? 'Ready' : 'Not connected' };
  else if (!v.phone) view = { t: 'lock', cap: connected ? 'Standing by' : 'Not connected' };
  else if (v.mode === 'gate') view = { t: 'wait' };
  else if (v.mode === 'input') view = { t: 'wait', msg: 'Waiting for your answer' };
  else if (v.mode === 'error') view = { t: 'fail', msg: short(errorText(task), 90) };
  else if (v.mode === 'done') {
    const clip = clipboardText(task);
    if (isRemoteImage(v.uri)) view = { t: 'shot', url: v.uri };
    else if (clip) view = { t: 'note', text: short(clip, 110) };
    else view = { t: 'done', msg: v.uri ? fileName(v.uri) : 'Done' };
  } else view = { t: 'work', cap: v.kind === 'screen' ? 'Capturing…' : 'Working…' };

  const sig = JSON.stringify(view);
  const content = $('iphoneContent');
  if (sig === state.phoneSig) {
    if (view.t === 'lock') { const t = content.querySelector('.ph-time'); if (t) t.textContent = clockParts().time; }
    return;
  }
  state.phoneSig = sig;
  content.replaceChildren();
  if (view.t === 'lock') content.append(phoneLock(view.cap));
  else if (view.t === 'wait') content.append(phoneBadge('lock', 'warn', view.msg || 'Waiting for approval'));
  else if (view.t === 'fail') content.append(phoneBadge('x', 'bad', view.msg));
  else if (view.t === 'done') content.append(phoneBadge('check', 'ok', view.msg));
  else if (view.t === 'shot') {
    const img = h('img', 'ph-shot');
    img.src = view.url; img.alt = 'iPhone capture'; img.loading = 'lazy';
    img.onclick = () => openLightbox(view.url);
    content.append(img);
  } else if (view.t === 'note') {
    const w = h('div', 'ph');
    const note = h('div', 'ph-note');
    note.append(h('b', null, 'Copied text'), h('div', 'ph-msg', view.text));
    w.append(note);
    content.append(w);
  } else {
    const w = h('div', 'ph');
    const sk = h('div', 'ph-skel');
    sk.append(h('i'), h('i'), h('i'));
    w.append(sk, h('div', 'ph-cap', view.cap));
    content.append(w);
  }
}

/* ============================================================
   Stage: narrative, track, steps, plan, artifact
   ============================================================ */
function setDeck(mode) { $('deck').dataset.state = mode || 'idle'; syncVoiceMode(); }
function setUtter(goal) {
  const box = $('utter');
  const g = plain(goal);
  box.hidden = !g;
  if (g && $('utterText').dataset.key !== g) {
    $('utterText').dataset.key = g;
    $('utterText').textContent = g;
    $('utterText').title = g;
    retrigger(box, 'is-new');
  }
}
function setNarrative(n) {
  $('narrative').dataset.look = n.look || 'idle';
  $('narrativeKicker').textContent = n.kicker || 'Ready';
  $('narrativeMeta').textContent = n.meta ? '· ' + n.meta : '';
  const titleEl = $('narrativeTitle');
  const len = plain(n.title).length;
  titleEl.dataset.size = len <= 56 ? 'l' : len <= 110 ? 'm' : len <= 220 ? 's' : 'xs';
  setRich(titleEl, clipRaw(n.title, 460));
  const d = $('narrativeDetail');
  d.hidden = !n.detail;
  if (n.detail) setRich(d, clipRaw(n.detail, 220));
}
function narrativeFor(task, v, opts) {
  const oc = task.outcome || {};
  const dur = formatDuration(opts.elapsed);
  const replay = opts.historical ? 'Replay' : '';
  if (v.mode === 'done' || (v.mode === 'error' && task.status === 'completed')) {
    const k = String(oc.kind || 'complete').toLowerCase();
    const kicker = v.tone === 'ok' ? 'Done' : k === 'unverified' ? 'Done, not verified' : k === 'partial' ? 'Partly done' : "Couldn't do that";
    const label = v.tone === 'ok' ? 'Verified' : '';
    const meta = [replay, label, dur].filter(Boolean).join(' · ');
    const who = v.act && /ios|iphone/i.test(v.act.name || '') ? 'iPhone' : (deviceName(task.evidence && task.evidence.deviceId) || macLabel());
    const ev = (oc.evidenceActionIds || []).length;
    const detail = [v.act ? actionTitle(v.act.name) : null, who, ev ? ev + (ev === 1 ? ' evidence check' : ' evidence checks') : null].filter(Boolean).join(' · ');
    return { look: v.look, kicker, meta, title: oc.summary || (task.evidence && task.evidence.note) || oc.reason || 'Done. Every handoff is verified.', detail };
  }
  if (v.mode === 'error') {
    const stopped = task.status === 'cancelled' || task.status === 'denied';
    return {
      look: 'bad', kicker: task.status === 'cancelled' ? 'Stopped' : task.status === 'denied' ? 'Denied' : 'Stopped',
      meta: replay,
      title: stopped ? 'Stopped. Nothing was changed.' : 'I couldn’t finish that.',
      detail: stopped ? 'Open Trace for the full audit trail.' : errorText(task) + ' Nothing else ran.',
    };
  }
  if (v.mode === 'gate') {
    return { look: 'gate', kicker: 'Waiting for you', meta: '', title: 'I need your approval to ' + lowerFirst(actionTitle(v.pending.actionName)) + '.', detail: v.pending.consequence || '' };
  }
  if (v.mode === 'input') {
    return { look: 'input', kicker: 'One question', meta: '', title: v.pin.question || 'REACH needs one detail to continue.', detail: 'Paused so it can finish with the right details.' };
  }
  const latest = (task.events || []).slice(-1)[0];
  return {
    look: 'busy', kicker: 'Working', meta: replay,
    title: v.actions.length ? 'Working across your devices.' : 'Planning the safest route.',
    detail: latest ? plain(latest.summary) : 'Choosing the right tools for this goal.',
  };
}
function renderTrack(states) {
  const items = $('pipelineRail').children;
  states.forEach((s, i) => {
    if (!items[i]) return;
    items[i].dataset.state = s;
    if (s === 'active') items[i].setAttribute('aria-current', 'step'); else items[i].removeAttribute('aria-current');
  });
}
function stepIcon(s) {
  if (s === 'run') return '<span class="spin"></span>';
  if (s === 'done') return icon('check');
  if (s === 'wait') return icon('lock');
  if (s === 'fail') return icon('x');
  return '';
}
function buildStepNode() {
  const el = h('li', 'step');
  const ic = h('span', 's-ic');
  const mid = h('div');
  const title = h('div', 's-title');
  const sub = h('div', 's-sub');
  mid.append(title, sub);
  const meta = h('div', 's-meta');
  el.append(ic, mid, meta);
  return { el, ic, title, sub, meta, state: '' };
}
function updateStepNode(node, row) {
  if (node.state !== row.state) {
    node.state = row.state;
    node.el.dataset.state = row.state;
    node.ic.innerHTML = stepIcon(row.state);
  }
  if (node.title.textContent !== row.title) node.title.textContent = row.title;
  const sub = row.sub || '';
  if (node.sub.textContent !== sub) node.sub.textContent = sub;
  const meta = row.meta || '';
  if (node.meta.textContent !== meta) node.meta.textContent = meta;
}
function renderSteps(rows) {
  const list = $('steps');
  list.hidden = !rows.length;
  const seen = new Set();
  rows.forEach((row, i) => {
    seen.add(row.key);
    let node = state.stepNodes.get(row.key);
    if (!node) { node = buildStepNode(); state.stepNodes.set(row.key, node); }
    updateStepNode(node, row);
    const at = list.children[i];
    if (at !== node.el) list.insertBefore(node.el, at || null);
  });
  [...state.stepNodes].forEach(([key, node]) => {
    if (!seen.has(key)) { node.el.remove(); state.stepNodes.delete(key); }
  });
}
function clearSteps() {
  state.stepNodes.clear();
  $('steps').replaceChildren();
}
function stepSub(a) {
  if (a.resultSummary) return short(a.resultSummary, 160);
  const bits = describeArgs(a.args, 2).map(([k, val]) => k + ': ' + val);
  return bits.join(' · ');
}
function stepMeta(a) {
  const dev = /ios|iphone/i.test(String(a.name || '')) ? 'iPhone' : macLabel();
  const ms = a.durationMs != null ? a.durationMs : a.latencyMs != null ? a.latencyMs : a.elapsedMs;
  return [dev, formatDuration(Number(ms))].filter(Boolean).join(' · ');
}
function buildSteps(task, v) {
  const rows = [];
  v.actions.forEach((a, i) => {
    rows.push({ key: 'a' + (a.id || i), state: a.ok === false ? 'fail' : 'done', title: actionTitle(a.name), sub: stepSub(a), meta: stepMeta(a) });
  });
  if (v.pending) rows.push({ key: 'pending', state: 'wait', title: actionTitle(v.pending.actionName), sub: 'Waiting for your approval', meta: 'On hold' });
  else if (v.pin) rows.push({ key: 'input', state: 'wait', title: 'Needs your answer', sub: short(v.pin.question, 140), meta: '' });
  else if (v.mode === 'busy') {
    const latest = (task.events || []).slice(-1)[0];
    rows.push({ key: 'live', state: 'run', title: v.actions.length ? 'Working…' : 'Planning the safest route…', sub: latest ? short(latest.summary, 120) : '', meta: '' });
  } else if (v.mode === 'error') rows.push({ key: 'stop', state: 'fail', title: task.status === 'denied' ? 'Denied' : 'Stopped', sub: short(errorText(task), 160), meta: '' });
  return rows;
}
function renderPlan(task) {
  const items = Array.isArray(task.plan) ? task.plan.map(planLabel).filter(Boolean) : [];
  const sig = items.join('\n');
  if (sig === state.planSig) return;
  state.planSig = sig;
  const box = $('planBox');
  box.hidden = !items.length;
  $('planCount').textContent = 'Plan · ' + items.length + (items.length === 1 ? ' step' : ' steps');
  $('planList').replaceChildren(...items.map((t) => h('li', null, short(t, 140))));
}
function renderArtifact(task) {
  const uri = task && task.evidence && task.evidence.artifactUri;
  const chip = $('artifactChip');
  const sig = uri ? uri + '|' + (outcomeTone(task) || '') : '';
  if (sig === state.artifactSig) return;
  state.artifactSig = sig;
  if (!uri) { chip.hidden = true; return; }
  const info = artifactInfo(uri);
  const ic = $('artifactIcon');
  ic.className = 'result-ic' + (outcomeTone(task) === 'warn' ? ' is-warn' : '');
  ic.onclick = null;
  if (isRemoteImage(uri)) {
    ic.classList.add('result-thumb');
    ic.innerHTML = '';
    const img = h('img');
    img.src = uri; img.alt = 'Capture preview';
    ic.append(img);
    ic.onclick = () => openLightbox(uri);
  } else ic.innerHTML = icon(info.icon);
  $('artifactName').textContent = info.name;
  $('artifactName').title = info.full;
  $('artifactPath').textContent = info.where;
  $('artifactPath').title = info.full;
  chip.hidden = false;
  retrigger(chip, 'is-new');
}
function markDevices(v) {
  const mac = $('macbookNode'), phone = $('iphoneNode');
  [mac, phone].forEach((el) => el.classList.remove('is-active', 'is-gate', 'is-error'));
  if (!v) return;
  const target = v.phone ? phone : mac;
  const lastIos = v.pending ? /ios|iphone/i.test(v.pending.actionName || '') : v.act ? /ios|iphone/i.test(v.act.name || '') : false;
  const el = lastIos || (v.phone && !v.act && !v.pending) ? phone : (v.phone ? target : mac);
  if (v.mode === 'busy') el.classList.add('is-active');
  else if (v.mode === 'gate' || v.mode === 'input') el.classList.add('is-gate');
  else if (v.mode === 'error') el.classList.add('is-error');
}
function renderJson(value) {
  const raw = JSON.stringify(value, null, 2);
  const frag = document.createDocumentFragment();
  const rx = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?\b)/g;
  let last = 0, m;
  while ((m = rx.exec(raw))) {
    if (m.index > last) frag.append(document.createTextNode(raw.slice(last, m.index)));
    const span = document.createElement('span');
    if (m[1]) { span.className = m[2] ? 'j-key' : 'j-str'; span.textContent = m[1] + (m[2] || ''); }
    else if (m[3]) { span.className = 'j-bool'; span.textContent = m[3]; }
    else { span.className = 'j-num'; span.textContent = m[4]; }
    frag.append(span);
    last = rx.lastIndex;
  }
  if (last < raw.length) frag.append(document.createTextNode(raw.slice(last)));
  $('mcpJson').replaceChildren(frag);
}
function setPayload(value) { state.payload = value; renderJson(value); }
function taskPayload(task, opts) {
  const act = actionsOf(task).slice(-1)[0] || null;
  const pending = task.pendingApproval;
  const latency = opts && opts.elapsedMs != null ? Math.round(opts.elapsedMs) : elapsedForTask(task);
  const resultText = (task.outcome && (task.outcome.summary || task.outcome.reason)) || (task.evidence && task.evidence.note) || (act && act.resultSummary) || '';
  return {
    mcp_version: '2025-11-25',
    task_id: task.id || null,
    router: 'reach.orchestrator',
    target_node: (pending && pending.target) || (task.evidence && task.evidence.deviceId) || (act && act.target) || 'mesh',
    tool: (pending && pending.actionName) || (act && act.name) || null,
    args: (pending && pending.args) || (act && act.args) || {},
    status: PAYLOAD_STATUS[task.status] || String(task.status || 'UNKNOWN').toUpperCase(),
    policy: pending ? 'CONFIRM' : act && act.policyVerdict ? String(act.policyVerdict).toUpperCase() : 'ALLOW',
    latency_ms: latency,
    result: short(resultText, 150) || null,
  };
}

/* ---------------- apply a real task ---------------- */
function applyTaskState(task, opts) {
  opts = opts || {};
  if (state.stepsTaskId && state.stepsTaskId !== task.id) clearSteps();
  state.stepsTaskId = task.id || null;
  state.stageTask = task;
  const v = deriveView(task);
  const elapsed = opts.elapsedMs != null ? opts.elapsedMs : elapsedForTask(task);
  setDeck(v.mode);
  setUtter(goalOf(task));
  const n = narrativeFor(task, v, { historical: opts.historical, elapsed });
  setNarrative(n);
  $('pipelineRail').hidden = false;
  renderTrack(v.stages);
  renderPlan(task);
  renderSteps(buildSteps(task, v));
  renderArtifact(task);
  setLog(logFor(task, v));
  renderClipboard(task, v);
  renderPhone(task, v);
  markDevices(v);
  setPayload(taskPayload(task, { elapsedMs: elapsed }));
  if (!v.pending) closeSheet('gateScrim');
  if (!v.pin) closeSheet('questionScrim');
  if (!opts.silent) announce(n.title);
  maybeSpeak(task, v, opts);
}

function standby() {
  state.stageTask = null;
  state.stepsTaskId = null;
  clearSteps();
  state.artifactSig = '';
  setDeck('idle');
  setUtter('');
  standbyNarrative();
  $('pipelineRail').hidden = true;
  $('planBox').hidden = true; state.planSig = '';
  $('steps').hidden = true;
  $('artifactChip').hidden = true;
  renderTrack(['todo', 'todo', 'todo', 'todo']);
  markDevices(null);
  idleLog();
  renderPhone(null, null);
  setPayload({ mcp_version: '2025-11-25', router: 'reach.orchestrator', mesh: 'standby', target_node: 'any', tool: null, status: 'READY', latency_ms: null });
}

function beginRun(goal) {
  clearTimeout(voice.noticeTimer);
  voice.notice = '';
  voice.noticeTimer = 0;
  voice.heard.clear();
  state.stageTask = null;
  state.stepsTaskId = null;
  clearSteps();
  state.artifactSig = ''; $('artifactChip').hidden = true;
  state.planSig = ''; $('planBox').hidden = true;
  const kind = kindFromGoal(goal);
  setDeck('busy');
  setUtter(goal);
  setNarrative({ look: 'busy', kicker: 'Working', meta: '', title: 'Planning the safest route.', detail: 'Choosing the right tools for this goal.' });
  $('pipelineRail').hidden = false;
  renderTrack(['done', 'active', 'todo', 'todo']);
  renderSteps([{ key: 'live', state: 'run', title: 'Planning the safest route…', sub: '', meta: '' }]);
  setLog([{ text: 'Command received', tone: 'ok' }, { text: 'Choosing a tool…', tone: '' }]);
  setClipboard(kind === 'clipboard' ? 'Reading the clipboard…' : '', kind === 'clipboard');
  renderPhone({}, { phone: kind === 'screen', mode: 'busy', kind });
  markDevices({ mode: 'busy', phone: kind === 'screen', act: null, pending: null });
  setPayload({ mcp_version: '2025-11-25', task_id: null, router: 'reach.orchestrator', target_node: 'mesh', tool: null, status: 'ROUTING', policy: 'PENDING', latency_ms: null, intent: short(goal, 140) });
  announce('Planning the safest route.');
}

function applyFailedIntent(message) {
  const now = new Date().toISOString();
  applyTaskState({
    id: null, goal: '', status: 'failed', createdAt: now, updatedAt: now, error: message,
    outcome: { kind: 'failed', reason: message, evidenceActionIds: [] }, trace: [], events: [],
  }, {});
  setLog([{ text: short(message, 64), tone: 'err' }, { text: 'Nothing executed on a device', tone: '' }]);
  setUtter(plain($('utterText').dataset.key || ''));
  speak('I couldn’t start that. ' + short(message, 220));
}

/* ============================================================
   History
   ============================================================ */
const KIND_ICON = { screen: 'phone', clipboard: 'clipboard', file: 'file', audio: 'wave', web: 'globe', generic: 'spark' };
function missionTitle(task) {
  const g = goalOf(task);
  if (g) return short(g, 70);
  const s = (task.outcome && (task.outcome.summary || task.outcome.reason)) || (task.evidence && task.evidence.note) || task.error || 'Mesh mission';
  return short(s, 70);
}
function renderMissionLog(tasks) {
  const log = $('missionLog');
  const list = [...tasks].sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)).slice(0, 6);
  log.replaceChildren();
  $('missionCount').textContent = String(list.length);
  if (!list.length) { log.append(h('div', 'empty', 'No missions yet. Run something and it will show up here.')); return; }
  list.forEach((task) => {
    const meta = statusMeta(task);
    const b = h('button', 'mission');
    b.type = 'button';
    b.title = missionTitle(task);
    const ic = h('span', 'm-ic');
    ic.innerHTML = icon(KIND_ICON[kindOf(task, actionsOf(task))] || 'spark');
    const mid = h('div', 'm-mid');
    const dev = deviceName(task.evidence && task.evidence.deviceId);
    mid.append(h('div', 'm-title', missionTitle(task)), h('div', 'm-meta', relativeTime(task.updatedAt) + (dev ? ' · ' + dev : '')));
    b.append(ic, mid, h('span', 'pill ' + meta.cls, meta.label));
    b.onclick = () => { closeDrawer(); void loadMission(task.id); };
    log.append(b);
  });
}
async function refreshTasks() {
  try {
    const res = await fetch('/tools/tasks?limit=6');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const summaries = await res.json();
    const items = Array.isArray(summaries) ? summaries : [];
    const full = await Promise.all(items.map(async (t) => {
      try { const r = await fetch('/tools/task/' + encodeURIComponent(t.id)); return r.ok ? await r.json() : t; } catch { return t; }
    }));
    state.tasks = full;
    renderMissionLog(full);
    if (!state.initialLoaded) {
      state.initialLoaded = true;
      if (!state.busy && !state.stageTask) {
        const live = full.find((t) => !isTerminal(t.status) && Date.now() - Date.parse(t.updatedAt || 0) < 15 * 60 * 1000);
        if (live) void loadMission(live.id);
      }
    }
  } catch {
    if (!state.tasks.length) renderMissionLog([]);
  }
}

/* ============================================================
   Sheets: approval + clarification
   ============================================================ */
function openSheet(id) {
  const scrim = $(id);
  if (scrim.classList.contains('is-open')) return;
  state.opener = document.activeElement;
  scrim.classList.add('is-open');
  $('appShell').inert = true;
  suspendVoice();
  setTimeout(() => { const sheet = scrim.querySelector('.sheet'); if (sheet) sheet.focus(); }, 40);
}
function closeSheet(id) {
  const scrim = $(id);
  if (!scrim.classList.contains('is-open')) return;
  scrim.classList.remove('is-open');
  if (!document.querySelector('.scrim.is-open')) $('appShell').inert = false;
  renderVoice();
  if (!state.busy) setTimeout(resumeHandsFree, 320);
}
function expiryText(iso) {
  const ms = Date.parse(iso || '') - Date.now();
  if (!Number.isFinite(ms)) return 'Window unknown';
  if (ms <= 0) return 'Window expired';
  const sec = Math.ceil(ms / 1000);
  return 'Expires in ' + Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
}
function updateGateClock() {
  const pending = state.stageTask && state.stageTask.pendingApproval;
  if (!pending || !$('gateScrim').classList.contains('is-open')) return;
  const el = $('gateExpiry');
  if (el) el.textContent = expiryText(pending.expiresAt);
  const left = Date.parse(pending.expiresAt || '') - Date.now();
  $('gateTimer').style.transform = 'scaleX(' + Math.max(0, Math.min(1, left / state.gateTotal)).toFixed(3) + ')';
}
function setGateBusy(busy) { $('gateApprove').disabled = !!busy; $('gateDeny').disabled = !!busy; }
function showGate(task) {
  const pending = task && task.pendingApproval;
  if (!pending) return;
  state.stageTask = task;
  const title = actionTitle(pending.actionName);
  $('gateTitle').textContent = 'Allow REACH to ' + (title.charAt(0).toLowerCase() + title.slice(1)) + '?';
  $('gateConsequence').textContent = plain(pending.consequence) || 'A device action is waiting for your approval.';
  const risk = riskInfo(pending.actionClass, pending.actionName);
  const facts = $('gateFacts');
  facts.replaceChildren();
  const row = (label, node) => { const d = h('div'); d.append(h('dt', null, label), node); facts.append(d); };
  const risky = h('dd'); risky.append(h('span', 'risk' + (risk.tone === 'bad' ? ' bad' : ''), risk.label)); row('Risk', risky);
  const target = h('dd', 'mono', deviceName(pending.target) && !/[\\/]/.test(String(pending.target)) ? deviceName(pending.target) : (tildePath(pending.target) || 'This device'));
  row('Target', target);
  describeArgs(pending.args, 2).forEach(([k, val]) => row(k, h('dd', null, val)));
  const exp = h('dd'); const expSpan = h('span', null, expiryText(pending.expiresAt)); expSpan.id = 'gateExpiry'; exp.append(expSpan); row('Window', exp);
  const left = Date.parse(pending.expiresAt || '') - Date.now();
  state.gateTotal = Number.isFinite(left) && left > 0 ? left : 1;
  $('gateTimer').style.transition = 'none';
  $('gateTimer').style.transform = 'scaleX(1)';
  void $('gateTimer').offsetWidth;
  $('gateTimer').style.transition = '';
  setGateBusy(false);
  openSheet('gateScrim');
  announce('Approval needed: ' + (pending.consequence || title));
}
function showQuestion(task) {
  const pending = task && task.pendingInput;
  if (!pending) return;
  state.stageTask = task;
  const count = Math.max(1, Number(pending.questionCount) || ((task.askedQuestions || []).length + 1));
  $('questionCount').textContent = 'Question ' + Math.min(count, 3) + ' of 3';
  $('questionText').textContent = pending.question || 'REACH needs one detail to continue.';
  const options = $('questionOptions');
  options.replaceChildren();
  (pending.options || []).slice(0, 4).forEach((option) => {
    const btn = h('button', 'q-opt', option);
    btn.type = 'button';
    btn.onclick = () => { void answerQuestion(option); };
    options.append(btn);
  });
  options.hidden = !options.children.length;
  $('questionInput').value = '';
  $('questionInput').disabled = false;
  $('questionForm').querySelector('button').disabled = false;
  openSheet('questionScrim');
  announce('REACH asked: ' + (pending.question || 'a clarifying question'));
  setTimeout(() => { $('questionInput').focus(); }, 120);
}
async function decideApproval(decision) {
  const task = state.stageTask;
  const pending = task && task.pendingApproval;
  if (!pending || !task.id) return;
  const verb = decision === 'approve' ? 'approve' : 'deny';
  setGateBusy(true);
  try {
    const res = await fetch('/approvals/' + encodeURIComponent(pending.id) + '/' + verb, { method: 'POST' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error || 'HTTP ' + res.status);
    state.handledApprovals.add(pending.id);
    state.activeTaskId = task.id;
    stopSpeaking();
    setBusyUI(true);
    closeSheet('gateScrim');
    setNarrative({
      look: 'busy', kicker: decision === 'approve' ? 'Approved' : 'Denied', meta: '',
      title: decision === 'approve' ? 'Approval recorded. Continuing.' : 'Denial recorded. Stopping the mission.',
      detail: actionTitle(pending.actionName) + ' · verifying the next step',
    });
    announce(decision === 'approve' ? 'Approval recorded.' : 'Denial recorded.');
    void pollTask(task.id, { fast: true });
  } catch (err) {
    setGateBusy(false);
    announce(err instanceof Error ? 'Approval: ' + err.message : 'The core did not accept that decision.');
    try { await syncTask(task.id); } catch { /* the sheet stays up with its server-issued expiry */ }
  }
}
async function answerQuestion(text) {
  const task = state.stageTask;
  const pending = task && task.pendingInput;
  const value = String(text || '').trim().slice(0, 2000);
  if (!pending || !task.id || !value || state.answering) return;
  state.answering = true;
  $('questionInput').disabled = true;
  $('questionForm').querySelector('button').disabled = true;
  try {
    const res = await fetch('/tasks/' + encodeURIComponent(task.id) + '/input', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: value }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.ok === false) throw new Error(out.error || 'HTTP ' + res.status);
    state.handledQuestions.add(task.id + ':' + (pending.createdAt || pending.question));
    state.activeTaskId = task.id;
    stopSpeaking();
    setBusyUI(true);
    closeSheet('questionScrim');
    setNarrative({ look: 'busy', kicker: 'Resuming', meta: '', title: 'Answer recorded. Re-planning with it.', detail: short(value, 150) });
    announce('Answer recorded.');
    void pollTask(task.id, { fast: true });
  } catch (err) {
    announce(err instanceof Error ? 'Clarification: ' + err.message : 'The answer could not be recorded.');
    try { await syncTask(task.id); } catch { /* the question stays available for another answer */ }
  } finally {
    state.answering = false;
    $('questionInput').disabled = false;
    $('questionForm').querySelector('button').disabled = false;
  }
}

/* ============================================================
   Polling + running tasks
   ============================================================ */
async function fetchTask(taskId) {
  const res = await fetch('/tools/task/' + encodeURIComponent(taskId));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return await res.json();
}
function syncTaskInLog(task) {
  const i = state.tasks.findIndex((t) => t.id === task.id);
  if (i >= 0) state.tasks[i] = task; else state.tasks.push(task);
  renderMissionLog(state.tasks);
}
async function pollTask(taskId, opts) {
  opts = opts || {};
  let delay = opts.fast ? 280 : 700;
  let misses = 0;
  const startedAt = performance.now();
  while (state.activeTaskId === taskId) {
    await sleep(delay);
    delay = 1100;
    if (state.activeTaskId !== taskId) return;
    let task;
    try { task = await fetchTask(taskId); misses = 0; }
    catch {
      if (++misses >= 4) {
        state.activeTaskId = null;
        setBusyUI(false);
        setNarrative({ look: 'bad', kicker: 'Core link lost', meta: '', title: 'Lost contact with the core while watching this mission.', detail: 'It may still be running. Reload to resync its audit trail.' });
        announce('Lost contact with the core while watching the mission.');
        return;
      }
      continue;
    }
    if (!task || !task.id) {
      state.activeTaskId = null;
      setBusyUI(false);
      applyFailedIntent('The core no longer has this mission in its store.');
      return;
    }
    syncTaskInLog(task);
    applyTaskState(task, { elapsedMs: elapsedForTask(task), silent: true });
    if (task.pendingApproval) {
      if (!state.handledApprovals.has(task.pendingApproval.id)) { showGate(task); return; }
    } else if (task.pendingInput) {
      const key = task.id + ':' + (task.pendingInput.createdAt || task.pendingInput.question);
      if (!state.handledQuestions.has(key)) { showQuestion(task); return; }
    }
    if (isTerminal(task.status)) {
      announce(task.status === 'completed' ? 'Mission completed.' : 'Mission stopped.');
      state.activeTaskId = null;
      setBusyUI(false);
      void refreshTasks();
      return;
    }
    if (performance.now() - startedAt > 300000) {
      state.activeTaskId = null;
      setBusyUI(false);
      setNarrative({ look: 'busy', kicker: 'In the background', meta: '', title: 'This mission is still running.', detail: 'No final status after five minutes. Open it from History to keep watching.' });
      void refreshTasks();
      return;
    }
  }
}
async function syncTask(taskId) {
  const task = await fetchTask(taskId);
  if (!task || !task.id) throw new Error('unknown task');
  applyTaskState(task, { elapsedMs: elapsedForTask(task) });
  if (task.pendingApproval) { state.activeTaskId = task.id; showGate(task); }
  else if (task.pendingInput) { state.activeTaskId = task.id; showQuestion(task); }
  else if (!isTerminal(task.status)) { state.activeTaskId = task.id; setBusyUI(true); void pollTask(task.id, { fast: true }); }
  else { state.activeTaskId = null; setBusyUI(false); void refreshTasks(); }
}
function setBusyUI(busy) {
  state.busy = !!busy;
  $('deck').classList.toggle('is-busy', state.busy);
  document.body.dataset.busy = state.busy ? 'true' : 'false';
  renderVoice();
  if (!state.busy && !sheetOpen() && !state.drawerOpen && voice.handsFree) setTimeout(resumeHandsFree, 340);
}
async function runTask(goal) {
  const text = String(goal || '').trim();
  if (!text || state.busy) return;
  stopSpeaking();
  suspendVoice();
  $('ask').classList.remove('is-typing');
  $('goal').value = '';
  $('sendBtn').disabled = true;
  state.activeTaskId = null;
  setBusyUI(true);
  beginRun(text);
  try {
    const res = await fetch('/tools/execute_on_my_devices', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ task: text }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || !out || !out.taskId) throw new Error((out && out.error) || 'The core returned no task id.');
    state.activeTaskId = out.taskId;
    void pollTask(out.taskId, { fast: true });
  } catch (err) {
    applyFailedIntent(err instanceof Error ? err.message : 'The core could not start the mission.');
    setBusyUI(false);
    announce('The mission did not start.');
  }
}
async function loadMission(taskId) {
  if (!taskId) return;
  if (state.busy) { announce('A mission is already running. Wait for it to settle before replaying another.'); return; }
  try {
    const task = await fetchTask(taskId);
    if (!task || !task.id) throw new Error('unknown task');
    state.initialLoaded = true;
    applyTaskState(task, { historical: isTerminal(task.status), elapsedMs: elapsedForTask(task) });
    if (task.pendingApproval) { state.activeTaskId = task.id; setBusyUI(true); showGate(task); }
    else if (task.pendingInput) { state.activeTaskId = task.id; setBusyUI(true); showQuestion(task); }
    else if (!isTerminal(task.status)) { state.activeTaskId = task.id; setBusyUI(true); void pollTask(task.id, { fast: true }); }
    else { state.activeTaskId = null; setBusyUI(false); }
  } catch {
    announce('That mission could not be loaded from the core.');
  }
}

/* ============================================================
   Voice: wake word, one-shot capture, replies, demo fallback
   ============================================================ */
function sheetOpen() { return !!document.querySelector('.scrim.is-open'); }
function speechOk() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; }
function lowerFirst(s) { return String(s || '').replace(/^./, (c) => c.toLowerCase()); }
function setVoiceLive(text) { $('voiceLive').textContent = text || ''; }
function baseVoiceMode() {
  const m = $('deck').dataset.state;
  if (m === 'gate' || m === 'input') return 'waiting';
  if (m === 'done') return 'done';
  if (m === 'error') return 'error';
  if (m === 'busy') return 'thinking';
  return 'idle';
}
function syncVoiceMode() {
  const mode = voice.speaking ? 'speaking' : voice.listening ? 'listening' : baseVoiceMode();
  $('deck').dataset.voice = mode;
  orb.setMode(mode);
}
function setVoiceNotice(text) {
  clearTimeout(voice.noticeTimer);
  voice.notice = text || '';
  renderVoice();
  if (voice.notice) voice.noticeTimer = setTimeout(() => { voice.notice = ''; renderVoice(); }, 7000);
  if (text) announce(text);
}
function renderVoice() {
  const bar = $('ask');
  const typing = bar.classList.contains('is-typing');
  const blocked = state.busy || voice.demo > 0 || sheetOpen();
  bar.classList.toggle('is-listening', voice.listening && !voice.speaking);
  $('micBtn').disabled = blocked;
  $('orbHit').disabled = blocked;
  $('wakeBtn').disabled = blocked;
  $('typeBtn').disabled = blocked;
  $('typeBtn').setAttribute('aria-pressed', String(typing));
  $('wakeBtn').setAttribute('aria-pressed', String(voice.handsFree));
  $('speakerBtn').setAttribute('aria-pressed', String(voice.muted));
  $('speakerBtn').setAttribute('aria-label', voice.muted ? 'Unmute voice replies' : 'Mute voice replies');
  $('speakerBtn').title = voice.muted ? 'Unmute voice replies' : 'Mute voice replies';
  $('speakerUse').setAttribute('href', voice.muted ? '#i-speaker-off' : '#i-speaker');
  $('speakerBtn').disabled = !speechOk();
  if (!speechOk()) $('speakerBtn').title = 'Voice replies unavailable in this browser';
  $('goal').disabled = state.busy;
  $('sendBtn').disabled = state.busy || !$('goal').value.trim();
  document.querySelectorAll('#scenarioChips .chip').forEach((b) => { b.disabled = state.busy || voice.demo > 0; });

  const st = $('voiceStatus'), sub = $('voiceSub');
  if (voice.notice) {
    st.textContent = 'Voice unavailable';
    sub.textContent = voice.notice;
  } else if (voice.speaking) {
    st.textContent = 'Speaking';
    sub.textContent = 'Tap the mic to interrupt';
  } else if (voice.listening) {
    st.textContent = voice.capturing ? 'Listening…' : 'Listening for “Hey REACH”';
    sub.textContent = voice.capturing ? 'Say what you want' : 'Hands-free is on';
  } else if (sheetOpen()) {
    st.textContent = 'Waiting for you';
    sub.textContent = 'Use the card on screen';
  } else if (typing) {
    st.textContent = 'Type it instead';
    sub.textContent = 'Press Enter to run';
  } else if (state.busy) {
    st.textContent = 'Working…';
    sub.textContent = 'I’ll speak when it’s done';
  } else if ($('deck').dataset.state === 'done') {
    st.textContent = 'Done';
    sub.textContent = 'Tap to talk again';
  } else if ($('deck').dataset.state === 'error') {
    st.textContent = 'Stopped';
    sub.textContent = 'Tap to try again';
  } else if ($('deck').dataset.state === 'gate') {
    st.textContent = 'Waiting for approval';
    sub.textContent = 'Use the approval card';
  } else if ($('deck').dataset.state === 'input') {
    st.textContent = 'One question';
    sub.textContent = 'Answer in the card';
  } else {
    st.textContent = voice.handsFree ? 'Listening for “Hey REACH”' : 'Tap to talk';
    sub.textContent = !voice.supported ? 'Voice isn’t supported here — click a phrase' : voice.handsFree ? 'Hands-free is on' : 'or say “Hey REACH”';
  }
}
function standbyNarrative() {
  const ok = voice.supported;
  setNarrative({
    look: 'idle', kicker: voice.handsFree ? 'Wake word on' : 'Ready', meta: '',
    title: ok ? 'Say “Hey REACH”' : 'Tell REACH what to do',
    detail: ok
      ? 'or tap the orb. I’ll plan it, ask before anything risky, and show you the evidence.'
      : 'Click a phrase below or type a command. Voice isn’t available in this browser.',
  });
}
function restoreNarrative() {
  if (state.stageTask) {
    const v = deriveView(state.stageTask);
    setNarrative(narrativeFor(state.stageTask, v, { elapsed: elapsedForTask(state.stageTask) }));
  } else standbyNarrative();
}
function parseWake(text) {
  const clean = String(text || '').trim().replace(/^[“"'‘\s]+/, '');
  // "reach" arrives as rich/reech/ritch often; allow "hey there" and find the
  // wake phrase anywhere so a repeated wake word mid-utterance still parses.
  const m = clean.match(/\b(?:hey|hi|hello|ok|okay)(?:[\s,]+(?:there|their))?[\s,]+(?:reach|richie|reetch|reech|ritch|retch|reche|raech|rach|rich|alexa)\b/i);
  if (!m) return null;
  const before = clean.slice(0, m.index).replace(/[\s,.:;!?—–-]+$/, '').trim();
  const after = clean.slice(m.index + m[0].length).replace(/^[\s,.:;!?—–-]+/, '').trim();
  const command = [before, after].filter(Boolean).join(' ').trim();
  // A duplicated/misheard wake ("Hey reach, Rich") is still wake-only, not a task.
  if (/^(?:(?:hey|hi|hello|ok|okay)[\s,]+)?(?:(?:there|their)[\s,]+)?(?:(?:reach|richie|reetch|reech|ritch|retch|reche|raech|rach|rich|alexa)[\s,.]*)+$/i.test(command)) {
    return { command: '' };
  }
  return { command };
}
function displayHeard(text) {
  const parsed = parseWake(text);
  if (!parsed) return String(text || '').trim();
  return parsed.command ? 'Hey REACH, ' + parsed.command : 'Hey REACH';
}

/* ----- microphone level ----- */
async function startMeter() {
  if (voice.meterStream) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
  const token = ++voice.meterToken;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch { return; }
  if (token !== voice.meterToken) { stream.getTracks().forEach((t) => t.stop()); return; }
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) { stream.getTracks().forEach((t) => t.stop()); return; }
  voice.meterStream = stream;
  voice.meterCtx = new Ctx();
  voice.meterCtx.resume().catch(() => {});
  const src = voice.meterCtx.createMediaStreamSource(stream);
  voice.meterAnalyser = voice.meterCtx.createAnalyser();
  voice.meterAnalyser.fftSize = 256;
  voice.meterData = new Uint8Array(voice.meterAnalyser.frequencyBinCount);
  src.connect(voice.meterAnalyser);
  const tick = () => {
    if (!voice.meterStream || !voice.meterAnalyser || token !== voice.meterToken) return;
    voice.meterAnalyser.getByteTimeDomainData(voice.meterData);
    let sum = 0;
    for (let i = 0; i < voice.meterData.length; i++) { const v = (voice.meterData[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / voice.meterData.length);
    voice.level = voice.level * 0.72 + Math.min(1, Math.max(0, (rms - 0.012) * 7)) * 0.28;
    orb.setMic(voice.level);
    voice.meterRaf = requestAnimationFrame(tick);
  };
  tick();
}
function stopMeter() {
  voice.meterToken += 1;
  cancelAnimationFrame(voice.meterRaf);
  voice.meterRaf = 0;
  voice.level = 0;
  orb.setMic(0);
  if (voice.meterStream) voice.meterStream.getTracks().forEach((t) => t.stop());
  voice.meterStream = null;
  voice.meterAnalyser = null;
  voice.meterData = null;
  if (voice.meterCtx) { voice.meterCtx.close().catch(() => {}); voice.meterCtx = null; }
}

/* ----- recognition ----- */
function initRecognition() {
  if (voice.rec) return voice.rec;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.lang = (navigator.language || 'en-US').replace('_', '-');
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.onstart = () => { voice.recognizing = true; };
  rec.onresult = (event) => {
    if (voice.demo || voice.speaking) return;
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = String((res[0] && res[0].transcript) || '').trim();
      if (!text) continue;
      if (res.isFinal) handleVoiceFinal(text);
      else interim += (interim ? ' ' : '') + text;
    }
    if (interim) setVoiceLive('“' + displayHeard(interim) + '”');
  };
  rec.onerror = (event) => {
    const err = event && event.error;
    if (err === 'not-allowed' || err === 'service-not-allowed') {
      voice.handsFree = false;
      voice.want = false;
      voice.recognizing = false;
      stopMeter();
      endListening();
      setVoiceNotice('Microphone access is blocked. Click a phrase below, or type.');
    } else if (err === 'audio-capture') {
      setVoiceNotice('No microphone was found. Click a phrase below, or type.');
    } else if (err === 'network') {
      setVoiceNotice('Voice recognition needs a network connection here.');
    }
  };
  rec.onend = () => {
    voice.recognizing = false;
    if (voice.want && voice.handsFree && !voice.submitting && !state.busy && !sheetOpen()) {
      clearTimeout(voice.restartTimer);
      voice.restartTimer = setTimeout(() => { if (voice.want && voice.handsFree) startRecognition(true); }, 350);
    } else if (voice.listening && !voice.handsFree && !voice.submitting) {
      if (voice.submitTimer) return;
      if (voice.wakeOnly && voice.want) {
        clearTimeout(voice.restartTimer);
        voice.restartTimer = setTimeout(() => { if (voice.wakeOnly && voice.want && !voice.recognizing) startRecognition(true); }, 250);
      } else {
        endListening();
      }
    }
  };
  voice.rec = rec;
  return rec;
}
function startRecognition(continuous) {
  const rec = initRecognition();
  if (!rec) return false;
  if (voice.recognizing) return true;
  rec.continuous = !!continuous;
  try { rec.start(); voice.recognizing = true; return true; }
  catch (err) {
    if (err && err.name === 'InvalidStateError') { voice.recognizing = true; return true; }
    return false;
  }
}
function stopRecognition() {
  voice.want = false;
  clearTimeout(voice.restartTimer);
  if (voice.rec) { try { voice.rec.abort(); } catch { /* already stopped */ } }
  voice.recognizing = false;
}
function endListening() {
  clearTimeout(voice.captureTimer);
  clearTimeout(voice.submitTimer);
  voice.captureTimer = 0;
  voice.submitTimer = 0;
  voice.draft = '';
  voice.wakeOnly = false;
  const was = voice.listening || voice.capturing;
  voice.listening = false;
  voice.capturing = false;
  state.listening = false;
  setVoiceLive('');
  syncVoiceMode();
  renderVoice();
  if (was && !state.busy) restoreNarrative();
}
function armHandsFree() {
  if (!voice.handsFree || state.busy || sheetOpen()) return;
  voice.want = true;
  voice.listening = true;
  voice.capturing = false;
  state.listening = true;
  syncVoiceMode();
  renderVoice();
  void startMeter();
  startRecognition(true);
}
function resumeHandsFree() {
  if (!voice.handsFree || voice.speaking || voice.demo > 0 || voice.listening || state.busy || sheetOpen()) return;
  if ($('ask').classList.contains('is-typing')) return;
  armHandsFree();
}
function suspendVoice() {
  clearTimeout(voice.captureTimer);
  clearTimeout(voice.restartTimer);
  clearTimeout(voice.submitTimer);
  voice.captureTimer = 0;
  voice.restartTimer = 0;
  voice.submitTimer = 0;
  voice.draft = '';
  voice.wakeOnly = false;
  voice.want = false;
  voice.listening = false;
  voice.capturing = false;
  state.listening = false;
  stopRecognition();
  stopMeter();
  setVoiceLive('');
  syncVoiceMode();
  renderVoice();
}
function startOneShot() {
  if (state.busy || voice.demo > 0 || sheetOpen()) return;
  leaveTyping();
  if (voice.speaking) stopSpeaking();
  if (!voice.supported) {
    setVoiceNotice('Voice isn’t available in this browser. Playing a demo.');
    void demoVoice(SCENARIOS[0].goal, SCENARIOS[0].label);
    return;
  }
  if (voice.capturing) {
    clearTimeout(voice.captureTimer);
    clearTimeout(voice.submitTimer);
    voice.captureTimer = 0;
    voice.submitTimer = 0;
    voice.capturing = false;
    voice.wakeOnly = false;
    voice.draft = '';
    voice.want = false;
    setVoiceLive('');
    if (voice.handsFree) {
      voice.listening = true;
      state.listening = true;
      voice.want = true;
      startRecognition(true);
      restoreNarrative();
      syncVoiceMode();
      renderVoice();
    } else {
      stopRecognition();
      stopMeter();
      endListening();
    }
    return;
  }
  voice.listening = true;
  voice.capturing = true;
  voice.want = true;
  voice.wakeOnly = false;
  voice.draft = '';
  state.listening = true;
  syncVoiceMode();
  renderVoice();
  setNarrative({ look: 'busy', kicker: 'Listening', meta: '', title: 'Listening…', detail: 'Speak naturally. I’ll take it from here.' });
  setUtter('');
  setVoiceLive('');
  void startMeter();
  // Continuous recognition + a silence debounce lets one command span pauses.
  startRecognition(true);
  clearTimeout(voice.captureTimer);
  voice.captureTimer = setTimeout(() => {
    if (!voice.capturing) return;
    voice.capturing = false;
    setVoiceLive('');
    if (voice.handsFree) {
      voice.listening = true;
      state.listening = true;
      restoreNarrative();
      syncVoiceMode();
      renderVoice();
    } else {
      stopRecognition();
      stopMeter();
      endListening();
    }
  }, 10000);
  announce('Listening. Say what you want.');
}
function toggleHandsFree() {
  if (state.busy || voice.demo > 0 || sheetOpen()) return;
  if (voice.handsFree) {
    voice.handsFree = false;
    voice.want = false;
    clearTimeout(voice.captureTimer);
    clearTimeout(voice.restartTimer);
    clearTimeout(voice.submitTimer);
    voice.captureTimer = 0;
    voice.submitTimer = 0;
    voice.draft = '';
    voice.wakeOnly = false;
    stopRecognition();
    stopMeter();
    voice.listening = false;
    voice.capturing = false;
    state.listening = false;
    setVoiceLive('');
    syncVoiceMode();
    renderVoice();
    restoreNarrative();
    announce('Hands-free off.');
    return;
  }
  if (!voice.supported) {
    setVoiceNotice('Hands-free needs the Web Speech API. Click a phrase below, or type.');
    return;
  }
  leaveTyping();
  if (voice.speaking) stopSpeaking();
  voice.handsFree = true;
  armHandsFree();
  restoreNarrative();
  announce('Hands-free on. Say Hey REACH.');
}
function armCaptureWindow() {
  clearTimeout(voice.captureTimer);
  voice.captureTimer = setTimeout(() => {
    if (!voice.capturing) return;
    voice.wakeOnly = false;
    voice.capturing = false;
    voice.draft = '';
    setVoiceLive('');
    if (voice.handsFree) { voice.listening = true; state.listening = true; restoreNarrative(); syncVoiceMode(); renderVoice(); }
    else { stopRecognition(); stopMeter(); endListening(); }
  }, 10000);
}
function startWakeGreeting() {
  voice.capturing = true;
  voice.listening = true;
  voice.wakeOnly = true;
  voice.draft = '';
  state.listening = true;
  clearTimeout(voice.submitTimer);
  voice.submitTimer = 0;
  syncVoiceMode();
  renderVoice();
  setUtter('');
  setVoiceLive('');
  setNarrative({ look: 'idle', kicker: 'Hey REACH', meta: '', title: 'Hey, how are you?', detail: 'What would you like me to do?' });
  armCaptureWindow();
  announce('Hey, how are you? What would you like me to do?');
}
function queueVoice(command, heard) {
  voice.draft = command;
  voice.capturing = true;
  voice.listening = true;
  voice.wakeOnly = false;
  state.listening = true;
  syncVoiceMode();
  renderVoice();
  setVoiceLive('“' + displayHeard(heard) + '”');
  setNarrative({ look: 'busy', kicker: 'Got it', meta: '', title: 'Got it.', detail: command });
  armCaptureWindow();
  scheduleVoiceAccept();
}
function scheduleVoiceAccept() {
  clearTimeout(voice.submitTimer);
  voice.submitTimer = setTimeout(() => {
    voice.submitTimer = 0;
    const command = voice.draft.trim();
    if (!command || voice.submitting) return;
    void acceptVoice(command, 'Hey REACH, ' + command);
  }, 2000);
}
function handleVoiceFinal(text) {
  if (voice.demo || voice.speaking || voice.submitting) return;
  const clean = String(text || '').trim();
  if (!clean) return;
  if (!voice.capturing) {
    const parsed = parseWake(clean);
    if (!parsed) { setVoiceLive(''); return; }
    const command = parsed.command.trim();
    if (command) { queueVoice(command, clean); return; }
    startWakeGreeting();
    return;
  }
  const parsed = parseWake(clean);
  const command = (parsed ? parsed.command : clean).trim();
  if (!command) {
    if (!voice.draft && parsed) { startWakeGreeting(); return; }
    setVoiceLive('“Hey REACH”');
    return;
  }
  voice.draft = [voice.draft, command].filter(Boolean).join(' ');
  voice.wakeOnly = false;
  setVoiceLive('“' + voice.draft + '”');
  armCaptureWindow();
  scheduleVoiceAccept();
}
async function acceptVoice(command, heard) {
  if (state.busy || voice.demo > 0 || sheetOpen()) return;
  voice.submitting = true;
  voice.capturing = true;
  voice.listening = true;
  voice.wakeOnly = false;
  state.listening = true;
  clearTimeout(voice.captureTimer);
  clearTimeout(voice.submitTimer);
  voice.captureTimer = 0;
  voice.submitTimer = 0;
  syncVoiceMode();
  renderVoice();
  setVoiceLive('“' + displayHeard(heard) + '”');
  setNarrative({ look: 'busy', kicker: 'Got it', meta: '', title: 'Got it.', detail: command });
  await sleep(220);
  voice.submitting = false;
  if (!state.busy) submitVoice(command);
}
function submitVoice(command) {
  const text = String(command || '').trim();
  if (!text || state.busy) return;
  clearTimeout(voice.captureTimer);
  clearTimeout(voice.submitTimer);
  voice.captureTimer = 0;
  voice.submitTimer = 0;
  voice.draft = '';
  voice.wakeOnly = false;
  voice.listening = false;
  voice.capturing = false;
  state.listening = false;
  stopRecognition();
  stopMeter();
  setVoiceLive('');
  syncVoiceMode();
  renderVoice();
  void runTask(text);
}
async function demoVoice(goal, label) {
  if (state.busy || voice.demo > 0) return;
  leaveTyping();
  voice.demo += 1;
  suspendVoice();
  renderVoice();
  voice.listening = true;
  voice.capturing = true;
  state.listening = true;
  syncVoiceMode();
  renderVoice();
  setNarrative({ look: 'busy', kicker: 'Listening', meta: '', title: 'Listening…', detail: 'Speak naturally. I’ll take it from here.' });
  setUtter('');
  const words = ('Hey REACH, ' + (label || goal)).split(' ');
  let said = '';
  for (const word of words) {
    said += (said ? ' ' : '') + word;
    setVoiceLive('“' + said + '”');
    await sleep(64);
  }
  await sleep(320);
  setVoiceLive('');
  voice.listening = false;
  voice.capturing = false;
  state.listening = false;
  voice.demo -= 1;
  syncVoiceMode();
  renderVoice();
  void runTask(goal);
}

/* ----- spoken replies ----- */
function pickVoice() {
  if (!speechOk()) return null;
  const voices = speechSynthesis.getVoices() || [];
  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!en.length) return null;
  // Rank by preference, not the order the browser happens to list voices in.
  const prefs = ['siri', 'samantha', 'ava', 'allison', 'susan', 'zoe', 'serena', 'kate', 'aria', 'jenny', 'michelle', 'zira', 'google us english', 'google uk english female'];
  const rank = (v) => {
    const name = String(v.name || '').toLowerCase();
    const i = prefs.findIndex((p) => name.includes(p));
    let score = i < 0 ? 50 : i;
    if (/natural|premium|enhanced/.test(name)) score -= 20;
    if (/en[-_]us/i.test(v.lang)) score -= 5;
    if (v.localService) score -= 1;
    return score;
  };
  return en.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
}
function stopSpeaking() {
  voice.speechToken += 1;
  clearTimeout(voice.speechTimer);
  voice.speechTimer = 0;
  if (voice.speaking) {
    try { speechSynthesis.cancel(); } catch { /* speech may be unavailable */ }
    voice.speaking = false;
    syncVoiceMode();
    renderVoice();
  }
}
function speak(text) {
  const clean = plain(text).replace(/\s+/g, ' ').trim();
  if (!clean || voice.muted || !speechOk() || voice.demo > 0) return;
  stopSpeaking();
  const token = voice.speechToken;
  if (voice.listening || voice.recognizing || voice.meterStream) {
    voice.want = false;
    clearTimeout(voice.submitTimer);
    voice.submitTimer = 0;
    voice.draft = '';
    voice.wakeOnly = false;
    stopRecognition();
    stopMeter();
    voice.listening = false;
    voice.capturing = false;
    state.listening = false;
    setVoiceLive('');
  }
  voice.speaking = true;
  syncVoiceMode();
  renderVoice();
  const u = new SpeechSynthesisUtterance(clean);
  const picked = pickVoice();
  if (picked) u.voice = picked;
  u.rate = 1.0;
  u.pitch = 1.0;
  u.volume = 0.95;
  let finished = false;
  const done = () => {
    if (finished || token !== voice.speechToken) return;
    finished = true;
    clearTimeout(voice.speechTimer);
    voice.speechTimer = 0;
    voice.speaking = false;
    syncVoiceMode();
    renderVoice();
    if (voice.handsFree && !state.busy && !sheetOpen() && !$('ask').classList.contains('is-typing')) setTimeout(resumeHandsFree, 480);
  };
  u.onend = done;
  u.onerror = done;
  try { speechSynthesis.speak(u); }
  catch { done(); return; }
  if (finished) return;
  clearTimeout(voice.speechTimer);
  voice.speechTimer = setTimeout(done, Math.min(22000, 1500 + clean.split(/\s+/).length * 330));
}
function speechForDone(task, v) {
  const oc = task.outcome || {};
  let raw = plain(oc.summary || oc.reason || (task.evidence && task.evidence.note) || 'Done.');
  raw = raw.replace(/^done[.!:]?\s*/i, '');
  const line = firstSentence(raw, 160);
  if (v.tone === 'bad') return 'I couldn’t finish that. ' + (line || 'Nothing else ran.');
  let spoken = line ? 'Done. ' + line : 'Done.';
  if (!/on screen|check|result|above|below|here/i.test(spoken)) spoken += ' Check the result on screen.';
  if (v.tone === 'warn') spoken += ' Some checks did not pass.';
  return spoken;
}
function speechForError(task) {
  if (task.status === 'denied') return 'Stopped. Nothing was changed.';
  if (task.status === 'cancelled') return 'Stopped.';
  return 'I couldn’t finish that. ' + short(errorText(task), 220) + ' Nothing else ran.';
}
function maybeSpeak(task, v, opts) {
  opts = opts || {};
  if (opts.historical || !task || !task.id) return;
  let key = '', line = '';
  if (v.mode === 'gate' && v.pending) {
    key = task.id + ':gate:' + v.pending.id;
    line = 'I need your approval to ' + lowerFirst(actionTitle(v.pending.actionName)) + '. ' + (v.pending.consequence || 'Open the approval card to review it.');
  } else if (v.mode === 'input' && v.pin) {
    key = task.id + ':q:' + v.pin.question;
    line = v.pin.question;
  } else if (v.mode === 'done') {
    key = task.id + ':done';
    line = speechForDone(task, v);
  } else if (v.mode === 'error') {
    key = task.id + ':' + (task.status || 'error');
    line = speechForError(task);
  }
  if (!key || voice.heard.has(key)) return;
  voice.heard.add(key);
  speak(line);
}
function toggleMute() {
  voice.muted = !voice.muted;
  try { localStorage.setItem('reach-voice-muted', voice.muted ? '1' : '0'); } catch { /* storage may be blocked */ }
  if (voice.muted) {
    stopSpeaking();
    if (voice.handsFree) setTimeout(resumeHandsFree, 480);
  }
  renderVoice();
  announce(voice.muted ? 'Voice replies muted.' : 'Voice replies on.');
}
function leaveTyping() {
  if (!$('ask').classList.contains('is-typing')) return;
  $('ask').classList.remove('is-typing');
  $('goal').value = '';
  $('sendBtn').disabled = true;
  renderVoice();
}
function openTyping() {
  if (state.busy || sheetOpen()) return;
  stopSpeaking();
  suspendVoice();
  $('ask').classList.add('is-typing');
  renderVoice();
  setTimeout(() => $('goal').focus({ preventScroll: true }), 40);
}
function closeTyping() {
  if (!$('ask').classList.contains('is-typing')) return;
  $('ask').classList.remove('is-typing');
  $('goal').value = '';
  $('sendBtn').disabled = true;
  renderVoice();
  setTimeout(() => { $('typeBtn').focus({ preventScroll: true }); if (voice.handsFree) resumeHandsFree(); }, 180);
}

/* ============================================================
   Drawer, theme, lightbox, health
   ============================================================ */
function setTab(name) {
  const trace = name === 'trace';
  $('tabHistory').setAttribute('aria-selected', String(!trace));
  $('tabTrace').setAttribute('aria-selected', String(trace));
  $('panelHistory').hidden = trace;
  $('panelTrace').hidden = !trace;
}
function openDrawer(tab) {
  setTab(tab);
  if (!state.drawerOpen) state.opener = document.activeElement;
  state.drawerOpen = true;
  $('drawer').inert = false;
  $('drawer').classList.add('is-open');
  $('veil').classList.add('is-open');
  setTimeout(() => $('drawerClose').focus(), 60);
}
function closeDrawer() {
  if (!state.drawerOpen) return;
  state.drawerOpen = false;
  $('drawer').classList.remove('is-open');
  $('veil').classList.remove('is-open');
  $('drawer').inert = true;
  if (state.opener && state.opener.focus) state.opener.focus();
}
function currentTheme() {
  return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function syncThemeIcon() { $('themeUse').setAttribute('href', currentTheme() === 'dark' ? '#i-sun' : '#i-moon'); }
function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('reach-theme', next); } catch { /* storage may be blocked */ }
  syncThemeIcon();
}
function openLightbox(url) { if (!url) return; $('lightboxImg').src = url; $('lightbox').hidden = false; }
function closeLightbox() { $('lightbox').hidden = true; $('lightboxImg').removeAttribute('src'); }

async function updateBuildStamps() {
  try {
    const health = await (await fetch('/health')).json();
    $('serverStamp').textContent = 'Core build ' + (health.buildStamp || 'unknown');
    $('meshPill').title = 'Core build ' + (health.buildStamp || 'unknown');
    state.coreOk = health.ok === true;
  } catch {
    $('serverStamp').textContent = 'Core unreachable';
    $('meshPill').title = 'Core unreachable';
    state.coreOk = false;
  }
  try {
    const agent = await (await fetch('http://127.0.0.1:3001/health')).json();
    $('agentStamp').textContent = 'Agent build ' + (agent.buildStamp || 'unknown');
    state.agentOk = true;
  } catch {
    $('agentStamp').textContent = 'Agent build unavailable from this page';
    state.agentOk = false;
  }
  updateMeshPill();
}

/* ============================================================
   Wiring + boot
   ============================================================ */
function initChips() {
  const box = $('scenarioChips');
  SCENARIOS.forEach((s) => {
    const btn = h('button', 'chip');
    btn.type = 'button';
    btn.title = s.goal;
    btn.innerHTML = icon(s.icon) + '<span></span>' + (s.asks ? icon('lock', 'lock') : '');
    btn.querySelector('span').textContent = '“' + s.label + '”';
    btn.setAttribute('aria-label', 'Say ' + s.label + (s.asks ? ' (asks for approval)' : ''));
    btn.onclick = () => { void demoVoice(s.goal, s.label); };
    box.append(btn);
  });
}
function trapTab(e) {
  if (e.key !== 'Tab') return;
  const open = document.querySelector('.scrim.is-open .sheet');
  if (!open) return;
  const f = [...open.querySelectorAll('button:not(:disabled), input:not(:disabled)')].filter((x) => x.offsetParent !== null);
  if (!f.length) { e.preventDefault(); open.focus(); return; }
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === open)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

$('ask').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('goal').value.trim();
  if (text) { $('sendBtn').disabled = true; void runTask(text); }
});
$('goal').addEventListener('input', () => { $('sendBtn').disabled = state.busy || !$('goal').value.trim(); });
$('micBtn').addEventListener('click', startOneShot);
$('orbHit').addEventListener('click', startOneShot);
$('wakeBtn').addEventListener('click', toggleHandsFree);
$('speakerBtn').addEventListener('click', toggleMute);
$('typeBtn').addEventListener('click', () => { $('ask').classList.contains('is-typing') ? closeTyping() : openTyping(); });
$('btnHistory').addEventListener('click', () => { state.drawerOpen && $('tabHistory').getAttribute('aria-selected') === 'true' ? closeDrawer() : openDrawer('history'); });
$('btnTrace').addEventListener('click', () => { state.drawerOpen && $('tabTrace').getAttribute('aria-selected') === 'true' ? closeDrawer() : openDrawer('trace'); });
$('btnTheme').addEventListener('click', toggleTheme);
$('tabHistory').addEventListener('click', () => setTab('history'));
$('tabTrace').addEventListener('click', () => setTab('trace'));
$('drawerClose').addEventListener('click', closeDrawer);
$('veil').addEventListener('click', closeDrawer);
$('gateApprove').addEventListener('click', () => { void decideApproval('approve'); });
$('gateDeny').addEventListener('click', () => { void decideApproval('deny'); });
$('questionForm').addEventListener('submit', (e) => { e.preventDefault(); void answerQuestion($('questionInput').value); });
$('artifactCopy').addEventListener('click', () => {
  const uri = state.stageTask && state.stageTask.evidence && state.stageTask.evidence.artifactUri;
  if (uri) void copyText(cleanUri(uri), $('artifactCopy'), 'Copied', 'Copy path');
});
$('copyJson').addEventListener('click', () => { void copyText(JSON.stringify(state.payload || {}, null, 2), $('copyJson'), 'Copied', 'Copy JSON'); });
$('lightbox').addEventListener('click', closeLightbox);
document.addEventListener('keydown', (e) => {
  trapTab(e);
  if (e.key === 'Escape') {
    if (!$('lightbox').hidden) closeLightbox();
    else if (state.drawerOpen) closeDrawer();
    else if (voice.speaking) {
      stopSpeaking();
      if (voice.handsFree) setTimeout(resumeHandsFree, 480);
    } else if ($('ask').classList.contains('is-typing')) closeTyping();
  } else if (e.key === '/' && !state.busy && !sheetOpen() && !/^(input|textarea)$/i.test(document.activeElement.tagName)) {
    e.preventDefault();
    openTyping();
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopSpeaking();
    if (voice.handsFree || voice.listening) suspendVoice();
  } else if (voice.handsFree) {
    setTimeout(resumeHandsFree, 320);
  }
});
window.addEventListener('pagehide', () => { stopSpeaking(); suspendVoice(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeIcon);

initChips();
syncThemeIcon();
standby();
renderVoice();
renderDevices();
void updateBuildStamps();
void refreshDevices();
void refreshTasks();
setInterval(updateBuildStamps, 10000);
setInterval(refreshDevices, 5000);
setInterval(refreshTasks, 30000);
setInterval(updateGateClock, 1000);
setInterval(() => { if (!state.stageTask) renderPhone(null, null); }, 30000);
