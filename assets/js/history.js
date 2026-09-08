/* =====================================================================
   DSIL Run Sheet – 이력: 모든 런의 기록·시트 수정을 팀 / 이름 / 공정 일자 / 런 / 동작별로 묶어 열람, CSV
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, S = window.DSILStore;
  var esc = U.esc, fmtDateTime = U.fmtDateTime, localDate = U.localDate, $ = U.$, toast = U.toast, readForm = U.readForm, empty = U.empty, stat = U.stat, csvCell = U.csvCell, download = U.download;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [];
  var PRESETS = [['7', '최근 7일'], ['30', '최근 30일'], ['90', '최근 90일'], ['year', '올해'], ['all', '전체'], ['custom', '직접 입력']];
  var GROUPS = [['date', '공정 일자'], ['team', '팀'], ['who', '이름'], ['run', '런'], ['action', '동작'], ['none', '묶지 않음']];
  var KINDS = [['all', '전체'], ['work', '작업 로그'], ['sheet', '시트 수정'], ['run', '런 관리']];
  var state = { ready: false, error: null, runs: [], logs: [], filter: { domain: '', team: '', who: '', runId: '', kind: 'all', preset: '30', from: '', to: '', q: '' }, group: 'date' };

  function runById(id) { return state.runs.filter(function (r) { return r.id === id; })[0] || null; }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function actionCls(a) { return a.indexOf('sheet-') === 0 ? 'bg-purple-lt' : a === 'step-done' ? 'bg-green-lt' : a === 'step-fail' ? 'bg-red-lt' : a === 'step-skip' ? 'bg-secondary-lt' : a.indexOf('run-') === 0 ? 'bg-blue-lt' : 'bg-cyan-lt'; }
  function kindOf(a) { return a.indexOf('sheet-') === 0 ? 'sheet' : a.indexOf('run-') === 0 ? 'run' : 'work'; }
  function range() {
    var f = state.filter, now = new Date();
    if (f.preset === 'all') return { from: '', to: '' };
    if (f.preset === 'custom') return { from: f.from, to: f.to };
    if (f.preset === 'year') return { from: localDate(new Date(now.getFullYear(), 0, 1).toISOString()), to: '' };
    var n = Number(f.preset) || 30; return { from: localDate(new Date(now.getTime() - (n - 1) * 86400000).toISOString()), to: '' };
  }
  function teams() { var set = {}; (CFG.teams || []).forEach(function (t) { set[t] = 1; }); state.runs.forEach(function (r) { if (r.team) set[r.team] = 1; }); state.logs.forEach(function (l) { if (l.team) set[l.team] = 1; }); return Object.keys(set).sort(); }
  function names() { var set = {}; state.logs.forEach(function (l) { if (l.who) set[l.who] = 1; }); state.runs.forEach(function (r) { if (r.owner) set[r.owner] = 1; }); return Object.keys(set).sort(); }
  function filtered() {
    var f = state.filter, rg = range(), q = f.q.trim().toLowerCase();
    return state.logs.filter(function (l) {
      var r = runById(l.runId), d = l.date || localDate(l.at), team = l.team || (r && r.team) || '';
      if (f.domain && (!r || r.domain !== f.domain)) return false;
      if (f.team && team !== f.team) return false;
      if (f.who && l.who !== f.who) return false;
      if (f.runId && l.runId !== f.runId) return false;
      if (f.kind !== 'all' && kindOf(l.action) !== f.kind) return false;
      if (rg.from && d < rg.from) return false;
      if (rg.to && d > rg.to) return false;
      if (q && [l.stepName, l.branch, l.detail, l.who, team, r ? r.code + ' ' + r.title + ' ' + r.sample : ''].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function groupKey(l) {
    var r = runById(l.runId);
    switch (state.group) {
      case 'team': return l.team || (r && r.team) || '(팀 미지정)';
      case 'who': return l.who || '(이름 없음)';
      case 'run': return r ? r.code + ' · ' + r.title : '(삭제된 런)';
      case 'action': return S.ACTIONS[l.action] || l.action;
      case 'date': return l.date || localDate(l.at);
      default: return '';
    }
  }

  function reload() { return Promise.all([store.listRuns(), store.listLogs(null, 8000)]).then(function (r) { state.runs = r[0]; state.logs = r[1]; }); }

  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var m = store.getMe();
    slot.innerHTML = m.name ? '<span class="text-secondary small"><i class="ti ti-user me-1"></i>' + esc(m.name) + (m.team ? ' · ' + esc(m.team) : '') + '</span>' : '';
  }
  function logRow(l, showRun) {
    var r = runById(l.runId);
    return '<tr><td class="text-nowrap text-secondary small">' + fmtDateTime(l.at) + '</td><td class="text-nowrap small">' + esc(l.date || localDate(l.at)) + '</td>'
      + (showRun ? '<td class="small">' + (r ? '<a href="../run/index.html#id=' + esc(r.id) + '">' + esc(r.code) + '</a><br><span class="text-secondary">' + esc(r.title) + '</span>' : '<span class="text-secondary">-</span>') + '</td>' : '')
      + '<td><span class="badge ' + actionCls(l.action) + '">' + esc(S.ACTIONS[l.action] || l.action) + '</span></td>'
      + '<td class="small text-nowrap">' + (l.stepName ? (l.seq ? l.seq + '. ' : '') + esc(l.stepName) + (l.branch ? '<br><span class="step-group">' + esc(l.branch) + '</span>' : '') : '-') + '</td>'
      + '<td class="small text-nowrap">' + esc(l.who || '-') + '<br><span class="text-secondary">' + esc(l.team || (r && r.team) || '') + '</span></td>'
      + '<td class="small">' + esc(l.detail) + '</td></tr>';
  }
  function renderResults() {
    var logs = filtered();
    var head = '<thead><tr><th class="w-1">일시</th><th class="w-1">공정 일자</th><th class="w-1">런</th><th class="w-1">동작</th><th class="w-1">스텝 · 분기</th><th class="w-1">누가 · 팀</th><th>내용</th></tr></thead>';
    var people = {}, teamSet = {}, days = {}; logs.forEach(function (l) { if (l.who) people[l.who] = 1; var r = runById(l.runId); teamSet[l.team || (r && r.team) || ''] = 1; days[l.date || localDate(l.at)] = 1; });
    var html = '<div class="row g-3 mb-3">' + stat('기록', logs.length + '건', '', '', 'col-6 col-lg-3') + stat('팀', Object.keys(teamSet).filter(Boolean).length + '개', '', '', 'col-6 col-lg-3') + stat('작업자', Object.keys(people).length + '명', '', '', 'col-6 col-lg-3') + stat('공정 일자', Object.keys(days).length + '일', '', '', 'col-6 col-lg-3') + '</div>';
    if (!logs.length) return html + '<div class="card">' + empty('history-off', '조건에 맞는 기록이 없습니다') + '</div>';
    if (state.group === 'none') return html + '<div class="card"><div class="table-responsive"><table class="table table-sm table-vcenter card-table">' + head + '<tbody>' + logs.slice(0, 1000).map(function (l) { return logRow(l, true); }).join('') + '</tbody></table></div></div>';
    var groups = {}, order = [];
    logs.forEach(function (l) { var k = groupKey(l); if (!groups[k]) { groups[k] = []; order.push(k); } groups[k].push(l); });
    if (state.group === 'date') order.sort().reverse(); else if (state.group !== 'run') order.sort();
    return html + order.map(function (k) {
      var list = groups[k], who = {}, runs = {}; list.forEach(function (l) { if (l.who) who[l.who] = 1; runs[l.runId] = 1; });
      var icon = state.group === 'team' ? 'users' : state.group === 'who' ? 'user' : state.group === 'run' ? 'clipboard-list' : state.group === 'action' ? 'tag' : 'calendar';
      var sub = [state.group !== 'who' ? Object.keys(who).length + '명' : '', state.group !== 'run' ? '런 ' + Object.keys(runs).length + '개' : '', list.length + '건'].filter(Boolean).join(' · ');
      return '<div class="card mb-3"><div class="card-header"><h3 class="card-title"><i class="ti ti-' + icon + ' me-1 text-primary"></i>' + esc(k) + '</h3><div class="card-actions text-secondary small">' + sub + '</div></div><div class="table-responsive"><table class="table table-sm table-vcenter card-table">' + head + '<tbody>' + list.slice(0, 500).map(function (l) { return logRow(l, true); }).join('') + '</tbody></table></div></div>';
    }).join('');
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    var f = state.filter;
    var html = '<div class="card mb-3"><div class="card-body"><form id="hist-filter" class="row g-2 align-items-end">'
      + '<div class="col-6 col-md-2"><label class="form-label">분류</label><select class="form-select" name="domain"><option value="">전체</option>' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + (f.domain === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">팀</label><select class="form-select" name="team"><option value="">전체</option>' + teams().map(function (t) { return '<option value="' + esc(t) + '"' + (f.team === t ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">이름</label><select class="form-select" name="who"><option value="">전체</option>' + names().map(function (n) { return '<option value="' + esc(n) + '"' + (f.who === n ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">런</label><select class="form-select" name="runId"><option value="">전체</option>' + state.runs.map(function (r) { return '<option value="' + esc(r.id) + '"' + (f.runId === r.id ? ' selected' : '') + '>' + esc(r.code + ' ' + r.title) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">종류</label><select class="form-select" name="kind">' + KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (f.kind === k[0] ? ' selected' : '') + '>' + k[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2"><label class="form-label">기간 (공정 일자)</label><select class="form-select" name="preset">' + PRESETS.map(function (p) { return '<option value="' + p[0] + '"' + (f.preset === p[0] ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-6 col-md-2" data-show-if="preset=custom"><label class="form-label">시작일</label><input type="date" class="form-control" name="from" value="' + esc(f.from) + '"></div><div class="col-6 col-md-2" data-show-if="preset=custom"><label class="form-label">종료일</label><input type="date" class="form-control" name="to" value="' + esc(f.to) + '"></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">검색</label><input type="search" class="form-control" name="q" value="' + esc(f.q) + '" placeholder="스텝, 내용, 시료" autocomplete="off"></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">묶어 보기</label><select class="form-select" name="group">' + GROUPS.map(function (g) { return '<option value="' + g[0] + '"' + (state.group === g[0] ? ' selected' : '') + '>' + g[1] + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-12 col-md-auto ms-md-auto"><button type="button" class="btn" data-action="csv"><i class="ti ti-file-spreadsheet me-1"></i>CSV</button></div>'
      + '</form></div></div><div id="hist-results">' + renderResults() + '</div>';
    app.innerHTML = html; var ff = $('#hist-filter'); if (ff) U.applyShowIf(ff);
  }
  function exportCSV() {
    var logs = filtered(); if (!logs.length) { toast('내보낼 기록이 없습니다.', true); return; }
    var head = ['일시', '공정 일자', '런 코드', '런 제목', '분류', '팀', '이름', '동작', '스텝', '분기', '내용'];
    var lines = [head.map(csvCell).join(',')].concat(logs.map(function (l) { var r = runById(l.runId); return [fmtDateTime(l.at), l.date || localDate(l.at), r ? r.code : '', r ? r.title : '', r ? domainInfo(r.domain).label : '', l.team || (r && r.team) || '', l.who, S.ACTIONS[l.action] || l.action, (l.seq ? l.seq + '. ' : '') + l.stepName, l.branch, l.detail].map(csvCell).join(','); }));
    download('runsheet_history_' + localDate(new Date().toISOString()) + '.csv', '﻿' + lines.join('\r\n'), 'text/csv;charset=utf-8');
  }
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }

  document.addEventListener('change', function (e) {
    var form = e.target.closest('#hist-filter'); if (!form) return; if (e.target.name === 'q') return;
    var v = readForm(form); state.filter = { domain: v.domain || '', team: v.team || '', who: v.who || '', runId: v.runId || '', kind: v.kind || 'all', preset: v.preset || '30', from: v.from || '', to: v.to || '', q: v.q || '' }; state.group = v.group || 'date'; render();
  });
  document.addEventListener('input', function (e) { if (e.target.name === 'q' && e.target.closest('#hist-filter')) { state.filter.q = e.target.value; var box = $('#hist-results'); if (box) box.innerHTML = renderResults(); } });
  document.addEventListener('submit', function (e) { if (e.target.getAttribute('id') === 'hist-filter') e.preventDefault(); });
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-action]'); if (el && el.getAttribute('data-action') === 'csv') exportCSV(); });

  (function () { try { var q = new URLSearchParams(window.location.search); ['team', 'who', 'runId', 'domain'].forEach(function (k) { if (q.get(k)) state.filter[k] = q.get(k); }); if (q.get('group')) state.group = q.get('group'); } catch (e) { /* ignore */ } })();
  store.init().then(function () { state.ready = true; store.onChange(function () { reload().then(render).catch(handleError); }); return reload().then(render); })
    .catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
