/* =====================================================================
   DSIL Run Sheet – 홈: 진행 중인 런, 새 런 시작, 최근 활동
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDateTime = U.fmtDateTime, fmtDuration = U.fmtDuration, $ = U.$, toast = U.toast, dialog = U.dialog, promptDlg = U.promptDlg, empty = U.empty, stat = U.stat, toLocalInput = U.toLocalInput;
  var store = S.create(CFG);
  var state = { ready: false, error: null, runs: [], flows: [], modules: [], logs: [] };

  function me() { return store.getMe(); }
  function runById(id) { return state.runs.filter(function (r) { return r.id === id; })[0] || null; }

  function reload() {
    return Promise.all([store.listRuns(), store.listFlows(), store.listModules(), store.listLogs(null, CFG.recentLogs || 15)]).then(function (r) {
      state.runs = r[0]; state.flows = r[1]; state.modules = r[2]; state.logs = r[3];
    });
  }

  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var name = me();
    slot.innerHTML = '<button type="button" class="btn btn-sm' + (name ? '' : ' btn-outline-primary') + '" data-action="set-me" title="기록에 붙을 작업자 이름"><i class="ti ti-user me-1"></i>' + (name ? esc(name) : '내 이름 설정') + '</button>';
  }

  function runCard(r) {
    var pg = S.progress(r);
    var cur = pg.current;
    var last = state.logs.filter(function (l) { return l.runId === r.id; })[0];
    return '<div class="col-md-6 col-xl-4"><div class="card run-card h-100"><div class="card-body d-flex flex-column">'
      + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="text-secondary small tnum">' + esc(r.code) + (r.sample ? ' · <b>' + esc(r.sample) + '</b>' : '') + '</div><h3 class="run-title mb-1"><a href="run/index.html#id=' + esc(r.id) + '" class="text-reset">' + esc(r.title) + '</a></h3>'
      + '<div class="text-secondary small">' + esc(r.flowName || '빈 런') + (r.owner ? ' · ' + esc(r.owner) : '') + ' · ' + fmtDate(r.startedAt) + '</div></div>'
      + '<span class="badge ' + (r.status === 'paused' ? 'bg-secondary-lt' : 'bg-blue-lt') + '">' + esc(S.RUN_STATUS[r.status] || r.status) + '</span></div>'
      + '<div class="mt-3"><div class="d-flex justify-content-between small mb-1"><span>' + pg.finished + ' / ' + pg.total + ' 스텝</span><span class="tnum">' + pg.pct + '%</span></div>'
      + '<div class="progress progress-sm"><div class="progress-bar" style="width:' + pg.pct + '%"></div>' + (pg.failed ? '<div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / pg.total * 100) + '%"></div>' : '') + '</div></div>'
      + (cur ? '<div class="mt-3 current-step"><div class="text-secondary small">현재 스텝</div><div class="d-flex align-items-center gap-2"><span class="step-num ' + (cur.status === 'running' ? 'is-running' : '') + '">' + cur.seq + '</span><div><div class="fw-medium">' + esc(cur.name) + '</div><div class="small text-secondary">' + (cur.group ? esc(cur.group) + ' · ' : '') + esc(cur.equipment || '') + (cur.status === 'running' ? ' · <span class="text-warning">진행 중 ' + esc(cur.operator || '') + ' ' + fmtDuration((Date.now() - new Date(cur.startedAt)) / 60000) + '</span>' : '') + '</div></div></div></div>'
        : '<div class="mt-3 alert alert-success py-2 px-3 mb-0 small"><i class="ti ti-check me-1"></i>모든 스텝이 끝났습니다. 런시트에서 완료 처리하세요.</div>')
      + (last ? '<div class="small text-secondary mt-2"><i class="ti ti-history me-1"></i>' + fmtDateTime(last.at) + ' ' + esc(last.who || '') + ' · ' + esc(S.ACTIONS[last.action] || last.action) + (last.stepName ? ' · ' + esc(last.stepName) : '') + '</div>' : '')
      + '<div class="mt-auto pt-3 d-flex gap-2"><a href="run/index.html#id=' + esc(r.id) + '" class="btn btn-outline-primary"><i class="ti ti-clipboard-list me-1"></i>런시트</a>'
      + (cur ? '<a href="run/index.html#id=' + esc(r.id) + '&step=' + esc(cur.id) + '" class="btn btn-primary"><i class="ti ti-pencil me-1"></i>' + (cur.status === 'running' ? '완료 기록' : '이 스텝 기록') + '</a>' : '<a href="run/index.html#id=' + esc(r.id) + '" class="btn btn-success"><i class="ti ti-flag-check me-1"></i>런 완료</a>')
      + '</div></div></div></div>';
  }

  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">초기화 오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    var active = state.runs.filter(function (r) { return r.status === 'active' || r.status === 'paused'; });
    var finished = state.runs.filter(function (r) { return r.status === 'done' || r.status === 'aborted'; }).slice(0, 8);
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div><h3 class="mb-0">진행 중인 런</h3><div class="text-secondary small">런은 공정 흐름(런시트 템플릿)에서 시작하고, 스텝마다 실제 조건·결과를 기록합니다.</div></div>'
      + '<div class="d-flex flex-wrap gap-2"><a href="library/index.html" class="btn"><i class="ti ti-books me-1"></i>라이브러리</a><button type="button" class="btn btn-primary" data-action="new-run"><i class="ti ti-player-play me-1"></i>새 런 시작</button></div></div>';
    html += '<div class="row g-3 mb-4">' + stat('진행 중', active.length + '개', '', '', 'col-6 col-lg-3') + stat('완료·중단', state.runs.length - active.length + '개', '', '', 'col-6 col-lg-3') + stat('공정 모듈', state.modules.filter(function (m) { return m.active !== false; }).length + '개', '', '', 'col-6 col-lg-3') + stat('공정 흐름', state.flows.length + '개', '', '', 'col-6 col-lg-3') + '</div>';
    if (!active.length) html += '<div class="card mb-4">' + empty('player-play', '진행 중인 런이 없습니다', state.flows.length ? '"새 런 시작"에서 흐름을 고르면 런시트가 만들어집니다.' : '먼저 라이브러리에서 모듈과 공정 흐름을 만드세요.') + '</div>';
    else html += '<div class="row g-3 mb-4">' + active.map(runCard).join('') + '</div>';

    html += '<div class="row g-3"><div class="col-lg-6"><div class="card h-100"><div class="card-header"><h3 class="card-title"><i class="ti ti-flag-check me-1 text-primary"></i>최근 완료 · 중단</h3><div class="card-actions"><a href="run/index.html" class="btn btn-sm">전체 런 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!finished.length) html += '<div class="card-body text-secondary small">아직 끝난 런이 없습니다.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>런</th><th>시료</th><th class="w-1">스텝</th><th class="w-1">상태</th></tr></thead><tbody>' + finished.map(function (r) { var pg = S.progress(r); return '<tr><td><a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.title) + '</a><span class="sub">' + esc(r.code) + ' · ' + esc(r.flowName || '') + ' · ' + fmtDate(r.endedAt || r.updatedAt) + '</span></td><td>' + esc(r.sample || '-') + '</td><td class="text-nowrap tnum">' + pg.done + '/' + pg.total + (pg.failed ? ' <span class="text-red">✕' + pg.failed + '</span>' : '') + '</td><td><span class="badge ' + (r.status === 'done' ? 'bg-green-lt' : 'bg-red-lt') + '">' + esc(S.RUN_STATUS[r.status]) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div></div>';
    html += '<div class="col-lg-6"><div class="card h-100"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>최근 활동</h3></div>';
    if (!state.logs.length) html += '<div class="card-body text-secondary small">아직 기록이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:420px;overflow:auto"><table class="table table-sm table-vcenter card-table"><tbody>' + state.logs.map(function (l) { var r = runById(l.runId); return '<tr><td class="text-nowrap text-secondary small">' + fmtDateTime(l.at) + '</td><td class="small"><span class="badge ' + actionCls(l.action) + ' me-1">' + esc(S.ACTIONS[l.action] || l.action) + '</span>' + (r ? '<a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.code) + '</a> ' : '') + (l.stepName ? '<b>' + esc(l.seq ? l.seq + '. ' : '') + esc(l.stepName) + '</b> ' : '') + '<span class="text-secondary">' + esc(l.who ? l.who + ' · ' : '') + esc(l.detail.slice(0, 120)) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div></div></div>';
    app.innerHTML = html;
  }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a === 'step-start' ? 'bg-yellow-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }

  function newRunDialog(preFlowId) {
    var flows = state.flows.filter(function (f) { return f.active !== false; });
    var body = '<div class="mb-3"><label class="form-label required">공정 흐름 (런시트 템플릿)</label><select class="form-select" name="flowId" required>' + flows.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === preFlowId ? ' selected' : '') + '>' + esc(f.name) + (f.device ? ' — ' + esc(f.device) : '') + ' (' + f.items.length + '항목)</option>'; }).join('') + '<option value="__empty">빈 런 (스텝을 직접 추가)</option></select></div>'
      + '<div class="row g-2"><div class="col-md-8"><label class="form-label">런 제목 <span class="form-label-description">비우면 흐름 이름</span></label><input type="text" class="form-control" name="title" placeholder="예: MoS2 BG-FET 배치 3" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">시작일</label><input type="datetime-local" class="form-control" name="startedAt" value="' + toLocalInput() + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label">시료 / 웨이퍼 ID</label><input type="text" class="form-control" name="sample" placeholder="예: W12-3" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">담당자</label><input type="text" class="form-control" name="owner" value="' + esc(me()) + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">기판</label><input type="text" class="form-control" name="substrate" placeholder="SiO2 285 nm / p++ Si" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">목표 · 메모</label><textarea class="form-control" name="goal" rows="2" placeholder="이번 런의 목적, 바꾼 조건, 비교 대상"></textarea></div>';
    return dialog({ title: '새 런 시작', bodyHtml: body, okLabel: '런시트 만들기', size: 'lg' }).then(function (v) {
      if (!v) return null;
      return store.createRun({ flowId: v.flowId === '__empty' ? null : v.flowId, title: v.title || (v.flowId === '__empty' ? '새 런' : ''), startedAt: v.startedAt ? new Date(v.startedAt).toISOString() : null, sample: v.sample, owner: v.owner, substrate: v.substrate, goal: v.goal });
    });
  }

  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action');
    switch (action) {
      case 'new-run':
        if (!state.flows.length) { toast('먼저 라이브러리에서 공정 흐름을 만드세요.', true); break; }
        newRunDialog().then(function (run) { if (run) { if (!me() && run.owner) store.setMe(run.owner); toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.href = 'run/index.html#id=' + run.id; } }).catch(handleError);
        break;
      case 'set-me':
        promptDlg({ title: '내 이름', message: '기록·수정에 작업자로 붙는 이름입니다. 이 브라우저에 기억됩니다.', input: 'text', placeholder: '홍길동', okLabel: '저장' }).then(function (v) { if (v === null) return; return store.setMe(v).then(function () { toast(v ? v + ' 님으로 기록합니다.' : '이름을 지웠습니다.'); renderChrome(); }); }).catch(handleError);
        break;
    }
  });

  setInterval(function () { if (state.ready && !document.querySelector('.modal.is-open')) render(); }, 60000);

  var autoNew = null;
  try { autoNew = new URLSearchParams(window.location.search).get('new'); } catch (e) { /* ignore */ }
  store.init().then(function () { state.ready = true; store.onChange(function () { reload().then(render).catch(handleError); }); return refresh(); })
    .then(function () {
      /* ?new=1 또는 ?new=<flowId> : 런 목록·라이브러리에서 넘어온 "새 런 시작" */
      if (!autoNew) return;
      var pre = autoNew === '1' ? null : autoNew; autoNew = null;
      try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ }
      if (!state.flows.length) { toast('먼저 라이브러리에서 공정 흐름을 만드세요.', true); return; }
      return newRunDialog(pre).then(function (run) { if (run) { if (!me() && run.owner) store.setMe(run.owner); toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.href = 'run/index.html#id=' + run.id; } });
    })
    .catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
