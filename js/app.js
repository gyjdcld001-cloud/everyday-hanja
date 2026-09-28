/*
 * 매일 한자 — 평일 아침 5분 한자 학습
 *
 * 학습 흐름 (에빙하우스 망각 곡선에 맞춘 반복)
 *   월~금: ① 1일 후 복습(지난 학습일의 한자 + 틀렸던 한자)  ② 오늘의 한자  ③ 확인 퀴즈
 *   금요일: 위 과정 + ④ 이번 주 한자 전체 복습(일주일 복습)
 *   급수 완료: '급수 시험' 코너에서 전체 복습 → 시험(어휘 제시, 뜻과 음 쓰기)
 *
 * 저장: 브라우저 localStorage (서버 없음)
 */
(() => {
  'use strict';

  const STORE_KEY = 'everyday-hanja:v1';
  const DAY = ['일', '월', '화', '수', '목', '금', '토'];
  const PASS_SCORE = 70; // 한자능력검정시험 합격 기준(70%)과 같게
  const MAX_EXTRA_REVIEW = 2; // 매일 복습에 더하는 '틀린 한자' 최대 개수

  const $app = document.getElementById('app');

  /* ================= 날짜 ================= */
  // ?date=2026-10-02 처럼 날짜를 바꿔 미리 볼 수 있습니다(테스트용).
  function today() {
    const q = new URLSearchParams(location.search).get('date');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return parseDate(q);
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function fmt(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function mondayOf(d) {
    const dow = d.getDay();
    return addDays(d, dow === 0 ? -6 : 1 - dow);
  }
  const isWeekday = (d) => d.getDay() >= 1 && d.getDay() <= 5;
  const koDate = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY[d.getDay()]}요일`;

  /* ================= 저장 ================= */
  function blankState() {
    return {
      pointer: 0,      // 다음에 배울 한자를 찾기 시작하는 위치
      learned: {},     // idx -> 배운 날짜
      order: [],       // 배운 순서
      log: {},         // 날짜 -> { newIdx, reviews, week, done }
      missed: [],      // 틀린 한자(다음 복습에 다시 나옴)
      weekly: {},      // 월요일 날짜 -> 주간 복습 완료
      exams: {},       // 급수 id -> { best, last, passed, date }
      unlockAll: false,
    };
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return Object.assign(blankState(), JSON.parse(raw));
    } catch (e) { /* 저장소를 쓸 수 없으면 새로 시작 */ }
    return blankState();
  }
  let S = load();
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { /* 무시 */ }
  }

  /* ================= 한자 도우미 ================= */
  const C = (i) => HANJA[i];
  const gradeOf = (c) => GRADES[c.gradeIdx];
  function hunum(c) {
    if (c.meanings.length === c.sounds.length) {
      return c.meanings.map((m, i) => `${m} ${c.sounds[i]}`).join(' / ');
    }
    return `${c.meanings.join(', ')} ${c.sounds.join(', ')}`;
  }
  const hl = (text, h) => text.split(h).join(`<em>${h}</em>`);
  function exampleHtml(c) {
    return c.ex.replace(/\(([^)]+)\)/, (_, w) => `(<span class="hj">${hl(w, c.h)}</span>)`);
  }
  const shuffle = (a) => {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function nextNewIdx() {
    for (let i = S.pointer; i < HANJA.length; i++) if (!S.learned[i]) return i;
    for (let i = 0; i < HANJA.length; i++) if (!S.learned[i]) return i;
    return null;
  }
  function lastLearnedBefore(ds) {
    for (let k = S.order.length - 1; k >= 0; k--) {
      const i = S.order[k];
      if (S.learned[i] < ds) return i;
    }
    return null;
  }
  function weekDates(d) {
    const mon = mondayOf(d);
    return [0, 1, 2, 3, 4].map((n) => fmt(addDays(mon, n)));
  }
  function learnedInWeek(d) {
    const days = weekDates(d);
    return S.order.filter((i) => S.learned[i] >= days[0] && S.learned[i] <= days[4]);
  }
  function gradeLearnedCount(g) {
    let n = 0;
    for (let i = g.start; i < g.end; i++) if (S.learned[i]) n++;
    return n;
  }
  const gradeComplete = (g) => gradeLearnedCount(g) === g.end - g.start;
  const examOpen = (g) => S.unlockAll || gradeComplete(g);

  function streak() {
    let d = today();
    let n = 0;
    if (!(S.log[fmt(d)] && S.log[fmt(d)].done)) d = addDays(d, -1);
    for (let guard = 0; guard < 4000; guard++) {
      if (isWeekday(d)) {
        const e = S.log[fmt(d)];
        if (e && e.done) n++;
        else break;
      }
      d = addDays(d, -1);
    }
    return n;
  }
  function addMissed(i) {
    if (!S.missed.includes(i)) S.missed.push(i);
  }
  function removeMissed(i) {
    S.missed = S.missed.filter((x) => x !== i);
  }

  /* ================= 채점 ================= */
  // 두음 법칙: 력→역, 녀→여, 락→낙 …
  const Y_VOWELS = [2, 3, 6, 7, 12, 17, 20]; // ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ
  function dueum(s) {
    const code = s.charCodeAt(0) - 0xac00;
    if (s.length !== 1 || code < 0 || code > 11171) return s;
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    const jong = code % 28;
    let nc = cho;
    if (cho === 5) nc = Y_VOWELS.includes(jung) ? 11 : 2; // ㄹ → ㅇ / ㄴ
    else if (cho === 2 && Y_VOWELS.includes(jung)) nc = 11; // ㄴ → ㅇ
    return String.fromCharCode(0xac00 + nc * 588 + jung * 28 + jong);
  }
  function withJong(syl, jong) {
    const code = syl.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    return String.fromCharCode(0xac00 + code - (code % 28) + jong);
  }
  const jongOf = (syl) => (syl.charCodeAt(0) - 0xac00) % 28;
  const norm = (s) => (s || '').replace(/[\s.,!?·'"()~\-]/g, '');

  function soundOk(c, ans) {
    const a = norm(ans);
    if (!a) return false;
    return c.sounds.some((s) => a === s || a === dueum(s));
  }
  // '배울'은 '배우다', '곧을'은 '곧다', '큰'은 '크다'처럼 기본형도 정답으로 인정
  function meaningStems(m) {
    const last = m.slice(-1);
    const head = m.slice(0, -1);
    const stems = [m];
    if (last === '을') stems.push(head);
    const j = jongOf(last);
    if (j === 8 || j === 4) { // ㄹ, ㄴ 받침
      stems.push(head + withJong(last, 0));
      if (j === 4) stems.push(head + withJong(last, 8)); // 긴 → 길다
    }
    return stems;
  }
  function meaningOk(c, ans) {
    const a = norm((ans || '').trim().split(/\s+/)[0]);
    if (!a) return false;
    return c.meanings.some((m) => a === m || meaningStems(m).some((st) => a === st + '다'));
  }

  /* ================= 문제 만들기 ================= */
  function hunumQuestion(i, stage) {
    const c = C(i);
    const answer = hunum(c);
    const g = gradeOf(c);
    // 같은 급수 한자를 먼저, 부족하면 다른 급수에서 오답 보기를 고릅니다.
    const pool = shuffle(HANJA.slice(g.start, g.end))
      .concat(shuffle(HANJA.slice(0, g.start).concat(HANJA.slice(g.end))))
      .filter((x) => x.idx !== i);
    const opts = [answer];
    for (const x of pool) {
      const t = hunum(x);
      if (!opts.includes(t)) opts.push(t);
      if (opts.length === 4) break;
    }
    return { kind: 'q', type: 'hunum', idx: i, stage, options: shuffle(opts), answer };
  }
  const ALL_WORDS = HANJA.flatMap((c) => c.words.map((w) => w.read));
  function wordQuestion(i, stage) {
    const c = C(i);
    const w = pick(c.words);
    const len = norm(w.read).length;
    const pool = shuffle(ALL_WORDS.filter((r) => norm(r).length === len && r !== w.read));
    const opts = [w.read];
    for (const r of pool) {
      if (!opts.includes(r)) opts.push(r);
      if (opts.length === 4) break;
    }
    return { kind: 'q', type: 'word', idx: i, stage, word: w, options: shuffle(opts), answer: w.read };
  }

  /* ================= 학습 세션 ================= */
  let session = null;
  let timerId = null;

  function planToday() {
    const t = today();
    const ds = fmt(t);
    const entry = S.log[ds];
    if (entry) return entry;
    const newIdx = nextNewIdx();
    const reviews = [];
    const prev = lastLearnedBefore(ds);
    if (prev !== null) reviews.push(prev);
    for (const m of S.missed) {
      if (reviews.length >= 1 + MAX_EXTRA_REVIEW) break;
      if (!reviews.includes(m) && S.learned[m] && S.learned[m] < ds) reviews.push(m);
    }
    let week = [];
    if (t.getDay() === 5) {
      week = learnedInWeek(t).filter((i) => S.learned[i] < ds);
      if (newIdx !== null) week.push(newIdx);
      if (week.length < 2) week = [];
    }
    return { newIdx, reviews, week, done: false };
  }

  function buildLesson() {
    const plan = planToday();
    const steps = [];
    plan.reviews.forEach((i, k) => {
      const stage = k === 0 ? '① 1일 후 복습' : '① 틀렸던 한자 다시 보기';
      steps.push(hunumQuestion(i, stage));
      if (k === 0) steps.push(wordQuestion(i, stage));
    });
    if (plan.newIdx !== null) {
      steps.push({ kind: 'learn', idx: plan.newIdx, stage: '② 오늘의 한자' });
      steps.push(hunumQuestion(plan.newIdx, '③ 확인 퀴즈'));
      steps.push(wordQuestion(plan.newIdx, '③ 확인 퀴즈'));
    }
    if (plan.week.length) {
      const stage = '④ 금요일 일주일 복습';
      steps.push({ kind: 'weekIntro', list: plan.week, stage });
      plan.week.filter((i) => i !== plan.newIdx).forEach((i) => steps.push(hunumQuestion(i, stage)));
      shuffle(plan.week).slice(0, 2).forEach((i) => steps.push(wordQuestion(i, stage)));
      steps.push({ kind: 'weekSummary', list: plan.week, stage });
    }
    steps.push({ kind: 'done' });
    return { type: 'lesson', plan, date: fmt(today()), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildWeekly() {
    const t = today();
    const list = learnedInWeek(t);
    const stage = '이번 주 복습';
    const steps = [{ kind: 'weekIntro', list, stage }];
    list.forEach((i) => steps.push(hunumQuestion(i, stage)));
    shuffle(list).slice(0, 2).forEach((i) => steps.push(wordQuestion(i, stage)));
    steps.push({ kind: 'weekSummary', list, stage });
    steps.push({ kind: 'done' });
    return { type: 'weekly', week: fmt(mondayOf(t)), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildFreeReview() {
    const learned = S.order.slice();
    const missed = S.missed.filter((i) => S.learned[i]);
    const rest = shuffle(learned.filter((i) => !missed.includes(i)));
    const list = shuffle(missed).concat(rest).slice(0, 5);
    const stage = '자유 복습';
    const steps = [];
    list.forEach((i, k) => steps.push(k % 2 ? wordQuestion(i, stage) : hunumQuestion(i, stage)));
    steps.push({ kind: 'done' });
    return { type: 'review', steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function commitLearn(i) {
    const ds = session.date;
    if (!S.learned[i]) {
      S.learned[i] = ds;
      S.order.push(i);
    }
    if (i >= S.pointer) S.pointer = i + 1;
    S.log[ds] = Object.assign({}, session.plan, { done: false });
    save();
  }

  function finishSession() {
    if (session.type === 'lesson') {
      const e = S.log[session.date] || Object.assign({}, session.plan);
      e.done = true;
      S.log[session.date] = e;
      if (session.plan.week.length) S.weekly[fmt(mondayOf(parseDate(session.date)))] = true;
    } else if (session.type === 'weekly') {
      S.weekly[session.week] = true;
    }
    save();
  }

  /* ================= 화면: 공통 ================= */
  function setTab(name) {
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }
  const canSpeak = 'speechSynthesis' in window;
  function speak(text) {
    if (!canSpeak) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ko-KR';
      u.rate = 0.85;
      speechSynthesis.speak(u);
    } catch (e) { /* 무시 */ }
  }
  function charCardHtml(c, opts = {}) {
    const words = c.words.map((w) => `
      <div class="word">
        <div class="word-h">${hl(w.word, c.h)}</div>
        <div class="word-r">${w.read}</div>
        <div class="word-m">${w.mean}</div>
      </div>`).join('');
    return `
      <div class="char-card">
        ${opts.stage ? `<div class="stage-label">${opts.stage}</div>` : ''}
        <span class="pill">${c.gradeName}</span>
        <div class="big-hanja">${c.h}</div>
        <div class="hunum">${hunum(c)}</div>
        <div class="small muted">뜻(훈) + 소리(음)</div>
        ${canSpeak ? `<button class="speak" data-speak="${c.meanings[0]} ${c.sounds[0]}">🔊 소리 듣기</button>` : ''}
      </div>
      <h3 style="margin-top:20px">이 한자가 들어간 어휘</h3>
      <div class="words">${words}</div>
      <div class="ex"><span class="lbl">문장으로 익히기</span>${exampleHtml(c)}</div>`;
  }
  function bindSpeak(root = $app) {
    root.querySelectorAll('[data-speak]').forEach((b) => b.addEventListener('click', () => speak(b.dataset.speak)));
  }
  function openCharModal(i) {
    const c = C(i);
    const back = document.createElement('div');
    back.className = 'modal-back';
    const when = S.learned[i] ? `<p class="small muted center">${S.learned[i].replace(/-/g, '.')} 학습</p>` : '';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${c.h} ${hunum(c)}">
      <button class="close-x" aria-label="닫기">✕</button>${charCardHtml(c)}${when}</div>`;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('.close-x').addEventListener('click', close);
    document.body.appendChild(back);
    bindSpeak(back);
  }

  /* ================= 화면: 홈 ================= */
  function renderHome() {
    setTab('home');
    const t = today();
    const ds = fmt(t);
    const entry = S.log[ds];
    const learnedN = S.order.length;
    const next = nextNewIdx();
    let main = '';

    if (!learnedN && !entry) {
      main += `
      <div class="card">
        <h2>반가워요! 👋</h2>
        <p>평일 아침 <b>5분</b>, 하루에 한자 <b>한 자</b>씩 뜻과 음을 익혀요.<br>
        글자 모양을 외울 필요는 없어요. 어휘와 문장 속에서 뜻과 소리를 알아보면 돼요.</p>
        <ol class="plain small">
          <li><b>월~금</b> 매일 새 한자 1자 + 어휘 4개 + 예문</li>
          <li>다음 날 <b>1일 후 복습</b>으로 한 번 더</li>
          <li><b>금요일</b>엔 한 주의 한자를 모두 <b>일주일 복습</b></li>
          <li>급수를 다 배우면 <b>급수 시험</b>으로 마무리</li>
        </ol>
        <p class="small muted">이미 아는 급수가 있다면 <a href="#/settings">설정</a>에서 시작 급수를 바꿀 수 있어요.</p>
      </div>`;
    }

    if (isWeekday(t)) {
      if (entry && entry.done) {
        const c = entry.newIdx !== null && entry.newIdx !== undefined ? C(entry.newIdx) : null;
        main += `
        <div class="card hero">
          <div class="dayname">${DAY[t.getDay()]}요일 학습 완료 ✅</div>
          ${c ? `<div class="big-hanja">${c.h}</div><div class="hunum" style="font-size:22px;font-weight:700">${hunum(c)}</div>` : ''}
          <p class="muted">${t.getDay() === 5 ? '한 주 동안 수고했어요! 주말엔 푹 쉬어요.' : '잘했어요! 내일 아침에 1일 후 복습으로 만나요.'}</p>
          <div class="btn-row">
            ${c ? `<button class="btn ghost" data-open="${c.idx}">다시 보기</button>` : ''}
            <a class="btn soft" href="#/review">자유 복습</a>
          </div>
        </div>`;
      } else if (next === null && !(entry && entry.newIdx !== null && entry.newIdx !== undefined)) {
        main += `
        <div class="card hero">
          <div class="big-hanja">🎉</div>
          <h2>준비된 한자를 모두 배웠어요!</h2>
          <p class="muted">급수 시험으로 실력을 확인하거나 자유 복습을 해 보세요.</p>
          <div class="btn-row"><a class="btn" href="#/exam">급수 시험</a><a class="btn soft" href="#/review">자유 복습</a></div>
        </div>`;
      } else {
        const plan = planToday();
        const c = C(plan.newIdx);
        const started = !!entry;
        const steps = [];
        if (plan.reviews.length) {
          const [first, ...extra] = plan.reviews;
          steps.push(`<b>1일 후 복습</b> — <span class="hanja">${C(first).h}</span>`
            + (extra.length ? ` · 틀렸던 한자 ${extra.map((i) => `<span class="hanja">${C(i).h}</span>`).join(' ')}` : ''));
        }
        steps.push(`<b>오늘의 한자</b> — 뜻과 음, 어휘 4개, 예문`);
        steps.push(`<b>확인 퀴즈</b> — 2문제`);
        if (plan.week.length) steps.push(`<b>일주일 복습</b> — 이번 주 ${plan.week.length}자`);
        main += `
        <div class="card hero">
          <div class="dayname">${DAY[t.getDay()]}요일 아침 · ${c.gradeName} ${c.idx - gradeOf(c).start + 1}번째 한자</div>
          <div class="big-hanja">${started ? c.h : '?'}</div>
          <p class="muted">${started ? '하던 학습을 이어서 해요.' : '오늘은 어떤 한자일까요?'}</p>
          <ol class="steps">${steps.map((s, k) => `<li><span class="num">${k + 1}</span><span>${s}</span></li>`).join('')}</ol>
          <a class="btn block" href="#/lesson" style="margin-top:14px">${started ? '이어서 하기' : '오늘의 학습 시작'} · 약 5분</a>
        </div>`;
      }
    } else {
      const wk = learnedInWeek(t);
      const wkKey = fmt(mondayOf(t));
      main += `
      <div class="card hero">
        <div class="big-hanja">休</div>
        <div class="hunum" style="font-size:20px;font-weight:700">쉴 휴</div>
        <p class="muted">주말은 쉬는 날이에요. 월요일 아침에 새 한자로 만나요!</p>
        ${wk.length >= 2 && !S.weekly[wkKey]
          ? `<p class="small">이번 주 <b>일주일 복습</b>을 아직 안 했어요.</p><a class="btn block" href="#/weekly">일주일 복습 하기</a>`
          : ''}
        ${learnedN ? `<a class="btn soft block" href="#/review" style="margin-top:10px">자유 복습 (5문제)</a>` : ''}
      </div>`;
    }

    // 급수 시험 안내
    GRADES.forEach((g) => {
      if (gradeComplete(g) && !(S.exams[g.id] && S.exams[g.id].passed)) {
        main += `
        <div class="card notice">
          <h3>🎓 ${g.name} 한자를 모두 배웠어요!</h3>
          <p class="small muted">급수 시험 코너에서 ${g.name} 전체 한자를 복습하고 시험을 볼 수 있어요.</p>
          <a class="btn ghost block" href="#/exam/${g.id}">${g.name} 전체 복습 · 시험 보기</a>
        </div>`;
      }
    });

    // 이번 주
    const days = weekDates(t);
    const cells = days.map((d, k) => {
      const e = S.log[d];
      const idx = e && e.newIdx !== null && e.newIdx !== undefined && S.learned[e.newIdx] === d ? e.newIdx : null;
      const cls = [e && e.done ? 'done' : '', d === ds ? 'today' : ''].join(' ');
      return `<div class="d ${cls}"><div class="lbl">${DAY[k + 1]}</div>
        <div class="cell">${idx !== null ? `<button class="linkbtn hanja" style="text-decoration:none;font-size:26px;color:inherit" data-open="${idx}">${C(idx).h}</button>` : ''}</div></div>`;
    }).join('');
    const cur = next !== null ? gradeOf(C(next)) : GRADES[GRADES.length - 1];
    const curN = gradeLearnedCount(cur);
    const curT = cur.end - cur.start;
    main += `
      <div class="card">
        <div class="row"><h3 style="margin:0">이번 주</h3><span class="spacer"></span>
          ${S.weekly[fmt(mondayOf(t))] ? '<span class="pill green">일주일 복습 완료</span>' : '<span class="pill gray">금요일: 일주일 복습</span>'}</div>
        <div class="week">${cells}</div>
      </div>
      <div class="card">
        <div class="stats">
          <div><b>${streak()}</b><span>연속 학습일</span></div>
          <div><b>${learnedN}</b><span>배운 한자</span></div>
          <div><b>${S.missed.length}</b><span>다시 볼 한자</span></div>
        </div>
        <div class="row" style="margin-top:16px"><b>${cur.name}</b><span class="spacer"></span><span class="small muted">${curN} / ${curT}자</span></div>
        <div class="progress" style="margin-top:6px"><span style="width:${(curN / curT) * 100}%"></span></div>
      </div>`;

    $app.innerHTML = main;
    $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
  }

  /* ================= 화면: 학습 세션 ================= */
  function startLesson(kind) {
    const t = today();
    if (kind === 'lesson') {
      const e = S.log[fmt(t)];
      if (!isWeekday(t) || (e && e.done)) { location.hash = '#/'; return; }
      if (!session || session.type !== 'lesson' || session.date !== fmt(t)) session = buildLesson();
    } else if (kind === 'weekly') {
      if (learnedInWeek(t).length === 0) { location.hash = '#/'; return; }
      if (!session || session.type !== 'weekly') session = buildWeekly();
    } else {
      if (!S.order.length) { location.hash = '#/'; return; }
      if (!session || session.type !== 'review') session = buildFreeReview();
    }
    document.body.classList.add('in-lesson');
    renderStep();
    stopTimer();
    timerId = setInterval(() => {
      const el = document.getElementById('timer');
      if (!el || !session) return;
      el.textContent = elapsed(session.started);
    }, 1000);
  }

  function elapsed(from) {
    const s = Math.floor((Date.now() - from) / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function nextStep() {
    session.i++;
    renderStep();
    window.scrollTo(0, 0);
  }

  function renderStep() {
    const step = session.steps[session.i];
    const pct = (session.i / (session.steps.length - 1)) * 100;
    const head = step.kind === 'done' ? '' : `
      <div class="lesson-head">
        <button class="close-x" id="quit" aria-label="그만하기">✕</button>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <span class="timer" id="timer">${elapsed(session.started)}</span>
      </div>`;
    let body = '';
    if (step.kind === 'learn') body = renderLearn(step);
    else if (step.kind === 'q') body = renderQuestion(step);
    else if (step.kind === 'weekIntro') body = renderWeekIntro(step);
    else if (step.kind === 'weekSummary') body = renderWeekSummary(step);
    else if (step.kind === 'done') body = renderDone();
    $app.innerHTML = head + body;

    const quit = document.getElementById('quit');
    if (quit) quit.addEventListener('click', () => { location.hash = '#/'; });
    bindSpeak();
    if (step.kind === 'learn') {
      document.getElementById('next').addEventListener('click', () => { commitLearn(step.idx); nextStep(); });
    } else if (step.kind === 'q') {
      bindQuestion(step);
    } else if (step.kind === 'weekIntro' || step.kind === 'weekSummary') {
      document.getElementById('next').addEventListener('click', nextStep);
      $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
    }
  }

  function renderLearn(step) {
    return `<div class="card">${charCardHtml(C(step.idx), { stage: step.stage })}
      <button class="btn block" id="next" style="margin-top:18px">다 익혔어요 →</button></div>`;
  }

  function renderQuestion(step) {
    const c = C(step.idx);
    let q;
    if (step.type === 'hunum') {
      q = `<div class="big-hanja">${c.h}</div><div class="prompt">이 한자의 <b>뜻과 음</b>은?</div>`;
    } else {
      q = `<div class="qword">${hl(step.word.word, c.h)}</div><div class="prompt">이 어휘는 어떻게 <b>읽을까요</b>?</div>`;
    }
    const opts = step.options.map((o, k) => `<button class="opt" data-k="${k}">${o}</button>`).join('');
    return `<div class="card">
      <div class="stage-label">${step.stage}</div>
      <div class="quiz-q">${q}</div>
      <div class="options">${opts}</div>
      <div id="fb"></div></div>`;
  }

  function bindQuestion(step) {
    const c = C(step.idx);
    const buttons = $app.querySelectorAll('.opt');
    buttons.forEach((b) => b.addEventListener('click', () => {
      const chosen = step.options[+b.dataset.k];
      const ok = chosen === step.answer;
      buttons.forEach((x) => {
        x.disabled = true;
        if (step.options[+x.dataset.k] === step.answer) x.classList.add('correct');
      });
      if (!ok) b.classList.add('wrong');
      session.total++;
      if (ok) session.correct++;
      if (ok) removeMissed(step.idx);
      else addMissed(step.idx);
      save();
      const detail = step.type === 'hunum'
        ? `<b class="hanja">${c.h}</b> ${hunum(c)} · 예) <span class="hanja">${c.words[0].word}</span>(${c.words[0].read})`
        : `<span class="hanja">${step.word.word}</span>(${step.word.read}) — ${step.word.mean}<br><span class="hanja">${c.h}</span> ${hunum(c)}`;
      document.getElementById('fb').innerHTML = `
        <div class="feedback ${ok ? 'ok' : 'no'}">${ok ? '정답이에요! 👍' : '아쉬워요. 다음 복습 때 다시 나올 거예요.'}<br>${detail}</div>
        <button class="btn block" id="next" style="margin-top:12px">다음 →</button>`;
      if (canSpeak) speak(step.type === 'hunum' ? `${c.meanings[0]} ${c.sounds[0]}` : step.word.read);
      const nb = document.getElementById('next');
      nb.addEventListener('click', nextStep);
      nb.focus();
    }));
  }

  function renderWeekIntro(step) {
    const list = step.list.map((i) => `<span class="hanja" style="font-size:40px;margin:0 6px">${C(i).h}</span>`).join('');
    return `<div class="card center">
      <div class="stage-label">${step.stage}</div>
      <h2>이번 주에 배운 한자 ${step.list.length}자</h2>
      <div style="margin:14px 0">${list}</div>
      <p class="muted small">일주일이 지나면 배운 내용의 대부분을 잊어버려요.<br>지금 한 번 더 떠올리면 기억이 훨씬 오래가요!</p>
      <button class="btn block" id="next">복습 시작 →</button></div>`;
  }

  function renderWeekSummary(step) {
    const rows = step.list.map((i) => {
      const c = C(i);
      const miss = S.missed.includes(i);
      return `<tr><td><button class="linkbtn hanja" style="font-size:34px;text-decoration:none;color:${miss ? 'var(--red)' : 'inherit'}" data-open="${i}">${c.h}</button></td>
        <td><b>${hunum(c)}</b> ${miss ? '<span class="pill">다시 보기</span>' : ''}<div class="ws">${c.words.map((w) => `${w.read}(<span class="hanja">${w.word}</span>)`).join(', ')}</div></td></tr>`;
    }).join('');
    return `<div class="card">
      <div class="stage-label">${step.stage}</div>
      <h2>이번 주 한자 정리</h2>
      <table class="summary-table">${rows}</table>
      <button class="btn block" id="next" style="margin-top:16px">마치기 →</button></div>`;
  }

  function renderDone() {
    stopTimer();
    finishSession();
    document.body.classList.remove('in-lesson');
    const secs = Math.floor((Date.now() - session.started) / 1000);
    const mins = Math.max(1, Math.round(secs / 60));
    let extra = '';
    let title = '오늘 학습 끝!';
    if (session.type === 'lesson') {
      const i = session.plan.newIdx;
      if (i !== null && i !== undefined) {
        const g = gradeOf(C(i));
        if (i === g.end - 1 || gradeComplete(g)) {
          extra = `<div class="card notice" style="text-align:left;margin-top:16px">
            <h3>🎓 ${g.name} 한자를 모두 배웠어요!</h3>
            <p class="small muted">${g.name} ${g.end - g.start}자 전체를 복습하고 급수 시험을 볼 수 있어요.</p>
            <a class="btn ghost block" href="#/exam/${g.id}">급수 시험 보러 가기</a></div>`;
        }
      }
      if (session.plan.week.length) title = '한 주 학습 끝! 🎉';
    } else if (session.type === 'weekly') {
      title = '일주일 복습 끝!';
    } else {
      title = '복습 끝!';
    }
    const msg = session.type === 'lesson' && !session.plan.week.length
      ? '내일 아침 1일 후 복습에서 다시 만나요.'
      : '잘했어요! 틀린 한자는 다음 복습에 다시 나와요.';
    const html = `<div class="card celebrate">
      <div class="emoji">🌱</div>
      <h2>${title}</h2>
      <p>${session.total ? `퀴즈 <b>${session.correct} / ${session.total}</b> 정답 · ` : ''}약 ${mins}분</p>
      <p class="muted">${msg}</p>
      ${session.type === 'lesson' ? `<p>연속 학습 <b>${streak()}일</b> 🔥</p>` : ''}
      <a class="btn block" href="#/">홈으로</a>
      ${extra}
    </div>`;
    session = null;
    return html;
  }

  /* ================= 화면: 한자 목록 ================= */
  let listGrade = null;
  function renderList() {
    setTab('list');
    if (listGrade === null) {
      const n = nextNewIdx();
      listGrade = n !== null ? C(n).gradeIdx : 0;
    }
    const g = GRADES[listGrade];
    const tabs = GRADES.map((x, k) => `<button class="${k === listGrade ? 'on' : ''}" data-g="${k}">${x.name}</button>`).join('');
    const cells = HANJA.slice(g.start, g.end).map((c) => {
      const cls = S.missed.includes(c.idx) ? 'missed' : S.learned[c.idx] ? 'learned' : 'locked';
      return `<button class="cell-btn ${cls}" data-open="${c.idx}" aria-label="${c.h} ${hunum(c)}">
        <span class="hanja">${c.h}</span><span class="hu">${hunum(c)}</span></button>`;
    }).join('');
    $app.innerHTML = `
      <div class="card">
        <div class="row"><h2 style="margin:0">한자 목록</h2><span class="spacer"></span>
          <span class="small muted">배운 한자 ${S.order.length} / ${HANJA.length}</span></div>
      </div>
      <div class="tabs">${tabs}</div>
      <div class="card">
        <div class="row"><b>${g.name}</b><span class="small muted">${gradeLearnedCount(g)} / ${g.end - g.start}자</span></div>
        <div class="legend"><span><i style="background:var(--green)"></i>배운 한자</span>
          <span><i style="background:var(--red)"></i>다시 볼 한자</span><span><i style="background:var(--line)"></i>아직 안 배움</span></div>
        <div class="grid">${cells}</div>
      </div>
      <p class="small muted center">준비 중: ${UPCOMING_GRADES.join(' · ')}</p>`;
    $app.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { listGrade = +b.dataset.g; renderList(); }));
    $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
  }

  /* ================= 화면: 급수 시험 ================= */
  function renderExamHome() {
    setTab('exam');
    const items = GRADES.map((g) => {
      const n = gradeLearnedCount(g);
      const total = g.end - g.start;
      const rec = S.exams[g.id];
      const open = examOpen(g);
      const status = rec && rec.passed ? `<span class="pill green">합격 · 최고 ${rec.best}점</span>`
        : rec ? `<span class="pill">최고 ${rec.best}점</span>`
        : open ? '<span class="pill blue">응시 가능</span>' : '<span class="pill gray">학습 중</span>';
      return `<div class="card grade-item">
        <div class="gname">${g.name}</div>
        <div class="ginfo">
          <div class="row">${status}<span class="small muted">${n} / ${total}자 학습</span></div>
          <div class="progress" style="margin-top:8px"><span style="width:${(n / total) * 100}%"></span></div>
        </div>
        ${open ? `<a class="btn" href="#/exam/${g.id}">열기</a>` : '<button class="btn" disabled>🔒</button>'}
      </div>`;
    }).join('');
    const upcoming = UPCOMING_GRADES.map((n) => `<span class="pill gray" style="margin:3px">${n}</span>`).join('');
    $app.innerHTML = `
      <div class="card">
        <h2>급수 시험</h2>
        <p class="small muted" style="margin:0">한 급수의 한자를 모두 배우면 열려요. <b>① 전체 복습</b>으로 정리한 뒤
        <b>② 시험</b>에서 어휘 속 한자의 <b>뜻과 음</b>을 직접 써 보세요. ${PASS_SCORE}점 이상이면 합격!</p>
      </div>
      ${items}
      <div class="card"><h3>준비 중인 급수</h3><div>${upcoming}</div></div>`;
  }

  let hideHunum = false;
  function renderExamGrade(id) {
    setTab('exam');
    const g = GRADES.find((x) => x.id === id);
    if (!g) { location.hash = '#/exam'; return; }
    if (!examOpen(g)) {
      $app.innerHTML = `<div class="card center"><h2>🔒 ${g.name}</h2>
        <p class="muted">${g.name} 한자를 모두 배우면 열려요. (${gradeLearnedCount(g)} / ${g.end - g.start}자)</p>
        <p class="small muted">이미 아는 급수라면 설정에서 '모든 급수 시험 열기'를 켤 수 있어요.</p>
        <a class="btn ghost" href="#/exam">돌아가기</a></div>`;
      return;
    }
    const total = g.end - g.start;
    const cells = HANJA.slice(g.start, g.end).map((c) => `
      <button class="cell-btn ${S.missed.includes(c.idx) ? 'missed' : 'learned'} ${hideHunum ? 'hide-hu' : ''}" data-open="${c.idx}">
        <span class="hanja">${c.h}</span><span class="hu">${hunum(c)}</span></button>`).join('');
    const rec = S.exams[g.id];
    $app.innerHTML = `
      <div class="row" style="margin-bottom:10px"><a href="#/exam" class="small">← 급수 시험</a></div>
      <div class="card">
        <h2>${g.name} · ① 전체 복습</h2>
        <p class="small muted">${total}자를 훑어보며 뜻과 음을 떠올려 보세요. 한자를 누르면 어휘와 예문이 보여요.</p>
        <label class="row small" style="margin:8px 0 12px"><input type="checkbox" class="switch" id="hide" ${hideHunum ? 'checked' : ''}> 뜻·음 가리고 스스로 떠올리기</label>
        <div class="grid">${cells}</div>
      </div>
      <div class="card">
        <h2>② 급수 시험</h2>
        <p class="small muted">어휘가 제시되면 <b style="color:var(--accent)">색으로 표시된 한자</b>의 <b>뜻</b>과 <b>음</b>을 써요.
          예) <span class="hanja">學</span>校 → 뜻: 배울, 음: 학</p>
        ${rec ? `<p class="small">지난 시험 ${rec.last}점 · 최고 ${rec.best}점 ${rec.passed ? '· <b style="color:var(--green)">합격</b>' : ''}</p>` : ''}
        <div class="btn-row">
          <a class="btn soft" href="#/exam/${g.id}/test/20">20문항</a>
          <a class="btn" href="#/exam/${g.id}/test/all">전체 ${total}문항</a>
        </div>
      </div>`;
    document.getElementById('hide').addEventListener('change', (e) => { hideHunum = e.target.checked; renderExamGrade(id); });
    $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
  }

  let exam = null;
  function startExam(id, n) {
    const g = GRADES.find((x) => x.id === id);
    if (!g || !examOpen(g)) { location.hash = '#/exam'; return; }
    const key = `${id}/${n}`;
    if (!exam || exam.key !== key) {
      const idxs = shuffle(HANJA.slice(g.start, g.end).map((c) => c.idx));
      const count = n === 'all' ? idxs.length : Math.min(+n || 20, idxs.length);
      exam = {
        key, grade: g,
        qs: idxs.slice(0, count).map((i) => ({ idx: i, word: pick(C(i).words), m: '', s: '', okM: false, okS: false, checked: false })),
        i: 0,
      };
    }
    document.body.classList.add('in-lesson');
    renderExamQ();
  }

  function renderExamQ() {
    const q = exam.qs[exam.i];
    if (!q) { renderExamResult(); return; }
    const c = C(q.idx);
    const pct = (exam.i / exam.qs.length) * 100;
    $app.innerHTML = `
      <div class="lesson-head">
        <button class="close-x" id="quit" aria-label="시험 그만두기">✕</button>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <span class="timer">${exam.i + 1} / ${exam.qs.length}</span>
      </div>
      <div class="card">
        <div class="stage-label">${exam.grade.name} 급수 시험</div>
        <div class="quiz-q">
          <div class="qword">${hl(q.word.word, c.h)}</div>
          <div class="prompt">색으로 표시된 한자 <b class="hanja" style="color:var(--accent)">${c.h}</b>의 뜻과 음을 쓰세요.</div>
        </div>
        <form id="f" autocomplete="off">
          <div class="exam-inputs">
            <div><label for="m">뜻 (훈)</label><input id="m" lang="ko" placeholder="예) 배울" value="${esc(q.m)}"></div>
            <div><label for="s">음 (소리)</label><input id="s" lang="ko" placeholder="예) 학" value="${esc(q.s)}"></div>
          </div>
          <div id="fb"></div>
          <button class="btn block" id="go" style="margin-top:14px">확인</button>
        </form>
      </div>`;
    document.getElementById('quit').addEventListener('click', () => {
      if (confirm('시험을 그만둘까요? 지금까지 푼 문제는 저장되지 않아요.')) {
        const gid = exam.grade.id;
        exam = null;
        location.hash = `#/exam/${gid}`;
      }
    });
    const m = document.getElementById('m');
    const s = document.getElementById('s');
    m.focus();
    document.getElementById('f').addEventListener('submit', (e) => {
      e.preventDefault();
      if (q.checked) { exam.i++; renderExamQ(); return; }
      q.m = m.value.trim();
      q.s = s.value.trim();
      if (!q.m && !q.s) { m.focus(); return; }
      q.okM = meaningOk(c, q.m);
      q.okS = soundOk(c, q.s);
      q.checked = true;
      showExamFeedback(q, c);
    });
  }

  function showExamFeedback(q, c) {
    const m = document.getElementById('m');
    const s = document.getElementById('s');
    m.readOnly = s.readOnly = true;
    m.className = q.okM ? 'ok' : 'no';
    s.className = q.okS ? 'ok' : 'no';
    const ok = q.okM && q.okS;
    const override = !q.okM && q.m
      ? `<button type="button" class="linkbtn small" id="ovr">내가 쓴 뜻 "${esc(q.m)}"도 맞아요 (인정하기)</button>` : '';
    document.getElementById('fb').innerHTML = `
      <div class="feedback ${ok ? 'ok' : 'no'}">
        ${ok ? '정답! 👍' : '정답은'} <b class="hanja">${c.h}</b> <b>${hunum(c)}</b><br>
        <span class="hanja">${q.word.word}</span>(${q.word.read}) — ${q.word.mean}
      </div>${override}`;
    const go = document.getElementById('go');
    go.textContent = exam.i + 1 < exam.qs.length ? '다음 문제 →' : '결과 보기';
    go.focus();
    const ovr = document.getElementById('ovr');
    if (ovr) ovr.addEventListener('click', () => { q.okM = true; showExamFeedback(q, c); });
  }

  function renderExamResult() {
    const g = exam.grade;
    const total = exam.qs.length;
    const right = exam.qs.filter((q) => q.okM && q.okS).length;
    const score = Math.round((right / total) * 100);
    const passed = score >= PASS_SCORE;
    if (!exam.saved) {
      const rec = S.exams[g.id] || { best: 0, passed: false };
      S.exams[g.id] = {
        best: Math.max(rec.best, score), last: score, passed: rec.passed || passed, date: fmt(today()),
      };
      exam.qs.forEach((q) => { if (!(q.okM && q.okS)) addMissed(q.idx); else removeMissed(q.idx); });
      save();
      exam.saved = true;
    }
    const wrong = exam.qs.filter((q) => !(q.okM && q.okS));
    const list = wrong.map((q) => {
      const c = C(q.idx);
      return `<li><button class="linkbtn hanja" style="font-size:30px;text-decoration:none;color:var(--red)" data-open="${c.idx}">${c.h}</button>
        <div><b>${hunum(c)}</b><div class="small muted">내 답: ${esc(q.m || '(빈칸)')} / ${esc(q.s || '(빈칸)')} · <span class="hanja">${q.word.word}</span>(${q.word.read})</div></div></li>`;
    }).join('');
    document.body.classList.remove('in-lesson');
    $app.innerHTML = `
      <div class="card celebrate">
        <div class="stage-label">${g.name} 급수 시험 결과</div>
        <div class="score">${score}<small>점</small></div>
        <p class="muted">${total}문항 중 ${right}문항 정답</p>
        <div class="stamp ${passed ? 'pass' : 'fail'}">${passed ? '합격' : '불합격'}</div>
        <p class="small muted" style="margin-top:16px">${passed ? '축하해요! 다음 급수도 매일 5분씩 힘내요.' : `${PASS_SCORE}점 이상이면 합격이에요. 틀린 한자를 복습하고 다시 도전해요!`}</p>
        <div class="btn-row"><a class="btn soft" href="#/exam/${g.id}">전체 복습</a><a class="btn" href="#/">홈으로</a></div>
      </div>
      ${wrong.length ? `<div class="card"><h3>틀린 한자 ${wrong.length}자</h3>
        <p class="small muted">틀린 한자는 '다시 볼 한자'에 담겨 매일 복습에 나와요.</p>
        <ul class="wrong-list">${list}</ul></div>` : ''}`;
    $app.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
    exam = null;
  }

  /* ================= 화면: 설정 ================= */
  function renderSettings() {
    setTab('settings');
    const next = nextNewIdx();
    const curG = next !== null ? C(next).gradeIdx : -1;
    const options = GRADES.map((g, k) => `<option value="${k}" ${k === curG ? 'selected' : ''}>${g.name}부터</option>`).join('');
    $app.innerHTML = `
      <div class="card">
        <h2>설정</h2>
        <div class="setting">
          <div class="txt"><b>다음에 배울 급수</b><div class="small muted">이미 아는 급수는 건너뛸 수 있어요.</div></div>
          <select id="grade">${options}</select>
        </div>
        <div class="setting">
          <div class="txt"><b>모든 급수 시험 열기</b><div class="small muted">배우지 않은 급수도 시험을 볼 수 있어요.</div></div>
          <input type="checkbox" class="switch" id="unlock" ${S.unlockAll ? 'checked' : ''}>
        </div>
        <div class="setting">
          <div class="txt"><b>학습 기록 초기화</b><div class="small muted">배운 한자, 시험 기록이 모두 지워져요.</div></div>
          <button class="btn ghost" id="reset">초기화</button>
        </div>
      </div>

      <div class="card">
        <h2>이렇게 복습해요</h2>
        <p class="small">독일의 심리학자 <b>에빙하우스</b>는 사람이 새로 배운 것을 하루만 지나도 절반 넘게 잊어버린다는
          <b>망각 곡선</b>을 발견했어요. 하지만 잊어버리기 전에 다시 떠올리면 기억이 점점 오래 남아요.</p>
        ${curveSvg()}
        <ol class="plain small">
          <li><b>오늘의 한자</b> — 뜻과 음을 어휘 4개, 예문과 함께 익혀요.</li>
          <li><b>1일 후 복습</b> — 다음 학습일 아침에 바로 전 한자를 퀴즈로 떠올려요. (금요일 한자는 월요일에)</li>
          <li><b>일주일 복습</b> — 금요일마다 그 주의 한자 5자를 모두 다시 풀어요.</li>
          <li><b>틀린 한자</b> — 퀴즈나 시험에서 틀리면 '다시 볼 한자'로 모아 매일 복습에 최대 ${MAX_EXTRA_REVIEW}자씩 다시 나와요.</li>
          <li><b>급수 시험</b> — 한 급수를 다 배우면 전체 복습 후 시험(어휘 제시 → 뜻과 음 쓰기)을 봐요.</li>
        </ol>
      </div>

      <div class="card">
        <h2>수록 한자</h2>
        <p class="small">한국어문회 한자능력검정시험 배정 한자 기준으로 ${GRADES.map((g) => `${g.name} ${g.end - g.start}자`).join(', ')} —
          모두 <b>${HANJA.length}자</b>가 들어 있어요. 평일마다 한 자씩, 약 ${Math.round(HANJA.length / 5)}주 분량이에요.</p>
        <p class="small muted">준비 중: ${UPCOMING_GRADES.join(', ')}</p>
      </div>`;
    document.getElementById('grade').addEventListener('change', (e) => {
      const g = GRADES[+e.target.value];
      S.pointer = g.start;
      save();
      renderSettings();
    });
    document.getElementById('unlock').addEventListener('change', (e) => { S.unlockAll = e.target.checked; save(); });
    document.getElementById('reset').addEventListener('click', () => {
      if (confirm('정말 모든 학습 기록을 지울까요? 되돌릴 수 없어요.')) {
        S = blankState();
        save();
        session = null;
        listGrade = null;
        location.hash = '#/';
      }
    });
  }

  function curveSvg() {
    // 복습하지 않을 때(점선)와 1일·1주 뒤 복습할 때(실선)의 기억 비교 그림
    const W = 320, H = 150, x0 = 30, y0 = 12, w = 280, h = 110;
    const X = (d) => x0 + (d / 14) * w;
    const Y = (p) => y0 + (1 - p) * h;
    const decay = (t, s) => Math.exp(-t / s);
    let noRev = '', rev = '';
    for (let d = 0; d <= 14; d += 0.25) noRev += `${d ? 'L' : 'M'}${X(d).toFixed(1)},${Y(0.25 + 0.75 * decay(d, 1.2)).toFixed(1)}`;
    const seg = (from, to, s) => {
      let p = '';
      for (let d = from; d <= to + 1e-9; d += 0.25) p += `${d === from ? 'M' : 'L'}${X(d).toFixed(1)},${Y(0.25 + 0.75 * decay(d - from, s)).toFixed(1)}`;
      return p;
    };
    rev = seg(0, 1, 1.2) + seg(1, 4, 4) + seg(4, 14, 14);
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="망각 곡선: 복습하면 기억이 오래 남아요">
      <line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + h}" stroke="currentColor" stroke-opacity=".3"/>
      <line x1="${x0}" y1="${y0 + h}" x2="${x0 + w}" y2="${y0 + h}" stroke="currentColor" stroke-opacity=".3"/>
      <path d="${noRev}" fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-dasharray="4 4"/>
      <path d="${rev}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
      <text x="${X(1)}" y="${y0 + h + 14}" font-size="10" text-anchor="middle" fill="var(--accent)">1일 후</text>
      <text x="${X(4)}" y="${y0 + h + 14}" font-size="10" text-anchor="middle" fill="var(--accent)">금요일</text>
      <text x="${X(14)}" y="${y0 + h + 14}" font-size="10" text-anchor="end" fill="var(--ink-soft)">2주</text>
      <text x="${x0 - 4}" y="${y0 + 8}" font-size="10" text-anchor="end" fill="var(--ink-soft)">기억</text>
      <text x="${X(9)}" y="${Y(0.8)}" font-size="11" fill="var(--accent)">복습했을 때</text>
      <text x="${X(9)}" y="${Y(0.18)}" font-size="11" fill="var(--ink-soft)">복습 안 했을 때</text>
    </svg>`;
  }

  /* ================= 라우터 ================= */
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    document.getElementById('today-label').textContent = koDate(today());
    document.querySelectorAll('.modal-back').forEach((m) => m.remove());
    if (parts[0] !== 'lesson' && parts[0] !== 'weekly' && parts[0] !== 'review') stopTimer();
    if (!(parts[0] === 'exam' && parts[2] === 'test')) exam = null;
    document.body.classList.remove('in-lesson');

    switch (parts[0]) {
      case 'lesson': startLesson('lesson'); break;
      case 'weekly': startLesson('weekly'); break;
      case 'review': startLesson('review'); break;
      case 'list': renderList(); break;
      case 'exam':
        if (parts[1] && parts[2] === 'test') startExam(parts[1], parts[3] || '20');
        else if (parts[1]) renderExamGrade(parts[1]);
        else renderExamHome();
        break;
      case 'settings': renderSettings(); break;
      default: renderHome();
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', route);
  route();
})();
