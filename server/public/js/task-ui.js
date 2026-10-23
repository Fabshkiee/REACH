/* ============================================================Task semantics
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
