/* =====================================================================
   DSIL Run Sheet – 홈: 팀·이름·분류·기간 필터, 팀별 진행 중인 런, 새 런 시작(팀·이름·기판 수량·분기 배분), 최근 활동
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDateTime = U.fmtDateTime, localDate = U.localDate, $ = U.$, toast = U.toast, dialog = U.dialog, empty = U.empty, stat = U.stat, toLocalInput = U.toLocalInput, readForm = U.readForm;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [{ id: 'device', label: '반도체 소자 공정', short: '소자' }, { id: 'package', label: '패키징 공정', short: '패키징' }];
  var PRESETS = [['7', '최근 7일'], ['30', '최근 30일'], ['90', '최근 90일'], ['year', '올해'], ['all', '전체']];
  var state = { ready: false, error: null, runs: [], flows: [], modules: [], logs: [], filter: { domain: '', team: '', who: '', preset: '90' } };

  function me() { return store.getMe(); }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function domainBadge(id) { var d = domainInfo(id); return '<span class="badge ' + (id === 'package' ? 'bg-indigo-lt' : 'bg-blue-lt') + '">' + esc(d.short) + '</span>'; }
  function runById(id) { return state.runs.filter(function (r) { return r.id === id; })[0] || null; }
  function rangeFrom(preset) {
    var now = new Date();
    if (preset === 'all') return null;
    if (preset === 'year') return localDate(new Date(now.getFullYear(), 0, 1).toISOString());
    var n = Number(preset) || 90; return localDate(new Date(now.getTime() - (n - 1) * 86400000).toISOString());
  }
  function teams() { var set = {}; (CFG.teams || []).forEach(function (t) { set[t] = 1; }); state.runs.forEach(function (r) { if (r.team) set[r.team] = 1; }); state.logs.forEach(function (l) { if (l.team) set[l.team] = 1; }); return Object.keys(set).sort(); }
  function names() { var set = {}; state.runs.forEach(function (r) { if (r.owner) set[r.owner] = 1; r.steps.forEach(function (s) { if (s.operator) set[s.operator] = 1; }); }); state.logs.forEach(function (l) { if (l.who) set[l.who] = 1; }); return Object.keys(set).sort(); }
  function runMatches(r) {
    var f = state.filter;
    if (f.domain && r.domain !== f.domain) return false;
    if (f.team && r.team !== f.team) return false;
    if (f.who && r.owner !== f.who && !r.steps.some(function (s) { return s.operator === f.who; })) return false;
    return true;
  }
  function logMatches(l) {
    var f = state.filter, r = runById(l.runId), from = rangeFrom(f.preset);
    if (f.domain && (!r || r.domain !== f.domain)) return false;
    if (f.team && (l.team || (r && r.team)) !== f.team) return false;
    if (f.who && l.who !== f.who) return false;
    if (from && (l.date || localDate(l.at)) < from) return false;
    return true;
  }

  function reload() {
    return Promise.all([store.listRuns(), store.listFlows(), store.listModules(), store.listLogs(null, 3000)]).then(function (r) { state.runs = r[0]; state.flows = r[1]; state.modules = r[2]; state.logs = r[3]; });
  }

  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var m = me();
    slot.innerHTML = '<button type="button" class="btn btn-sm' + (m.name ? '' : ' btn-outline-primary') + '" data-action="set-me" title="기록에 붙는 작업자 이름과 팀"><i class="ti ti-user me-1"></i>' + (m.name ? esc(m.name) + (m.team ? ' <span class="text-secondary">· ' + esc(m.team) + '</span>' : '') : '내 이름 · 팀 설정') + '</button>';
  }
  function meDialog() {
    var m = me();
    var body = '<div class="mb-2"><label class="form-label required">이름</label><input type="text" class="form-control" name="name" required value="' + esc(m.name) + '" placeholder="홍길동" autocomplete="off"></div>'
      + '<div class="mb-1"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(m.team) + '" placeholder="예: 2D 소자팀" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div>'
      + '<div class="form-hint">런·스텝 기록에 작업자와 팀으로 붙습니다. 이 브라우저에 기억됩니다.</div>';
    return dialog({ title: '내 이름 · 팀', bodyHtml: body, okLabel: '저장' }).then(function (v) { if (!v) return null; return store.setMe({ name: v.name, team: v.team }).then(function (saved) { renderChrome(); return saved; }); });
  }
  function ensureMe() { var m = me(); if (m.name && m.team) return Promise.resolve(m); return meDialog(); }

  function runCard(r) {
    var pg = S.progress(r), cur = pg.current;
    var last = state.logs.filter(function (l) { return l.runId === r.id; })[0];
    return '<div class="col-md-6 col-xl-4"><div class="card run-card h-100"><div class="card-body d-flex flex-column">'
      + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="text-secondary small tnum">' + esc(r.code) + ' ' + domainBadge(r.domain) + (r.sample ? ' · <b>' + esc(r.sample) + '</b>' : '') + '</div><h3 class="run-title mb-1"><a href="run/index.html#id=' + esc(r.id) + '" class="text-reset">' + esc(r.title) + '</a></h3>'
      + '<div class="text-secondary small">' + esc(r.team) + ' · ' + esc(r.owner) + ' · ' + esc(r.unitLabel) + ' ' + r.unitCount + ' · ' + fmtDate(r.startedAt) + '</div></div>'
      + '<span class="badge ' + (r.status === 'paused' ? 'bg-secondary-lt' : 'bg-blue-lt') + '">' + esc(S.RUN_STATUS[r.status] || r.status) + '</span></div>'
      + '<div class="mt-3"><div class="d-flex justify-content-between small mb-1"><span>' + pg.finished + ' / ' + pg.total + ' 스텝</span><span class="tnum">' + pg.pct + '%</span></div>'
      + '<div class="progress progress-sm"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-secondary" style="width:' + Math.round(pg.skipped / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div></div>'
      + (cur ? '<div class="mt-3 current-step"><div class="text-secondary small">다음 스텝' + (cur.branchPath && cur.branchPath.length ? ' · <span class="step-group">' + esc(cur.branchPath.join(' › ')) + '</span>' : '') + '</div><div class="d-flex align-items-center gap-2"><span class="step-num">' + cur.seq + '</span><div><div class="fw-medium">' + esc(cur.name) + '</div><div class="small text-secondary">' + esc(cur.equipment || '') + '</div></div></div></div>'
        : '<div class="mt-3 alert alert-success py-2 px-3 mb-0 small"><i class="ti ti-check me-1"></i>모든 스텝이 끝났습니다. 런시트에서 완료 처리하세요.</div>')
      + (last ? '<div class="small text-secondary mt-2"><i class="ti ti-history me-1"></i>' + fmtDateTime(last.at) + ' ' + esc(last.who || '') + ' · ' + esc(S.ACTIONS[last.action] || last.action) + (last.stepName ? ' · ' + esc(last.stepName) : '') + '</div>' : '')
      + '<div class="mt-auto pt-3 d-flex gap-2"><a href="run/index.html#id=' + esc(r.id) + '" class="btn btn-outline-primary"><i class="ti ti-clipboard-list me-1"></i>런시트</a>'
      + (cur ? '<a href="run/index.html#id=' + esc(r.id) + '&step=' + esc(cur.id) + '" class="btn btn-primary"><i class="ti ti-pencil me-1"></i>' + cur.seq + '. 기록</a>' : '<a href="run/index.html#id=' + esc(r.id) + '" class="btn btn-success"><i class="ti ti-flag-check me-1"></i>런 완료</a>')
      + '</div></div></div></div>';
  }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }

  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">초기화 오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    var f = state.filter, from = rangeFrom(f.preset);
    var runs = state.runs.filter(runMatches);
    var active = runs.filter(function (r) { return r.status === 'active' || r.status === 'paused'; });
    var finished = runs.filter(function (r) { return (r.status === 'done' || r.status === 'aborted') && (!from || localDate(r.endedAt || r.updatedAt) >= from); });
    var logs = state.logs.filter(logMatches);
    var people = {}; logs.forEach(function (l) { if (l.who) people[l.who] = 1; });
    var html = '<div class="card mb-3"><div class="card-body py-2"><form id="home-filter" class="row g-2 align-items-end">'
      + '<div class="col-6 col-md-2"><label class="form-label mb-1">분류</label><select class="form-select form-select-sm" name="domain"><option value="">전체</option>' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + (f.domain === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label mb-1">팀</label><select class="form-select form-select-sm" name="team"><option value="">전체 팀</option>' + teams().map(function (t) { return '<option value="' + esc(t) + '"' + (f.team === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label mb-1">이름</label><select class="form-select form-select-sm" name="who"><option value="">전체</option>' + names().map(function (n) { return '<option value="' + esc(n) + '"' + (f.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label mb-1">기간 (활동·완료)</label><select class="form-select form-select-sm" name="preset">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (f.preset === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-12 col-md-4 d-flex justify-content-md-end gap-2"><a href="history/index.html" class="btn btn-sm"><i class="ti ti-history me-1"></i>이력</a><a href="library/index.html" class="btn btn-sm"><i class="ti ti-books me-1"></i>라이브러리</a><button type="button" class="btn btn-sm btn-primary" data-action="new-run"><i class="ti ti-player-play me-1"></i>새 런 시작</button></div>'
      + '</form></div></div>';
    html += '<div class="row g-3 mb-3">' + stat('진행 중인 런', active.length + '개', f.team || f.domain ? '필터 적용' : '', '', 'col-6 col-lg-3') + stat('기간 내 완료·중단', finished.length + '개', '', '', 'col-6 col-lg-3') + stat('기간 내 기록', logs.length + '건', '', '', 'col-6 col-lg-3') + stat('활동 인원', Object.keys(people).length + '명', '', '', 'col-6 col-lg-3') + '</div>';

    if (!active.length) html += '<div class="card mb-4">' + empty('player-play', '진행 중인 런이 없습니다', state.flows.length ? '"새 런 시작"에서 분류·흐름·팀·이름·기판 수량을 정하면 런시트가 만들어집니다.' : '먼저 라이브러리에서 모듈과 공정 흐름을 만드세요.') + '</div>';
    else {
      var byTeam = {}; active.forEach(function (r) { var k = r.team || '(팀 미지정)'; (byTeam[k] = byTeam[k] || []).push(r); });
      Object.keys(byTeam).sort().forEach(function (t) {
        html += '<div class="d-flex align-items-center gap-2 mb-2 mt-1"><h3 class="mb-0"><i class="ti ti-users me-1 text-primary"></i>' + esc(t) + '</h3><span class="badge bg-secondary-lt">' + byTeam[t].length + '</span></div><div class="row g-3 mb-4">' + byTeam[t].map(runCard).join('') + '</div>';
      });
    }

    html += '<div class="row g-3"><div class="col-lg-5"><div class="card h-100"><div class="card-header"><h3 class="card-title"><i class="ti ti-flag-check me-1 text-primary"></i>완료 · 중단</h3><div class="card-actions"><a href="run/index.html" class="btn btn-sm">전체 런 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!finished.length) html += '<div class="card-body text-secondary small">기간 안에 끝난 런이 없습니다.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>런</th><th>팀 · 담당</th><th class="w-1">스텝</th><th class="w-1">상태</th></tr></thead><tbody>' + finished.slice(0, 12).map(function (r) { var pg = S.progress(r); return '<tr><td><a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.title) + '</a><span class="sub">' + esc(r.code) + ' ' + domainBadge(r.domain) + ' · ' + fmtDate(r.endedAt || r.updatedAt) + '</span></td><td class="small">' + esc(r.team) + '<br>' + esc(r.owner) + '</td><td class="text-nowrap tnum">' + pg.done + '/' + pg.total + (pg.failed ? ' <span class="text-red">✕' + pg.failed + '</span>' : '') + '</td><td><span class="badge ' + (r.status === 'done' ? 'bg-green-lt' : 'bg-red-lt') + '">' + esc(S.RUN_STATUS[r.status]) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div></div>';
    html += '<div class="col-lg-7"><div class="card h-100"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>최근 활동</h3><div class="card-actions"><a href="history/index.html" class="btn btn-sm">팀·이름·일자별 보기 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!logs.length) html += '<div class="card-body text-secondary small">기간 안에 기록이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:480px;overflow:auto"><table class="table table-sm table-vcenter card-table"><tbody>' + logs.slice(0, CFG.recentLogs || 20).map(function (l) { var r = runById(l.runId); return '<tr><td class="text-nowrap text-secondary small">' + fmtDateTime(l.at) + '</td><td class="small"><span class="badge ' + actionCls(l.action) + ' me-1">' + esc(S.ACTIONS[l.action] || l.action) + '</span>' + (r ? '<a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.code) + '</a> ' : '') + (l.stepName ? '<b>' + (l.seq ? l.seq + '. ' : '') + esc(l.stepName) + '</b>' + (l.branch ? ' <span class="step-group">' + esc(l.branch) + '</span>' : '') + ' ' : '') + '<span class="text-secondary">' + esc(l.who ? l.who + (l.team ? ' (' + l.team + ')' : '') + ' · ' : '') + esc(l.detail.slice(0, 110)) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div></div></div>';
    app.innerHTML = html;
  }

  /* ---------- 새 런 시작 ---------- */
  function splitInputs(items, unitLabel) {
    var html = '';
    (items || []).forEach(function (it) {
      if (it.kind !== 'split') return;
      html += '<div class="split-inputs mt-2"><div class="d-flex align-items-center gap-2 mb-1"><span class="badge bg-purple text-white">분기점</span><input type="text" class="form-control form-control-sm" name="s_' + esc(it.id) + '" value="' + esc(it.name || '') + '" placeholder="분기점 이름" style="max-width:14rem"></div>'
        + '<div class="row g-2">' + it.branches.map(function (b) { return '<div class="col-6 col-md-4"><div class="input-group input-group-sm"><input type="text" class="form-control" name="b_' + esc(b.id) + '_name" value="' + esc(b.name) + '" placeholder="분기 이름"><input type="number" class="form-control" name="b_' + esc(b.id) + '_count" value="' + b.count + '" min="1" style="max-width:5rem"><span class="input-group-text">' + esc(unitLabel) + '</span></div>' + (S.hasSplit(b.items) ? '<div class="ms-2 border-start ps-2">' + splitInputs(b.items, unitLabel) + '</div>' : '') + '</div>'; }).join('') + '</div></div>';
    });
    return html;
  }
  function flowBlock(dom, f) {
    var key = 'flowId_' + dom + '=' + (f ? f.id : '__empty');
    var unitLabel = f ? f.unitLabel : '기판', unitCount = f ? f.unitCount : 1;
    var st = f ? window.DSILLayout.stats(window.DSILLayout.resolve(f.items.map(function (it) { return it.kind === 'split' ? it : { kind: 'step', step: { name: it.label || it.refId } }; }))) : { steps: 0, splits: 0 };
    return '<div data-show-if="' + esc(key) + '">' + (f ? '<div class="text-secondary small mt-1">' + esc(f.description || '') + (f.device ? ' · ' + esc(f.device) : '') + ' · 항목 ' + f.items.length + '개' + (st.splits ? ' · 분기점 ' + st.splits + '개' : '') + '</div>' : '')
      + '<div class="row g-2 mt-1"><div class="col-6 col-md-3"><label class="form-label">기판 단위 라벨</label><input type="text" class="form-control" name="unitLabel" list="unit-labels" value="' + esc(unitLabel) + '" autocomplete="off"></div>'
      + '<div class="col-6 col-md-3"><label class="form-label required">수량</label><input type="number" class="form-control" name="unitCount" min="1" required value="' + unitCount + '"></div>'
      + '<div class="col-md-6"><label class="form-label">기판 · 재료</label><input type="text" class="form-control" name="substrate" placeholder="SiO2 285 nm / p++ Si" autocomplete="off"></div></div>'
      + (f && S.hasSplit(f.items) ? '<div class="form-hint mt-2">분기 수량의 합은 나눌 수량과 같아야 합니다. 이름·수량을 여기서 조정할 수 있습니다.</div>' + splitInputs(f.items, unitLabel) : '') + '</div>';
  }
  function newRunDialog(preFlowId) {
    var flows = state.flows.filter(function (f) { return f.active !== false; });
    var m = me();
    var preDomain = (flows.filter(function (f) { return f.id === preFlowId; })[0] || {}).domain || (state.filter.domain || DOMAINS[0].id);
    var body = '<div class="row g-2"><div class="col-md-6"><label class="form-label required">팀</label><input type="text" class="form-control" name="team" required list="team-list" value="' + esc(m.team) + '" placeholder="예: 2D 소자팀" autocomplete="off"><datalist id="team-list">' + teams().map(function (t) { return '<option value="' + esc(t) + '">'; }).join('') + '</datalist></div>'
      + '<div class="col-md-6"><label class="form-label required">이름 (담당자)</label><input type="text" class="form-control" name="owner" required value="' + esc(m.name) + '" placeholder="홍길동" autocomplete="off"></div></div>'
      + '<div class="mt-3"><label class="form-label required">공정 분류</label><div class="form-selectgroup">' + DOMAINS.map(function (d) { return '<label class="form-selectgroup-item"><input type="radio" name="domain" value="' + d.id + '" class="form-selectgroup-input"' + (preDomain === d.id ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-' + (d.icon || 'cpu') + ' me-1"></i>' + esc(d.label) + '</span></label>'; }).join('') + '</div></div>'
      + DOMAINS.map(function (d) {
        var fl = flows.filter(function (f) { return f.domain === d.id; });
        return '<div data-show-if="domain=' + d.id + '"><div class="mt-2"><label class="form-label required">공정 흐름 (런시트 템플릿)</label><select class="form-select" name="flowId_' + d.id + '" required>' + fl.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === preFlowId ? ' selected' : '') + '>' + esc(f.name) + (f.device ? ' — ' + esc(f.device) : '') + (S.hasSplit(f.items) ? ' [분기]' : '') + '</option>'; }).join('') + '<option value="__empty">빈 런 (스텝을 직접 추가)</option></select></div>'
          + fl.map(function (f) { return flowBlock(d.id, f); }).join('') + flowBlock(d.id, null) + '</div>';
      }).join('')
      + '<datalist id="unit-labels">' + (CFG.unitLabels || []).map(function (u) { return '<option value="' + esc(u) + '">'; }).join('') + '</datalist>'
      + '<div class="row g-2 mt-2"><div class="col-md-7"><label class="form-label">런 제목 <span class="form-label-description">비우면 흐름 이름</span></label><input type="text" class="form-control" name="title" placeholder="예: MoS2 BG-FET 배치 3" autocomplete="off"></div>'
      + '<div class="col-md-5"><label class="form-label">시료 / 로트 ID</label><input type="text" class="form-control" name="sample" placeholder="예: W12-3" autocomplete="off"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-8"><label class="form-label">목표 · 메모</label><input type="text" class="form-control" name="goal" placeholder="이번 런의 목적, 비교 대상" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시작일</label><input type="datetime-local" class="form-control" name="startedAt" value="' + toLocalInput() + '"></div></div>';
    return dialog({ title: '새 런 시작', bodyHtml: body, okLabel: '런시트 만들기', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var domain = v.domain, flowId = v['flowId_' + domain];
      var branches = {}, splits = {};
      Object.keys(v).forEach(function (k) { var mb = /^b_(.+)_(name|count)$/.exec(k); if (mb) { branches[mb[1]] = branches[mb[1]] || {}; branches[mb[1]][mb[2]] = v[k]; } var ms = /^s_(.+)$/.exec(k); if (ms) splits[ms[1]] = v[k]; });
      return store.createRun({ domain: domain, flowId: flowId === '__empty' ? null : flowId, title: v.title || (flowId === '__empty' ? '새 런' : ''), team: v.team, owner: v.owner, sample: v.sample, substrate: v.substrate, goal: v.goal,
        unitLabel: v.unitLabel, unitCount: v.unitCount, branches: branches, splits: splits, startedAt: v.startedAt ? new Date(v.startedAt).toISOString() : null })
        .then(function (run) { if (!m.name || !m.team) store.setMe({ name: m.name || v.owner, team: m.team || v.team }); return run; });
    });
  }

  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }

  document.addEventListener('change', function (e) {
    var form = e.target.closest('#home-filter'); if (!form) return;
    var v = readForm(form); state.filter = { domain: v.domain || '', team: v.team || '', who: v.who || '', preset: v.preset || '90' }; render();
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    switch (el.getAttribute('data-action')) {
      case 'new-run': startNew(null); break;
      case 'set-me': meDialog().then(function (m) { if (m) toast(m.name + ' (' + m.team + ') 으로 기록합니다.'); }).catch(handleError); break;
    }
  });
  function startNew(pre) {
    if (!state.flows.length) { toast('먼저 라이브러리에서 공정 흐름을 만드세요.', true); return; }
    newRunDialog(pre).then(function (run) { if (run) { toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.href = 'run/index.html#id=' + run.id; } }).catch(handleError);
  }

  var autoNew = null;
  try { autoNew = new URLSearchParams(window.location.search).get('new'); } catch (e) { /* ignore */ }
  store.init().then(function () { state.ready = true; store.onChange(function () { reload().then(render).catch(handleError); }); return refresh(); })
    .then(function () {
      if (!autoNew) return;
      var pre = autoNew === '1' ? null : autoNew; autoNew = null;
      try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
      startNew(pre);
    })
    .catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
