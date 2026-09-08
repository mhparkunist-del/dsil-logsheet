/* =====================================================================
   DSIL Run Sheet – 공정 런: 목록 + 런시트(스텝별 기록, 시트 편집, 변경 이력, 인쇄, CSV)
   해시: #id=<runId>[&step=<stepId>]  (step 이 있으면 그 스텝 기록 창을 바로 엶)
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore;
  var esc = U.esc, fmtDate = U.fmtDate, fmtTime = U.fmtTime, fmtDateTime = U.fmtDateTime, fmtDuration = U.fmtDuration, toLocalInput = U.toLocalInput, fromLocalInput = U.fromLocalInput, localDate = U.localDate, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, promptDlg = U.promptDlg, empty = U.empty, csvCell = U.csvCell, download = U.download;
  var store = S.create(CFG);
  var PH = Object.assign({ maxEdge: 1400, quality: 0.85, maxPerStep: 6 }, CFG.photo || {});
  var STEP_CLS = { pending: 'bg-secondary-lt', running: 'bg-yellow-lt', done: 'bg-green-lt', skipped: 'bg-secondary-lt', failed: 'bg-red-lt' };
  var RUN_CLS = { active: 'bg-blue-lt', paused: 'bg-secondary-lt', done: 'bg-green-lt', aborted: 'bg-red-lt' };
  var state = { ready: false, error: null, runId: null, openStepId: null, run: null, logs: [], modules: [], flows: [], runs: [], print: false, printMode: 'actual', editSheet: false, logFilter: 'all', filter: { status: '', q: '' }, dialogStep: null };

  function me() { return store.getMe(); }
  function ensureMe() {
    var n = me(); if (n) return Promise.resolve(n);
    return promptDlg({ title: '내 이름', message: '기록에 작업자로 붙는 이름을 먼저 정하세요. 이 브라우저에 기억됩니다.', input: 'text', placeholder: '홍길동', okLabel: '저장' })
      .then(function (v) { if (!v) return null; return store.setMe(v).then(function () { renderChrome(); return v; }); });
  }
  function readHash() { var q = new URLSearchParams(window.location.hash.replace(/^#/, '')); state.runId = q.get('id') || null; state.openStepId = q.get('step') || null; }
  function stepById(id) { return state.run ? state.run.steps.filter(function (s) { return s.id === id; })[0] || null : null; }
  function modById(id) { return state.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function minutesOf(s) { if (!s.startedAt) return 0; var e = s.endedAt ? new Date(s.endedAt) : new Date(); return Math.max(0, (e - new Date(s.startedAt)) / 60000); }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a === 'step-start' ? 'bg-yellow-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }

  function reload() {
    if (state.runId) {
      return Promise.all([store.getRun(state.runId), store.listLogs(state.runId), store.listModules(), store.listFlows()]).then(function (r) { state.run = r[0]; state.logs = r[1]; state.modules = r[2]; state.flows = r[3]; });
    }
    return store.listRuns().then(function (r) { state.runs = r; state.run = null; });
  }

  /* ---------- 렌더 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var name = me();
    slot.innerHTML = '<button type="button" class="btn btn-sm' + (name ? '' : ' btn-outline-primary') + '" data-action="set-me" title="기록에 붙을 작업자 이름"><i class="ti ti-user me-1"></i>' + (name ? esc(name) : '내 이름 설정') + '</button>';
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    document.body.classList.toggle('print-mode', state.print && !!state.run);
    var title = $('#page-title'); if (title) title.textContent = state.run ? state.run.title : '공정 런';
    if (!state.runId) { app.innerHTML = renderList(); return; }
    if (!state.run) { app.innerHTML = '<div class="card">' + empty('clipboard-off', '런을 찾을 수 없습니다', '삭제되었거나 주소가 잘못되었습니다.') + '<div class="text-center pb-4"><a href="./index.html" class="btn">런 목록</a></div></div>'; return; }
    app.innerHTML = state.print ? renderPrint() : renderDetail();
  }

  function renderList() {
    var f = state.filter, q = f.q.trim().toLowerCase();
    var rows = state.runs.filter(function (r) { if (f.status && r.status !== f.status) return false; if (q && [r.code, r.title, r.sample, r.owner, r.flowName].join(' ').toLowerCase().indexOf(q) < 0) return false; return true; });
    var html = '<div class="card mb-3"><div class="card-body"><form id="list-filter" class="row g-2 align-items-end"><div class="col-6 col-md-3"><label class="form-label">상태</label><select class="form-select" name="status"><option value="">전체</option>' + Object.keys(S.RUN_STATUS).map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + S.RUN_STATUS[k] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-4"><label class="form-label">검색</label><input type="search" class="form-control" name="q" value="' + esc(f.q) + '" placeholder="코드, 제목, 시료, 담당자, 흐름" autocomplete="off"></div>'
      + '<div class="col-12 col-md-5 d-flex justify-content-md-end gap-2"><a href="../index.html?new=1" class="btn btn-primary"><i class="ti ti-player-play me-1"></i>새 런 시작</a></div></form></div></div>';
    html += '<div class="card">' + (rows.length ? '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th class="w-1">코드</th><th>런</th><th>시료</th><th>담당자</th><th style="min-width:140px">진행</th><th class="w-1">시작</th><th class="w-1">상태</th><th class="w-1"></th></tr></thead><tbody>'
      + rows.map(function (r) { var pg = S.progress(r); return '<tr><td class="text-nowrap tnum"><a href="#id=' + esc(r.id) + '">' + esc(r.code) + '</a></td><td><a href="#id=' + esc(r.id) + '" class="text-reset fw-medium">' + esc(r.title) + '</a><span class="sub">' + esc(r.flowName || '빈 런') + '</span></td><td>' + esc(r.sample || '-') + '</td><td>' + esc(r.owner || '-') + '</td><td><div class="d-flex align-items-center gap-2"><div class="progress progress-sm flex-fill"><div class="progress-bar" style="width:' + pg.pct + '%"></div>' + (pg.failed ? '<div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / pg.total * 100) + '%"></div>' : '') + '</div><span class="small tnum text-nowrap">' + pg.finished + '/' + pg.total + '</span></div></td><td class="text-nowrap text-secondary">' + fmtDate(r.startedAt) + '</td><td><span class="badge ' + RUN_CLS[r.status] + '">' + esc(S.RUN_STATUS[r.status]) + '</span></td><td class="text-end"><a href="#id=' + esc(r.id) + '" class="btn btn-sm">열기</a></td></tr>'; }).join('')
      + '</tbody></table></div>' : empty('clipboard-list', '런이 없습니다', '홈에서 "새 런 시작"을 누르세요.')) + '</div>';
    return html;
  }

  function stepActions(s) {
    var r = state.run, out = [];
    if (state.editSheet) {
      out.push('<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="sheet-insert" data-index="' + (s.seq - 1) + '" title="이 앞에 스텝 추가"><i class="ti ti-row-insert-top"></i></button>');
      out.push('<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="sheet-move" data-id="' + esc(s.id) + '" data-dir="up" title="위로"' + (s.seq === 1 ? ' disabled' : '') + '><i class="ti ti-chevron-up"></i></button>');
      out.push('<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="sheet-move" data-id="' + esc(s.id) + '" data-dir="down" title="아래로"' + (s.seq === r.steps.length ? ' disabled' : '') + '><i class="ti ti-chevron-down"></i></button>');
      out.push('<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="sheet-edit" data-id="' + esc(s.id) + '" title="계획 조건·이름 수정"><i class="ti ti-pencil"></i></button>');
      if (s.status === 'pending') out.push('<button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="sheet-remove" data-id="' + esc(s.id) + '" title="삭제"><i class="ti ti-x"></i></button>');
      else out.push('<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="step-reopen" data-id="' + esc(s.id) + '" title="대기로 되돌리기"><i class="ti ti-arrow-back-up"></i></button>');
      return out.join('');
    }
    var active = r.status === 'active';
    if (active && s.status === 'pending') out.push('<button type="button" class="btn btn-sm btn-outline-primary btn-icon" data-action="step-start" data-id="' + esc(s.id) + '" title="지금 시작"><i class="ti ti-player-play"></i></button> <button type="button" class="btn btn-sm btn-primary" data-action="step-open" data-id="' + esc(s.id) + '">기록</button>');
    else if (active && s.status === 'running') out.push('<button type="button" class="btn btn-sm btn-warning" data-action="step-open" data-id="' + esc(s.id) + '"><i class="ti ti-player-stop me-1"></i>완료 기록</button>');
    else out.push('<button type="button" class="btn btn-sm" data-action="step-open" data-id="' + esc(s.id) + '">' + (S.TERMINAL[s.status] ? '기록 보기' : '기록') + '</button>');
    return out.join('');
  }
  function stepRow(s, pg) {
    var isCur = !!(pg.current && pg.current.id === s.id);
    var timeTxt = s.startedAt ? fmtDateTime(s.startedAt) + (s.endedAt ? ' ~ ' + (localDate(s.endedAt) === localDate(s.startedAt) ? fmtTime(s.endedAt) : fmtDateTime(s.endedAt)) : '') : '';
    var dur = s.startedAt ? fmtDuration(minutesOf(s)) + (s.endedAt ? '' : ' 경과') : (s.minutes ? '예상 ' + fmtDuration(s.minutes) : '');
    var hasActual = Object.keys(s.actual || {}).length > 0;
    return '<tr class="st-' + s.status + (isCur ? ' is-current' : '') + '" data-step="' + esc(s.id) + '">'
      + '<td class="text-center"><span class="step-num is-' + s.status + '">' + s.seq + '</span></td>'
      + '<td>' + (s.group ? '<div class="step-group">' + esc(s.group) + '</div>' : '') + '<div class="fw-medium"><a href="#" data-action="step-open" data-id="' + esc(s.id) + '" class="text-reset">' + esc(s.name) + '</a>' + (s.addedInRun ? ' <span class="badge bg-purple-lt">런 중 추가</span>' : '') + '</div>'
      + '<div class="small text-secondary">' + P.catBadge(s.category) + (s.equipment ? ' ' + esc(s.equipment) : '') + '</div>' + (s.itemNote ? '<div class="small text-secondary"><i class="ti ti-note"></i> ' + esc(s.itemNote) + '</div>' : '') + '</td>'
      + '<td class="param-cell">' + P.summary(s.fields, s.planned) + '</td>'
      + '<td class="param-cell">' + (hasActual ? P.summary(s.fields, s.actual, s.planned) : '<span class="text-secondary">-</span>') + '</td>'
      + '<td><span class="badge ' + STEP_CLS[s.status] + '">' + esc(S.STEP_STATUS[s.status]) + '</span></td>'
      + '<td class="small">' + (s.operator ? '<div class="fw-medium">' + esc(s.operator) + '</div>' : '') + (timeTxt ? '<div class="text-secondary text-nowrap">' + timeTxt + '</div>' : '') + (dur ? '<div class="text-secondary">' + esc(dur) + '</div>' : '') + '</td>'
      + '<td class="small">' + (s.result ? '<div>' + esc(s.result) + '</div>' : '') + (s.issues ? '<div class="text-red"><i class="ti ti-alert-triangle"></i> ' + esc(s.issues) + '</div>' : '') + (s.note ? '<div class="text-secondary">' + esc(s.note) + '</div>' : '') + (s.photos && s.photos.length ? '<div class="text-secondary"><i class="ti ti-photo"></i> ' + s.photos.length + '장</div>' : '') + '</td>'
      + '<td class="text-end text-nowrap">' + stepActions(s) + '</td></tr>';
  }

  function renderDetail() {
    var r = state.run, pg = S.progress(r), cur = pg.current, active = r.status === 'active';
    var totalMin = r.steps.reduce(function (a, s) { return a + (s.status === 'done' ? minutesOf(s) : 0); }, 0);
    var html = '<div class="card mb-3"><div class="card-body"><div class="row g-3 align-items-center">'
      + '<div class="col-lg-7"><div class="text-secondary small tnum">' + esc(r.code) + ' · <span class="badge ' + RUN_CLS[r.status] + '">' + esc(S.RUN_STATUS[r.status]) + '</span>' + (r.flowName ? ' · 흐름 <b>' + esc(r.flowName) + '</b>' : ' · 빈 런') + '</div>'
      + '<h2 class="mb-1">' + esc(r.title) + '</h2>'
      + '<div class="datagrid run-meta">' + U.dg('시료 / 웨이퍼', esc(r.sample || '-')) + U.dg('담당자', esc(r.owner || '-')) + U.dg('기판', esc(r.substrate || '-')) + U.dg('시작', fmtDateTime(r.startedAt)) + (r.endedAt ? U.dg('종료', fmtDateTime(r.endedAt)) : '') + U.dg('작업 시간 합계', esc(fmtDuration(totalMin))) + '</div>'
      + (r.goal ? '<div class="mt-2 small"><i class="ti ti-target me-1 text-primary"></i>' + esc(r.goal) + '</div>' : '') + (r.note ? '<div class="mt-1 small text-secondary">' + esc(r.note) + '</div>' : '') + '</div>'
      + '<div class="col-lg-5"><div class="d-flex justify-content-between small mb-1"><span>' + pg.done + ' 완료' + (pg.skipped ? ' · ' + pg.skipped + ' 건너뜀' : '') + (pg.failed ? ' · <span class="text-red">' + pg.failed + ' 실패</span>' : '') + ' / ' + pg.total + ' 스텝</span><span class="tnum">' + pg.pct + '%</span></div>'
      + '<div class="progress progress-sm mb-3"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-secondary" style="width:' + Math.round(pg.skipped / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div>'
      + '<div class="d-flex flex-wrap gap-2">'
      + (active && cur ? '<button type="button" class="btn btn-primary" data-action="step-open" data-id="' + esc(cur.id) + '"><i class="ti ti-pencil me-1"></i>' + cur.seq + '. ' + esc(cur.name) + (cur.status === 'running' ? ' 완료 기록' : ' 기록') + '</button>' : '')
      + (active && pg.allDone ? '<button type="button" class="btn btn-success" data-action="run-status" data-status="done"><i class="ti ti-flag-check me-1"></i>런 완료 처리</button>' : '')
      + '<button type="button" class="btn' + (state.editSheet ? ' btn-purple active' : '') + '" data-action="toggle-edit"><i class="ti ti-list-details me-1"></i>' + (state.editSheet ? '시트 편집 끝' : '시트 편집') + '</button>'
      + '<button type="button" class="btn" data-action="sheet-insert" data-index="' + r.steps.length + '"><i class="ti ti-plus me-1"></i>스텝 추가</button>'
      + '<button type="button" class="btn" data-action="print"><i class="ti ti-printer me-1"></i>인쇄</button>'
      + '<button type="button" class="btn" data-action="csv"><i class="ti ti-file-spreadsheet me-1"></i>CSV</button>'
      + '<button type="button" class="btn" data-action="run-more"><i class="ti ti-dots"></i></button>'
      + '</div></div></div></div></div>';
    if (state.editSheet) html += '<div class="alert alert-info py-2 px-3"><i class="ti ti-info-circle me-1"></i><b>시트 편집 모드</b> — 스텝 추가·삭제·순서·계획 조건을 바꿀 수 있고, 모든 변경은 아래 변경 이력에 남습니다. 진행된 스텝은 삭제 대신 되돌리기(대기)만 됩니다.</div>';
    if (!r.steps.length) html += '<div class="card mb-3">' + empty('list', '스텝이 없습니다', '"스텝 추가"로 모듈이나 흐름을 넣으세요.') + '</div>';
    else html += '<div class="card mb-3"><div class="table-responsive"><table class="table table-vcenter card-table steps-table"><thead><tr><th class="w-1">#</th><th style="min-width:200px">공정</th><th style="min-width:180px">계획 조건</th><th style="min-width:180px">실제 조건</th><th class="w-1">상태</th><th>작업자 · 시각</th><th style="min-width:160px">결과 · 특이사항</th><th class="w-1"></th></tr></thead><tbody>' + r.steps.map(function (s) { return stepRow(s, pg); }).join('') + '</tbody></table></div></div>';

    var logs = state.logs.filter(function (l) { return state.logFilter === 'all' || (state.logFilter === 'sheet' ? l.action.indexOf('sheet-') === 0 : l.action.indexOf('sheet-') !== 0); });
    html += '<div class="card"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>변경 이력 <span class="text-secondary fw-normal">' + state.logs.length + '건</span></h3><div class="card-actions"><div class="btn-group">' + [['all', '전체'], ['work', '작업 로그'], ['sheet', '시트 수정']].map(function (o) { return '<button type="button" class="btn btn-sm' + (state.logFilter === o[0] ? ' active' : '') + '" data-action="log-filter" data-filter="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>';
    if (!logs.length) html += '<div class="card-body text-secondary small">이력이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:480px;overflow:auto"><table class="table table-sm table-vcenter card-table"><thead><tr><th class="w-1">일시</th><th class="w-1">동작</th><th class="w-1">스텝</th><th class="w-1">누가</th><th>내용</th></tr></thead><tbody>' + logs.map(function (l) { return '<tr><td class="text-nowrap text-secondary">' + fmtDateTime(l.at) + '</td><td><span class="badge ' + actionCls(l.action) + '">' + esc(S.ACTIONS[l.action] || l.action) + '</span></td><td class="text-nowrap">' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) : '-') + '</td><td class="text-nowrap">' + esc(l.who || '-') + '</td><td class="small">' + esc(l.detail) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div>';
    return html;
  }

  function renderPrint() {
    var r = state.run, pg = S.progress(r), plan = state.printMode === 'plan';
    var html = '<div class="rs-print-toolbar d-print-none"><button type="button" class="btn" data-action="print-back"><i class="ti ti-arrow-left me-1"></i>돌아가기</button>'
      + '<div class="btn-group"><button type="button" class="btn' + (plan ? ' active' : '') + '" data-action="print-mode" data-mode="plan">계획 양식 (빈칸)</button><button type="button" class="btn' + (!plan ? ' active' : '') + '" data-action="print-mode" data-mode="actual">실제 기록</button></div>'
      + '<button type="button" class="btn btn-primary" data-action="print-now"><i class="ti ti-printer me-1"></i>인쇄 / PDF</button><span class="text-secondary small">A4 가로</span></div>';
    html += '<div class="rs-print"><div class="rs-head"><h1>공정 런시트 <span>Process Run Sheet</span></h1><div class="rs-code">' + esc(r.code) + '</div></div>'
      + '<div class="rs-meta"><div><b>제목</b>' + esc(r.title) + '</div><div><b>공정 흐름</b>' + esc(r.flowName || '-') + '</div><div><b>시료 / 웨이퍼</b>' + esc(r.sample || '') + '</div><div><b>담당자</b>' + esc(r.owner || '') + '</div>'
      + '<div><b>기판</b>' + esc(r.substrate || '') + '</div><div><b>시작</b>' + fmtDateTime(r.startedAt) + '</div><div><b>상태</b>' + (plan ? '' : esc(S.RUN_STATUS[r.status]) + ' · ' + pg.finished + '/' + pg.total) + '</div><div><b>출력</b>' + fmtDate(new Date().toISOString()) + (me() ? ' · ' + esc(me()) : '') + '</div></div>'
      + (r.goal ? '<div class="rs-goal"><b>목표 · 메모</b> ' + esc(r.goal) + '</div>' : '')
      + '<table><thead><tr><th style="width:4%">No.</th><th style="width:19%">공정 · 장비</th><th style="width:19%">계획 조건</th><th style="width:19%">실제 조건</th><th style="width:7%">작업자</th><th style="width:7%">시작</th><th style="width:7%">종료</th><th>결과 · 특이사항</th><th style="width:5%">확인</th></tr></thead><tbody>'
      + r.steps.map(function (s) {
        var actual = plan ? '' : (Object.keys(s.actual || {}).length ? esc(P.text(s.fields, s.actual, '\n')).replace(/\n/g, '<br>') : '');
        return '<tr class="' + (plan ? 'blank' : '') + '"><td class="c">' + s.seq + '</td><td>' + (s.group ? '<div class="g">' + esc(s.group) + '</div>' : '') + '<b>' + esc(s.name) + '</b>' + (s.equipment ? '<div class="g">' + esc(s.equipment) + '</div>' : '') + (s.itemNote ? '<div class="g">※ ' + esc(s.itemNote) + '</div>' : '') + '</td>'
          + '<td>' + esc(P.text(s.fields, s.planned, '\n')).replace(/\n/g, '<br>') + '</td><td>' + actual + '</td>'
          + '<td class="c">' + (plan ? '' : esc(s.operator || '')) + '</td><td class="c">' + (plan || !s.startedAt ? '' : fmtDate(s.startedAt).slice(5) + '<br>' + fmtTime(s.startedAt)) + '</td><td class="c">' + (plan || !s.endedAt ? '' : fmtDate(s.endedAt).slice(5) + '<br>' + fmtTime(s.endedAt)) + '</td>'
          + '<td>' + (plan ? '' : [s.status !== 'done' ? '[' + S.STEP_STATUS[s.status] + ']' : '', s.result, s.issues ? '⚠ ' + s.issues : '', s.note].filter(Boolean).map(esc).join('<br>')) + '</td><td></td></tr>';
      }).join('') + '</tbody></table>';
    var sheetLogs = state.logs.filter(function (l) { return l.action.indexOf('sheet-') === 0 || l.action === 'run-status' || l.action === 'run-edit'; });
    if (!plan && sheetLogs.length) html += '<div class="rs-sub">런시트 변경 이력</div><table class="rs-logs"><thead><tr><th style="width:12%">일시</th><th style="width:12%">동작</th><th style="width:16%">스텝</th><th style="width:10%">누가</th><th>내용</th></tr></thead><tbody>' + sheetLogs.slice().reverse().map(function (l) { return '<tr><td>' + fmtDateTime(l.at) + '</td><td>' + esc(S.ACTIONS[l.action] || l.action) + '</td><td>' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) : '-') + '</td><td>' + esc(l.who || '') + '</td><td>' + esc(l.detail) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (plan) html += '<div class="rs-sub">런시트 변경 기록 (손으로 기입)</div><table class="rs-logs"><thead><tr><th style="width:12%">일시</th><th style="width:16%">스텝</th><th>변경 내용 · 사유</th><th style="width:12%">서명</th></tr></thead><tbody>' + '<tr class="blank"><td></td><td></td><td></td><td></td></tr>'.repeat(4) + '</tbody></table>';
    html += '<div class="rs-foot"><span>' + esc(CFG.labName || 'DSIL') + ' · ' + esc(CFG.university || 'KAIST') + '</span><span>스텝 완료 시 실제 조건·결과를 적고 확인란에 서명합니다. 런시트를 바꾸면 변경 기록에 사유를 남깁니다.</span></div></div>';
    return html;
  }

  /* ---------- 사진 ---------- */
  function thumbHtml(key, src) { return '<div class="photo-thumb" data-key="' + esc(key) + '"><img alt="" data-photo="' + esc(key) + '"' + (src ? ' src="' + src + '"' : '') + '><button type="button" class="btn btn-sm btn-icon" data-action="photo-remove" data-key="' + esc(key) + '" title="사진 빼기"><i class="ti ti-x"></i></button></div>'; }
  function loadThumbs() {
    $all('img[data-photo]:not([src])').forEach(function (img) { store.loadPhoto(img.getAttribute('data-photo')).then(function (src) { if (src) { img.src = src; img.parentElement.classList.add('is-loaded'); } }).catch(function () {}); });
  }
  function fileToJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, PH.maxEdge / Math.max(w, h));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', PH.quality));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = url;
    });
  }

  /* ---------- 대화상자 ---------- */
  function stepDialog(s) {
    var actual = Object.keys(s.actual || {}).length ? s.actual : s.planned;
    var st = (s.status === 'pending' || s.status === 'running') ? 'done' : s.status;
    state.dialogStep = s;
    var body = '<div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><div>' + (s.group ? '<span class="text-secondary small">' + esc(s.group) + ' › </span>' : '') + '<b>' + esc(s.name) + '</b></div><div class="small text-secondary">' + P.catBadge(s.category) + (s.equipment ? ' ' + esc(s.equipment) : '') + (s.minutes ? ' · 예상 ' + fmtDuration(s.minutes) : '') + '</div></div>'
      + (s.itemNote ? '<div class="alert alert-info py-1 px-2 small mb-2"><i class="ti ti-note me-1"></i>' + esc(s.itemNote) + '</div>' : '')
      + (s.checklist && s.checklist.length ? '<div class="small mb-2 checklist"><div class="subheader mb-1">확인 사항</div>' + s.checklist.map(function (c) { return '<label class="form-check mb-0"><input class="form-check-input" type="checkbox"><span class="form-check-label">' + esc(c) + '</span></label>'; }).join('') + '</div>' : '')
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label required">작업자</label><input type="text" class="form-control" name="operator" required value="' + esc(s.operator || me()) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">시작</label><input type="datetime-local" class="form-control" name="startedAt" value="' + (s.startedAt ? toLocalInput(s.startedAt) : toLocalInput()) + '"></div>'
      + '<div class="col-md-4"><label class="form-label">종료</label><input type="datetime-local" class="form-control" name="endedAt" value="' + (s.endedAt ? toLocalInput(s.endedAt) : toLocalInput()) + '"></div></div>'
      + '<div class="d-flex align-items-center justify-content-between mt-3 mb-1"><div class="subheader mb-0">실제 공정 조건 <span class="text-secondary fw-normal text-lowercase">계획값이 채워져 있으니 다른 것만 고치세요</span></div><button type="button" class="btn btn-sm btn-ghost-secondary" data-action="fill-planned"><i class="ti ti-refresh me-1"></i>계획값으로</button></div>'
      + '<div id="param-box">' + P.inputs(s.fields, actual, { planned: s.planned, optional: true }) + '</div>'
      + '<div class="row g-2 mt-2"><div class="col-md-6"><label class="form-label">결과 · 관찰</label><textarea class="form-control" name="result" rows="2" placeholder="두께, 패턴 상태, 수율, 측정 요약">' + esc(s.result) + '</textarea></div>'
      + '<div class="col-md-6"><label class="form-label">특이사항 · 이상</label><textarea class="form-control" name="issues" rows="2" placeholder="장비 이상, 조건 이탈, 재작업 사유">' + esc(s.issues) + '</textarea></div></div>'
      + '<div class="mt-2"><label class="form-label">비고</label><input type="text" class="form-control" name="note" value="' + esc(s.note) + '" autocomplete="off"></div>'
      + '<div class="mt-3"><div class="subheader mb-1">사진 <span class="text-secondary fw-normal">OM 이미지, 소자 사진 (최대 ' + PH.maxPerStep + '장)</span></div><div class="photo-strip" id="photo-strip">' + (s.photos || []).map(function (k) { return thumbHtml(k); }).join('') + '</div><input type="hidden" name="photos" value="' + esc((s.photos || []).join(',')) + '"><label class="btn btn-sm mt-2 mb-0"><i class="ti ti-camera me-1"></i>사진 추가<input type="file" id="photo-input" accept="image/*" multiple hidden></label></div>'
      + '<div class="subheader mt-3 mb-1">이 스텝의 상태</div><div class="form-selectgroup">' + [['done', '완료', 'circle-check', 'green'], ['running', '진행 중', 'player-play', 'yellow'], ['skipped', '건너뜀', 'player-skip-forward', 'secondary'], ['failed', '실패', 'alert-triangle', 'red']].map(function (o) { return '<label class="form-selectgroup-item"><input type="radio" name="status" value="' + o[0] + '" class="form-selectgroup-input"' + (st === o[0] ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-' + o[2] + ' text-' + o[3] + ' me-1"></i>' + o[1] + '</span></label>'; }).join('') + '</div>'
      + '<div class="form-hint" data-show-if="status=skipped">건너뛴 이유를 특이사항에 적어 주세요.</div><div class="form-hint" data-show-if="status=failed">실패 원인·조치를 특이사항에 적어 주세요. 재작업은 시트 편집에서 스텝을 추가합니다.</div>';
    var p = dialog({ title: '스텝 기록 · ' + s.seq + '. ' + s.name, bodyHtml: body, okLabel: '저장', size: 'lg' });
    loadThumbs();
    return p.then(function (v) {
      state.dialogStep = null;
      if (!v) return null;
      var photos = v.photos ? v.photos.split(',').filter(Boolean) : [];
      return store.stepLog(state.run.id, s.id, { status: v.status, operator: v.operator, startedAt: v.startedAt ? fromLocalInput(v.startedAt) : null, endedAt: v.endedAt ? fromLocalInput(v.endedAt) : null, actual: P.read(s.fields, v), result: v.result, issues: v.issues, note: v.note, photos: photos }, v.operator);
    });
  }

  function insertDialog(index) {
    var mods = state.modules.filter(function (m) { return m.active !== false; });
    var cats = CFG.categories || [];
    var grouped = cats.map(function (c) { var ms = mods.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc(c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + (m.equipment ? ' — ' + esc(m.equipment) : '') + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
    var rest = mods.filter(function (m) { return !cats.some(function (c) { return c.id === m.category; }); }).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    var flows = state.flows.filter(function (f) { return f.active !== false; });
    var n = state.run.steps.length;
    var pos = '<option value="' + n + '"' + (index >= n ? ' selected' : '') + '>맨 끝</option>' + state.run.steps.map(function (s, i) { return '<option value="' + i + '"' + (index === i ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(s.name) + ' 앞에</option>'; }).join('');
    var body = '<div class="row g-2"><div class="col-md-5"><label class="form-label">위치</label><select class="form-select" name="index">' + pos + '</select></div>'
      + '<div class="col-md-7"><label class="form-label">무엇을 추가</label><div class="form-selectgroup"><label class="form-selectgroup-item"><input type="radio" name="kind" value="module" class="form-selectgroup-input" checked><span class="form-selectgroup-label"><i class="ti ti-box me-1"></i>모듈 1개</span></label><label class="form-selectgroup-item"><input type="radio" name="kind" value="flow" class="form-selectgroup-input"' + (flows.length ? '' : ' disabled') + '><span class="form-selectgroup-label"><i class="ti ti-git-branch me-1"></i>흐름 (여러 스텝)</span></label></div></div></div>'
      + '<div data-show-if="kind=module"><div class="mt-2"><label class="form-label required">모듈</label><select class="form-select" name="moduleId" required>' + grouped + rest + '</select></div>'
      + '<div class="mt-2"><label class="form-label">스텝 이름 <span class="form-label-description">비우면 모듈 이름</span></label><input type="text" class="form-control" name="name" autocomplete="off" placeholder="예: 2차 리프트오프 (재작업)"></div>'
      + mods.map(function (m) { return '<div data-show-if="moduleId=' + esc(m.id) + '" class="mt-2"><div class="subheader mb-1">계획 조건</div>' + P.inputs(m.fields, S.defaults(m.fields), { optional: true }) + '</div>'; }).join('') + '</div>'
      + '<div data-show-if="kind=flow"><div class="mt-2"><label class="form-label required">흐름</label><select class="form-select" name="flowId" required>' + flows.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + ' (' + f.items.length + '항목)</option>'; }).join('') + '</select><div class="form-hint">흐름의 모듈이 모두 펼쳐져 들어갑니다.</div></div></div>'
      + '<div class="mt-2"><label class="form-label">메모 <span class="form-label-description">추가한 이유 등, 스텝에 표시</span></label><input type="text" class="form-control" name="note" autocomplete="off"></div>';
    return dialog({ title: '런시트에 스텝 추가', bodyHtml: body, okLabel: '추가', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var who = me();
      if (v.kind === 'flow') return store.sheetInsert(state.run.id, { index: Number(v.index), flowId: v.flowId, note: v.note }, who);
      var mod = modById(v.moduleId);
      return store.sheetInsert(state.run.id, { index: Number(v.index), moduleId: v.moduleId, name: v.name, params: P.read(mod ? mod.fields : [], v), note: v.note }, who);
    });
  }

  function planDialog(s) {
    var body = '<div class="row g-2"><div class="col-md-6"><label class="form-label required">스텝 이름</label><input type="text" class="form-control" name="name" required value="' + esc(s.name) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">장비</label><input type="text" class="form-control" name="equipment" value="' + esc(s.equipment) + '" autocomplete="off"></div>'
      + '<div class="col-md-2"><label class="form-label">예상(분)</label><input type="number" class="form-control" name="minutes" min="0" value="' + esc(s.minutes || 0) + '"></div></div>'
      + '<div class="mt-2"><label class="form-label">메모 <span class="form-label-description">시트에 표시되는 지시·주의</span></label><input type="text" class="form-control" name="itemNote" value="' + esc(s.itemNote) + '" autocomplete="off"></div>'
      + '<div class="subheader mt-3 mb-1">계획 조건</div>' + P.inputs(s.fields, s.planned, { optional: true })
      + (S.TERMINAL[s.status] ? '<div class="form-hint mt-2">이미 끝난 스텝입니다. 계획 조건을 바꿔도 실제 기록은 그대로이며 변경 이력에 남습니다.</div>' : '');
    return dialog({ title: '계획 수정 · ' + s.seq + '. ' + s.name, bodyHtml: body, okLabel: '저장', size: 'lg' }).then(function (v) {
      if (!v) return null;
      return store.sheetEdit(state.run.id, s.id, { name: v.name, equipment: v.equipment, minutes: v.minutes, itemNote: v.itemNote, planned: P.read(s.fields, v) }, me());
    });
  }

  function runEditDialog(r) {
    var body = '<div class="row g-2"><div class="col-md-8"><label class="form-label required">제목</label><input type="text" class="form-control" name="title" required value="' + esc(r.title) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시작</label><input type="datetime-local" class="form-control" name="startedAt" value="' + toLocalInput(r.startedAt) + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label">시료 / 웨이퍼 ID</label><input type="text" class="form-control" name="sample" value="' + esc(r.sample) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">담당자</label><input type="text" class="form-control" name="owner" value="' + esc(r.owner) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">기판</label><input type="text" class="form-control" name="substrate" value="' + esc(r.substrate) + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">목표 · 메모</label><textarea class="form-control" name="goal" rows="2">' + esc(r.goal) + '</textarea></div><div class="mt-2"><label class="form-label">비고</label><input type="text" class="form-control" name="note" value="' + esc(r.note) + '" autocomplete="off"></div>';
    return dialog({ title: '런 정보 수정', bodyHtml: body, okLabel: '저장', size: 'lg' }).then(function (v) { if (!v) return null; return store.updateRun(r.id, { title: v.title, startedAt: v.startedAt ? fromLocalInput(v.startedAt) : undefined, sample: v.sample, owner: v.owner, substrate: v.substrate, goal: v.goal, note: v.note }, me()); });
  }
  function moreDialog(r) {
    var active = r.status === 'active';
    var items = [
      ['run-edit', 'pencil', '런 정보 수정', '제목·시료·담당자·목표'],
      ['run-clone', 'copy', '이 런 복제', '같은 런시트로 새 런 (실제값을 계획으로 가져올 수 있음)'],
      ['run-to-flow', 'git-branch', '흐름으로 저장', '이 런의 스텝 순서·조건을 새 공정 흐름(템플릿)으로'],
      active ? ['run-pause', 'player-pause', '보류', '잠시 멈춤 (기록 불가)'] : ['run-resume', 'player-play', '재개', '다시 진행 중으로'],
      ['run-done', 'flag-check', '완료 처리', '모든 작업이 끝났을 때'],
      ['run-abort', 'circle-x', '중단', '사유를 남기고 중단'],
      ['run-delete', 'trash', '런 삭제', '기록·이력이 모두 지워집니다']
    ];
    var html = '<div class="list-group list-group-flush">' + items.map(function (i) { return '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-action="more-' + i[0] + '"><i class="ti ti-' + i[1] + ' ' + (i[0] === 'run-delete' || i[0] === 'run-abort' ? 'text-red' : 'text-primary') + '"></i><div><div class="fw-medium">' + i[2] + '</div><div class="small text-secondary">' + i[3] + '</div></div></button>'; }).join('') + '</div>';
    return dialog({ title: r.code + ' · 더 보기', html: html, hideCancel: true, okLabel: '닫기', size: 'md' });
  }
  function cloneDialog(r) {
    var body = '<div class="mb-2"><label class="form-label required">새 런 제목</label><input type="text" class="form-control" name="title" required value="' + esc(r.title) + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label">시료 / 웨이퍼 ID</label><input type="text" class="form-control" name="sample" autocomplete="off"></div><div class="col-6"><label class="form-label">담당자</label><input type="text" class="form-control" name="owner" value="' + esc(me() || r.owner) + '" autocomplete="off"></div></div>'
      + '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="fromActual" checked><span class="form-check-label">완료된 스텝의 <b>실제 조건</b>을 새 런의 계획 조건으로 (이번 조건 그대로 반복)</span></label>';
    return dialog({ title: '런 복제', bodyHtml: body, okLabel: '복제', size: 'md' }).then(function (v) { if (!v) return null; return store.cloneRun(r.id, { title: v.title, sample: v.sample, owner: v.owner, fromActual: !!v.fromActual }); });
  }
  function toFlowDialog(r) {
    var body = '<div class="mb-2"><label class="form-label required">흐름 이름</label><input type="text" class="form-control" name="name" required value="' + esc(r.title) + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label">소자 종류</label><input type="text" class="form-control" name="device" autocomplete="off"></div><div class="col-6"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="런 ' + esc(r.code) + ' 에서 저장" autocomplete="off"></div></div>'
      + '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="fromActual" checked><span class="form-check-label">완료된 스텝의 실제 조건을 흐름의 계획 조건으로</span></label>'
      + '<label class="form-check"><input class="form-check-input" type="checkbox" name="dropSkipped" checked><span class="form-check-label">건너뛴 스텝은 빼기</span></label>'
      + '<div class="form-hint mt-2">모듈이 삭제된 스텝은 들어가지 않습니다. 저장 후 라이브러리에서 다듬을 수 있습니다.</div>';
    return dialog({ title: '이 런을 공정 흐름으로 저장', bodyHtml: body, okLabel: '흐름 저장', size: 'md' }).then(function (v) { if (!v) return null; return store.saveRunAsFlow(r.id, { name: v.name, device: v.device, description: v.description, fromActual: !!v.fromActual, dropSkipped: !!v.dropSkipped }); });
  }

  function exportCSV() {
    var r = state.run;
    var head = ['순번', '그룹', '공정', '장비', '상태', '작업자', '시작', '종료', '소요(분)', '계획 조건', '실제 조건', '결과', '특이사항', '비고', '런 중 추가'];
    var lines = [head.map(csvCell).join(',')].concat(r.steps.map(function (s) {
      return [s.seq, s.group, s.name, s.equipment, S.STEP_STATUS[s.status], s.operator, s.startedAt ? fmtDateTime(s.startedAt) : '', s.endedAt ? fmtDateTime(s.endedAt) : '', s.startedAt ? Math.round(minutesOf(s)) : '', P.text(s.fields, s.planned), P.text(s.fields, s.actual), s.result, s.issues, s.note, s.addedInRun ? '예' : ''].map(csvCell).join(',');
    }));
    download('runsheet_' + r.code + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function openStep(id) {
    var s = stepById(id); if (!s) { toast('스텝을 찾을 수 없습니다.', true); return Promise.resolve(); }
    if (state.run.status !== 'active' && !S.TERMINAL[s.status]) { toast('런이 ' + S.RUN_STATUS[state.run.status] + ' 상태라 기록할 수 없습니다. 더 보기에서 재개하세요.', true); return Promise.resolve(); }
    return ensureMe().then(function (n) { if (n === null) return null; return stepDialog(s); }).then(function (res) { if (res) { toast(res.status === 'done' ? '완료를 기록했습니다.' : S.STEP_STATUS[res.status] + ' 으로 저장했습니다.'); return refresh(); } });
  }

  document.addEventListener('change', function (e) {
    if (e.target.closest('#list-filter')) { if (e.target.name === 'q') return; var v = readForm(e.target.closest('#list-filter')); state.filter = { status: v.status || '', q: v.q || '' }; render(); return; }
    if (e.target.id === 'photo-input') {
      var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
      var hidden = $('#modal-form [name="photos"]'), strip = $('#photo-strip'); if (!hidden || !strip || !files.length) return;
      var cur = hidden.value.split(',').filter(Boolean);
      if (cur.length + files.length > PH.maxPerStep) { toast('사진은 스텝당 최대 ' + PH.maxPerStep + '장입니다.', true); files = files.slice(0, Math.max(0, PH.maxPerStep - cur.length)); }
      var chain = Promise.resolve();
      files.forEach(function (f) {
        chain = chain.then(function () { return fileToJpeg(f).then(function (dataUrl) { return store.savePhoto(dataUrl).then(function (key) { cur.push(key); hidden.value = cur.join(','); strip.insertAdjacentHTML('beforeend', thumbHtml(key, dataUrl)); }); }); });
      });
      chain.catch(handleError);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.name === 'q' && e.target.closest('#list-filter')) {
      state.filter.q = e.target.value;
      var old = $('#list-filter').closest('.card').nextElementSibling;
      var tmp = document.createElement('div'); tmp.innerHTML = renderList();
      if (old && tmp.lastElementChild) old.replaceWith(tmp.lastElementChild);
    }
  });
  document.addEventListener('submit', function (e) { if (e.target.getAttribute('id') === 'list-filter') { e.preventDefault(); render(); } });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id'), r = state.run;
    if (el.tagName === 'A') e.preventDefault();
    switch (action) {
      case 'set-me': promptDlg({ title: '내 이름', message: '기록에 작업자로 붙는 이름입니다. 이 브라우저에 기억됩니다.', input: 'text', placeholder: '홍길동', okLabel: '저장' }).then(function (v) { if (v === null) return; return store.setMe(v).then(function () { toast(v ? v + ' 님으로 기록합니다.' : '이름을 지웠습니다.'); renderChrome(); }); }).catch(handleError); break;
      case 'refresh': refresh(); break;
      case 'step-open': openStep(id).catch(handleError); break;
      case 'step-start':
        ensureMe().then(function (n) { if (n === null) return; return store.stepStart(r.id, id, n).then(function (s) { toast(s.seq + '. ' + s.name + ' 시작을 기록했습니다.'); return refresh(); }); }).catch(handleError); break;
      case 'step-reopen':
        confirmDlg({ title: '대기로 되돌리기', message: '이 스텝을 다시 대기 상태로 되돌릴까요? 기록된 값은 남고 이력에 기록됩니다.', okLabel: '되돌리기' }).then(function (ok) { if (!ok) return; return store.stepReopen(r.id, id, me()).then(function () { toast('대기 상태로 되돌렸습니다.'); return refresh(); }); }).catch(handleError); break;
      case 'fill-planned': { var s0 = state.dialogStep, box = $('#param-box'); if (s0 && box) { box.innerHTML = P.inputs(s0.fields, s0.planned, { planned: s0.planned, optional: true }); } break; }
      case 'photo-remove': { var key = el.getAttribute('data-key'); var hidden = $('#modal-form [name="photos"]'); if (hidden) hidden.value = hidden.value.split(',').filter(function (k) { return k && k !== key; }).join(','); var th = el.closest('.photo-thumb'); if (th) th.remove(); break; }
      case 'toggle-edit': state.editSheet = !state.editSheet; render(); break;
      case 'sheet-insert':
        ensureMe().then(function (n) { if (n === null) return; return insertDialog(Number(el.getAttribute('data-index'))).then(function (res) { if (res) { toast('스텝을 추가했습니다.'); return refresh(); } }); }).catch(handleError); break;
      case 'sheet-remove': {
        var sr = stepById(id); if (!sr) break;
        confirmDlg({ title: '스텝 삭제', message: sr.seq + '. ' + sr.name + ' 스텝을 런시트에서 뺄까요? 변경 이력에 남습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.sheetRemove(r.id, id, me()).then(function () { toast('스텝을 뺐습니다.'); return refresh(); }); }).catch(handleError); break;
      }
      case 'sheet-move': store.sheetMove(r.id, id, el.getAttribute('data-dir'), me()).then(function () { return refresh(); }).catch(handleError); break;
      case 'sheet-edit': { var se = stepById(id); if (!se) break; planDialog(se).then(function (res) { if (res) { toast('계획을 수정했습니다.'); return refresh(); } }).catch(handleError); break; }
      case 'log-filter': state.logFilter = el.getAttribute('data-filter'); render(); break;
      case 'csv': exportCSV(); break;
      case 'print': state.print = true; state.editSheet = false; render(); window.scrollTo(0, 0); break;
      case 'print-back': state.print = false; render(); break;
      case 'print-mode': state.printMode = el.getAttribute('data-mode'); render(); break;
      case 'print-now': window.print(); break;
      case 'run-status': setStatus(el.getAttribute('data-status')); break;
      case 'run-more': moreDialog(r).catch(handleError); break;
      case 'more-run-edit': U.closeAll(); runEditDialog(r).then(function (res) { if (res) { toast('런 정보를 수정했습니다.'); return refresh(); } }).catch(handleError); break;
      case 'more-run-clone': U.closeAll(); cloneDialog(r).then(function (run) { if (run) { toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.hash = '#id=' + run.id; } }).catch(handleError); break;
      case 'more-run-to-flow': U.closeAll(); toFlowDialog(r).then(function (res) { if (res) { toast('흐름 "' + res.flow.name + '" 을 저장했습니다.' + (res.skipped ? ' (모듈 없는 스텝 ' + res.skipped + '개 제외)' : '')); } }).catch(handleError); break;
      case 'more-run-pause': U.closeAll(); setStatus('paused'); break;
      case 'more-run-resume': U.closeAll(); setStatus('active'); break;
      case 'more-run-done': U.closeAll(); setStatus('done'); break;
      case 'more-run-abort': U.closeAll(); setStatus('aborted'); break;
      case 'more-run-delete':
        U.closeAll();
        confirmDlg({ title: '런 삭제', message: r.code + ' ' + r.title + ' 런과 모든 기록·이력을 지웁니다. 되돌릴 수 없습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteRun(r.id).then(function () { toast('삭제했습니다.'); window.location.hash = ''; }); }).catch(handleError); break;
    }
  });
  function setStatus(status) {
    var r = state.run, pg = S.progress(r);
    var pre = Promise.resolve('');
    if (status === 'done' && !pg.allDone) pre = confirmDlg({ title: '런 완료', message: '아직 끝나지 않은 스텝이 ' + (pg.total - pg.finished) + '개 있습니다. 그래도 완료 처리할까요?', okLabel: '완료' }).then(function (ok) { return ok ? '' : null; });
    if (status === 'aborted') pre = promptDlg({ title: '런 중단', message: '중단 사유를 남겨 주세요.', input: 'textarea', placeholder: '예: 시료 파손', okLabel: '중단', danger: true });
    pre.then(function (note) { if (note === null) return; return store.setRunStatus(r.id, status, me(), note || '').then(function () { toast('런을 ' + S.RUN_STATUS[status] + ' 상태로 바꿨습니다.'); return refresh(); }); }).catch(handleError);
  }

  window.addEventListener('hashchange', function () { readHash(); state.print = false; state.editSheet = false; refresh().then(maybeOpenStep); });
  function maybeOpenStep() {
    if (!state.openStepId || !state.run) return;
    var id = state.openStepId; state.openStepId = null;
    try { history.replaceState(null, '', '#id=' + state.run.id); } catch (e) { /* ignore */ }
    openStep(id).catch(handleError);
  }
  setInterval(function () { if (state.ready && state.run && !state.print && !document.querySelector('.modal.is-open') && state.run.steps.some(function (s) { return s.status === 'running'; })) render(); }, 60000);

  store.init().then(function () {
    state.ready = true; readHash();
    store.onChange(function () { reload().then(render).catch(handleError); });
    return refresh().then(maybeOpenStep);
  }).catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
