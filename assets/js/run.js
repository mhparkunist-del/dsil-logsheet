/* =====================================================================
   DSIL Run Sheet – 공정 런: 목록(분류·팀·이름 필터) + 런시트(스플릿 표: 열 = 기판, 행 = 공정)
   스텝: 바로 완료(계획대로) / 기록 창 / 건너뜀·실패. 시트 편집: 스텝 추가·삭제·순서·계획, 분기점 추가·수정·삭제.
   인쇄(A4 가로) · PPT 한 장 · CSV. 해시: #id=<runId>[&step=<stepId>]
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore, L = window.DSILLayout;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDateTime = U.fmtDateTime, localDate = U.localDate, toLocalInput = U.toLocalInput, fromLocalInput = U.fromLocalInput, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, promptDlg = U.promptDlg, empty = U.empty, csvCell = U.csvCell, download = U.download;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [];
  var PH = Object.assign({ maxEdge: 1400, quality: 0.85, maxPerStep: 6 }, CFG.photo || {});
  var STEP_CLS = { pending: 'bg-secondary-lt', done: 'bg-green-lt', skipped: 'bg-secondary-lt', failed: 'bg-red-lt' };
  var RUN_CLS = { active: 'bg-blue-lt', paused: 'bg-secondary-lt', done: 'bg-green-lt', aborted: 'bg-red-lt' };
  var state = { ready: false, error: null, runId: null, openStepId: null, run: null, logs: [], modules: [], flows: [], runs: [], print: false, printMode: 'plan', editSheet: false, logFilter: 'all',
    filter: { domain: '', status: '', team: '', who: '', q: '' }, groupTeam: false, dialogStep: null };

  function me() { return store.getMe(); }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function domainBadge(id) { return '<span class="badge ' + (id === 'package' ? 'bg-indigo-lt' : 'bg-blue-lt') + '">' + esc(domainInfo(id).short) + '</span>'; }
  function teams() { var set = {}; (CFG.teams || []).forEach(function (t) { set[t] = 1; }); state.runs.forEach(function (r) { if (r.team) set[r.team] = 1; }); if (state.run && state.run.team) set[state.run.team] = 1; return Object.keys(set).sort(); }
  function meDialog() {
    var m = me();
    var body = '<div class="mb-2"><label class="form-label required">이름</label><input type="text" class="form-control" name="name" required value="' + esc(m.name) + '" placeholder="홍길동" autocomplete="off"></div>'
      + '<div class="mb-1"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(m.team) + '" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div><div class="form-hint">기록에 작업자·팀으로 붙습니다. 이 브라우저에 기억됩니다.</div>';
    return dialog({ title: '내 이름 · 팀', bodyHtml: body, okLabel: '저장' }).then(function (v) { if (!v) return null; return store.setMe({ name: v.name, team: v.team }).then(function (saved) { renderChrome(); return saved; }); });
  }
  function ensureMe() { var m = me(); if (m.name && m.team) return Promise.resolve(m); return meDialog(); }
  function readHash() { var q = new URLSearchParams(window.location.hash.replace(/^#/, '')); state.runId = q.get('id') || null; state.openStepId = q.get('step') || null; }
  function stepById(id) { return state.run ? state.run.steps.filter(function (s) { return s.id === id; })[0] || null : null; }
  function stepsById() { var m = {}; (state.run ? state.run.steps : []).forEach(function (s) { m[s.id] = s; }); return m; }
  function modById(id) { return state.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }
  /* 트리에서 노드 위치(컨테이너·인덱스·수량) 찾기 */
  function locate(id) {
    var res = null, r = state.run;
    (function walk(items, container, count, name) { items.forEach(function (n, i) { if (res) return; if (n.id === id) { res = { list: items, index: i, node: n, container: container, count: count, name: name }; return; } if (n.kind === 'split') n.branches.forEach(function (b) { walk(b.items, b.id, b.count, b.name); }); }); })(r.tree, 'root', r.unitCount, '');
    return res;
  }
  function containerInfo(container) {
    var r = state.run; if (container === 'root') return { count: r.unitCount, name: '', items: r.tree };
    var res = null; (function walk(items) { items.forEach(function (n) { if (res || n.kind !== 'split') return; n.branches.forEach(function (b) { if (res) return; if (b.id === container) res = { count: b.count, name: b.name, items: b.items }; else walk(b.items); }); }); })(r.tree);
    return res || { count: r.unitCount, name: '', items: r.tree };
  }

  function reload() {
    if (state.runId) return Promise.all([store.getRun(state.runId), store.listLogs(state.runId), store.listModules(), store.listFlows()]).then(function (r) { state.run = r[0]; state.logs = r[1]; state.modules = r[2]; state.flows = r[3]; });
    return store.listRuns().then(function (r) { state.runs = r; state.run = null; });
  }

  /* ---------- 렌더 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var m = me();
    slot.innerHTML = '<button type="button" class="btn btn-sm' + (m.name ? '' : ' btn-outline-primary') + '" data-action="set-me"><i class="ti ti-user me-1"></i>' + (m.name ? esc(m.name) + (m.team ? ' <span class="text-secondary">· ' + esc(m.team) + '</span>' : '') : '내 이름 · 팀 설정') + '</button>';
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
    var whoSet = {}; state.runs.forEach(function (r) { if (r.owner) whoSet[r.owner] = 1; });
    var rows = state.runs.filter(function (r) {
      if (f.domain && r.domain !== f.domain) return false; if (f.status && r.status !== f.status) return false; if (f.team && r.team !== f.team) return false; if (f.who && r.owner !== f.who) return false;
      if (q && [r.code, r.title, r.sample, r.owner, r.team, r.flowName].join(' ').toLowerCase().indexOf(q) < 0) return false; return true;
    });
    var html = '<div class="card mb-3"><div class="card-body"><form id="list-filter" class="row g-2 align-items-end">'
      + '<div class="col-6 col-md-2"><label class="form-label">분류</label><select class="form-select" name="domain"><option value="">전체</option>' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + (f.domain === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">상태</label><select class="form-select" name="status"><option value="">전체</option>' + Object.keys(S.RUN_STATUS).map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + S.RUN_STATUS[k] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">팀</label><select class="form-select" name="team"><option value="">전체</option>' + teams().map(function (t) { return '<option value="' + esc(t) + '"' + (f.team === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">담당자</label><select class="form-select" name="who"><option value="">전체</option>' + Object.keys(whoSet).sort().map(function (n) { return '<option value="' + esc(n) + '"' + (f.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-8 col-md-3"><label class="form-label">검색</label><input type="search" class="form-control" name="q" value="' + esc(f.q) + '" placeholder="코드, 제목, 시료, 흐름" autocomplete="off"></div>'
      + '<div class="col-4 col-md-1"><label class="form-check mb-2"><input class="form-check-input" type="checkbox" name="groupTeam"' + (state.groupTeam ? ' checked' : '') + '><span class="form-check-label">팀별</span></label></div>'
      + '<div class="col-12 d-flex justify-content-end"><a href="../index.html?new=1" class="btn btn-primary"><i class="ti ti-player-play me-1"></i>새 런 시작</a></div></form></div></div>';
    function table(list) {
      return '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th class="w-1">코드</th><th>런</th><th>팀 · 담당</th><th>시료 · 기판</th><th style="min-width:140px">진행</th><th class="w-1">시작</th><th class="w-1">상태</th><th class="w-1"></th></tr></thead><tbody>'
        + list.map(function (r) { var pg = S.progress(r); return '<tr><td class="text-nowrap tnum"><a href="#id=' + esc(r.id) + '">' + esc(r.code) + '</a></td><td><a href="#id=' + esc(r.id) + '" class="text-reset fw-medium">' + esc(r.title) + '</a><span class="sub">' + domainBadge(r.domain) + ' ' + esc(r.flowName || '빈 런') + '</span></td><td class="small">' + esc(r.team) + '<br>' + esc(r.owner) + '</td><td class="small">' + esc(r.sample || '-') + '<br><span class="text-secondary">' + esc(r.unitLabel) + ' ' + r.unitCount + '</span></td><td><div class="d-flex align-items-center gap-2"><div class="progress progress-sm flex-fill"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div><span class="small tnum text-nowrap">' + pg.finished + '/' + pg.total + '</span></div></td><td class="text-nowrap text-secondary">' + fmtDate(r.startedAt) + '</td><td><span class="badge ' + RUN_CLS[r.status] + '">' + esc(S.RUN_STATUS[r.status]) + '</span></td><td class="text-end"><a href="#id=' + esc(r.id) + '" class="btn btn-sm">열기</a></td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (!rows.length) return html + '<div class="card">' + empty('clipboard-list', '런이 없습니다', '홈에서 "새 런 시작"을 누르세요.') + '</div>';
    if (!state.groupTeam) return html + '<div class="card">' + table(rows) + '</div>';
    var by = {}; rows.forEach(function (r) { var k = r.team || '(팀 미지정)'; (by[k] = by[k] || []).push(r); });
    return html + Object.keys(by).sort().map(function (t) { return '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-users me-1 text-primary"></i>' + esc(t) + ' <span class="text-secondary fw-normal">' + by[t].length + '개</span></h3></div>' + table(by[t]) + '</div>'; }).join('');
  }

  /* ---------- 런시트 (스플릿 표) ---------- */
  function stepCell(s, cell, pg) {
    var r = state.run, active = r.status === 'active', isCur = !!(pg.current && pg.current.id === s.id);
    var hasActual = Object.keys(s.actual || {}).length > 0;
    var html = '<div class="step-cell">'
      + '<div class="d-flex justify-content-between align-items-start gap-2"><div><span class="step-num is-' + s.status + '">' + s.seq + '</span> <b class="step-name">' + esc(s.name) + '</b>' + (s.addedInRun ? ' <span class="badge bg-purple-lt">런 중 추가</span>' : '')
      + '<div class="small text-secondary">' + P.catBadge(s.category) + (s.equipment ? ' ' + esc(s.equipment) : '') + (s.group ? ' <span class="step-group">' + esc(s.group) + '</span>' : '') + '</div>' + (s.itemNote ? '<div class="small text-secondary"><i class="ti ti-note"></i> ' + esc(s.itemNote) + '</div>' : '') + '</div>'
      + '<span class="badge ' + STEP_CLS[s.status] + ' text-nowrap">' + esc(S.STEP_STATUS[s.status]) + '</span></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-6 param-cell"><div class="subheader">계획</div>' + P.summary(s.fields, s.planned) + '</div><div class="col-md-6 param-cell"><div class="subheader">실제</div>' + (hasActual ? P.summary(s.fields, s.actual, s.planned) : '<span class="text-secondary">-</span>') + '</div></div>';
    if (s.operator || s.date || s.result || s.issues || s.note || (s.photos && s.photos.length)) {
      html += '<div class="small mt-1">' + (s.operator ? '<span class="fw-medium">' + esc(s.operator) + '</span>' + (s.team ? ' <span class="text-secondary">(' + esc(s.team) + ')</span>' : '') : '') + (s.date ? ' <span class="text-secondary">· ' + esc(s.date) + '</span>' : '')
        + (s.result ? '<div>' + esc(s.result) + '</div>' : '') + (s.issues ? '<div class="text-red"><i class="ti ti-alert-triangle"></i> ' + esc(s.issues) + '</div>' : '') + (s.note ? '<div class="text-secondary">' + esc(s.note) + '</div>' : '') + (s.photos && s.photos.length ? '<div class="text-secondary"><i class="ti ti-photo"></i> ' + s.photos.length + '장</div>' : '') + '</div>';
    }
    html += '<div class="d-flex flex-wrap gap-1 mt-2">';
    if (state.editSheet) {
      var loc = locate(s.id);
      html += '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="sheet-insert" data-container="' + esc(loc.container) + '" data-index="' + loc.index + '" title="이 앞에 스텝 추가"><i class="ti ti-row-insert-top"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="sheet-move" data-id="' + esc(s.id) + '" data-dir="up" title="위로"' + (loc.index === 0 ? ' disabled' : '') + '><i class="ti ti-chevron-up"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="sheet-move" data-id="' + esc(s.id) + '" data-dir="down" title="아래로"' + (loc.index === loc.list.length - 1 ? ' disabled' : '') + '><i class="ti ti-chevron-down"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="sheet-edit" data-id="' + esc(s.id) + '" title="계획 조건·이름 수정"><i class="ti ti-pencil"></i></button>'
        + (s.status === 'pending' ? '<button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="sheet-remove" data-id="' + esc(s.id) + '" title="삭제"><i class="ti ti-x"></i></button>' : '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="step-reopen" data-id="' + esc(s.id) + '" title="대기로 되돌리기"><i class="ti ti-arrow-back-up"></i></button>');
    } else if (active && !S.TERMINAL[s.status]) {
      html += '<button type="button" class="btn btn-sm btn-success" data-action="step-quick" data-id="' + esc(s.id) + '" title="계획값 그대로 오늘 완료로 기록"><i class="ti ti-check me-1"></i>완료</button><button type="button" class="btn btn-sm' + (isCur ? ' btn-primary' : '') + '" data-action="step-open" data-id="' + esc(s.id) + '"><i class="ti ti-pencil me-1"></i>기록…</button>';
    } else {
      html += '<button type="button" class="btn btn-sm" data-action="step-open" data-id="' + esc(s.id) + '">' + (S.TERMINAL[s.status] ? '기록 보기 · 수정' : '기록…') + '</button>';
    }
    return html + '</div></div>';
  }
  function cellHtml(cell, pg) {
    var r = state.run, span = cell.count > 1 ? ' colspan="' + cell.count + '"' : '';
    if (cell.type === 'branch-head') {
      return '<td' + span + ' class="cell-branch-head depth-' + cell.depth + '"><div class="d-flex justify-content-between align-items-center gap-1 flex-wrap"><div><i class="ti ti-git-branch me-1"></i><b>' + esc(cell.branch.name) + '</b> <span class="small">' + cell.branch.count + ' ' + esc(r.unitLabel) + (cell.split.name ? ' · ' + esc(cell.split.name) : '') + (cell.mismatch ? ' <span class="text-red">(수량 불일치)</span>' : '') + '</span></div>'
        + (state.editSheet ? '<span class="d-flex gap-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="split-edit" data-id="' + esc(cell.split.id) + '" title="분기 이름·수량 수정"><i class="ti ti-adjustments"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="split-remove" data-id="' + esc(cell.split.id) + '" title="분기점 삭제 (분기가 비어 있을 때)"><i class="ti ti-x"></i></button></span>' : '') + '</div></td>';
    }
    if (cell.type === 'empty') return '<td' + span + ' class="cell-empty"></td>';
    if (cell.type === 'branch-foot') {
      var ci = containerInfo(cell.branch.id);
      return '<td' + span + ' class="cell-foot"><button type="button" class="btn btn-sm" data-action="sheet-insert" data-container="' + esc(cell.branch.id) + '" data-index="' + ci.items.length + '"><i class="ti ti-plus me-1"></i>' + esc(cell.branch.name) + ' 에 스텝</button> <button type="button" class="btn btn-sm" data-action="split-add" data-container="' + esc(cell.branch.id) + '" data-index="' + ci.items.length + '"' + (cell.branch.count < 2 ? ' disabled title="수량이 1이라 나눌 수 없습니다"' : '') + '><i class="ti ti-git-branch me-1"></i>분기점</button></td>';
    }
    var s = cell.step;
    return '<td' + span + ' class="cell-step st-' + s.status + (pg.current && pg.current.id === s.id ? ' is-current' : '') + ' depth-' + cell.depth + '">' + stepCell(s, cell, pg) + '</td>';
  }
  function renderSheet() {
    var r = state.run, pg = S.progress(r);
    if (!r.steps.length && !S.hasSplit(r.tree)) return '<div class="card mb-3">' + empty('list', '스텝이 없습니다', '"스텝 추가"로 모듈이나 흐름을 넣으세요.') + (state.editSheet ? '' : '<div class="text-center pb-4"><button type="button" class="btn btn-primary" data-action="toggle-edit">시트 편집</button></div>') + '</div>';
    var rows = L.rows(L.resolve(r.tree, stepsById()), r.unitCount, { foot: state.editSheet });
    var html = '<div class="card mb-3"><div class="table-responsive"><table class="table card-table split-table"><thead><tr>' + r.units.map(function (u) { return '<th class="unit-col">' + esc(u) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) { html += '<tr class="row-' + row.type + '">' + row.cells.map(function (c) { return cellHtml(c, pg); }).join('') + '</tr>'; });
    html += '</tbody></table></div>';
    if (state.editSheet) html += '<div class="card-footer d-flex flex-wrap gap-2"><button type="button" class="btn btn-sm" data-action="sheet-insert" data-container="root" data-index="' + r.tree.length + '"><i class="ti ti-plus me-1"></i>끝에 스텝 추가</button><button type="button" class="btn btn-sm" data-action="split-add" data-container="root" data-index="' + r.tree.length + '"' + (r.unitCount < 2 ? ' disabled title="수량이 1이라 나눌 수 없습니다"' : '') + '><i class="ti ti-git-branch me-1"></i>끝에 분기점 추가</button><span class="text-secondary small ms-auto">분기점 뒤의 스텝은 합쳐진(merge) 공정입니다.</span></div>';
    return html + '</div>';
  }
  function renderDetail() {
    var r = state.run, pg = S.progress(r), cur = pg.current, active = r.status === 'active';
    var html = '<div class="card mb-3"><div class="card-body"><div class="row g-3 align-items-center">'
      + '<div class="col-lg-7"><div class="text-secondary small tnum">' + esc(r.code) + ' ' + domainBadge(r.domain) + ' <span class="badge ' + RUN_CLS[r.status] + '">' + esc(S.RUN_STATUS[r.status]) + '</span>' + (r.flowName ? ' · 흐름 <b>' + esc(r.flowName) + '</b>' : ' · 빈 런') + '</div>'
      + '<h2 class="mb-1">' + esc(r.title) + '</h2>'
      + '<div class="datagrid run-meta">' + U.dg('팀', esc(r.team || '-')) + U.dg('담당자', esc(r.owner || '-')) + U.dg('시료 / 로트', esc(r.sample || '-')) + U.dg(r.unitLabel + ' 수량', r.unitCount + ' (' + esc(r.units.join(', ')) + ')') + U.dg('기판 · 재료', esc(r.substrate || '-')) + U.dg('시작', fmtDate(r.startedAt)) + (r.endedAt ? U.dg('종료', fmtDate(r.endedAt)) : '') + '</div>'
      + (r.goal ? '<div class="mt-2 small"><i class="ti ti-target me-1 text-primary"></i>' + esc(r.goal) + '</div>' : '') + (r.note ? '<div class="mt-1 small text-secondary">' + esc(r.note) + '</div>' : '') + '</div>'
      + '<div class="col-lg-5"><div class="d-flex justify-content-between small mb-1"><span>' + pg.done + ' 완료' + (pg.skipped ? ' · ' + pg.skipped + ' 건너뜀' : '') + (pg.failed ? ' · <span class="text-red">' + pg.failed + ' 실패</span>' : '') + ' / ' + pg.total + ' 스텝</span><span class="tnum">' + pg.pct + '%</span></div>'
      + '<div class="progress progress-sm mb-3"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-secondary" style="width:' + Math.round(pg.skipped / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div>'
      + '<div class="d-flex flex-wrap gap-2">'
      + (active && cur ? '<button type="button" class="btn btn-primary" data-action="step-open" data-id="' + esc(cur.id) + '"><i class="ti ti-pencil me-1"></i>' + cur.seq + '. ' + esc(cur.name) + ' 기록</button>' : '')
      + (active && pg.allDone ? '<button type="button" class="btn btn-success" data-action="run-status" data-status="done"><i class="ti ti-flag-check me-1"></i>런 완료 처리</button>' : '')
      + '<button type="button" class="btn' + (state.editSheet ? ' btn-purple' : '') + '" data-action="toggle-edit"><i class="ti ti-list-details me-1"></i>' + (state.editSheet ? '시트 편집 끝' : '시트 편집') + '</button>'
      + '<button type="button" class="btn" data-action="print"><i class="ti ti-printer me-1"></i>인쇄 · PPT</button>'
      + '<button type="button" class="btn" data-action="csv"><i class="ti ti-file-spreadsheet me-1"></i>CSV</button>'
      + '<button type="button" class="btn" data-action="run-more"><i class="ti ti-dots"></i></button>'
      + '</div></div></div></div></div>';
    if (state.editSheet) html += '<div class="alert alert-info py-2 px-3"><i class="ti ti-info-circle me-1"></i><b>시트 편집 모드</b> — 스텝 추가·삭제·순서·계획 조건, 분기점 추가·수정을 할 수 있고 모든 변경은 변경 이력에 남습니다. 진행된 스텝은 삭제 대신 되돌리기만 됩니다.</div>';
    html += renderSheet();
    var logs = state.logs.filter(function (l) { return state.logFilter === 'all' || (state.logFilter === 'sheet' ? l.action.indexOf('sheet-') === 0 : l.action.indexOf('sheet-') !== 0); });
    html += '<div class="card"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>변경 이력 <span class="text-secondary fw-normal">' + state.logs.length + '건</span></h3><div class="card-actions"><div class="btn-group">' + [['all', '전체'], ['work', '작업 로그'], ['sheet', '시트 수정']].map(function (o) { return '<button type="button" class="btn btn-sm' + (state.logFilter === o[0] ? ' active' : '') + '" data-action="log-filter" data-filter="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>';
    if (!logs.length) html += '<div class="card-body text-secondary small">이력이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:480px;overflow:auto"><table class="table table-sm table-vcenter card-table"><thead><tr><th class="w-1">일시</th><th class="w-1">공정 일자</th><th class="w-1">동작</th><th class="w-1">스텝</th><th class="w-1">누가</th><th>내용</th></tr></thead><tbody>' + logs.map(function (l) { return '<tr><td class="text-nowrap text-secondary">' + fmtDateTime(l.at) + '</td><td class="text-nowrap">' + esc(l.date || '') + '</td><td><span class="badge ' + actionCls(l.action) + '">' + esc(S.ACTIONS[l.action] || l.action) + '</span></td><td class="text-nowrap">' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) + (l.branch ? '<br><span class="step-group">' + esc(l.branch) + '</span>' : '') : '-') + '</td><td class="text-nowrap">' + esc(l.who || '-') + (l.team ? '<br><span class="text-secondary small">' + esc(l.team) + '</span>' : '') + '</td><td class="small">' + esc(l.detail) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return html + '</div>';
  }

  /* ---------- 인쇄 · PPT ---------- */
  function printRows() { var r = state.run; return L.rows(L.resolve(r.tree, stepsById()), r.unitCount, {}); }
  function subtitle() { var r = state.run; return [domainInfo(r.domain).label, r.team, r.owner, r.sample ? '시료 ' + r.sample : '', r.unitLabel + ' ' + r.unitCount, fmtDate(r.startedAt) + (r.endedAt ? ' ~ ' + fmtDate(r.endedAt) : ''), r.flowName].filter(Boolean).join(' · '); }
  function renderPrint() {
    var r = state.run, plan = state.printMode === 'plan', rows = printRows();
    var html = '<div class="rs-print-toolbar d-print-none"><button type="button" class="btn" data-action="print-back"><i class="ti ti-arrow-left me-1"></i>돌아가기</button>'
      + '<div class="btn-group"><button type="button" class="btn' + (plan ? ' active' : '') + '" data-action="print-mode" data-mode="plan">계획 (런시트)</button><button type="button" class="btn' + (!plan ? ' active' : '') + '" data-action="print-mode" data-mode="actual">실제 기록</button></div>'
      + '<button type="button" class="btn btn-primary" data-action="pptx"><i class="ti ti-presentation me-1"></i>PPT 한 장 (.pptx)</button><button type="button" class="btn" data-action="print-now"><i class="ti ti-printer me-1"></i>인쇄 / PDF</button><span class="text-secondary small">열 = ' + esc(r.unitLabel) + ', 행 = 공정. 분기 구간은 분기별로 나란히.</span></div>';
    html += '<div class="rs-print"><div class="rs-head"><h1>공정 런시트 <span>Process Run Sheet · ' + (plan ? '계획' : '실제 기록') + '</span></h1><div class="rs-code">' + esc(r.code) + '</div></div>'
      + '<div class="rs-meta"><div><b>제목</b>' + esc(r.title) + '</div><div><b>분류</b>' + esc(domainInfo(r.domain).label) + '</div><div><b>팀 / 담당</b>' + esc(r.team) + ' / ' + esc(r.owner) + '</div><div><b>시료</b>' + esc(r.sample || '') + '</div>'
      + '<div><b>' + esc(r.unitLabel) + '</b>' + r.unitCount + ' (' + esc(r.units.join(', ')) + ')</div><div><b>기판 · 재료</b>' + esc(r.substrate || '') + '</div><div><b>흐름</b>' + esc(r.flowName || '-') + '</div><div><b>시작 / 출력</b>' + fmtDate(r.startedAt) + ' / ' + fmtDate(new Date().toISOString()) + '</div></div>'
      + (r.goal ? '<div class="rs-goal"><b>목표 · 메모</b> ' + esc(r.goal) + '</div>' : '')
      + '<table class="rs-split"><thead><tr>' + r.units.map(function (u) { return '<th>' + esc(u) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>' + row.cells.map(function (c) {
        var span = c.count > 1 ? ' colspan="' + c.count + '"' : '';
        if (c.type === 'branch-head') return '<td' + span + ' class="cell-branch-head"><b>' + esc(c.branch.name) + '</b> <span class="g">' + c.branch.count + ' ' + esc(r.unitLabel) + (c.split.name ? ' · ' + esc(c.split.name) : '') + '</span></td>';
        if (c.type !== 'step') return '<td' + span + ' class="cell-empty"></td>';
        var s = c.step, vals = plan ? s.planned : s.actual;
        var mark = plan ? '' : (s.status === 'done' ? '✓ ' : s.status === 'failed' ? '✗ ' : s.status === 'skipped' ? '→ ' : '');
        return '<td' + span + ' class="' + (plan ? '' : 'st-' + s.status) + '"><b>' + mark + s.seq + '. ' + esc(s.name) + '</b>' + (s.equipment ? ' <span class="g">' + esc(s.equipment) + '</span>' : '') + '<div>' + esc(P.text(s.fields, vals, ' · ')) + '</div>'
          + (plan ? (s.itemNote ? '<div class="g">※ ' + esc(s.itemNote) + '</div>' : '') : '<div class="g">' + esc([s.operator, s.date, s.result, s.issues ? '⚠ ' + s.issues : '', s.note].filter(Boolean).join(' · ')) + '</div>') + '</td>';
      }).join('') + '</tr>';
    });
    html += '</tbody></table>';
    var sheetLogs = state.logs.filter(function (l) { return l.action.indexOf('sheet-') === 0 || l.action === 'run-status' || l.action === 'run-edit'; });
    if (!plan && sheetLogs.length) html += '<div class="rs-sub">런시트 변경 이력</div><table class="rs-logs"><thead><tr><th style="width:12%">일시</th><th style="width:12%">동작</th><th style="width:16%">스텝</th><th style="width:10%">누가</th><th>내용</th></tr></thead><tbody>' + sheetLogs.slice().reverse().map(function (l) { return '<tr><td>' + fmtDateTime(l.at) + '</td><td>' + esc(S.ACTIONS[l.action] || l.action) + '</td><td>' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) : '-') + '</td><td>' + esc(l.who || '') + '</td><td>' + esc(l.detail) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (plan) html += '<div class="rs-sub">런시트 변경 기록 (손으로 기입)</div><table class="rs-logs"><thead><tr><th style="width:12%">일시</th><th style="width:16%">스텝 / 분기</th><th>변경 내용 · 사유</th><th style="width:12%">서명</th></tr></thead><tbody>' + '<tr class="blank"><td></td><td></td><td></td><td></td></tr>'.repeat(3) + '</tbody></table>';
    html += '<div class="rs-foot"><span>' + esc(CFG.labName || 'DSIL') + ' · ' + esc(CFG.university || 'KAIST') + '</span><span>' + esc(subtitle()) + '</span></div></div>';
    return html;
  }
  function exportPptx() {
    var r = state.run;
    toast('PPT 를 만드는 중…');
    return window.DSILPptx.exportRun({ run: r, rows: printRows(), mode: state.printMode, text: P.text, cfg: CFG.pptx || {}, subtitle: subtitle(), footer: (CFG.labName || 'DSIL') + ' · 공정 런시트 (' + (state.printMode === 'plan' ? '계획' : '실제 기록') + ') · ' + fmtDate(new Date().toISOString()) })
      .then(function () { toast('PPT 파일을 내려받았습니다.'); });
  }
  function exportCSV() {
    var r = state.run;
    var head = ['순번', '분기', '그룹', '공정', '장비', '상태', '작업자', '팀', '공정 일자', '계획 조건', '실제 조건', '결과', '특이사항', '비고', '런 중 추가'];
    var lines = [head.map(csvCell).join(',')].concat(r.steps.map(function (s) {
      return [s.seq, (s.branchPath || []).join(' › '), s.group, s.name, s.equipment, S.STEP_STATUS[s.status], s.operator, s.team, s.date || '', P.text(s.fields, s.planned), P.text(s.fields, s.actual), s.result, s.issues, s.note, s.addedInRun ? '예' : ''].map(csvCell).join(',');
    }));
    download('runsheet_' + r.code + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* ---------- 사진 ---------- */
  function thumbHtml(key, src) { return '<div class="photo-thumb" data-key="' + esc(key) + '"><img alt="" data-photo="' + esc(key) + '"' + (src ? ' src="' + src + '"' : '') + '><button type="button" class="btn btn-sm btn-icon" data-action="photo-remove" data-key="' + esc(key) + '" title="사진 빼기"><i class="ti ti-x"></i></button></div>'; }
  function loadThumbs() { $all('img[data-photo]:not([src])').forEach(function (img) { store.loadPhoto(img.getAttribute('data-photo')).then(function (src) { if (src) img.src = src; }).catch(function () {}); }); }
  function fileToJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, PH.maxEdge / Math.max(w, h)); var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', PH.quality)); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없습니다.')); };
      img.src = url;
    });
  }

  /* ---------- 대화상자 ---------- */
  function stepDialog(s) {
    var m = me(), actual = Object.keys(s.actual || {}).length ? s.actual : s.planned;
    var st = s.status === 'pending' ? 'done' : s.status;
    state.dialogStep = s;
    var body = '<div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><div>' + (s.branchPath && s.branchPath.length ? '<span class="step-group">' + esc(s.branchPath.join(' › ')) + '</span> · ' : '') + (s.group ? '<span class="text-secondary small">' + esc(s.group) + ' › </span>' : '') + '<b>' + esc(s.name) + '</b></div><div class="small text-secondary">' + P.catBadge(s.category) + (s.equipment ? ' ' + esc(s.equipment) : '') + '</div></div>'
      + (s.itemNote ? '<div class="alert alert-info py-1 px-2 small mb-2"><i class="ti ti-note me-1"></i>' + esc(s.itemNote) + '</div>' : '')
      + (s.checklist && s.checklist.length ? '<div class="small mb-2 checklist"><div class="subheader mb-1">확인 사항</div>' + s.checklist.map(function (c) { return '<label class="form-check mb-0"><input class="form-check-input" type="checkbox"><span class="form-check-label">' + esc(c) + '</span></label>'; }).join('') + '</div>' : '')
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label required">작업자</label><input type="text" class="form-control" name="operator" required value="' + esc(s.operator || m.name) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(s.team || m.team) + '" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div>'
      + '<div class="col-md-4"><label class="form-label required">공정 일자</label><input type="date" class="form-control" name="date" required value="' + esc(s.date || localDate(new Date().toISOString())) + '"></div></div>'
      + '<div class="d-flex align-items-center justify-content-between mt-3 mb-1"><div class="subheader mb-0">실제 공정 조건 <span class="text-secondary fw-normal text-lowercase">계획값이 채워져 있으니 다른 것만 고치세요</span></div><button type="button" class="btn btn-sm btn-ghost-secondary" data-action="fill-planned"><i class="ti ti-refresh me-1"></i>계획값으로</button></div>'
      + '<div id="param-box">' + P.inputs(s.fields, actual, { planned: s.planned, optional: true }) + '</div>'
      + '<div class="row g-2 mt-2"><div class="col-md-6"><label class="form-label">결과 · 관찰</label><textarea class="form-control" name="result" rows="2" placeholder="두께, 패턴 상태, 수율, 측정 요약">' + esc(s.result) + '</textarea></div>'
      + '<div class="col-md-6"><label class="form-label">특이사항 · 이상</label><textarea class="form-control" name="issues" rows="2" placeholder="장비 이상, 조건 이탈, 재작업 사유">' + esc(s.issues) + '</textarea></div></div>'
      + '<div class="mt-2"><label class="form-label">비고</label><input type="text" class="form-control" name="note" value="' + esc(s.note) + '" autocomplete="off"></div>'
      + '<div class="mt-3"><div class="subheader mb-1">사진 <span class="text-secondary fw-normal">OM 이미지, 소자 사진 (최대 ' + PH.maxPerStep + '장)</span></div><div class="photo-strip" id="photo-strip">' + (s.photos || []).map(function (k) { return thumbHtml(k); }).join('') + '</div><input type="hidden" name="photos" value="' + esc((s.photos || []).join(',')) + '"><label class="btn btn-sm mt-2 mb-0"><i class="ti ti-camera me-1"></i>사진 추가<input type="file" id="photo-input" accept="image/*" multiple hidden></label></div>'
      + '<div class="subheader mt-3 mb-1">이 스텝의 상태</div><div class="form-selectgroup">' + [['done', '완료', 'circle-check', 'green'], ['skipped', '건너뜀', 'player-skip-forward', 'secondary'], ['failed', '실패', 'alert-triangle', 'red'], ['pending', '대기', 'clock', 'secondary']].map(function (o) { return '<label class="form-selectgroup-item"><input type="radio" name="status" value="' + o[0] + '" class="form-selectgroup-input"' + (st === o[0] ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-' + o[2] + ' text-' + o[3] + ' me-1"></i>' + o[1] + '</span></label>'; }).join('') + '</div>'
      + '<div class="form-hint" data-show-if="status=skipped">건너뛴 이유를 특이사항에 적어 주세요.</div><div class="form-hint" data-show-if="status=failed">실패 원인·조치를 특이사항에 적어 주세요. 재작업은 시트 편집에서 스텝을 추가합니다.</div>';
    var p = dialog({ title: '스텝 기록 · ' + s.seq + '. ' + s.name, bodyHtml: body, okLabel: '저장', size: 'lg' });
    loadThumbs();
    return p.then(function (v) {
      state.dialogStep = null;
      if (!v) return null;
      var photos = v.photos ? v.photos.split(',').filter(Boolean) : [];
      return store.stepLog(state.run.id, s.id, { status: v.status, operator: v.operator, team: v.team, date: v.date, actual: P.read(s.fields, v), result: v.result, issues: v.issues, note: v.note, photos: photos }, { name: v.operator, team: v.team });
    });
  }
  function moduleOptions(domain, showAll) {
    var mods = state.modules.filter(function (m) { return m.active !== false && (showAll || m.domain === domain); });
    var cats = CFG.categories || [];
    var html = cats.map(function (c) { var ms = mods.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc(c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + (m.domain !== domain ? ' [' + esc(domainInfo(m.domain).short) + ']' : '') + (m.equipment ? ' — ' + esc(m.equipment) : '') + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
    html += mods.filter(function (m) { return !cats.some(function (c) { return c.id === m.category; }); }).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    return { html: html, mods: mods };
  }
  function insertDialog(container, index) {
    var r = state.run, ci = containerInfo(container);
    var opt = moduleOptions(r.domain, false), optAll = moduleOptions(r.domain, true);
    var flows = state.flows.filter(function (f) { return f.active !== false && !S.hasSplit(f.items) && (f.domain === r.domain); });
    var where = (container === 'root' ? '공통 구간' : '분기 "' + ci.name + '"') + (index >= ci.items.length ? ' 끝' : ' ' + (index + 1) + '번째 위치');
    var body = '<div class="text-secondary small mb-2"><i class="ti ti-map-pin me-1"></i>위치: ' + esc(where) + '</div>'
      + '<div class="form-selectgroup mb-2"><label class="form-selectgroup-item"><input type="radio" name="kind" value="module" class="form-selectgroup-input" checked><span class="form-selectgroup-label"><i class="ti ti-box me-1"></i>모듈 1개</span></label><label class="form-selectgroup-item"><input type="radio" name="kind" value="flow" class="form-selectgroup-input"' + (flows.length ? '' : ' disabled') + '><span class="form-selectgroup-label"><i class="ti ti-git-branch me-1"></i>흐름 (여러 스텝)</span></label></div>'
      + '<div data-show-if="kind=module"><div class="d-flex align-items-end gap-2"><div class="flex-fill"><label class="form-label required">모듈 <span class="form-label-description">' + esc(domainInfo(r.domain).label) + '</span></label><select class="form-select" name="moduleId" required>' + opt.html + '</select></div><label class="form-check mb-2 text-nowrap"><input class="form-check-input" type="checkbox" name="showAll"><span class="form-check-label">다른 분류도</span></label></div>'
      + '<div data-show-if="showAll=true"><label class="form-label">모든 분류의 모듈</label><select class="form-select" name="moduleIdAll">' + optAll.html + '</select></div>'
      + '<div class="mt-2"><label class="form-label">스텝 이름 <span class="form-label-description">비우면 모듈 이름</span></label><input type="text" class="form-control" name="name" autocomplete="off" placeholder="예: 2차 리프트오프 (재작업)"></div>'
      + optAll.mods.map(function (m) { return '<div data-show-if="moduleId=' + esc(m.id) + '" class="mt-2 param-block" data-mod="' + esc(m.id) + '"><div class="subheader mb-1">계획 조건</div>' + P.inputs(m.fields, S.defaults(m.fields), { optional: true }) + '</div>'; }).join('') + '</div>'
      + '<div data-show-if="kind=flow"><div class="mt-2"><label class="form-label required">흐름 (분기점 없는 것만)</label><select class="form-select" name="flowId" required>' + flows.map(function (f) { return '<option value="' + esc(f.id) + '">' + esc(f.name) + ' (' + f.items.length + '항목)</option>'; }).join('') + '</select></div></div>'
      + '<div class="mt-2"><label class="form-label">메모 <span class="form-label-description">추가한 이유 등</span></label><input type="text" class="form-control" name="note" autocomplete="off"></div>';
    return dialog({ title: '런시트에 스텝 추가', bodyHtml: body, okLabel: '추가', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var m = me();
      if (v.kind === 'flow') return store.sheetInsert(r.id, { container: container, index: index, flowId: v.flowId, note: v.note }, m);
      var modId = v.showAll && v.moduleIdAll ? v.moduleIdAll : v.moduleId;
      var mod = modById(modId);
      return store.sheetInsert(r.id, { container: container, index: index, moduleId: modId, name: v.name, params: P.read(mod ? mod.fields : [], v), note: v.note }, m);
    });
  }
  function branchRows(branches, unitLabel) {
    return branches.map(function (b, i) { var k = b.id || ('n' + i); return '<div class="input-group input-group-sm mb-1" data-brow><input type="hidden" name="bid_' + esc(k) + '" value="' + esc(b.id || '') + '"><input type="text" class="form-control" name="bname_' + esc(k) + '" value="' + esc(b.name) + '" placeholder="분기 이름" required><input type="number" class="form-control" name="bcount_' + esc(k) + '" value="' + b.count + '" min="1" required style="max-width:6rem"><span class="input-group-text">' + esc(unitLabel) + '</span><button type="button" class="btn" data-action="brow-remove" title="이 분기 빼기"><i class="ti ti-x"></i></button></div>'; }).join('');
  }
  function readBranches(v) {
    var out = {}; Object.keys(v).forEach(function (k) { var mm = /^(bid|bname|bcount)_(.+)$/.exec(k); if (!mm) return; out[mm[2]] = out[mm[2]] || {}; out[mm[2]][mm[1]] = v[k]; });
    return Object.keys(out).map(function (k) { return { id: out[k].bid || undefined, name: out[k].bname, count: out[k].bcount }; });
  }
  function splitAddDialog(container, index) {
    var r = state.run, ci = containerInfo(container), n = ci.count;
    var body = '<div class="text-secondary small mb-2">' + (container === 'root' ? '공통 구간' : '분기 "' + esc(ci.name) + '"') + '의 ' + esc(r.unitLabel) + ' <b>' + n + '개</b>를 나눕니다. 분기 수량의 합은 ' + n + ' 이어야 합니다. 분기점 뒤에 추가하는 스텝은 다시 합쳐진(merge) 공정입니다.</div>'
      + '<div class="mb-2"><label class="form-label">분기점 이름 <span class="form-label-description">예: 접촉 금속, 어닐링 온도</span></label><input type="text" class="form-control" name="name" autocomplete="off"></div>'
      + '<div class="d-flex justify-content-between align-items-center mb-1"><div class="subheader mb-0">분기</div><button type="button" class="btn btn-sm" data-action="brow-add"><i class="ti ti-plus me-1"></i>분기</button></div><div id="brow-box">' + branchRows([{ name: 'A', count: Math.ceil(n / 2) }, { name: 'B', count: Math.floor(n / 2) }], r.unitLabel) + '</div>';
    return dialog({ title: '분기점 추가', bodyHtml: body, okLabel: '분기점 만들기', size: 'md' }).then(function (v) { if (!v) return null; return store.splitAdd(r.id, { container: container, index: index, name: v.name, branches: readBranches(v) }, me()); });
  }
  function splitEditDialog(split) {
    var r = state.run, loc = locate(split.id);
    var body = '<div class="text-secondary small mb-2">나눌 수량 <b>' + loc.count + '</b> ' + esc(r.unitLabel) + '. 스텝이 있는 분기는 뺄 수 없고, 수량·이름만 바꿀 수 있습니다.</div>'
      + '<div class="mb-2"><label class="form-label">분기점 이름</label><input type="text" class="form-control" name="name" value="' + esc(split.name || '') + '" autocomplete="off"></div>'
      + '<div class="d-flex justify-content-between align-items-center mb-1"><div class="subheader mb-0">분기</div><button type="button" class="btn btn-sm" data-action="brow-add"><i class="ti ti-plus me-1"></i>분기</button></div><div id="brow-box">' + branchRows(split.branches, r.unitLabel) + '</div>';
    return dialog({ title: '분기 수정', bodyHtml: body, okLabel: '저장', size: 'md' }).then(function (v) { if (!v) return null; return store.splitEdit(r.id, split.id, { name: v.name, branches: readBranches(v) }, me()); });
  }
  function planDialog(s) {
    var body = '<div class="row g-2"><div class="col-md-8"><label class="form-label required">스텝 이름</label><input type="text" class="form-control" name="name" required value="' + esc(s.name) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">장비</label><input type="text" class="form-control" name="equipment" value="' + esc(s.equipment) + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">메모 <span class="form-label-description">시트에 표시되는 지시·주의</span></label><input type="text" class="form-control" name="itemNote" value="' + esc(s.itemNote) + '" autocomplete="off"></div>'
      + '<div class="subheader mt-3 mb-1">계획 조건</div>' + P.inputs(s.fields, s.planned, { optional: true })
      + (S.TERMINAL[s.status] ? '<div class="form-hint mt-2">이미 끝난 스텝입니다. 계획 조건을 바꿔도 실제 기록은 그대로이며 변경 이력에 남습니다.</div>' : '');
    return dialog({ title: '계획 수정 · ' + s.seq + '. ' + s.name, bodyHtml: body, okLabel: '저장', size: 'lg' }).then(function (v) { if (!v) return null; return store.sheetEdit(state.run.id, s.id, { name: v.name, equipment: v.equipment, itemNote: v.itemNote, planned: P.read(s.fields, v) }, me()); });
  }
  function runEditDialog(r) {
    var body = '<div class="row g-2"><div class="col-md-8"><label class="form-label required">제목</label><input type="text" class="form-control" name="title" required value="' + esc(r.title) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시작</label><input type="datetime-local" class="form-control" name="startedAt" value="' + toLocalInput(r.startedAt) + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(r.team) + '" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div><div class="col-md-4"><label class="form-label required">담당자</label><input type="text" class="form-control" name="owner" required value="' + esc(r.owner) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시료 / 로트 ID</label><input type="text" class="form-control" name="sample" value="' + esc(r.sample) + '" autocomplete="off"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label">단위 라벨</label><input type="text" class="form-control" name="unitLabel" value="' + esc(r.unitLabel) + '" autocomplete="off"></div><div class="col-md-8"><label class="form-label">' + esc(r.unitLabel) + ' 이름 (' + r.unitCount + '개, 쉼표 구분)</label><input type="text" class="form-control" name="units" value="' + esc(r.units.join(', ')) + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">기판 · 재료</label><input type="text" class="form-control" name="substrate" value="' + esc(r.substrate) + '" autocomplete="off"></div>'
      + '<div class="mt-2"><label class="form-label">목표 · 메모</label><textarea class="form-control" name="goal" rows="2">' + esc(r.goal) + '</textarea></div><div class="mt-2"><label class="form-label">비고</label><input type="text" class="form-control" name="note" value="' + esc(r.note) + '" autocomplete="off"></div>';
    return dialog({ title: '런 정보 수정', bodyHtml: body, okLabel: '저장', size: 'lg' }).then(function (v) { if (!v) return null; return store.updateRun(r.id, { title: v.title, startedAt: v.startedAt ? fromLocalInput(v.startedAt) : undefined, team: v.team, owner: v.owner, sample: v.sample, unitLabel: v.unitLabel, units: v.units, substrate: v.substrate, goal: v.goal, note: v.note }, me()); });
  }
  function moreDialog(r) {
    var active = r.status === 'active';
    var items = [['run-edit', 'pencil', '런 정보 수정', '제목·팀·담당자·시료·기판 이름·목표'], ['run-clone', 'copy', '이 런 복제', '같은 런시트로 새 런 (실제값을 계획으로 가져올 수 있음)'], ['run-to-flow', 'git-branch', '흐름으로 저장', '이 런의 스텝·분기·조건을 새 공정 흐름(템플릿)으로'],
      active ? ['run-pause', 'player-pause', '보류', '잠시 멈춤 (기록 불가)'] : ['run-resume', 'player-play', '재개', '다시 진행 중으로'], ['run-done', 'flag-check', '완료 처리', '모든 작업이 끝났을 때'], ['run-abort', 'circle-x', '중단', '사유를 남기고 중단'], ['run-delete', 'trash', '런 삭제', '기록·이력이 모두 지워집니다']];
    return dialog({ title: r.code + ' · 더 보기', html: '<div class="list-group list-group-flush">' + items.map(function (i) { return '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-action="more-' + i[0] + '"><i class="ti ti-' + i[1] + ' ' + (i[0] === 'run-delete' || i[0] === 'run-abort' ? 'text-red' : 'text-primary') + '"></i><div><div class="fw-medium">' + i[2] + '</div><div class="small text-secondary">' + i[3] + '</div></div></button>'; }).join('') + '</div>', hideCancel: true, okLabel: '닫기', size: 'md' });
  }
  function cloneDialog(r) {
    var m = me();
    var body = '<div class="mb-2"><label class="form-label required">새 런 제목</label><input type="text" class="form-control" name="title" required value="' + esc(r.title) + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-4"><label class="form-label">시료 / 로트</label><input type="text" class="form-control" name="sample" autocomplete="off"></div><div class="col-4"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required value="' + esc(m.team || r.team) + '" autocomplete="off"></div><div class="col-4"><label class="form-label required">담당자</label><input type="text" class="form-control" name="owner" required value="' + esc(m.name || r.owner) + '" autocomplete="off"></div></div>'
      + '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="fromActual" checked><span class="form-check-label">완료된 스텝의 <b>실제 조건</b>을 새 런의 계획 조건으로</span></label>';
    return dialog({ title: '런 복제', bodyHtml: body, okLabel: '복제', size: 'md' }).then(function (v) { if (!v) return null; return store.cloneRun(r.id, { title: v.title, sample: v.sample, team: v.team, owner: v.owner, fromActual: !!v.fromActual }); });
  }
  function toFlowDialog(r) {
    var body = '<div class="mb-2"><label class="form-label required">흐름 이름</label><input type="text" class="form-control" name="name" required value="' + esc(r.title) + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label">소자 종류</label><input type="text" class="form-control" name="device" autocomplete="off"></div><div class="col-6"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="런 ' + esc(r.code) + ' 에서 저장" autocomplete="off"></div></div>'
      + '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="fromActual" checked><span class="form-check-label">완료된 스텝의 실제 조건을 흐름의 계획 조건으로</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="dropSkipped" checked><span class="form-check-label">건너뛴 스텝은 빼기</span></label>'
      + '<div class="form-hint mt-2">분기점·수량(' + esc(r.unitLabel) + ' ' + r.unitCount + ')도 함께 저장됩니다. 분류: ' + esc(domainInfo(r.domain).label) + '</div>';
    return dialog({ title: '이 런을 공정 흐름으로 저장', bodyHtml: body, okLabel: '흐름 저장', size: 'md' }).then(function (v) { if (!v) return null; return store.saveRunAsFlow(r.id, { name: v.name, device: v.device, description: v.description, fromActual: !!v.fromActual, dropSkipped: !!v.dropSkipped }); });
  }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function openStep(id) {
    var s = stepById(id); if (!s) { toast('스텝을 찾을 수 없습니다.', true); return Promise.resolve(); }
    if (state.run.status !== 'active' && !S.TERMINAL[s.status]) { toast('런이 ' + S.RUN_STATUS[state.run.status] + ' 상태라 기록할 수 없습니다. 더 보기에서 재개하세요.', true); return Promise.resolve(); }
    return ensureMe().then(function (m) { if (!m) return null; return stepDialog(s); }).then(function (res) { if (res) { toast(res.status === 'done' ? '완료를 기록했습니다.' : S.STEP_STATUS[res.status] + ' 으로 저장했습니다.'); return refresh(); } });
  }
  function setStatus(status) {
    var r = state.run, pg = S.progress(r), pre = Promise.resolve('');
    if (status === 'done' && !pg.allDone) pre = confirmDlg({ title: '런 완료', message: '아직 끝나지 않은 스텝이 ' + (pg.total - pg.finished) + '개 있습니다. 그래도 완료 처리할까요?', okLabel: '완료' }).then(function (ok) { return ok ? '' : null; });
    if (status === 'aborted') pre = promptDlg({ title: '런 중단', message: '중단 사유를 남겨 주세요.', input: 'textarea', placeholder: '예: 시료 파손', okLabel: '중단', danger: true });
    pre.then(function (note) { if (note === null) return; return store.setRunStatus(r.id, status, me(), note || '').then(function () { toast('런을 ' + S.RUN_STATUS[status] + ' 상태로 바꿨습니다.'); return refresh(); }); }).catch(handleError);
  }

  document.addEventListener('change', function (e) {
    var lf = e.target.closest('#list-filter');
    if (lf) { if (e.target.name === 'q') return; var v = readForm(lf); state.filter = { domain: v.domain || '', status: v.status || '', team: v.team || '', who: v.who || '', q: v.q || '' }; state.groupTeam = !!v.groupTeam; render(); return; }
    if (e.target.id === 'photo-input') {
      var files = Array.prototype.slice.call(e.target.files || []); e.target.value = '';
      var hidden = $('#modal-form [name="photos"]'), strip = $('#photo-strip'); if (!hidden || !strip || !files.length) return;
      var cur = hidden.value.split(',').filter(Boolean);
      if (cur.length + files.length > PH.maxPerStep) { toast('사진은 스텝당 최대 ' + PH.maxPerStep + '장입니다.', true); files = files.slice(0, Math.max(0, PH.maxPerStep - cur.length)); }
      var chain = Promise.resolve();
      files.forEach(function (f) { chain = chain.then(function () { return fileToJpeg(f).then(function (dataUrl) { return store.savePhoto(dataUrl).then(function (key) { cur.push(key); hidden.value = cur.join(','); strip.insertAdjacentHTML('beforeend', thumbHtml(key, dataUrl)); }); }); }); });
      chain.catch(handleError);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.name === 'q' && e.target.closest('#list-filter')) { state.filter.q = e.target.value; var card = $('#list-filter').closest('.card'); var tmp = document.createElement('div'); tmp.innerHTML = renderList(); var next = card.nextElementSibling; while (next) { var n2 = next.nextElementSibling; next.remove(); next = n2; } Array.prototype.slice.call(tmp.children, 1).forEach(function (c) { card.parentNode.appendChild(c); }); }
  });
  document.addEventListener('submit', function (e) { if (e.target.getAttribute('id') === 'list-filter') { e.preventDefault(); render(); } });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id'), r = state.run;
    if (el.tagName === 'A') e.preventDefault();
    switch (action) {
      case 'set-me': meDialog().then(function (m) { if (m) toast(m.name + ' (' + m.team + ') 으로 기록합니다.'); }).catch(handleError); break;
      case 'refresh': refresh(); break;
      case 'step-open': openStep(id).catch(handleError); break;
      case 'step-quick':
        ensureMe().then(function (m) { if (!m) return; return store.stepQuick(r.id, id, m).then(function (s) { toast(s.seq + '. ' + s.name + ' 을 계획대로 완료로 기록했습니다.'); return refresh(); }); }).catch(function (err) { var s = stepById(id); if (/필수/.test(err.message) && s) { toast(err.message, true); openStep(id).catch(handleError); } else handleError(err); }); break;
      case 'step-reopen': confirmDlg({ title: '대기로 되돌리기', message: '이 스텝을 다시 대기 상태로 되돌릴까요? 기록된 값은 남고 이력에 기록됩니다.', okLabel: '되돌리기' }).then(function (ok) { if (!ok) return; return store.stepReopen(r.id, id, me()).then(function () { toast('대기 상태로 되돌렸습니다.'); return refresh(); }); }).catch(handleError); break;
      case 'fill-planned': { var s0 = state.dialogStep, box = $('#param-box'); if (s0 && box) box.innerHTML = P.inputs(s0.fields, s0.planned, { planned: s0.planned, optional: true }); break; }
      case 'photo-remove': { var key = el.getAttribute('data-key'), hidden = $('#modal-form [name="photos"]'); if (hidden) hidden.value = hidden.value.split(',').filter(function (k) { return k && k !== key; }).join(','); var th = el.closest('.photo-thumb'); if (th) th.remove(); break; }
      case 'toggle-edit': state.editSheet = !state.editSheet; render(); break;
      case 'sheet-insert': ensureMe().then(function (m) { if (!m) return; return insertDialog(el.getAttribute('data-container') || 'root', Number(el.getAttribute('data-index')) || 0).then(function (res) { if (res) { toast('스텝을 추가했습니다.'); return refresh(); } }); }).catch(handleError); break;
      case 'sheet-remove': { var sr = stepById(id); if (!sr) break; confirmDlg({ title: '스텝 삭제', message: sr.seq + '. ' + sr.name + ' 스텝을 런시트에서 뺄까요? 변경 이력에 남습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.sheetRemove(r.id, id, me()).then(function () { toast('스텝을 뺐습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'sheet-move': store.sheetMove(r.id, id, el.getAttribute('data-dir'), me()).then(function () { return refresh(); }).catch(handleError); break;
      case 'sheet-edit': { var se = stepById(id); if (!se) break; planDialog(se).then(function (res) { if (res) { toast('계획을 수정했습니다.'); return refresh(); } }).catch(handleError); break; }
      case 'split-add': ensureMe().then(function (m) { if (!m) return; return splitAddDialog(el.getAttribute('data-container') || 'root', Number(el.getAttribute('data-index')) || 0).then(function (res) { if (res) { toast('분기점을 추가했습니다. 분기마다 스텝을 넣으세요.'); return refresh(); } }); }).catch(handleError); break;
      case 'split-edit': { var sp = locate(id); if (!sp) break; splitEditDialog(sp.node).then(function (res) { if (res) { toast('분기를 수정했습니다.'); return refresh(); } }).catch(handleError); break; }
      case 'split-remove': confirmDlg({ title: '분기점 삭제', message: '이 분기점을 지울까요? 분기 안에 스텝이 없어야 합니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.splitRemove(r.id, id, me()).then(function () { toast('분기점을 지웠습니다.'); return refresh(); }); }).catch(handleError); break;
      case 'brow-add': { var box = $('#brow-box'); if (box) { var n = box.querySelectorAll('[data-brow]').length; box.insertAdjacentHTML('beforeend', branchRows([{ name: String.fromCharCode(65 + n), count: 1 }].map(function (b) { return Object.assign(b, { id: '' }); }), r ? r.unitLabel : '')); var rows = box.querySelectorAll('[data-brow]'); var last = rows[rows.length - 1]; last.querySelectorAll('input').forEach(function (i) { if (i.name.indexOf('bname_') === 0 || i.name.indexOf('bcount_') === 0 || i.name.indexOf('bid_') === 0) i.name = i.name.replace(/_(n0|n\d+|)$/, '_n' + n); }); } break; }
      case 'brow-remove': { var row = el.closest('[data-brow]'); if (row && $('#brow-box').querySelectorAll('[data-brow]').length > 2) row.remove(); else toast('분기는 2개 이상이어야 합니다.', true); break; }
      case 'log-filter': state.logFilter = el.getAttribute('data-filter'); render(); break;
      case 'csv': exportCSV(); break;
      case 'print': state.print = true; state.editSheet = false; render(); window.scrollTo(0, 0); break;
      case 'print-back': state.print = false; render(); break;
      case 'print-mode': state.printMode = el.getAttribute('data-mode'); render(); break;
      case 'print-now': window.print(); break;
      case 'pptx': exportPptx().catch(handleError); break;
      case 'run-status': setStatus(el.getAttribute('data-status')); break;
      case 'run-more': moreDialog(r).catch(handleError); break;
      case 'more-run-edit': U.closeAll(); runEditDialog(r).then(function (res) { if (res) { toast('런 정보를 수정했습니다.'); return refresh(); } }).catch(handleError); break;
      case 'more-run-clone': U.closeAll(); cloneDialog(r).then(function (run) { if (run) { toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.hash = '#id=' + run.id; } }).catch(handleError); break;
      case 'more-run-to-flow': U.closeAll(); toFlowDialog(r).then(function (res) { if (res) toast('흐름 "' + res.flow.name + '" 을 저장했습니다.' + (res.skipped ? ' (모듈 없는 스텝 ' + res.skipped + '개 제외)' : '')); }).catch(handleError); break;
      case 'more-run-pause': U.closeAll(); setStatus('paused'); break;
      case 'more-run-resume': U.closeAll(); setStatus('active'); break;
      case 'more-run-done': U.closeAll(); setStatus('done'); break;
      case 'more-run-abort': U.closeAll(); setStatus('aborted'); break;
      case 'more-run-delete': U.closeAll(); confirmDlg({ title: '런 삭제', message: r.code + ' ' + r.title + ' 런과 모든 기록·이력을 지웁니다. 되돌릴 수 없습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteRun(r.id).then(function () { toast('삭제했습니다.'); window.location.hash = ''; }); }).catch(handleError); break;
    }
  });

  window.addEventListener('hashchange', function () { readHash(); state.print = false; state.editSheet = false; refresh().then(maybeOpenStep); });
  function maybeOpenStep() {
    if (!state.openStepId || !state.run) return;
    var id = state.openStepId; state.openStepId = null;
    try { history.replaceState(null, '', '#id=' + state.run.id); } catch (e) { /* ignore */ }
    openStep(id).catch(handleError);
  }

  store.init().then(function () {
    state.ready = true; readHash();
    store.onChange(function () { reload().then(render).catch(handleError); });
    return refresh().then(maybeOpenStep);
  }).catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
