/* =====================================================================
   DSIL Log Sheet – 홈 (로그인 + 장비 현황)
   이름 + PIN 로그인 → 장비 카드(사용 가능 / 사용 중 / 이상 보고)에서 사용 시작·종료.
   회원가입 신청은 관리자 승인 후 사용. 관리자는 가입 승인·계정·보안 이벤트를 여기서 봄.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, F = window.DSILForms;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDateTime = U.fmtDateTime, fmtTime = U.fmtTime, fmtDuration = U.fmtDuration, $ = U.$, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, promptDlg = U.promptDlg, empty = U.empty;
  var store = window.DSILStore.create(CFG);
  var LS = Object.assign({ recentLimit: 12 }, CFG.logsheet || {});
  var STATUS = { active: { label: '사용 중', cls: 'bg-green-lt' }, pending: { label: '승인 대기', cls: 'bg-yellow-lt' }, disabled: { label: '중지', cls: 'bg-secondary-lt' }, rejected: { label: '거절', cls: 'bg-red-lt' } };
  var SEC = Object.assign({ maxLoginFailures: 5, lockoutMinutes: 10, macroThresholdMs: 1200 }, CFG.security || {});
  var LOAD_AT = Date.now();
  var FAILS_KEY = 'dsil-logsheet-login-fails';
  var state = { ready: false, error: null, session: null, equipment: [], open: [], recent: [], accounts: [], events: [], magicLinkSent: false, next: null };

  function nameKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
  function readFails() { try { return JSON.parse(localStorage.getItem(FAILS_KEY) || '{}'); } catch (e) { return {}; } }
  function writeFails(obj) { try { localStorage.setItem(FAILS_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ } }
  function lockedUntil(name) { var f = readFails()[nameKey(name)]; return f && f.lockedUntil && f.lockedUntil > Date.now() ? f.lockedUntil : 0; }
  function noteFailure(name) {
    var all = readFails(); var k = nameKey(name); var f = all[k] || { count: 0, first: Date.now() };
    if (Date.now() - f.first > SEC.lockoutMinutes * 60000) f = { count: 0, first: Date.now() };
    f.count++;
    if (f.count >= SEC.maxLoginFailures) f.lockedUntil = Date.now() + SEC.lockoutMinutes * 60000;
    all[k] = f; writeFails(all);
    return f;
  }
  function clearFailure(name) { var all = readFails(); delete all[nameKey(name)]; writeFails(all); }
  (function () { try { var n = new URLSearchParams(window.location.search).get('next'); if (n === 'sheet') state.next = 'sheet/index.html'; } catch (e) { /* ignore */ } })();

  function eqById(id) { return state.equipment.filter(function (e) { return e.id === id; })[0] || null; }
  function canResolve(eq) { var s = state.session; return !!s && (s.isAdmin || nameKey(s.user.name) === nameKey(eq.managerName)); }
  function minutesSince(iso) { return (Date.now() - new Date(iso).getTime()) / 60000; }

  function reload() {
    state.session = store.getSession();
    if (!state.session || state.session.status === 'pending') { state.equipment = []; state.open = []; state.recent = []; state.accounts = []; state.events = []; return Promise.resolve(); }
    var jobs = [store.listEquipment(), store.listEntries({})];
    if (state.session.isAdmin) jobs.push(store.listAccounts(), store.listSecurityEvents());
    return Promise.all(jobs).then(function (res) {
      state.equipment = res[0];
      state.open = res[1].filter(function (e) { return e.status === 'open'; });
      state.recent = res[1].slice(0, LS.recentLimit);
      state.accounts = res[2] || []; state.events = res[3] || [];
    });
  }

  function render() {
    var app = $('#app');
    renderChrome();
    if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">초기화 오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    if (!state.session) { app.innerHTML = renderLogin(); return; }
    if (state.session.status === 'pending') {
      app.innerHTML = '<div class="container-tight py-5"><div class="card card-md"><div class="card-body">' + empty('hourglass', '관리자 승인 대기 중입니다', '승인이 끝나면 로그시트를 쓸 수 있습니다.') + '<div class="text-center"><button type="button" class="btn" data-action="signout">로그아웃</button></div></div></div></div>';
      return;
    }
    app.innerHTML = renderHome();
  }

  function renderChrome() {
    var slot = $('#user-slot'), menu = $('#navbar-menu'), toggler = $('.navbar-toggler');
    var ok = !!(state.session && state.session.status !== 'pending');
    if (menu) menu.classList.toggle('is-hidden', !ok);
    if (toggler) toggler.classList.toggle('is-hidden', !ok);
    if (!slot) return;
    if (!state.session) { slot.innerHTML = ''; return; }
    var s = state.session;
    slot.innerHTML = '<div class="d-flex align-items-center gap-2"><span class="avatar avatar-sm ' + (s.isAdmin ? 'bg-primary text-white' : 'bg-blue-lt') + '">' + esc((s.user.name || '?').trim().charAt(0)) + '</span>'
      + '<div class="d-none d-md-block lh-1"><div class="small fw-medium">' + esc(s.user.name) + '</div><div class="small text-secondary mt-1">' + (s.isAdmin ? '관리자' : '구성원') + '</div></div>'
      + (store.mode === 'local' ? '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="change-pin" title="PIN 변경"><i class="ti ti-key"></i></button>' : '')
      + '<button type="button" class="btn btn-sm btn-ghost-secondary" data-action="signout"><i class="ti ti-logout"></i><span class="d-none d-sm-inline ms-1">로그아웃</span></button></div>';
  }

  function renderLogin() {
    var head = '<div class="container-tight py-5"><div class="card card-md"><div class="card-body p-4">'
      + '<div class="text-center mb-4"><img src="assets/img/logo/KAIST_DSIL_Final.png" alt="KAIST DSIL" style="height:44px"><div class="text-secondary small mt-2">Log Sheet · 장비 사용 로그시트</div></div>';
    var foot = '</div></div></div>';
    if (store.mode === 'supabase') {
      if (state.magicLinkSent) return head + '<div class="empty py-2"><div class="empty-icon"><i class="ti ti-mail"></i></div><p class="empty-title">메일을 확인하세요</p><p class="empty-subtitle text-secondary">로그인 링크를 보냈습니다. 처음 로그인한 계정은 관리자 승인 후 쓸 수 있습니다.</p></div>' + foot;
      return head + '<h2 class="h2 text-center mb-3">로그인 · 회원가입</h2>'
        + '<form id="login-form"><div class="mb-3"><label class="form-label required">이메일</label><input type="email" class="form-control" name="email" required placeholder="name@kaist.ac.kr" autocomplete="email"></div>'
        + '<div class="mb-3"><label class="form-label">이름 <span class="form-label-description">처음이면 입력</span></label><input type="text" class="form-control" name="name" placeholder="홍길동" autocomplete="name"></div>'
        + '<div class="form-footer"><button type="submit" class="btn btn-primary w-100"><i class="ti ti-mail me-1"></i>로그인 링크 보내기</button></div></form>'
        + '<div class="text-secondary small text-center mt-3">처음 로그인한 계정은 가입 신청으로 처리되며 관리자 승인 후 사용할 수 있습니다.</div>' + foot;
    }
    return head + '<h2 class="h2 text-center mb-3">로그인</h2>'
      + '<form id="login-form"><div class="mb-3"><label class="form-label required">이름</label><input type="text" class="form-control form-control-lg" name="name" required placeholder="홍길동" autocomplete="username"></div>'
      + '<div class="mb-3"><label class="form-label required">PIN</label><input type="password" class="form-control form-control-lg" name="pin" required inputmode="numeric" autocomplete="current-password" placeholder="숫자 4~8자리"></div>'
      + '<div class="form-footer"><button type="submit" class="btn btn-primary btn-lg w-100"><i class="ti ti-login me-1"></i>로그인</button></div></form>'
      + '<div class="text-center mt-4"><span class="text-secondary small">계정이 없나요?</span> <button type="button" class="btn btn-link p-0 align-baseline" data-action="signup">회원가입 신청</button></div>'
      + '<div class="text-secondary small text-center mt-2">가입 신청은 관리자가 승인한 뒤 로그인할 수 있습니다.</div>' + foot;
  }

  /* ---------- 장비 현황 ---------- */
  function eqCard(eq) {
    var s = state.session;
    var opens = state.open.filter(function (o) { return o.equipmentId === eq.id; });
    var mine = opens.filter(function (o) { return o.userId === s.user.id; })[0];
    var st, dot, cls;
    if (eq.active === false) { st = '비활성'; dot = 'off'; cls = 'is-off'; }
    else if (eq.issue) { st = '이상 보고'; dot = 'issue'; cls = 'is-issue'; }
    else if (opens.length) { st = '사용 중'; dot = 'busy'; cls = 'is-busy'; }
    else { st = '사용 가능'; dot = 'free'; cls = ''; }
    var badge = { free: 'green', busy: 'yellow', issue: 'red', off: 'secondary' }[dot];
    var canStart = eq.active !== false && !mine && (!opens.length || eq.allowConcurrent);
    var html = '<div class="col-md-6 col-xl-4"><div class="card eq-card ' + cls + '" style="--eq-color:' + esc(eq.color || '#004191') + '"><div class="card-body d-flex flex-column">'
      + '<div class="d-flex align-items-start justify-content-between gap-2"><div><h3 class="eq-name">' + esc(eq.name) + '</h3><div class="eq-meta">' + [eq.location, eq.model, eq.managerName ? '담당 ' + eq.managerName : ''].filter(Boolean).map(esc).join(' · ') + '</div></div>'
      + '<span class="badge bg-' + badge + '-lt eq-status text-nowrap"><span class="status-dot ' + dot + '"></span>' + st + '</span></div>';
    if (opens.length) {
      html += '<div class="mt-2">' + opens.map(function (o) {
        return '<div class="eq-since"><i class="ti ti-user me-1"></i><b>' + esc(o.userName) + '</b>' + (o.userId === s.user.id ? ' (나)' : '') + ' · ' + fmtDateTime(o.start) + ' 시작 · ' + fmtDuration(minutesSince(o.start)) + ' 경과' + (o.purpose ? '<br><span class="ms-4">' + esc(o.purpose) + '</span>' : '') + '</div>';
      }).join('') + '</div>';
    }
    if (eq.issue) {
      html += '<div class="alert alert-danger py-2 px-3 mt-2 mb-0 small"><i class="ti ti-alert-triangle me-1"></i><b>' + esc(eq.issue.note) + '</b><div class="text-secondary">' + esc(eq.issue.by) + ' · ' + fmtDateTime(eq.issue.at) + '</div>'
        + (canResolve(eq) ? '<button type="button" class="btn btn-sm btn-outline-danger mt-2" data-action="resolve" data-id="' + esc(eq.id) + '"><i class="ti ti-tool me-1"></i>점검 완료</button>' : '<div class="text-secondary mt-1">담당자' + (eq.managerName ? '(' + esc(eq.managerName) + ')' : '') + ' 또는 관리자가 점검 완료 처리합니다.</div>') + '</div>';
    }
    html += '<div class="mt-auto pt-3 d-flex flex-wrap gap-2">'
      + (mine ? '<button type="button" class="btn btn-warning" data-action="close" data-id="' + esc(mine.id) + '"><i class="ti ti-player-stop me-1"></i>사용 종료</button>'
        : '<button type="button" class="btn btn-primary" data-action="start" data-id="' + esc(eq.id) + '"' + (canStart ? '' : ' disabled') + '><i class="ti ti-player-play me-1"></i>사용 시작</button>')
      + '<a href="sheet/index.html?eq=' + encodeURIComponent(eq.id) + '" class="btn btn-outline-primary"><i class="ti ti-clipboard-list me-1"></i>로그시트</a>'
      + '</div></div></div></div>';
    return html;
  }

  function renderRecent() {
    var html = '<div class="card mt-4"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>최근 기록</h3><div class="card-actions"><a href="sheet/index.html" class="btn btn-sm">전체 로그시트 <i class="ti ti-chevron-right ms-1"></i></a></div></div>';
    if (!state.recent.length) return html + '<div class="card-body text-secondary small">아직 기록이 없습니다. 장비 카드의 "사용 시작"으로 첫 기록을 남기세요.</div></div>';
    html += '<div class="table-responsive"><table class="table table-vcenter card-table ls-table"><thead><tr><th class="w-1">일시</th><th>장비</th><th>사용자</th><th>시료 · 내용</th><th class="w-1">상태</th></tr></thead><tbody>'
      + state.recent.map(function (e) {
        var eq = eqById(e.equipmentId);
        var st = e.status === 'open' ? '<span class="badge bg-yellow-lt">사용 중</span>' : e.condition === 'issue' ? '<span class="badge bg-red-lt">이상</span>' : '<span class="badge bg-green-lt">정상</span>';
        return '<tr' + (e.status === 'open' ? ' class="is-open"' : '') + '><td class="text-nowrap">' + fmtDate(e.start) + ' ' + fmtTime(e.start) + (e.end ? ' ~ ' + fmtTime(e.end) : '') + '</td><td>' + esc(eq ? eq.name : '-') + '</td><td class="text-nowrap">' + esc(e.userName) + '</td><td>' + (e.sample ? '<b>' + esc(e.sample) + '</b> · ' : '') + esc(e.purpose) + '</td><td>' + st + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }

  function renderHome() {
    var s = state.session;
    var list = state.equipment.filter(function (e) { return e.active !== false || s.isAdmin; });
    var html = '<div class="eq-grid">'
      + '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div><h3 class="mb-0">장비 현황</h3><div class="text-secondary small">쓰기 전에 <b>사용 시작</b>, 끝나면 <b>사용 종료</b>를 눌러 로그시트를 채웁니다.</div></div>'
      + '<div class="d-flex flex-wrap gap-2"><button type="button" class="btn" data-action="manual"><i class="ti ti-pencil-plus me-1"></i>지난 사용 기록 입력</button>'
      + (s.isAdmin ? '<a href="sheet/index.html#tab=admin" class="btn btn-outline-primary"><i class="ti ti-settings me-1"></i>장비 관리</a>' : '') + '</div></div>';
    if (!list.length) html += '<div class="card">' + empty('device-desktop-off', '등록된 장비가 없습니다', s.isAdmin ? '로그시트 페이지의 관리자 탭에서 장비를 추가하세요.' : '관리자에게 장비 등록을 요청하세요.') + '</div>';
    else html += '<div class="row g-3">' + list.map(eqCard).join('') + '</div>';
    html += renderRecent() + '</div>';
    if (s.isAdmin) html += renderAdmin();
    return html;
  }

  /* ---------- 관리자: 가입 승인·계정·보안 ---------- */
  function renderAdmin() {
    var pending = state.accounts.filter(function (a) { return a.status === 'pending'; });
    var others = state.accounts.filter(function (a) { return a.status !== 'pending'; });
    var html = '<div class="eq-grid mt-4"><div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-user-plus me-1 text-primary"></i>가입 신청 ' + (pending.length ? '<span class="badge bg-yellow-lt ms-1">' + pending.length + '</span>' : '') + '</h3></div>';
    if (!pending.length) html += '<div class="card-body text-secondary small">대기 중인 가입 신청이 없습니다.</div>';
    else {
      html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>이름</th><th>신청일</th><th class="w-1"></th></tr></thead><tbody>'
        + pending.map(function (a) { return '<tr><td class="fw-medium">' + esc(a.name) + (a.email ? ' <span class="text-secondary small">' + esc(a.email) + '</span>' : '') + '</td><td class="text-secondary text-nowrap">' + fmtDateTime(a.createdAt) + '</td><td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-primary" data-action="approve" data-id="' + esc(a.id) + '"><i class="ti ti-check me-1"></i>승인</button> <button type="button" class="btn btn-sm btn-outline-danger" data-action="reject" data-id="' + esc(a.id) + '">거절</button></td></tr>'; }).join('')
        + '</tbody></table></div>';
    }
    html += '</div><div class="card"><div class="card-header"><h3 class="card-title"><i class="ti ti-users me-1 text-primary"></i>계정 <span class="text-secondary fw-normal">' + others.length + '개</span></h3></div>'
      + '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>이름</th><th>권한</th><th>상태</th><th>승인</th><th class="w-1"></th></tr></thead><tbody>'
      + others.map(function (a) {
        var st = STATUS[a.status] || STATUS.pending;
        var self = state.session && a.id === state.session.user.id;
        return '<tr><td class="fw-medium">' + esc(a.name) + (a.email ? ' <span class="text-secondary small">' + esc(a.email) + '</span>' : '') + (self ? ' <span class="badge bg-blue-lt">나</span>' : '') + '</td>'
          + '<td>' + (a.role === 'admin' ? '<span class="badge bg-primary text-white">관리자</span>' : '<span class="badge bg-secondary-lt">구성원</span>') + '</td>'
          + '<td><span class="badge ' + st.cls + '">' + st.label + '</span></td>'
          + '<td class="text-secondary small text-nowrap">' + (a.approvedAt ? fmtDate(a.approvedAt) + (a.approvedBy ? ' · ' + esc(a.approvedBy) : '') : '-') + '</td>'
          + '<td class="text-end text-nowrap">'
          + (store.mode === 'local' ? '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="reset-pin" data-id="' + esc(a.id) + '" title="PIN 재설정"><i class="ti ti-key"></i></button>' : '')
          + (!self ? '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="toggle-role" data-id="' + esc(a.id) + '" data-role="' + (a.role === 'admin' ? 'member' : 'admin') + '" title="' + (a.role === 'admin' ? '구성원으로' : '관리자로') + '"><i class="ti ti-' + (a.role === 'admin' ? 'user-down' : 'user-up') + '"></i></button>' : '')
          + (!self ? '<button type="button" class="btn btn-sm btn-ghost-' + (a.status === 'active' ? 'danger' : 'secondary') + ' btn-icon" data-action="toggle-status" data-id="' + esc(a.id) + '" data-status="' + (a.status === 'active' ? 'disabled' : 'active') + '" title="' + (a.status === 'active' ? '사용 중지' : '사용 재개') + '"><i class="ti ti-' + (a.status === 'active' ? 'user-off' : 'user-check') + '"></i></button>' : '')
          + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';

    var TYPES = { login_failed: { label: '로그인 실패', cls: 'bg-yellow-lt' }, login_lockout: { label: '로그인 잠금', cls: 'bg-red-lt' }, login_locked_attempt: { label: '잠금 중 시도', cls: 'bg-orange-lt' }, macro_suspect: { label: '매크로 의심', cls: 'bg-red-lt' } };
    var dayAgo = Date.now() - 86400000;
    var recentHigh = state.events.filter(function (e) { return e.severity === 'high' && new Date(e.createdAt) > dayAgo; }).length;
    html += '<div class="card mt-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-shield-lock me-1 text-primary"></i>보안 이벤트 ' + (recentHigh ? '<span class="badge bg-red-lt ms-1">24시간 내 ' + recentHigh + '건</span>' : '')
      + '</h3><div class="card-actions small text-secondary">' + (CFG.security && CFG.security.alertWebhookUrl ? '웹훅 알림 켜짐' : '웹훅 알림 꺼짐 · config.js security.alertWebhookUrl') + '</div></div>';
    if (!state.events.length) html += '<div class="card-body text-secondary small">기록된 보안 이벤트가 없습니다. 로그인 ' + SEC.maxLoginFailures + '회 연속 실패 시 ' + SEC.lockoutMinutes + '분 잠금, 페이지가 뜬 뒤 ' + SEC.macroThresholdMs + 'ms 안의 제출은 매크로 의심으로 기록됩니다.</div>';
    else {
      html += '<div class="table-responsive" style="max-height:360px;overflow:auto"><table class="table table-sm table-vcenter card-table"><thead><tr><th class="w-1">일시</th><th class="w-1">종류</th><th>이름</th><th>내용</th><th>페이지</th></tr></thead><tbody>'
        + state.events.slice(0, 100).map(function (e) {
          var t = TYPES[e.type] || { label: e.type, cls: 'bg-secondary-lt' };
          return '<tr><td class="text-nowrap text-secondary">' + fmtDateTime(e.createdAt) + '</td><td><span class="badge ' + t.cls + '">' + esc(t.label) + '</span></td><td class="text-nowrap">' + esc(e.name || '-') + '</td><td class="small">' + esc(e.detail) + '</td><td class="small text-secondary">' + esc(e.page) + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    html += '</div></div>';
    return html;
  }

  function goNext() { if (state.next) { window.location.replace(state.next); return true; } return false; }

  function signupDialog() {
    var body = '<div class="mb-3"><label class="form-label required">이름</label><input type="text" class="form-control" name="name" required placeholder="실명" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label required">PIN</label><input type="password" class="form-control" name="pin" required inputmode="numeric" autocomplete="new-password" placeholder="숫자 4~8자리"></div>'
      + '<div class="col-6"><label class="form-label required">PIN 확인</label><input type="password" class="form-control" name="pin2" required inputmode="numeric" autocomplete="new-password"></div></div>'
      + '<div class="text-secondary small mt-3">신청 후 관리자가 승인하면 이 이름과 PIN으로 로그인할 수 있습니다.</div>';
    return dialog({ title: '회원가입 신청', bodyHtml: body, okLabel: '신청' }).then(function (v) {
      if (!v) return;
      if (!/^\d{4,8}$/.test(v.pin)) { toast('PIN은 숫자 4~8자리입니다.', true); return; }
      if (v.pin !== v.pin2) { toast('PIN 확인이 일치하지 않습니다.', true); return; }
      return store.signUp({ name: v.name, pin: v.pin }).then(function (a) { toast(a.name + '님의 가입 신청을 접수했습니다. 관리자 승인을 기다려 주세요.'); });
    });
  }

  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (form.id !== 'login-form') return;
    e.preventDefault();
    var v = readForm(form);
    var who = v.name || v.email || '';
    var elapsed = Date.now() - LOAD_AT;
    if (elapsed < SEC.macroThresholdMs) store.securityEvent({ type: 'macro_suspect', severity: 'high', name: who, detail: '페이지가 뜬 뒤 ' + elapsed + 'ms 만에 로그인 제출' });
    var until = lockedUntil(who);
    if (until) {
      var mins = Math.ceil((until - Date.now()) / 60000);
      store.securityEvent({ type: 'login_locked_attempt', severity: 'low', name: who, detail: '잠금 중 로그인 시도 (' + mins + '분 남음)' });
      toast('로그인 실패가 많아 ' + mins + '분 동안 잠겨 있습니다.', true);
      return;
    }
    store.signIn(v).then(function (res) {
      if (res && res.magicLinkSent) { state.magicLinkSent = true; render(); return; }
      clearFailure(who);
      if (goNext()) return;
      toast(res.user.name + '님, 환영합니다.');
      return refresh();
    }).catch(function (err) {
      var f = noteFailure(who);
      if (f.lockedUntil && f.lockedUntil > Date.now()) {
        store.securityEvent({ type: 'login_lockout', severity: 'high', name: who, detail: f.count + '회 연속 실패로 ' + SEC.lockoutMinutes + '분 잠금 (' + (err && err.message ? err.message : '') + ')' });
        toast('로그인 실패가 ' + f.count + '회를 넘어 ' + SEC.lockoutMinutes + '분 동안 잠깁니다.', true);
        return;
      }
      store.securityEvent({ type: 'login_failed', severity: 'low', name: who, detail: (err && err.message ? err.message : '실패') + ' (' + f.count + '/' + SEC.maxLoginFailures + ')' });
      handleError(err);
    });
  });

  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    var id = btn.getAttribute('data-id');
    switch (action) {
      case 'start':
        F.startDialog(store, state.equipment, id).then(function (r) { if (r) { toast('사용 시작을 기록했습니다. 끝나면 "사용 종료"를 눌러 주세요.'); return refresh(); } }).catch(handleError);
        break;
      case 'close': {
        var entry = state.open.filter(function (o) { return o.id === id; })[0];
        if (!entry) { toast('기록을 찾을 수 없습니다.', true); break; }
        F.closeDialog(store, entry, eqById(entry.equipmentId)).then(function (r) { if (r) { toast(r.condition === 'issue' ? '종료를 기록하고 이상 보고를 남겼습니다.' : '사용 종료를 기록했습니다.'); return refresh(); } }).catch(handleError);
        break;
      }
      case 'manual':
        F.entryDialog(store, state.equipment, null).then(function (r) { if (r) { toast('기록을 저장했습니다.'); return refresh(); } }).catch(handleError);
        break;
      case 'resolve':
        promptDlg({ title: '점검 완료', message: '조치 내용을 적으면 변경 이력에 남습니다.', input: 'textarea', placeholder: '예: 척 진공 라인 교체, 정상 확인', okLabel: '점검 완료' })
          .then(function (note) { if (note === null) return; return store.resolveIssue(id, note).then(function () { toast('점검 완료로 처리했습니다.'); return refresh(); }); }).catch(handleError);
        break;
      case 'signup': signupDialog().catch(handleError); break;
      case 'signout': store.signOut().then(function () { state.magicLinkSent = false; return refresh(); }); break;
      case 'approve': store.approveAccount(id).then(function () { toast('승인했습니다.'); return refresh(); }).catch(handleError); break;
      case 'reject':
        confirmDlg({ title: '가입 거절', message: '이 가입 신청을 거절할까요?', okLabel: '거절', danger: true }).then(function (ok) { if (!ok) return; return store.rejectAccount(id).then(function () { toast('거절했습니다.'); return refresh(); }); }).catch(handleError);
        break;
      case 'toggle-role': store.setAccountRole(id, btn.getAttribute('data-role')).then(function () { toast('권한을 바꿨습니다.'); return refresh(); }).catch(handleError); break;
      case 'toggle-status': store.setAccountStatus(id, btn.getAttribute('data-status')).then(function () { toast('상태를 바꿨습니다.'); return refresh(); }).catch(handleError); break;
      case 'reset-pin':
        promptDlg({ title: 'PIN 재설정', message: '새 PIN을 입력하세요.', input: 'password', placeholder: '숫자 4~8자리', okLabel: '재설정' }).then(function (pin) { if (pin === null) return; return store.resetAccountPin(id, pin).then(function () { toast('PIN을 재설정했습니다.'); }); }).catch(handleError);
        break;
      case 'change-pin': {
        var body = '<div class="mb-3"><label class="form-label required">현재 PIN</label><input type="password" class="form-control" name="oldPin" required inputmode="numeric"></div><div class="mb-0"><label class="form-label required">새 PIN</label><input type="password" class="form-control" name="newPin" required inputmode="numeric" placeholder="숫자 4~8자리"></div>';
        dialog({ title: 'PIN 변경', bodyHtml: body, okLabel: '변경' }).then(function (v) { if (!v) return; return store.changeMyPin(v.oldPin, v.newPin).then(function () { toast('PIN을 변경했습니다.'); }); }).catch(handleError);
        break;
      }
    }
  });

  /* 사용 중 경과 시간을 1분마다 갱신 */
  setInterval(function () { if (state.session && state.open.length && !document.querySelector('.modal.is-open')) render(); }, 60000);

  store.init().then(function () {
    state.ready = true;
    store.onChange(function () { reload().then(render).catch(handleError); });
    return reload();
  }).then(function () {
    if (state.session && state.session.status !== 'pending' && goNext()) return;
    render();
  }).catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
