/* ── DOM refs ── */
const listView    = document.getElementById('list-view');
const detailView  = document.getElementById('detail-view');
const cardsEl     = document.getElementById('cards-container');
const searchEl    = document.getElementById('search');
const dNum        = document.getElementById('d-num');
const dQuestion   = document.getElementById('d-question');
const dAnswer     = document.getElementById('d-answer');
const dVerses     = document.getElementById('d-verses');
const btnBack     = document.getElementById('btn-back');
const btnPrev     = document.getElementById('btn-prev');
const btnNext     = document.getElementById('btn-next');
const navCounter  = document.getElementById('nav-counter');

let currentIndex = null;

function getStablePageUrl() {
  const { pathname, search } = location;

  if (pathname.endsWith('/') || /\.html$/i.test(pathname)) {
    return `${pathname}${search}`;
  }

  return `${pathname}/${search}`;
}

/* ── 리스트 렌더링 ── */
function renderList(query = '') {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? catechism.filter(c =>
        c.q.includes(q) ||
        c.a.includes(q) ||
        c.k?.some(keyword => keyword.includes(q)) ||
        String(c.num) === q.replace(/^문/, '')
      )
    : catechism;

  if (filtered.length === 0) {
    cardsEl.innerHTML = '<p class="no-results">검색 결과가 없습니다.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'card';
    btn.dataset.num = item.num;
    btn.setAttribute('aria-label', `문${item.num}: ${item.q}`);
    btn.innerHTML = `
      <div class="num-badge">문${item.num}</div>
      <div class="q-preview">${item.q}</div>
    `;
    fragment.appendChild(btn);
  });
  cardsEl.innerHTML = '';
  cardsEl.appendChild(fragment);
}

/* ── 상세 렌더링 ── */
function showDetail(index) {
  currentIndex = index;
  const item = catechism[index];

  dNum.textContent      = '문' + item.num;
  dQuestion.textContent = item.q;
  dAnswer.textContent   = item.a;

  const fragment = document.createDocumentFragment();
  item.verses.forEach(v => {
    const el = document.createElement('div');
    el.className = 'verse-item';
    el.innerHTML = `
      <div class="verse-ref">📖 ${v.ref}</div>
      <div class="verse-text">${v.text}</div>
    `;
    fragment.appendChild(el);
  });
  dVerses.innerHTML = '';
  dVerses.appendChild(fragment);

  btnPrev.disabled = index === 0;
  btnNext.disabled = index === catechism.length - 1;
  navCounter.textContent = `${index + 1} / ${catechism.length}`;

  renderQuiz(item);

  listView.classList.add('hidden');
  detailView.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  history.pushState({ index }, '', `#q${item.num}`);
}

function showList() {
  currentIndex = null;
  detailView.classList.add('hidden');
  listView.classList.remove('hidden');
  history.pushState(null, '', getStablePageUrl());
}

/* ── 라우팅 ── */
function handleRoute() {
  const hash = location.hash;
  if (hash.startsWith('#q')) {
    const num = parseInt(hash.slice(2), 10);
    const idx = catechism.findIndex(c => c.num === num);
    if (idx >= 0) { showDetail(idx); return; }
  }
  showList();
}

window.addEventListener('popstate', handleRoute);

/* ── 이벤트 ── */
cardsEl.addEventListener('click', e => {
  const card = e.target.closest('.card');
  if (!card) return;
  const num = parseInt(card.dataset.num, 10);
  const idx = catechism.findIndex(c => c.num === num);
  if (idx >= 0) showDetail(idx);
});

btnBack.addEventListener('click', showList);
btnPrev.addEventListener('click', () => { if (currentIndex > 0) showDetail(currentIndex - 1); });
btnNext.addEventListener('click', () => { if (currentIndex < catechism.length - 1) showDetail(currentIndex + 1); });

searchEl.addEventListener('input', e => renderList(e.target.value));
searchEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchEl.value = ''; renderList(); }
});

document.addEventListener('keydown', e => {
  if (currentIndex === null) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentIndex < catechism.length - 1) showDetail(currentIndex + 1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentIndex > 0) showDetail(currentIndex - 1);
  } else if (e.key === 'Escape') {
    showList();
  }
});

/* ── 퀴즈 ── */

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getQuizRanges(answer, keywords = []) {
  const uniqueKeywords = [...new Set(
    keywords
      .filter(keyword => typeof keyword === 'string')
      .map(keyword => keyword.trim())
      .filter(Boolean)
  )].sort((a, b) => b.length - a.length);

  const ranges = [];

  uniqueKeywords.forEach(keyword => {
    let fromIndex = 0;

    while (fromIndex < answer.length) {
      const start = answer.indexOf(keyword, fromIndex);
      if (start === -1) break;

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
      if (!part) return '';
      if (/^\s+$/.test(part)) return part;

      return `<span class="blank" data-word="${escapeHtml(part)}">`
           + `<span class="blank-hole">（　　　）</span>`
           + `<span class="blank-answer">${escapeHtml(part)}</span>`
           + `</span>`;
    })
    .join('');
}

function buildQuizHtml(answer, keywords = []) {
  const ranges = getQuizRanges(answer, keywords);

  if (ranges.length === 0) {
    return {
      html: escapeHtml(answer),
      blankCount: 0,
    };
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

  return {
    html,
    blankCount,
  };
}

function renderQuiz(item) {
  const box = document.getElementById('d-quiz');
  const quiz = buildQuizHtml(item.a, item.k);

  box.innerHTML = `
    <div class="quiz-label">✏️ 빈칸 채우기 퀴즈</div>
    <p class="quiz-q">${item.q}</p>
    <p class="quiz-a">${quiz.html}</p>
    <div class="quiz-actions">
      <button class="quiz-btn"         id="quiz-reveal">답 보기</button>
      <button class="quiz-btn outline" id="quiz-reset">다시 풀기</button>
    </div>
  `;

  const blanks = box.querySelectorAll('.blank');
  const btnReveal = document.getElementById('quiz-reveal');
  const btnReset  = document.getElementById('quiz-reset');

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

/* ── 초기화 ── */
renderList();
handleRoute();
