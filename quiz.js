// ── 한국어 조사 패턴 ────────────────────────────
const JOSA_RE =
  /^(.+?)(에서|에게|으로부터|으로|로부터|께서|이라도|이라고|이라는|이라|이랑|이며|이고|이나|까지|부터|보다|처럼|만큼|대로|마다|을|를|이|가|은|는|의|에|로|과|와|도|만|야|아)$/;

function makeSegs(text, stage) {
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
      // stage 2: 2어절 단위 번갈아 마스킹
      out.push({ t: tok, h: Math.floor(i / 2) % 2 === 0 });
    }
  });

  return out;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMasked(text, stage, isRevealed) {
  if (stage === 0 || isRevealed) return esc(text);
  if (stage === 3) return `<span class="qz-fullmask">${esc(text)}</span>`;
  return makeSegs(text, stage)
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

let quizStage = 0;
let rangeFrom = 1;
let rangeTo = 107;
const revealed = new Set();
let statuses = {};
let fontScale = 1.0;

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
const dynStyle = document.createElement('style');
document.head.appendChild(dynStyle);

// ── 글자 크기 ────────────────────────────────────
function applyFont() {
  dynStyle.textContent = `
    .qz-question { font-size: ${1.08 * fontScale}em; }
    .qz-answer   { font-size: ${1.0  * fontScale}em; }
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
    .map(item => {
      const isRev = revealed.has(item.num);
      const st = statuses[item.num] || 'none';
      const ansHtml = renderMasked(item.a, quizStage, isRev);
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
    if (revealed.has(num)) revealed.delete(num);
    else revealed.add(num);
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
    try {
      localStorage.setItem(KEY_STAGE, quizStage);
    } catch {
      /* ignore */
    }
    document.querySelectorAll('.stage-btn').forEach(b =>
      b.classList.toggle('on', Number.parseInt(b.dataset.s, 10) === quizStage),
    );
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

const $rangeFrom    = document.getElementById('range-from');
const $rangeTo      = document.getElementById('range-to');
const $rangeFromVal = document.getElementById('range-from-val');
const $rangeToVal   = document.getElementById('range-to-val');
const $rangeFill    = document.getElementById('range-fill');

const RANGE_MIN = 1;
const RANGE_MAX = 107;

function updateFill() {
  const f = Number.parseInt($rangeFrom.value, 10);
  const t = Number.parseInt($rangeTo.value, 10);
  const span = RANGE_MAX - RANGE_MIN;
  const leftPct  = ((f - RANGE_MIN) / span) * 100;
  const rightPct = ((t - RANGE_MIN) / span) * 100;
  $rangeFill.style.left  = leftPct + '%';
  $rangeFill.style.width = (rightPct - leftPct) + '%';
  $rangeFromVal.textContent = f;
  $rangeToVal.textContent   = t;
}

function applyRange() {
  rangeFrom = Number.parseInt($rangeFrom.value, 10);
  rangeTo   = Number.parseInt($rangeTo.value, 10);
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

// 터치 시작 시 더 가까운 핸들을 앞으로 올려서 조작 가능하게 함
document.querySelector('.dual-range-track-wrap').addEventListener('pointerdown', (e) => {
  const rect = e.currentTarget.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  const span = RANGE_MAX - RANGE_MIN;
  const fromPct = (Number.parseInt($rangeFrom.value, 10) - RANGE_MIN) / span;
  const toPct   = (Number.parseInt($rangeTo.value,   10) - RANGE_MIN) / span;
  const fromIsCloser = Math.abs(pct - fromPct) <= Math.abs(pct - toPct);
  if (fromIsCloser) {
    $rangeFrom.style.zIndex = 5;
    $rangeTo.style.zIndex   = 4;
    $rangeFrom.classList.add('is-active');
    $rangeTo.classList.remove('is-active');
    $rangeFromVal.classList.add('is-active');
    $rangeToVal.classList.remove('is-active');
  } else {
    $rangeTo.style.zIndex   = 5;
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
    menuPopup.style.top = (rect.bottom + 8) + 'px';
    menuPopup.style.right = (window.innerWidth - rect.right) + 'px';
    menuPopup.classList.remove('hidden');
    menuBtn.classList.add('open');
    menuBtn.setAttribute('aria-expanded', 'true');
  } else {
    closeMenu();
  }
});

document.addEventListener('click', closeMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

// ── 초기화 ───────────────────────────────────────
loadState();
document.querySelectorAll('.stage-btn').forEach(b =>
  b.classList.toggle('on', Number.parseInt(b.dataset.s, 10) === quizStage),
);
applyFont();
renderAll();
