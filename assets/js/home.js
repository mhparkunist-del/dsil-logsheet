/* =====================================================================
   DSIL Run Sheet – 홈: 로그인(이름 + PIN) → 내 런만 표시, 새 런 시작(빈 런시트 기본, 라이브러리 흐름 복사는 선택),
   최근 아카이브(모든 구성원 공개), 내 활동, 관리자 계정 관리
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, S = window.DSILStore;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDateTime = U.fmtDateTime, localDate = U.localDate, $ = U.$, toast = U.toast, dialog = U.dialog, promptDlg = U.promptDlg, confirmDlg = U.confirmDlg, empty = U.empty, stat = U.stat, toLocalInput = U.toLocalInput, readForm = U.readForm;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [{ id: 'device', label: '반도체 소자 공정', short: '소자' }, { id: 'package', label: '패키징 공정', short: '패키징' }];
  var PRESETS = [['7', '최근 7일'], ['30', '최근 30일'], ['90', '최근 90일'], ['year', '올해'], ['all', '전체']];
  var UNITS = CFG.unitLabels || ['기판', '웨이퍼', '샘플', '칩'];
  var state = { ready: false, error: null, session: null, runs: [], archive: [], flows: [], modules: [], logs: [], accounts: [], filter: { domain: '', preset: '90' }, next: null, autoNew: null };
  (function () { try { var q = new URLSearchParams(window.location.search); state.next = q.get('next'); state.autoNew = q.get('new'); } catch (e) { /* ignore */ } })();

  function me() { return store.getMe(); }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function domainBadge(id) { var d = domainInfo(id); return '<span class="badge ' + (id === 'package' ? 'bg-indigo-lt' : 'bg-blue-lt') + '">' + esc(d.short) + '</span>'; }
  function runById(id) { return state.runs.concat(state.archive).filter(function (r) { return r.id === id; })[0] || null; }
  function rangeFrom(preset) {
    var now = new Date();
    if (preset === 'all') return null;
    if (preset === 'year') return localDate(new Date(now.getFullYear(), 0, 1).toISOString());
    var n = Number(preset) || 90; return localDate(new Date(now.getTime() - (n - 1) * 86400000).toISOString());
  }
  function teams() { var set = {}; (CFG.teams || []).forEach(function (t) { set[t] = 1; }); state.runs.concat(state.archive).forEach(function (r) { if (r.team) set[r.team] = 1; }); state.accounts.forEach(function (a) { if (a.team) set[a.team] = 1; }); var m = me(); if (m.team) set[m.team] = 1; return Object.keys(set).sort(); }
  function teamSelect(name, value, required) {
    var list = teams(), custom = value && list.indexOf(value) < 0;
    return '<select class="form-select" name="' + name + '"' + (required ? ' required' : '') + '>' + (value ? '' : '<option value="">선택</option>') + list.map(function (t) { return '<option value="' + esc(t) + '"' + (t === value ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '<option value="__custom"' + (custom ? ' selected' : '') + '>직접 입력…</option></select>'
      + '<div data-show-if="' + name + '=__custom" class="mt-1"><input type="text" class="form-control" name="' + name + 'Custom" placeholder="새 팀 이름" value="' + esc(custom ? value : '') + '" autocomplete="off"></div>';
  }
  function readTeam(v, name) { return v[name] === '__custom' ? (v[name + 'Custom'] || '') : (v[name] || ''); }

  function reload() {
    state.session = store.getSession();
    if (!state.session) { state.runs = []; state.archive = []; state.logs = []; state.accounts = []; return Promise.all([store.listFlows(), store.listModules()]).then(function (r) { state.flows = r[0]; state.modules = r[1]; }); }
    return Promise.all([store.listRuns({ scope: 'mine' }), store.listRuns({ scope: 'archive' }), store.listFlows(), store.listModules(), store.listLogs(null, 3000, 'mine'), state.session.isAdmin ? store.listAccounts() : Promise.resolve([])])
      .then(function (r) { state.runs = r[0]; state.archive = r[1]; state.flows = r[2]; state.modules = r[3]; state.logs = r[4]; state.accounts = r[5]; });
  }

  /* ---------- 상단 · 로그인 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'), menu = $('#navbar-menu'), toggler = $('.navbar-toggler');
    var ok = !!state.session;
    if (menu) menu.classList.toggle('is-hidden', !ok);
    if (toggler) toggler.classList.toggle('is-hidden', !ok);
    if (!slot) return;
    if (!ok) { slot.innerHTML = ''; return; }
    var m = me();
    slot.innerHTML = '<button type="button" class="btn btn-sm" data-action="user-menu"><span class="avatar avatar-xs ' + (m.isAdmin ? 'bg-primary text-white' : 'bg-blue-lt') + ' me-1">' + esc(m.name.charAt(0)) + '</span>' + esc(m.name) + (m.team ? ' <span class="text-secondary">· ' + esc(m.team) + '</span>' : ' <span class="text-warning">· 팀 미지정</span>') + '</button>';
  }
  function renderLogin() {
    return '<div class="container-tight py-5"><div class="card card-md"><div class="card-body p-4">'
      + '<div class="text-center mb-4"><img src="assets/img/logo/KAIST_DSIL_Final.png" alt="KAIST DSIL" style="height:44px"><div class="text-secondary small mt-2">Run Sheet · 공정 런시트</div></div>'
      + '<h2 class="h2 text-center mb-3">로그인</h2>'
      + '<form id="login-form"><div class="mb-3"><label class="form-label required">이름</label><input type="text" class="form-control form-control-lg" name="name" required placeholder="홍길동" autocomplete="username"></div>'
      + '<div class="mb-3"><label class="form-label required">PIN</label><input type="password" class="form-control form-control-lg" name="pin" required inputmode="numeric" autocomplete="current-password" placeholder="숫자 4~8자리"></div>'
      + '<div class="form-footer"><button type="submit" class="btn btn-primary btn-lg w-100"><i class="ti ti-login me-1"></i>로그인</button></div></form>'
      + (CFG.allowSignup !== false ? '<div class="text-center mt-4"><span class="text-secondary small">계정이 없나요?</span> <button type="button" class="btn btn-link p-0 align-baseline" data-action="signup">회원가입</button></div>' : '')
      + '<div class="text-secondary small text-center mt-2">런은 만든 사람만 보고 고칩니다. 완료 후 아카이브에 올린 런만 모두에게 공개됩니다.</div>'
      + '</div></div></div>';
  }
  function signupDialog() {
    var body = '<div class="mb-2"><label class="form-label required">이름</label><input type="text" class="form-control" name="name" required placeholder="실명" autocomplete="off"></div>'
      + '<div class="mb-2"><label class="form-label required">팀</label>' + teamSelect('team', '', true) + '</div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label required">PIN</label><input type="password" class="form-control" name="pin" required inputmode="numeric" autocomplete="new-password" placeholder="숫자 4~8자리"></div><div class="col-6"><label class="form-label required">PIN 확인</label><input type="password" class="form-control" name="pin2" required inputmode="numeric" autocomplete="new-password"></div></div>';
    return dialog({ title: '회원가입', bodyHtml: body, okLabel: '가입하고 로그인', size: 'md' }).then(function (v) {
      if (!v) return null;
      if (v.pin !== v.pin2) { toast('PIN 확인이 일치하지 않습니다.', true); return null; }
      return store.signUp({ name: v.name, team: readTeam(v, 'team'), pin: v.pin });
    });
  }
  function userMenu() {
    var m = me();
    var html = '<div class="list-group list-group-flush">'
      + '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-action="menu-team"><i class="ti ti-users text-primary"></i><div><div class="fw-medium">팀 바꾸기</div><div class="small text-secondary">현재: ' + esc(m.team || '미지정') + '</div></div></button>'
      + '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-action="menu-pin"><i class="ti ti-key text-primary"></i><div><div class="fw-medium">PIN 변경</div></div></button>'
      + '<button type="button" class="list-group-item list-group-item-action d-flex align-items-center gap-3" data-action="menu-logout"><i class="ti ti-logout text-red"></i><div><div class="fw-medium">로그아웃</div></div></button></div>';
    return dialog({ title: m.name + (m.isAdmin ? ' (관리자)' : ''), html: html, hideCancel: true, okLabel: '닫기' });
  }
  function teamDialog(msg) {
    var m = me();
    return dialog({ title: '팀', message: msg || '', bodyHtml: '<label class="form-label required">팀</label>' + teamSelect('team', m.team, true), okLabel: '저장' }).then(function (v) { if (!v) return null; return store.setMyTeam(readTeam(v, 'team')); });
  }

  /* ---------- 홈 ---------- */
  function runCard(r) {
    var pg = S.progress(r), cur = pg.current;
    var last = state.logs.filter(function (l) { return l.runId === r.id; })[0];
    return '<div class="col-md-6 col-xl-4"><div class="card run-card h-100"><div class="card-body d-flex flex-column">'
      + '<div class="d-flex justify-content-between align-items-start gap-2"><div><div class="text-secondary small tnum">' + esc(r.code) + ' ' + domainBadge(r.domain) + (r.sample ? ' · <b>' + esc(r.sample) + '</b>' : '') + '</div><h3 class="run-title mb-1"><a href="run/index.html#id=' + esc(r.id) + '" class="text-reset">' + esc(r.title) + '</a></h3>'
      + '<div class="text-secondary small">' + esc(r.team) + ' · ' + esc(r.unitLabel) + ' ' + r.unitCount + ' · ' + fmtDate(r.startedAt) + '</div></div>'
      + '<span class="badge ' + (r.status === 'paused' ? 'bg-secondary-lt' : 'bg-blue-lt') + '">' + esc(S.RUN_STATUS[r.status] || r.status) + '</span></div>'
      + '<div class="mt-3"><div class="d-flex justify-content-between small mb-1"><span>' + pg.finished + ' / ' + pg.total + ' 스텝</span><span class="tnum">' + pg.pct + '%</span></div>'
      + '<div class="progress progress-sm"><div class="progress-bar" style="width:' + Math.round(pg.done / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-secondary" style="width:' + Math.round(pg.skipped / (pg.total || 1) * 100) + '%"></div><div class="progress-bar bg-red" style="width:' + Math.round(pg.failed / (pg.total || 1) * 100) + '%"></div></div></div>'
      + (!pg.total ? '<div class="mt-3 alert alert-warning py-2 px-3 mb-0 small"><i class="ti ti-pencil-plus me-1"></i>아직 스텝이 없습니다. 런시트에서 라이브러리 모듈·흐름을 넣으세요.</div>'
        : cur ? '<div class="mt-3 current-step"><div class="text-secondary small">다음 스텝' + (cur.branchPath && cur.branchPath.length ? ' · <span class="step-group">' + esc(cur.branchPath.join(' › ')) + '</span>' : '') + '</div><div class="d-flex align-items-center gap-2"><span class="step-num">' + cur.seq + '</span><div><div class="fw-medium">' + esc(cur.name) + '</div><div class="small text-secondary">' + esc(cur.equipment || '') + '</div></div></div></div>'
          : '<div class="mt-3 alert alert-success py-2 px-3 mb-0 small"><i class="ti ti-check me-1"></i>모든 스텝이 끝났습니다. 런시트에서 완료 처리하세요.</div>')
      + (last ? '<div class="small text-secondary mt-2"><i class="ti ti-history me-1"></i>' + fmtDateTime(last.at) + ' · ' + esc(S.ACTIONS[last.action] || last.action) + (last.stepName ? ' · ' + esc(last.stepName) : '') + '</div>' : '')
      + '<div class="mt-auto pt-3 d-flex gap-2"><a href="run/index.html#id=' + esc(r.id) + (!pg.total ? '&edit=1' : '') + '" class="btn btn-outline-primary"><i class="ti ti-clipboard-list me-1"></i>런시트</a>'
      + (cur ? '<a href="run/index.html#id=' + esc(r.id) + '&step=' + esc(cur.id) + '" class="btn btn-primary"><i class="ti ti-pencil me-1"></i>' + cur.seq + '. 기록</a>' : (pg.total ? '<a href="run/index.html#id=' + esc(r.id) + '" class="btn btn-success"><i class="ti ti-flag-check me-1"></i>런 완료</a>' : ''))
      + '</div></div></div></div>';
  }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }
  function renderHome() {
    var m = me(), f = state.filter, from = rangeFrom(f.preset);
    var runs = state.runs.filter(function (r) { return !f.domain || r.domain === f.domain; });
    var active = runs.filter(function (r) { return r.status === 'active' || r.status === 'paused'; });
    var finished = runs.filter(function (r) { return (r.status === 'done' || r.status === 'aborted') && (!from || localDate(r.endedAt || r.updatedAt) >= from); });
    var logs = state.logs.filter(function (l) { var r = runById(l.runId); return (!f.domain || (r && r.domain === f.domain)) && (!from || (l.date || localDate(l.at)) >= from); });
    var archive = state.archive.filter(function (r) { return !f.domain || r.domain === f.domain; });
    var html = '<div class="card mb-3"><div class="card-body py-2"><form id="home-filter" class="row g-2 align-items-end">'
      + '<div class="col-12 col-md-4"><div class="h3 mb-0">' + esc(m.name) + ' 님의 런시트</div><div class="text-secondary small">' + esc(m.team || '팀 미지정') + ' · 내가 만든 런만 보입니다</div></div>'
      + '<div class="col-6 col-md-2"><label class="form-label mb-1">분류</label><select class="form-select form-select-sm" name="domain"><option value="">전체</option>' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + (f.domain === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label mb-1">기간</label><select class="form-select form-select-sm" name="preset">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (f.preset === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-12 col-md-4 d-flex justify-content-md-end gap-2"><a href="history/index.html" class="btn btn-sm"><i class="ti ti-history me-1"></i>이력</a><a href="library/index.html" class="btn btn-sm"><i class="ti ti-books me-1"></i>라이브러리</a><button type="button" class="btn btn-sm btn-primary" data-action="new-run"><i class="ti ti-player-play me-1"></i>새 런 시작</button></div>'
      + '</form></div></div>';
    html += '<div class="row g-3 mb-3">' + stat('내 진행 중인 런', active.length + '개', '', '', 'col-6 col-lg-3') + stat('기간 내 내 완료·중단', finished.length + '개', '', '', 'col-6 col-lg-3') + stat('기간 내 내 기록', logs.length + '건', '', '', 'col-6 col-lg-3') + stat('아카이브 (전체)', state.archive.length + '개', '모든 구성원 공개', '', 'col-6 col-lg-3') + '</div>';
    if (!active.length) html += '<div class="card mb-4">' + empty('player-play', '진행 중인 런이 없습니다', '"새 런 시작"으로 빈 런시트를 만들고 라이브러리에서 모듈·흐름을 넣거나, 라이브러리 흐름을 복사해 시작하세요.') + '</div>';
    else html += '<div class="row g-3 mb-4">' + active.map(runCard).join('') + '</div>';
    html += '<div class="row g-3"><div class="col-lg-6"><div class="card h-100"><div class="card-header"><h3 class="card-title"><i class="ti ti-flag-check me-1 text-primary"></i>내 완료 · 중단</h3><div class="card-actions"><a href="run/index.html" class="btn btn-sm">내 런 전체 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!finished.length) html += '<div class="card-body text-secondary small">기간 안에 끝난 런이 없습니다.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>런</th><th class="w-1">스텝</th><th class="w-1">상태</th><th class="w-1">아카이브</th></tr></thead><tbody>' + finished.slice(0, 10).map(function (r) { var pg = S.progress(r); return '<tr><td><a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.title) + '</a><span class="sub">' + esc(r.code) + ' ' + domainBadge(r.domain) + ' · ' + fmtDate(r.endedAt || r.updatedAt) + '</span></td><td class="text-nowrap tnum">' + pg.done + '/' + pg.total + '</td><td><span class="badge ' + (r.status === 'done' ? 'bg-green-lt' : 'bg-red-lt') + '">' + esc(S.RUN_STATUS[r.status]) + '</span></td><td>' + (r.archived ? '<span class="badge bg-teal-lt">공개</span>' : '<button type="button" class="btn btn-sm" data-action="archive" data-id="' + esc(r.id) + '">올리기</button>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div></div>';
    html += '<div class="col-lg-6"><div class="card h-100"><div class="card-header"><h3 class="card-title"><i class="ti ti-archive me-1 text-primary"></i>최근 아카이브 <span class="text-secondary fw-normal">모든 팀</span></h3><div class="card-actions"><a href="run/index.html#scope=archive" class="btn btn-sm">아카이브 전체 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!archive.length) html += '<div class="card-body text-secondary small">아직 아카이브에 올라온 런이 없습니다. 런을 완료할 때 "아카이브에 올릴까요?"에 동의하면 여기 보입니다.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>런</th><th>팀 · 담당</th><th class="w-1">스텝</th><th class="w-1">올린 날</th></tr></thead><tbody>' + archive.slice(0, 10).map(function (r) { var pg = S.progress(r); return '<tr><td><a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.title) + '</a><span class="sub">' + esc(r.code) + ' ' + domainBadge(r.domain) + (r.sample ? ' · ' + esc(r.sample) : '') + '</span></td><td class="small">' + esc(r.team) + '<br>' + esc(r.owner) + '</td><td class="text-nowrap tnum">' + pg.done + '/' + pg.total + '</td><td class="text-nowrap text-secondary small">' + fmtDate(r.archivedAt) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div></div></div>';
    html += '<div class="card mt-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>내 최근 활동</h3><div class="card-actions"><a href="history/index.html" class="btn btn-sm">팀·이름·일자별 보기 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!logs.length) html += '<div class="card-body text-secondary small">기간 안에 기록이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:400px;overflow:auto"><table class="table table-sm table-vcenter card-table"><tbody>' + logs.slice(0, CFG.recentLogs || 20).map(function (l) { var r = runById(l.runId); return '<tr><td class="text-nowrap text-secondary small">' + fmtDateTime(l.at) + '</td><td class="small"><span class="badge ' + actionCls(l.action) + ' me-1">' + esc(S.ACTIONS[l.action] || l.action) + '</span>' + (r ? '<a href="run/index.html#id=' + esc(r.id) + '">' + esc(r.code) + '</a> ' : '') + (l.stepName ? '<b>' + (l.seq ? l.seq + '. ' : '') + esc(l.stepName) + '</b>' + (l.branch ? ' <span class="step-group">' + esc(l.branch) + '</span>' : '') + ' ' : '') + '<span class="text-secondary">' + esc(l.who ? l.who + ' · ' : '') + esc(l.detail.slice(0, 110)) + '</span></td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div>';
    if (m.isAdmin) {
      html += '<div class="card mt-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-users me-1 text-primary"></i>계정 <span class="text-secondary fw-normal">' + state.accounts.length + '개 · 관리자</span></h3></div><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>이름</th><th>팀</th><th class="w-1">권한</th><th class="w-1"></th></tr></thead><tbody>'
        + state.accounts.map(function (a) { return '<tr><td class="fw-medium">' + esc(a.name) + '</td><td>' + esc(a.team || '-') + '</td><td>' + (a.role === 'admin' ? '<span class="badge bg-primary text-white">관리자</span>' : '<span class="badge bg-secondary-lt">구성원</span>') + '</td><td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="acct-team" data-id="' + esc(a.id) + '" title="팀 지정"><i class="ti ti-users"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="acct-pin" data-id="' + esc(a.id) + '" title="PIN 재설정"><i class="ti ti-key"></i></button></td></tr>'; }).join('') + '</tbody></table></div></div>';
    }
    return html;
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">초기화 오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    app.innerHTML = state.session ? renderHome() : renderLogin();
  }

  /* ---------- 새 런 시작 ---------- */
  function unitSelect(value) {
    var custom = value && UNITS.indexOf(value) < 0;
    return '<select class="form-select" name="unitLabel">' + UNITS.map(function (u) { return '<option value="' + esc(u) + '"' + (u === value ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') + '<option value="__custom"' + (custom ? ' selected' : '') + '>직접 입력…</option></select>'
      + '<div data-show-if="unitLabel=__custom" class="mt-1"><input type="text" class="form-control" name="unitLabelCustom" placeholder="단위 이름" value="' + esc(custom ? value : '') + '" autocomplete="off"></div>';
  }
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
    return '<div data-show-if="' + esc(key) + '">' + (f ? '<div class="text-secondary small mt-1">' + esc(f.description || '') + (f.device ? ' · ' + esc(f.device) : '') + ' · 항목 ' + f.items.length + '개' + (f.seed ? ' · 기본 제공' : (f.ownerName ? ' · ' + esc(f.ownerName) : '')) + '</div>' : '<div class="text-secondary small mt-1">빈 런시트로 시작합니다. 런시트 화면의 <b>라이브러리에서 추가</b>로 모듈을 하나씩 넣거나 흐름을 통째로 복사한 뒤 자유롭게 고칩니다.</div>')
      + '<div class="row g-2 mt-1"><div class="col-6 col-md-3"><label class="form-label">단위</label>' + unitSelect(f ? f.unitLabel : UNITS[0]) + '</div>'
      + '<div class="col-6 col-md-3"><label class="form-label required">수량</label><input type="number" class="form-control" name="unitCount" min="1" required value="' + (f ? f.unitCount : 1) + '"></div>'
      + '<div class="col-md-6"><label class="form-label">기판 · 재료</label><input type="text" class="form-control" name="substrate" placeholder="SiO2 285 nm / p++ Si" autocomplete="off"></div></div>'
      + (f && S.hasSplit(f.items) ? '<div class="form-hint mt-2">분기 수량의 합은 나눌 수량과 같아야 합니다. 이름·수량을 여기서 조정할 수 있습니다.</div>' + splitInputs(f.items, f.unitLabel) : '') + '</div>';
  }
  function newRunDialog(preFlowId) {
    var m = me(), flows = state.flows.filter(function (f) { return f.active !== false; });
    var preDomain = (flows.filter(function (f) { return f.id === preFlowId; })[0] || {}).domain || (state.filter.domain || DOMAINS[0].id);
    var body = (m.team ? '' : '<div class="mb-3"><label class="form-label required">팀 <span class="form-label-description">계정에 저장됩니다</span></label>' + teamSelect('team', '', true) + '</div>')
      + '<div class="row g-2"><div class="col-md-7"><label class="form-label">런 제목</label><input type="text" class="form-control" name="title" placeholder="예: MoS2 BG-FET 배치 3 (비우면 흐름 이름 또는 \'새 런\')" autocomplete="off"></div>'
      + '<div class="col-md-5"><label class="form-label">시료 / 로트 ID</label><input type="text" class="form-control" name="sample" placeholder="예: W12-3" autocomplete="off"></div></div>'
      + '<div class="mt-3"><label class="form-label required">공정 분류</label><div class="form-selectgroup">' + DOMAINS.map(function (d) { return '<label class="form-selectgroup-item"><input type="radio" name="domain" value="' + d.id + '" class="form-selectgroup-input"' + (preDomain === d.id ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-' + (d.icon || 'cpu') + ' me-1"></i>' + esc(d.label) + '</span></label>'; }).join('') + '</div></div>'
      + DOMAINS.map(function (d) {
        var fl = flows.filter(function (f) { return f.domain === d.id; });
        return '<div data-show-if="domain=' + d.id + '"><div class="mt-2"><label class="form-label">시작 방법</label><select class="form-select" name="flowId_' + d.id + '"><option value="__empty"' + (preFlowId && fl.some(function (f) { return f.id === preFlowId; }) ? '' : ' selected') + '>빈 런시트로 시작 (라이브러리에서 직접 구성)</option>' + fl.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === preFlowId ? ' selected' : '') + '>라이브러리 흐름 복사: ' + esc(f.name) + (f.device ? ' — ' + esc(f.device) : '') + (S.hasSplit(f.items) ? ' [분기]' : '') + '</option>'; }).join('') + '</select></div>'
          + flowBlock(d.id, null) + fl.map(function (f) { return flowBlock(d.id, f); }).join('') + '</div>';
      }).join('')
      + '<div class="row g-2 mt-2"><div class="col-md-8"><label class="form-label">목표 · 메모</label><input type="text" class="form-control" name="goal" placeholder="이번 런의 목적, 비교 대상" autocomplete="off"></div><div class="col-md-4"><label class="form-label">시작일</label><input type="datetime-local" class="form-control" name="startedAt" value="' + toLocalInput() + '"></div></div>';
    return dialog({ title: '새 런 시작', bodyHtml: body, okLabel: '런시트 만들기', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var domain = v.domain, flowId = v['flowId_' + domain];
      var branches = {}, splits = {};
      Object.keys(v).forEach(function (k) { var mb = /^b_(.+)_(name|count)$/.exec(k); if (mb) { branches[mb[1]] = branches[mb[1]] || {}; branches[mb[1]][mb[2]] = v[k]; } var ms = /^s_(.+)$/.exec(k); if (ms) splits[ms[1]] = v[k]; });
      var unitLabel = v.unitLabel === '__custom' ? (v.unitLabelCustom || '') : v.unitLabel;
      return store.createRun({ domain: domain, flowId: flowId === '__empty' ? null : flowId, title: v.title, team: m.team || readTeam(v, 'team'), sample: v.sample, substrate: v.substrate, goal: v.goal,
        unitLabel: unitLabel, unitCount: v.unitCount, branches: branches, splits: splits, startedAt: v.startedAt ? new Date(v.startedAt).toISOString() : null });
    });
  }

  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function goNext() { if (state.next && /^[a-z]+$/.test(state.next)) { window.location.replace(state.next + '/index.html'); return true; } return false; }
  function startNew(pre) {
    newRunDialog(pre).then(function (run) { if (run) { toast('런 ' + run.code + ' 을 만들었습니다.'); window.location.href = 'run/index.html#id=' + run.id + (run.steps.length ? '' : '&edit=1'); } }).catch(handleError);
  }

  document.addEventListener('submit', function (e) {
    if (e.target.getAttribute('id') !== 'login-form') return;
    e.preventDefault();
    var v = readForm(e.target);
    store.signIn(v).then(function (s) { if (goNext()) return; toast(s.user.name + '님, 환영합니다.'); return refresh().then(function () { if (!s.user.team) return teamDialog('팀이 지정되어 있지 않습니다. 런과 기록에 붙을 팀을 골라 주세요.').then(function () { renderChrome(); render(); }); }); }).catch(handleError);
  });
  document.addEventListener('change', function (e) {
    var form = e.target.closest('#home-filter'); if (!form) return;
    var v = readForm(form); state.filter = { domain: v.domain || '', preset: v.preset || '90' }; render();
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id');
    switch (action) {
      case 'new-run': startNew(null); break;
      case 'signup': signupDialog().then(function (s) { if (s) { toast(s.user.name + '님, 가입되었습니다.'); if (!goNext()) return refresh(); } }).catch(handleError); break;
      case 'user-menu': userMenu().catch(handleError); break;
      case 'menu-logout': U.closeAll(); store.signOut().then(function () { return refresh(); }); break;
      case 'menu-team': U.closeAll(); teamDialog().then(function (s) { if (s) { toast('팀을 ' + s.user.team + ' 으로 바꿨습니다.'); return refresh(); } }).catch(handleError); break;
      case 'menu-pin': {
        U.closeAll();
        dialog({ title: 'PIN 변경', bodyHtml: '<div class="mb-2"><label class="form-label required">현재 PIN</label><input type="password" class="form-control" name="oldPin" required inputmode="numeric"></div><div><label class="form-label required">새 PIN</label><input type="password" class="form-control" name="newPin" required inputmode="numeric" placeholder="숫자 4~8자리"></div>', okLabel: '변경' })
          .then(function (v) { if (!v) return; return store.changeMyPin(v.oldPin, v.newPin).then(function () { toast('PIN을 변경했습니다.'); }); }).catch(handleError);
        break;
      }
      case 'archive':
        confirmDlg({ title: '아카이브에 올리기', message: '이 런을 아카이브에 올리면 모든 구성원이 볼 수 있습니다(읽기 전용). 올릴까요?', okLabel: '올리기' }).then(function (ok) { if (!ok) return; return store.setArchived(id, true).then(function () { toast('아카이브에 올렸습니다.'); return refresh(); }); }).catch(handleError);
        break;
      case 'acct-pin': promptDlg({ title: 'PIN 재설정', message: '새 PIN을 입력하세요.', input: 'password', placeholder: '숫자 4~8자리', okLabel: '재설정' }).then(function (pin) { if (pin === null) return; return store.resetAccountPin(id, pin).then(function () { toast('PIN을 재설정했습니다.'); }); }).catch(handleError); break;
      case 'acct-team': { var acc = state.accounts.filter(function (a) { return a.id === id; })[0]; dialog({ title: (acc ? acc.name : '') + ' 팀 지정', bodyHtml: '<label class="form-label required">팀</label>' + teamSelect('team', acc ? acc.team : '', true), okLabel: '저장' }).then(function (v) { if (!v) return; return store.setAccountTeam(id, readTeam(v, 'team')).then(function () { toast('팀을 지정했습니다.'); return refresh(); }); }).catch(handleError); break; }
    }
  });

  store.init().then(function () { state.ready = true; store.onChange(function () { reload().then(render).catch(handleError); }); return reload(); })
    .then(function () {
      if (state.session && goNext()) return;
      render();
      if (state.session && state.autoNew) { var pre = state.autoNew === '1' ? null : state.autoNew; state.autoNew = null; try { history.replaceState(null, '', window.location.pathname); } catch (e) { /* ignore */ } startNew(pre); }
    })
    .catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
