/* ============================================================Voice: wake word, one-shot capture, replies, demo fallback
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
let ttsAudio = null;
function stopSpeaking() {
  voice.speechToken += 1;
  clearTimeout(voice.speechTimer);
  voice.speechTimer = 0;
  if (ttsAudio) {
    try {
      ttsAudio.pause();
      ttsAudio.currentTime = 0;
    } catch { /* ignore */ }
    ttsAudio = null;
  }
  if (voice.speaking) {
    try { speechSynthesis.cancel(); } catch { /* speech may be unavailable */ }
    voice.speaking = false;
    syncVoiceMode();
    renderVoice();
  }
}
function speak(text, emotion = 'friendly') {
  const clean = plain(text).replace(/\s+/g, ' ').trim();
  if (!clean || voice.muted || voice.demo > 0) return;
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

  let finished = false;
  const done = () => {
    if (finished || token !== voice.speechToken) return;
    finished = true;
    clearTimeout(voice.speechTimer);
    voice.speechTimer = 0;
    if (ttsAudio) {
      try { ttsAudio.pause(); } catch { /* ignore */ }
      ttsAudio = null;
    }
    voice.speaking = false;
    syncVoiceMode();
    renderVoice();
    if (voice.handsFree && !state.busy && !sheetOpen() && !$('ask').classList.contains('is-typing')) setTimeout(resumeHandsFree, 480);
  };

  // 1. Primary: High-fidelity Microsoft Jenny Neural AI Voice via /api/tts
  const audioUrl = `/api/tts?emotion=${encodeURIComponent(emotion)}&text=${encodeURIComponent(clean)}`;
  const audio = new Audio(audioUrl);
  ttsAudio = audio;

  const fallbackToLocalSynthesis = () => {
    if (finished || token !== voice.speechToken || !speechOk()) return;
    const u = new SpeechSynthesisUtterance(clean);
    const picked = pickVoice();
    if (picked) u.voice = picked;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 0.95;
    u.onend = done;
    u.onerror = done;
    try { speechSynthesis.speak(u); }
    catch { done(); return; }
    if (finished) return;
    clearTimeout(voice.speechTimer);
    voice.speechTimer = setTimeout(done, Math.min(22000, 1500 + clean.split(/\s+/).length * 330));
  };

  audio.onended = done;
  audio.onerror = (e) => {
    console.warn('[Voice] Neural TTS stream failed, falling back to local speech synthesis', e);
    fallbackToLocalSynthesis();
  };

  audio.play().catch((err) => {
    console.warn('[Voice] Audio autoplay blocked or failed, falling back to local speech synthesis:', err);
    fallbackToLocalSynthesis();
  });

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
