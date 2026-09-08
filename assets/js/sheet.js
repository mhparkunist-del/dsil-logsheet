/* =====================================================================
   DSIL Log Sheet – 로그시트 페이지
   탭: 로그시트(조회·CSV·인쇄) / 기록 작성 / 내 기록 / 관리자(장비·이상 보고·변경 이력·데이터)
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, F = window.DSILForms, S = window.DSILStore;
  var esc = U.esc, fmtDate = U.fmtDate, fmtTime = U.fmtTime, fmtDateTime = U.fmtDateTime, fmtDuration = U.fmtDuration, localDate = U.localDate, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, promptDlg = U.promptDlg, empty = U.empty, csvCell = U.csvCell, download = U.download, stat = U.stat;
  var store = S.create(CFG);
  var LS = Object.assign({ editWindowDays: 7, printBlankRows: 5 }, CFG.logsheet || {});
  var TEMPLATES = CFG.fieldTemplates || {};
  var UNLOCK_KEY = 'dsil-logsheet-admin-unlock';
  var TABS = [
    { id: 'sheet', label: '로그시트', icon: 'clipboard-list' },
    { id: 'write', label: '기록 작성', icon: 'pencil-plus' },
    { id: 'mine', label: '내 기록', icon: 'user' },
    { id: 'admin', label: '관리자', icon: 'settings', admin: true }
  ];
  var PRESETS = [['month', '이번 달'], ['prev', '지난 달'], ['30', '최근 30일'], ['90', '최근 90일'], ['year', '올해'], ['all', '전체'], ['custom', '직접 입력']];
  var ACTIONS = { start: '사용 시작', close: '사용 종료', create: '직접 기록', update: '수정', delete: '삭제', restore: '복구', issue: '이상 보고', resolve: '점검 완료', equipment: '장비' };
  var ACTION_CLS = { start: 'bg-blue-lt', close: 'bg-green-lt', create: 'bg-cyan-lt', update: 'bg-yellow-lt', delete: 'bg-red-lt', restore: 'bg-secondary-lt', issue: 'bg-red-lt', resolve: 'bg-green-lt', equipment: 'bg-purple-lt' };
  var TYPE_LABELS = { text: '텍스트', number: '숫자', select: '선택', textarea: '긴 글' };

  var state = { ready: false, error: null, session: null, tab: 'sheet', equipment: [], entries: [], mine: [], audit: [], accounts: [],
    filter: { equipmentId: '', preset: 'month', from: '', to: '', userId: '', q: '', deleted: false }, print: false, editEq: null };

  function eqById(id) { return state.equipment.filter(function (e) { return e.id === id; })[0] || null; }
  function minutes(e) { var end = e.end ? new Date(e.end) : new Date(); return Math.max(0, (end - new Date(e.start)) / 60000); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function readUrl() {
    var m = /tab=([a-z]+)/.exec(window.location.hash);
    state.tab = (m && TABS.some(function (t) { return t.id === m[1]; })) ? m[1] : 'sheet';
  }
  (function () { try { var eq = new URLSearchParams(window.location.search).get('eq'); if (eq) state.filter.equipmentId = eq; } catch (e) { /* ignore */ } })();

  function presetRange(f) {
    var now = new Date(), y = now.getFullYear(), m = now.getMonth();
    function d(dt) { return localDate(dt.toISOString()); }
    switch (f.preset) {
      case 'month': return { from: d(new Date(y, m, 1)), to: d(now) };
      case 'prev': return { from: d(new Date(y, m - 1, 1)), to: d(new Date(y, m, 0)) };
      case '30': return { from: d(new Date(now.getTime() - 29 * 86400000)), to: d(now) };
      case '90': return { from: d(new Date(now.getTime() - 89 * 86400000)), to: d(now) };
      case 'year': return { from: d(new Date(y, 0, 1)), to: d(now) };
      case 'custom': return { from: f.from || '', to: f.to || '' };
      default: return { from: '', to: '' };
    }
  }

  /* ---------- 관리자 PIN 게이트 ---------- */
  function isUnlocked() { try { return Number(sessionStorage.getItem(UNLOCK_KEY) || 0) > Date.now(); } catch (e) { return false; } }
  function ensureAdmin() {
    var s = store.getSession();
    if (!s || !s.isAdmin) return Promise.resolve(false);
    if (isUnlocked()) return Promise.resolve(true);
    return promptDlg({ title: '관리자 PIN', message: '관리자 탭에 들어가려면 PIN을 입력하세요.', input: 'password', placeholder: 'PIN', okLabel: '확인' }).then(function (pin) {
      if (pin === null) return false;
      return store.verifyAdminPin(pin).then(function (ok) {
        if (!ok) { toast('PIN이 올바르지 않습니다.', true); return false; }
        try { sessionStorage.setItem(UNLOCK_KEY, String(Date.now() + (CFG.adminUnlockMinutes || 10) * 60000)); } catch (e) { /* ignore */ }
        return true;
      });
    });
  }
  function guardTab() {
    if (state.tab !== 'admin') return Promise.resolve();
    return ensureAdmin().then(function (ok) { if (!ok) { state.tab = 'sheet'; try { history.replaceState(null, '', '#tab=sheet'); } catch (e) { /* ignore */ } } });
  }

  function reload() {
    state.session = store.getSession();
    if (!state.session || state.session.status === 'pending') return Promise.resolve();
    var r = presetRange(state.filter);
    var opts = { from: r.from, to: r.to, includeDeleted: !!(state.filter.deleted && state.session.isAdmin) };
    if (state.filter.equipmentId) opts.equipmentId = state.filter.equipmentId;
    var jobs = { equipment: store.listEquipment(), entries: store.listEntries(opts) };
    if (state.tab === 'mine' || state.tab === 'write') jobs.mine = store.listEntries({ userId: state.session.user.id });
    if (state.tab === 'admin' && state.session.isAdmin) { jobs.audit = store.listAudit(); jobs.accounts = store.listAccounts(); }
    var keys = Object.keys(jobs);
    return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (res) { keys.forEach(function (k, i) { state[k] = res[i]; }); });
  }

  /* ---------- 렌더 ---------- */
  function render() {
    var app = $('#app');
    renderChrome();
    if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">초기화 오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    if (!state.session) { window.location.replace('../index.html?next=sheet'); return; }
    if (state.session.status === 'pending') { window.location.replace('../index.html'); return; }
    document.body.classList.toggle('print-mode', state.print);
    if (state.print) { app.innerHTML = renderPrint(); return; }
    var body = state.tab === 'write' ? renderWrite() : state.tab === 'mine' ? renderMine() : state.tab === 'admin' ? renderAdmin() : renderSheet();
    app.innerHTML = renderTabs() + body;
    var ff = $('#filter-form'); if (ff) U.applyShowIf(ff);
  }

  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    if (!state.session) { slot.innerHTML = ''; return; }
    var s = state.session;
    slot.innerHTML = '<div class="d-flex align-items-center gap-2"><span class="avatar avatar-sm ' + (s.isAdmin ? 'bg-primary text-white' : 'bg-blue-lt') + '">' + esc((s.user.name || '?').trim().charAt(0)) + '</span>'
      + '<div class="d-none d-md-block lh-1"><div class="small fw-medium">' + esc(s.user.name) + '</div><div class="small text-secondary mt-1">' + (s.isAdmin ? '관리자' : '구성원') + '</div></div>'
      + '<button type="button" class="btn btn-sm btn-ghost-secondary" data-action="signout"><i class="ti ti-logout"></i><span class="d-none d-sm-inline ms-1">로그아웃</span></button></div>';
  }

  function renderTabs() {
    return '<ul class="nav nav-tabs mb-3" role="tablist">' + TABS.filter(function (t) { return !t.admin || state.session.isAdmin; }).map(function (t) {
      return '<li class="nav-item"><a class="nav-link' + (state.tab === t.id ? ' active' : '') + '" href="#tab=' + t.id + '"><i class="ti ti-' + t.icon + ' me-1"></i>' + t.label + '</a></li>';
    }).join('') + '</ul>';
  }

  function visibleEntries() {
    var f = state.filter, q = (f.q || '').trim().toLowerCase();
    return state.entries.filter(function (e) {
      if (f.userId && e.userId !== f.userId) return false;
      if (q) {
        var hay = [e.userName, e.sample, e.purpose, e.note, e.issues].concat(Object.keys(e.values || {}).map(function (k) { return e.values[k]; })).join(' ').toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function condHtml(e, eq) {
    var fm = S.fieldMap(eq), keys = Object.keys(e.values || {});
    if (!keys.length) return '<span class="text-secondary">-</span>';
    return '<div class="ls-cond">' + keys.map(function (k) { var f = fm[k]; return '<span>' + esc(f ? f.label : k) + ' <b>' + esc(e.values[k]) + (f && f.unit ? ' ' + esc(f.unit) : '') + '</b></span>'; }).join('') + '</div>';
  }
  function condText(e, eq) { var fm = S.fieldMap(eq); return Object.keys(e.values || {}).map(function (k) { return (fm[k] ? fm[k].label : k) + ': ' + e.values[k] + (fm[k] && fm[k].unit ? ' ' + fm[k].unit : ''); }).join('; '); }
  function statusBadge(e) {
    if (e.deleted) return '<span class="badge bg-secondary-lt">삭제됨</span>';
    if (e.status === 'open') return '<span class="badge bg-yellow-lt">사용 중</span>';
    return e.condition === 'issue' ? '<span class="badge bg-red-lt">이상</span>' : '<span class="badge bg-green-lt">정상</span>';
  }
  function timeCell(e) {
    var s = fmtTime(e.start), en = e.end ? fmtTime(e.end) : '';
    if (e.end && localDate(e.end) !== localDate(e.start)) en = fmtDate(e.end).slice(5) + ' ' + en;
    return s + ' ~ ' + (en || '<span class="text-warning">진행 중</span>') + '<span class="sub">' + fmtDuration(minutes(e)) + (e.end ? '' : ' 경과') + '</span>';
  }
  function btn(action, id, icon, title, cls) { return '<button type="button" class="btn btn-sm btn-ghost-' + (cls || 'secondary') + ' btn-icon" data-action="' + action + '" data-id="' + esc(id) + '" title="' + esc(title) + '"><i class="ti ti-' + icon + '"></i></button>'; }
  function rowActions(e) {
    var s = state.session, out = [], mine = e.userId === s.user.id;
    if (e.deleted) { if (s.isAdmin) out.push(btn('restore', e.id, 'arrow-back-up', '복구')); return out.join(''); }
    if (e.status === 'open' && (mine || s.isAdmin)) out.push('<button type="button" class="btn btn-sm btn-warning me-1" data-action="close" data-id="' + esc(e.id) + '"><i class="ti ti-player-stop me-1"></i>종료</button>');
    if (store.canEdit(e)) out.push(btn('edit', e.id, 'pencil', '수정'));
    if (s.isAdmin || (mine && e.status === 'open')) out.push(btn('delete', e.id, 'trash', (mine && e.status === 'open' && !s.isAdmin) ? '시작 취소' : '삭제', 'danger'));
    return out.join('');
  }
  function entryRow(e, showEq) {
    var eq = eqById(e.equipmentId);
    var cls = e.deleted ? ' class="is-deleted"' : e.status === 'open' ? ' class="is-open"' : '';
    return '<tr' + cls + '><td class="text-nowrap">' + fmtDate(e.start) + '</td><td class="text-nowrap tnum">' + timeCell(e) + '</td>' + (showEq ? '<td>' + (eq ? esc(eq.name) : '<span class="text-secondary">(삭제된 장비)</span>') + '</td>' : '')
      + '<td class="text-nowrap">' + esc(e.userName) + (e.updatedBy ? '<span class="sub">수정 ' + esc(e.updatedBy) + ' · ' + fmtDateTime(e.updatedAt) + '</span>' : '') + '</td>'
      + '<td>' + esc(e.sample || '-') + '</td><td>' + esc(e.purpose) + (e.issues ? '<span class="sub text-red"><i class="ti ti-alert-triangle"></i> ' + esc(e.issues) + '</span>' : '') + '</td>'
      + '<td>' + condHtml(e, eq) + '</td><td>' + statusBadge(e) + '</td><td class="small">' + esc(e.note || '') + (e.deleted ? '<span class="sub">삭제 ' + esc(e.deletedBy || '') + ' · ' + esc(e.deleteReason || '') + '</span>' : '') + '</td>'
      + '<td class="text-end text-nowrap">' + rowActions(e) + '</td></tr>';
  }

  function renderSheetResults() {
    var eq = state.filter.equipmentId ? eqById(state.filter.equipmentId) : null;
    var rows = visibleEntries();
    var live = rows.filter(function (e) { return !e.deleted; });
    var total = live.reduce(function (a, e) { return a + minutes(e); }, 0);
    var users = {}; live.forEach(function (e) { users[e.userId] = 1; });
    var issues = live.filter(function (e) { return e.condition === 'issue'; }).length;
    var opens = live.filter(function (e) { return e.status === 'open'; }).length;
    var html = '<div class="row g-3 mb-3">' + stat('기록', rows.length + '건', opens ? '사용 중 ' + opens + '건' : '') + stat('총 사용 시간', fmtDuration(total), '') + stat('사용자', Object.keys(users).length + '명', '') + stat('이상 보고', issues + '건', '', issues ? 'text-red' : '') + '</div>';
    if (eq && (eq.rules || eq.managerName)) html += '<div class="alert alert-info py-2 px-3"><b>' + esc(eq.name) + '</b>' + (eq.managerName ? ' · 담당 ' + esc(eq.managerName) : '') + (eq.rules ? '<div class="small mt-1" style="white-space:pre-wrap">' + esc(eq.rules) + '</div>' : '') + '</div>';
    html += '<div class="card">' + (rows.length
      ? '<div class="table-responsive"><table class="table table-vcenter card-table ls-table"><thead><tr><th class="w-1">날짜</th><th class="w-1">시간</th>' + (eq ? '' : '<th>장비</th>') + '<th>사용자</th><th>시료/소자</th><th>목적·내용</th><th>조건</th><th class="w-1">상태</th><th>비고</th><th class="w-1"></th></tr></thead><tbody>' + rows.map(function (e) { return entryRow(e, !eq); }).join('') + '</tbody></table></div>'
      : empty('clipboard-off', '기록이 없습니다', '조건을 바꾸거나 "사용 시작"으로 첫 기록을 남기세요.')) + '</div>';
    return html;
  }

  function renderSheet() {
    var f = state.filter, admin = state.session.isAdmin;
    var users = {}; state.entries.forEach(function (e) { users[e.userId] = e.userName; });
    var html = '<div class="card mb-3"><div class="card-body"><form id="filter-form" class="row g-2 align-items-end ls-filter">'
      + '<div class="col-6 col-md-3"><label class="form-label">장비</label><select class="form-select" name="equipmentId"><option value="">전체 장비</option>' + state.equipment.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === f.equipmentId ? ' selected' : '') + '>' + esc(e.name) + (e.active === false ? ' (비활성)' : '') + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">기간</label><select class="form-select" name="preset">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (p[0] === f.preset ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2" data-show-if="preset=custom"><label class="form-label">시작일</label><input type="date" class="form-control" name="from" value="' + esc(f.from) + '"></div>'
      + '<div class="col-6 col-md-2" data-show-if="preset=custom"><label class="form-label">종료일</label><input type="date" class="form-control" name="to" value="' + esc(f.to) + '"></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">사용자</label><select class="form-select" name="userId"><option value="">전체</option>' + Object.keys(users).map(function (id) { return '<option value="' + esc(id) + '"' + (id === f.userId ? ' selected' : '') + '>' + esc(users[id]) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">검색</label><input type="search" class="form-control" name="q" value="' + esc(f.q) + '" placeholder="시료, 내용, 비고, 이름" autocomplete="off"></div>'
      + (admin ? '<div class="col-auto"><label class="form-check mb-2"><input class="form-check-input" type="checkbox" name="deleted"' + (f.deleted ? ' checked' : '') + '><span class="form-check-label">삭제 포함</span></label></div>' : '')
      + '<div class="col-12 col-lg-auto ms-lg-auto d-flex flex-wrap gap-2"><button type="button" class="btn" data-action="csv"><i class="ti ti-file-spreadsheet me-1"></i>CSV</button><button type="button" class="btn btn-outline-primary" data-action="print"><i class="ti ti-printer me-1"></i>인쇄용 보기</button><button type="button" class="btn btn-primary" data-action="start"><i class="ti ti-player-play me-1"></i>사용 시작</button></div>'
      + '</form></div></div>';
    return html + '<div id="sheet-results">' + renderSheetResults() + '</div>';
  }

  function openRows(list, withEq) {
    return list.map(function (e) {
      var eq = eqById(e.equipmentId);
      return '<tr class="is-open">' + (withEq ? '<td>' + esc(eq ? eq.name : '') + '</td>' : '') + '<td class="text-nowrap">' + fmtDateTime(e.start) + '<span class="sub">' + fmtDuration(minutes(e)) + ' 경과</span></td><td>' + esc(e.sample || '-') + '</td><td>' + esc(e.purpose) + '</td><td class="text-end text-nowrap">' + rowActions(e) + '</td></tr>';
    }).join('');
  }

  function renderWrite() {
    var opens = state.mine.filter(function (e) { return e.status === 'open'; });
    var html = '<div class="row g-3">'
      + '<div class="col-md-6"><div class="card h-100"><div class="card-body"><div class="d-flex align-items-center gap-2 mb-2"><span class="avatar bg-blue-lt"><i class="ti ti-player-play"></i></span><h3 class="card-title mb-0">지금 사용 시작</h3></div>'
      + '<p class="text-secondary">장비를 쓰기 시작할 때 누릅니다. 장비 카드에 "사용 중"으로 표시되고, 끝나면 <b>사용 종료</b>에서 조건·장비 상태·비고를 채웁니다.</p><button type="button" class="btn btn-primary" data-action="start"><i class="ti ti-player-play me-1"></i>사용 시작</button></div></div></div>'
      + '<div class="col-md-6"><div class="card h-100"><div class="card-body"><div class="d-flex align-items-center gap-2 mb-2"><span class="avatar bg-cyan-lt"><i class="ti ti-pencil-plus"></i></span><h3 class="card-title mb-0">지난 사용 기록 입력</h3></div>'
      + '<p class="text-secondary">시작 버튼을 누르지 못했거나 종이 로그시트를 옮겨 적을 때, 시작·종료 시각과 조건을 한 번에 입력합니다. 기록은 작성 후 ' + LS.editWindowDays + '일 안에 본인이 고칠 수 있고 그 뒤에는 관리자만 고칩니다.</p><button type="button" class="btn" data-action="manual"><i class="ti ti-pencil-plus me-1"></i>기록 입력</button></div></div></div>'
      + '</div>';
    if (opens.length) html += '<div class="card mt-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-clock-play me-1 text-warning"></i>사용 중인 내 기록</h3></div><div class="table-responsive"><table class="table table-vcenter card-table ls-table"><thead><tr><th>장비</th><th>시작</th><th>시료/소자</th><th>목적·내용</th><th class="w-1"></th></tr></thead><tbody>' + openRows(opens, true) + '</tbody></table></div></div>';
    return html;
  }

  function renderMine() {
    var rows = state.mine;
    if (!rows.length) return '<div class="card">' + empty('clipboard-text', '내 기록이 없습니다', '"기록 작성" 탭에서 사용 시작을 누르거나 지난 기록을 입력하세요.') + '</div>';
    var opens = rows.filter(function (e) { return e.status === 'open'; }), closed = rows.filter(function (e) { return e.status !== 'open'; });
    var html = '';
    if (opens.length) html += '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-clock-play me-1 text-warning"></i>사용 중</h3></div><div class="table-responsive"><table class="table table-vcenter card-table ls-table"><thead><tr><th>장비</th><th>시작</th><th>시료/소자</th><th>목적·내용</th><th class="w-1"></th></tr></thead><tbody>' + openRows(opens, true) + '</tbody></table></div></div>';
    html += '<div class="card"><div class="card-header"><h3 class="card-title">내 기록 <span class="text-secondary fw-normal">' + closed.length + '건</span></h3><div class="card-actions small text-secondary">작성 후 ' + LS.editWindowDays + '일까지 수정 가능</div></div>';
    if (!closed.length) html += '<div class="card-body text-secondary small">종료된 기록이 없습니다.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table ls-table"><thead><tr><th class="w-1">날짜</th><th class="w-1">시간</th><th>장비</th><th>시료/소자</th><th>목적·내용</th><th>조건</th><th class="w-1">상태</th><th class="w-1">수정 기한</th><th class="w-1"></th></tr></thead><tbody>'
      + closed.slice(0, 300).map(function (e) {
        var eq = eqById(e.equipmentId);
        var until = new Date(new Date(e.createdAt).getTime() + LS.editWindowDays * 86400000);
        var ok = store.canEdit(e);
        return '<tr><td class="text-nowrap">' + fmtDate(e.start) + '</td><td class="text-nowrap tnum">' + timeCell(e) + '</td><td>' + esc(eq ? eq.name : '') + '</td><td>' + esc(e.sample || '-') + '</td><td>' + esc(e.purpose) + (e.issues ? '<span class="sub text-red">' + esc(e.issues) + '</span>' : '') + '</td><td>' + condHtml(e, eq) + '</td><td>' + statusBadge(e) + '</td>'
          + '<td class="text-nowrap small ' + (ok ? '' : 'text-secondary') + '">' + (state.session.isAdmin ? '관리자' : ok ? '~ ' + fmtDate(until.toISOString()) : '마감') + '</td><td class="text-end text-nowrap">' + rowActions(e) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return html + '</div>';
  }

  /* ---------- 관리자 ---------- */
  function fieldRowHtml(f) {
    f = f || {};
    return '<div class="field-row" data-row>'
      + '<input type="hidden" data-f="key" value="' + esc(f.key || '') + '">'
      + '<input type="text" class="form-control form-control-sm" data-f="label" placeholder="항목 이름" value="' + esc(f.label || '') + '" required>'
      + '<select class="form-select form-select-sm" data-f="type">' + Object.keys(TYPE_LABELS).map(function (t) { return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + TYPE_LABELS[t] + '</option>'; }).join('') + '</select>'
      + '<input type="text" class="form-control form-control-sm" data-f="unit" placeholder="단위" value="' + esc(f.unit || '') + '">'
      + '<input type="text" class="form-control form-control-sm" data-f="options" placeholder="선택지 (쉼표 구분)" value="' + esc((f.options || []).join(', ')) + '">'
      + '<label class="form-check mb-0"><input class="form-check-input" type="checkbox" data-f="required"' + (f.required ? ' checked' : '') + '><span class="form-check-label">필수</span></label>'
      + '<button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="field-remove" title="항목 삭제"><i class="ti ti-x"></i></button>'
      + '</div>';
  }
  function eqFormHtml(eq) {
    var isNew = !eq.id;
    var names = (state.accounts || []).filter(function (a) { return a.status === 'active'; }).map(function (a) { return a.name; });
    return '<div class="card mb-3 border-primary" id="eq-form-card"><div class="card-header"><h3 class="card-title">' + (isNew ? '장비 추가' : '장비 수정: ' + esc(eq.name)) + '</h3></div><div class="card-body"><form id="eq-form">'
      + '<input type="hidden" name="eqId" value="' + esc(eq.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label required">장비 이름</label><input type="text" class="form-control" name="name" required value="' + esc(eq.name || '') + '" autocomplete="off"></div>'
      + '<div class="col-md-3"><label class="form-label">모델</label><input type="text" class="form-control" name="model" value="' + esc(eq.model || '') + '" autocomplete="off"></div>'
      + '<div class="col-md-3"><label class="form-label">위치</label><input type="text" class="form-control" name="location" value="' + esc(eq.location || '') + '" placeholder="E3-3 2302호" autocomplete="off"></div>'
      + '<div class="col-md-2"><label class="form-label">색</label><input type="color" class="form-control form-control-color w-100" name="color" value="' + esc(eq.color || '#004191') + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label">담당자</label><input type="text" class="form-control" name="managerName" list="acct-names" value="' + esc(eq.managerName || '') + '" placeholder="이상 보고를 점검 완료 처리할 사람" autocomplete="off"><datalist id="acct-names">' + names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist></div>'
      + '<div class="col-md-8"><label class="form-label">사용 규칙 <span class="form-label-description">로그시트 상단과 인쇄물에 표시</span></label><textarea class="form-control" name="rules" rows="2">' + esc(eq.rules || '') + '</textarea></div></div>'
      + '<div class="d-flex flex-wrap gap-3 mt-3"><label class="form-check mb-0"><input class="form-check-input" type="checkbox" name="allowConcurrent"' + (eq.allowConcurrent ? ' checked' : '') + '><span class="form-check-label">동시 사용 허용 (여러 사람이 동시에 "사용 중"일 수 있음)</span></label>'
      + (isNew ? '' : '<label class="form-check mb-0"><input class="form-check-input" type="checkbox" name="active"' + (eq.active !== false ? ' checked' : '') + '><span class="form-check-label">사용 중인 장비 (끄면 목록에서 숨김)</span></label>') + '</div>'
      + '<div class="d-flex flex-wrap align-items-center gap-2 mt-4 mb-2"><div class="subheader mb-0">공정 · 측정 조건 항목</div><div class="ms-auto d-flex gap-2"><select class="form-select form-select-sm" id="tpl-select">' + Object.keys(TEMPLATES).map(function (k) { return '<option value="' + esc(k) + '">' + esc(TEMPLATES[k].label) + '</option>'; }).join('') + '</select><button type="button" class="btn btn-sm" data-action="tpl-apply">템플릿 적용</button><button type="button" class="btn btn-sm" data-action="field-add"><i class="ti ti-plus me-1"></i>항목</button></div></div>'
      + '<div class="text-secondary small mb-2">항목 이름 · 종류 · 단위 · 선택지(선택 종류일 때, 쉼표 구분) · 필수 여부. 저장 키는 유지되므로 이름을 바꿔도 지난 기록과 연결됩니다.</div>'
      + '<div id="field-rows">' + (eq.fields || []).map(fieldRowHtml).join('') + '</div>'
      + '<div class="mt-4 d-flex gap-2"><button type="submit" class="btn btn-primary">' + (isNew ? '추가' : '저장') + '</button><button type="button" class="btn" data-action="eq-cancel">취소</button></div>'
      + '</form></div></div>';
  }
  function readEqForm(form) {
    var v = readForm(form);
    var fields = $all('[data-row]', form).map(function (row) {
      return { key: $('[data-f="key"]', row).value || ('f' + Math.random().toString(36).slice(2, 7)), label: $('[data-f="label"]', row).value, type: $('[data-f="type"]', row).value,
        unit: $('[data-f="unit"]', row).value, options: $('[data-f="options"]', row).value, required: $('[data-f="required"]', row).checked };
    });
    var out = { id: v.eqId || undefined, name: v.name, model: v.model, location: v.location, color: v.color, managerName: v.managerName, rules: v.rules, allowConcurrent: !!v.allowConcurrent, fields: fields };
    if ('active' in v) out.active = !!v.active;
    return out;
  }

  function renderAdmin() {
    var s = state.session;
    if (!s.isAdmin) return '<div class="card">' + empty('lock', '관리자만 볼 수 있습니다') + '</div>';
    var html = '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-device-desktop me-1 text-primary"></i>장비 관리</h3><div class="card-actions"><button type="button" class="btn btn-sm btn-primary" data-action="eq-new"><i class="ti ti-plus me-1"></i>장비 추가</button></div></div>';
    if (!state.equipment.length) html += '<div class="card-body text-secondary small">등록된 장비가 없습니다. "장비 추가"로 첫 장비를 만드세요.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>장비</th><th>위치 · 모델</th><th>담당자</th><th>조건 항목</th><th>동시 사용</th><th class="w-1">상태</th><th class="w-1"></th></tr></thead><tbody>'
      + state.equipment.map(function (e) {
        return '<tr' + (e.active === false ? ' class="text-secondary"' : '') + '><td class="fw-medium"><span class="color-swatch" style="background:' + esc(e.color) + '"></span>' + esc(e.name) + '</td><td class="small">' + esc([e.location, e.model].filter(Boolean).join(' · ') || '-') + '</td><td>' + esc(e.managerName || '-') + '</td>'
          + '<td class="small">' + (e.fields.length ? e.fields.map(function (f) { return esc(f.label) + (f.unit ? '(' + esc(f.unit) + ')' : ''); }).join(', ') : '<span class="text-secondary">없음</span>') + '</td><td>' + (e.allowConcurrent ? '허용' : '-') + '</td>'
          + '<td>' + (e.active === false ? '<span class="badge bg-secondary-lt">비활성</span>' : e.issue ? '<span class="badge bg-red-lt">이상 보고</span>' : '<span class="badge bg-green-lt">사용</span>') + '</td>'
          + '<td class="text-end text-nowrap">' + btn('eq-edit', e.id, 'pencil', '수정') + btn('eq-delete', e.id, 'trash', '삭제 / 비활성화', 'danger') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '</div>';
    if (state.editEq) html += eqFormHtml(state.editEq);

    var issues = state.equipment.filter(function (e) { return e.issue; });
    html += '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-alert-triangle me-1 text-red"></i>이상 보고 ' + (issues.length ? '<span class="badge bg-red-lt ms-1">' + issues.length + '</span>' : '') + '</h3></div>';
    if (!issues.length) html += '<div class="card-body text-secondary small">처리할 이상 보고가 없습니다.</div>';
    else html += '<div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>장비</th><th>내용</th><th>보고자</th><th class="w-1">일시</th><th class="w-1"></th></tr></thead><tbody>'
      + issues.map(function (e) { return '<tr><td class="fw-medium">' + esc(e.name) + '</td><td>' + esc(e.issue.note) + '</td><td>' + esc(e.issue.by) + '</td><td class="text-nowrap text-secondary">' + fmtDateTime(e.issue.at) + '</td><td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-action="resolve" data-id="' + esc(e.id) + '">점검 완료</button></td></tr>'; }).join('') + '</tbody></table></div>';
    html += '</div>';

    html += '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-history me-1 text-primary"></i>변경 이력 <span class="text-secondary fw-normal">' + state.audit.length + '건</span></h3><div class="card-actions small text-secondary">추가만 되는 기록입니다</div></div>';
    if (!state.audit.length) html += '<div class="card-body text-secondary small">아직 이력이 없습니다.</div>';
    else html += '<div class="table-responsive" style="max-height:420px;overflow:auto"><table class="table table-sm table-vcenter card-table"><thead><tr><th class="w-1">일시</th><th class="w-1">동작</th><th>장비</th><th>누가</th><th>내용</th></tr></thead><tbody>'
      + state.audit.slice(0, 300).map(function (a) {
        var eq = eqById(a.equipmentId);
        return '<tr><td class="text-nowrap text-secondary">' + fmtDateTime(a.createdAt) + '</td><td><span class="badge ' + (ACTION_CLS[a.action] || 'bg-secondary-lt') + '">' + esc(ACTIONS[a.action] || a.action) + '</span></td><td class="text-nowrap">' + esc(eq ? eq.name : '-') + '</td><td class="text-nowrap">' + esc(a.byName || '-') + '</td><td class="small">' + esc(a.detail) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    html += '</div>';

    if (store.mode === 'local') {
      html += '<div class="card"><div class="card-header"><h3 class="card-title"><i class="ti ti-database me-1 text-primary"></i>데이터 (이 브라우저)</h3></div><div class="card-body">'
        + '<p class="text-secondary small">로컬 저장 모드에서는 기록이 이 브라우저에만 저장됩니다. 다른 PC와 공유하려면 JSON으로 내보내 가져오거나, <code>assets/js/config.js</code> 에서 공용 DB(Supabase) 모드로 바꾸세요.</p>'
        + '<div class="d-flex flex-wrap gap-2"><button type="button" class="btn" data-action="export-json"><i class="ti ti-download me-1"></i>JSON 내보내기</button><label class="btn mb-0"><i class="ti ti-upload me-1"></i>JSON 가져오기<input type="file" accept="application/json,.json" id="import-json" hidden></label><button type="button" class="btn btn-outline-danger ms-auto" data-action="reset"><i class="ti ti-trash me-1"></i>기록 전부 지우기</button></div></div></div>';
    } else {
      html += '<div class="card"><div class="card-body text-secondary small"><i class="ti ti-cloud me-1"></i>공용 DB(Supabase) 모드입니다. 백업은 Supabase 대시보드에서 내려받으세요.</div></div>';
    }
    return html;
  }

  /* ---------- 인쇄용 로그시트 (A4 가로) ---------- */
  function renderPrint() {
    var rows = visibleEntries().filter(function (e) { return !e.deleted; });
    var groups = {}, order = [];
    rows.forEach(function (e) { if (!groups[e.equipmentId]) { groups[e.equipmentId] = []; order.push(e.equipmentId); } groups[e.equipmentId].push(e); });
    if (state.filter.equipmentId && !groups[state.filter.equipmentId]) { groups[state.filter.equipmentId] = []; order.push(state.filter.equipmentId); }
    var r = presetRange(state.filter);
    var period = (r.from || r.to) ? (r.from || '') + ' ~ ' + (r.to || '') : '전체 기간';
    var html = '<div class="ls-print-toolbar d-print-none"><button type="button" class="btn" data-action="print-back"><i class="ti ti-arrow-left me-1"></i>돌아가기</button><button type="button" class="btn btn-primary" data-action="print-now"><i class="ti ti-printer me-1"></i>인쇄 / PDF 저장</button><span class="text-secondary small ms-2">A4 가로. 끝의 빈 줄 ' + LS.printBlankRows + '개는 손으로 이어 쓰는 용도입니다.</span></div>';
    if (!order.length) return html + '<div class="ls-print">' + empty('clipboard-off', '인쇄할 기록이 없습니다') + '</div>';
    order.forEach(function (id) {
      var eq = eqById(id) || { name: '(삭제된 장비)', fields: [] };
      var list = groups[id].slice().sort(function (a, b) { return new Date(a.start) - new Date(b.start); });
      var total = list.reduce(function (a, e) { return a + minutes(e); }, 0);
      var fields = eq.fields || [];
      var fw = Math.max(5, Math.min(9, Math.round(42 / Math.max(fields.length, 1))));
      html += '<div class="ls-print"><h1>장비 사용 로그시트</h1>'
        + '<div class="ls-meta"><div><b>장비</b>' + esc(eq.name) + '</div><div><b>모델</b>' + esc(eq.model || '-') + '</div><div><b>위치</b>' + esc(eq.location || '-') + '</div><div><b>담당자</b>' + esc(eq.managerName || '-') + '</div>'
        + '<div><b>기간</b>' + esc(period) + '</div><div><b>기록</b>' + list.length + '건</div><div><b>총 사용</b>' + esc(fmtDuration(total)) + '</div><div><b>출력</b>' + esc(fmtDate(new Date().toISOString())) + ' · ' + esc(state.session.user.name) + '</div></div>'
        + (eq.rules ? '<div class="ls-rules">※ ' + esc(eq.rules) + '</div>' : '')
        + '<table><thead><tr><th style="width:4%">No.</th><th style="width:7%">날짜</th><th style="width:5%">시작</th><th style="width:5%">종료</th><th style="width:6%">사용시간</th><th style="width:7%">사용자</th><th style="width:9%">시료/소자</th><th>목적·내용</th>'
        + fields.map(function (f) { return '<th style="width:' + fw + '%">' + esc(f.label) + (f.unit ? '<br><span style="font-weight:400">(' + esc(f.unit) + ')</span>' : '') + '</th>'; }).join('')
        + '<th style="width:5%">상태</th><th style="width:11%">비고</th><th style="width:6%">서명</th></tr></thead><tbody>'
        + list.map(function (e, i) {
          return '<tr><td class="c">' + (i + 1) + '</td><td class="c">' + fmtDate(e.start) + '</td><td class="c">' + fmtTime(e.start) + '</td><td class="c">' + (e.end ? fmtTime(e.end) : '') + '</td><td class="c">' + (e.end ? fmtDuration(minutes(e)) : '진행 중') + '</td><td class="c">' + esc(e.userName) + '</td><td>' + esc(e.sample) + '</td><td>' + esc(e.purpose) + '</td>'
            + fields.map(function (f) { return '<td class="c">' + esc(e.values && e.values[f.key] !== undefined ? e.values[f.key] : '') + '</td>'; }).join('')
            + '<td class="c">' + (e.status === 'open' ? '사용 중' : e.condition === 'issue' ? '이상' : '정상') + '</td><td>' + esc([e.issues, e.note].filter(Boolean).join(' / ')) + '</td><td></td></tr>';
        }).join('');
      for (var b = 0; b < LS.printBlankRows; b++) html += '<tr class="blank"><td class="c">' + (list.length + b + 1) + '</td>' + new Array(11 + fields.length).join('<td></td>') + '</tr>';
      html += '</tbody></table><div class="ls-foot"><span>' + esc(CFG.labName || 'DSIL') + ' · ' + esc(CFG.university || 'KAIST') + '</span><span>이상 발생 시 담당자에게 즉시 알리고 로그시트에 기록합니다.</span></div></div>';
    });
    return html;
  }

  function exportCSV() {
    var rows = visibleEntries();
    if (!rows.length) { toast('내보낼 기록이 없습니다.', true); return; }
    var eq = state.filter.equipmentId ? eqById(state.filter.equipmentId) : null;
    var fields = eq ? eq.fields : [];
    var head = ['날짜', '시작', '종료', '사용시간(분)', '장비', '사용자', '시료/소자', '목적·내용'].concat(eq ? fields.map(function (f) { return f.label + (f.unit ? '(' + f.unit + ')' : ''); }) : ['조건']).concat(['장비 상태', '이상 내용', '비고', '상태', '기록 ID']);
    var lines = [head.map(csvCell).join(',')];
    rows.forEach(function (e) {
      var q = eqById(e.equipmentId);
      var cond = eq ? fields.map(function (f) { return e.values[f.key] !== undefined ? e.values[f.key] : ''; }) : [condText(e, q)];
      lines.push([fmtDate(e.start), fmtTime(e.start), e.end ? fmtDateTime(e.end) : '', e.end ? Math.round(minutes(e)) : '', q ? q.name : '', e.userName, e.sample, e.purpose].concat(cond)
        .concat([e.condition === 'issue' ? '이상' : '정상', e.issues, e.note, e.deleted ? '삭제됨' : e.status === 'open' ? '사용 중' : '완료', e.id]).map(csvCell).join(','));
    });
    var r = presetRange(state.filter);
    download('logsheet_' + (eq ? eq.name.replace(/[\\/:*?"<>|\s]+/g, '_') : 'all') + '_' + (r.from || 'all') + (r.to ? '_' + r.to : '') + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return guardTab().then(reload).then(render).catch(handleError); }
  function findEntry(id) {
    var e = state.entries.concat(state.mine).filter(function (x) { return x.id === id; })[0];
    return e ? Promise.resolve(e) : store.getEntry(id);
  }

  document.addEventListener('change', function (e) {
    var form = e.target.closest('#filter-form');
    if (form) {
      if (e.target.name === 'q') return;
      var v = readForm(form);
      state.filter = { equipmentId: v.equipmentId || '', preset: v.preset || 'month', from: v.from || '', to: v.to || '', userId: v.userId || '', q: v.q || '', deleted: !!v.deleted };
      refresh();
      return;
    }
    if (e.target.id === 'import-json') {
      var file = e.target.files && e.target.files[0]; if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        try { store.importJSON(JSON.parse(String(reader.result))); toast('가져왔습니다.'); refresh(); } catch (err) { handleError(err); }
      };
      reader.readAsText(file);
    }
  });
  document.addEventListener('input', function (e) {
    if (e.target.name === 'q' && e.target.closest('#filter-form')) { state.filter.q = e.target.value; var box = $('#sheet-results'); if (box) box.innerHTML = renderSheetResults(); }
  });
  document.addEventListener('submit', function (e) {
    var fid = e.target.getAttribute && e.target.getAttribute('id');   /* form.id 는 name="id" 입력에 가려질 수 있어 속성으로 읽음 */
    if (fid === 'filter-form') { e.preventDefault(); refresh(); return; }
    if (fid === 'eq-form') {
      e.preventDefault();
      var eq = readEqForm(e.target);
      store.saveEquipment(eq).then(function (saved) { toast('"' + saved.name + '" 장비를 저장했습니다.'); state.editEq = null; return refresh(); }).catch(handleError);
    }
  });

  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id');
    switch (action) {
      case 'refresh': refresh(); break;
      case 'signout': store.signOut().then(function () { window.location.replace('../index.html'); }); break;
      case 'start':
        F.startDialog(store, state.equipment, state.filter.equipmentId).then(function (r) { if (r) { toast('사용 시작을 기록했습니다. 끝나면 "종료"를 눌러 주세요.'); return refresh(); } }).catch(handleError);
        break;
      case 'manual':
        F.entryDialog(store, state.equipment, null).then(function (r) { if (r) { toast('기록을 저장했습니다.'); return refresh(); } }).catch(handleError);
        break;
      case 'close':
        findEntry(id).then(function (entry) { if (!entry) throw new Error('기록을 찾을 수 없습니다.'); return F.closeDialog(store, entry, eqById(entry.equipmentId)); })
          .then(function (r) { if (r) { toast(r.condition === 'issue' ? '종료를 기록하고 이상 보고를 남겼습니다.' : '사용 종료를 기록했습니다.'); return refresh(); } }).catch(handleError);
        break;
      case 'edit':
        findEntry(id).then(function (entry) { if (!entry) throw new Error('기록을 찾을 수 없습니다.'); return F.entryDialog(store, state.equipment, entry); })
          .then(function (r) { if (r) { toast('기록을 수정했습니다.'); return refresh(); } }).catch(handleError);
        break;
      case 'delete':
        findEntry(id).then(function (entry) {
          if (!entry) throw new Error('기록을 찾을 수 없습니다.');
          var own = entry.userId === state.session.user.id && entry.status === 'open';
          if (own && !state.session.isAdmin) {
            return confirmDlg({ title: '사용 시작 취소', message: '이 사용 시작 기록을 취소할까요? 이력에는 남습니다.', okLabel: '취소하기', danger: true }).then(function (ok) { if (!ok) return null; return store.deleteEntry(id, '').then(function () { return true; }); });
          }
          return promptDlg({ title: '기록 삭제', message: '삭제 사유를 입력하세요. 기록은 숨겨지고 변경 이력과 "삭제 포함" 조회로 남습니다.', input: 'textarea', placeholder: '예: 중복 입력', okLabel: '삭제', danger: true })
            .then(function (reason) { if (reason === null) return null; return store.deleteEntry(id, reason).then(function () { return true; }); });
        }).then(function (done) { if (done) { toast('삭제했습니다.'); return refresh(); } }).catch(handleError);
        break;
      case 'restore': store.restoreEntry(id).then(function () { toast('복구했습니다.'); return refresh(); }).catch(handleError); break;
      case 'resolve':
        promptDlg({ title: '점검 완료', message: '조치 내용을 적으면 변경 이력에 남습니다.', input: 'textarea', placeholder: '예: 척 진공 라인 교체, 정상 확인', okLabel: '점검 완료' })
          .then(function (note) { if (note === null) return; return store.resolveIssue(id, note).then(function () { toast('점검 완료로 처리했습니다.'); return refresh(); }); }).catch(handleError);
        break;
      case 'csv': exportCSV(); break;
      case 'print': state.print = true; render(); window.scrollTo(0, 0); break;
      case 'print-back': state.print = false; render(); break;
      case 'print-now': window.print(); break;
      case 'eq-new': state.editEq = { fields: [] }; render(); var c1 = $('#eq-form-card'); if (c1) c1.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'eq-edit': state.editEq = clone(eqById(id)); render(); var c2 = $('#eq-form-card'); if (c2) c2.scrollIntoView({ behavior: 'smooth', block: 'start' }); break;
      case 'eq-cancel': state.editEq = null; render(); break;
      case 'eq-delete': {
        var eq = eqById(id); if (!eq) break;
        confirmDlg({ title: '장비 삭제', message: '"' + eq.name + '" 장비를 삭제할까요? 기록이 있으면 삭제 대신 비활성화되어 목록에서 숨겨집니다.', okLabel: '삭제', danger: true })
          .then(function (ok) { if (!ok) return; return store.deleteEquipment(id).then(function (r) { toast(r && r.deactivated ? '기록이 있어 비활성화했습니다.' : '삭제했습니다.'); return refresh(); }); }).catch(handleError);
        break;
      }
      case 'tpl-apply': {
        var key = $('#tpl-select') ? $('#tpl-select').value : '';
        var tpl = TEMPLATES[key]; var box = $('#field-rows');
        if (tpl && box) { box.innerHTML = (tpl.fields || []).map(fieldRowHtml).join(''); toast('"' + tpl.label + '" 템플릿 항목을 넣었습니다. 저장을 눌러야 반영됩니다.'); }
        break;
      }
      case 'field-add': { var rows = $('#field-rows'); if (rows) { rows.insertAdjacentHTML('beforeend', fieldRowHtml({})); var last = rows.lastElementChild; var inp = last && last.querySelector('[data-f="label"]'); if (inp) inp.focus(); } break; }
      case 'field-remove': { var row = el.closest('[data-row]'); if (row) row.remove(); break; }
      case 'export-json':
        if (store.exportJSON) download('dsil-logsheet-' + localDate(new Date().toISOString()) + '.json', JSON.stringify(store.exportJSON(), null, 2));
        break;
      case 'reset':
        confirmDlg({ title: '기록 전부 지우기', message: '이 브라우저의 모든 기록·장비·계정을 지우고 기본 상태(관리자 / 0000, 기본 계정·장비)로 되돌립니다. 되돌릴 수 없습니다.', okLabel: '지우기', danger: true })
          .then(function (ok) { if (!ok || !store.resetDemo) return; return store.resetDemo().then(function () { toast('초기화했습니다.'); return refresh(); }); }).catch(handleError);
        break;
    }
  });

  window.addEventListener('hashchange', function () { readUrl(); state.print = false; state.editEq = null; refresh(); });
  setInterval(function () { if (state.session && !state.print && !document.querySelector('.modal.is-open') && !$('#eq-form') && state.entries.some(function (e) { return e.status === 'open'; })) { var box = $('#sheet-results'); if (box && state.tab === 'sheet') box.innerHTML = renderSheetResults(); } }, 60000);

  store.init().then(function () {
    state.ready = true;
    readUrl();
    store.onChange(function () { reload().then(render).catch(handleError); });
    return refresh();
  }).catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
