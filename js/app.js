/*
 * 행동중재 도우미 — 화면(UI) 로직
 */
(function () {
  'use strict';
  const A = Analysis;
  const S = Store;
  const esc = U.esc;

  const MEASURES = [
    { key: 'frequency', label: '빈도' },
    { key: 'duration', label: '지속시간' },
    { key: 'intensity', label: '강도' },
    { key: 'abc', label: 'ABC' },
  ];
  const SETTING_OPTIONS = ['교실', '특별실', '운동장', '체육관', '급식실', '복도', '화장실', '통학버스', '가정'];
  const ACTIVITY_OPTIONS = ['국어', '수학', '통합교과', '체육', '음악', '미술', '자유시간', '쉬는시간', '점심시간', '전환시간', '등교·하교', '모둠활동'];

  const state = {
    view: 'home',
    recordTab: 'frequency',
    calMonth: U.today().slice(0, 7),
    calMetric: 'count',
    graphRange: '30',
    plan: null,
    lastRecordId: null,
    editBehavior: null, // null | 'new' | behaviorId
    editStudent: null,  // null | 'new' | studentId
    template: null,
  };
  let charts = [];
  let ticker = null;
  let pendingCsvImport = null;

  // ======================== 공통 ========================
  const $ = sel => document.querySelector(sel);
  const student = () => S.currentStudent();
  const behaviors = () => (student() ? S.behaviors(student().id) : []);
  const behavior = () => S.currentBehavior();

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function openModal(html) {
    $('#modalBody').innerHTML = html;
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); $('#modalBody').innerHTML = ''; }

  function go(view) { state.view = view; render(); window.scrollTo(0, 0); }

  function render() {
    charts.forEach(c => c.destroy());
    charts = [];
    clearInterval(ticker);
    ticker = null;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === state.view));
    renderStudentSelect();
    $('#main').innerHTML = (Views[state.view] || Views.home)();
    const after = After[state.view];
    if (after) after();
  }

  function renderStudentSelect() {
    const sel = $('#studentSelect');
    const list = S.students();
    const cur = student();
    sel.innerHTML = list.length
      ? list.map(s => `<option value="${s.id}" ${cur && s.id === cur.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('') + '<option value="__new">+ 학생 추가</option>'
      : '<option value="__new">학생(가명) 추가</option>';
  }

  const PRIVACY_NOTICE = `
    <div class="privacy">
      <b>🔒 개인정보를 입력하지 마세요</b>
      <ul>
        <li>학생 이름은 <b>가명</b>으로 적어 주세요. (예: 학생A, 별님, 3-1번)</li>
        <li>생년월일·주소·연락처·학교명·보호자 이름 등은 입력받지 않습니다.</li>
        <li>ABC 기록 등 서술란에도 실명 대신 '친구1', '담임' 같은 표현을 써 주세요.</li>
      </ul>
    </div>`;

  function needStudent() {
    if (student()) return '';
    return `
      <section class="card empty">
        <h2>환영합니다 👋</h2>
        <p>행동중재 도우미는 표적행동을 정의하고, 빈도·지속시간·강도·ABC를 기록하여<br>달력·그래프로 확인하고 행동중재계획서 초안까지 만들어 주는 앱입니다.</p>
        <div class="row center">
          <button class="btn primary" data-action="newStudent">학생 추가하기</button>
          <button class="btn" data-action="loadSample">예시 데이터로 둘러보기</button>
        </div>
        ${PRIVACY_NOTICE}
        <p class="muted small">모든 자료는 이 브라우저에만 저장됩니다. 설정 메뉴에서 백업 파일로 내보낼 수 있어요.</p>
      </section>`;
  }
  function needBehavior() {
    if (behaviors().length) return '';
    return `
      <section class="card empty">
        <h2>표적행동을 먼저 정해 주세요</h2>
        <p>${esc(student().name)} 학생의 중재할 행동을 정의하면 기록을 시작할 수 있어요.</p>
        <button class="btn primary" data-action="goBehaviorNew">표적행동 정하기</button>
      </section>`;
  }
  function guard() { return needStudent() || needBehavior(); }

  function behaviorChips() {
    const cur = behavior();
    return `<div class="chips">${behaviors().map(b =>
      `<button class="chip ${cur && b.id === cur.id ? 'active' : ''}" style="--c:${b.color}" data-action="pickBehavior" data-id="${b.id}">${esc(b.name)}</button>`
    ).join('')}</div>`;
  }

  function recordBadges(r) {
    const out = [];
    if (r.durationSec) out.push(`<span class="badge">⏱ ${U.fmtDur(r.durationSec)}</span>`);
    if (r.intensity) out.push(`<span class="badge lvl${r.intensity}">강도 ${r.intensity}</span>`);
    if (r.abc) out.push('<span class="badge abc">ABC</span>');
    return out.join('');
  }
  function recordList(recs, opts = {}) {
    if (!recs.length) return `<p class="muted">${opts.empty || '기록이 없습니다.'}</p>`;
    return `<ul class="rec-list">${recs.map(r => {
      const b = S.behavior(r.behaviorId);
      const abc = r.abc ? `<div class="rec-abc">
          <span><b>A</b> ${esc([...(r.abc.antecedents || []).map(c => A.ANTE_LABELS[c]), r.abc.antecedentText].filter(Boolean).join(', ') || '-')}</span>
          <span><b>C</b> ${esc([...(r.abc.consequences || []).map(c => A.CONS_LABELS[c]), r.abc.consequenceText].filter(Boolean).join(', ') || '-')}</span>
        </div>` : '';
      return `<li>
        <div class="rec-main">
          <span class="rec-time">${opts.showDate ? esc(A.dayKey(r.ts).slice(5).replace('-', '/')) + ' ' : ''}${U.timeStr(r.ts)}</span>
          ${opts.showBehavior && b ? `<span class="dot" style="background:${b.color}"></span>${esc(b.name)}` : ''}
          ${recordBadges(r)}
          <span class="spacer"></span>
          <button class="icon-btn" data-action="editRecord" data-id="${r.id}" title="수정">✎</button>
          <button class="icon-btn danger" data-action="deleteRecord" data-id="${r.id}" title="삭제">🗑</button>
        </div>${abc}
      </li>`;
    }).join('')}</ul>`;
  }

  function sortDesc(recs) { return recs.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts)); }
  function recordsOn(behaviorId, day) { return S.records(behaviorId).filter(r => A.dayKey(r.ts) === day); }

  // ======================== 화면 ========================
  const Views = {};
  const After = {};

  // ---------- 홈 ----------
  Views.home = () => {
    const g = guard();
    if (g) return g;
    const st = student();
    const today = U.today();
    const cards = behaviors().map(b => {
      const an = A.analyze(b, S.records(b.id), { from: U.addDays(today, -13), to: today });
      const todayCnt = an.daily.length ? an.daily[an.daily.length - 1].count : 0;
      const last7 = an.daily.slice(-7).filter(d => d.observed);
      const avg7 = last7.length ? last7.reduce((a, d) => a + d.count, 0) / last7.length : 0;
      const max = Math.max(1, ...an.daily.map(d => d.count));
      const arrow = { up: '▲ 증가', down: '▼ 감소', stable: '― 안정', unknown: '' }[an.trend.direction];
      return `
        <section class="card beh-card" style="--c:${b.color}">
          <div class="beh-head">
            <h3><span class="dot" style="background:${b.color}"></span>${esc(b.name)}</h3>
            <span class="trend ${an.trend.direction}">${arrow}</span>
          </div>
          <div class="stats">
            <div><b>${todayCnt}</b><small>오늘</small></div>
            <div><b>${A.round(avg7)}</b><small>최근 7일 평균</small></div>
            <div><b>${an.summary.avgIntensity == null ? '-' : A.round(an.summary.avgIntensity)}</b><small>평균 강도(2주)</small></div>
          </div>
          <div class="spark" title="최근 14일 빈도">${an.daily.map(d =>
            `<span class="${d.observed ? '' : 'off'}" style="height:${Math.max(4, d.count / max * 100)}%" title="${d.date}: ${d.count}회"></span>`).join('')}</div>
          <div class="row">
            <button class="btn primary" data-action="quickFrequency" data-id="${b.id}">+1 발생</button>
            <button class="btn" data-action="goRecord" data-id="${b.id}">상세 기록</button>
          </div>
        </section>`;
    }).join('');
    const todayAll = sortDesc(S.data.records.filter(r => A.dayKey(r.ts) === today && behaviors().some(b => b.id === r.behaviorId)));
    return `
      <section class="card hello">
        <h2>${esc(st.name)} <small>${esc(st.grade || '')}</small></h2>
        <p class="muted">${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}</p>
      </section>
      <div class="grid">${cards}</div>
      <section class="card">
        <h3>오늘의 기록</h3>
        ${recordList(todayAll, { showBehavior: true, empty: '오늘 기록된 행동이 없습니다.' })}
      </section>`;
  };

  // ---------- 표적행동 ----------
  Views.behaviors = () => {
    const g = needStudent();
    if (g) return g;
    if (state.editBehavior) return behaviorForm();
    const list = behaviors();
    return `
      <section class="card">
        <div class="row between">
          <h2>${esc(student().name)}의 표적행동</h2>
          <button class="btn primary" data-action="newBehavior">+ 표적행동 추가</button>
        </div>
        ${list.length ? '' : '<p class="muted">아직 정의된 표적행동이 없습니다.</p>'}
      </section>
      ${list.map(b => `
        <section class="card beh-def" style="--c:${b.color}">
          <div class="row between">
            <h3><span class="dot" style="background:${b.color}"></span>${esc(b.name)}</h3>
            <div class="row">
              <button class="btn small" data-action="editBehavior" data-id="${b.id}">수정</button>
              <button class="btn small danger" data-action="deleteBehavior" data-id="${b.id}">삭제</button>
            </div>
          </div>
          <dl>
            <dt>조작적 정의</dt><dd>${esc(b.definition) || '<span class="muted">미입력</span>'}</dd>
            <dt>포함되는 예</dt><dd>${esc(b.examples) || '-'}</dd>
            <dt>포함되지 않는 예</dt><dd>${esc(b.nonExamples) || '-'}</dd>
            <dt>측정 방법</dt><dd>${(b.measures || []).map(m => `<span class="badge">${MEASURES.find(x => x.key === m).label}</span>`).join(' ')}</dd>
            <dt>중재 시작일</dt><dd>${b.interventionDate || '<span class="muted">미정 (기초선 단계)</span>'}</dd>
            ${b.goal ? `<dt>목표</dt><dd>${esc(b.goal)}</dd>` : ''}
            <dt>기록 수</dt><dd>${S.records(b.id).length}건</dd>
          </dl>
        </section>`).join('')}
      <section class="card tip">
        <h3>💡 좋은 조작적 정의의 조건</h3>
        <ul>
          <li><b>관찰 가능</b>: 눈으로 보거나 귀로 들을 수 있는 행동으로 쓰기 ("화낸다" ✗ → "책상을 주먹으로 친다" ○)</li>
          <li><b>측정 가능</b>: 횟수나 시간을 셀 수 있도록 시작과 끝을 명확히 하기</li>
          <li><b>명확성</b>: 처음 보는 사람도 같은 행동을 같은 방식으로 기록할 수 있도록 예와 예가 아닌 것을 함께 적기</li>
        </ul>
      </section>`;
  };

  function behaviorForm() {
    const isNew = state.editBehavior === 'new';
    const b = isNew
      ? Object.assign({ measures: ['frequency', 'abc'], color: COLORS[behaviors().length % COLORS.length], intensityScale: DEFAULT_INTENSITY.slice() }, state.template || {})
      : S.behavior(state.editBehavior);
    const scale = b.intensityScale || DEFAULT_INTENSITY;
    return `
      <section class="card">
        <h2>${isNew ? '표적행동 추가' : '표적행동 수정'}</h2>
        ${isNew ? `<div class="templates"><span class="muted small">예시에서 시작하기:</span>
          ${BEHAVIOR_TEMPLATES.map((t, i) => `<button class="chip" data-action="useTemplate" data-i="${i}">${esc(t.name)}</button>`).join('')}</div>` : ''}
        <form data-form="behavior" class="form">
          <input type="hidden" name="id" value="${isNew ? '' : b.id}">
          <label>행동명 <input name="name" required value="${esc(b.name || '')}" placeholder="예: 소리 지르기"></label>
          <label>조작적 정의 <textarea name="definition" rows="3" placeholder="관찰·측정 가능하게, 시작과 끝을 포함하여 작성">${esc(b.definition || '')}</textarea></label>
          <div class="two">
            <label>포함되는 예 <textarea name="examples" rows="2">${esc(b.examples || '')}</textarea></label>
            <label>포함되지 않는 예 <textarea name="nonExamples" rows="2">${esc(b.nonExamples || '')}</textarea></label>
          </div>
          <fieldset><legend>측정 방법</legend>
            ${MEASURES.map(m => `<label class="check"><input type="checkbox" name="measures" value="${m.key}" ${(b.measures || []).includes(m.key) ? 'checked' : ''}> ${m.label}</label>`).join('')}
          </fieldset>
          <fieldset><legend>강도 척도 (1~5점 기준)</legend>
            ${scale.map((t, i) => `<label class="inline">${i + 1}점 <input name="scale${i}" value="${esc(t)}"></label>`).join('')}
          </fieldset>
          <div class="two">
            <label>중재 시작일 <small class="muted">(비워 두면 기초선 단계)</small><input type="date" name="interventionDate" value="${b.interventionDate || ''}"></label>
            <label>그래프 색상 <input type="color" name="color" value="${b.color || '#3b5bdb'}"></label>
          </div>
          <label>목표 (선택) <input name="goal" value="${esc(b.goal || '')}" placeholder="예: 4주 후 일평균 2회 이하"></label>
          <div class="row">
            <button class="btn primary" type="submit">저장</button>
            <button class="btn" type="button" data-action="cancelBehavior">취소</button>
          </div>
        </form>
      </section>`;
  }

  // ---------- 기록 ----------
  Views.record = () => {
    const g = guard();
    if (g) return g;
    const b = behavior();
    const tabs = [['frequency', '빈도'], ['duration', '지속시간'], ['intensity', '강도'], ['abc', 'ABC']];
    const today = U.today();
    const todayRecs = sortDesc(recordsOn(b.id, today));
    return `
      <section class="card">
        ${behaviorChips()}
        <p class="definition"><b>정의</b> ${esc(b.definition || '조작적 정의가 아직 없습니다.')}</p>
        <div class="tabs">${tabs.map(([k, l]) => `<button class="${state.recordTab === k ? 'active' : ''}" data-action="recordTab" data-tab="${k}">${l}</button>`).join('')}</div>
        <div class="tab-body">${RecordTabs[state.recordTab](b, todayRecs)}</div>
      </section>
      <section class="card">
        <h3>오늘 기록 <small class="muted">(${todayRecs.length}건)</small></h3>
        ${recordList(todayRecs)}
      </section>`;
  };

  function intensityPicker(action, selected) {
    const b = behavior();
    const scale = (b && b.intensityScale) || DEFAULT_INTENSITY;
    return `<div class="lvl-picker">${[1, 2, 3, 4, 5].map(n =>
      `<button type="button" class="lvl lvl${n} ${selected === n ? 'active' : ''}" data-action="${action}" data-lvl="${n}" title="${esc(scale[n - 1])}">${n}</button>`).join('')}</div>`;
  }

  function lastRecordFollowUp() {
    const r = state.lastRecordId && S.record(state.lastRecordId);
    if (!r || r.behaviorId !== behavior().id) return '';
    return `<div class="followup">
      <span>방금 기록(${U.timeStr(r.ts)})에 강도 추가 <small class="muted">(선택)</small></span>
      ${intensityPicker('setLastIntensity', r.intensity)}
    </div>`;
  }

  const RecordTabs = {
    frequency(b, todayRecs) {
      return `
        <div class="counter">
          <div class="count-num">${todayRecs.length}</div>
          <div class="muted">오늘 발생 횟수</div>
          <button class="btn huge primary" data-action="tapFrequency">+1 발생 기록</button>
          <button class="btn small" data-action="undoLast" ${todayRecs.length ? '' : 'disabled'}>마지막 기록 취소</button>
        </div>
        ${lastRecordFollowUp()}
        <details class="manual">
          <summary>지난 기록 한꺼번에 입력하기</summary>
          <form data-form="bulk" class="form inline-form">
            <label>날짜 <input type="date" name="date" value="${U.today()}" max="${U.today()}" required></label>
            <label>시각 <input type="time" name="time" value="${U.nowTime()}"></label>
            <label>횟수 <input type="number" name="count" min="1" max="200" value="1" required></label>
            <button class="btn" type="submit">추가</button>
          </form>
        </details>`;
    },
    duration(b) {
      const sw = S.setting('stopwatch');
      const running = sw && sw.behaviorId === b.id;
      const other = sw && sw.behaviorId !== b.id ? S.behavior(sw.behaviorId) : null;
      return `
        <div class="counter">
          <div class="count-num clock" id="clock">${running ? U.clock((Date.now() - sw.start) / 1000) : '00:00'}</div>
          <div class="muted">${running ? '측정 중… 행동이 끝나면 정지를 누르세요' : '행동이 시작되면 시작을 누르세요'}</div>
          ${other ? `<p class="warn">'${esc(other.name)}' 지속시간을 측정 중입니다.</p>` : ''}
          <button class="btn huge ${running ? 'danger' : 'primary'}" data-action="${running ? 'stopTimer' : 'startTimer'}" ${other ? 'disabled' : ''}>${running ? '■ 정지 및 저장' : '▶ 시작'}</button>
          ${running ? '<button class="btn small" data-action="cancelTimer">측정 취소</button>' : ''}
        </div>
        ${lastRecordFollowUp()}
        <details class="manual">
          <summary>직접 입력하기</summary>
          <form data-form="duration" class="form inline-form">
            <label>날짜 <input type="date" name="date" value="${U.today()}" max="${U.today()}" required></label>
            <label>시각 <input type="time" name="time" value="${U.nowTime()}"></label>
            <label>분 <input type="number" name="min" min="0" value="0"></label>
            <label>초 <input type="number" name="sec" min="0" max="59" value="0"></label>
            <button class="btn" type="submit">추가</button>
          </form>
        </details>`;
    },
    intensity(b, todayRecs) {
      const scale = b.intensityScale || DEFAULT_INTENSITY;
      const ints = todayRecs.filter(r => r.intensity).map(r => r.intensity);
      return `
        <p class="muted">행동이 발생하면 강도를 눌러 기록하세요. (1회 발생으로 함께 집계됩니다)</p>
        <div class="scale-list">
          ${scale.map((t, i) => `<button class="scale-btn lvl${i + 1}" data-action="tapIntensity" data-lvl="${i + 1}"><b>${i + 1}</b><span>${esc(t)}</span></button>`).join('')}
        </div>
        <p class="muted">오늘 평균 강도: <b>${ints.length ? A.round(A.mean(ints)) : '-'}</b> (${ints.length}건)</p>`;
    },
    abc(b) { return abcForm(b); },
  };

  function abcForm(b, r) {
    const abc = (r && r.abc) || {};
    const date = r ? A.dayKey(r.ts) : U.today();
    const time = r ? U.timeStr(r.ts) : U.nowTime();
    const checks = (list, name, sel) => list.map(x =>
      `<label class="check"><input type="checkbox" name="${name}" value="${x.code}" ${(sel || []).includes(x.code) ? 'checked' : ''}> ${esc(x.label)}</label>`).join('');
    const dur = r && r.durationSec ? r.durationSec : 0;
    return `
      <form data-form="abc" class="form abc-form">
        <input type="hidden" name="id" value="${r ? r.id : ''}">
        <input type="hidden" name="behaviorId" value="${b.id}">
        <div class="three">
          <label>날짜 <input type="date" name="date" value="${date}" max="${U.today()}" required></label>
          <label>시각 <input type="time" name="time" value="${time}" required></label>
          <label>장소 <input name="setting" list="settingList" value="${esc(abc.setting || '')}" placeholder="예: 교실"></label>
        </div>
        <label>활동·수업 <input name="activity" list="activityList" value="${esc(abc.activity || '')}" placeholder="예: 수학"></label>
        <datalist id="settingList">${SETTING_OPTIONS.map(o => `<option value="${o}">`).join('')}</datalist>
        <datalist id="activityList">${ACTIVITY_OPTIONS.map(o => `<option value="${o}">`).join('')}</datalist>

        <p class="muted small">🔒 서술란에는 실명 대신 '친구1', '담임', '보조인력'처럼 적어 주세요.</p>
        <fieldset class="abc-a"><legend><b>A</b> 선행사건 — 행동 직전에 무슨 일이 있었나요?</legend>
          <div class="checks">${checks(A.ANTECEDENTS, 'antecedents', abc.antecedents)}</div>
          <textarea name="antecedentText" rows="2" placeholder="구체적으로 (예: 수학 익힘책 3쪽을 풀자고 지시함)">${esc(abc.antecedentText || '')}</textarea>
        </fieldset>
        <fieldset class="abc-b"><legend><b>B</b> 행동 — 학생이 무엇을 했나요?</legend>
          <textarea name="behaviorText" rows="2" placeholder="관찰한 그대로 (예: '싫어'라고 소리 지르며 책을 바닥에 던짐)">${esc(abc.behaviorText || '')}</textarea>
          <div class="three">
            <label>지속시간(분) <input type="number" name="min" min="0" value="${Math.floor(dur / 60)}"></label>
            <label>지속시간(초) <input type="number" name="sec" min="0" max="59" value="${dur % 60}"></label>
            <label>강도 <select name="intensity"><option value="">-</option>${[1, 2, 3, 4, 5].map(n => `<option ${r && r.intensity === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
          </div>
        </fieldset>
        <fieldset class="abc-c"><legend><b>C</b> 후속결과 — 행동 직후 어떤 일이 있었나요?</legend>
          <div class="checks">${checks(A.CONSEQUENCES, 'consequences', abc.consequences)}</div>
          <textarea name="consequenceText" rows="2" placeholder="구체적으로 (예: 교사가 과제를 치우고 진정하라고 함)">${esc(abc.consequenceText || '')}</textarea>
        </fieldset>
        <label>추정 기능 (관찰자 판단, 선택)
          <select name="functionGuess">
            <option value="">잘 모르겠음</option>
            ${Object.entries(A.FUNCTIONS).map(([k, v]) => `<option value="${k}" ${abc.functionGuess === k ? 'selected' : ''}>${v}</option>`).join('')}
          </select>
        </label>
        <label>메모 <textarea name="notes" rows="2" placeholder="실명 대신 '친구1', '담임' 등으로 적어 주세요">${esc(abc.notes || '')}</textarea></label>
        <button class="btn primary" type="submit">${r ? '수정 저장' : 'ABC 기록 저장'}</button>
      </form>`;
  }

  After.record = () => {
    const sw = S.setting('stopwatch');
    if (state.recordTab === 'duration' && sw) {
      ticker = setInterval(() => {
        const el = $('#clock');
        if (el && sw.behaviorId === behavior().id) el.textContent = U.clock((Date.now() - sw.start) / 1000);
      }, 500);
    }
  };

  // ---------- 달력 ----------
  const CAL_METRICS = { count: '빈도(회)', duration: '총 지속시간', intensity: '평균 강도', abc: 'ABC 기록 수' };
  function calValue(d, metric) {
    if (metric === 'count') return d.count;
    if (metric === 'duration') return d.durationTotal;
    if (metric === 'intensity') return d.avgIntensity || 0;
    return d.abcCount;
  }
  function calText(d, metric) {
    const v = calValue(d, metric);
    if (!v) return '';
    if (metric === 'count') return v + '회';
    if (metric === 'duration') return U.fmtDur(v);
    if (metric === 'intensity') return A.round(v) + '점';
    return v + '건';
  }

  Views.calendar = () => {
    const g = guard();
    if (g) return g;
    const b = behavior();
    const [y, m] = state.calMonth.split('-').map(Number);
    const first = `${state.calMonth}-01`;
    const last = A.dayKey(new Date(y, m, 0));
    const daily = A.buildDaily(S.records(b.id), first, last);
    const max = Math.max(...daily.map(d => calValue(d, state.calMetric)), 0.0001);
    const lead = new Date(y, m - 1, 1).getDay();
    const today = U.today();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell blank"></div>');
    for (const d of daily) {
      const v = calValue(d, state.calMetric);
      const bg = v ? U.rgba(b.color, 0.12 + 0.7 * v / max) : '';
      const strong = v / max > 0.55;
      cells.push(`<button class="cal-cell ${d.date === today ? 'today' : ''} ${d.weekend ? 'weekend' : ''} ${strong ? 'strong' : ''}" style="${bg ? `background:${bg}` : ''}" data-action="openDay" data-day="${d.date}">
        <span class="cal-day">${Number(d.date.slice(8))}</span>
        <span class="cal-val">${calText(d, state.calMetric)}</span>
        ${b.interventionDate === d.date ? '<span class="cal-phase">중재 시작</span>' : ''}
      </button>`);
    }
    const monthRecs = daily.reduce((a, d) => a + d.count, 0);
    const obs = daily.filter(d => d.observed && d.date <= today);
    return `
      <section class="card">
        ${behaviorChips()}
        <div class="row between cal-head">
          <button class="btn small" data-action="calMove" data-d="-1">◀</button>
          <h2>${y}년 ${m}월</h2>
          <button class="btn small" data-action="calMove" data-d="1">▶</button>
        </div>
        <div class="row center">
          <select data-change="calMetric">${Object.entries(CAL_METRICS).map(([k, v]) => `<option value="${k}" ${state.calMetric === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button class="btn small" data-action="calToday">이번 달</button>
        </div>
        <div class="cal">
          ${A.WEEKDAYS.map((w, i) => `<div class="cal-wd ${i === 0 || i === 6 ? 'weekend' : ''}">${w}</div>`).join('')}
          ${cells.join('')}
        </div>
        <p class="muted small">이번 달 총 ${monthRecs}회 · 관찰일 기준 일평균 ${obs.length ? A.round(monthRecs / obs.length) : 0}회 · 날짜를 누르면 상세 기록을 보고 추가할 수 있어요.</p>
      </section>`;
  };

  function dayModal(day) {
    const b = behavior();
    const recs = sortDesc(recordsOn(b.id, day));
    const isFuture = day > U.today();
    openModal(`
      <h2>${day.replace(/-/g, '. ')}. <small style="color:${b.color}">${esc(b.name)}</small></h2>
      ${recordList(recs, { empty: '이 날의 기록이 없습니다.' })}
      ${isFuture ? '' : `<h3>기록 추가</h3>
      <form data-form="bulk" class="form inline-form">
        <input type="hidden" name="date" value="${day}">
        <label>시각 <input type="time" name="time" value="12:00"></label>
        <label>횟수 <input type="number" name="count" min="1" max="200" value="1"></label>
        <button class="btn primary" type="submit">빈도 추가</button>
        <button class="btn" type="button" data-action="abcForDay" data-day="${day}">ABC 기록 작성</button>
      </form>`}`);
    state.modalDay = day;
  }

  // ---------- 그래프 ----------
  const RANGES = { 7: '1주', 14: '2주', 30: '1개월', 90: '3개월', all: '전체' };
  Views.graph = () => {
    const g = guard();
    if (g) return g;
    const b = behavior();
    const has = S.records(b.id).length > 0;
    const blocks = [
      ['chFreq', '일별 발생 빈도', true],
      ['chDur', '일별 지속시간 (1회 평균, 분)', true],
      ['chInt', '일별 강도 (평균/최고)', true],
      ['chHour', '시간대별 발생', false],
      ['chWeek', '요일별 발생', false],
      ['chFn', '행동 기능 추정 (ABC 기반)', false],
      ['chAnte', '선행사건(A) 빈도', false],
      ['chCons', '후속결과(C) 빈도', false],
    ];
    return `
      <section class="card">
        ${behaviorChips()}
        <div class="row center">${Object.entries(RANGES).map(([k, v]) =>
          `<button class="btn small ${state.graphRange === k ? 'primary' : ''}" data-action="graphRange" data-r="${k}">${v}</button>`).join('')}</div>
        ${b.interventionDate ? `<p class="muted small center">점선: 중재 시작일 (${b.interventionDate}) — 왼쪽 기초선, 오른쪽 중재 단계</p>` : ''}
      </section>
      ${has ? `<div id="graphSummary"></div><div class="grid charts">${blocks.map(([id, title, wide]) =>
        `<section class="card chart-card ${wide ? 'wide' : ''}"><h3>${title}</h3><div class="chart-box"><canvas id="${id}"></canvas></div><p class="muted small chart-empty" id="${id}Empty" hidden>자료가 없습니다.</p></section>`).join('')}</div>`
        : '<section class="card"><p class="muted">아직 기록이 없습니다. 기록 메뉴에서 행동을 기록해 주세요.</p></section>'}`;
  };

  // 중재 시작 지점에 세로 점선을 그리는 플러그인
  const phasePlugin = {
    id: 'phaseLine',
    afterDatasetsDraw(chart, _args, opts) {
      if (!opts || opts.index == null || opts.index < 0) return;
      const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
      const n = chart.data.labels.length;
      if (opts.index >= n) return;
      const px = opts.index === 0 ? x.left : (x.getPixelForValue(opts.index - 1) + x.getPixelForValue(opts.index)) / 2;
      ctx.save();
      ctx.strokeStyle = '#495057';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#495057';
      ctx.font = '12px sans-serif';
      ctx.fillText('중재', px + 4, top + 12);
      ctx.restore();
    },
  };
  if (window.Chart) {
    Chart.register(phasePlugin);
    Chart.defaults.font.family = "'Pretendard','Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',sans-serif";
    Chart.defaults.color = '#495057';
    Chart.defaults.maintainAspectRatio = false;
  }

  function graphFrom() {
    const b = behavior();
    if (state.graphRange === 'all') {
      const recs = S.records(b.id);
      return recs.length ? A.dayKey(recs.reduce((m, r) => (r.ts < m ? r.ts : m), recs[0].ts)) : U.today();
    }
    return U.addDays(U.today(), -(Number(state.graphRange) - 1));
  }

  function makeChart(id, config) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) return;
    charts.push(new Chart(el, config));
  }
  function emptyChart(id) {
    const el = document.getElementById(id);
    if (el) el.parentElement.hidden = true;
    const e = document.getElementById(id + 'Empty');
    if (e) e.hidden = false;
  }

  After.graph = () => {
    const b = behavior();
    if (!b || !S.records(b.id).length) return;
    if (!window.Chart) { toast('그래프 라이브러리를 불러오지 못했습니다.'); return; }
    const an = A.analyze(b, S.records(b.id), { from: graphFrom(), to: U.today() });
    const obs = an.daily.filter(d => d.observed);
    const labels = obs.map(d => `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8))}`);
    const phaseIdx = b.interventionDate ? obs.findIndex(d => d.date >= b.interventionDate) : -1;
    const phase = { phaseLine: { index: phaseIdx > 0 ? phaseIdx : -1 }, legend: { display: false } };
    const c = b.color;
    const s = an.summary;

    $('#graphSummary').innerHTML = `<section class="card"><div class="stats wide">
      <div><b>${s.totalCount}</b><small>총 발생</small></div>
      <div><b>${A.round(s.meanPerDay)}</b><small>일평균 빈도</small></div>
      <div><b>${s.avgDurationSec == null ? '-' : U.fmtDur(s.avgDurationSec)}</b><small>평균 지속시간</small></div>
      <div><b>${s.avgIntensity == null ? '-' : A.round(s.avgIntensity)}</b><small>평균 강도</small></div>
      <div><b class="trend ${an.trend.direction}">${an.trend.label.split('(')[0]}</b><small>추세</small></div>
      ${an.phase && an.phase.changePct != null ? `<div><b>${an.phase.changePct <= 0 ? '▼' : '▲'} ${A.round(Math.abs(an.phase.changePct), 0)}%</b><small>기초선 대비</small></div>` : ''}
    </div></section>`;

    // 기초선 평균선(중재 시작 전 구간에만 표시)
    const lineOpts = (yTitle, extra = {}) => ({
      type: 'line',
      options: Object.assign({
        plugins: Object.assign({}, phase, { tooltip: { mode: 'index', intersect: false } }),
        scales: { y: { beginAtZero: true, title: { display: true, text: yTitle } }, x: { ticks: { maxRotation: 0, autoSkipPadding: 8 } } },
        spanGaps: true,
      }, extra),
    });

    const freqTrend = A.linreg(obs.map(d => d.count));
    makeChart('chFreq', Object.assign(lineOpts('회'), {
      data: {
        labels,
        datasets: [
          { label: '빈도', data: obs.map(d => d.count), borderColor: c, backgroundColor: U.rgba(c, 0.15), fill: true, tension: 0.25, pointRadius: 3 },
          { label: '추세선', data: obs.map((_, i) => Math.max(0, A.round(freqTrend.intercept + freqTrend.slope * i, 2))), borderColor: '#adb5bd', borderDash: [3, 3], pointRadius: 0, fill: false },
        ],
      },
    }));

    if (s.durationRecords) {
      makeChart('chDur', Object.assign(lineOpts('분'), {
        data: { labels, datasets: [{ label: '1회 평균 지속시간(분)', data: obs.map(d => (d.avgDuration == null ? null : A.round(d.avgDuration / 60, 2))), borderColor: c, backgroundColor: c, tension: 0.25 }] },
      }));
    } else emptyChart('chDur');

    if (s.intensityRecords) {
      const cfg = lineOpts('점');
      cfg.options.scales.y = { min: 0, max: 5, ticks: { stepSize: 1 }, title: { display: true, text: '점' } };
      cfg.options.plugins.legend = { display: true };
      makeChart('chInt', Object.assign(cfg, {
        data: {
          labels, datasets: [
            { label: '평균 강도', data: obs.map(d => (d.avgIntensity == null ? null : A.round(d.avgIntensity, 2))), borderColor: c, backgroundColor: c, tension: 0.25 },
            { label: '최고 강도', data: obs.map(d => d.maxIntensity), borderColor: '#e03131', backgroundColor: '#e03131', borderDash: [4, 3], pointStyle: 'triangle', tension: 0 },
          ],
        },
      }));
    } else emptyChart('chInt');

    const barCfg = (labelsArr, data, color, horizontal) => ({
      type: 'bar',
      data: { labels: labelsArr, datasets: [{ data, backgroundColor: color, borderRadius: 4 }] },
      options: { indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } }, scales: { [horizontal ? 'x' : 'y']: { beginAtZero: true, ticks: { precision: 0 } } } },
    });

    // 시간대: 기록이 있는 범위만(최소 8~16시)
    const hrs = an.hours;
    const used = hrs.map((v, h) => (v ? h : null)).filter(h => h != null);
    const hFrom = Math.min(8, ...used), hTo = Math.max(16, ...used);
    const hLabels = [], hData = [];
    for (let h = hFrom; h <= hTo; h++) { hLabels.push(h + '시'); hData.push(hrs[h]); }
    makeChart('chHour', barCfg(hLabels, hData, U.rgba(c, 0.8)));
    makeChart('chWeek', barCfg(A.WEEKDAYS, an.weekdays, U.rgba(c, 0.8)));

    if (an.fn.abcCount) {
      const keys = Object.keys(A.FUNCTIONS);
      makeChart('chFn', {
        type: 'doughnut',
        data: { labels: keys.map(k => A.FUNCTIONS[k]), datasets: [{ data: keys.map(k => A.round(an.fn.percents[k], 1)), backgroundColor: ['#3b5bdb', '#e8590c', '#2b8a3e', '#7048e8'] }] },
        options: { plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: x => `${x.label}: ${x.raw}%` } } } },
      });
      makeChart('chAnte', barCfg(an.antecedents.map(x => x.label), an.antecedents.map(x => x.count), '#fab005', true));
      makeChart('chCons', barCfg(an.consequences.map(x => x.label), an.consequences.map(x => x.count), '#12b886', true));
    } else { emptyChart('chFn'); emptyChart('chAnte'); emptyChart('chCons'); }
  };

  // ---------- 행동중재계획 ----------
  Views.plan = () => {
    const g = guard();
    if (g) return g;
    const b = behavior();
    const recs = S.records(b.id);
    const firstDay = recs.length ? A.dayKey(recs.reduce((m, r) => (r.ts < m ? r.ts : m), recs[0].ts)) : U.today();
    const draft = state.plan && state.plan.behaviorId === b.id ? state.plan : null;
    const saved = S.plans(b.id);
    return `
      <section class="card no-print">
        ${behaviorChips()}
        <h2>행동중재계획서 만들기</h2>
        <p class="muted">기록된 빈도·지속시간·강도·ABC 자료를 분석하여 기능을 추정하고, 기능에 맞는 예방·대체행동·후속결과 전략을 담은 계획서 초안을 작성합니다.</p>
        <form data-form="plan" class="form">
          <div class="three">
            <label>분석 시작일 <input type="date" name="from" value="${draft ? draft.from : firstDay}" required></label>
            <label>분석 종료일 <input type="date" name="to" value="${draft ? draft.to : U.today()}" required></label>
            <label>작성자 <input name="author" value="${esc(draft ? draft.author : (S.setting('author') || ''))}" placeholder="예: 특수교사 홍길동"></label>
          </div>
          <label>대체행동 직접 지정 (선택) <input name="replacement" value="${esc(draft ? draft.replacement : '')}" placeholder="비워 두면 추정된 기능에 맞게 자동 제안"></label>
          <button class="btn primary" type="submit">📊 분석하고 계획서 생성</button>
        </form>
        ${recs.filter(r => r.abc).length < 5 ? '<p class="warn">ABC 기록이 5건 미만이면 기능 추정의 신뢰도가 낮습니다. 가능하면 ABC 기록을 더 모아 주세요.</p>' : ''}
      </section>
      ${draft ? `
      <section class="card no-print">
        <div class="row between">
          <h3>계획서 초안 <small class="muted">(문서를 직접 클릭하여 수정할 수 있어요)</small></h3>
          <div class="row">
            <button class="btn" data-action="printPlan">🖨 인쇄 / PDF</button>
            <button class="btn" data-action="downloadPlan" data-fmt="doc">⬇ Word</button>
            <button class="btn" data-action="downloadPlan" data-fmt="html">⬇ HTML</button>
            <button class="btn primary" data-action="savePlan">💾 저장</button>
          </div>
        </div>
      </section>
      <section class="card paper"><div id="planDoc" contenteditable="true" spellcheck="false">${draft.html}</div></section>` : ''}
      ${aiCard(!!draft)}
      <section class="card no-print">
        <h3>저장된 계획서</h3>
        ${saved.length ? `<ul class="rec-list">${saved.map(p => `<li><div class="rec-main">
          <span>${esc(p.title)}</span><span class="muted small">${new Date(p.createdAt).toLocaleString('ko-KR')}</span><span class="spacer"></span>
          <button class="btn small" data-action="openPlan" data-id="${p.id}">열기</button>
          <button class="icon-btn danger" data-action="deletePlan" data-id="${p.id}">🗑</button></div></li>`).join('')}</ul>` : '<p class="muted">저장된 계획서가 없습니다.</p>'}
      </section>`;
  };

  // ---------- AI 챗봇 연결 (API 키 없이, 사용자 본인의 AI 계정 사용) ----------
  const GENERAL_CHATBOTS = [
    { name: 'Gemini', url: 'https://gemini.google.com/app' },
    { name: 'ChatGPT', url: 'https://chatgpt.com/' },
    { name: 'Claude', url: 'https://claude.ai/new' },
  ];
  function chatbotLinks() {
    const custom = ((window.APP_CONFIG && window.APP_CONFIG.chatbots) || []).filter(c => c && c.url);
    const mine = S.setting('chatbot');
    if (mine && mine.url) custom.push({ name: mine.name || '내 챗봇', url: mine.url });
    return { custom, general: GENERAL_CHATBOTS };
  }
  function aiCard(hasDraft) {
    const { custom, general } = chatbotLinks();
    const link = c => `<a class="btn ${custom.includes(c) ? 'primary' : ''}" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.name)} 열기 ↗</a>`;
    return `
      <section class="card no-print ai-card">
        <h3>🤖 AI 챗봇으로 계획서 다듬기 <small class="muted">(API 키·추가 비용 없음)</small></h3>
        <p class="muted small">위에서 정한 분석 기간의 자료와 ABC 서술 기록을 정리해 복사합니다. 평소 쓰는 AI 챗봇에 붙여넣으면 본인 계정으로 계획서를 작성해 줍니다.</p>
        <ol class="steps">
          <li><b>자료 복사</b>를 누릅니다.</li>
          <li>${custom.length ? '미리 만들어 둔 <b>챗봇</b>' : '<b>AI 챗봇</b>'}을 엽니다.</li>
          <li>입력창에 붙여넣기(Ctrl+V / 길게 눌러 붙여넣기) 후 보냅니다.</li>
        </ol>
        <div class="row wrap">
          ${hasDraft ? '<label class="check"><input type="checkbox" id="aiDraft"> 위 계획서 초안도 함께 보내기</label>' : ''}
        </div>
        <div class="row wrap">
          <button class="btn primary" data-action="copyAi">📋 자료 복사</button>
          <button class="btn" data-action="previewAi">미리보기</button>
          <button class="btn" data-action="downloadAi">⬇ 텍스트 파일</button>
        </div>
        <div class="row wrap ai-links">
          ${custom.map(link).join('')}
          ${general.map(link).join('')}
        </div>
        <p class="muted small">※ 앱에는 가명만 저장되어 있습니다. 서술 기록에 실명이나 학교명을 적지 않았는지 '미리보기'로 한 번 확인한 뒤 보내 주세요. 학교·교육청의 AI 사용 지침을 따라 주세요.</p>
      </section>`;
  }
  function aiText() {
    const f = document.querySelector('form[data-form="plan"]');
    const b = behavior();
    const from = f.from.value, to = f.to.value;
    const an = A.analyze(b, S.records(b.id), { from: from <= to ? from : to, to });
    const draftEl = $('#aiDraft');
    const doc = $('#planDoc');
    return Export.build({
      student: student(), behavior: b, analysis: an,
      draftText: draftEl && draftEl.checked && doc ? doc.innerText : '',
    });
  }
  function copyText(text) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok;
    };
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(() => true, () => fallback());
    }
    return Promise.resolve(fallback());
  }
  function previewAi(text, note) {
    openModal(`<h2>AI 챗봇에 보낼 자료</h2>
      ${note ? `<p class="warn">${note}</p>` : ''}
      <textarea class="ai-preview" readonly>${esc(text)}</textarea>
      <div class="row"><button class="btn primary" data-action="copyAi">📋 복사</button><span class="muted small">${text.length.toLocaleString()}자</span></div>`);
  }

  function currentPlanHtml() {
    const doc = $('#planDoc');
    if (doc && state.plan) state.plan.html = doc.innerHTML;
    return state.plan ? state.plan.html : '';
  }

  // ---------- 설정 ----------
  Views.settings = () => {
    if (state.editStudent) return studentForm();
    const list = S.students();
    return `
      <section class="card">
        <div class="row between"><h2>학생 관리</h2><button class="btn primary" data-action="newStudent">+ 학생 추가</button></div>
        ${list.length ? `<ul class="rec-list">${list.map(s => `<li><div class="rec-main">
          <b>${esc(s.name)}</b><span class="muted">${esc(s.grade || '')}</span>
          <span class="muted small">표적행동 ${S.behaviors(s.id).length}개</span><span class="spacer"></span>
          <button class="btn small" data-action="editStudent" data-id="${s.id}">수정</button>
          <button class="icon-btn danger" data-action="deleteStudent" data-id="${s.id}">🗑</button></div></li>`).join('')}</ul>` : '<p class="muted">등록된 학생이 없습니다.</p>'}
      </section>
      <section class="card">
        <h2>AI 챗봇 연결</h2>
        <p class="muted">중재계획 화면의 '자료 복사' 후 바로 열 챗봇 링크입니다. 직접 만든 Gemini 젬이나 ChatGPT GPT의 공유 링크를 넣으세요.</p>
        <div class="form">
          <div class="two">
            <label>이름 <input id="chatbotName" value="${esc((S.setting('chatbot') || {}).name || '')}" placeholder="예: 우리 학교 행동중재 젬"></label>
            <label>링크 <input id="chatbotUrl" value="${esc((S.setting('chatbot') || {}).url || '')}" placeholder="https://gemini.google.com/gem/..."></label>
          </div>
          <div><button class="btn" data-action="saveChatbot">저장</button></div>
        </div>
      </section>
      <section class="card">
        <h2>데이터 관리</h2>
        <p class="muted">자료는 이 기기의 브라우저에 저장됩니다. 브라우저 기록을 지우면 사라질 수 있으니 정기적으로 백업하세요.</p>
        <div class="row wrap">
          <button class="btn" data-action="exportData">⬇ 백업 파일 내보내기</button>
          <label class="btn">⬆ 백업 파일 불러오기<input type="file" accept="application/json,.json" data-change="importData" hidden></label>
          <button class="btn" data-action="exportCsv">⬇ 기록 CSV 내보내기</button>
          <label class="btn">⬆ 기록 CSV 추가<input type="file" accept=".csv,text/csv" data-change="importCsv" hidden></label>
          <button class="btn" data-action="loadSample">예시 데이터 추가</button>
          <button class="btn danger" data-action="resetData">전체 초기화</button>
        </div>
      </section>
      <section class="card tip">
        <h3>사용 순서</h3>
        <ol>
          <li><b>설정</b>에서 학생을 추가합니다.</li>
          <li><b>표적행동</b>에서 행동을 조작적으로 정의하고 측정 방법을 고릅니다.</li>
          <li><b>기록</b>에서 빈도·지속시간·강도·ABC를 기록합니다. (홈 화면의 +1 버튼으로 빠르게 기록 가능)</li>
          <li><b>달력</b>과 <b>그래프</b>로 변화를 확인합니다. 중재를 시작하면 표적행동에 중재 시작일을 입력하세요.</li>
          <li><b>중재계획</b>에서 자료를 분석하여 행동중재계획서 초안을 만들고 수정·인쇄합니다.</li>
        </ol>
      </section>`;
  };

  function studentForm() {
    const isNew = state.editStudent === 'new';
    const s = isNew ? {} : S.student(state.editStudent);
    return `
      <section class="card">
        <h2>${isNew ? '학생 추가' : '학생 정보 수정'}</h2>
        <form data-form="student" class="form">
          <input type="hidden" name="id" value="${isNew ? '' : s.id}">
          ${PRIVACY_NOTICE}
          <div class="two">
            <label>가명 <small class="muted">(실명 대신 별칭)</small><input name="name" required maxlength="20" value="${esc(s.name || '')}" placeholder="예: 학생A, 별님"></label>
            <label>학년 <small class="muted">(선택)</small><input name="grade" maxlength="20" value="${esc(s.grade || '')}" placeholder="예: 3학년"></label>
          </div>
          <label>참고 특성 <small class="muted">(선택 · 의사소통 수준, 좋아하는 것, 강점 등)</small><input name="info" value="${esc(s.info || '')}" placeholder="예: 2~3어절 구어 사용, 시각 자료 이해가 좋음, 블록 놀이 좋아함"></label>
          <label>메모 <small class="muted">(선택)</small><textarea name="notes" rows="3" placeholder="개인을 알아볼 수 있는 정보는 적지 마세요">${esc(s.notes || '')}</textarea></label>
          <div class="row">
            <button class="btn primary" type="submit">저장</button>
            <button class="btn" type="button" data-action="cancelStudent">취소</button>
          </div>
        </form>
      </section>`;
  }

  // ======================== 기록 동작 ========================
  function addOccurrence(extra, behaviorId) {
    const b = behaviorId ? S.behavior(behaviorId) : behavior();
    const rec = S.addRecord(Object.assign({ behaviorId: b.id, source: 'frequency' }, extra));
    state.lastRecordId = rec.id;
    return rec;
  }

  function csvExport() {
    const rows = [['학생', '표적행동', '날짜', '시각', '지속시간(초)', '강도', '장소', '활동', '선행사건', '선행사건 상세', '행동 묘사', '후속결과', '후속결과 상세', '추정 기능', '메모']];
    const recs = S.data.records.slice().sort((a, b) => new Date(a.ts) - new Date(b.ts));
    for (const r of recs) {
      const b = S.behavior(r.behaviorId);
      const st = b && S.student(b.studentId);
      const x = r.abc || {};
      rows.push([st ? st.name : '', b ? b.name : '', A.dayKey(r.ts), U.timeStr(r.ts), r.durationSec || '', r.intensity || '',
        x.setting || '', x.activity || '', (x.antecedents || []).map(c => A.ANTE_LABELS[c]).join('; '), x.antecedentText || '',
        x.behaviorText || '', (x.consequences || []).map(c => A.CONS_LABELS[c]).join('; '), x.consequenceText || '',
        x.functionGuess ? A.FUNCTIONS[x.functionGuess] : '', x.notes || '']);
    }
    const csv = rows.map(row => row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    U.download(`행동기록_${U.today()}.csv`, '﻿' + csv, 'text/csv;charset=utf-8');
  }

  // ---- CSV 기록 추가: 기존 CSV 내보내기 형식 및 확장된 16열 양식 지원 ----
  function parseCsvText(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some(v => String(v).trim() !== '')) rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); if (row.some(v => String(v).trim() !== '')) rows.push(row); }
    if (rows.length < 2) throw new Error('CSV에 가져올 기록이 없습니다.');
    return { headers: rows[0].map(x => x.trim()), rows: rows.slice(1) };
  }
  function parseDateKey(value) {
    const m = String(value || '').match(/(\d{4})[-/.년]\s*(\d{1,2})[-/.월]\s*(\d{1,2})/);
    return m ? `${m[1]}-${U.pad(m[2])}-${U.pad(m[3])}` : '';
  }
  function parseClock(value) {
    const s = String(value || '').trim();
    if (!s) return '12:00';
    const m = s.match(/(오전|오후)?\s*(\d{1,2}):(\d{2})/);
    if (!m) return '12:00';
    let h = Number(m[2]);
    if (m[1] === '오후' && h < 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
    return `${U.pad(h)}:${m[3]}`;
  }
  function parseDuration(value, start, end) {
    const s = String(value || '').trim();
    if (s) {
      if (/^\d+(\.\d+)?$/.test(s)) return Math.max(0, Math.round(Number(s)));
      let total = 0, found = false, m;
      const re = /(\d+(?:\.\d+)?)\s*(시간|시|분|초|h|m|s)/gi;
      while ((m = re.exec(s))) {
        found = true; const n = Number(m[1]);
        total += n * (/시간|시|h/i.test(m[2]) ? 3600 : /분|m/i.test(m[2]) ? 60 : 1);
      }
      if (found) return Math.round(total);
    }
    if (start && end) {
      const a = start.split(':').map(Number), b = end.split(':').map(Number);
      let diff = (b[0] * 60 + b[1]) - (a[0] * 60 + a[1]);
      if (diff < 0) diff += 1440;
      if (diff > 0) return diff * 60;
    }
    return null;
  }
  function labelCodes(value, labels) {
    const vals = String(value || '').split(/[;；,，]/).map(x => x.trim()).filter(Boolean);
    const codes = [], unknown = [];
    for (const val of vals) {
      const found = Object.entries(labels).find(([code, label]) => label === val || val.includes(label) || label.includes(val));
      if (found) { if (!codes.includes(found[0])) codes.push(found[0]); }
      else unknown.push(val);
    }
    return { codes, unknown: unknown.join('; ') };
  }
  function functionCode(value) {
    const v = String(value || '').trim();
    if (/관심/.test(v)) return 'attention';
    if (/회피|도피|과제/.test(v)) return 'escape';
    if (/물건|활동|획득|요구/.test(v)) return 'tangible';
    if (/감각|자동 강화/.test(v)) return 'sensory';
    return '';
  }
  function rowValue(row, map, ...names) {
    for (const name of names) { const i = map[name]; if (i != null && row[i] != null) return String(row[i]).trim(); }
    return '';
  }
  function csvRowsToRecords(parsed) {
    const normalized = parsed.headers.map(h => h.replace(/^\uFEFF/, '').trim());
    const map = Object.fromEntries(normalized.map((h, i) => [h, i]));
    const has = (...names) => names.some(n => map[n] != null);
    if (!has('학생') || !has('표적행동') || !has('날짜')) throw new Error('학생, 표적행동, 날짜 열이 필요합니다. 사이트에서 내보낸 CSV 양식을 사용해 주세요.');
    return parsed.rows.map((row, index) => {
      const studentName = rowValue(row, map, '학생');
      const behaviorName = rowValue(row, map, '표적행동');
      const date = parseDateKey(rowValue(row, map, '날짜'));
      const start = parseClock(rowValue(row, map, '시작시간', '시각'));
      const end = parseClock(rowValue(row, map, '종료시간'));
      const durationSec = parseDuration(rowValue(row, map, '지속시간(초)', '지속시간'), start, end);
      const intensityRaw = rowValue(row, map, '강도');
      const intensity = intensityRaw && Number.isFinite(Number(intensityRaw)) ? Number(intensityRaw) : null;
      const setting = rowValue(row, map, '장소');
      const activity = rowValue(row, map, '활동');
      const ante = labelCodes(rowValue(row, map, '선행사건'), A.ANTE_LABELS);
      const cons = labelCodes(rowValue(row, map, '후속결과'), A.CONS_LABELS);
      const antecedentText = rowValue(row, map, '선행사건 상세');
      const behaviorText = rowValue(row, map, '행동 묘사');
      const consequenceText = rowValue(row, map, '후속결과 상세');
      const guessText = rowValue(row, map, '추정 기능');
      const notes = rowValue(row, map, '메모');
      if (!studentName || !behaviorName || !date) return { invalid: true, line: index + 2, reason: '학생·표적행동·날짜 누락 또는 날짜 형식 오류' };
      const ts = new Date(`${date}T${start}:00`);
      if (Number.isNaN(ts.getTime())) return { invalid: true, line: index + 2, reason: '날짜 또는 시각 형식 오류' };
      const abc = { setting, activity, antecedents: ante.codes, antecedentText: [antecedentText, ante.unknown].filter(Boolean).join(' / '), behaviorText, consequences: cons.codes, consequenceText: [consequenceText, cons.unknown].filter(Boolean).join(' / '), functionGuess: functionCode(guessText), notes };
      const hasAbc = setting || activity || ante.codes.length || abc.antecedentText || behaviorText || cons.codes.length || abc.consequenceText || abc.functionGuess || notes;
      return { studentName, behaviorName, date, start, end, durationSec, intensity, ts: ts.toISOString(), source: hasAbc ? 'abc' : 'frequency', abc: hasAbc ? abc : null, line: index + 2 };
    });
  }
  function csvFingerprint(x) {
    return [x.studentName, x.behaviorName, x.ts, x.durationSec == null ? '' : x.durationSec, x.intensity == null ? '' : x.intensity,
      x.abc && x.abc.setting, x.abc && x.abc.activity, x.abc && x.abc.behaviorText, x.abc && x.abc.antecedentText, x.abc && x.abc.consequenceText].map(v => String(v || '').trim()).join('|');
  }
  function prepareCsvImport(file) {
    file.text().then(text => {
      try {
        const parsed = parseCsvText(text);
        const records = csvRowsToRecords(parsed);
        const invalid = records.filter(x => x.invalid);
        const valid = records.filter(x => !x.invalid);
        const existing = new Set(S.data.records.map(r => {
          const b = S.behavior(r.behaviorId), st = b && S.student(b.studentId);
          return csvFingerprint({ studentName: st && st.name, behaviorName: b && b.name, ts: r.ts, durationSec: r.durationSec, intensity: r.intensity, abc: r.abc });
        }));
        const seen = new Set();
        let duplicates = 0;
        for (const x of valid) { const fp = csvFingerprint(x); if (existing.has(fp) || seen.has(fp)) duplicates++; else seen.add(fp); }
        pendingCsvImport = { valid, invalid, duplicates };
        openModal(`<h2>기록 CSV 가져오기 미리보기</h2>
          <p>파일: <b>${esc(file.name)}</b></p>
          <div class="card"><p>전체 행 <b>${records.length}건</b></p><p>추가 가능 <b>${Math.max(0, valid.length - duplicates)}건</b></p><p>중복 예상 <b>${duplicates}건</b> (추가하지 않음)</p><p>오류 행 <b>${invalid.length}건</b> (추가하지 않음)</p></div>
          ${invalid.length ? `<p class="muted small">오류 예시: ${invalid.slice(0, 5).map(x => `행 ${x.line}: ${esc(x.reason)}`).join(' · ')}</p>` : ''}
          <p class="muted small">학생이나 표적행동이 없으면 자동 생성합니다. 기존 기록은 삭제하거나 덮어쓰지 않습니다.</p>
          <div class="row"><button class="btn primary" data-action="confirmCsvImport" ${valid.length - duplicates <= 0 ? 'disabled' : ''}>${Math.max(0, valid.length - duplicates)}건 추가</button><button class="btn" data-action="closeModal">취소</button></div>`);
      } catch (e) { alert('CSV를 읽지 못했습니다: ' + e.message); }
    }).catch(e => alert('파일을 읽지 못했습니다: ' + e.message));
  }

  // ======================== 이벤트 ========================
  const Actions = {
    closeModal,
    newStudent() { state.editStudent = 'new'; go('settings'); },
    editStudent(el) { state.editStudent = el.dataset.id; render(); },
    cancelStudent() { state.editStudent = null; render(); },
    deleteStudent(el) {
      const s = S.student(el.dataset.id);
      if (!confirm(`'${s.name}' 학생과 모든 표적행동·기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      S.deleteStudent(s.id);
      render();
    },
    loadSample() { S.loadSample(); state.plan = null; toast('예시 데이터를 추가했습니다.'); go('home'); },

    goBehaviorNew() { state.editBehavior = 'new'; state.template = null; go('behaviors'); },
    newBehavior() { state.editBehavior = 'new'; state.template = null; render(); },
    editBehavior(el) { state.editBehavior = el.dataset.id; render(); },
    cancelBehavior() { state.editBehavior = null; state.template = null; render(); },
    useTemplate(el) {
      const t = BEHAVIOR_TEMPLATES[Number(el.dataset.i)];
      state.template = Object.assign({}, t, { measures: t.measures.slice() });
      render();
    },
    deleteBehavior(el) {
      const b = S.behavior(el.dataset.id);
      if (!confirm(`'${b.name}'과(와) 관련된 모든 기록을 삭제할까요? 되돌릴 수 없습니다.`)) return;
      S.deleteBehavior(b.id);
      render();
    },
    pickBehavior(el) { S.setSetting('behaviorId', el.dataset.id); state.lastRecordId = null; render(); },

    goRecord(el) { S.setSetting('behaviorId', el.dataset.id); state.recordTab = 'frequency'; go('record'); },
    quickFrequency(el) {
      const rec = addOccurrence({}, el.dataset.id);
      toast(`${S.behavior(rec.behaviorId).name} +1 (${U.timeStr(rec.ts)})`);
      render();
    },
    recordTab(el) { state.recordTab = el.dataset.tab; render(); },
    tapFrequency() { addOccurrence({}); if (navigator.vibrate) navigator.vibrate(30); render(); },
    undoLast() {
      const recs = sortDesc(recordsOn(behavior().id, U.today()));
      if (!recs.length) return;
      S.deleteRecord(recs[0].id);
      toast('마지막 기록을 취소했습니다.');
      render();
    },
    setLastIntensity(el) {
      S.updateRecord(state.lastRecordId, { intensity: Number(el.dataset.lvl) });
      toast(`강도 ${el.dataset.lvl}점을 추가했습니다.`);
      render();
    },
    tapIntensity(el) {
      addOccurrence({ intensity: Number(el.dataset.lvl), source: 'intensity' });
      state.lastRecordId = null;
      toast(`강도 ${el.dataset.lvl}점으로 기록했습니다.`);
      render();
    },
    startTimer() { S.setSetting('stopwatch', { behaviorId: behavior().id, start: Date.now() }); render(); },
    stopTimer() {
      const sw = S.setting('stopwatch');
      if (!sw) return;
      const sec = Math.max(1, Math.round((Date.now() - sw.start) / 1000));
      addOccurrence({ ts: new Date(sw.start).toISOString(), durationSec: sec, source: 'duration' }, sw.behaviorId);
      S.setSetting('stopwatch', null);
      toast(`지속시간 ${U.fmtDur(sec)} 기록`);
      render();
    },
    cancelTimer() { if (confirm('측정을 취소할까요?')) { S.setSetting('stopwatch', null); render(); } },
    deleteRecord(el) {
      if (!confirm('이 기록을 삭제할까요?')) return;
      S.deleteRecord(el.dataset.id);
      if (state.modalDay && !$('#modal').classList.contains('hidden')) dayModal(state.modalDay);
      render();
    },
    editRecord(el) {
      const r = S.record(el.dataset.id);
      openModal(`<h2>기록 수정 <small class="muted">(ABC 정보는 선택 입력)</small></h2>${abcForm(S.behavior(r.behaviorId), r)}`);
    },
    abcForDay(el) {
      const b = behavior();
      openModal(`<h2>ABC 기록 작성</h2>${abcForm(b)}`);
      const f = $('#modalBody form');
      f.date.value = el.dataset.day;
      f.time.value = '12:00';
    },

    calMove(el) {
      const [y, m] = state.calMonth.split('-').map(Number);
      const d = new Date(y, m - 1 + Number(el.dataset.d), 1);
      state.calMonth = `${d.getFullYear()}-${U.pad(d.getMonth() + 1)}`;
      render();
    },
    calToday() { state.calMonth = U.today().slice(0, 7); render(); },
    openDay(el) { dayModal(el.dataset.day); },

    graphRange(el) { state.graphRange = el.dataset.r; render(); },

    printPlan() {
      const html = currentPlanHtml();
      $('#printArea').innerHTML = html;
      window.print();
    },
    downloadPlan(el) {
      const html = currentPlanHtml();
      const st = student();
      const name = `행동중재계획서_${st.name}_${behavior().name}_${U.today()}`;
      const doc = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(name)}</title><style>${Plan.CSS}</style></head><body>${html}</body></html>`;
      if (el.dataset.fmt === 'doc') U.download(name + '.doc', '﻿' + doc, 'application/msword');
      else U.download(name + '.html', '<!doctype html>' + doc, 'text/html;charset=utf-8');
    },
    savePlan() {
      const html = currentPlanHtml();
      const p = state.plan;
      const saved = S.addPlan({ id: p.savedId, behaviorId: p.behaviorId, title: `${behavior().name} 계획서 (${p.from} ~ ${p.to})`, html, from: p.from, to: p.to, author: p.author, replacement: p.replacement });
      p.savedId = saved.id;
      toast('계획서를 저장했습니다.');
      render();
    },
    openPlan(el) {
      const p = S.plan(el.dataset.id);
      state.plan = { behaviorId: p.behaviorId, html: p.html, from: p.from, to: p.to, author: p.author || '', replacement: p.replacement || '', savedId: p.id };
      render();
    },
    deletePlan(el) {
      if (!confirm('저장된 계획서를 삭제할까요?')) return;
      S.deletePlan(el.dataset.id);
      if (state.plan && state.plan.savedId === el.dataset.id) state.plan.savedId = null;
      render();
    },

    copyAi() {
      const inModal = $('.ai-preview');
      const text = inModal ? inModal.value : aiText();
      copyText(text).then(ok => {
        if (ok) toast('복사했습니다. AI 챗봇에 붙여넣으세요.');
        else previewAi(text, '자동 복사가 안 되는 환경입니다. 아래 글을 모두 선택(Ctrl+A)하여 복사하세요.');
      });
    },
    previewAi() { previewAi(aiText()); },
    downloadAi() { U.download(`AI요청자료_${behavior().name}_${U.today()}.txt`, aiText(), 'text/plain;charset=utf-8'); },
    saveChatbot() {
      const name = $('#chatbotName').value.trim();
      const url = $('#chatbotUrl').value.trim();
      if (url && !/^https:\/\//.test(url)) { alert('https:// 로 시작하는 링크를 입력하세요.'); return; }
      S.setSetting('chatbot', url ? { name, url } : null);
      toast(url ? '챗봇 링크를 저장했습니다.' : '챗봇 링크를 지웠습니다.');
      render();
    },

    exportData() { U.download(`행동중재도우미_백업_${U.today()}.json`, S.exportJSON(), 'application/json'); },
    exportCsv: csvExport,
    confirmCsvImport() {
      if (!pendingCsvImport) return;
      const { valid, invalid } = pendingCsvImport;
      const existing = new Set(S.data.records.map(r => {
        const b = S.behavior(r.behaviorId), st = b && S.student(b.studentId);
        return csvFingerprint({ studentName: st && st.name, behaviorName: b && b.name, ts: r.ts, durationSec: r.durationSec, intensity: r.intensity, abc: r.abc });
      }));
      const seen = new Set();
      let added = 0, skipped = 0;
      for (const x of valid) {
        const fp = csvFingerprint(x);
        if (existing.has(fp) || seen.has(fp)) { skipped++; continue; }
        seen.add(fp);
        let st = S.students().find(s => s.name === x.studentName);
        if (!st) st = S.upsertStudent({ name: x.studentName, grade: '', info: '', notes: '' });
        let b = S.behaviors(st.id).find(y => y.name === x.behaviorName);
        if (!b) b = S.upsertBehavior({ studentId: st.id, name: x.behaviorName, definition: '', examples: '', nonExamples: '', measures: ['frequency', 'duration', 'intensity', 'abc'], color: COLORS[S.behaviors(st.id).length % COLORS.length], interventionDate: '', intensityScale: DEFAULT_INTENSITY.slice() });
        const rec = { behaviorId: b.id, ts: x.ts, source: x.source };
        if (x.durationSec != null) rec.durationSec = x.durationSec;
        if (x.intensity != null) rec.intensity = x.intensity;
        if (x.abc) rec.abc = x.abc;
        S.addRecord(rec);
        added++;
      }
      pendingCsvImport = null;
      closeModal(); state.plan = null;
      toast(`기록 ${added}건 추가${skipped ? ` · 중복 ${skipped}건 제외` : ''}${invalid.length ? ` · 오류 ${invalid.length}건 제외` : ''}`);
      go('settings');
    },
    resetData() {
      if (!confirm('모든 학생·표적행동·기록·계획서를 삭제할까요? 되돌릴 수 없습니다.')) return;
      if (!confirm('정말 삭제할까요? 백업하지 않은 자료는 복구할 수 없습니다.')) return;
      S.reset();
      state.plan = null;
      go('home');
    },
  };

  const Changes = {
    selectStudent(el) {
      if (el.value === '__new') { Actions.newStudent(); return; }
      S.setSetting('studentId', el.value);
      state.plan = null;
      state.lastRecordId = null;
      render();
    },
    calMetric(el) { state.calMetric = el.value; render(); },
    importCsv(el) {
      const file = el.files && el.files[0];
      if (!file) return;
      prepareCsvImport(file);
      el.value = '';
    },
    importData(el) {
      const file = el.files[0];
      if (!file) return;
      if (!confirm('현재 자료를 백업 파일의 내용으로 바꿀까요?')) { el.value = ''; return; }
      file.text().then(text => {
        try { S.importJSON(text); state.plan = null; toast('불러오기 완료'); go('home'); }
        catch (e) { alert('불러오기 실패: ' + e.message); }
      });
    },
  };

  const Forms = {
    student(f) {
      const fd = new FormData(f);
      const obj = Object.fromEntries(['name', 'grade', 'info', 'notes'].map(k => [k, (fd.get(k) || '').trim()]));
      if (U.looksLikeRealName(obj.name) && !confirm(`'${obj.name}'은(는) 실명처럼 보입니다.\n개인정보 보호를 위해 가명(예: 학생A, 별님) 사용을 권장합니다.\n\n가명이 맞으면 [확인], 고치려면 [취소]를 누르세요.`)) return;
      if (fd.get('id')) obj.id = fd.get('id');
      const s = S.upsertStudent(obj);
      S.setSetting('studentId', s.id);
      state.editStudent = null;
      toast('저장했습니다.');
      if (!S.behaviors(s.id).length) { state.editBehavior = 'new'; go('behaviors'); } else render();
    },
    behavior(f) {
      const fd = new FormData(f);
      const measures = fd.getAll('measures');
      if (!measures.length) { alert('측정 방법을 하나 이상 선택하세요.'); return; }
      const obj = {
        studentId: student().id,
        name: fd.get('name').trim(),
        definition: fd.get('definition').trim(),
        examples: fd.get('examples').trim(),
        nonExamples: fd.get('nonExamples').trim(),
        measures,
        intensityScale: [0, 1, 2, 3, 4].map(i => (fd.get('scale' + i) || '').trim() || DEFAULT_INTENSITY[i]),
        interventionDate: fd.get('interventionDate') || '',
        color: fd.get('color'),
        goal: fd.get('goal').trim(),
      };
      if (fd.get('id')) obj.id = fd.get('id');
      const b = S.upsertBehavior(obj);
      S.setSetting('behaviorId', b.id);
      state.editBehavior = null;
      state.template = null;
      toast('표적행동을 저장했습니다.');
      render();
    },
    bulk(f) {
      const fd = new FormData(f);
      const n = Math.min(200, Math.max(1, Number(fd.get('count')) || 1));
      const ts = U.toISO(fd.get('date'), fd.get('time'));
      for (let i = 0; i < n; i++) S.addRecord({ behaviorId: behavior().id, ts, source: 'frequency' });
      toast(`${n}회를 추가했습니다.`);
      if (!$('#modal').classList.contains('hidden')) dayModal(fd.get('date'));
      render();
    },
    duration(f) {
      const fd = new FormData(f);
      const sec = (Number(fd.get('min')) || 0) * 60 + (Number(fd.get('sec')) || 0);
      if (sec <= 0) { alert('지속시간을 입력하세요.'); return; }
      addOccurrence({ ts: U.toISO(fd.get('date'), fd.get('time')), durationSec: sec, source: 'duration' });
      toast(`지속시간 ${U.fmtDur(sec)} 기록`);
      render();
    },
    abc(f) {
      const fd = new FormData(f);
      const sec = (Number(fd.get('min')) || 0) * 60 + (Number(fd.get('sec')) || 0);
      const abc = {
        setting: fd.get('setting').trim(),
        activity: fd.get('activity').trim(),
        antecedents: fd.getAll('antecedents'),
        antecedentText: fd.get('antecedentText').trim(),
        behaviorText: fd.get('behaviorText').trim(),
        consequences: fd.getAll('consequences'),
        consequenceText: fd.get('consequenceText').trim(),
        functionGuess: fd.get('functionGuess'),
        notes: fd.get('notes').trim(),
      };
      const hasAbc = abc.antecedents.length || abc.consequences.length || abc.antecedentText || abc.behaviorText || abc.consequenceText || abc.setting || abc.activity || abc.functionGuess || abc.notes;
      const patch = {
        ts: U.toISO(fd.get('date'), fd.get('time')),
        durationSec: sec || undefined,
        intensity: Number(fd.get('intensity')) || undefined,
        abc: hasAbc ? abc : undefined,
      };
      const id = fd.get('id');
      if (id) {
        S.updateRecord(id, patch);
        toast('기록을 수정했습니다.');
      } else {
        if (!hasAbc) { alert('선행사건이나 후속결과를 하나 이상 입력하세요.'); return; }
        S.addRecord(Object.assign({ behaviorId: fd.get('behaviorId'), source: 'abc' }, patch));
        toast('ABC 기록을 저장했습니다.');
      }
      const inModal = f.closest('#modal');
      if (inModal) {
        if (state.view === 'calendar' && state.modalDay) dayModal(state.modalDay); else closeModal();
      }
      render();
    },
    plan(f) {
      const fd = new FormData(f);
      const from = fd.get('from'), to = fd.get('to');
      if (from > to) { alert('분석 시작일이 종료일보다 늦습니다.'); return; }
      const b = behavior();
      const an = A.analyze(b, S.records(b.id), { from, to });
      const author = fd.get('author').trim();
      const replacement = fd.get('replacement').trim();
      S.setSetting('author', author);
      const html = Plan.generate({ student: student(), behavior: b, analysis: an, author, replacement });
      state.plan = { behaviorId: b.id, html, from, to, author, replacement, savedId: null };
      render();
      const doc = $('#planDoc');
      if (doc) doc.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
  };

  document.addEventListener('click', e => {
    const nav = e.target.closest('#nav button');
    if (nav) {
      state.editBehavior = null;
      state.editStudent = null;
      go(nav.dataset.view);
      return;
    }
    if (e.target.id === 'modal') { closeModal(); return; }
    const el = e.target.closest('[data-action]');
    if (el && Actions[el.dataset.action]) {
      e.preventDefault();
      Actions[el.dataset.action](el, e);
    }
  });
  document.addEventListener('change', e => {
    const el = e.target.closest('[data-change]');
    if (el && Changes[el.dataset.change]) Changes[el.dataset.change](el, e);
  });
  document.addEventListener('submit', e => {
    const f = e.target.closest('form[data-form]');
    if (f && Forms[f.dataset.form]) {
      e.preventDefault();
      Forms[f.dataset.form](f);
    }
  });
  // 계획서 본문 수정 내용을 화면 전환 후에도 유지
  document.addEventListener('input', e => {
    if (e.target.id === 'planDoc' && state.plan) state.plan.html = e.target.innerHTML;
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('afterprint', () => { $('#printArea').innerHTML = ''; });

  // 계획서 스타일을 한 곳(Plan.CSS)에서 관리
  const style = document.createElement('style');
  style.textContent = Plan.CSS;
  document.head.appendChild(style);

  render();
})();
