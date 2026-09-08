/* =====================================================================
   DSIL Run Sheet – 공정 런: 내 런 / 아카이브(모두 공개, 읽기 전용) / 전체(관리자) 목록 + 런시트
   런시트 = 행(Step n · 대분류) × 열(기판 단위). 분기점은 행 범위에 걸치고, 범위 안에서는 분기마다 셀을 두거나 비워서 건너뜀.
   편집 모드에서 라이브러리 모듈·흐름을 불러와 구성. 완료 시 아카이브 올리기(동의한 것만).
   해시: #id=<runId>[&step=<cellId>][&edit=1]  |  #scope=mine|archive|all
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore, SH = window.DSILSheet, SV = window.DSILSheetView;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDateTime = U.fmtDateTime, localDate = U.localDate, toLocalInput = U.toLocalInput, fromLocalInput = U.fromLocalInput, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, promptDlg = U.promptDlg, empty = U.empty, csvCell = U.csvCell, download = U.download;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [];
  var CATS = CFG.categories || [];
  var PH = Object.assign({ maxEdge: 1400, quality: 0.85, maxPerStep: 6 }, CFG.photo || {});
  var STEP_CLS = { pending: 'bg-secondary-lt', done: 'bg-green-lt', skipped: 'bg-secondary-lt', failed: 'bg-red-lt' };
  var RUN_CLS = { active: 'bg-blue-lt', paused: 'bg-secondary-lt', done: 'bg-green-lt', aborted: 'bg-red-lt' };
  var state = { ready: false, error: null, runId: null, openStepId: null, autoEdit: false, scope: 'mine', run: null, logs: [], modules: [], flows: [], runs: [], print: false, printMode: 'plan', editSheet: false, logFilter: 'all',
    filter: { domain: '', status: '', team: '', who: '', q: '' }, groupTeam: false, dialogStep: null };

  function me() { return store.getMe(); }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function domainBadge(id) { return '<span class="badge ' + (id === 'package' ? 'bg-indigo-lt' : 'bg-blue-lt') + '">' + esc(domainInfo(id).short) + '</span>'; }
  function teams() { var set = {}; (CFG.teams || []).forEach(function (t) { set[t] = 1; }); state.runs.forEach(function (r) { if (r.team) set[r.team] = 1; }); if (state.run && state.run.team) set[state.run.team] = 1; var m = me(); if (m.team) set[m.team] = 1; return Object.keys(set).sort(); }
  function ensureTeam() {
    var m = me(); if (m.team) return Promise.resolve(m);
    var body = '<label class="form-label required">팀</label><select class="form-select" name="team" required><option value="">선택</option>' + teams().map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + '</option>'; }).join('') + '<option value="__custom">직접 입력…</option></select><div data-show-if="team=__custom" class="mt-1"><input type="text" class="form-control" name="teamCustom" placeholder="새 팀 이름" autocomplete="off"></div>';
    return dialog({ title: '팀 지정', message: '기록에 붙을 팀이 정해져 있지 않습니다.', bodyHtml: body, okLabel: '저장' }).then(function (v) { if (!v) return null; return store.setMyTeam(v.team === '__custom' ? v.teamCustom : v.team).then(function () { renderChrome(); return me(); }); });
  }
  function readHash() { var q = new URLSearchParams(window.location.hash.replace(/^#/, '')); state.runId = q.get('id') || null; state.openStepId = q.get('step') || null; state.autoEdit = q.get('edit') === '1'; var sc = q.get('scope'); if (sc && ['mine', 'archive', 'all'].indexOf(sc) >= 0) state.scope = sc; }
  function findCell(id) { return state.run ? SH.findCell(state.run, id) : null; }
  function modById(id) { return state.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }
  function ro() { return !state.run || !state.run.canEdit; }
  function editing() { return state.editSheet && !ro(); }
  function catSelect(name, value, allowFollow) {
    return '<select class="form-select" name="' + name + '">' + (allowFollow ? '<option value=""' + (!value ? ' selected' : '') + '>모듈 분류 따르기</option>' : '') + CATS.map(function (c) { return '<option value="' + c.id + '"' + (value === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>';
  }

  function reload() {
    if (state.runId) return Promise.all([store.getRun(state.runId), store.listLogs(state.runId), store.listModules(), store.listFlows()]).then(function (r) { state.run = r[0]; state.logs = r[1]; state.modules = r[2]; state.flows = r[3]; });
    return store.listRuns({ scope: state.scope }).then(function (r) { state.runs = r; state.run = null; });
  }

  /* ---------- 렌더 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var m = me();
    slot.innerHTML = m.id ? '<a href="../index.html" class="btn btn-sm"><span class="avatar avatar-xs ' + (m.isAdmin ? 'bg-primary text-white' : 'bg-blue-lt') + ' me-1">' + esc(m.name.charAt(0)) + '</span>' + esc(m.name) + (m.team ? ' <span class="text-secondary">· ' + esc(m.team) + '</span>' : '') + '</a>' : '';
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    document.body.classList.toggle('print-mode', state.print && !!state.run);
    var title = $('#page-title'); if (title) title.textContent = state.run ? state.run.title : '공정 런';
    if (!state.runId) { app.innerHTML = renderList(); return; }
    if (!state.run) { app.innerHTML = '<div class="card">' + empty('clipboard-off', '런을 찾을 수 없거나 볼 권한이 없습니다', '내가 만든 런이거나 아카이브에 올라온 런만 볼 수 있습니다.') + '<div class="text-center pb-4"><a href="./index.html" class="btn">런 목록</a></div></div>'; return; }
    app.innerHTML = state.print ? renderPrint() : renderDetail();
  }

  function renderList() {
    var f = state.filter, q = f.q.trim().toLowerCase(), m = me();
    var whoSet = {}; state.runs.forEach(function (r) { if (r.owner) whoSet[r.owner] = 1; });
    var rows = state.runs.filter(function (r) {
      if (f.domain && r.domain !== f.domain) return false; if (f.status && r.status !== f.status) return false; if (f.team && r.team !== f.team) return false; if (f.who && r.owner !== f.who) return false;
      if (q && [r.code, r.title, r.sample, r.owner, r.team, r.flowName].join(' ').toLowerCase().indexOf(q) < 0) return false; return true;
    });
    var tabs = [['mine', 'user', '내 런'], ['archive', 'archive', '아카이브']].concat(m.isAdmin ? [['all', 'world', '전체 (관리자)']] : []);
    var html = '<ul class="nav nav-tabs mb-3">' + tabs.map(function (t) { return '<li class="nav-item"><a class="nav-link' + (state.scope === t[0] ? ' active' : '') + '" href="#scope=' + t[0] + '"><i class="ti ti-' + t[1] + ' me-1"></i>' + t[2] + '</a></li>'; }).join('') + '</ul>';
    html += '<div class="card mb-3"><div class="card-body"><form id="list-filter" class="row g-2 align-items-end">'
      + '<div class="col-6 col-md-2"><label class="form-label">분류</label><select class="form-select" name="domain"><option value="">전체</option>' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + (f.domain === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">상태</label><select class="form-select" name="status"><option value="">전체</option>' + Object.keys(S.RUN_STATUS).map(function (k) { return '<option value="' + k + '"' + (f.status === k ? ' selected' : '') + '>' + S.RUN_STATUS[k] + '</option>'; }).join('') + '</select></div>'
      + (state.scope !== 'mine' ? '<div class="col-6 col-md-2"><label class="form-label">팀</label><select class="form-select" name="team"><option value="">전체</option>' + teams().map(function (t) { return '<option value="' + esc(t) + '"' + (f.team === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>'
        + '<div class="col-6 col-md-2"><label class="form-label">담당자</label><select class="form-select" name="who"><option value="">전체</option>' + Object.keys(whoSet).sort().map(function (n) { return '<option value="' + esc(n) + '"' + (f.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>' : '')
      + '<div class="col-8 col-md-3"><label class="form-label">검색</label><input type="search" class="form-control" name="q" value="' + esc(f.q) + '" placeholder="코드, 제목, 시료, 흐름" autocomplete="off"></div>'
      + (state.scope !== 'mine' ? '<div class="col-4 col-md-1"><label class="form-check mb-2"><input class="form-check-input" type="checkbox" name="groupTeam"' + (state.groupTeam ? ' checked' : '') + '><span class="form-check-label">팀별</span></label></div>' : '')
      + '<div class="col-12 col-md-auto ms-md-auto"><a href="../index.html?new=1" class="btn btn-primary"><i class="ti ti-player-play me-1"></i>새 런 시작</a></div></form></div></div>';
    function table(list) {
      return '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th class="w-1">코드</th><th>런</th><th>팀 · 담당</th><th>시료 · 단위</th><th style="min-width:140px">진행</th><th class="w-1">시작</th><th class="w-1">상태</th><th class="w-1"></th></tr></thead><tbody>'
        + list.map(function (r) { var pg = S.progress(r); return '<tr><td class="text-nowrap tnum"><a href="#id=' + esc(r.id) + '">' + esc(r.code) + '</a></td><td><a href="#id=' + esc(r.id) + '" class="text-reset fw-medium">' + esc(r.title) + '</a><span class="sub">' + domainBadge(r.domain) + ' ' + esc(r.flowName ? '흐름 ' + r.flowName : '직접 구성') + ' · ' + r.rows.length + '행' + (r.archived ? ' <span class="badge bg-teal-lt">아카이브</span>' : '') + '</span></td><td class="small">' + esc(r.team) + '<br>' + esc(r.owner) + '</td><td class="small">' + esc(r.sample || '-') + '<br><span class="text-secondary">' + esc(r.unitLabel) + ' ' + r.unitCount + '</span></td><td><div class="d-flex align-items-center gap-2"><div class="progress progress-sm flex-fill"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div><span class="small tnum text-nowrap">' + pg.finished + '/' + pg.total + '</span></div></td><td class="text-nowrap text-secondary">' + fmtDate(r.startedAt) + '</td><td><span class="badge ' + RUN_CLS[r.status] + '">' + esc(S.RUN_STATUS[r.status]) + '</span></td><td class="text-end"><a href="#id=' + esc(r.id) + '" class="btn btn-sm">열기</a></td></tr>'; }).join('') + '</tbody></table></div>';
    }
    if (!rows.length) return html + '<div class="card">' + empty(state.scope === 'archive' ? 'archive-off' : 'clipboard-list', state.scope === 'archive' ? '아카이브에 올라온 런이 없습니다' : '런이 없습니다', state.scope === 'archive' ? '런을 완료할 때 "아카이브에 올릴까요?"에 동의한 런이 여기에 공개됩니다.' : '홈에서 "새 런 시작"을 누르세요.') + '</div>';
    if (!state.groupTeam || state.scope === 'mine') return html + '<div class="card">' + table(rows) + '</div>';
    var by = {}; rows.forEach(function (r) { var k = r.team || '(팀 미지정)'; (by[k] = by[k] || []).push(r); });
    return html + Object.keys(by).sort().map(function (t) { return '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-users me-1 text-primary"></i>' + esc(t) + ' <span class="text-secondary fw-normal">' + by[t].length + '개</span></h3></div>' + table(by[t]) + '</div>'; }).join('');
  }

  /* ---------- 런시트 표 ---------- */
  function rowStatus(row, leaves) {
    var cells = leaves.map(function (l) { return row.cells[l.id]; }).filter(Boolean);
    if (!cells.length) return 'pending';
    if (cells.some(function (c) { return c.status === 'failed'; })) return 'failed';
    if (cells.every(function (c) { return S.TERMINAL[c.status]; })) return cells.every(function (c) { return c.status === 'skipped'; }) ? 'skipped' : 'done';
    return 'pending';
  }
  function rowHeadHtml(row, i, leaves) {
    var r = state.run, edit = editing(), canClose = edit && canCloseAt(r, i);
    var html = '<div class="d-flex gap-2 align-items-start"><span class="step-num is-' + rowStatus(row, leaves) + '">' + (i + 1) + '</span><div class="flex-fill min-w-0"><div class="fw-bold row-name">' + esc(row.name || '(이름 없음)') + '</div><div>' + P.catBadge(row.category) + '</div>' + (row.note ? '<div class="small text-secondary"><i class="ti ti-note"></i> ' + esc(row.note) + '</div>' : '') + '</div></div>';
    if (edit) {
      html += '<div class="d-flex flex-wrap gap-1 mt-2">'
        + '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="row-insert" data-index="' + i + '" title="이 앞에 행 추가"><i class="ti ti-row-insert-top"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="row-move" data-id="' + esc(row.id) + '" data-dir="up" title="위로"' + (i === 0 ? ' disabled' : '') + '><i class="ti ti-chevron-up"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="row-move" data-id="' + esc(row.id) + '" data-dir="down" title="아래로"' + (i === r.rows.length - 1 ? ' disabled' : '') + '><i class="ti ti-chevron-down"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="row-edit" data-id="' + esc(row.id) + '" title="대분류·행 이름·메모"><i class="ti ti-pencil"></i></button>'
        + '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon text-purple" data-action="split-add" data-row="' + esc(row.id) + '" title="이 행부터 분기점"' + (r.unitCount < 2 ? ' disabled' : '') + '><i class="ti ti-git-branch"></i></button>'
        + (canClose ? '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon text-primary" data-action="split-close" data-row="' + esc(row.id) + '" title="이 행부터 공통 (앞 행에서 분기 합침)"><i class="ti ti-arrows-join"></i></button>' : '')
        + '<button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="row-remove" data-id="' + esc(row.id) + '" title="행 삭제"><i class="ti ti-x"></i></button></div>';
    }
    return html;
  }
  /* i 행에 걸쳐 있으면서 그 앞에서 시작한 분기점이 있으면 "이 행부터 공통" 가능 */
  function canCloseAt(sheet, i) { return (sheet.splits || []).some(function (s) { var rg = SH.range(sheet, s); return rg.from < i && i <= rg.to; }); }
  function stepCellHtml(s, leaf, row, i, pg) {
    var r = state.run, active = r.status === 'active' && !ro(), isCur = !!(pg.current && pg.current.cell.id === s.id), edit = editing();
    var hasActual = Object.keys(s.actual || {}).length > 0;
    var html = '<div class="step-cell">'
      + '<div class="d-flex justify-content-between align-items-start gap-2"><div class="min-w-0"><b class="step-name">' + esc(s.name) + '</b>' + (s.equipment ? '<div class="small text-secondary">' + esc(s.equipment) + '</div>' : '') + '</div>'
      + '<span class="badge ' + STEP_CLS[s.status] + ' text-nowrap">' + esc(S.STEP_STATUS[s.status]) + '</span></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-6 param-cell"><div class="subheader">계획</div>' + P.summary(s.fields, s.planned) + '</div><div class="col-md-6 param-cell"><div class="subheader">실제</div>' + (hasActual ? P.summary(s.fields, s.actual, s.planned) : '<span class="text-secondary">-</span>') + '</div></div>';
    if (s.operator || s.date || s.result || s.issues || s.note || (s.photos && s.photos.length)) {
      html += '<div class="small mt-1">' + (s.operator ? '<span class="fw-medium">' + esc(s.operator) + '</span>' + (s.team ? ' <span class="text-secondary">(' + esc(s.team) + ')</span>' : '') : '') + (s.date ? ' <span class="text-secondary">· ' + esc(s.date) + '</span>' : '')
        + (s.result ? '<div>' + esc(s.result) + '</div>' : '') + (s.issues ? '<div class="text-red"><i class="ti ti-alert-triangle"></i> ' + esc(s.issues) + '</div>' : '') + (s.note ? '<div class="text-secondary">' + esc(s.note) + '</div>' : '') + (s.photos && s.photos.length ? '<div class="text-secondary"><i class="ti ti-photo"></i> ' + s.photos.length + '장</div>' : '') + '</div>';
    }
    html += '<div class="d-flex flex-wrap gap-1 mt-2">';
    if (edit) {
      html += '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="cell-edit" data-id="' + esc(s.id) + '" title="계획 조건·이름 수정"><i class="ti ti-adjustments"></i></button>'
        + (s.status === 'pending' ? '<button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="cell-clear" data-row="' + esc(row.id) + '" data-leaf="' + esc(leaf.id) + '" title="이 칸 비우기 (이 분기는 이 행을 건너뜀)"><i class="ti ti-x"></i></button>' : '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="step-reopen" data-id="' + esc(s.id) + '" title="대기로 되돌리기"><i class="ti ti-arrow-back-up"></i></button>');
    } else if (active && !S.TERMINAL[s.status]) {
      html += '<button type="button" class="btn btn-sm btn-success" data-action="step-quick" data-id="' + esc(s.id) + '" title="계획값 그대로 오늘 완료로 기록"><i class="ti ti-check me-1"></i>완료</button><button type="button" class="btn btn-sm' + (isCur ? ' btn-primary' : '') + '" data-action="step-open" data-id="' + esc(s.id) + '"><i class="ti ti-pencil me-1"></i>기록…</button>';
    } else {
      html += '<button type="button" class="btn btn-sm" data-action="step-open" data-id="' + esc(s.id) + '">' + (ro() ? '기록 보기' : S.TERMINAL[s.status] ? '기록 보기 · 수정' : '기록…') + '</button>';
    }
    return html + '</div></div>';
  }
  function skipHtml(leaf, row, i) {
    return '<div class="cell-skip-text"><i class="ti ti-arrow-narrow-down"></i> 건너뜀</div>' + (editing() ? '<button type="button" class="btn btn-sm mt-1" data-action="cell-set" data-row="' + esc(row.id) + '" data-leaf="' + esc(leaf.id) + '"><i class="ti ti-plus me-1"></i>모듈</button>' : '');
  }
  function branchHeadHtml(leaf, split) {
    var r = state.run;
    return '<div class="d-flex justify-content-between align-items-center gap-1 flex-wrap"><div><i class="ti ti-git-branch me-1"></i><b>' + esc(leaf.name) + '</b> <span class="small">' + leaf.count + ' ' + esc(r.unitLabel) + '</span></div>'
      + (editing() ? '<span class="d-flex gap-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="split-edit" data-id="' + esc(split.id) + '" title="분기 이름·수량·범위 수정"><i class="ti ti-adjustments"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="split-remove" data-id="' + esc(split.id) + '" title="분기점 삭제 (분기 셀은 하나로 합쳐짐)"><i class="ti ti-x"></i></button></span>' : '') + '</div>';
  }
  function splitLabelHtml(split, i) { var r = SH.range(state.run, split); return '<i class="ti ti-git-branch text-purple"></i> <b>' + esc(split.name || '분기점') + '</b><div class="small text-secondary">' + (r.from + 1) + '~' + (split.toRowId ? (r.to + 1) : '끝') + '행 · ' + split.branches.map(function (b) { return esc(b.name) + ' ' + b.count; }).join(' / ') + '</div>'; }
  function mergeHtml(split) { return '<i class="ti ti-arrows-join"></i> 합침'; }
  function mergeLabelHtml(split) { return '<i class="ti ti-arrows-join text-primary"></i> <b>' + esc(split.name || '분기') + '</b> 끝 · 다시 공통'; }
  function sheetTable(r, pg) {
    return SV.table(r, { units: r.units, unitLabel: r.unitLabel, rowHead: rowHeadHtml, cell: function (c, leaf, row, i) { return stepCellHtml(c, leaf, row, i, pg); }, skip: skipHtml, head: branchHeadHtml, merge: mergeHtml, splitLabel: splitLabelHtml, mergeLabel: mergeLabelHtml,
      cellClass: function (c) { return 'st-' + c.status + (pg.current && pg.current.cell.id === c.id ? ' is-current' : ''); } });
  }
  function renderPalette() {
    var r = state.run, dom = r.domain;
    var mods = state.modules.filter(function (m) { return m.active !== false; });
    var domOrder = DOMAINS.filter(function (d) { return d.id === dom; }).concat(DOMAINS.filter(function (d) { return d.id !== dom; }));
    var modOpts = domOrder.map(function (d) { var inD = mods.filter(function (m) { return m.domain === d.id; }); return CATS.map(function (c) { var ms = inD.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc((d.id === dom ? '' : d.short + ' · ') + c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + (m.equipment ? ' — ' + esc(m.equipment) : '') + '</option>'; }).join('') + '</optgroup>' : ''; }).join(''); }).join('');
    var flows = state.flows.filter(function (f) { return f.active !== false; });
    var fo = flows.filter(function (f) { return f.domain === dom; }).concat(flows.filter(function (f) { return f.domain !== dom; }));
    var flowOpts = fo.map(function (f) { var st = SH.stats(f); return '<option value="' + esc(f.id) + '">' + (f.domain !== dom ? '[' + esc(domainInfo(f.domain).short) + '] ' : '') + esc(f.name) + ' (' + st.rows + '행' + (st.splits ? ' · 분기 ' + st.splits + ' · ' + esc(f.unitLabel) + ' ' + f.unitCount : '') + ')' + (f.seed ? ' · 기본 제공' : f.ownerName ? ' · ' + esc(f.ownerName) : '') + '</option>'; }).join('');
    return '<div class="card mb-3 border-purple"><div class="card-body"><div class="d-flex align-items-center flex-wrap gap-2 mb-2"><i class="ti ti-books text-purple"></i><b>라이브러리에서 추가</b><span class="text-secondary small">모듈은 <b>공통 행(큰 스텝)</b>으로 끝에 붙습니다. 끝까지 열린 분기점이 있으면 그 앞 행에서 합쳐집니다(분기마다 따로 넣으려면 <i class="ti ti-adjustments"></i> 상세 추가에서 "모든 분기"). 흐름 복사는 행·분기점을 그대로 가져오며 빈 런이면 수량도 흐름에 맞춥니다. 분기점은 행의 <i class="ti ti-git-branch"></i>, 합침은 행의 <i class="ti ti-arrows-join"></i> 버튼.</span></div>'
      + '<div class="row g-2"><div class="col-lg-6"><label class="form-label">모듈 <span class="form-label-description">끝에 공통 행 추가</span></label><div class="input-group"><select class="form-select" id="pal-module">' + modOpts + '</select><button type="button" class="btn btn-primary" data-action="pal-module"><i class="ti ti-plus me-1"></i>행 추가</button><button type="button" class="btn" data-action="pal-module-detail" title="대분류·이름·계획 조건·분기 지정 후 추가"><i class="ti ti-adjustments"></i></button></div></div>'
      + '<div class="col-lg-6"><label class="form-label">흐름 통째로 복사 <span class="form-label-description">라이브러리 런시트 템플릿</span></label><div class="input-group"><select class="form-select" id="pal-flow"' + (flowOpts ? '' : ' disabled') + '>' + (flowOpts || '<option value="">흐름 없음</option>') + '</select><button type="button" class="btn" data-action="pal-flow"' + (flowOpts ? '' : ' disabled') + '><i class="ti ti-copy me-1"></i>복사</button></div></div></div></div></div>';
  }
  function renderSheet() {
    var r = state.run, pg = S.progress(r), edit = editing();
    var html = edit ? renderPalette() : '';
    if (!r.rows.length) return html + '<div class="card mb-3">' + empty('list', '아직 행(스텝)이 없습니다', edit ? '위의 라이브러리에서 모듈을 행으로 추가하거나 흐름을 통째로 복사하세요.' : '"시트 편집"을 눌러 라이브러리에서 모듈·흐름을 넣으세요.') + (!edit && !ro() ? '<div class="text-center pb-4"><button type="button" class="btn btn-primary" data-action="toggle-edit"><i class="ti ti-list-details me-1"></i>시트 편집</button></div>' : '') + '</div>';
    html += '<div class="card mb-3"><div class="table-responsive">' + sheetTable(r, pg) + '</div>';
    if (edit) html += '<div class="card-footer d-flex flex-wrap gap-2"><button type="button" class="btn btn-sm" data-action="row-insert" data-index="end"><i class="ti ti-plus me-1"></i>끝에 행 추가 (조건 지정)</button><button type="button" class="btn btn-sm" data-action="split-add"' + (r.unitCount < 2 ? ' disabled title="수량이 1이라 나눌 수 없습니다"' : '') + '><i class="ti ti-git-branch me-1"></i>분기점 추가</button><span class="text-secondary small ms-auto">행 = 큰 스텝(대분류). 분기 구간에서도 행은 맞춰지며, 비운 칸은 그 분기가 건너뜁니다.</span></div>';
    return html + '</div>';
  }
  function renderDetail() {
    var r = state.run, pg = S.progress(r), cur = pg.current, active = r.status === 'active' && !ro(), st = SH.stats(r);
    var html = '';
    if (r.archived) html += '<div class="alert alert-info py-2 px-3"><i class="ti ti-archive me-1"></i><b>아카이브된 런</b> — 모든 구성원에게 공개된 읽기 전용 런시트입니다. ' + esc(r.team) + ' · ' + esc(r.owner) + ' · ' + fmtDate(r.archivedAt) + ' 올림.' + (r.isOwner ? ' 고치려면 더 보기에서 아카이브에서 내리세요.' : '') + '</div>';
    else if (ro()) html += '<div class="alert alert-secondary py-2 px-3"><i class="ti ti-lock me-1"></i>읽기 전용입니다.</div>';
    html += '<div class="card mb-3"><div class="card-body"><div class="row g-3 align-items-center">'
      + '<div class="col-lg-7"><div class="text-secondary small tnum">' + esc(r.code) + ' ' + domainBadge(r.domain) + ' <span class="badge ' + RUN_CLS[r.status] + '">' + esc(S.RUN_STATUS[r.status]) + '</span>' + (r.archived ? ' <span class="badge bg-teal-lt">아카이브</span>' : '') + (r.flowName ? ' · 흐름 <b>' + esc(r.flowName) + '</b> 복사' : ' · 직접 구성') + '</div>'
      + '<h2 class="mb-1">' + esc(r.title) + '</h2>'
      + '<div class="datagrid run-meta">' + U.dg('팀', esc(r.team || '-')) + U.dg('담당자', esc(r.owner || '-')) + U.dg('시료 / 로트', esc(r.sample || '-')) + U.dg(r.unitLabel + ' 수량', r.unitCount + ' (' + esc(r.units.join(', ')) + ')') + U.dg('기판 · 재료', esc(r.substrate || '-')) + U.dg('시작', fmtDate(r.startedAt)) + (r.endedAt ? U.dg('종료', fmtDate(r.endedAt)) : '') + '</div>'
      + (r.goal ? '<div class="mt-2 small"><i class="ti ti-target me-1 text-primary"></i>' + esc(r.goal) + '</div>' : '') + (r.note ? '<div class="mt-1 small text-secondary">' + esc(r.note) + '</div>' : '') + '</div>'
      + '<div class="col-lg-5"><div class="d-flex justify-content-between small mb-1"><span>' + pg.done + ' 완료' + (pg.skipped ? ' · ' + pg.skipped + ' 건너뜀' : '') + (pg.failed ? ' · <span class="text-red">' + pg.failed + ' 실패</span>' : '') + ' / ' + pg.total + ' 스텝 · ' + st.rows + '행' + (st.splits ? ' · 분기점 ' + st.splits : '') + '</span><span class="tnum">' + pg.pct + '%</span></div>'
      + '<div class="progress progress-sm mb-3"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-secondary" style="width:' + Math.round(pg.skipped / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div>'
      + '<div class="d-flex flex-wrap gap-2">'
      + (active && cur ? '<button type="button" class="btn btn-primary" data-action="step-open" data-id="' + esc(cur.cell.id) + '"><i class="ti ti-pencil me-1"></i>' + (SH.idx(r, cur.row.id) + 1) + '. ' + esc(cur.cell.name) + (cur.leaf.name ? ' (' + esc(cur.leaf.name) + ')' : '') + ' 기록</button>' : '')
      + (active && pg.allDone ? '<button type="button" class="btn btn-success" data-action="run-status" data-status="done"><i class="ti ti-flag-check me-1"></i>런 완료 처리</button>' : '')
      + (!ro() ? '<button type="button" class="btn' + (state.editSheet ? ' btn-purple' : '') + '" data-action="toggle-edit"><i class="ti ti-list-details me-1"></i>' + (state.editSheet ? '시트 편집 끝' : '시트 편집 · 라이브러리') + '</button>' : '')
      + '<button type="button" class="btn" data-action="print"><i class="ti ti-printer me-1"></i>인쇄 · PPT</button>'
      + '<button type="button" class="btn" data-action="csv"><i class="ti ti-file-spreadsheet me-1"></i>CSV</button>'
      + '<button type="button" class="btn" data-action="run-more"><i class="ti ti-dots"></i></button>'
      + '</div></div></div></div></div>';
    if (editing()) html += '<div class="alert alert-info py-2 px-3"><i class="ti ti-info-circle me-1"></i><b>시트 편집 모드</b> — 행(큰 스텝) 추가·순서·대분류, 분기별 셀(모듈·계획 조건), 분기점 범위·수량을 바꿉니다. 모든 변경은 변경 이력에 남습니다.</div>';
    html += renderSheet();
    var logs = state.logs.filter(function (l) { return state.logFilter === 'all' || (state.logFilter === 'sheet' ? l.action.indexOf('sheet-') === 0 : l.action.indexOf('sheet-') !== 0); });
    html += '<div class="card"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>변경 이력 <span class="text-secondary fw-normal">' + state.logs.length + '건</span></h3><div class="card-actions"><div class="btn-group">' + [['all', '전체'], ['work', '작업 로그'], ['sheet', '시트 수정']].map(function (o) { return '<button type="button" class="btn btn-sm' + (state.logFilter === o[0] ? ' active' : '') + '" data-action="log-filter" data-filter="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div></div></div>';
    if (!logs.length) html += '<div class="card-body text-secondary small">이력이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:480px;overflow:auto"><table class="table table-sm table-vcenter card-table"><thead><tr><th class="w-1">일시</th><th class="w-1">공정 일자</th><th class="w-1">동작</th><th class="w-1">행 · 분기</th><th class="w-1">누가</th><th>내용</th></tr></thead><tbody>' + logs.map(function (l) { return '<tr><td class="text-nowrap text-secondary">' + fmtDateTime(l.at) + '</td><td class="text-nowrap">' + esc(l.date || '') + '</td><td><span class="badge ' + actionCls(l.action) + '">' + esc(S.ACTIONS[l.action] || l.action) + '</span></td><td class="text-nowrap">' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) + (l.branch ? '<br><span class="step-group">' + esc(l.branch) + '</span>' : '') : '-') + '</td><td class="text-nowrap">' + esc(l.who || '-') + (l.team ? '<br><span class="text-secondary small">' + esc(l.team) + '</span>' : '') + '</td><td class="small">' + esc(l.detail) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return html + '</div>';
  }

  /* ---------- 인쇄 · PPT ---------- */
  function subtitle() { var r = state.run; return [domainInfo(r.domain).label, r.team, r.owner, r.sample ? '시료 ' + r.sample : '', r.unitLabel + ' ' + r.unitCount, fmtDate(r.startedAt) + (r.endedAt ? ' ~ ' + fmtDate(r.endedAt) : ''), r.flowName].filter(Boolean).join(' · '); }
  function renderPrint() {
    var r = state.run, plan = state.printMode === 'plan';
    var html = '<div class="rs-print-toolbar d-print-none"><button type="button" class="btn" data-action="print-back"><i class="ti ti-arrow-left me-1"></i>돌아가기</button>'
      + '<div class="btn-group"><button type="button" class="btn' + (plan ? ' active' : '') + '" data-action="print-mode" data-mode="plan">계획 (런시트)</button><button type="button" class="btn' + (!plan ? ' active' : '') + '" data-action="print-mode" data-mode="actual">실제 기록</button></div>'
      + '<button type="button" class="btn btn-primary" data-action="pptx"><i class="ti ti-presentation me-1"></i>PPT 한 장 (.pptx)</button><button type="button" class="btn" data-action="print-now"><i class="ti ti-printer me-1"></i>인쇄 / PDF</button><span class="text-secondary small">첫 열 = Step(대분류), 나머지 열 = ' + esc(r.unitLabel) + '. 분기 구간은 분기별로 나란히, 비운 칸은 건너뜀.</span></div>';
    html += '<div class="rs-print"><div class="rs-head"><h1>공정 런시트 <span>Process Run Sheet · ' + (plan ? '계획' : '실제 기록') + '</span></h1><div class="rs-code">' + esc(r.code) + '</div></div>'
      + '<div class="rs-meta"><div><b>제목</b>' + esc(r.title) + '</div><div><b>분류</b>' + esc(domainInfo(r.domain).label) + '</div><div><b>팀 / 담당</b>' + esc(r.team) + ' / ' + esc(r.owner) + '</div><div><b>시료</b>' + esc(r.sample || '') + '</div>'
      + '<div><b>' + esc(r.unitLabel) + '</b>' + r.unitCount + ' (' + esc(r.units.join(', ')) + ')</div><div><b>기판 · 재료</b>' + esc(r.substrate || '') + '</div><div><b>흐름</b>' + esc(r.flowName || '직접 구성') + '</div><div><b>시작 / 출력</b>' + fmtDate(r.startedAt) + ' / ' + fmtDate(new Date().toISOString()) + '</div></div>'
      + (r.goal ? '<div class="rs-goal"><b>목표 · 메모</b> ' + esc(r.goal) + '</div>' : '');
    html += SV.table(r, { tableClass: 'rs-split', units: r.units, unitLabel: r.unitLabel,
      rowHead: function (row, i) { return '<b>' + (i + 1) + '. ' + esc(row.name) + '</b><div class="g">' + esc(P.catInfo(row.category).label) + (row.note ? ' · ※ ' + esc(row.note) : '') + '</div>'; },
      cell: function (s) { var vals = plan ? s.planned : s.actual; var mark = plan ? '' : (s.status === 'done' ? '✓ ' : s.status === 'failed' ? '✗ ' : s.status === 'skipped' ? '→ ' : ''); return '<b>' + mark + esc(s.name) + '</b>' + (s.equipment ? ' <span class="g">' + esc(s.equipment) + '</span>' : '') + '<div>' + esc(P.text(s.fields, vals, ' · ')) + '</div>' + (plan ? '' : '<div class="g">' + esc([s.operator, s.date, s.result, s.issues ? '⚠ ' + s.issues : '', s.note].filter(Boolean).join(' · ')) + '</div>'); },
      cellClass: function (s) { return plan ? '' : 'st-' + s.status; },
      skip: function () { return '<span class="g">— 건너뜀</span>'; },
      head: function (leaf) { return '<b>' + esc(leaf.name) + '</b> <span class="g">' + leaf.count + ' ' + esc(r.unitLabel) + '</span>'; },
      merge: function () { return '<span class="g">↓ 합침</span>'; },
      splitLabel: function (sp) { return '<b>분기점</b> <span class="g">' + esc(sp.name || '') + '</span>'; }, mergeLabel: function (sp) { return '<span class="g">합침 · ' + esc(sp.name || '') + '</span>'; } });
    var sheetLogs = state.logs.filter(function (l) { return l.action.indexOf('sheet-') === 0 || l.action === 'run-status' || l.action === 'run-edit'; });
    if (!plan && sheetLogs.length) html += '<div class="rs-sub">런시트 변경 이력</div><table class="rs-logs"><thead><tr><th style="width:12%">일시</th><th style="width:12%">동작</th><th style="width:16%">행</th><th style="width:10%">누가</th><th>내용</th></tr></thead><tbody>' + sheetLogs.slice().reverse().map(function (l) { return '<tr><td>' + fmtDateTime(l.at) + '</td><td>' + esc(S.ACTIONS[l.action] || l.action) + '</td><td>' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) : '-') + '</td><td>' + esc(l.who || '') + '</td><td>' + esc(l.detail) + '</td></tr>'; }).join('') + '</tbody></table>';
    if (plan) html += '<div class="rs-sub">런시트 변경 기록 (손으로 기입)</div><table class="rs-logs"><thead><tr><th style="width:12%">일시</th><th style="width:16%">행 / 분기</th><th>변경 내용 · 사유</th><th style="width:12%">서명</th></tr></thead><tbody>' + '<tr class="blank"><td></td><td></td><td></td><td></td></tr>'.repeat(3) + '</tbody></table>';
    html += '<div class="rs-foot"><span>' + esc(CFG.labName || 'DSIL') + ' · ' + esc(CFG.university || 'KAIST') + '</span><span>' + esc(subtitle()) + '</span></div></div>';
    return html;
  }
  function exportPptx() {
    var r = state.run;
    toast('PPT 를 만드는 중…');
    return window.DSILPptx.exportRun({ run: r, layout: SH.layout(r), mode: state.printMode, text: P.text, catLabel: function (c) { return P.catInfo(c).label; }, cfg: CFG.pptx || {}, subtitle: subtitle(), footer: (CFG.labName || 'DSIL') + ' · 공정 런시트 (' + (state.printMode === 'plan' ? '계획' : '실제 기록') + ') · ' + fmtDate(new Date().toISOString()) })
      .then(function () { toast('PPT 파일을 내려받았습니다.'); });
  }
  function exportCSV() {
    var r = state.run;
    var head = ['행', '대분류', '행 이름', '분기', '공정', '장비', '상태', '작업자', '팀', '공정 일자', '계획 조건', '실제 조건', '결과', '특이사항', '비고'];
    var lines = [head.map(csvCell).join(',')];
    SH.eachCell(r, function (s, row, leaf, i) { lines.push([i + 1, P.catInfo(row.category).label, row.name, leaf.path.join(' › '), s.name, s.equipment, S.STEP_STATUS[s.status], s.operator, s.team, s.date || '', P.text(s.fields, s.planned), P.text(s.fields, s.actual), s.result, s.issues, s.note].map(csvCell).join(',')); });
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
  function stepDialog(at) {
    var s = at.cell, m = me(), readOnly = ro(), actual = Object.keys(s.actual || {}).length ? s.actual : s.planned, seq = at.index + 1;
    var st = s.status === 'pending' ? 'done' : s.status;
    state.dialogStep = s;
    var body = '<div class="d-flex flex-wrap justify-content-between gap-2 mb-2"><div><span class="step-num me-1">' + seq + '</span>' + P.catBadge(at.row.category) + ' <b>' + esc(at.row.name) + '</b>' + (at.leaf.path.length ? ' · <span class="step-group">' + esc(at.leaf.path.join(' › ')) + '</span>' : '') + (s.name !== at.row.name ? ' <span class="text-secondary">› ' + esc(s.name) + '</span>' : '') + '</div><div class="small text-secondary">' + (s.equipment ? esc(s.equipment) : '') + '</div></div>'
      + (at.row.note ? '<div class="alert alert-info py-1 px-2 small mb-2"><i class="ti ti-note me-1"></i>' + esc(at.row.note) + '</div>' : '')
      + (s.checklist && s.checklist.length ? '<div class="small mb-2 checklist"><div class="subheader mb-1">확인 사항</div>' + s.checklist.map(function (c) { return '<label class="form-check mb-0"><input class="form-check-input" type="checkbox"' + (readOnly ? ' disabled' : '') + '><span class="form-check-label">' + esc(c) + '</span></label>'; }).join('') + '</div>' : '')
      + '<fieldset' + (readOnly ? ' disabled' : '') + '>'
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label required">작업자</label><input type="text" class="form-control" name="operator" required value="' + esc(s.operator || m.name) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(s.team || m.team) + '" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div>'
      + '<div class="col-md-4"><label class="form-label required">공정 일자</label><input type="date" class="form-control" name="date" required value="' + esc(s.date || localDate(new Date().toISOString())) + '"></div></div>'
      + '<div class="d-flex align-items-center justify-content-between mt-3 mb-1"><div class="subheader mb-0">실제 공정 조건 <span class="text-secondary fw-normal text-lowercase">계획값이 채워져 있으니 다른 것만 고치세요</span></div>' + (readOnly ? '' : '<button type="button" class="btn btn-sm btn-ghost-secondary" data-action="fill-planned"><i class="ti ti-refresh me-1"></i>계획값으로</button>') + '</div>'
      + '<div id="param-box">' + P.inputs(s.fields, actual, { planned: s.planned, optional: true }) + '</div>'
      + '<div class="row g-2 mt-2"><div class="col-md-6"><label class="form-label">결과 · 관찰</label><textarea class="form-control" name="result" rows="2" placeholder="두께, 패턴 상태, 수율, 측정 요약">' + esc(s.result) + '</textarea></div>'
      + '<div class="col-md-6"><label class="form-label">특이사항 · 이상</label><textarea class="form-control" name="issues" rows="2" placeholder="장비 이상, 조건 이탈, 재작업 사유">' + esc(s.issues) + '</textarea></div></div>'
      + '<div class="mt-2"><label class="form-label">비고</label><input type="text" class="form-control" name="note" value="' + esc(s.note) + '" autocomplete="off"></div>'
      + '<div class="mt-3"><div class="subheader mb-1">사진 <span class="text-secondary fw-normal">OM 이미지, 소자 사진 (최대 ' + PH.maxPerStep + '장)</span></div><div class="photo-strip" id="photo-strip">' + (s.photos || []).map(function (k) { return thumbHtml(k); }).join('') + '</div><input type="hidden" name="photos" value="' + esc((s.photos || []).join(',')) + '">' + (readOnly ? '' : '<label class="btn btn-sm mt-2 mb-0"><i class="ti ti-camera me-1"></i>사진 추가<input type="file" id="photo-input" accept="image/*" multiple hidden></label>') + '</div>'
      + '<div class="subheader mt-3 mb-1">이 스텝의 상태</div><div class="form-selectgroup">' + [['done', '완료', 'circle-check', 'green'], ['skipped', '건너뜀', 'player-skip-forward', 'secondary'], ['failed', '실패', 'alert-triangle', 'red'], ['pending', '대기', 'clock', 'secondary']].map(function (o) { return '<label class="form-selectgroup-item"><input type="radio" name="status" value="' + o[0] + '" class="form-selectgroup-input"' + (st === o[0] ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-' + o[2] + ' text-' + o[3] + ' me-1"></i>' + o[1] + '</span></label>'; }).join('') + '</div>'
      + '<div class="form-hint" data-show-if="status=skipped">건너뛴 이유를 특이사항에 적어 주세요.</div><div class="form-hint" data-show-if="status=failed">실패 원인·조치를 특이사항에 적어 주세요. 재작업은 시트 편집에서 행을 추가합니다.</div></fieldset>';
    var p = dialog({ title: '스텝 기록 · ' + seq + '. ' + s.name, bodyHtml: body, okLabel: readOnly ? '닫기' : '저장', size: 'lg', hideCancel: readOnly, submit: readOnly ? null : function (v) {
      var photos = v.photos ? v.photos.split(',').filter(Boolean) : [];
      return store.stepLog(state.run.id, s.id, { status: v.status, operator: v.operator, team: v.team, date: v.date, actual: P.read(s.fields, v), result: v.result, issues: v.issues, note: v.note, photos: photos }, { name: v.operator, team: v.team });
    } });
    loadThumbs();
    return p.then(function (v) { state.dialogStep = null; if (!v || readOnly) return null; return v; });
  }
  function moduleOptions(domain, showAll) {
    var mods = state.modules.filter(function (m) { return m.active !== false && (showAll || m.domain === domain); });
    var html = CATS.map(function (c) { var ms = mods.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc(c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + (m.domain !== domain ? ' [' + esc(domainInfo(m.domain).short) + ']' : '') + (m.equipment ? ' — ' + esc(m.equipment) : '') + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
    html += mods.filter(function (m) { return !CATS.some(function (c) { return c.id === m.category; }); }).map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    return { html: html, mods: mods };
  }
  /* 모듈 + 계획 조건 선택 블록 (행 추가·셀 채우기 공용) */
  function moduleBlock(domain, preModule) {
    var opt = moduleOptions(domain, false), optAll = moduleOptions(domain, true);
    return '<div class="d-flex align-items-end gap-2"><div class="flex-fill"><label class="form-label required">모듈 <span class="form-label-description">' + esc(domainInfo(domain).label) + '</span></label><select class="form-select" name="moduleId" required>' + (preModule ? opt.html.replace('value="' + preModule + '"', 'value="' + preModule + '" selected') : opt.html) + '</select></div><label class="form-check mb-2 text-nowrap"><input class="form-check-input" type="checkbox" name="showAll"><span class="form-check-label">다른 분류도</span></label></div>'
      + '<div data-show-if="showAll=true"><label class="form-label">모든 분류의 모듈</label><select class="form-select" name="moduleIdAll">' + optAll.html + '</select></div>'
      + '<div class="mt-2"><label class="form-label">스텝 이름 <span class="form-label-description">비우면 모듈 이름</span></label><input type="text" class="form-control" name="cellName" autocomplete="off" placeholder="예: Ti/Au 증착"></div>'
      + optAll.mods.map(function (m) { return '<div data-show-if="moduleId=' + esc(m.id) + '" class="mt-2 param-block"><div class="subheader mb-1">계획 조건</div>' + P.inputs(m.fields, S.defaults(m.fields), { optional: true }) + '</div>'; }).join('');
  }
  function readModuleSpec(v) {
    var modId = v.showAll && v.moduleIdAll ? v.moduleIdAll : v.moduleId, mod = modById(modId);
    return { moduleId: modId, name: v.cellName, params: P.read(mod ? mod.fields : [], v), mod: mod };
  }
  function rowInsertDialog(index, preModule) {
    var r = state.run, atEnd = index >= r.rows.length;
    var leaves = SH.leavesIfInserted(r, index);
    var body = '<div class="text-secondary small mb-2"><i class="ti ti-map-pin me-1"></i>위치: ' + (atEnd ? '끝' : (index + 1) + '행 앞') + (leaves.length > 1 ? ' · 분기 구간 (' + leaves.map(function (l) { return esc(l.name); }).join(' / ') + ')' : ' · 공통 구간') + '</div>'
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label">대분류</label>' + catSelect('category', '', true) + '</div><div class="col-md-8"><label class="form-label">행 이름 <span class="form-label-description">비우면 스텝 이름</span></label><input type="text" class="form-control" name="rowName" autocomplete="off" placeholder="예: 소스/드레인 형성"></div></div>'
      + (leaves.length > 1 ? '<div class="mt-2"><label class="form-label">어느 분기에 넣을까요</label><select class="form-select" name="target">' + (atEnd ? '<option value="__common">공통 행 — 열린 분기점을 이 행 앞에서 합치고 여기서부터 다시 공통</option>' : '') + '<option value="__all">모든 분기 (같은 셀을 분기마다 복사, 나중에 따로 고칠 수 있음)</option>' + leaves.map(function (l) { return '<option value="' + esc(l.id) + '">' + SV.leafLabel(l, r.unitLabel) + ' 에만 (다른 분기는 이 행을 건너뜀)</option>'; }).join('') + '</select></div>' : '')
      + '<div class="mt-2">' + moduleBlock(r.domain, preModule) + '</div>'
      + '<div class="mt-2"><label class="form-label">행 메모 <span class="form-label-description">지시·주의, 추가한 이유</span></label><input type="text" class="form-control" name="note" autocomplete="off"></div>';
    return dialog({ title: '런시트에 행(스텝) 추가', bodyHtml: body, okLabel: '추가', size: 'lg', submit: function (v) {
      var spec = readModuleSpec(v), cells = {};
      if (!spec.mod) throw new Error('모듈을 고르세요.');
      cells[v.target && v.target !== '__all' && v.target !== '__common' ? v.target : 'all'] = { moduleId: spec.moduleId, name: spec.name, params: spec.params };
      return store.rowInsert(r.id, { index: atEnd ? 'end' : index, common: !v.target || v.target === '__common', category: v.category || spec.mod.category, name: v.rowName, note: v.note, cells: cells });
    } });
  }
  function cellSetDialog(rowId, leafId) {
    var r = state.run, row = SH.rowById(r, rowId), i = SH.idx(r, rowId);
    var leaf = SH.leavesAt(r, i).filter(function (l) { return l.id === leafId; })[0];
    var body = '<div class="text-secondary small mb-2"><i class="ti ti-map-pin me-1"></i>' + (i + 1) + '행 "' + esc(row.name) + '" · ' + (leaf ? SV.leafLabel(leaf, r.unitLabel) : '') + '</div>' + moduleBlock(r.domain, '');
    return dialog({ title: '이 분기의 셀 채우기', bodyHtml: body, okLabel: '넣기', size: 'lg', submit: function (v) {
      var spec = readModuleSpec(v); if (!spec.mod) throw new Error('모듈을 고르세요.');
      return store.cellSet(r.id, rowId, leafId, { moduleId: spec.moduleId, name: spec.name, params: spec.params });
    } });
  }
  function cellEditDialog(at) {
    var s = at.cell;
    var body = '<div class="text-secondary small mb-2">' + (at.index + 1) + '행 "' + esc(at.row.name) + '"' + (at.leaf.path.length ? ' · <span class="step-group">' + esc(at.leaf.path.join(' › ')) + '</span>' : '') + '</div>'
      + '<div class="row g-2"><div class="col-md-8"><label class="form-label required">스텝 이름</label><input type="text" class="form-control" name="name" required value="' + esc(s.name) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">장비</label><input type="text" class="form-control" name="equipment" value="' + esc(s.equipment) + '" autocomplete="off"></div></div>'
      + '<div class="subheader mt-3 mb-1">계획 조건</div>' + P.inputs(s.fields, s.planned, { optional: true })
      + (S.TERMINAL[s.status] ? '<div class="form-hint mt-2">이미 끝난 스텝입니다. 계획 조건을 바꿔도 실제 기록은 그대로이며 변경 이력에 남습니다.</div>' : '');
    return dialog({ title: '계획 수정 · ' + (at.index + 1) + '. ' + s.name, bodyHtml: body, okLabel: '저장', size: 'lg', submit: function (v) { return store.cellEdit(state.run.id, s.id, { name: v.name, equipment: v.equipment, planned: P.read(s.fields, v) }); } });
  }
  function rowEditDialog(row) {
    var body = '<div class="row g-2"><div class="col-md-4"><label class="form-label required">대분류</label>' + catSelect('category', row.category, false) + '</div><div class="col-md-8"><label class="form-label required">행 이름</label><input type="text" class="form-control" name="name" required value="' + esc(row.name) + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">메모 <span class="form-label-description">시트에 표시되는 지시·주의</span></label><input type="text" class="form-control" name="note" value="' + esc(row.note) + '" autocomplete="off"></div>';
    return dialog({ title: '행 수정 · ' + (SH.idx(state.run, row.id) + 1) + '. ' + row.name, bodyHtml: body, okLabel: '저장', size: 'md', submit: function (v) { return store.rowEdit(state.run.id, row.id, { category: v.category, name: v.name, note: v.note }); } });
  }
  function splitAddDialog(preRowId) {
    var r = state.run;
    return dialog({ title: '분기점 추가', bodyHtml: SV.splitAddBody(r, r.unitLabel, preRowId), okLabel: '분기점 만들기', size: 'md', submit: function (v) { return store.splitAdd(r.id, SV.readSplitAdd(v)); } });
  }
  function splitEditDialog(split) {
    var r = state.run;
    return dialog({ title: '분기 수정 · ' + (split.name || '분기점'), bodyHtml: SV.splitEditBody(r, split, r.unitLabel), okLabel: '저장', size: 'md', submit: function (v) { return store.splitEdit(r.id, split.id, SV.readSplitEdit(v)); } });
  }
  function runEditDialog(r) {
    var units = CFG.unitLabels || [], custom = units.indexOf(r.unitLabel) < 0;
    var body = '<div class="row g-2"><div class="col-md-8"><label class="form-label required">제목</label><input type="text" class="form-control" name="title" required value="' + esc(r.title) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시작</label><input type="datetime-local" class="form-control" name="startedAt" value="' + toLocalInput(r.startedAt) + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(r.team) + '" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div><div class="col-md-4"><label class="form-label required">담당자</label><input type="text" class="form-control" name="owner" required value="' + esc(r.owner) + '" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시료 / 로트 ID</label><input type="text" class="form-control" name="sample" value="' + esc(r.sample) + '" autocomplete="off"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-3"><label class="form-label">단위</label><select class="form-select" name="unitLabel">' + units.map(function (u) { return '<option value="' + esc(u) + '"' + (u === r.unitLabel ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') + '<option value="__custom"' + (custom ? ' selected' : '') + '>직접 입력…</option></select><div data-show-if="unitLabel=__custom" class="mt-1"><input type="text" class="form-control" name="unitLabelCustom" value="' + esc(custom ? r.unitLabel : '') + '" autocomplete="off"></div></div>'
      + '<div class="col-md-2"><label class="form-label">수량</label><input type="number" class="form-control" name="unitCount" min="1" value="' + r.unitCount + '"' + ((r.splits || []).length ? ' disabled title="분기점이 있어 바꿀 수 없습니다"' : '') + '></div>'
      + '<div class="col-md-7"><label class="form-label">' + esc(r.unitLabel) + ' 이름 (' + r.unitCount + '개, 쉼표 구분)</label><input type="text" class="form-control" name="units" value="' + esc(r.units.join(', ')) + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">기판 · 재료</label><input type="text" class="form-control" name="substrate" value="' + esc(r.substrate) + '" autocomplete="off"></div>'
      + '<div class="mt-2"><label class="form-label">목표 · 메모</label><textarea class="form-control" name="goal" rows="2">' + esc(r.goal) + '</textarea></div><div class="mt-2"><label class="form-label">비고</label><input type="text" class="form-control" name="note" value="' + esc(r.note) + '" autocomplete="off"></div>';
    return dialog({ title: '런 정보 수정', bodyHtml: body, okLabel: '저장', size: 'lg', submit: function (v) {
      var patch = { title: v.title, startedAt: v.startedAt ? fromLocalInput(v.startedAt) : undefined, team: v.team, owner: v.owner, sample: v.sample, unitLabel: v.unitLabel === '__custom' ? v.unitLabelCustom : v.unitLabel, substrate: v.substrate, goal: v.goal, note: v.note };
      if (v.unitCount !== undefined && Number(v.unitCount) !== r.unitCount) patch.unitCount = v.unitCount; else patch.units = v.units;
      return store.updateRun(r.id, patch);
    } });
  }
  function moreDialog(r) {
    var active = r.status === 'active', finished = r.status === 'done' || r.status === 'aborted', owner = !!r.isOwner, editable = !ro();
    var items = [];
    if (editable) items.push(['run-edit', 'pencil', '런 정보 수정', '제목·팀·담당자·시료·단위·수량·기판 이름·목표']);
    items.push(['run-clone', 'copy', '이 런 복제해 내 런 만들기', '같은 런시트로 새 런 (실제값을 계획으로 가져올 수 있음)']);
    items.push(['run-to-flow', 'git-branch', '내 라이브러리 흐름으로 저장', '이 런의 행·분기·조건을 새 공정 흐름(템플릿)으로']);
    if (owner) {
      if (finished) items.push(r.archived ? ['run-unarchive', 'archive-off', '아카이브에서 내리기', '다시 나만 보게 하고 편집 가능'] : ['run-archive', 'archive', '아카이브에 올리기', '모든 구성원에게 공개 (읽기 전용)']);
      if (!r.archived) { items.push(active ? ['run-pause', 'player-pause', '보류', '잠시 멈춤 (기록 불가)'] : ['run-resume', 'player-play', '재개', '다시 진행 중으로']); if (!finished) items.push(['run-done', 'flag-check', '완료 처리', '모든 작업이 끝났을 때'], ['run-abort', 'circle-x', '중단', '사유를 남기고 중단']); }
      items.push(['run-delete', 'trash', '런 삭제', '기록·이력이 모두 지워집니다']);
    }
    return dialog({ title: r.code + ' · 더 보기', html: '<div class="list-group list-group-flush">' + items.map(function (i) { return '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-action="more-' + i[0] + '"><i class="ti ti-' + i[1] + ' ' + (i[0] === 'run-delete' || i[0] === 'run-abort' ? 'text-red' : 'text-primary') + '"></i><div><div class="fw-medium">' + i[2] + '</div><div class="small text-secondary">' + i[3] + '</div></div></button>'; }).join('') + '</div>', hideCancel: true, okLabel: '닫기', size: 'md' });
  }
  function cloneDialog(r) {
    var m = me();
    var body = '<div class="mb-2"><label class="form-label required">새 런 제목</label><input type="text" class="form-control" name="title" required value="' + esc(r.title) + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label">시료 / 로트</label><input type="text" class="form-control" name="sample" autocomplete="off"></div><div class="col-6"><label class="form-label">팀</label><input type="text" class="form-control" name="team" value="' + esc(m.team || r.team) + '" autocomplete="off"></div></div>'
      + '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="fromActual" checked><span class="form-check-label">완료된 스텝의 <b>실제 조건</b>을 새 런의 계획 조건으로</span></label><div class="form-hint">새 런은 내 런으로 만들어지고 담당자는 ' + esc(m.name) + ' 입니다.</div>';
    return dialog({ title: '런 복제', bodyHtml: body, okLabel: '복제', size: 'md', submit: function (v) { return store.cloneRun(r.id, { title: v.title, sample: v.sample, team: v.team, fromActual: !!v.fromActual }); } });
  }
  function toFlowDialog(r) {
    var body = '<div class="mb-2"><label class="form-label required">흐름 이름</label><input type="text" class="form-control" name="name" required value="' + esc(r.title) + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label">소자 종류</label><input type="text" class="form-control" name="device" autocomplete="off"></div><div class="col-6"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="런 ' + esc(r.code) + ' 에서 저장" autocomplete="off"></div></div>'
      + '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="fromActual" checked><span class="form-check-label">완료된 스텝의 실제 조건을 흐름의 계획 조건으로</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="dropSkipped" checked><span class="form-check-label">건너뛴 스텝은 빼기</span></label>'
      + '<div class="form-hint mt-2">행·분기점·수량(' + esc(r.unitLabel) + ' ' + r.unitCount + ')도 함께 저장됩니다. 라이브러리에서 내 흐름으로 보이고 나만 고칠 수 있습니다.</div>';
    return dialog({ title: '이 런을 공정 흐름으로 저장', bodyHtml: body, okLabel: '흐름 저장', size: 'md', submit: function (v) { return store.saveRunAsFlow(r.id, { name: v.name, device: v.device, description: v.description, fromActual: !!v.fromActual, dropSkipped: !!v.dropSkipped }); } });
  }
  function archivePrompt() {
    return confirmDlg({ title: '아카이브에 올릴까요?', message: '아카이브에 올리면 모든 구성원이 이 런시트를 볼 수 있습니다(읽기 전용). 올리지 않으면 나만 볼 수 있고, 나중에 더 보기에서 올릴 수 있습니다.', okLabel: '아카이브에 올리기' })
      .then(function (ok) { if (!ok) return false; return store.setArchived(state.run.id, true).then(function () { toast('아카이브에 올렸습니다.'); return true; }); });
  }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function done(msg) { return function (res) { if (res) { toast(msg); return refresh(); } }; }
  function openStep(id) {
    var at = findCell(id); if (!at) { toast('스텝을 찾을 수 없습니다.', true); return Promise.resolve(); }
    if (!ro() && state.run.status !== 'active' && !S.TERMINAL[at.cell.status]) { toast('런이 ' + S.RUN_STATUS[state.run.status] + ' 상태라 기록할 수 없습니다. 더 보기에서 재개하세요.', true); return Promise.resolve(); }
    return (ro() ? Promise.resolve(me()) : ensureTeam()).then(function (m) { if (!m) return null; return stepDialog(at); }).then(function (res) { if (res) { toast(res.status === 'done' ? '완료를 기록했습니다.' : S.STEP_STATUS[res.status] + ' 으로 저장했습니다.'); return refresh(); } });
  }
  function setStatus(status) {
    var r = state.run, pg = S.progress(r), pre = Promise.resolve('');
    if (status === 'done' && !pg.allDone) pre = confirmDlg({ title: '런 완료', message: '아직 끝나지 않은 스텝이 ' + (pg.total - pg.finished) + '개 있습니다. 그래도 완료 처리할까요?', okLabel: '완료' }).then(function (ok) { return ok ? '' : null; });
    if (status === 'aborted') pre = promptDlg({ title: '런 중단', message: '중단 사유를 남겨 주세요.', input: 'textarea', placeholder: '예: 시료 파손', okLabel: '중단', danger: true });
    pre.then(function (note) { if (note === null) return; return store.setRunStatus(r.id, status, note || '').then(function () { toast('런을 ' + S.RUN_STATUS[status] + ' 상태로 바꿨습니다.'); return reload().then(render); }).then(function () { if (status === 'done' || status === 'aborted') return archivePrompt().then(function () { return refresh(); }); }); }).catch(handleError);
  }
  function palAdd(kind) {
    var r = state.run, sel = $(kind === 'flow' ? '#pal-flow' : '#pal-module'); if (!sel || !sel.value) return;
    ensureTeam().then(function (m) {
      if (!m) return;
      if (kind === 'flow') return store.copyFlow(r.id, sel.value).then(function (run) { toast('흐름을 복사했습니다.' + (run.unitCount !== r.unitCount ? ' 수량을 ' + run.unitCount + '로 맞췄습니다.' : '')); return refresh(); });
      var mod = modById(sel.value), hadOpen = SH.openSplits(r).length > 0;
      return store.rowInsert(r.id, { index: 'end', common: true, category: mod ? mod.category : '', cells: { all: { moduleId: sel.value } } }).then(function () { toast('공통 행을 추가했습니다.' + (hadOpen ? ' 열린 분기점은 앞 행에서 합쳤습니다.' : '')); return refresh(); });
    }).catch(handleError);
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
    if (e.target.name === 'q' && e.target.closest('#list-filter')) { state.filter.q = e.target.value; var card = $('#list-filter').closest('.card'); var tmp = document.createElement('div'); tmp.innerHTML = renderList(); var next = card.nextElementSibling; while (next) { var n2 = next.nextElementSibling; next.remove(); next = n2; } Array.prototype.slice.call(tmp.children, 2).forEach(function (c) { card.parentNode.appendChild(c); }); }
  });
  document.addEventListener('submit', function (e) { if (e.target.getAttribute('id') === 'list-filter') { e.preventDefault(); render(); } });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id'), r = state.run;
    if (el.tagName === 'A') e.preventDefault();
    switch (action) {
      case 'refresh': refresh(); break;
      case 'step-open': openStep(id).catch(handleError); break;
      case 'step-quick':
        ensureTeam().then(function (m) { if (!m) return; return store.stepQuick(r.id, id).then(function (s) { toast(s.name + ' 을 계획대로 완료로 기록했습니다.'); return refresh(); }); }).catch(function (err) { if (/필수/.test(err.message)) { toast(err.message, true); openStep(id).catch(handleError); } else handleError(err); }); break;
      case 'step-reopen': confirmDlg({ title: '대기로 되돌리기', message: '이 스텝을 다시 대기 상태로 되돌릴까요? 기록된 값은 남고 이력에 기록됩니다.', okLabel: '되돌리기' }).then(function (ok) { if (!ok) return; return store.stepReopen(r.id, id).then(function () { toast('대기 상태로 되돌렸습니다.'); return refresh(); }); }).catch(handleError); break;
      case 'fill-planned': { var s0 = state.dialogStep, box = $('#param-box'); if (s0 && box) box.innerHTML = P.inputs(s0.fields, s0.planned, { planned: s0.planned, optional: true }); break; }
      case 'photo-remove': { var key = el.getAttribute('data-key'), hidden = $('#modal-form [name="photos"]'); if (hidden) hidden.value = hidden.value.split(',').filter(function (k) { return k && k !== key; }).join(','); var th = el.closest('.photo-thumb'); if (th) th.remove(); break; }
      case 'toggle-edit': state.editSheet = !state.editSheet; render(); break;
      case 'pal-module': palAdd('module'); break;
      case 'pal-flow': palAdd('flow'); break;
      case 'pal-module-detail': { var pm = $('#pal-module'); ensureTeam().then(function (m) { if (!m) return; return rowInsertDialog(r.rows.length, pm ? pm.value : '').then(done('행을 추가했습니다.')); }).catch(handleError); break; }
      case 'row-insert': { var ix = el.getAttribute('data-index'); ensureTeam().then(function (m) { if (!m) return; return rowInsertDialog(ix === 'end' ? r.rows.length : Number(ix) || 0, '').then(done('행을 추가했습니다.')); }).catch(handleError); break; }
      case 'row-remove': { var rr = SH.rowById(r, id); if (!rr) break; confirmDlg({ title: '행 삭제', message: (SH.idx(r, id) + 1) + '. ' + rr.name + ' 행을 런시트에서 뺄까요? 분기 셀도 함께 빠지며 변경 이력에 남습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.rowRemove(r.id, id).then(function () { toast('행을 뺐습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'row-move': store.rowMove(r.id, id, el.getAttribute('data-dir')).then(function () { return refresh(); }).catch(handleError); break;
      case 'row-edit': { var re = SH.rowById(r, id); if (!re) break; rowEditDialog(re).then(done('행을 수정했습니다.')).catch(handleError); break; }
      case 'cell-edit': { var ce = findCell(id); if (!ce) break; cellEditDialog(ce).then(done('계획을 수정했습니다.')).catch(handleError); break; }
      case 'cell-clear': { var rid = el.getAttribute('data-row'), lid = el.getAttribute('data-leaf'); confirmDlg({ title: '칸 비우기', message: '이 분기의 스텝을 빼면 이 분기는 이 행을 건너뜁니다. 계속할까요?', okLabel: '비우기', danger: true }).then(function (ok) { if (!ok) return; return store.cellClear(r.id, rid, lid).then(function () { toast('칸을 비웠습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'cell-set': { var rid2 = el.getAttribute('data-row'), lid2 = el.getAttribute('data-leaf'); ensureTeam().then(function (m) { if (!m) return; return cellSetDialog(rid2, lid2).then(done('셀을 채웠습니다.')); }).catch(handleError); break; }
      case 'split-add': ensureTeam().then(function (m) { if (!m) return; return splitAddDialog(el.getAttribute('data-row') || null).then(done('분기점을 추가했습니다. 분기마다 셀을 고치거나 비워서 건너뛰게 하세요.')); }).catch(handleError); break;
      case 'split-edit': { var sp = SH.splitById(r, id); if (!sp) break; splitEditDialog(sp).then(done('분기를 수정했습니다.')).catch(handleError); break; }
      case 'split-close': { var rc = SH.rowById(r, el.getAttribute('data-row')); if (!rc) break; var ic = SH.idx(r, rc.id); confirmDlg({ title: '이 행부터 공통', message: (ic + 1) + '. ' + rc.name + ' 행부터 다시 공통 행이 됩니다. 이 행에 걸친 분기점은 ' + ic + '행에서 끝나고, 이 행부터의 분기 셀은 첫 분기의 셀 하나로 합쳐집니다.', okLabel: '합치기' }).then(function (ok) { if (!ok) return; return store.splitClose(r.id, rc.id).then(function () { toast((ic + 1) + '행부터 공통으로 합쳤습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'split-remove': confirmDlg({ title: '분기점 삭제', message: '이 분기점을 지우면 범위 안 행의 분기 셀이 하나로 합쳐집니다(첫 분기의 셀만 남음). 진행된 스텝이 여럿이면 지울 수 없습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.splitRemove(r.id, id).then(function () { toast('분기점을 지웠습니다.'); return refresh(); }); }).catch(handleError); break;
      case 'log-filter': state.logFilter = el.getAttribute('data-filter'); render(); break;
      case 'csv': exportCSV(); break;
      case 'print': state.print = true; state.editSheet = false; render(); window.scrollTo(0, 0); break;
      case 'print-back': state.print = false; render(); break;
      case 'print-mode': state.printMode = el.getAttribute('data-mode'); render(); break;
      case 'print-now': window.print(); break;
      case 'pptx': exportPptx().catch(handleError); break;
      case 'run-status': setStatus(el.getAttribute('data-status')); break;
      case 'run-more': moreDialog(r).catch(handleError); break;
      case 'more-run-edit': U.closeAll(); runEditDialog(r).then(done('런 정보를 수정했습니다.')).catch(handleError); break;
      case 'more-run-clone': U.closeAll(); cloneDialog(r).then(function (run) { if (run) { toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.hash = '#id=' + run.id; } }).catch(handleError); break;
      case 'more-run-to-flow': U.closeAll(); toFlowDialog(r).then(function (res) { if (res) toast('흐름 "' + res.flow.name + '" 을 저장했습니다.' + (res.skipped ? ' (모듈 없는 스텝 ' + res.skipped + '개 제외)' : '')); }).catch(handleError); break;
      case 'more-run-archive': U.closeAll(); archivePrompt().then(function () { return refresh(); }).catch(handleError); break;
      case 'more-run-unarchive': U.closeAll(); store.setArchived(r.id, false).then(function () { toast('아카이브에서 내렸습니다.'); return refresh(); }).catch(handleError); break;
      case 'more-run-pause': U.closeAll(); setStatus('paused'); break;
      case 'more-run-resume': U.closeAll(); setStatus('active'); break;
      case 'more-run-done': U.closeAll(); setStatus('done'); break;
      case 'more-run-abort': U.closeAll(); setStatus('aborted'); break;
      case 'more-run-delete': U.closeAll(); confirmDlg({ title: '런 삭제', message: r.code + ' ' + r.title + ' 런과 모든 기록·이력을 지웁니다. 되돌릴 수 없습니다.', okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteRun(r.id).then(function () { toast('삭제했습니다.'); window.location.hash = ''; }); }).catch(handleError); break;
    }
  });

  window.addEventListener('hashchange', function () { readHash(); state.print = false; state.editSheet = false; refresh().then(afterLoad); });
  function afterLoad() {
    if (!state.run) return;
    if (state.autoEdit) { state.autoEdit = false; if (!ro()) { state.editSheet = true; render(); } try { history.replaceState(null, '', '#id=' + state.run.id); } catch (e) { /* ignore */ } }
    if (state.openStepId) { var id = state.openStepId; state.openStepId = null; try { history.replaceState(null, '', '#id=' + state.run.id); } catch (e) { /* ignore */ } openStep(id).catch(handleError); }
  }

  store.init().then(function () {
    if (!store.getSession()) { window.location.replace('../index.html?next=run'); return; }
    state.ready = true; readHash();
    store.onChange(function () { if (!store.getSession()) { window.location.replace('../index.html?next=run'); return; } reload().then(render).catch(handleError); });
    return refresh().then(afterLoad);
  }).catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
