/*
 * 매일 한자 — 평일 아침 5분 한자 학습
 *
 * 학습 흐름 (에빙하우스 망각 곡선에 맞춘 반복)
 *   월~금: ① 1일 후 복습(지난 학습일의 한자 + 틀렸던 한자)
 *          ② 오늘의 한자 + 활용 어휘 뜻 연결하기
 *          ③ 짧은 글짓기
 *          ④ 확인 퀴즈(음훈 쓰기, 활용 어휘가 아닌 것 고르기) → 풀이
 *   금요일: 위 과정 + ⑤ 이번 주 한자 전체 복습(일주일 복습)
 *   급수 완료: '급수 시험' 코너에서 전체 복습 → 시험(어휘 제시, 뜻과 음 쓰기)
 *
 * 저장: 브라우저 localStorage (서버 없음). 이름(아이디)별로 따로 저장합니다.
 */
(() => {
  'use strict';

  const USERS_KEY = 'everyday-hanja:users';
  const CURRENT_KEY = 'everyday-hanja:current';
  const LEGACY_KEY = 'everyday-hanja:v1';
  const stateKey = (name) => `everyday-hanja:v2:${name}`;
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
  const shortDate = (ds) => { const d = parseDate(ds); return `${d.getMonth() + 1}/${d.getDate()}(${DAY[d.getDay()]})`; };

  /* ================= 저장 (학생별) ================= */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } }

  function blankState() {
    return {
      pointer: 0,      // 다음에 배울 한자를 찾기 시작하는 위치
      learned: {},     // idx -> 배운 날짜
      order: [],       // 배운 순서
      log: {},         // 날짜 -> { newIdx, reviews, week, done, quiz }
      missed: [],      // 틀린 한자(다음 복습에 다시 나옴)
      weekly: {},      // 월요일 날짜 -> 주간 복습 완료
      exams: {},       // 급수 id -> { best, last, passed, date }
      activity: [],    // 학습 활동 누적 기록
      writings: [],    // 짧은 글짓기 { date, idx, text }
      unlockAll: false,
    };
  }
  function users() {
    try { return JSON.parse(lsGet(USERS_KEY)) || []; } catch (e) { return []; }
  }
  function loadState(name) {
    try {
      const raw = lsGet(stateKey(name));
      if (raw) return Object.assign(blankState(), JSON.parse(raw));
    } catch (e) { /* 새로 시작 */ }
    return blankState();
  }
  let user = lsGet(CURRENT_KEY);
  if (user && !users().includes(user)) user = null;
  let S = user ? loadState(user) : blankState();
  function save() {
    if (user) lsSet(stateKey(user), JSON.stringify(S));
  }
  function login(name) {
    const list = users();
    if (!list.includes(name)) {
      list.push(name);
      lsSet(USERS_KEY, JSON.stringify(list));
      // 이름 기능이 생기기 전의 기록이 있으면 첫 학생에게 옮겨 줍니다.
      const legacy = lsGet(LEGACY_KEY);
      if (legacy && list.length === 1) {
        lsSet(stateKey(name), legacy);
        lsDel(LEGACY_KEY);
      }
    }
    user = name;
    lsSet(CURRENT_KEY, name);
    S = loadState(name);
    session = null;
    exam = null;
    listGrade = null;
  }
  function logout() {
    user = null;
    lsDel(CURRENT_KEY);
    S = blankState();
    session = null;
    exam = null;
  }
  function logActivity(a) {
    S.activity.push(Object.assign({ date: fmt(today()) }, a));
  }

  /* ================= 한자 도우미 ================= */
  const C = (i) => HANJA[i];
  const BY_CHAR = {};
  HANJA.forEach((c) => { BY_CHAR[c.h] = c; });
  const gradeOf = (c) => GRADES[c.gradeIdx];
  function hunum(c) {
    if (c.meanings.length === c.sounds.length) {
      return c.meanings.map((m, i) => `${m} ${c.sounds[i]}`).join(' / ');
    }
    return `${c.meanings.join(', ')} ${c.sounds.join(', ')}`;
  }
  const hl = (text, h) => text.split(h).join(`<em>${h}</em>`);
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

  // 어휘 속 한 글자의 음훈. 어휘에서 실제로 읽는 소리(두음 법칙 포함)에 맞춰 고릅니다.
  function charHunum(ch, syl) {
    let pairs;
    const c = BY_CHAR[ch];
    if (c) {
      if (c.meanings.length === c.sounds.length) pairs = c.meanings.map((m, i) => [m, c.sounds[i]]);
      else pairs = c.sounds.map((s) => [c.meanings.join('·'), s]);
    } else if (EXTRA_HUNUM[ch]) {
      pairs = EXTRA_HUNUM[ch].split('|').map((p) => {
        const k = p.lastIndexOf(' ');
        return [p.slice(0, k), p.slice(k + 1)];
      });
    } else {
      return { m: '', s: syl || '' };
    }
    for (const [m, s] of pairs) {
      if (syl === s) return { m, s };
      if (syl && syl === dueum(s)) return { m, s: syl };
    }
    return { m: pairs[0][0], s: pairs[0][1] };
  }
  function wordParts(w) {
    const read = w.read.replace(/\s/g, '');
    return [...w.word].map((ch, k) => Object.assign({ ch }, charHunum(ch, read[k])));
  }
  // 어휘 한자 + 각 글자 아래 작은 음훈
  function wordCharsHtml(w, target, showHunum = true) {
    return `<div class="wchars">${wordParts(w).map((p) => `
      <span class="wc${p.ch === target ? ' on' : ''}"><b class="hanja">${p.ch}</b>${showHunum ? `<small>${p.m} ${p.s}</small>` : ''}</span>`).join('')}</div>`;
  }


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
  function gradeLearnedCount(g, st = S) {
    let n = 0;
    for (let i = g.start; i < g.end; i++) if (st.learned[i]) n++;
    return n;
  }
  const gradeComplete = (g) => gradeLearnedCount(g) === g.end - g.start;
  const examOpen = (g) => S.unlockAll || gradeComplete(g);

  function streak(st = S) {
    let d = today();
    let n = 0;
    if (!(st.log[fmt(d)] && st.log[fmt(d)].done)) d = addDays(d, -1);
    for (let guard = 0; guard < 4000; guard++) {
      if (isWeekday(d)) {
        const e = st.log[fmt(d)];
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

  /* ================= 어휘 도우미 ================= */
  const ALL_WORDS = HANJA.flatMap((c) => c.words.map((w, k) => ({ ...w, owner: c.idx, k })));
  const BY_READ = {};
  ALL_WORDS.forEach((w) => { (BY_READ[w.read] = BY_READ[w.read] || []).push(w); });
  const plainRead = (w) => w.read.replace(/\s/g, '');
  // 어휘 속 오늘 한자의 자리(몇 번째 글자)와 그 소리
  function targetPos(c, w) {
    const k = [...w.word].indexOf(c.h);
    return { k, syl: plainRead(w)[k] };
  }
  // 한글 어휘에서 오늘 한자 자리만 색으로 표시
  function hangulMarked(c, w) {
    const { k } = targetPos(c, w);
    return [...plainRead(w)].map((ch, j) => (j === k ? `<mark>${ch}</mark>` : ch)).join('');
  }
  // 한글 어휘 + 각 글자 아래 음훈(한자 없이)
  function hangulPartsHtml(w, target) {
    return `<div class="wchars">${wordParts(w).map((p) => `
      <span class="wc${p.ch === target ? ' on' : ''}"><b>${p.s}</b><small>${p.m} ${p.s}</small></span>`).join('')}</div>`;
  }
  // 같은 소리를 가진 한자들(복습 보기용)
  const SOUND_INDEX = {};
  function addSound(ch, m, s) {
    [s, dueum(s)].forEach((x) => {
      (SOUND_INDEX[x] = SOUND_INDEX[x] || []);
      if (!SOUND_INDEX[x].some((e) => e.ch === ch)) SOUND_INDEX[x].push({ ch, t: `${m} ${s}` });
    });
  }
  HANJA.forEach((c) => c.sounds.forEach((s, i) => addSound(c.h, c.meanings[Math.min(i, c.meanings.length - 1)], s)));
  Object.entries(EXTRA_HUNUM).forEach(([ch, v]) => v.split('|').forEach((p) => {
    const k = p.lastIndexOf(' ');
    addSound(ch, p.slice(0, k), p.slice(k + 1));
  }));
  function blankSentence(c, k) {
    const s = SENTENCES[c.h][k];
    const r = c.words[k].read;
    const at = s.indexOf(r);
    return { before: s.slice(0, at), after: s.slice(at + r.length) };
  }

  /* ================= 문제 만들기 ================= */
  // 복습: 한글 어휘의 표시된 글자에 쓰인 한자의 음훈 고르기(소리가 같은 한자들 중에서)
  function soundQuestion(i, stage) {
    const c = C(i);
    const w = pick(c.words);
    const { syl } = targetPos(c, w);
    const own = charHunum(c.h, syl);
    const answer = `${own.m} ${own.s}`;
    const opts = [answer];
    shuffle(SOUND_INDEX[syl] || []).forEach((e) => {
      if (opts.length < 4 && e.ch !== c.h && !opts.includes(e.t)) opts.push(e.t);
    });
    shuffle(HANJA).forEach((x) => {
      const t = `${x.meanings[0]} ${x.sounds[0]}`;
      if (opts.length < 4 && x.idx !== i && !opts.includes(t)) opts.push(t);
    });
    return { kind: 'pick', type: 'sound', idx: i, stage, word: w, options: shuffle(opts), answer };
  }
  // 복습: 음훈을 보고 어휘의 뜻 고르기
  function meaningQuestion(i, stage) {
    const c = C(i);
    const w = pick(c.words);
    const pool = shuffle(ALL_WORDS.filter((x) => x.mean !== w.mean));
    const same = pool.filter((x) => C(x.owner).gradeIdx === c.gradeIdx);
    const opts = [w.mean];
    same.concat(pool).forEach((x) => { if (opts.length < 4 && !opts.includes(x.mean)) opts.push(x.mean); });
    return { kind: 'pick', type: 'meaning', idx: i, stage, word: w, options: shuffle(opts), answer: w.mean };
  }
  // 어휘 추론: 오늘의 한자가 쓰이지 않은 어휘(소리는 같은 글자가 들어 있음) 고르기
  // 뜻풀이를 두 글자씩 끊어 비교합니다. '하는', '에서'처럼 흔한 조각은 뜻 비교에서 뺍니다.
  function rawBigrams(s) {
    const out = new Set();
    s.split(/[\s·(),]+/).forEach((t) => { for (let j = 0; j < t.length - 1; j++) out.add(t.slice(j, j + 2)); });
    return out;
  }
  const BIGRAM_DF = {};
  ALL_WORDS.forEach((w) => rawBigrams(w.mean).forEach((b) => { BIGRAM_DF[b] = (BIGRAM_DF[b] || 0) + 1; }));
  function bigrams(s) {
    return new Set([...rawBigrams(s)].filter((b) => (BIGRAM_DF[b] || 0) <= 12));
  }
  function inferQuestion(i) {
    const c = C(i);
    const sounds = new Set(c.sounds.flatMap((s) => [s, dueum(s)]));
    const own = new Set(c.words.map((w) => w.read));
    const ctx = bigrams(c.words.map((w) => w.mean).join(' ') + ' ' + c.meanings.join(' '));
    // 한글로만 보여 주므로, 같은 읽기의 다른 어휘에 오늘 한자가 쓰였다면 제외합니다. (예: 數 — 산수(山水)는 산수(算數)와 헷갈림)
    const usesToday = (w) => (BY_READ[w.read] || []).some((x) => x.word.includes(c.h));
    let cands = ALL_WORDS.filter((w) => !usesToday(w) && !own.has(w.read)
      && [...plainRead(w)].some((ch) => sounds.has(ch)));
    if (!cands.length) cands = ALL_WORDS.filter((w) => !usesToday(w) && !own.has(w.read) && C(w.owner).gradeIdx <= c.gradeIdx);
    // 오늘 어휘들과 뜻이 겹치지 않는(헷갈리지 않는) 어휘를 고릅니다.
    // 어휘의 뜻뿐 아니라, 같은 소리 글자가 쓰인 다른 어휘들의 뜻까지 비교합니다. (예: 敎와 校는 둘 다 '선생님'과 관련 있어 제외)
    const overlap = (text) => { let n = 0; bigrams(text).forEach((b) => { if (ctx.has(b)) n++; }); return n; };
    const scored = cands.map((w) => {
      const p = wordParts(w).find((x) => sounds.has(x.s));
      const rel = p && BY_CHAR[p.ch] ? BY_CHAR[p.ch].words.map((x) => x.mean).join(' ') + ' ' + BY_CHAR[p.ch].meanings.join(' ') : (p ? p.m : '');
      // 뜻이 겹치지 않는 것이 먼저, 그다음 오늘 급수보다 쉬운(이미 배운) 어휘를 고릅니다.
      return { w, n: overlap(w.mean) * 2 + overlap(rel) + (C(w.owner).gradeIdx > c.gradeIdx ? 0.5 : 0) };
    }).sort((a, b) => a.n - b.n);
    const best = scored.filter((x) => x.n === scored[0].n);
    const odd = pick(best.length >= 2 ? best : scored.slice(0, 2)).w;
    return {
      kind: 'infer', idx: i, stage: 'infer',
      options: shuffle(shuffle(c.words).slice(0, 3).concat([odd])), odd: odd.read, chosen: null,
    };
  }

  /* ================= 학습 세션 ================= */
  let session = null;
  let timerId = null;

  const STAGES = {
    review: { n: 0, t: '어제 배운 한자 복습', e: '🔁', c: 'review' },
    missed: { n: 0, t: '틀렸던 한자 다시 보기', e: '🔁', c: 'review' },
    learn: { n: 1, t: '오늘의 한자', e: '🌟', c: 's1' },
    match: { n: 2, t: '활용 어휘 ①', sub: '뜻 연결하기', e: '🔗', c: 's2' },
    cloze: { n: 3, t: '활용 어휘 ②', sub: '빈칸 채우기', e: '🧩', c: 's3' },
    check: { n: 4, t: '확인하기', e: '✅', c: 's4' },
    write: { n: 5, t: '적용하기', sub: '짧은 글짓기', e: '✏️', c: 's5' },
    infer: { n: 6, t: '어휘 추론', e: '🔍', c: 's6' },
    week: { n: 0, t: '일주일 복습', e: '⭐', c: 'week' },
    free: { n: 0, t: '자유 복습', e: '🎲', c: 'review' },
  };
  function stageHtml(key) {
    const s = STAGES[key];
    return `<div class="stage stage-${s.c}"><span class="stage-e">${s.e}</span>
      ${s.n ? `<span class="stage-n">${s.n}</span>` : ''}<b>${s.t}</b>${s.sub ? `<span class="stage-sub">${s.sub}</span>` : ''}</div>`;
  }

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
      const stage = k === 0 ? 'review' : 'missed';
      steps.push(soundQuestion(i, stage));
      if (k === 0) steps.push(meaningQuestion(i, stage));
    });
    if (plan.newIdx !== null) {
      const i = plan.newIdx;
      const c = C(i);
      steps.push({ kind: 'learn', idx: i, stage: 'learn' });
      steps.push({ kind: 'match', idx: i, stage: 'match', order: shuffle(c.words.map((_, k) => k)), done: [], selL: null, selR: null });
      const order = shuffle(c.words.map((_, k) => k));
      steps.push({ kind: 'cloze', idx: i, stage: 'cloze', order, filled: [], cur: order[0] });
      steps.push({ kind: 'check', idx: i, stage: 'check', word: pick(c.words), m: '', s: '', graded: false });
      steps.push({ kind: 'write', idx: i, stage: 'write', text: '' });
      steps.push(inferQuestion(i));
    }
    if (plan.week.length) {
      steps.push({ kind: 'weekIntro', list: plan.week, stage: 'week' });
      plan.week.filter((i) => i !== plan.newIdx).forEach((i) => steps.push(soundQuestion(i, 'week')));
      shuffle(plan.week).slice(0, 2).forEach((i) => steps.push(meaningQuestion(i, 'week')));
      steps.push({ kind: 'weekSummary', list: plan.week, stage: 'week' });
    }
    steps.push({ kind: 'done' });
    return { type: 'lesson', plan, date: fmt(today()), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildWeekly() {
    const t = today();
    const list = learnedInWeek(t);
    const steps = [{ kind: 'weekIntro', list, stage: 'week' }];
    list.forEach((i) => steps.push(soundQuestion(i, 'week')));
    shuffle(list).slice(0, 2).forEach((i) => steps.push(meaningQuestion(i, 'week')));
    steps.push({ kind: 'weekSummary', list, stage: 'week' });
    steps.push({ kind: 'done' });
    return { type: 'weekly', week: fmt(mondayOf(t)), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildFreeReview() {
    const missed = S.missed.filter((i) => S.learned[i]);
    const rest = shuffle(S.order.filter((i) => !missed.includes(i)));
    const list = shuffle(missed).concat(rest).slice(0, 5);
    const steps = [];
    list.forEach((i, k) => steps.push(k % 2 ? meaningQuestion(i, 'free') : soundQuestion(i, 'free')));
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
    S.log[ds] = Object.assign({}, session.plan, S.log[ds] || {}, { done: false });
    save();
  }

  function finishSession() {
    const quiz = { correct: session.correct, total: session.total };
    if (session.type === 'lesson') {
      const e = S.log[session.date] || Object.assign({}, session.plan);
      e.done = true;
      e.quiz = quiz;
      S.log[session.date] = e;
      if (session.plan.week.length) S.weekly[fmt(mondayOf(parseDate(session.date)))] = true;
      logActivity({ type: 'lesson', idx: session.plan.newIdx, week: session.plan.week.length > 0, ...quiz });
    } else if (session.type === 'weekly') {
      S.weekly[session.week] = true;
      logActivity({ type: 'weekly', ...quiz });
    } else {
      logActivity({ type: 'review', ...quiz });
    }
    save();
  }
  function score(ok, i) {
    session.total++;
    if (ok) { session.correct++; removeMissed(i); } else addMissed(i);
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
  // 한자 카드(목록에서 누르면 보이는 정리 화면)
  function charCardHtml(c) {
    const words = c.words.map((w) => `
      <div class="word">
        ${wordCharsHtml(w, c.h)}
        <div class="word-r">${w.read}</div>
        <div class="word-m">${w.mean}</div>
      </div>`).join('');
    return `${charHeadHtml(c)}
      <h3 class="sec-title">활용 어휘</h3>
      <div class="words">${words}</div>`;
  }
  function charHeadHtml(c) {
    const pairs = c.meanings.length === c.sounds.length
      ? c.meanings.map((m, k) => [m, c.sounds[k]]) : [[c.meanings.join(', '), c.sounds.join(', ')]];
    return `
      <div class="char-card">
        <span class="pill">${c.gradeName}</span>
        <div class="big-hanja">${c.h}</div>
        <div class="hunum-boxes">${pairs.map(([m, s]) => `
          <div class="hb"><span class="hb-l">뜻(훈)</span><b>${m}</b></div>
          <div class="hb snd"><span class="hb-l">소리(음)</span><b>${s}</b></div>`).join('')}</div>
        <div class="hunum-read">"${hunum(c)}"</div>
      </div>`;
  }
  function bindOpen(root = $app) {
    root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
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
  }
  function breakdown(w) {
    return `${w.read} = ${wordParts(w).map((p) => `<span class="hj">${p.ch}</span>(${p.m} ${p.s})`).join(' + ')} → <b>${w.mean}</b>`;
  }

  /* ================= 화면: 입장 ================= */
  function renderLogin() {
    document.body.classList.add('logged-out');
    const list = users();
    $app.innerHTML = `
      <div class="card hero login">
        <div class="login-mark">漢</div>
        <h1>매일 한자</h1>
        <p class="muted">평일 아침 5분, 하루 한 자씩<br>뜻과 음을 익혀요!</p>
        <form id="login" autocomplete="off">
          <label for="name">내 이름(아이디)</label>
          <input id="name" class="text-input" maxlength="20" placeholder="예) 3학년 2반 김하늘" required>
          <button class="btn block">입장하기 🚀</button>
        </form>
      </div>
      ${list.length ? `<div class="card">
        <h3>이 기기에서 공부한 친구들</h3>
        <p class="small muted">내 이름을 누르면 이어서 공부할 수 있어요.</p>
        <div class="name-list">${list.map((n) => `<button class="btn soft" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      </div>` : ''}
      <p class="small muted center">학습 기록은 이 기기(브라우저)에 이름별로 저장돼요.</p>`;
    const enter = (n) => { login(n); location.hash = '#/'; route(); };
    document.getElementById('login').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = document.getElementById('name').value.trim().replace(/\s+/g, ' ');
      if (n) enter(n);
    });
    $app.querySelectorAll('[data-name]').forEach((b) => b.addEventListener('click', () => enter(b.dataset.name)));
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
      <div class="card welcome">
        <h2>반가워요, ${esc(user)}! 👋</h2>
        <p>평일 아침 <b>5분</b>, 하루에 한자 <b>한 자</b>씩 뜻과 음을 익혀요.
        글자 모양은 외우지 않아도 돼요. 음훈으로 낱말의 뜻을 짐작하는 힘을 길러요!</p>
        <p class="small muted">이미 아는 급수가 있다면 <a href="#/settings">설정</a>에서 시작 급수를 바꿀 수 있어요.</p>
      </div>`;
    }

    if (isWeekday(t)) {
      if (entry && entry.done) {
        const c = entry.newIdx !== null && entry.newIdx !== undefined ? C(entry.newIdx) : null;
        main += `
        <div class="card hero">
          <div class="dayname">${DAY[t.getDay()]}요일 학습 완료! 🎉</div>
          ${c ? `<div class="big-hanja">${c.h}</div><div class="hunum-read">${hunum(c)}</div>` : ''}
          <p class="muted">${t.getDay() === 5 ? '한 주 동안 수고했어요! 주말엔 푹 쉬어요.' : '잘했어요! 내일 아침에 복습으로 다시 만나요.'}</p>
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
        const rows = [];
        if (plan.reviews.length) rows.push(['🔁', '', `어제 배운 한자 복습`]);
        ['learn', 'match', 'cloze', 'check', 'write', 'infer'].forEach((k) => {
          const s = STAGES[k];
          rows.push([s.e, s.n, `${s.t}${s.sub ? ` <span class="muted">· ${s.sub}</span>` : ''}`, s.c]);
        });
        if (plan.week.length) rows.push(['⭐', '', `일주일 복습 · 이번 주 ${plan.week.length}자`, 'week']);
        main += `
        <div class="card hero today-card">
          <div class="dayname">${DAY[t.getDay()]}요일 아침 · ${c.gradeName} ${c.idx - gradeOf(c).start + 1}번째 한자</div>
          <div class="big-hanja mystery">${started ? c.h : '?'}</div>
          <p class="muted">${started ? '하던 학습을 이어서 해요.' : '오늘은 어떤 한자를 만날까요?'}</p>
          <ol class="steps">${rows.map(([e, n, txt, cls]) => `<li class="${cls ? `st-${cls}` : ''}"><span class="num">${n || e}</span><span>${txt}</span></li>`).join('')}</ol>
          <a class="btn block big" href="#/lesson">${started ? '이어서 하기' : '오늘의 학습 시작!'} · 약 5분</a>
        </div>`;
      }
    } else {
      const wk = learnedInWeek(t);
      const wkKey = fmt(mondayOf(t));
      main += `
      <div class="card hero">
        <div class="big-hanja">休</div>
        <div class="hunum-read">쉴 휴</div>
        <p class="muted">주말은 쉬는 날이에요. 월요일 아침에 새 한자로 만나요! 😊</p>
        ${wk.length >= 2 && !S.weekly[wkKey]
          ? `<p class="small">이번 주 <b>일주일 복습</b>을 아직 안 했어요.</p><a class="btn block" href="#/weekly">⭐ 일주일 복습 하기</a>`
          : ''}
        ${learnedN ? `<a class="btn soft block" href="#/review" style="margin-top:10px">🎲 자유 복습 (5문제)</a>` : ''}
      </div>`;
    }

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

    const days = weekDates(t);
    const cells = days.map((d, k) => {
      const e = S.log[d];
      const idx = e && e.newIdx !== null && e.newIdx !== undefined && S.learned[e.newIdx] === d ? e.newIdx : null;
      const cls = [e && e.done ? 'done' : '', d === ds ? 'today' : ''].join(' ');
      return `<div class="d ${cls}"><div class="lbl">${DAY[k + 1]}</div>
        <div class="cell">${idx !== null ? `<button class="cell-in hanja" data-open="${idx}">${C(idx).h}</button>` : (e && e.done ? '✔' : '')}</div></div>`;
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
          <div><b>${streak()}</b><span>🔥 연속 학습일</span></div>
          <div><b>${learnedN}</b><span>📚 배운 한자</span></div>
          <div><b>${S.writings.length}</b><span>✏️ 글짓기</span></div>
        </div>
        <div class="row" style="margin-top:16px"><b>${cur.name}</b><span class="spacer"></span><span class="small muted">${curN} / ${curT}자</span></div>
        <div class="progress" style="margin-top:6px"><span style="width:${(curN / curT) * 100}%"></span></div>
      </div>`;

    $app.innerHTML = main;
    bindOpen();
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
      if (el && session) el.textContent = elapsed(session.started);
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

  // 오늘 학습 1~6단계 진행 표시
  function trackerHtml(step) {
    if (session.type !== 'lesson' || session.plan.newIdx === null) return '';
    const cur = STAGES[step.stage] ? STAGES[step.stage].n : 0;
    const passed = step.kind === 'done' || step.stage === 'week';
    return `<div class="tracker">${['learn', 'match', 'cloze', 'check', 'write', 'infer'].map((k) => {
      const s = STAGES[k];
      const cls = passed || (cur && s.n < cur) ? 'done' : s.n === cur ? 'now' : '';
      return `<span class="tk tk-${s.c} ${cls}" title="${s.t}">${cls === 'done' ? '✓' : s.n}</span>`;
    }).join('<i></i>')}</div>`;
  }

  function renderStep() {
    const step = session.steps[session.i];
    const pct = (session.i / (session.steps.length - 1)) * 100;
    const head = step.kind === 'done' ? '' : `
      <div class="lesson-head">
        <button class="close-x" id="quit" aria-label="그만하기">✕</button>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <span class="timer" id="timer">${elapsed(session.started)}</span>
      </div>${trackerHtml(step)}`;
    const R = {
      learn: renderLearn, match: renderMatch, cloze: renderCloze, check: renderCheck, write: renderWrite,
      infer: renderInfer, pick: renderPick, weekIntro: renderWeekIntro, weekSummary: renderWeekSummary, done: renderDone,
    };
    $app.innerHTML = head + R[step.kind](step);
    const quit = document.getElementById('quit');
    if (quit) quit.addEventListener('click', () => { location.hash = '#/'; });
    const B = {
      learn: () => document.getElementById('next').addEventListener('click', () => { commitLearn(step.idx); nextStep(); }),
      match: bindMatch, cloze: bindCloze, check: bindCheck, write: bindWrite, infer: bindInfer, pick: bindPick,
      weekIntro: () => document.getElementById('next').addEventListener('click', nextStep),
      weekSummary: () => document.getElementById('next').addEventListener('click', nextStep),
    };
    if (B[step.kind]) B[step.kind](step);
    bindOpen();
  }
  const nextBtn = (label = '다음 →') => `<button class="btn block big" id="next">${label}</button>`;
  function bindNext() {
    const b = document.getElementById('next');
    if (b) { b.addEventListener('click', nextStep); b.focus({ preventScroll: true }); }
  }

  // 1. 오늘의 한자
  function renderLearn(step) {
    const c = C(step.idx);
    return `<div class="card lesson-card">${stageHtml('learn')}${charHeadHtml(c)}
      <p class="center tip">💡 '${hunum(c)}'처럼 <b>뜻</b>과 <b>소리</b>를 함께 읽어 보세요.</p>
      ${nextBtn('활용 어휘 만나러 가기 →')}</div>`;
  }

  // 2. 활용 어휘 ① — 왼쪽(한자+음훈)과 오른쪽(뜻)을 선으로 연결
  function renderMatch(step) {
    const c = C(step.idx);
    const all = step.done.length === c.words.length;
    const left = c.words.map((w, k) => {
      const ok = step.done.includes(k);
      return `<button class="mbox ml${ok ? ' ok' : ''}${step.selL === k ? ' sel' : ''}" data-w="${k}" ${ok ? 'disabled' : ''}>
        ${wordCharsHtml(w, c.h)}<span class="dot"></span></button>`;
    }).join('');
    const right = step.order.map((k) => {
      const ok = step.done.includes(k);
      return `<button class="mbox mr${ok ? ' ok' : ''}${step.selR === k ? ' sel' : ''}" data-m="${k}" ${ok ? 'disabled' : ''}>
        <span class="dot"></span>${c.words[k].mean}</button>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('match')}
      <p class="guide">${all ? '🎉 모두 연결했어요! 한자의 <b>음훈</b>이 어휘의 <b>뜻</b>과 어떻게 이어지는지 살펴보세요.'
        : '한자 아래 <b>음훈</b>을 힌트로 어휘와 알맞은 <b>뜻</b>을 차례로 눌러 <b>선으로 연결</b>해요.'}</p>
      <div class="mboard" id="mboard">
        <div class="mcol">${left}</div>
        <div class="mcol">${right}</div>
        <svg class="mlines" id="mlines" aria-hidden="true"></svg>
      </div>
      <div id="fb"></div>
      ${all ? `<div class="sum-list">${c.words.map((w) => `<div>${breakdown(w)}</div>`).join('')}</div>${nextBtn('빈칸 채우기 →')}` : ''}
    </div>`;
  }
  const LINE_COLORS = ['var(--s2)', 'var(--s1)', 'var(--s4)', 'var(--s3)'];
  function drawLines() {
    const board = document.getElementById('mboard');
    const svg = document.getElementById('mlines');
    const step = session && session.steps[session.i];
    if (!board || !svg || !step || step.kind !== 'match') return;
    const b = board.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
    svg.innerHTML = step.done.map((k, n) => {
      const L = board.querySelector(`[data-w="${k}"]`).getBoundingClientRect();
      const R = board.querySelector(`[data-m="${k}"]`).getBoundingClientRect();
      const x1 = L.right - b.left, y1 = L.top + L.height / 2 - b.top;
      const x2 = R.left - b.left, y2 = R.top + R.height / 2 - b.top;
      const col = LINE_COLORS[n % LINE_COLORS.length];
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="${x1}" cy="${y1}" r="6" fill="${col}"/><circle cx="${x2}" cy="${y2}" r="6" fill="${col}"/>`;
    }).join('');
  }
  window.addEventListener('resize', drawLines);
  function bindMatch(step) {
    const c = C(step.idx);
    requestAnimationFrame(drawLines);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawLines);
    if (step.done.length === c.words.length) { bindNext(); return; }
    const tryPair = () => {
      if (step.selL === null || step.selR === null) return renderStep();
      if (step.selL === step.selR) {
        step.done.push(step.selL);
        step.selL = step.selR = null;
        renderStep();
      } else {
        const w = c.words[step.selL];
        const L = $app.querySelector(`[data-w="${step.selL}"]`);
        const R = $app.querySelector(`[data-m="${step.selR}"]`);
        [L, R].forEach((x) => x.classList.add('shake', 'bad'));
        document.getElementById('fb').innerHTML = `<div class="feedback no">앗, 다시 생각해 봐요! 🤔
          <b>${w.read}</b> = ${wordParts(w).map((p) => `${p.m} ${p.s}`).join(' + ')}</div>`;
        step.selL = step.selR = null;
        setTimeout(() => { [L, R].forEach((x) => x.classList.remove('shake', 'bad', 'sel')); }, 600);
      }
    };
    $app.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => { step.selL = +b.dataset.w; tryPair(); }));
    $app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { step.selR = +b.dataset.m; tryPair(); }));
  }

  // 3. 활용 어휘 ② — 빈칸에 알맞은 어휘 넣기
  function renderCloze(step) {
    const c = C(step.idx);
    const all = step.filled.length === c.words.length;
    const bank = c.words.map((w, k) => {
      const used = step.filled.includes(k);
      return `<button class="chip bank${used ? ' used' : ''}" data-k="${k}" ${used || all ? 'disabled' : ''}>
        <b>${w.read}</b><small class="hanja">${w.word}</small></button>`;
    }).join('');
    const items = step.order.map((k, n) => {
      const { before, after } = blankSentence(c, k);
      const filled = step.filled.includes(k);
      const cur = !all && step.cur === k;
      return `<li class="cz${cur ? ' cur' : ''}${filled ? ' ok' : ''}" data-s="${k}"><span class="cz-n">${n + 1}</span>
        <span>${esc(before)}<span class="blank">${filled ? c.words[k].read : cur ? '?' : '&nbsp;&nbsp;&nbsp;'}</span>${esc(after)}</span></li>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('cloze')}
      <p class="guide">${all ? '🎉 빈칸을 모두 채웠어요!' : '빈칸에 들어갈 알맞은 <b>활용 어휘</b>를 아래에서 골라요.'}</p>
      <ol class="cloze">${items}</ol>
      <div class="bank-wrap"><div class="bank-title">활용 어휘</div><div class="chips">${bank}</div></div>
      <div id="fb"></div>
      ${all ? nextBtn('확인하기 →') : ''}
    </div>`;
  }
  function bindCloze(step) {
    const c = C(step.idx);
    if (step.filled.length === c.words.length) { bindNext(); return; }
    $app.querySelectorAll('[data-s]').forEach((li) => li.addEventListener('click', () => {
      const k = +li.dataset.s;
      if (!step.filled.includes(k)) { step.cur = k; renderStep(); }
    }));
    $app.querySelectorAll('.bank').forEach((b) => b.addEventListener('click', () => {
      const k = +b.dataset.k;
      if (k === step.cur) {
        step.filled.push(k);
        const left = step.order.filter((x) => !step.filled.includes(x));
        step.cur = left.length ? left[0] : null;
        renderStep();
      } else {
        const w = c.words[k];
        b.classList.add('shake', 'bad');
        setTimeout(() => b.classList.remove('shake', 'bad'), 600);
        document.getElementById('fb').innerHTML = `<div class="feedback no">🤔 '<b>${w.read}</b>'은(는) '${w.mean}'이라는 뜻이에요. 이 문장에 어울리는지 다시 생각해 봐요.</div>`;
      }
    }));
  }

  // 4. 확인하기 — 한글 어휘의 표시된 글자에 쓰인 한자의 뜻과 음 쓰기 (바로 채점, 틀리면 해설)
  function wordQuestionHtml(c, w) {
    return `<div class="quiz-q">
        <div class="qword">${hangulMarked(c, w)}</div>
        <div class="qhint">뜻: ${w.mean}</div>
        <div class="prompt"><mark>색으로 표시된 글자</mark>에 쓰인 한자의 <b>뜻(훈)</b>과 <b>음</b>을 쓰세요.</div>
      </div>`;
  }
  function renderCheck(step) {
    const c = C(step.idx);
    return `<div class="card lesson-card">${stageHtml('check')}
      ${wordQuestionHtml(c, step.word)}
      <form id="f" autocomplete="off">
        <div class="exam-inputs">
          <div><label for="m">뜻 (훈)</label><input id="m" lang="ko" value="${esc(step.m)}" ${step.graded ? 'readonly' : ''}></div>
          <div><label for="s">음 (소리)</label><input id="s" lang="ko" value="${esc(step.s)}" ${step.graded ? 'readonly' : ''}></div>
        </div>
        <div id="fb">${step.graded ? checkFeedback(step) : ''}</div>
        ${step.graded ? nextBtn('적용하기 →') : '<button class="btn block big" id="go">정답 확인</button>'}
      </form>
    </div>`;
  }
  function checkFeedback(step) {
    const c = C(step.idx);
    const w = step.word;
    const { syl } = targetPos(c, w);
    const own = charHunum(c.h, syl);
    if (step.ok) return `<div class="feedback ok">⭕ 정답이에요! '${w.read}'의 '${syl}'은(는) <b>${own.m} ${own.s}</b>(<span class="hj">${c.h}</span>)예요.</div>`;
    const why = [];
    if (!step.okM) why.push(`뜻을 '<b>${esc(step.m)}</b>'(이)라고 썼어요. 이 글자의 뜻(훈)은 '<b>${c.meanings.join(', ')}</b>'이에요.`);
    if (!step.okS) why.push(`음을 '<b>${esc(step.s)}</b>'(이)라고 썼어요. 이 글자의 소리(음)는 '<b>${c.sounds.join(', ')}</b>'이에요.`);
    if (!c.sounds.includes(syl)) why.push(`'${w.read}'에서는 '${syl}'(으)로 읽지만 본래 소리는 '${c.sounds[0]}'이에요. (두음 법칙)`);
    return `<div class="feedback no">❌ 정답은 <b>${own.m} ${own.s}</b>(<span class="hj">${c.h}</span>)예요.</div>
      <div class="explain"><div class="why"><b>틀린 까닭</b> ${why.join(' ')}</div>
      <div class="solve"><b>해설</b> ${breakdown(w)}<br>'${own.m}'이라는 뜻이 어휘의 뜻 '${w.mean}'에 들어 있어요.</div></div>`;
  }
  function bindCheck(step) {
    if (step.graded) { bindNext(); return; }
    const c = C(step.idx);
    const m = document.getElementById('m');
    const s = document.getElementById('s');
    m.focus();
    document.getElementById('f').addEventListener('submit', (e) => {
      e.preventDefault();
      step.m = m.value.trim();
      step.s = s.value.trim();
      if (!step.m || !step.s) {
        document.getElementById('fb').innerHTML = '<div class="feedback no">뜻과 음을 모두 써 주세요. 모르면 짐작해서 써도 괜찮아요!</div>';
        (step.m ? s : m).focus();
        return;
      }
      step.okM = meaningOk(c, step.m);
      step.okS = soundOk(c, step.s);
      step.ok = step.okM && step.okS;
      step.graded = true;
      score(step.ok, step.idx);
      S.log[session.date] = Object.assign(S.log[session.date] || {}, { check: step.ok });
      save();
      renderStep();
    });
  }

  // 5. 적용하기 — 짧은 글짓기
  function usedWord(c, text) {
    const t = text.replace(/\s/g, '');
    return c.words.find((w) => t.includes(plainRead(w)) || t.includes(w.word)) || null;
  }
  function renderWrite(step) {
    const c = C(step.idx);
    const chips = c.words.map((w) => `<button type="button" class="chip" data-read="${w.read}"><b>${w.read}</b><small>${w.mean}</small></button>`).join('');
    return `<div class="card lesson-card">${stageHtml('write')}
      <p class="guide">오늘 배운 낱말을 <b>하나 이상</b> 넣어 짧은 글을 지어 보세요. 낱말을 누르면 글에 들어가요.</p>
      <div class="chips">${chips}</div>
      <textarea id="text" class="text-input" rows="3" maxlength="200" placeholder="예) ${esc(c.ex.replace(/\([^)]*\)/, ''))}">${esc(step.text)}</textarea>
      <div id="fb"></div>
      <button class="btn block big" id="save">글 저장하고 다음 →</button>
    </div>`;
  }
  function bindWrite(step) {
    const c = C(step.idx);
    const ta = document.getElementById('text');
    ta.addEventListener('input', () => { step.text = ta.value; });
    $app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + b.dataset.read + ta.value.slice(ta.selectionEnd ?? pos);
      step.text = ta.value;
      ta.focus();
    }));
    document.getElementById('save').addEventListener('click', () => {
      const text = ta.value.trim();
      const fb = document.getElementById('fb');
      if (text.length < 5) {
        fb.innerHTML = '<div class="feedback no">조금 더 길게, 한 문장으로 써 보세요.</div>';
        return;
      }
      const w = usedWord(c, text);
      if (!w) {
        fb.innerHTML = `<div class="feedback no">배운 낱말(${c.words.map((x) => x.read).join(', ')}) 가운데 하나를 넣어 써 보세요.</div>`;
        return;
      }
      const ds = session.date;
      S.writings = S.writings.filter((x) => !(x.date === ds && x.idx === step.idx));
      S.writings.push({ date: ds, idx: step.idx, word: w.word, text });
      save();
      nextStep();
    });
  }

  // 6. 어휘 추론 — 오늘의 한자가 쓰이지 않은 어휘 고르기 (보기는 한글만, 바로 채점, 맞아도 해설)
  function renderInfer(step) {
    const c = C(step.idx);
    const answered = step.chosen !== null;
    const opts = step.options.map((w, k) => {
      let cls = '';
      if (answered && w.read === step.odd) cls = ' correct';
      else if (answered && w.read === step.chosen) cls = ' wrong';
      return `<button class="opt big-opt${cls}" data-k="${k}" ${answered ? 'disabled' : ''}><span class="opt-n">${k + 1}</span>${w.read}</button>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('infer')}
      <div class="quiz-q">
        <div class="today-chip"><span class="hanja">${c.h}</span> ${hunum(c)}</div>
        <div class="prompt">오늘의 한자 '<b>${hunum(c)}</b>'가 쓰이지 <b class="neg">않은</b> 어휘는 무엇일까요?</div>
        <div class="qhint">소리가 같아도 뜻이 다를 수 있어요. 낱말의 뜻을 떠올려 보세요!</div>
      </div>
      <div class="options">${opts}</div>
      <div id="fb">${answered ? inferFeedback(step) : ''}</div>
      ${answered ? nextBtn(session.plan && session.plan.week.length ? '일주일 복습 →' : '마치기 →') : ''}
    </div>`;
  }
  function inferFeedback(step) {
    const c = C(step.idx);
    const oddW = step.options.find((w) => w.read === step.odd);
    const sounds = new Set(c.sounds.flatMap((s) => [s, dueum(s)]));
    const look = wordParts(oddW).find((p) => sounds.has(p.s));
    const oddWhy = look
      ? `'${oddW.read}'의 '${look.s}'은(는) <span class="hj">${look.ch}</span>(${look.m} ${look.s})예요. 소리는 같지만 '${hunum(c)}'와 뜻이 달라요.`
      : `'${oddW.read}'에는 '${hunum(c)}'가 들어 있지 않아요.`;
    const ok = step.chosen === step.odd;
    let why = '';
    if (!ok) {
      const chosen = step.options.find((w) => w.read === step.chosen);
      why = `<div class="why"><b>틀린 까닭</b> 고른 '${chosen.read}'에는 오늘의 한자 '${hunum(c)}'가 쓰였어요. ${breakdown(chosen)}</div>`;
    }
    const others = step.options.filter((w) => w.read !== step.odd).map((w) => `<li>${breakdown(w)}</li>`).join('');
    return `<div class="feedback ${ok ? 'ok' : 'no'}">${ok ? '⭕ 정답이에요! 잘 추론했어요.' : `❌ 정답은 '${oddW.read}'예요.`}</div>
      <div class="explain">${why}
        <div class="solve"><b>해설</b> ${breakdown(oddW)}<br>${oddWhy}</div>
        <div class="solve"><b>'${hunum(c)}'가 쓰인 어휘</b><ul class="plain-list">${others}</ul></div>
      </div>`;
  }
  function bindInfer(step) {
    if (step.chosen !== null) { bindNext(); return; }
    $app.querySelectorAll('.big-opt').forEach((b) => b.addEventListener('click', () => {
      step.chosen = step.options[+b.dataset.k].read;
      const ok = step.chosen === step.odd;
      score(ok, step.idx);
      S.log[session.date] = Object.assign(S.log[session.date] || {}, { infer: ok });
      save();
      renderStep();
    }));
  }

  // 복습 문제(객관식, 바로 채점)
  function renderPick(step) {
    const c = C(step.idx);
    const w = step.word;
    let q;
    if (step.type === 'sound') {
      q = `<div class="qword">${hangulMarked(c, w)}</div><div class="qhint">뜻: ${w.mean}</div>
        <div class="prompt"><mark>색으로 표시된 글자</mark>에 쓰인 한자의 <b>음훈</b>은?</div>`;
    } else {
      q = `${hangulPartsHtml(w, c.h)}<div class="prompt">음훈을 보고 '<b>${w.read}</b>'의 <b>뜻</b>을 골라요.</div>`;
    }
    const answered = step.chosen !== undefined;
    const opts = step.options.map((o, k) => {
      let cls = '';
      if (answered && o === step.answer) cls = ' correct';
      else if (answered && o === step.chosen) cls = ' wrong';
      return `<button class="opt${cls}" data-k="${k}" ${answered ? 'disabled' : ''}>${o}</button>`;
    }).join('');
    let fb = '';
    if (answered) {
      const ok = step.chosen === step.answer;
      fb = `<div class="feedback ${ok ? 'ok' : 'no'}">${ok ? '⭕ 정답이에요!' : '❌ 아쉬워요. 다음 복습 때 다시 나와요.'}<br>${breakdown(w)}</div>${nextBtn()}`;
    }
    return `<div class="card lesson-card">${stageHtml(step.stage)}
      <div class="quiz-q">${q}</div>
      <div class="options">${opts}</div>
      <div id="fb">${fb}</div></div>`;
  }
  function bindPick(step) {
    if (step.chosen !== undefined) { bindNext(); return; }
    $app.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      step.chosen = step.options[+b.dataset.k];
      score(step.chosen === step.answer, step.idx);
      renderStep();
    }));
  }

  function renderWeekIntro(step) {
    const list = step.list.map((i) => `<span class="wk-char">${C(i).h}<small>${hunum(C(i))}</small></span>`).join('');
    return `<div class="card lesson-card center">${stageHtml('week')}
      <h2>이번 주에 배운 한자 ${step.list.length}자</h2>
      <div class="wk-list">${list}</div>
      <p class="muted small">일주일이 지나면 배운 내용을 많이 잊어버려요.<br>지금 한 번 더 떠올리면 기억이 훨씬 오래가요!</p>
      ${nextBtn('복습 시작 →')}</div>`;
  }

  function renderWeekSummary(step) {
    const rows = step.list.map((i) => {
      const c = C(i);
      const miss = S.missed.includes(i);
      return `<tr><td><button class="cell-in hanja${miss ? ' miss' : ''}" data-open="${i}">${c.h}</button></td>
        <td><b>${hunum(c)}</b> ${miss ? '<span class="pill">다시 보기</span>' : ''}<div class="ws">${c.words.map((w) => w.read).join(', ')}</div></td></tr>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('week')}
      <h2>이번 주 한자 정리</h2>
      <table class="summary-table">${rows}</table>
      ${nextBtn('마치기 →')}</div>`;
  }

  function renderDone() {
    stopTimer();
    finishSession();
    document.body.classList.remove('in-lesson');
    const secs = Math.floor((Date.now() - session.started) / 1000);
    const mins = Math.max(1, Math.round(secs / 60));
    let extra = '';
    let title = '오늘 학습 끝!';
    let writing = '';
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
        const wr = S.writings.find((x) => x.date === session.date && x.idx === i);
        if (wr) writing = `<div class="my-writing"><span class="lbl">✏️ 오늘 지은 글</span>${esc(wr.text)}</div>`;
      }
      if (session.plan.week.length) title = '한 주 학습 끝!';
    } else if (session.type === 'weekly') {
      title = '일주일 복습 끝!';
    } else {
      title = '복습 끝!';
    }
    const msg = session.type === 'lesson' && !session.plan.week.length
      ? '내일 아침 복습에서 다시 만나요.'
      : '잘했어요! 틀린 한자는 다음 복습에 다시 나와요.';
    const html = `<div class="card celebrate">
      <div class="emoji">🏅</div>
      <h2>${title}</h2>
      <p>${session.total ? `문제 <b>${session.correct} / ${session.total}</b> 정답 · ` : ''}약 ${mins}분</p>
      ${writing}
      <p class="muted">${msg}</p>
      ${session.type === 'lesson' ? `<p class="streak">🔥 연속 학습 <b>${streak()}일</b></p>` : ''}
      <a class="btn block big" href="#/">홈으로</a>
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
    bindOpen();
  }

  /* ================= 화면: 학습 기록 ================= */
  function renderRecords() {
    setTab('records');
    const lessons = S.activity.filter((a) => a.type === 'lesson');
    const quizT = S.activity.reduce((n, a) => n + (a.total || 0), 0);
    const quizC = S.activity.reduce((n, a) => n + (a.correct || 0), 0);
    const byDate = {};
    S.activity.forEach((a) => { (byDate[a.date] = byDate[a.date] || []).push(a); });
    S.writings.forEach((w) => { (byDate[w.date] = byDate[w.date] || []).push({ type: 'writing', ...w }); });
    const dates = Object.keys(byDate).sort().reverse();
    const label = (a) => {
      if (a.type === 'lesson') {
        const c = a.idx !== null && a.idx !== undefined ? C(a.idx) : null;
        return `📘 ${c ? `<button class="linkbtn hanja" data-open="${c.idx}">${c.h}</button> ${hunum(c)} 학습` : '복습'}${a.week ? ' · 일주일 복습' : ''} · 퀴즈 ${a.correct}/${a.total}`;
      }
      if (a.type === 'weekly') return `🗓 일주일 복습 · 퀴즈 ${a.correct}/${a.total}`;
      if (a.type === 'review') return `🔁 자유 복습 · 퀴즈 ${a.correct}/${a.total}`;
      if (a.type === 'exam') return `🎓 ${a.grade} 급수 시험 ${a.score}점 ${a.passed ? '(합격)' : ''}`;
      if (a.type === 'writing') return `✏️ 글짓기: “${esc(a.text)}”`;
      return '';
    };
    const timeline = dates.map((d) => `<div class="tl-day"><div class="tl-date">${shortDate(d)}</div>
      <ul>${byDate[d].map((a) => `<li>${label(a)}</li>`).join('')}</ul></div>`).join('');

    // 이 기기의 학생들(선생님용 한눈에 보기)
    const rows = users().map((n) => {
      const st = n === user ? S : loadState(n);
      const last = st.activity.length ? st.activity[st.activity.length - 1].date : null;
      const tq = st.activity.reduce((x, a) => x + (a.total || 0), 0);
      const cq = st.activity.reduce((x, a) => x + (a.correct || 0), 0);
      return `<tr${n === user ? ' class="me"' : ''}><td>${esc(n)}</td><td>${st.order.length}</td>
        <td>${st.activity.filter((a) => a.type === 'lesson').length}</td><td>${st.writings.length}</td>
        <td>${tq ? Math.round((cq / tq) * 100) + '%' : '-'}</td><td>${last ? shortDate(last) : '-'}</td></tr>`;
    }).join('');

    $app.innerHTML = `
      <div class="card">
        <h2>${esc(user)}의 학습 기록</h2>
        <div class="stats" style="grid-template-columns:repeat(4,1fr)">
          <div><b>${lessons.length}</b><span>학습한 날</span></div>
          <div><b>${S.order.length}</b><span>배운 한자</span></div>
          <div><b>${S.writings.length}</b><span>글짓기</span></div>
          <div><b>${quizT ? Math.round((quizC / quizT) * 100) : 0}%</b><span>퀴즈 정답률</span></div>
        </div>
      </div>
      <div class="card">
        <h3>날짜별 활동</h3>
        ${timeline || '<p class="muted small">아직 기록이 없어요. 오늘의 학습을 시작해 보세요!</p>'}
      </div>
      ${users().length > 1 ? `<div class="card">
        <h3>이 기기의 학생들</h3>
        <div style="overflow-x:auto"><table class="class-table">
          <tr><th>이름</th><th>배운 한자</th><th>학습일</th><th>글짓기</th><th>정답률</th><th>최근</th></tr>${rows}</table></div>
      </div>` : ''}`;
    bindOpen();
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
        <p class="small muted">${total}자를 훑어보며 뜻과 음을 떠올려 보세요. 한자를 누르면 활용 어휘가 보여요.</p>
        <label class="row small" style="margin:8px 0 12px"><input type="checkbox" class="switch" id="hide" ${hideHunum ? 'checked' : ''}> 뜻·음 가리고 스스로 떠올리기</label>
        <div class="grid">${cells}</div>
      </div>
      <div class="card">
        <h2>② 급수 시험</h2>
        <p class="small muted">한글 어휘에서 <mark>색으로 표시된 글자</mark>에 쓰인 한자의 <b>뜻</b>과 <b>음</b>을 써요.
          예) 학<mark>교</mark>(뜻: 공부하는 곳) → 뜻: 학교, 음: 교</p>
        ${rec ? `<p class="small">지난 시험 ${rec.last}점 · 최고 ${rec.best}점 ${rec.passed ? '· <b style="color:var(--green)">합격</b>' : ''}</p>` : ''}
        <div class="btn-row">
          <a class="btn soft" href="#/exam/${g.id}/test/20">20문항</a>
          <a class="btn" href="#/exam/${g.id}/test/all">전체 ${total}문항</a>
        </div>
      </div>`;
    document.getElementById('hide').addEventListener('change', (e) => { hideHunum = e.target.checked; renderExamGrade(id); });
    bindOpen();
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
      <div class="card lesson-card">
        <div class="stage stage-week"><span class="stage-e">🏆</span><b>${exam.grade.name} 급수 시험</b></div>
        ${wordQuestionHtml(c, q.word)}
        <form id="f" autocomplete="off">
          <div class="exam-inputs">
            <div><label for="m">뜻 (훈)</label><input id="m" lang="ko" value="${esc(q.m)}"></div>
            <div><label for="s">음 (소리)</label><input id="s" lang="ko" value="${esc(q.s)}"></div>
          </div>
          <div id="fb"></div>
          <button class="btn block big" id="go">정답 확인</button>
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

  function examAnswer(c, w) {
    const own = charHunum(c.h, targetPos(c, w).syl);
    return `${own.m} ${own.s}`;
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
        ${ok ? '⭕ 정답!' : '❌ 정답은'} <b>${examAnswer(c, q.word)}</b>(<span class="hj">${c.h}</span>)<br>
        ${breakdown(q.word)}
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
      logActivity({ type: 'exam', grade: g.name, score, passed, correct: right, total });
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
    bindOpen();
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
          <div class="txt"><b>학생</b><div class="small muted">${esc(user)}</div></div>
          <button class="btn ghost" id="switch">학생 바꾸기</button>
        </div>
        <div class="setting">
          <div class="txt"><b>다음에 배울 급수</b><div class="small muted">이미 아는 급수는 건너뛸 수 있어요.</div></div>
          <select id="grade">${options}</select>
        </div>
        <div class="setting">
          <div class="txt"><b>모든 급수 시험 열기</b><div class="small muted">배우지 않은 급수도 시험을 볼 수 있어요.</div></div>
          <input type="checkbox" class="switch" id="unlock" ${S.unlockAll ? 'checked' : ''}>
        </div>
        <div class="setting">
          <div class="txt"><b>학습 기록 초기화</b><div class="small muted">${esc(user)}의 배운 한자, 글짓기, 시험 기록이 모두 지워져요.</div></div>
          <button class="btn ghost" id="reset">초기화</button>
        </div>
      </div>

      <div class="card">
        <h2>이렇게 공부해요</h2>
        <p class="small">독일의 심리학자 <b>에빙하우스</b>는 사람이 새로 배운 것을 하루만 지나도 절반 넘게 잊어버린다는
          <b>망각 곡선</b>을 발견했어요. 하지만 잊어버리기 전에 다시 떠올리면 기억이 점점 오래 남아요.</p>
        ${curveSvg()}
        <ol class="plain small">
          <li><b>① 오늘의 한자</b> — 뜻(훈)과 소리(음)를 익혀요.</li>
          <li><b>② 활용 어휘 ①</b> — 한자 아래 음훈을 힌트로 어휘와 뜻을 선으로 연결해요.</li>
          <li><b>③ 활용 어휘 ②</b> — 문장의 빈칸에 알맞은 활용 어휘를 넣어요.</li>
          <li><b>④ 확인하기</b> — 한글 어휘에 쓰인 오늘 한자의 뜻과 음을 써요.</li>
          <li><b>⑤ 적용하기</b> — 배운 낱말을 넣어 짧은 글을 지어요.</li>
          <li><b>⑥ 어휘 추론</b> — 소리는 같지만 오늘의 한자가 쓰이지 않은 어휘를 찾아요.</li>
          <li><b>1일 후 복습</b> — 다음 학습일 아침에 바로 전 한자를 퀴즈로 떠올려요. (금요일 한자는 월요일에)</li>
          <li><b>일주일 복습</b> — 금요일마다 그 주의 한자 5자를 모두 다시 풀어요.</li>
          <li><b>틀린 한자</b> — 틀리면 '다시 볼 한자'로 모아 매일 복습에 최대 ${MAX_EXTRA_REVIEW}자씩 다시 나와요.</li>
          <li><b>급수 시험</b> — 한 급수를 다 배우면 전체 복습 후 시험(한글 어휘 제시 → 뜻과 음 쓰기)을 봐요.</li>
        </ol>
      </div>

      <div class="card">
        <h2>수록 한자</h2>
        <p class="small">한국어문회 한자능력검정시험 배정 한자 기준으로 ${GRADES.map((g) => `${g.name} ${g.end - g.start}자`).join(', ')} —
          모두 <b>${HANJA.length}자</b>가 들어 있어요. 평일마다 한 자씩, 약 ${Math.round(HANJA.length / 5)}주 분량이에요.</p>
        <p class="small muted">준비 중: ${UPCOMING_GRADES.join(', ')}</p>
      </div>`;
    document.getElementById('switch').addEventListener('click', () => { logout(); location.hash = '#/'; route(); });
    document.getElementById('grade').addEventListener('change', (e) => {
      const g = GRADES[+e.target.value];
      S.pointer = g.start;
      save();
      renderSettings();
    });
    document.getElementById('unlock').addEventListener('change', (e) => { S.unlockAll = e.target.checked; save(); });
    document.getElementById('reset').addEventListener('click', () => {
      if (confirm(`정말 ${user}의 모든 학습 기록을 지울까요? 되돌릴 수 없어요.`)) {
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
    let noRev = '';
    for (let d = 0; d <= 14; d += 0.25) noRev += `${d ? 'L' : 'M'}${X(d).toFixed(1)},${Y(0.25 + 0.75 * decay(d, 1.2)).toFixed(1)}`;
    const seg = (from, to, s) => {
      let p = '';
      for (let d = from; d <= to + 1e-9; d += 0.25) p += `${d === from ? 'M' : 'L'}${X(d).toFixed(1)},${Y(0.25 + 0.75 * decay(d - from, s)).toFixed(1)}`;
      return p;
    };
    const rev = seg(0, 1, 1.2) + seg(1, 4, 4) + seg(4, 14, 14);
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
    const who = document.getElementById('who');
    who.textContent = user ? `👤 ${user}` : '';
    who.hidden = !user;
    document.querySelectorAll('.modal-back').forEach((m) => m.remove());
    if (parts[0] !== 'lesson' && parts[0] !== 'weekly' && parts[0] !== 'review') stopTimer();
    if (!(parts[0] === 'exam' && parts[2] === 'test')) exam = null;
    document.body.classList.remove('in-lesson', 'logged-out');
    window.scrollTo(0, 0);

    if (!user) { stopTimer(); renderLogin(); return; }
    switch (parts[0]) {
      case 'lesson': startLesson('lesson'); break;
      case 'weekly': startLesson('weekly'); break;
      case 'review': startLesson('review'); break;
      case 'list': renderList(); break;
      case 'records': renderRecords(); break;
      case 'exam':
        if (parts[1] && parts[2] === 'test') startExam(parts[1], parts[3] || '20');
        else if (parts[1]) renderExamGrade(parts[1]);
        else renderExamHome();
        break;
      case 'settings': renderSettings(); break;
      default: renderHome();
    }
  }

  document.getElementById('who').addEventListener('click', () => { location.hash = '#/records'; });
  window.addEventListener('hashchange', route);
  route();
})();
