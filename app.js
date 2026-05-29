const listView = document.getElementById('list-view');
const detailView = document.getElementById('detail-view');
const detailToolbar = document.getElementById('detail-toolbar');
const pageBody = document.body;
const cardsEl = document.getElementById('cards-container');
const searchEl = document.getElementById('search');
const dNum = document.getElementById('d-num');
const dQuestion = document.getElementById('d-question');
const dAnswer = document.getElementById('d-answer');
const dVerses = document.getElementById('d-verses');
const btnBack = document.getElementById('btn-back');
const btnPrev = document.getElementById('btn-prev');
const btnNext = document.getElementById('btn-next');
const navCounter = document.getElementById('nav-counter');
const btnPrevBottom = document.getElementById('btn-prev-bottom');
const btnNextBottom = document.getElementById('btn-next-bottom');
const navCounterBottom = document.getElementById('nav-counter-bottom');
const fontSizeDisplay = document.getElementById('font-size-display');
// Add a style element to the head for dynamic font sizing
const styleElement = document.createElement('style');
document.head.appendChild(styleElement);

const FONT_SIZE_STORAGE_KEY = 'catechism-font-size-scale';
const DEFAULT_FONT_SIZE_SCALE = 1.0;
let currentFontSizeScale = loadStoredFontSizeScale();

let currentIndex = null;

function loadStoredFontSizeScale() {
  try {
    const storedScale = Number.parseFloat(localStorage.getItem(FONT_SIZE_STORAGE_KEY));

    if (!Number.isFinite(storedScale)) {
      return DEFAULT_FONT_SIZE_SCALE;
    }

    return Math.max(0.8, Math.min(1.5, storedScale));
  } catch (error) {
    return DEFAULT_FONT_SIZE_SCALE;
  }
}

function persistFontSizeScale() {
  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, currentFontSizeScale);
  } catch (error) {
    // Ignore storage failures and keep the page usable.
  }
}

function getStablePageUrl() {
  const { pathname, search } = location;

  if (pathname.endsWith('/') || /\.html$/i.test(pathname)) {
    return `${pathname}${search}`;
  }

  return `${pathname}/${search}`;
}

function escapeHtml(text = '') {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function looksBroken(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return true;
  }

  const questionMarks = (text.match(/\?/g) || []).length;
  const replacementChars = (text.match(/[�]/g) || []).length;
  const weirdSeparators = (text.match(/[-]/g) || []).length;
  const hangulCount = (text.match(/[가-힣]/g) || []).length;

  return questionMarks >= 2 || replacementChars > 0 || weirdSeparators > 0 || hangulCount === 0;
}

function safeQuestion(item) {
  return looksBroken(item.q) ? '텍스트 복원 필요' : item.q;
}

function safeAnswer(item) {
  return looksBroken(item.a) ? '이 문항의 답은 아직 복원되지 않았습니다.' : item.a;
}

function safeKeywords(item) {
  return Array.isArray(item.k) ? item.k.filter(keyword => !looksBroken(keyword)) : [];
}

function normalizeSearchText(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function matchesQuery(item, query) {
  const fields = [safeQuestion(item), safeAnswer(item), ...safeKeywords(item)];

  return fields.some(field => normalizeSearchText(field).includes(query));
}

function renderList(query = '') {
  const normalizedQuery = normalizeSearchText(query);
  const filtered = normalizedQuery
    ? catechism.filter(
        item => matchesQuery(item, normalizedQuery) || String(item.num) === normalizedQuery.replace(/^문\s*/, ''),
      )
    : catechism;

  if (filtered.length === 0) {
    cardsEl.innerHTML = '<p class="no-results">검색 결과가 없습니다.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  filtered.forEach(item => {
    const preview = safeQuestion(item);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card';
    btn.dataset.num = item.num;
    btn.setAttribute('aria-label', `문 ${item.num}: ${preview}`);
    btn.innerHTML = `
      <div class="num-badge">문 ${item.num}</div>
      <div class="q-preview">${escapeHtml(preview)}</div>
    `;
    fragment.appendChild(btn);
  });

  cardsEl.innerHTML = '';
  cardsEl.appendChild(fragment);
}

function renderVerses(item) {
  const verses = Array.isArray(item.verses) ? item.verses : [];
  const hasText = verses.some(v => !looksBroken(v.text));

  if (hasText) {
    const fragment = document.createDocumentFragment();

    verses.forEach(verse => {
      if (looksBroken(verse.text)) {
        return;
      }

      const el = document.createElement('div');
      el.className = 'verse-item';
      el.innerHTML = `
        <div class="verse-ref">${escapeHtml(verse.ref)}</div>
        <div class="verse-text">${escapeHtml(verse.text)}</div>
      `;
      fragment.appendChild(el);
    });

    dVerses.innerHTML = '';
    dVerses.appendChild(fragment);
    return;
  }

  if (typeof item.refs === 'string' && item.refs.trim()) {
    dVerses.innerHTML = '';

    const el = document.createElement('div');
    el.className = 'verse-item';
    el.innerHTML = `<div class="verse-ref">${escapeHtml(item.refs)}</div>`;

    dVerses.appendChild(el);
    return;
  }

  dVerses.innerHTML = '';
}

function showDetail(index) {
  currentIndex = index;
  const item = catechism[index];

  dNum.textContent = `문 ${item.num}`;
  dQuestion.textContent = safeQuestion(item);
  dAnswer.textContent = safeAnswer(item);
  updateGlobalFontSizeCss(); // Apply font size to question and answer

  renderVerses(item);

  btnPrev.disabled = index === 0;
  btnNext.disabled = index === catechism.length - 1;
  navCounter.textContent = `${index + 1} / ${catechism.length}`;
  btnPrevBottom.disabled = index === 0;
  btnNextBottom.disabled = index === catechism.length - 1;
  navCounterBottom.textContent = `${index + 1} / ${catechism.length}`;

  renderQuiz(item);

  listView.classList.add('hidden');
  detailView.classList.remove('hidden');
  if (pageBody) {
    pageBody.classList.add('detail-mode');
  }
  if (detailToolbar) {
    detailToolbar.classList.remove('hidden');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });

  history.pushState({ index }, '', `#q${item.num}`);
}

function showList() {
  currentIndex = null;
  detailView.classList.add('hidden');
  listView.classList.remove('hidden');
  if (pageBody) {
    pageBody.classList.remove('detail-mode');
  }
  if (detailToolbar) {
    detailToolbar.classList.add('hidden');
  }
  history.pushState(null, '', getStablePageUrl());
}

function handleRoute() {
  const hash = location.hash;

  if (hash.startsWith('#q')) {
    const num = Number.parseInt(hash.slice(2), 10);
    const index = catechism.findIndex(item => item.num === num);

    if (index >= 0) {
      showDetail(index);
      return;
    }
  }

  showList();
}

function getQuizRanges(answer, keywords = []) {
  const uniqueKeywords = [
    ...new Set(
      keywords
        .filter(keyword => typeof keyword === 'string')
        .map(keyword => keyword.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => b.length - a.length);

  const ranges = [];

  uniqueKeywords.forEach(keyword => {
    let fromIndex = 0;

    while (fromIndex < answer.length) {
      const start = answer.indexOf(keyword, fromIndex);
      if (start === -1) {
        break;
      }

      const end = start + keyword.length;
      const overlaps = ranges.some(range => !(end <= range.start || start >= range.end));

      if (!overlaps) {
        ranges.push({ start, end, keyword });
      }

      fromIndex = end;
    }
  });

  return ranges.sort((a, b) => a.start - b.start);
}

function buildBlankHtml(text) {
  return text
    .split(/(\s+)/)
    .map(part => {
      if (!part) {
        return '';
      }

      if (/^\s+$/.test(part)) {
        return part;
      }

      // 한글은 전각 밑줄(＿), 그 외 문자는 반각 밑줄(_)을 사용하여 실제 텍스트와 너비를 맞춤
      const underscores = part
        .split('')
        .map(char => {
          return /[가-힣]/.test(char) ? '＿' : '_';
        })
        .join('');

      return (
        `<span class="blank" data-word="${escapeHtml(part)}">` +
        `<span class="blank-hole">${underscores}</span>` +
        `<span class="blank-answer">${escapeHtml(part)}</span>` +
        '</span>'
      );
    })
    .join('');
}

function buildQuizHtml(answer, keywords = []) {
  const ranges = getQuizRanges(answer, keywords);

  if (ranges.length === 0) {
    return { html: escapeHtml(answer), blankCount: 0 };
  }

  let html = '';
  let cursor = 0;
  let blankCount = 0;

  ranges.forEach(range => {
    html += escapeHtml(answer.slice(cursor, range.start));
    html += buildBlankHtml(range.keyword);
    blankCount += range.keyword.split(/\s+/).filter(Boolean).length;
    cursor = range.end;
  });

  html += escapeHtml(answer.slice(cursor));

  return { html, blankCount };
}

const FONT_SIZE_STEP = 0.1;
const MIN_FONT_SIZE_SCALE = 0.8;
const MAX_FONT_SIZE_SCALE = 1.5;

function adjustFontSize(delta) {
  currentFontSizeScale = Math.round((currentFontSizeScale + delta) * 10) / 10; // 소수점 1자리 반올림
  currentFontSizeScale = Math.max(MIN_FONT_SIZE_SCALE, Math.min(MAX_FONT_SIZE_SCALE, currentFontSizeScale));
  updateGlobalFontSizeCss();
}

function updateGlobalFontSizeCss() {
  // Define base font sizes (em units) and scale them
  const questionBaseSize = 1.1;
  const answerBaseSize = 1.0;
  const verseRefBaseSize = 0.9;
  const verseTextBaseSize = 1.0;
  const quizQuestionBaseSize = 1.1;
  const quizAnswerBaseSize = 1.0;

  styleElement.textContent = `
    #d-question { font-size: ${questionBaseSize * currentFontSizeScale}em; }
    #d-answer { font-size: ${answerBaseSize * currentFontSizeScale}em; }
    .verse-item .verse-ref { font-size: ${verseRefBaseSize * currentFontSizeScale}em; }
    .verse-item .verse-text { font-size: ${verseTextBaseSize * currentFontSizeScale}em; }
    .quiz-q { font-size: ${quizQuestionBaseSize * currentFontSizeScale}em; }
    .quiz-a { font-size: ${quizAnswerBaseSize * currentFontSizeScale}em; }
    .font-controls {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-right: 12px;
    }
    .font-btn {
      padding: 2px 8px;
      min-width: 36px;
      font-weight: bold;
    }
    .font-display {
      font-size: 0.85rem;
      min-width: 42px;
      text-align: center;
      opacity: 0.7;
    }
  `;
  localStorage.setItem(FONT_SIZE_STORAGE_KEY, currentFontSizeScale);
  console.log('Font size updated to:', currentFontSizeScale); // Debugging line
  if (fontSizeDisplay) {
    fontSizeDisplay.textContent = `${Math.round(currentFontSizeScale * 100)}%`;
  }
}

function renderQuiz(item) {
  const box = document.getElementById('d-quiz');
  const answer = safeAnswer(item);
  const keywords = safeKeywords(item);
  const quiz = looksBroken(item.a)
    ? { html: '이 문항은 텍스트 복원이 끝난 뒤 퀴즈를 사용할 수 있습니다.', blankCount: 0 }
    : buildQuizHtml(answer, keywords);

  box.innerHTML = `
    <div class="quiz-label">빈칸 채우기 퀴즈</div>
    <p class="quiz-q">${escapeHtml(safeQuestion(item))}</p> <!-- Font size applied via CSS -->
    <p class="quiz-a">${quiz.html}</p>
    <div class="quiz-actions">
      <button class="quiz-btn" id="quiz-reveal" type="button">정답 보기</button>
      <button class="quiz-btn outline" id="quiz-reset" type="button">다시 가리기</button>
    </div>
  `;

  const blanks = box.querySelectorAll('.blank');
  const btnReveal = document.getElementById('quiz-reveal');
  const btnReset = document.getElementById('quiz-reset');

  if (quiz.blankCount === 0) {
    btnReveal.disabled = true;
    btnReset.disabled = true;
    return;
  }

  btnReveal.addEventListener('click', () => {
    blanks.forEach(el => el.classList.add('revealed'));
    btnReveal.disabled = true;
  });

  btnReset.addEventListener('click', () => {
    blanks.forEach(el => el.classList.remove('revealed'));
    btnReveal.disabled = false;
  });
}

function adjustFontSize(delta) {
  currentFontSizeScale = Math.round((currentFontSizeScale + delta) * 10) / 10;
  currentFontSizeScale = Math.max(MIN_FONT_SIZE_SCALE, Math.min(MAX_FONT_SIZE_SCALE, currentFontSizeScale));
  updateGlobalFontSizeCss();
}

function updateGlobalFontSizeCss() {
  const questionBaseSize = 1.1;
  const answerBaseSize = 1.0;
  const verseRefBaseSize = 0.9;
  const verseTextBaseSize = 1.0;
  const quizQuestionBaseSize = 1.1;
  const quizAnswerBaseSize = 1.0;

  styleElement.textContent = `
    #d-question { font-size: ${questionBaseSize * currentFontSizeScale}em; }
    #d-answer { font-size: ${answerBaseSize * currentFontSizeScale}em; }
    .verse-item .verse-ref { font-size: ${verseRefBaseSize * currentFontSizeScale}em; }
    .verse-item .verse-text { font-size: ${verseTextBaseSize * currentFontSizeScale}em; }
    .quiz-q { font-size: ${quizQuestionBaseSize * currentFontSizeScale}em; }
    .quiz-a { font-size: ${quizAnswerBaseSize * currentFontSizeScale}em; }
  `;

  persistFontSizeScale();

  if (fontSizeDisplay) {
    fontSizeDisplay.textContent = `${Math.round(currentFontSizeScale * 100)}%`;
  }
}

cardsEl.addEventListener('click', event => {
  const card = event.target.closest('.card');
  if (!card) {
    return;
  }

  const num = Number.parseInt(card.dataset.num, 10);
  const index = catechism.findIndex(item => item.num === num);

  if (index >= 0) {
    showDetail(index);
  }
});

btnBack.addEventListener('click', showList);
btnPrev.addEventListener('click', () => {
  if (currentIndex > 0) showDetail(currentIndex - 1);
});
btnNext.addEventListener('click', () => {
  if (currentIndex < catechism.length - 1) showDetail(currentIndex + 1);
});
btnPrevBottom.addEventListener('click', () => {
  if (currentIndex > 0) showDetail(currentIndex - 1);
});
btnNextBottom.addEventListener('click', () => {
  if (currentIndex < catechism.length - 1) showDetail(currentIndex + 1);
});

searchEl.addEventListener('input', event => renderList(event.target.value));
searchEl.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    searchEl.value = '';
    renderList();
  }
});

document.addEventListener('keydown', event => {
  if (currentIndex === null) {
    return;
  }

  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    event.preventDefault();
    if (currentIndex < catechism.length - 1) {
      showDetail(currentIndex + 1);
    }
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (currentIndex > 0) {
      showDetail(currentIndex - 1);
    }
  } else if (event.key === 'Escape') {
    showList();
  }
});

const btnFontDecrease = document.getElementById('btn-font-decrease');
const btnFontIncrease = document.getElementById('btn-font-increase');
btnFontDecrease.addEventListener('click', () => adjustFontSize(-FONT_SIZE_STEP));
btnFontIncrease.addEventListener('click', () => adjustFontSize(FONT_SIZE_STEP));
window.addEventListener('popstate', handleRoute);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Service worker registration failed:', error);
    });
  });
}

updateGlobalFontSizeCss();
renderList();
handleRoute();
