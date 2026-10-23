/* ============================================================Drawer, theme, lightbox, health
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
