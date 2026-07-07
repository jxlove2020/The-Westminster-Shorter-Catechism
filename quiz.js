// ── 한국어 조사 패턴 ────────────────────────────
const JOSA_RE =
  /^(.+?)(에서|에게|으로부터|으로|로부터|께서|이라도|이라고|이라는|이라|이랑|이며|이고|이나|까지|부터|보다|처럼|만큼|대로|마다|을|를|이|가|은|는|의|에|로|과|와|도|만|야|아)$/;

// 2단계용 랜덤 패턴: 문항 번호별 홀/짝 시작 오프셋 (새로고침마다 변경)
const stage2Flips = {};

function makeSegs(text, stage, itemNum = 0) {
  if (stage === 0) return [{ t: text, h: false }];
  if (stage === 3) return [{ t: text, h: true }];

  const tokens = text.trim().split(' ');
  const out = [];

  tokens.forEach((tok, i) => {
    if (i > 0) out.push({ t: ' ', h: false });

    if (stage === 1) {
      const m = tok.match(JOSA_RE);
      if (m && m[1].length >= 1) {
        out.push({ t: m[1], h: true });
        out.push({ t: m[2], h: false });
      } else {
        out.push({ t: tok, h: false });
      }
    } else {
      // stage 2: 어절 홀짝 랜덤 마스킹 (새로고침마다 패턴 변경)
      if (stage2Flips[itemNum] === undefined) stage2Flips[itemNum] = Math.round(Math.random());
      out.push({ t: tok, h: i % 2 === stage2Flips[itemNum] });
    }
  });

  return out;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMasked(text, stage, isRevealed, itemIdx = 0) {
  if (stage === 0 || isRevealed) return esc(text);
  if (stage === 3) {
    return text
      .trim()
      .split(' ')
      .map((tok, i) => (i > 0 ? ' ' : '') + `<span class="qz-fullmask">${esc(tok)}</span>`)
      .join('');
  }
  return makeSegs(text, stage, itemIdx)
    .map(seg => (seg.h ? `<span class="qz-masked">${esc(seg.t)}</span>` : esc(seg.t)))
    .join('');
}

// ── 상태 ────────────────────────────────────────
const KEY_STAGE = 'catechism-quiz-stage';
const KEY_STATUS = 'catechism-quiz-status';
const KEY_FONT = 'catechism-font-size-scale';

const STATUS_NEXT = { none: 'learning', learning: 'memorized', memorized: 'none' };
const STATUS_LABEL = { none: '−', learning: '학습중', memorized: '완료' };
const STATUS_CLASS = { none: 's-none', learning: 's-learning', memorized: 's-memorized' };

const GOOGLE_TTS_VOICE_PREFIX = 'google:';
const GOOGLE_TTS_VOICES = [
  { name: 'ko-KR-Neural2-A', label: 'Neural2-A (여성)' },
  { name: 'ko-KR-Neural2-B', label: 'Neural2-B (여성)' },
  { name: 'ko-KR-Neural2-C', label: 'Neural2-C (남성)' },
  { name: 'ko-KR-Neural2-D', label: 'Neural2-D (여성)' },
];

let quizStage = 0;
let rangeFrom = 1;
let rangeTo = 107;
const revealed = new Set();
let statuses = {};
let fontScale = 1.0;
let speechVoices = [];
let selectedSpeechVoice = null;
let selectedVoiceValue = '';
let selectedSpeechMode = 'question-answer';
let isSpeechPlaying = false;
let speechQueue = [];
let speechKeepAliveInterval = null;
let currentGoogleAudio = null;
let isRepeatOn = false;
let _repeatTimeout = null;
const speechSupportEnabled = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function filteredItems() {
  return catechism.filter(item => item.num >= rangeFrom && item.num <= rangeTo);
}

function loadState() {
  try {
    const s = Number.parseInt(localStorage.getItem(KEY_STAGE) || '0', 10);
    quizStage = [0, 1, 2, 3].includes(s) ? s : 0;

    const saved = JSON.parse(localStorage.getItem(KEY_STATUS) || '{}');
    statuses = typeof saved === 'object' && saved !== null ? saved : {};

    const f = Number.parseFloat(localStorage.getItem(KEY_FONT));
    if (Number.isFinite(f)) fontScale = Math.max(0.8, Math.min(1.5, f));
  } catch {
    /* ignore */
  }
}

function saveStatus() {
  try {
    localStorage.setItem(KEY_STATUS, JSON.stringify(statuses));
  } catch {
    /* ignore */
  }
}

// ── DOM 참조 ─────────────────────────────────────
const $list = document.getElementById('quiz-list');
const $progress = document.getElementById('progress');
const $revealAll = document.getElementById('reveal-all');
const $fontDisplay = document.getElementById('font-size-display');
const $btnReadAloud = document.getElementById('btn-quiz-read-aloud');
const $btnSpeechSettings = document.getElementById('btn-quiz-speech-settings');
const $speechSettingsPopup = document.getElementById('quiz-speech-settings-popup');
const $speechModeSelect = document.getElementById('quiz-speech-mode-select');
const $speechVoiceSelect = document.getElementById('quiz-speech-voice-select');
const dynStyle = document.createElement('style');
document.head.appendChild(dynStyle);

// ── 글자 크기 ────────────────────────────────────
function applyFont() {
  dynStyle.textContent = `
    .qz-question { font-size: ${1.08 * fontScale}em; }
    .qz-answer   { font-size: ${1.0 * fontScale}em; }
  `;
  if ($fontDisplay) $fontDisplay.textContent = `${Math.round(fontScale * 100)}%`;
  try {
    localStorage.setItem(KEY_FONT, fontScale);
  } catch {
    /* ignore */
  }
}

// ── 진행 현황 업데이트 ───────────────────────────
function updateProgress() {
  const items = filteredItems();
  const done = items.filter(item => statuses[item.num] === 'memorized').length;
  $progress.textContent = `완료 ${done} / ${items.length}`;
}

function populateSpeechVoiceOptions() {
  if (!$speechVoiceSelect) return;

  $speechVoiceSelect.innerHTML = '';

  GOOGLE_TTS_VOICES.forEach(voice => {
    const option = document.createElement('option');
    option.value = GOOGLE_TTS_VOICE_PREFIX + voice.name;
    option.textContent = voice.label;
    $speechVoiceSelect.appendChild(option);
  });

  if (speechSupportEnabled) {
    const sep = document.createElement('option');
    sep.disabled = true;
    sep.textContent = '─────────────';
    $speechVoiceSelect.appendChild(sep);

    const browserOption = document.createElement('option');
    browserOption.value = '';
    browserOption.textContent = '브라우저 기본';
    $speechVoiceSelect.appendChild(browserOption);
  }

  if (selectedVoiceValue) {
    $speechVoiceSelect.value = selectedVoiceValue;
  }
  if (!$speechVoiceSelect.value) {
    $speechVoiceSelect.value = GOOGLE_TTS_VOICE_PREFIX + GOOGLE_TTS_VOICES[0].name;
    selectedVoiceValue = $speechVoiceSelect.value;
  }
}

function closeSpeechSettings() {
  if (!$speechSettingsPopup) return;
  $speechSettingsPopup.classList.add('hidden');
  if ($btnSpeechSettings) $btnSpeechSettings.setAttribute('aria-expanded', 'false');
}

function updateSpeechButtonState() {
  if (!$btnReadAloud) return;

  const browserActive = speechSupportEnabled && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  const active = isSpeechPlaying || browserActive || !!currentGoogleAudio;
  $btnReadAloud.classList.toggle('is-playing', active);
  $btnReadAloud.textContent = active ? '⏹' : '🔊';
  $btnReadAloud.setAttribute('aria-label', active ? '정지' : '읽어주기');
  $btnReadAloud.setAttribute('aria-pressed', String(active));
  $btnReadAloud.disabled = false;
}

let _toastTimer = null;
function showToast(message, durationMs = 4000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), durationMs);
}

function stopSpeech() {
  clearTimeout(_repeatTimeout);
  _repeatTimeout = null;
  clearInterval(speechKeepAliveInterval);
  speechKeepAliveInterval = null;
  if (currentGoogleAudio) {
    currentGoogleAudio.pause();
    currentGoogleAudio.src = '';
    currentGoogleAudio = null;
  }
  if (speechSupportEnabled) window.speechSynthesis.cancel();
  speechQueue = [];
  isSpeechPlaying = false;
  updateSpeechButtonState();
}

function getSpeechText(item) {
  const parts = [`문 ${item.num}`];

  if (selectedSpeechMode === 'question-answer') {
    parts.push(item.q);
  }

  if (selectedSpeechMode === 'answer' || selectedSpeechMode === 'question-answer') {
    parts.push(item.a);
  }

  return parts.join('. ');
}

async function speakQueue() {
  clearInterval(speechKeepAliveInterval);
  speechKeepAliveInterval = null;

  if (!speechQueue.length) {
    if (isRepeatOn) {
      updateSpeechButtonState();
      _repeatTimeout = setTimeout(() => {
        _repeatTimeout = null;
        const items = filteredItems();
        speechQueue = items.map(getSpeechText).filter(Boolean);
        if (speechQueue.length) speakQueue();
        else {
          isSpeechPlaying = false;
          updateSpeechButtonState();
        }
      }, 2000);
      return;
    }
    isSpeechPlaying = false;
    updateSpeechButtonState();
    return;
  }

  const text = speechQueue.shift();
  const voiceValue = $speechVoiceSelect ? $speechVoiceSelect.value : '';

  if (voiceValue.startsWith(GOOGLE_TTS_VOICE_PREFIX)) {
    await speakQueueItemGoogle(text, voiceValue.slice(GOOGLE_TTS_VOICE_PREFIX.length));
  } else {
    speakQueueItemBrowser(text);
  }
}

async function speakQueueItemGoogle(text, voiceName) {
  const apiKey = window.GOOGLE_TTS_API_KEY;
  if (!apiKey) {
    speakQueueItemBrowser(text);
    return;
  }

  try {
    const response = await fetch(
      `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'ko-KR', name: voiceName },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.0, pitch: 0.0 },
        }),
      }
    );

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const { audioContent } = await response.json();
    const binary = atob(audioContent);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });
    const url = URL.createObjectURL(blob);

    const audio = new Audio(url);
    currentGoogleAudio = audio;
    updateSpeechButtonState();

    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentGoogleAudio = null;
      speakQueue();
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentGoogleAudio = null;
      isSpeechPlaying = false;
      updateSpeechButtonState();
    };

    await audio.play();
  } catch (error) {
    console.warn('[Google TTS] 실패, 브라우저 TTS로 대체:', error.message);
    currentGoogleAudio = null;
    const isQuota = /429|403/.test(error.message);
    const msg = isQuota
      ? 'Google 음성 사용량 초과\n브라우저 기본 음성으로 계속 읽습니다'
      : 'Google 음성 연결 실패\n브라우저 기본 음성으로 계속 읽습니다';
    showToast(msg);
    speakQueueItemBrowser(text);
  }
}

function splitSentences(text) {
  return text.replace(/([.?!])\s+/g, '$1\n').split('\n').map(s => s.trim()).filter(Boolean);
}

function speakQueueItemBrowser(text) {
  if (!speechSupportEnabled) {
    isSpeechPlaying = false;
    updateSpeechButtonState();
    return;
  }

  const chunks = splitSentences(text);
  if (!chunks.length) { speakQueue(); return; }

  let chunkIdx = 0;

  function speakNextChunk() {
    if (chunkIdx >= chunks.length) { speakQueue(); return; }
    const utterance = new SpeechSynthesisUtterance(chunks[chunkIdx++]);
    utterance.lang = selectedSpeechVoice?.lang || 'ko-KR';
    utterance.voice = selectedSpeechVoice || null;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    utterance.onend = speakNextChunk;
    utterance.onerror = () => {
      isSpeechPlaying = false;
      updateSpeechButtonState();
    };
    window.speechSynthesis.speak(utterance);
  }

  speakNextChunk();
}

function readFilteredItems() {
  const voiceValue = $speechVoiceSelect ? $speechVoiceSelect.value : '';
  const usingGoogle = voiceValue.startsWith(GOOGLE_TTS_VOICE_PREFIX);

  if (!usingGoogle && !speechSupportEnabled) {
    window.alert('이 브라우저는 읽어주기 기능을 지원하지 않습니다.');
    return;
  }

  const browserBusy = speechSupportEnabled && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  if (isSpeechPlaying || !!currentGoogleAudio || browserBusy) {
    stopSpeech();
    return;
  }

  const items = filteredItems();
  speechQueue = items.map(getSpeechText).filter(Boolean);
  if (!speechQueue.length) return;

  isSpeechPlaying = true;
  updateSpeechButtonState();
  speakQueue();
}

// ── 전체 렌더링 ──────────────────────────────────
function isAllRevealed() {
  const items = filteredItems();
  return items.length > 0 && items.every(item => revealed.has(item.num));
}

function updateRevealBtn() {
  const allRev = isAllRevealed();
  $revealAll.textContent = allRev ? '전체 가리기' : '전체 공개';
  $revealAll.classList.toggle('active', allRev);
}

function renderAll() {
  updateProgress();

  const staged = quizStage > 0;
  $revealAll.classList.toggle('hidden', !staged);
  if (staged) updateRevealBtn();

  $list.innerHTML = filteredItems()
    .map((item, idx) => {
      const isRev = revealed.has(item.num);
      const st = statuses[item.num] || 'none';
      const ansHtml = renderMasked(item.a, quizStage, isRev, item.num);
      const clickHint = staged ? ' qz-clickable' : '';
      const revLabel = isRev ? '가리기' : '보기';

      return `<li class="qz-item" data-num="${item.num}">
  <div class="qz-item-head">
    <span class="qz-num">${item.num}</span>
    ${staged ? `<button class="qz-reveal-btn" data-rev="${item.num}" type="button" aria-label="답 ${revLabel}">${revLabel}</button>` : ''}
  </div>
  <p class="qz-question">${esc(item.q)}</p>
  <div class="qz-answer-box">
    <span class="qz-a-label">답</span>
    <p class="qz-answer${clickHint}" data-rev="${item.num}">${ansHtml}</p>
  </div>
  <div class="qz-footer">
    <button class="qz-status-btn ${STATUS_CLASS[st]}" data-status="${item.num}" type="button">${STATUS_LABEL[st]}</button>
  </div>
</li>`;
    })
    .join('');
}

// ── 이벤트 위임 ──────────────────────────────────
$list.addEventListener('click', e => {
  const revEl = e.target.closest('[data-rev]');
  const stEl = e.target.closest('[data-status]');

  if (revEl && quizStage > 0) {
    const num = Number.parseInt(revEl.dataset.rev, 10);
    if (revealed.has(num)) {
      revealed.delete(num);
      delete stage2Flips[num];
    } else {
      revealed.add(num);
    }
    renderAll();
    return;
  }

  if (stEl) {
    const num = Number.parseInt(stEl.dataset.status, 10);
    const cur = statuses[num] || 'none';
    statuses[num] = STATUS_NEXT[cur];
    saveStatus();
    renderAll();
  }
});

document.querySelectorAll('.stage-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    quizStage = Number.parseInt(btn.dataset.s, 10);
    revealed.clear();
    if (quizStage === 2) Object.keys(stage2Flips).forEach(k => delete stage2Flips[k]);
    try {
      localStorage.setItem(KEY_STAGE, quizStage);
    } catch {
      /* ignore */
    }
    document
      .querySelectorAll('.stage-btn')
      .forEach(b => b.classList.toggle('on', Number.parseInt(b.dataset.s, 10) === quizStage));
    renderAll();
  });
});

$revealAll.addEventListener('click', () => {
  if (isAllRevealed()) {
    filteredItems().forEach(item => revealed.delete(item.num));
  } else {
    filteredItems().forEach(item => revealed.add(item.num));
  }
  renderAll();
});

const $rangeFrom = document.getElementById('range-from');
const $rangeTo = document.getElementById('range-to');
const $rangeFromVal = document.getElementById('range-from-val');
const $rangeToVal = document.getElementById('range-to-val');
const $rangeFill = document.getElementById('range-fill');
const $inpFrom = document.getElementById('inp-from');
const $inpTo = document.getElementById('inp-to');

const RANGE_MIN = 1;
const RANGE_MAX = 107;

function updateFill() {
  const f = Number.parseInt($rangeFrom.value, 10);
  const t = Number.parseInt($rangeTo.value, 10);
  const span = RANGE_MAX - RANGE_MIN;
  const leftPct = ((f - RANGE_MIN) / span) * 100;
  const rightPct = ((t - RANGE_MIN) / span) * 100;
  $rangeFill.style.left = leftPct + '%';
  $rangeFill.style.width = rightPct - leftPct + '%';
  $inpFrom.value = f;
  $inpTo.value = t;
}

function applyRange() {
  rangeFrom = Number.parseInt($rangeFrom.value, 10);
  rangeTo = Number.parseInt($rangeTo.value, 10);
  revealed.clear();
  renderAll();
}

$rangeFrom.addEventListener('input', () => {
  if (Number.parseInt($rangeFrom.value, 10) > Number.parseInt($rangeTo.value, 10)) {
    $rangeTo.value = $rangeFrom.value;
  }
  updateFill();
  applyRange();
});

$rangeTo.addEventListener('input', () => {
  if (Number.parseInt($rangeTo.value, 10) < Number.parseInt($rangeFrom.value, 10)) {
    $rangeFrom.value = $rangeTo.value;
  }
  updateFill();
  applyRange();
});

function applyInpFrom() {
  let v = Math.max(RANGE_MIN, Math.min(RANGE_MAX, Number.parseInt($inpFrom.value, 10) || RANGE_MIN));
  if (v > Number.parseInt($rangeTo.value, 10)) v = Number.parseInt($rangeTo.value, 10);
  $rangeFrom.value = v;
  updateFill();
  applyRange();
}

function applyInpTo() {
  let v = Math.max(RANGE_MIN, Math.min(RANGE_MAX, Number.parseInt($inpTo.value, 10) || RANGE_MAX));
  if (v < Number.parseInt($rangeFrom.value, 10)) v = Number.parseInt($rangeFrom.value, 10);
  $rangeTo.value = v;
  updateFill();
  applyRange();
}

$inpFrom.addEventListener('blur', applyInpFrom);
$inpFrom.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $inpFrom.blur();
  }
});

$inpTo.addEventListener('blur', applyInpTo);
$inpTo.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $inpTo.blur();
  }
});

// 터치 시작 시 더 가까운 핸들을 앞으로 올려서 조작 가능하게 함
document.querySelector('.dual-range-track-wrap').addEventListener('pointerdown', e => {
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const span = RANGE_MAX - RANGE_MIN;
  const fromPct = (Number.parseInt($rangeFrom.value, 10) - RANGE_MIN) / span;
  const toPct = (Number.parseInt($rangeTo.value, 10) - RANGE_MIN) / span;
  const fromIsCloser = Math.abs(pct - fromPct) <= Math.abs(pct - toPct);
  if (fromIsCloser) {
    $rangeFrom.style.zIndex = 5;
    $rangeTo.style.zIndex = 4;
    $rangeFrom.classList.add('is-active');
    $rangeTo.classList.remove('is-active');
    $rangeFromVal.classList.add('is-active');
    $rangeToVal.classList.remove('is-active');
  } else {
    $rangeTo.style.zIndex = 5;
    $rangeFrom.style.zIndex = 4;
    $rangeTo.classList.add('is-active');
    $rangeFrom.classList.remove('is-active');
    $rangeToVal.classList.add('is-active');
    $rangeFromVal.classList.remove('is-active');
  }
});

document.addEventListener('pointerup', () => {
  $rangeFrom.classList.remove('is-active');
  $rangeTo.classList.remove('is-active');
  $rangeFromVal.classList.remove('is-active');
  $rangeToVal.classList.remove('is-active');
});

updateFill();

document.getElementById('btn-font-decrease').addEventListener('click', () => {
  fontScale = Math.max(0.8, Math.round((fontScale - 0.1) * 10) / 10);
  applyFont();
});
document.getElementById('btn-font-increase').addEventListener('click', () => {
  fontScale = Math.min(1.5, Math.round((fontScale + 0.1) * 10) / 10);
  applyFont();
});

// ── 헤더 메뉴 ────────────────────────────────────
const menuBtn = document.getElementById('menu-btn');
const menuPopup = document.getElementById('menu-popup');

function closeMenu() {
  menuPopup.classList.add('hidden');
  menuBtn.classList.remove('open');
  menuBtn.setAttribute('aria-expanded', 'false');
}

menuBtn.addEventListener('click', e => {
  e.stopPropagation();
  const willOpen = menuPopup.classList.contains('hidden');
  if (willOpen) {
    const rect = menuBtn.getBoundingClientRect();
    menuPopup.style.top = rect.bottom + 8 + 'px';
    menuPopup.style.right = window.innerWidth - rect.right + 'px';
    menuPopup.classList.remove('hidden');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
  } else {
    closeMenu();
  }
});

document.addEventListener('click', closeMenu);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeMenu();
});

if ($btnReadAloud) {
  $btnReadAloud.addEventListener('click', readFilteredItems);
}

const $btnRepeat = document.getElementById('btn-quiz-repeat');
if ($btnRepeat) {
  $btnRepeat.addEventListener('click', () => {
    isRepeatOn = !isRepeatOn;
    $btnRepeat.classList.toggle('is-repeat-on', isRepeatOn);
    $btnRepeat.setAttribute('aria-pressed', String(isRepeatOn));
    $btnRepeat.title = isRepeatOn ? '반복 재생 켜짐' : '반복 재생';
  });
}

if ($btnSpeechSettings && $speechSettingsPopup) {
  $btnSpeechSettings.addEventListener('click', e => {
    e.stopPropagation();
    const isOpen = !$speechSettingsPopup.classList.contains('hidden');
    if (isOpen) {
      closeSpeechSettings();
    } else {
      $speechSettingsPopup.classList.remove('hidden');
      $btnSpeechSettings.setAttribute('aria-expanded', 'true');
    }
  });
  $speechSettingsPopup.addEventListener('click', e => e.stopPropagation());
  document.addEventListener('click', closeSpeechSettings);
}

if ($speechVoiceSelect) {
  $speechVoiceSelect.addEventListener('change', () => {
    selectedVoiceValue = $speechVoiceSelect.value;
    selectedSpeechVoice = speechVoices.find(voice => voice.name === $speechVoiceSelect.value) || null;
  });
}

if ($speechModeSelect) {
  $speechModeSelect.addEventListener('change', event => {
    selectedSpeechMode = event.target.value;
  });
}

populateSpeechVoiceOptions();

// ── 초기화 ───────────────────────────────────────
loadState();
document
  .querySelectorAll('.stage-btn')
  .forEach(b => b.classList.toggle('on', Number.parseInt(b.dataset.s, 10) === quizStage));
applyFont();
renderAll();
