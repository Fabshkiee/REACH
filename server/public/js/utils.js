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
