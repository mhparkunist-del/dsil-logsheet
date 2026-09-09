/* =====================================================================
   DSIL Run Sheet – data layer (행 = 큰 스텝 × 열 = 기판 단위 시트 모델, DSILSheet 사용)
   ---------------------------------------------------------------------
   로그인(이름 + PIN). 런은 만든 사람만 보고 고치며, 완료 후 아카이브에 올린 런만 모두 공개(읽기 전용).
   기본 제공(seed) 라이브러리는 수정·삭제 불가(복사만).

     init() / onChange(cb) / getSession() / getMe()
     signIn / signUp / signOut / changeMyPin / setMyTeam / listAccounts / resetAccountPin / setAccountTeam
     listModules / saveModule / deleteModule / listFlows / saveFlow / deleteFlow
     listRuns({scope:'mine'|'archive'|'all'}) / getRun / createRun / updateRun / setRunStatus / setArchived / deleteRun / cloneRun / saveRunAsFlow
     stepLog(runId, cellId, p, who) / stepQuick(runId, cellId) / stepReopen(runId, cellId) / cellEdit(runId, cellId, patch)
     rowInsert(runId, {index, category, name, note, cells:{leafId|all:{moduleId, params, name}}}) / rowRemove / rowMove / rowEdit
     cellSet(runId, rowId, leafId, {moduleId, params, name}) / cellClear(runId, rowId, leafId)
     splitAdd(runId, {parentId, fromRowId, toRowId, name, branches}) / splitEdit(runId, splitId, patch) / splitRemove(runId, splitId)
     copyFlow(runId, flowId)                  흐름의 행·분기점을 끝에 붙임 (빈 런이면 수량도 가져옴)
     listLogs(runId|null, limit, scope) / savePhoto / loadPhoto / deletePhoto / exportJSON / importJSON / resetAll

   Flow { id, domain, name, device, description, unitLabel, unitCount, rows:[{id, category, name, note, cells:{leaf:{id, moduleId, label, params, note}}}], splits, seed, ownerId, ownerName, active }
   Run  { id, code, ownerId, domain, team, owner, title, flowId, flowName, sample, substrate, goal, note, unitLabel, unitCount, units, rows:[{..., cells:{leaf: Step}}], splits, status, archived, archivedAt, ... }
   Step { id, moduleId, name, category, equipment, minutes, fields, checklist, planned, actual, status, operator, team, date, result, issues, note, photos, updatedAt, updatedBy }
   Log  { id, runId, rowId, stepId, seq, stepName, branch, at, date, who, team, action, detail }
   ===================================================================== */
(function () {
  'use strict';

  var SH = window.DSILSheet;
  var DATA_KEY = 'dsil-runsheet-v3';
  var OLD_KEYS = ['dsil-runsheet-v2', 'dsil-runsheet-v1'];
  var SESSION_KEY = 'dsil-runsheet-session';
  var SUPER_ADMIN = { id: 'admin-1', name: '관리자', team: '관리자', seedPin: '0000' };
  var FIELD_TYPES = ['text', 'number', 'select', 'textarea', 'check'];
  var TERMINAL = { done: 1, skipped: 1, failed: 1 };
  var RUN_STATUS = { active: '진행 중', paused: '보류', done: '완료', aborted: '중단' };
  var STEP_STATUS = { pending: '대기', done: '완료', skipped: '건너뜀', failed: '실패' };
  var ACTIONS = {
    'run-create': '런 시작', 'run-edit': '런 정보 수정', 'run-status': '런 상태', 'run-clone': '런 복제', 'run-archive': '아카이브 올림', 'run-unarchive': '아카이브 내림',
    'step-done': '스텝 완료', 'step-skip': '건너뜀', 'step-fail': '실패', 'step-edit': '기록 수정', 'step-reopen': '되돌림',
    'sheet-insert': '시트: 행 추가', 'sheet-remove': '시트: 행 삭제', 'sheet-move': '시트: 순서 변경', 'sheet-edit': '시트: 계획 수정', 'sheet-cell': '시트: 분기 셀',
    'sheet-split-add': '시트: 분기점 추가', 'sheet-split-edit': '시트: 분기 수정', 'sheet-split-remove': '시트: 분기점 삭제', 'sheet-copy': '시트: 흐름 복사'
  };

  var uid = SH.uid, clone = SH.clone;
  function nowISO() { return new Date().toISOString(); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function localDate(iso) { if (!iso) return null; var d = new Date(iso); if (isNaN(d)) return String(iso).slice(0, 10); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function today() { return localDate(new Date().toISOString()); }
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  function toISO(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function isTrue(v) { return v === true || v === 'true' || v === '예' || v === 'on'; }
  function fail(msg) { throw new Error(msg); }
  function byId(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0] || null; }
  function nameKey(s) { return str(s).replace(/\s+/g, '').toLowerCase(); }

  /* ---------- PIN 해시 ---------- */
  function fallbackHash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return 'fnv-' + h.toString(16); }
  function hashPin(pin) {
    var s = String(pin);
    if (window.crypto && crypto.subtle && window.TextEncoder) return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }).catch(function () { return fallbackHash(s); });
    return Promise.resolve(fallbackHash(s));
  }
  function validPin(pin) { return /^\d{4,8}$/.test(String(pin || '')); }
  function publicAccount(a) { return { id: a.id, name: a.name, team: a.team || '', role: a.role || 'member', createdAt: a.createdAt }; }

  /* ---------- 조건 항목 ---------- */
  function normFields(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = {};
    list.forEach(function (f, i) {
      if (!f) return;
      var label = str(f.label); if (!label) return;
      var key = str(f.key).replace(/[^A-Za-z0-9_-]/g, '') || ('f' + (i + 1));
      if (seen[key]) key = key + '_' + (i + 1);
      seen[key] = 1;
      var type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : 'text';
      var options = Array.isArray(f.options) ? f.options : String(f.options || '').split(',');
      options = options.map(function (o) { return str(o); }).filter(Boolean);
      var def = f.default;
      if (def === undefined || def === null || def === '') def = undefined;
      else if (type === 'check') def = isTrue(def);
      else if (type === 'number') { def = Number(def); if (isNaN(def)) def = undefined; }
      else def = String(def);
      var rec = { key: key, label: label, type: type, unit: str(f.unit), options: type === 'select' ? options : [], required: !!f.required };
      if (def !== undefined) rec.default = def;
      out.push(rec);
    });
    return out;
  }
  function cleanValues(fields, values) {
    var out = {}; values = values || {};
    var fm = {}; (fields || []).forEach(function (f) { fm[f.key] = f; });
    Object.keys(values).forEach(function (k) {
      var f = fm[k], v = values[k];
      if (v === undefined || v === null) return;
      if (f && f.type === 'check') { out[k] = isTrue(v); return; }
      v = str(v); if (v === '') return;
      if (f && f.type === 'number') { var n = Number(v); out[k] = isNaN(n) ? v : n; } else out[k] = v;
    });
    return out;
  }
  function missingRequired(fields, values) {
    var miss = (fields || []).filter(function (f) { if (!f.required) return false; var v = (values || {})[f.key]; return v === undefined || v === '' || v === null; });
    return miss.length ? '필수 조건 항목을 입력하세요: ' + miss.map(function (f) { return f.label; }).join(', ') : null;
  }
  function defaults(fields) { var out = {}; (fields || []).forEach(function (f) { if (f.default !== undefined) out[f.key] = f.default; }); return out; }
  function paramText(fields, values) {
    var fm = {}; (fields || []).forEach(function (f) { fm[f.key] = f; });
    return Object.keys(values || {}).filter(function (k) { var v = values[k]; return v !== undefined && v !== '' && v !== null && !(fm[k] && fm[k].type === 'check' && !isTrue(v)); })
      .map(function (k) { var f = fm[k] || { label: k }; var v = values[k]; if (f.type === 'check') v = isTrue(v) ? '예' : '아니오'; return f.label + ' ' + v + (f.unit ? ' ' + f.unit : ''); }).join(', ');
  }
  function diffParams(fields, a, b) {
    var fm = {}; (fields || []).forEach(function (f) { fm[f.key] = f; });
    var keys = {}; Object.keys(a || {}).concat(Object.keys(b || {})).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys).filter(function (k) { return String((a || {})[k] === undefined ? '' : a[k]) !== String((b || {})[k] === undefined ? '' : b[k]); })
      .map(function (k) { var f = fm[k] || { label: k }; return f.label + ': ' + ((a || {})[k] === undefined || a[k] === '' ? '(없음)' : a[k]) + ' → ' + ((b || {})[k] === undefined || b[k] === '' ? '(없음)' : b[k]); }).join(' / ');
  }

  /* ---------- 모듈 · 흐름 ---------- */
  function normModule(m, cur) {
    cur = cur || {};
    return { id: cur.id || m.id || uid(), domain: str(m.domain) || cur.domain || 'device', name: str(m.name), category: str(m.category) || 'etc', equipment: str(m.equipment), description: str(m.description),
      minutes: Math.max(0, Number(m.minutes) || 0), fields: normFields(m.fields), checklist: Array.isArray(m.checklist) ? m.checklist.map(str).filter(Boolean) : String(m.checklist || '').split(/\r?\n/).map(str).filter(Boolean),
      active: m.active === undefined ? (cur.active === undefined ? true : cur.active) : !!m.active, seed: !!cur.seed, ownerId: cur.ownerId || null, ownerName: cur.ownerName || '', createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function normMaterial(m, cur) {
    cur = cur || {};
    var dom = str(m.domain); if (dom !== 'device' && dom !== 'package') dom = '';
    return { id: cur.id || m.id || uid(), domain: dom, name: str(m.name), description: str(m.description), active: m.active === undefined ? (cur.active === undefined ? true : cur.active) : !!m.active,
      seed: !!cur.seed, ownerId: cur.ownerId || null, ownerName: cur.ownerName || '', createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function normRef(c) { if (!c || !c.moduleId) return null; return { id: c.id || uid(), moduleId: String(c.moduleId), label: str(c.label || c.name), params: (c.params && typeof c.params === 'object') ? c.params : {}, note: str(c.note) }; }
  function normRows(rows, normCell) {
    return (Array.isArray(rows) ? rows : []).map(function (r) {
      var row = { id: r.id || uid(), category: str(r.category) || 'etc', name: str(r.name), note: str(r.note), cells: {} };
      Object.keys(r.cells || {}).forEach(function (k) { var c = normCell(r.cells[k]); if (c) row.cells[k] = c; });
      return row;
    });
  }
  function normSplits(splits) {
    return (Array.isArray(splits) ? splits : []).map(function (s) { return { id: s.id || uid(), name: str(s.name), parentId: s.parentId || 'all', fromRowId: s.fromRowId || null, toRowId: s.toRowId || null, branches: (s.branches || []).map(function (b, i) { return { id: b.id || uid(), name: str(b.name) || String.fromCharCode(65 + i), count: Math.max(1, Math.round(Number(b.count)) || 1) }; }) }; }).filter(function (s) { return s.fromRowId && s.branches.length; });
  }
  function normFlow(f, cur) {
    cur = cur || {};
    return { id: cur.id || f.id || uid(), domain: str(f.domain) || cur.domain || 'device', name: str(f.name), device: str(f.device), description: str(f.description),
      unitLabel: str(f.unitLabel) || cur.unitLabel || '기판', unitCount: Math.max(1, Math.round(Number(f.unitCount)) || cur.unitCount || 1),
      rows: normRows(f.rows, normRef), splits: normSplits(f.splits),
      active: f.active === undefined ? (cur.active === undefined ? true : cur.active) : !!f.active, seed: !!cur.seed, ownerId: cur.ownerId || null, ownerName: cur.ownerName || '', createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function stepFromModule(mod, o) {
    o = o || {};
    var fields = normFields(mod.fields);
    return { id: uid(), moduleId: mod.id, name: str(o.name) || mod.name, category: mod.category || 'etc', equipment: mod.equipment || '', minutes: mod.minutes || 0,
      fields: fields, checklist: (mod.checklist || []).slice(), planned: Object.assign(defaults(fields), cleanValues(fields, o.params || {})), actual: {},
      status: 'pending', operator: '', team: '', date: null, result: '', issues: '', note: '', photos: [], updatedAt: null, updatedBy: '' };
  }
  function normStep(s) {
    if (!s || !s.id) return null;
    s.fields = normFields(s.fields); if (!s.planned) s.planned = {}; if (!s.actual) s.actual = {}; if (!s.photos) s.photos = []; if (!s.status || s.status === 'running') s.status = 'pending'; if (s.team === undefined) s.team = ''; if (s.date === undefined) s.date = null;
    delete s.seq; delete s.branchPath; delete s.group; delete s.itemNote; delete s.addedInRun; delete s.startedAt; delete s.endedAt;
    return s;
  }
  /* 런 셀 생성기: 흐름 참조 또는 {moduleId, params, name} → 스텝 */
  function runCellMaker(ctx) {
    return function (spec, leaf) {
      if (spec && spec.fields && spec.status) return normStep(clone(spec));           /* 이미 스텝이면 그대로(복제) */
      var mod = byId(ctx.modules, spec.moduleId); if (!mod) fail('모듈을 찾을 수 없습니다: ' + spec.moduleId);
      return stepFromModule(mod, { params: spec.params, name: spec.label || spec.name });
    };
  }
  function cloneStep(c) { var n = clone(c); n.id = uid(); n.actual = {}; n.status = 'pending'; n.operator = ''; n.team = ''; n.date = null; n.result = ''; n.issues = ''; n.note = ''; n.photos = []; n.updatedAt = null; n.updatedBy = ''; return n; }
  function pendingStep(c) { return !c || c.status === 'pending'; }
  function refCellMaker() { return function (spec) { var c = normRef(spec); if (!c) fail('모듈을 고르세요.'); c.id = uid(); return c; }; }
  function cloneRef(c) { var n = clone(c); n.id = uid(); return n; }
  function always() { return true; }

  function makeUnits(label, count, old) { var u = (old || []).slice(0, count); for (var i = 0; i < count; i++) u[i] = u[i] || label + ' ' + (i + 1); return u; }
  function progress(run) {
    var t = 0, d = 0, sk = 0, f = 0, cur = null;
    SH.eachCell(run, function (c, row, leaf) { t++; if (c.status === 'done') d++; else if (c.status === 'skipped') sk++; else if (c.status === 'failed') f++; if (!cur && !TERMINAL[c.status]) cur = { cell: c, row: row, leaf: leaf }; });
    return { total: t, done: d, skipped: sk, failed: f, finished: d + sk + f, pct: t ? Math.round((d + sk + f) / t * 100) : 0, current: cur, allDone: t > 0 && d + sk + f === t };
  }
  function runCode(runs, prefix) {
    var d = new Date(), key = String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    var n = runs.filter(function (r) { return (r.code || '').indexOf((prefix || 'R') + '-' + key + '-') === 0; }).length + 1;
    return (prefix || 'R') + '-' + key + '-' + pad2(n);
  }
  function meOf(me) { me = me || {}; return { name: str(me.name), team: str(me.team) }; }
  function logRec(run, at, me, action, detail, date) {
    var m = meOf(me); at = at || {};
    var i = at.row ? SH.idx(run, at.row.id) : -1;
    return { id: uid(), runId: run.id, rowId: at.row ? at.row.id : null, stepId: at.cell ? at.cell.id : null, seq: i >= 0 ? i + 1 : null, stepName: at.row ? (at.row.name || (at.cell && at.cell.name) || '') : (at.cell ? at.cell.name : ''), branch: at.leaf && at.leaf.path && at.leaf.path.length ? at.leaf.path.join(' › ') : '',
      at: nowISO(), date: date || today(), who: m.name, team: m.team || run.team || '', action: action, detail: str(detail).slice(0, 1000) };
  }
  function cellAt(run, cellId) { var f = SH.findCell(run, cellId); if (!f) fail('스텝을 찾을 수 없습니다.'); return f; }

  /* ---------- 런 연산 ---------- */
  function opStepLog(run, cellId, p, me) {
    var at = cellAt(run, cellId), s = at.cell, before = clone(s); p = p || {};
    function restore() { Object.keys(s).forEach(function (k) { delete s[k]; }); Object.assign(s, before); }
    if (p.operator !== undefined) s.operator = str(p.operator);
    if (p.team !== undefined) s.team = str(p.team);
    if (p.date !== undefined) s.date = str(p.date) || null;
    if (p.actual !== undefined) s.actual = cleanValues(s.fields, p.actual);
    if (p.result !== undefined) s.result = str(p.result);
    if (p.issues !== undefined) s.issues = str(p.issues);
    if (p.note !== undefined) s.note = str(p.note);
    if (Array.isArray(p.photos)) s.photos = p.photos.slice();
    var st = p.status || s.status;
    if (!STEP_STATUS[st]) { restore(); fail('알 수 없는 상태입니다.'); }
    if (st !== 'pending' && !s.operator) { restore(); fail('작업자 이름을 입력하세요.'); }
    if (st === 'done') { var miss = missingRequired(s.fields, s.actual); if (miss) { restore(); fail(miss); } }
    if (st !== 'pending' && !s.date) s.date = today();
    if (st === 'pending') s.date = null;
    s.status = st; s.updatedAt = nowISO(); s.updatedBy = str(me && me.name); run.updatedAt = nowISO();
    var action = st === 'done' ? (before.status === 'done' ? 'step-edit' : 'step-done') : st === 'skipped' ? 'step-skip' : st === 'failed' ? 'step-fail' : 'step-edit';
    var parts = [];
    if (action === 'step-done') { parts.push(paramText(s.fields, s.actual) || '조건 없음'); var dp = diffParams(s.fields, s.planned, s.actual); if (dp) parts.push('계획과 다름: ' + dp); }
    else if (action === 'step-edit') { var d2 = diffParams(s.fields, before.actual, s.actual); if (d2) parts.push('실제값 ' + d2); if (before.status !== st) parts.push(STEP_STATUS[before.status] + ' → ' + STEP_STATUS[st]); }
    if (st === 'skipped' || st === 'failed') parts.push(s.issues || s.result || '');
    if (s.result && action === 'step-done') parts.push('결과: ' + s.result);
    if (s.issues && action === 'step-done') parts.push('특이: ' + s.issues);
    return [logRec(run, at, { name: s.operator || (me && me.name), team: s.team || (me && me.team) }, action, parts.filter(Boolean).join(' · '), s.date)];
  }
  function opStepQuick(run, cellId, me) {
    var at = cellAt(run, cellId), s = at.cell, m = meOf(me);
    if (TERMINAL[s.status]) fail('이미 끝난 스텝입니다.');
    if (!m.name) fail('로그인이 필요합니다.');
    var miss = missingRequired(s.fields, s.planned);
    if (miss) fail('계획값에 빈 필수 항목이 있어 바로 완료할 수 없습니다. "기록"에서 입력하세요. (' + miss.replace('필수 조건 항목을 입력하세요: ', '') + ')');
    s.actual = clone(s.planned); s.operator = m.name; s.team = m.team; s.date = today(); s.status = 'done'; s.updatedAt = nowISO(); s.updatedBy = m.name; run.updatedAt = nowISO();
    return [logRec(run, at, m, 'step-done', '계획대로 완료 · ' + (paramText(s.fields, s.actual) || '조건 없음'), s.date)];
  }
  function opStepReopen(run, cellId, me) {
    var at = cellAt(run, cellId), s = at.cell;
    if (s.status === 'pending') fail('이미 대기 상태입니다.');
    var prev = s.status; s.status = 'pending'; s.date = null; s.updatedAt = nowISO(); s.updatedBy = str(me && me.name); run.updatedAt = nowISO();
    return [logRec(run, at, me, 'step-reopen', STEP_STATUS[prev] + ' → 대기')];
  }
  function opCellEdit(run, cellId, patch, me) {
    var at = cellAt(run, cellId), s = at.cell, parts = [];
    if (patch.name !== undefined && str(patch.name) && str(patch.name) !== s.name) { parts.push('이름: ' + s.name + ' → ' + str(patch.name)); s.name = str(patch.name); }
    if (patch.equipment !== undefined && str(patch.equipment) !== s.equipment) { parts.push('장비: ' + (s.equipment || '(없음)') + ' → ' + (str(patch.equipment) || '(없음)')); s.equipment = str(patch.equipment); }
    if (patch.planned !== undefined) { var np = cleanValues(s.fields, patch.planned); var d = diffParams(s.fields, s.planned, np); if (d) { parts.push('계획 조건 ' + d); s.planned = np; } }
    if (!parts.length) return [];
    s.updatedAt = nowISO(); s.updatedBy = str(me && me.name); run.updatedAt = nowISO();
    return [logRec(run, at, me, 'sheet-edit', parts.join(' / '))];
  }
  function opRowInsert(run, ctx, o, me) {
    var index = (o.index === undefined || o.index === null || o.index === '' || o.index === 'end') ? run.rows.length : Number(o.index);
    /* 공통 행으로 끝에 추가: 끝까지 열린 분기점은 앞 행에서 합침 */
    var closed = (o.common && index >= run.rows.length) ? SH.closeOpenSplits(run) : [];
    var row = SH.rowInsert(run, index, { category: o.category, name: o.name, note: o.note, cells: o.cells || {} }, runCellMaker(ctx));
    if (!Object.keys(row.cells).length && !o.allowEmpty) { SH.rowRemove(run, row.id, always); fail('행에 넣을 모듈을 고르세요.'); }
    try { SH.validate(run, run.unitLabel); } catch (e) { SH.rowRemove(run, row.id, always); throw e; }
    if (!row.name) row.name = '(이름 없음)';
    var i = SH.idx(run, row.id); run.updatedAt = nowISO();
    var names = Object.keys(row.cells).map(function (k) { return row.cells[k].name; });
    return [logRec(run, { row: row }, me, 'sheet-insert', (i + 1) + '행 "' + row.name + '" 추가' + (names.length ? ' · ' + (Object.keys(row.cells).length > 1 ? Object.keys(row.cells).length + '개 분기에 ' : '') + names[0] : ' (모듈 없음)') + splitClosedText(closed, i))];
  }
  function splitClosedText(closed, i) { return closed.length ? ' · 분기점 ' + closed.map(function (s) { return '"' + (s.name || '분기점') + '"'; }).join(', ') + ' 은 ' + i + '행에서 끝나고 ' + (i + 1) + '행부터 공통' : ''; }
  function opSplitClose(run, rowId, me) {
    var row = SH.rowById(run, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var list = SH.splitCloseAt(run, rowId, cloneStep, pendingStep, pendingStep, run.unitLabel); run.updatedAt = nowISO();
    var i = SH.idx(run, rowId);
    return [logRec(run, { row: row }, me, 'sheet-split-edit', '분기점 ' + list.map(function (s) { return '"' + (s.name || '분기점') + '"'; }).join(', ') + ' 을 ' + i + '행에서 끝냄 → ' + (i + 1) + '행 "' + row.name + '" 부터 공통(합침)')];
  }
  function opRowRemove(run, rowId, me) {
    var i = SH.idx(run, rowId), row = SH.rowById(run, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var rec = logRec(run, { row: row }, me, 'sheet-remove', (i + 1) + '행 "' + row.name + '" 삭제');
    SH.rowRemove(run, rowId, pendingStep); run.updatedAt = nowISO();
    return [rec];
  }
  function opRowMove(run, rowId, dir, me) {
    var row = SH.rowById(run, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var before = SH.idx(run, rowId); SH.rowMove(run, rowId, dir); run.updatedAt = nowISO();
    return [logRec(run, { row: row }, me, 'sheet-move', '"' + row.name + '": ' + (before + 1) + '행 → ' + (SH.idx(run, rowId) + 1) + '행')];
  }
  function opRowEdit(run, rowId, patch, me) {
    var row = SH.rowById(run, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var parts = SH.rowEdit(run, rowId, patch); if (!parts.length) return [];
    run.updatedAt = nowISO(); return [logRec(run, { row: row }, me, 'sheet-edit', parts.join(' / '))];
  }
  function opCellSet(run, ctx, rowId, leafId, spec, me) {
    var row = SH.rowById(run, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var old = row.cells[leafId]; if (old && !pendingStep(old)) fail('진행된 스텝은 바꿀 수 없습니다.');
    var c = SH.cellSet(run, rowId, leafId, spec, runCellMaker(ctx)); run.updatedAt = nowISO();
    var leaf = SH.leavesAt(run, SH.idx(run, rowId)).filter(function (l) { return l.id === leafId; })[0];
    return [logRec(run, { row: row, cell: c, leaf: leaf }, me, 'sheet-cell', (leaf && leaf.name ? '분기 ' + leaf.path.join(' › ') + ': ' : '') + (old ? old.name + ' → ' : '') + c.name + (paramText(c.fields, c.planned) ? ' · 계획 ' + paramText(c.fields, c.planned) : ''))];
  }
  function opCellClear(run, rowId, leafId, me) {
    var row = SH.rowById(run, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var leaf = SH.leavesAt(run, SH.idx(run, rowId)).filter(function (l) { return l.id === leafId; })[0];
    var c = SH.cellClear(run, rowId, leafId, pendingStep); if (!c) return [];
    run.updatedAt = nowISO();
    return [logRec(run, { row: row, leaf: leaf }, me, 'sheet-cell', (leaf && leaf.name ? '분기 ' + leaf.path.join(' › ') + ': ' : '') + c.name + ' 뺌 (이 행 건너뜀)')];
  }
  function opSplitAdd(run, o, me) {
    var s = SH.splitAdd(run, Object.assign({ unitLabel: run.unitLabel }, o), cloneStep, pendingStep); run.updatedAt = nowISO();
    var r = SH.range(run, s);
    return [logRec(run, null, me, 'sheet-split-add', '분기점' + (s.name ? ' "' + s.name + '"' : '') + ' 추가: ' + (r.from + 1) + '~' + (s.toRowId ? (r.to + 1) : '끝') + '행 · ' + s.branches.map(function (b) { return b.name + ' ' + b.count; }).join(' / ') + ' ' + run.unitLabel)];
  }
  function opSplitEdit(run, splitId, patch, me) {
    var s = SH.splitById(run, splitId); if (!s) fail('분기점을 찾을 수 없습니다.');
    var before = s.branches.map(function (b) { return b.name + ' ' + b.count; }).join(' / ') + ' (' + (SH.range(run, s).from + 1) + '~' + (s.toRowId ? SH.range(run, s).to + 1 : '끝') + '행)';
    SH.splitEdit(run, splitId, Object.assign({ unitLabel: run.unitLabel }, patch), cloneStep, pendingStep, pendingStep); run.updatedAt = nowISO();
    var r = SH.range(run, s);
    return [logRec(run, null, me, 'sheet-split-edit', '분기점' + (s.name ? ' "' + s.name + '"' : '') + ': ' + before + ' → ' + s.branches.map(function (b) { return b.name + ' ' + b.count; }).join(' / ') + ' (' + (r.from + 1) + '~' + (s.toRowId ? r.to + 1 : '끝') + '행)')];
  }
  function opSplitRemove(run, splitId, me) {
    var s = SH.splitRemove(run, splitId, pendingStep); run.updatedAt = nowISO();
    return [logRec(run, null, me, 'sheet-split-remove', '분기점' + (s.name ? ' "' + s.name + '"' : '') + ' 삭제 (' + s.branches.map(function (b) { return b.name; }).join(' / ') + ' 합침)')];
  }
  function opCopyFlow(run, ctx, flowId, me) {
    var fl = byId(ctx.flows, flowId); if (!fl) fail('흐름을 찾을 수 없습니다.');
    var logs = [], empty = !run.rows.length, beforeCount = run.unitCount;
    var closed = SH.closeOpenSplits(run);
    var added = SH.appendSheet(run, fl, runCellMaker(ctx), { adopt: empty, unitLabel: run.unitLabel });
    if (run.unitCount !== beforeCount) { run.units = makeUnits(run.unitLabel, run.unitCount, run.units); logs.push(logRec(run, null, me, 'run-edit', '수량: ' + beforeCount + ' → ' + run.unitCount + ' (흐름 "' + fl.name + '" 복사)')); }
    if (!run.flowId) { run.flowId = fl.id; run.flowName = fl.name; }
    run.updatedAt = nowISO();
    logs.push(logRec(run, null, me, 'sheet-copy', '흐름 "' + fl.name + '" 복사: ' + added.length + '행' + ((fl.splits || []).length ? ' · 분기점 ' + fl.splits.length + '개' : '') + splitClosedText(closed, run.rows.length - added.length)));
    return logs;
  }
  function opRunEdit(run, patch, me) {
    var LAB = { title: '제목', team: '팀', owner: '담당자', sample: '시료', substrate: '기판 종류', goal: '목표', note: '메모', unitLabel: '단위 라벨', startedAt: '시작일' };
    var parts = [];
    if (patch.title !== undefined && !str(patch.title)) fail('제목을 입력하세요.');
    if (patch.team !== undefined && !str(patch.team)) fail('팀을 입력하세요.');
    if (patch.owner !== undefined && !str(patch.owner)) fail('담당자 이름을 입력하세요.');
    Object.keys(LAB).forEach(function (k) {
      if (patch[k] === undefined) return;
      var v = k === 'startedAt' ? toISO(patch[k]) : str(patch[k]);
      if (String(v || '') !== String(run[k] || '')) { parts.push(LAB[k] + ': ' + (run[k] || '(없음)') + ' → ' + (v || '(없음)')); run[k] = v; }
    });
    if (patch.unitCount !== undefined) {
      var n = Math.max(1, Math.round(Number(patch.unitCount)) || 1);
      if (n !== run.unitCount) { if ((run.splits || []).length) fail('분기점이 있는 런은 수량을 바꿀 수 없습니다. 분기 수정에서 수량을 조정하세요.'); parts.push('수량: ' + run.unitCount + ' → ' + n); run.unitCount = n; run.units = makeUnits(run.unitLabel, n, run.units); }
    }
    if (patch.units !== undefined) {
      var units = (Array.isArray(patch.units) ? patch.units : String(patch.units).split(',')).map(str);
      if (units.length !== run.unitCount) fail(run.unitLabel + ' 이름은 ' + run.unitCount + '개여야 합니다.');
      units = units.map(function (u, i) { return u || run.unitLabel + ' ' + (i + 1); });
      if (units.join('|') !== run.units.join('|')) { parts.push(run.unitLabel + ' 이름: ' + run.units.join(', ') + ' → ' + units.join(', ')); run.units = units; }
    }
    if (!parts.length) return [];
    run.updatedAt = nowISO();
    return [logRec(run, null, me, 'run-edit', parts.join(' / '))];
  }
  function opRunStatus(run, status, me, note) {
    if (!RUN_STATUS[status]) fail('알 수 없는 상태입니다.');
    if (run.status === status) return [];
    var prev = run.status; run.status = status;
    if (status === 'done' || status === 'aborted') run.endedAt = nowISO(); else run.endedAt = null;
    if (status === 'active' && run.archived) { run.archived = false; run.archivedAt = null; }
    run.updatedAt = nowISO();
    return [logRec(run, null, me, 'run-status', RUN_STATUS[prev] + ' → ' + RUN_STATUS[status] + (note ? ' · ' + note : ''))];
  }
  function opRunArchive(run, flag, me) {
    if (flag && run.status !== 'done' && run.status !== 'aborted') fail('완료 또는 중단된 런만 아카이브에 올릴 수 있습니다.');
    if (!!run.archived === !!flag) return [];
    run.archived = !!flag; run.archivedAt = flag ? nowISO() : null; run.updatedAt = nowISO();
    return [logRec(run, null, me, flag ? 'run-archive' : 'run-unarchive', flag ? '아카이브에 올림 (모든 구성원에게 공개, 읽기 전용)' : '아카이브에서 내림')];
  }
  function buildRun(ctx, runs, cfg, p, me) {
    if (!me || !me.id) fail('로그인이 필요합니다.');
    var team = str(p.team) || str(me.team); if (!team) fail('팀을 입력하세요.');
    var flow = p.flowId ? byId(ctx.flows, p.flowId) : null;
    if (p.flowId && !flow) fail('흐름을 찾을 수 없습니다.');
    var title = str(p.title) || (flow ? flow.name : '') || '새 런';
    var domain = str(p.domain) || (flow ? flow.domain : '') || 'device';
    var unitLabel = str(p.unitLabel) || (flow ? flow.unitLabel : '') || '기판';
    var unitCount = Math.max(1, Math.round(Number(p.unitCount)) || (flow ? flow.unitCount : 1) || 1);
    var run = { id: uid(), code: runCode(runs, cfg.runCodePrefix), ownerId: me.id, domain: domain, team: team, owner: str(p.owner) || me.name, title: title, flowId: flow ? flow.id : null, flowName: flow ? flow.name : '',
      sample: str(p.sample), substrate: str(p.substrate), goal: str(p.goal), note: str(p.note), unitLabel: unitLabel, unitCount: unitCount, units: [], rows: [], splits: [],
      status: 'active', archived: false, archivedAt: null, startedAt: toISO(p.startedAt) || nowISO(), endedAt: null, createdAt: nowISO(), updatedAt: nowISO() };
    if (flow) {
      var src = clone(flow); src.unitCount = unitCount;
      (src.splits || []).forEach(function (s) { if (p.splits && p.splits[s.id] !== undefined) s.name = str(p.splits[s.id]); s.branches.forEach(function (b) { var o = p.branches && p.branches[b.id]; if (!o) return; if (o.name !== undefined && str(o.name)) b.name = str(o.name); if (o.count !== undefined && o.count !== '') b.count = Math.round(Number(o.count)) || 0; }); });
      SH.validate(src, unitLabel);
      SH.appendSheet(run, src, runCellMaker(ctx), { adopt: false, unitLabel: unitLabel });
    }
    run.units = makeUnits(unitLabel, run.unitCount, Array.isArray(p.units) ? p.units.map(str) : []);
    var st = SH.stats(run);
    var logs = [logRec(run, null, { name: run.owner, team: run.team }, 'run-create', (flow ? '흐름 "' + flow.name + '" 복사 · ' : '빈 런시트 · ') + st.rows + '행 ' + st.cells + '스텝 · ' + unitLabel + ' ' + run.unitCount + (st.splits ? ' · 분기점 ' + st.splits + '개' : '') + (run.sample ? ' · 시료 ' + run.sample : ''))];
    return { run: run, logs: logs };
  }
  function resheet(run) { SH.reid(run); }
  function buildClone(src, runs, cfg, p, me) {
    p = p || {};
    var run = clone(src);
    run.id = uid(); run.code = runCode(runs, cfg.runCodePrefix); run.ownerId = me.id; run.status = 'active'; run.archived = false; run.archivedAt = null; run.startedAt = nowISO(); run.endedAt = null; run.createdAt = nowISO(); run.updatedAt = nowISO();
    run.title = str(p.title) || src.title + ' (복제)'; run.sample = str(p.sample); run.team = str(p.team) || me.team || src.team; run.owner = str(p.owner) || me.name; run.goal = p.goal !== undefined ? str(p.goal) : src.goal; run.note = '';
    resheet(run);
    run.rows.forEach(function (r) { Object.keys(r.cells).forEach(function (k) { var s = r.cells[k]; if (p.fromActual && s.status === 'done' && Object.keys(s.actual || {}).length) s.planned = clone(s.actual); r.cells[k] = cloneStep(s); }); });
    return { run: run, logs: [logRec(run, null, { name: run.owner, team: run.team }, 'run-clone', '"' + src.code + ' ' + src.title + '" 에서 복제' + (p.fromActual ? ' (실제값을 계획으로)' : ''))] };
  }
  function flowFromRun(run, ctx, p, me) {
    var stats = { skipped: 0 }, src = clone(run);
    resheet(src);
    var rows = src.rows.map(function (r) {
      var row = { id: r.id, category: r.category, name: r.name, note: r.note, cells: {} };
      Object.keys(r.cells).forEach(function (k) {
        var s = r.cells[k]; if (s.status === 'skipped' && p.dropSkipped) return;
        var mod = byId(ctx.modules, s.moduleId); if (!mod) { stats.skipped++; return; }
        var params = (p.fromActual && s.status === 'done' && Object.keys(s.actual || {}).length) ? s.actual : s.planned;
        var d = defaults(mod.fields), diff = {};
        Object.keys(params || {}).forEach(function (kk) { if (String(params[kk]) !== String(d[kk] === undefined ? '' : d[kk])) diff[kk] = params[kk]; });
        row.cells[k] = { id: uid(), moduleId: mod.id, label: s.name !== mod.name ? s.name : '', params: diff, note: '' };
      });
      return row;
    });
    if (!rows.some(function (r) { return Object.keys(r.cells).length; })) fail('흐름으로 저장할 스텝이 없습니다.');
    var flow = normFlow({ name: str(p.name) || run.title, domain: run.domain, device: str(p.device), description: str(p.description) || ('런 ' + run.code + ' 에서 저장'), unitLabel: run.unitLabel, unitCount: run.unitCount, rows: rows, splits: src.splits }, { ownerId: me.id, ownerName: me.name });
    SH.validate(flow, flow.unitLabel);
    return { flow: flow, skipped: stats.skipped };
  }

  /* ---------- 시드 · 마이그레이션 ---------- */
  function importLibrary(data, lib) {
    var added = { modules: 0, flows: 0 };
    if (!lib) return added;
    (lib.modules || []).forEach(function (m) { if (byId(data.modules, m.id)) return; data.modules.push(normModule(m, { id: m.id, seed: true })); added.modules++; });
    (lib.flows || []).forEach(function (f) { var cur = byId(data.flows, f.id); var rec = normFlow(f, { id: f.id, seed: true }); if (cur) { if (cur.seed) Object.assign(cur, rec); return; } data.flows.push(rec); added.flows++; });
    (lib.materials || []).forEach(function (m) { var cur = byId(data.materials, m.id); var rec = normMaterial(m, { id: m.id, seed: true }); if (cur) { if (cur.seed) Object.assign(cur, rec); return; } data.materials.push(rec); added.materials = (added.materials || 0) + 1; });
    data.library = { version: lib.version || '', importedAt: nowISO() };
    return added;
  }
  function emptyData() { return { accounts: [], modules: [], flows: [], runs: [], logs: [], materials: [], library: null }; }
  /* 옛 흐름 items(트리) → rows/splits */
  function oldItemsToSheet(items, flows, unitCount) {
    function expand(list) {
      var out = [];
      (list || []).forEach(function (it) {
        if (!it) return;
        if (it.kind === 'split') { out.push({ kind: 'split', id: it.id, name: it.name, branches: (it.branches || []).map(function (b) { return { id: b.id, name: b.name, count: b.count, items: expand(b.items) }; }) }); return; }
        if (it.kind === 'flow') { var sub = byId(flows, it.refId); if (sub && Array.isArray(sub.items)) out = out.concat(expand(sub.items).map(function (n) { if (n.kind !== 'split' && it.params) n.params = Object.assign({}, n.params, it.params); return n; })); return; }
        if (it.refId) out.push({ kind: 'ref', id: it.id || uid(), moduleId: it.refId, label: it.label || '', params: it.params || {}, note: it.note || '', name: it.label || '', category: 'etc' });
      });
      return out;
    }
    return SH.fromTree(expand(items), null, unitCount);
  }
  function migrate(data, cfg, lib) {
    cfg = cfg || {};
    ['accounts', 'modules', 'flows', 'runs', 'logs', 'materials'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    var seedMat = {}; if (lib) (lib.materials || []).forEach(function (m) { seedMat[m.id] = 1; });
    data.materials = data.materials.map(function (m) { return normMaterial(m, { id: m.id, seed: !!m.seed || !!seedMat[m.id], ownerId: m.ownerId || null, ownerName: m.ownerName || '', createdAt: m.createdAt, active: m.active }); });
    if (!data.accounts.some(function (a) { return a.id === SUPER_ADMIN.id || nameKey(a.name) === nameKey(SUPER_ADMIN.name); })) data.accounts.unshift({ id: SUPER_ADMIN.id, name: SUPER_ADMIN.name, team: SUPER_ADMIN.team, seedPin: SUPER_ADMIN.seedPin, role: 'admin', createdAt: nowISO() });
    (cfg.defaultAccounts || []).forEach(function (d) { if (!d || !str(d.name) || data.accounts.some(function (a) { return nameKey(a.name) === nameKey(d.name); })) return; data.accounts.push({ id: uid(), name: str(d.name), team: str(d.team), seedPin: String(d.pin || '0000'), role: d.role === 'admin' ? 'admin' : 'member', createdAt: nowISO() }); });
    var seedM = {}, seedF = {}; if (lib) { (lib.modules || []).forEach(function (m) { seedM[m.id] = 1; }); (lib.flows || []).forEach(function (f) { seedF[f.id] = 1; }); }
    data.modules.forEach(function (m) { m.fields = normFields(m.fields); if (!Array.isArray(m.checklist)) m.checklist = []; if (m.active === undefined) m.active = true; if (!m.domain) m.domain = 'device'; if (seedM[m.id]) m.seed = true; if (m.seed === undefined) m.seed = false; if (m.ownerId === undefined) m.ownerId = null; if (!m.ownerName) m.ownerName = ''; });
    var oldFlows = clone(data.flows), modPool = data.modules.concat(lib && lib.modules ? lib.modules : []);
    data.flows = data.flows.map(function (f) {
      if (!Array.isArray(f.rows) && Array.isArray(f.items)) { var sh = oldItemsToSheet(f.items, oldFlows, Math.max(1, Number(f.unitCount) || 1)); f.rows = sh.rows.map(function (r) { var row = { id: r.id, category: r.category, name: r.name, note: r.note, cells: {} }; Object.keys(r.cells).forEach(function (k) { var c = r.cells[k]; row.cells[k] = { id: c.id || uid(), moduleId: c.moduleId, label: c.label || '', params: c.params || {}, note: c.note || '' }; }); return row; }); f.splits = sh.splits; delete f.items; }
      var rec = normFlow(f, { id: f.id, seed: !!f.seed || !!seedF[f.id], ownerId: f.ownerId || null, ownerName: f.ownerName || '', createdAt: f.createdAt, unitLabel: f.unitLabel, unitCount: f.unitCount, active: f.active });
      if (seedF[f.id]) rec.seed = true;
      rec.rows.forEach(function (r) { Object.keys(r.cells).forEach(function (k) { var mod = byId(modPool, r.cells[k].moduleId); if (mod && r.category === 'etc') r.category = mod.category || 'etc'; if (mod && !r.name) r.name = r.cells[k].label || mod.name; }); });
      return rec;
    });
    data.runs.forEach(function (r) {
      if (!r.domain) r.domain = 'device'; if (r.team === undefined) r.team = ''; if (!r.unitLabel) r.unitLabel = '기판'; if (!(r.unitCount >= 1)) r.unitCount = 1;
      if (r.ownerId === undefined) r.ownerId = null; if (r.archived === undefined) r.archived = false; if (r.archivedAt === undefined) r.archivedAt = null;
      if (!Array.isArray(r.rows)) {
        var steps = {}; (r.steps || []).forEach(function (s) { steps[s.id] = s; });
        var tree = Array.isArray(r.tree) ? r.tree : (r.steps || []).map(function (s) { return { kind: 'step', id: s.id }; });
        var sh = SH.fromTree(tree, steps, r.unitCount); r.rows = sh.rows; r.splits = sh.splits;
        r.rows.forEach(function (row) { var first = Object.keys(row.cells).map(function (k) { return row.cells[k]; })[0]; if (first) { row.category = first.category || 'etc'; row.name = row.name || first.name; } });
        delete r.steps; delete r.tree;
      }
      r.rows = normRows(r.rows, normStep); r.splits = normSplits(r.splits);
      if (!Array.isArray(r.units) || r.units.length !== r.unitCount) r.units = makeUnits(r.unitLabel, r.unitCount, r.units);
      if (!r.status) r.status = 'active';
    });
    data.logs.forEach(function (l) { if (l.team === undefined) l.team = ''; if (!l.date) l.date = localDate(l.at); if (l.branch === undefined) l.branch = ''; if (l.rowId === undefined) l.rowId = null; });
    return data;
  }

  /* ---------- 사진 (IndexedDB) ---------- */
  var IDB_NAME = 'dsil-runsheet-photos', IDB_STORE = 'photos';
  function idb() { return new Promise(function (resolve, reject) { if (!window.indexedDB) return reject(new Error('이 브라우저는 사진 저장을 지원하지 않습니다.')); var req = indexedDB.open(IDB_NAME, 1); req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); }; req.onsuccess = function () { resolve(req.result); }; req.onerror = function () { reject(req.error); }; }); }
  function idbOp(mode, fn) { return idb().then(function (db) { return new Promise(function (resolve, reject) { var tx = db.transaction(IDB_STORE, mode), st = tx.objectStore(IDB_STORE), req = fn(st); tx.oncomplete = function () { resolve(req ? req.result : undefined); }; tx.onerror = function () { reject(tx.error); }; }); }); }

  function readSessionRaw() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function writeSessionRaw(s) { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------ */
  /*  Local adapter                                                       */
  /* ------------------------------------------------------------------ */
  function LocalStore(cfg) {
    var data = null, session = null, listeners = [];
    var LIB = window.DSIL_LIBRARY || null;
    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function read() {
      try { data = JSON.parse(localStorage.getItem(DATA_KEY) || 'null'); } catch (e) { data = null; }
      if (!data || !Array.isArray(data.runs)) {
        data = null;
        OLD_KEYS.forEach(function (k) { if (data) return; try { var old = JSON.parse(localStorage.getItem(k) || 'null'); if (old && Array.isArray(old.runs)) data = old; } catch (e) { /* ignore */ } });
        if (!data) data = emptyData();
      }
      migrate(data, cfg, LIB);
      if (cfg.seedLibrary !== false && LIB && (!data.library || data.library.version !== LIB.version)) importLibrary(data, LIB);
      write();
    }
    function write() { try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) { console.warn('localStorage write failed', e); } }
    function ensureSeedHashes() { var todo = data.accounts.filter(function (a) { return !a.pinHash && a.seedPin; }); if (!todo.length) return Promise.resolve(); return Promise.all(todo.map(function (a) { return hashPin(a.seedPin).then(function (h) { a.pinHash = h; delete a.seedPin; }); })).then(function () { write(); }); }
    function accountById(id) { return byId(data.accounts, id); }
    function readSession() { var s = readSessionRaw(); session = null; if (!s || !s.user) return; var acc = accountById(s.user.id); if (!acc) { writeSessionRaw(null); return; } session = { user: { id: acc.id, name: acc.name, team: acc.team || '' }, isAdmin: acc.role === 'admin' }; }
    function me() { return session ? { id: session.user.id, name: session.user.name, team: session.user.team, isAdmin: session.isAdmin } : null; }
    function requireMe() { var m = me(); if (!m) fail('로그인이 필요합니다.'); return m; }
    function mix(over) { var m = requireMe(); return Object.assign({}, m, over && over.name ? { name: str(over.name), team: str(over.team) || m.team } : {}); }
    function canView(r) { var m = me(); if (!m) return false; return m.isAdmin || !!r.archived || r.ownerId === m.id; }
    function canEdit(r) { var m = me(); if (!m) return false; if (r.archived) return false; return m.isAdmin || r.ownerId === m.id; }
    function isOwner(r) { var m = me(); return !!m && (m.isAdmin || r.ownerId === m.id); }
    function ctx() { return { modules: data.modules, flows: data.flows }; }
    function runOf(id) { var r = byId(data.runs, id); if (!r || !canView(r)) fail('런을 찾을 수 없거나 볼 권한이 없습니다.'); return r; }
    function editableRun(id) { var r = runOf(id); if (!canEdit(r)) fail(r.archived ? '아카이브된 런은 읽기 전용입니다. 고치려면 아카이브에서 내리세요.' : '이 런을 고칠 권한이 없습니다.'); return r; }
    function commit(logs) { (logs || []).forEach(function (l) { data.logs.unshift(l); }); if (data.logs.length > 8000) data.logs.length = 8000; write(); emit(); }
    function wrap(fn) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }
    /* 런 변경 연산을 사본에서 실행하고 성공하면 반영 (실패 시 원본 보존) */
    function mutate(id, fn) {
      var r = editableRun(id), work = clone(r);
      var logs = fn(work);
      Object.keys(r).forEach(function (k) { delete r[k]; }); Object.assign(r, work);
      commit(logs); return clone(r);
    }
    function libItemCheck(cur, kind) {
      var m = requireMe();
      if (cur && cur.seed) fail('기본 제공 ' + kind + '은 수정·삭제할 수 없습니다. 복사해서 쓰세요.');
      if (cur && cur.ownerId && cur.ownerId !== m.id && !m.isAdmin) fail((cur.ownerName || '다른 사람') + ' 이 만든 ' + kind + '입니다. 복사해서 쓰세요.');
      return m;
    }
    window.addEventListener('storage', function (e) { if (e.key === DATA_KEY) { read(); readSession(); emit(); } if (e.key === SESSION_KEY) { readSession(); emit(); } });

    return {
      mode: 'local',
      init: function () { read(); return ensureSeedHashes().then(function () { readSession(); }); },
      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      getSession: function () { return session ? clone(session) : null; },
      getMe: function () { return me() || { id: null, name: '', team: '', isAdmin: false }; },

      signIn: function (p) {
        var name = str(p && p.name), pin = String(p && p.pin || '');
        if (!name) return Promise.reject(new Error('이름을 입력하세요.'));
        var acc = data.accounts.filter(function (a) { return nameKey(a.name) === nameKey(name); })[0];
        if (!acc) return Promise.reject(new Error('등록되지 않은 이름입니다.' + (cfg.allowSignup !== false ? ' 회원가입을 하세요.' : '')));
        return hashPin(pin).then(function (h) { if (h !== acc.pinHash) throw new Error('PIN이 올바르지 않습니다.'); session = { user: { id: acc.id, name: acc.name, team: acc.team || '' }, isAdmin: acc.role === 'admin' }; writeSessionRaw(session); emit(); return clone(session); });
      },
      signUp: function (p) {
        if (cfg.allowSignup === false) return Promise.reject(new Error('회원가입이 닫혀 있습니다. 관리자에게 계정을 요청하세요.'));
        var name = str(p && p.name), team = str(p && p.team), pin = String(p && p.pin || '');
        if (!name) return Promise.reject(new Error('이름을 입력하세요.'));
        if (!team) return Promise.reject(new Error('팀을 입력하세요.'));
        if (!validPin(pin)) return Promise.reject(new Error('PIN은 숫자 4~8자리입니다.'));
        if (data.accounts.some(function (a) { return nameKey(a.name) === nameKey(name); })) return Promise.reject(new Error('이미 등록된 이름입니다. 로그인하세요.'));
        return hashPin(pin).then(function (h) { var acc = { id: uid(), name: name, team: team, pinHash: h, role: 'member', createdAt: nowISO() }; data.accounts.push(acc); write(); session = { user: { id: acc.id, name: acc.name, team: acc.team }, isAdmin: false }; writeSessionRaw(session); emit(); return clone(session); });
      },
      signOut: function () { session = null; writeSessionRaw(null); emit(); return Promise.resolve(); },
      changeMyPin: function (oldPin, newPin) { return wrap(function () { var m = requireMe(); var acc = accountById(m.id); if (!validPin(newPin)) fail('새 PIN은 숫자 4~8자리입니다.'); return Promise.all([hashPin(oldPin), hashPin(newPin)]).then(function (hs) { if (hs[0] !== acc.pinHash) throw new Error('현재 PIN이 올바르지 않습니다.'); acc.pinHash = hs[1]; write(); }); }); },
      setMyTeam: function (team) { return wrap(function () { var m = requireMe(); if (!str(team)) fail('팀을 입력하세요.'); var acc = accountById(m.id); acc.team = str(team); session.user.team = acc.team; writeSessionRaw(session); write(); emit(); return clone(session); }); },
      listAccounts: function () { return wrap(function () { var m = requireMe(); if (!m.isAdmin) fail('관리자만 볼 수 있습니다.'); return data.accounts.map(publicAccount); }); },
      resetAccountPin: function (id, pin) { return wrap(function () { var m = requireMe(); if (!m.isAdmin) fail('관리자만 할 수 있습니다.'); var acc = accountById(id); if (!acc) fail('계정을 찾을 수 없습니다.'); if (!validPin(pin)) fail('PIN은 숫자 4~8자리입니다.'); return hashPin(pin).then(function (h) { acc.pinHash = h; write(); return publicAccount(acc); }); }); },
      setAccountTeam: function (id, team) { return wrap(function () { var m = requireMe(); if (!m.isAdmin) fail('관리자만 할 수 있습니다.'); var acc = accountById(id); if (!acc) fail('계정을 찾을 수 없습니다.'); acc.team = str(team); write(); emit(); return publicAccount(acc); }); },

      listModules: function () { return Promise.resolve(clone(data.modules)); },
      saveModule: function (m) {
        return wrap(function () {
          if (!str(m.name)) fail('모듈 이름을 입력하세요.');
          var cur = m.id ? byId(data.modules, m.id) : null, who = libItemCheck(cur, '모듈');
          if (data.modules.some(function (x) { return x.id !== (cur && cur.id) && x.name === str(m.name) && x.domain === (str(m.domain) || 'device'); })) fail('같은 분류에 같은 이름의 모듈이 있습니다. 이름을 바꾸세요.');
          var rec = normModule(m, cur || { ownerId: who.id, ownerName: who.name });
          if (cur) Object.assign(cur, rec); else data.modules.push(rec);
          write(); emit(); return clone(cur || rec);
        });
      },
      deleteModule: function (id) {
        return wrap(function () {
          var m = byId(data.modules, id); if (!m) fail('모듈을 찾을 수 없습니다.');
          libItemCheck(m, '모듈');
          var used = data.flows.some(function (f) { return f.rows.some(function (r) { return Object.keys(r.cells).some(function (k) { return r.cells[k].moduleId === id; }); }); }) || data.runs.some(function (r) { return r.rows.some(function (row) { return Object.keys(row.cells).some(function (k) { return row.cells[k].moduleId === id; }); }); });
          if (used) { m.active = false; m.updatedAt = nowISO(); } else data.modules = data.modules.filter(function (x) { return x.id !== id; });
          write(); emit(); return { deactivated: used };
        });
      },
      listFlows: function () { return Promise.resolve(clone(data.flows)); },
      saveFlow: function (f) {
        return wrap(function () {
          if (!str(f.name)) fail('흐름 이름을 입력하세요.');
          var cur = f.id ? byId(data.flows, f.id) : null, who = libItemCheck(cur, '흐름');
          var rec = normFlow(f, cur || { ownerId: who.id, ownerName: who.name });
          if (!rec.rows.length) fail('흐름에 행을 하나 이상 넣으세요.');
          rec.rows.forEach(function (r) { Object.keys(r.cells).forEach(function (k) { if (!byId(data.modules, r.cells[k].moduleId)) fail('행 "' + r.name + '" 의 모듈을 찾을 수 없습니다.'); }); });
          SH.validate(rec, rec.unitLabel);
          if (cur) Object.assign(cur, rec); else data.flows.push(rec);
          write(); emit(); return clone(cur || rec);
        });
      },
      deleteFlow: function (id) { return wrap(function () { var f = byId(data.flows, id); if (!f) fail('흐름을 찾을 수 없습니다.'); libItemCheck(f, '흐름'); data.flows = data.flows.filter(function (x) { return x.id !== id; }); write(); emit(); }); },
      listMaterials: function () { return Promise.resolve(clone(data.materials)); },
      saveMaterial: function (m) {
        return wrap(function () {
          if (!str(m.name)) fail('기판 · 재료 이름을 입력하세요.');
          var cur = m.id ? byId(data.materials, m.id) : null, who = libItemCheck(cur, '기판 · 재료');
          if (data.materials.some(function (x) { return x.id !== (cur && cur.id) && x.name === str(m.name); })) fail('같은 이름의 기판 · 재료가 이미 있습니다.');
          var rec = normMaterial(m, cur || { ownerId: who.id, ownerName: who.name });
          if (cur) Object.assign(cur, rec); else data.materials.push(rec);
          write(); emit(); return clone(cur || rec);
        });
      },
      deleteMaterial: function (id) { return wrap(function () { var m = byId(data.materials, id); if (!m) fail('기판 · 재료를 찾을 수 없습니다.'); libItemCheck(m, '기판 · 재료'); data.materials = data.materials.filter(function (x) { return x.id !== id; }); write(); emit(); }); },

      listRuns: function (opts) {
        opts = opts || {};
        var m = me(), scope = opts.scope || 'mine';
        var out = data.runs.filter(function (r) { if (scope === 'all') return !!(m && m.isAdmin); if (scope === 'archive') return !!r.archived; return !!m && r.ownerId === m.id; });
        return Promise.resolve(clone(out).sort(function (a, b) { return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt); }));
      },
      getRun: function (id) { var r = byId(data.runs, id); if (!r || !canView(r)) return Promise.resolve(null); var c = clone(r); c.canEdit = canEdit(r); c.isOwner = isOwner(r); return Promise.resolve(c); },
      createRun: function (p) { return wrap(function () { var b = buildRun(ctx(), data.runs, cfg, p || {}, requireMe()); data.runs.push(b.run); if (p && str(p.team) && session && !session.user.team) { var acc = accountById(session.user.id); if (acc) { acc.team = str(p.team); session.user.team = acc.team; writeSessionRaw(session); } } commit(b.logs); return clone(b.run); }); },
      updateRun: function (id, patch) { return wrap(function () { return mutate(id, function (r) { return opRunEdit(r, patch || {}, me()); }); }); },
      setRunStatus: function (id, status, note) { return wrap(function () { var r = runOf(id); if (!isOwner(r)) fail('이 런의 상태를 바꿀 권한이 없습니다.'); commit(opRunStatus(r, status, me(), note)); return clone(r); }); },
      setArchived: function (id, flag) { return wrap(function () { var r = runOf(id); if (!isOwner(r)) fail('런을 만든 사람만 아카이브를 바꿀 수 있습니다.'); commit(opRunArchive(r, flag, me())); return clone(r); }); },
      deleteRun: function (id) { return wrap(function () { var r = runOf(id); if (!isOwner(r)) fail('런을 만든 사람만 삭제할 수 있습니다.'); data.runs = data.runs.filter(function (x) { return x.id !== id; }); data.logs = data.logs.filter(function (l) { return l.runId !== id; }); write(); emit(); }); },
      cloneRun: function (id, p) { return wrap(function () { var b = buildClone(runOf(id), data.runs, cfg, p, requireMe()); data.runs.push(b.run); commit(b.logs); return clone(b.run); }); },
      saveRunAsFlow: function (id, p) { return wrap(function () { var b = flowFromRun(runOf(id), ctx(), p || {}, requireMe()); data.flows.push(b.flow); write(); emit(); return { flow: clone(b.flow), skipped: b.skipped }; }); },

      stepLog: function (runId, cellId, p, who) { return wrap(function () { var r = mutate(runId, function (w) { return opStepLog(w, cellId, p, mix(who)); }); return clone(SH.findCell(r, cellId).cell); }); },
      stepQuick: function (runId, cellId) { return wrap(function () { var r = mutate(runId, function (w) { return opStepQuick(w, cellId, requireMe()); }); return clone(SH.findCell(r, cellId).cell); }); },
      stepReopen: function (runId, cellId) { return wrap(function () { var r = mutate(runId, function (w) { return opStepReopen(w, cellId, me()); }); return clone(SH.findCell(r, cellId).cell); }); },
      cellEdit: function (runId, cellId, patch) { return wrap(function () { return mutate(runId, function (w) { return opCellEdit(w, cellId, patch || {}, me()); }); }); },
      rowInsert: function (runId, o) { return wrap(function () { return mutate(runId, function (w) { return opRowInsert(w, ctx(), o || {}, me()); }); }); },
      rowRemove: function (runId, rowId) { return wrap(function () { return mutate(runId, function (w) { return opRowRemove(w, rowId, me()); }); }); },
      rowMove: function (runId, rowId, dir) { return wrap(function () { return mutate(runId, function (w) { return opRowMove(w, rowId, dir, me()); }); }); },
      rowEdit: function (runId, rowId, patch) { return wrap(function () { return mutate(runId, function (w) { return opRowEdit(w, rowId, patch || {}, me()); }); }); },
      cellSet: function (runId, rowId, leafId, spec) { return wrap(function () { return mutate(runId, function (w) { return opCellSet(w, ctx(), rowId, leafId, spec || {}, me()); }); }); },
      cellClear: function (runId, rowId, leafId) { return wrap(function () { return mutate(runId, function (w) { return opCellClear(w, rowId, leafId, me()); }); }); },
      splitAdd: function (runId, o) { return wrap(function () { return mutate(runId, function (w) { return opSplitAdd(w, o || {}, me()); }); }); },
      splitEdit: function (runId, splitId, patch) { return wrap(function () { return mutate(runId, function (w) { return opSplitEdit(w, splitId, patch || {}, me()); }); }); },
      splitRemove: function (runId, splitId) { return wrap(function () { return mutate(runId, function (w) { return opSplitRemove(w, splitId, me()); }); }); },
      splitClose: function (runId, rowId) { return wrap(function () { return mutate(runId, function (w) { return opSplitClose(w, rowId, me()); }); }); },
      copyFlow: function (runId, flowId) { return wrap(function () { return mutate(runId, function (w) { return opCopyFlow(w, ctx(), flowId, me()); }); }); },

      listLogs: function (runId, limit, scope) {
        var m = me(); if (!m) return Promise.resolve([]);
        var visible = {}; data.runs.forEach(function (r) { if (runId ? (r.id === runId && canView(r)) : (scope === 'all' ? m.isAdmin : scope === 'archive' ? r.archived : r.ownerId === m.id)) visible[r.id] = 1; });
        var out = data.logs.filter(function (l) { return visible[l.runId]; });
        return Promise.resolve(clone(limit ? out.slice(0, limit) : out));
      },
      savePhoto: function (dataUrl) { var key = 'ph-' + uid(); return idbOp('readwrite', function (st) { return st.put(dataUrl, key); }).then(function () { return key; }); },
      loadPhoto: function (key) { return key ? idbOp('readonly', function (st) { return st.get(key); }) : Promise.resolve(null); },
      deletePhoto: function (key) { return key ? idbOp('readwrite', function (st) { return st.delete(key); }).catch(function () {}) : Promise.resolve(); },
      exportJSON: function () { return clone(data); },
      importJSON: function (obj) { if (!obj || !Array.isArray(obj.runs) || !Array.isArray(obj.modules)) fail('형식이 올바르지 않습니다.'); data = migrate(clone(obj), cfg, LIB); write(); readSession(); emit(); },
      resetAll: function () { data = emptyData(); migrate(data, cfg, LIB); if (cfg.seedLibrary !== false && LIB) importLibrary(data, LIB); write(); return ensureSeedHashes().then(function () { readSession(); emit(); }); }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Supabase adapter                                                   */
  /* ------------------------------------------------------------------ */
  function loadScript(src) { return new Promise(function (resolve, reject) { var s = document.createElement('script'); s.src = src; s.async = true; s.onload = resolve; s.onerror = function () { reject(new Error('스크립트 로드 실패: ' + src)); }; document.head.appendChild(s); }); }
  function toModule(r) { return { id: r.id, domain: r.domain || 'device', name: r.name, category: r.category || 'etc', equipment: r.equipment || '', description: r.description || '', minutes: r.minutes || 0, fields: normFields(r.fields), checklist: r.checklist || [], active: r.active !== false, seed: !!r.seed, ownerId: r.owner_id || null, ownerName: r.owner_name || '', createdAt: r.created_at, updatedAt: r.updated_at }; }
  function fromModule(m) { return { id: m.id, domain: m.domain, name: m.name, category: m.category, equipment: m.equipment, description: m.description, minutes: m.minutes, fields: m.fields, checklist: m.checklist, active: m.active, seed: !!m.seed, owner_id: m.ownerId, owner_name: m.ownerName, updated_at: nowISO() }; }
  function toFlow(r) { return normFlow({ id: r.id, domain: r.domain, name: r.name, device: r.device, description: r.description, unitLabel: r.unit_label, unitCount: r.unit_count, rows: r.rows, splits: r.splits, active: r.active }, { id: r.id, seed: !!r.seed, ownerId: r.owner_id || null, ownerName: r.owner_name || '', createdAt: r.created_at }); }
  function fromFlow(f) { return { id: f.id, domain: f.domain, name: f.name, device: f.device, description: f.description, unit_label: f.unitLabel, unit_count: f.unitCount, rows: f.rows, splits: f.splits, active: f.active, seed: !!f.seed, owner_id: f.ownerId, owner_name: f.ownerName, updated_at: nowISO() }; }
  function toRun(r) { var run = { id: r.id, code: r.code, ownerId: r.owner_id || null, domain: r.domain || 'device', team: r.team || '', owner: r.owner || '', title: r.title, flowId: r.flow_id, flowName: r.flow_name || '', sample: r.sample || '', substrate: r.substrate || '', goal: r.goal || '', note: r.note || '', unitLabel: r.unit_label || '기판', unitCount: r.unit_count || 1, units: Array.isArray(r.units) ? r.units : [], rows: Array.isArray(r.rows) ? r.rows : null, splits: Array.isArray(r.splits) ? r.splits : [], steps: r.steps, tree: r.tree, status: r.status || 'active', archived: !!r.archived, archivedAt: r.archived_at || null, startedAt: r.started_at, endedAt: r.ended_at, createdAt: r.created_at, updatedAt: r.updated_at }; migrate({ runs: [run] }); return run; }
  function fromRun(r) { return { id: r.id, code: r.code, owner_id: r.ownerId, domain: r.domain, team: r.team, owner: r.owner, title: r.title, flow_id: r.flowId, flow_name: r.flowName, sample: r.sample, substrate: r.substrate, goal: r.goal, note: r.note, unit_label: r.unitLabel, unit_count: r.unitCount, units: r.units, rows: r.rows, splits: r.splits, status: r.status, archived: !!r.archived, archived_at: r.archivedAt, started_at: r.startedAt, ended_at: r.endedAt, updated_at: nowISO() }; }
  function toMaterial(r) { return normMaterial({ id: r.id, domain: r.domain, name: r.name, description: r.description, active: r.active }, { id: r.id, seed: !!r.seed, ownerId: r.owner_id || null, ownerName: r.owner_name || '', createdAt: r.created_at }); }
  function fromMaterial(m) { return { id: m.id, domain: m.domain, name: m.name, description: m.description, active: m.active, seed: !!m.seed, owner_id: m.ownerId, owner_name: m.ownerName, updated_at: nowISO() }; }
  function toLog(r) { return { id: r.id, runId: r.run_id, rowId: r.row_id || null, stepId: r.step_id, seq: r.seq, stepName: r.step_name || '', branch: r.branch || '', at: r.created_at, date: r.date || localDate(r.created_at), who: r.who || '', team: r.team || '', action: r.action, detail: r.detail || '' }; }
  function fromLog(l) { return { id: l.id, run_id: l.runId, row_id: l.rowId, step_id: l.stepId, seq: l.seq, step_name: l.stepName, branch: l.branch, who: l.who, team: l.team, action: l.action, detail: l.detail, date: l.date, created_at: l.at }; }
  function toAccount(r) { return { id: r.id, name: r.name, team: r.team || '', pinHash: r.pin_hash, role: r.role || 'member', createdAt: r.created_at }; }

  function SupabaseStore(cfg) {
    var client = null, session = null, listeners = [];
    var LIB = window.DSIL_LIBRARY || null;
    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function unwrap(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }
    function reject(msg) { return Promise.reject(msg instanceof Error ? msg : new Error(msg)); }
    function me() { return session ? { id: session.user.id, name: session.user.name, team: session.user.team, isAdmin: session.isAdmin } : null; }
    function requireMe() { var m = me(); if (!m) fail('로그인이 필요합니다.'); return m; }
    function mix(over) { var m = requireMe(); return Object.assign({}, m, over && over.name ? { name: str(over.name), team: str(over.team) || m.team } : {}); }
    function canView(r) { var m = me(); if (!m) return false; return m.isAdmin || !!r.archived || r.ownerId === m.id; }
    function canEdit(r) { var m = me(); if (!m) return false; if (r.archived) return false; return m.isAdmin || r.ownerId === m.id; }
    function isOwner(r) { var m = me(); return !!m && (m.isAdmin || r.ownerId === m.id); }
    function all(table, map) { return client.from(table).select('*').order('created_at').then(unwrap).then(function (rows) { return rows.map(map); }); }
    function ctx() { return Promise.all([all('modules', toModule), all('flows', toFlow)]).then(function (r) { return { modules: r[0], flows: r[1] }; }); }
    function fetchRun(id) { return client.from('runs').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { if (!r) fail('런을 찾을 수 없습니다.'); var run = toRun(r); if (!canView(run)) fail('이 런을 볼 권한이 없습니다.'); return run; }); }
    function fetchEditable(id) { return fetchRun(id).then(function (run) { if (!canEdit(run)) fail(run.archived ? '아카이브된 런은 읽기 전용입니다.' : '이 런을 고칠 권한이 없습니다.'); return run; }); }
    function putRun(run, logs, isNew) { var q = isNew ? client.from('runs').insert(fromRun(run)) : client.from('runs').update(fromRun(run)).eq('id', run.id); return q.then(unwrap).then(function () { return logs && logs.length ? client.from('run_logs').insert(logs.map(fromLog)).then(unwrap) : null; }).then(function () { emit(); return run; }); }
    function mutate(runId, fn) { return fetchEditable(runId).then(function (run) { var logs = fn(run); return putRun(run, logs, false); }); }
    function mutateCtx(runId, fn) { return Promise.all([fetchEditable(runId), ctx()]).then(function (r) { var logs = fn(r[0], r[1]); return putRun(r[0], logs, false); }); }
    function cellOf(run, cellId) { var f = SH.findCell(run, cellId); return f ? clone(f.cell) : null; }
    function photoBucket() { return client.storage.from('run-photos'); }
    function libCheck(cur, kind) { var m = requireMe(); if (cur && cur.seed) fail('기본 제공 ' + kind + '은 수정·삭제할 수 없습니다. 복사해서 쓰세요.'); if (cur && cur.ownerId && cur.ownerId !== m.id && !m.isAdmin) fail((cur.ownerName || '다른 사람') + ' 이 만든 ' + kind + '입니다. 복사해서 쓰세요.'); return m; }
    function accountByName(name) { return client.from('accounts').select('*').then(unwrap).then(function (rows) { return rows.map(toAccount).filter(function (a) { return nameKey(a.name) === nameKey(name); })[0] || null; }); }

    return {
      mode: 'supabase',
      init: function () {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return reject('config.js 에 supabaseUrl / supabaseAnonKey 를 설정하세요.');
        return loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js').then(function () {
          client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
          session = readSessionRaw();
          client.channel('runsheet-live').on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, emit).on('postgres_changes', { event: '*', schema: 'public', table: 'modules' }, emit).on('postgres_changes', { event: '*', schema: 'public', table: 'flows' }, emit).subscribe();
          return client.from('accounts').select('id', { count: 'exact', head: true }).then(function (res) {
            if (res.error || res.count > 0) return;
            var accs = [{ id: SUPER_ADMIN.id, name: SUPER_ADMIN.name, team: SUPER_ADMIN.team, pin: SUPER_ADMIN.seedPin, role: 'admin' }].concat((cfg.defaultAccounts || []).map(function (d) { return { id: uid(), name: str(d.name), team: str(d.team), pin: String(d.pin || '0000'), role: 'member' }; }));
            return Promise.all(accs.map(function (a) { return hashPin(a.pin).then(function (h) { return { id: a.id, name: a.name, team: a.team, pin_hash: h, role: a.role }; }); })).then(function (rows) { return client.from('accounts').insert(rows).then(unwrap); });
          }).then(function () {
            if (cfg.seedLibrary === false || !LIB) return;
            return client.from('modules').select('id', { count: 'exact', head: true }).then(function (res) {
              if (res.error || res.count > 0) return;
              return client.from('modules').insert(LIB.modules.map(function (m) { return fromModule(normModule(m, { id: m.id, seed: true })); })).then(unwrap).then(function () { return client.from('flows').insert(LIB.flows.map(function (f) { return fromFlow(normFlow(f, { id: f.id, seed: true })); })).then(unwrap); });
            }).then(function () {
              return client.from('materials').select('id', { count: 'exact', head: true }).then(function (res) {
                if (res.error || res.count > 0 || !(LIB.materials || []).length) return;
                return client.from('materials').insert(LIB.materials.map(function (m) { return fromMaterial(normMaterial(m, { id: m.id, seed: true })); })).then(unwrap);
              });
            });
          });
        });
      },
      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      getSession: function () { return session ? clone(session) : null; },
      getMe: function () { return me() || { id: null, name: '', team: '', isAdmin: false }; },
      signIn: function (p) { var name = str(p && p.name), pin = String(p && p.pin || ''); if (!name) return reject('이름을 입력하세요.'); return Promise.all([accountByName(name), hashPin(pin)]).then(function (r) { var acc = r[0]; if (!acc) fail('등록되지 않은 이름입니다.'); if (r[1] !== acc.pinHash) fail('PIN이 올바르지 않습니다.'); session = { user: { id: acc.id, name: acc.name, team: acc.team }, isAdmin: acc.role === 'admin' }; writeSessionRaw(session); emit(); return clone(session); }); },
      signUp: function (p) { if (cfg.allowSignup === false) return reject('회원가입이 닫혀 있습니다.'); var name = str(p && p.name), team = str(p && p.team), pin = String(p && p.pin || ''); if (!name) return reject('이름을 입력하세요.'); if (!team) return reject('팀을 입력하세요.'); if (!validPin(pin)) return reject('PIN은 숫자 4~8자리입니다.'); return accountByName(name).then(function (dup) { if (dup) fail('이미 등록된 이름입니다. 로그인하세요.'); return hashPin(pin); }).then(function (h) { var row = { id: uid(), name: name, team: team, pin_hash: h, role: 'member' }; return client.from('accounts').insert(row).then(unwrap).then(function () { session = { user: { id: row.id, name: name, team: team }, isAdmin: false }; writeSessionRaw(session); emit(); return clone(session); }); }); },
      signOut: function () { session = null; writeSessionRaw(null); emit(); return Promise.resolve(); },
      changeMyPin: function (oldPin, newPin) { var m = me(); if (!m) return reject('로그인이 필요합니다.'); if (!validPin(newPin)) return reject('새 PIN은 숫자 4~8자리입니다.'); return Promise.all([client.from('accounts').select('*').eq('id', m.id).maybeSingle().then(unwrap), hashPin(oldPin), hashPin(newPin)]).then(function (r) { if (!r[0] || r[0].pin_hash !== r[1]) fail('현재 PIN이 올바르지 않습니다.'); return client.from('accounts').update({ pin_hash: r[2] }).eq('id', m.id).then(unwrap); }); },
      setMyTeam: function (team) { var m = me(); if (!m) return reject('로그인이 필요합니다.'); if (!str(team)) return reject('팀을 입력하세요.'); return client.from('accounts').update({ team: str(team) }).eq('id', m.id).then(unwrap).then(function () { session.user.team = str(team); writeSessionRaw(session); emit(); return clone(session); }); },
      listAccounts: function () { var m = me(); if (!m || !m.isAdmin) return reject('관리자만 볼 수 있습니다.'); return all('accounts', function (r) { return publicAccount(toAccount(r)); }); },
      resetAccountPin: function (id, pin) { var m = me(); if (!m || !m.isAdmin) return reject('관리자만 할 수 있습니다.'); if (!validPin(pin)) return reject('PIN은 숫자 4~8자리입니다.'); return hashPin(pin).then(function (h) { return client.from('accounts').update({ pin_hash: h }).eq('id', id).then(unwrap); }); },
      setAccountTeam: function (id, team) { var m = me(); if (!m || !m.isAdmin) return reject('관리자만 할 수 있습니다.'); return client.from('accounts').update({ team: str(team) }).eq('id', id).then(unwrap).then(function () { emit(); }); },

      listModules: function () { return all('modules', toModule); },
      saveModule: function (m) { if (!str(m.name)) return reject('모듈 이름을 입력하세요.'); return (m.id ? client.from('modules').select('*').eq('id', m.id).maybeSingle().then(unwrap).then(function (r) { return r ? toModule(r) : null; }) : Promise.resolve(null)).then(function (cur) { var who = libCheck(cur, '모듈'); var rec = normModule(m, cur || { ownerId: who.id, ownerName: who.name }); return client.from('modules').upsert(fromModule(rec)).select().single().then(unwrap).then(toModule); }); },
      deleteModule: function (id) { return Promise.all([client.from('modules').select('*').eq('id', id).maybeSingle().then(unwrap), client.from('flows').select('id, rows').then(unwrap), client.from('runs').select('id, rows').then(unwrap)]).then(function (r) { var cur = r[0] ? toModule(r[0]) : null; if (!cur) fail('모듈을 찾을 수 없습니다.'); libCheck(cur, '모듈'); var used = r[1].concat(r[2]).some(function (x) { return (x.rows || []).some(function (row) { return Object.keys(row.cells || {}).some(function (k) { return row.cells[k] && row.cells[k].moduleId === id; }); }); }); if (used) return client.from('modules').update({ active: false, updated_at: nowISO() }).eq('id', id).then(unwrap).then(function () { return { deactivated: true }; }); return client.from('modules').delete().eq('id', id).then(unwrap).then(function () { return { deactivated: false }; }); }); },
      listFlows: function () { return all('flows', toFlow); },
      saveFlow: function (f) { if (!str(f.name)) return reject('흐름 이름을 입력하세요.'); return (f.id ? client.from('flows').select('*').eq('id', f.id).maybeSingle().then(unwrap).then(function (r) { return r ? toFlow(r) : null; }) : Promise.resolve(null)).then(function (cur) { var who = libCheck(cur, '흐름'); var rec = normFlow(f, cur || { ownerId: who.id, ownerName: who.name }); if (!rec.rows.length) fail('흐름에 행을 하나 이상 넣으세요.'); SH.validate(rec, rec.unitLabel); return client.from('flows').upsert(fromFlow(rec)).select().single().then(unwrap).then(toFlow); }); },
      deleteFlow: function (id) { return client.from('flows').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { var cur = r ? toFlow(r) : null; if (!cur) fail('흐름을 찾을 수 없습니다.'); libCheck(cur, '흐름'); return client.from('flows').delete().eq('id', id).then(unwrap).then(function () {}); }); },
      listMaterials: function () { return all('materials', toMaterial); },
      saveMaterial: function (m) { if (!str(m.name)) return reject('기판 · 재료 이름을 입력하세요.'); return (m.id ? client.from('materials').select('*').eq('id', m.id).maybeSingle().then(unwrap).then(function (r) { return r ? toMaterial(r) : null; }) : Promise.resolve(null)).then(function (cur) { var who = libCheck(cur, '기판 · 재료'); var rec = normMaterial(m, cur || { ownerId: who.id, ownerName: who.name }); return client.from('materials').upsert(fromMaterial(rec)).select().single().then(unwrap).then(toMaterial); }); },
      deleteMaterial: function (id) { return client.from('materials').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { var cur = r ? toMaterial(r) : null; if (!cur) fail('기판 · 재료를 찾을 수 없습니다.'); libCheck(cur, '기판 · 재료'); return client.from('materials').delete().eq('id', id).then(unwrap).then(function () {}); }); },

      listRuns: function (opts) { opts = opts || {}; var m = me(), scope = opts.scope || 'mine'; if (!m) return Promise.resolve([]); var q = client.from('runs').select('*'); if (scope === 'archive') q = q.eq('archived', true); else if (scope !== 'all' || !m.isAdmin) q = q.eq('owner_id', m.id); return q.order('updated_at', { ascending: false }).limit(500).then(unwrap).then(function (rows) { return rows.map(toRun); }); },
      getRun: function (id) { return client.from('runs').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { if (!r) return null; var run = toRun(r); if (!canView(run)) return null; run.canEdit = canEdit(run); run.isOwner = isOwner(run); return run; }); },
      createRun: function (p) { var m = requireMe(); return Promise.all([ctx(), client.from('runs').select('code').then(unwrap)]).then(function (r) { var b = buildRun(r[0], r[1], cfg, p || {}, m); return putRun(b.run, b.logs, true); }); },
      updateRun: function (id, patch) { return mutate(id, function (run) { return opRunEdit(run, patch || {}, me()); }); },
      setRunStatus: function (id, status, note) { return fetchRun(id).then(function (run) { if (!isOwner(run)) fail('권한이 없습니다.'); return putRun(run, opRunStatus(run, status, me(), note), false); }); },
      setArchived: function (id, flag) { return fetchRun(id).then(function (run) { if (!isOwner(run)) fail('권한이 없습니다.'); return putRun(run, opRunArchive(run, flag, me()), false); }); },
      deleteRun: function (id) { return fetchRun(id).then(function (run) { if (!isOwner(run)) fail('권한이 없습니다.'); return client.from('runs').delete().eq('id', id).then(unwrap).then(function () { emit(); }); }); },
      cloneRun: function (id, p) { var m = requireMe(); return Promise.all([fetchRun(id), client.from('runs').select('code').then(unwrap)]).then(function (r) { var b = buildClone(r[0], r[1], cfg, p, m); return putRun(b.run, b.logs, true); }); },
      saveRunAsFlow: function (id, p) { var m = requireMe(); return Promise.all([fetchRun(id), ctx()]).then(function (r) { var b = flowFromRun(r[0], r[1], p || {}, m); return client.from('flows').insert(fromFlow(b.flow)).select().single().then(unwrap).then(function (row) { emit(); return { flow: toFlow(row), skipped: b.skipped }; }); }); },

      stepLog: function (runId, cellId, p, who) { return mutate(runId, function (run) { return opStepLog(run, cellId, p, mix(who)); }).then(function (run) { return cellOf(run, cellId); }); },
      stepQuick: function (runId, cellId) { return mutate(runId, function (run) { return opStepQuick(run, cellId, requireMe()); }).then(function (run) { return cellOf(run, cellId); }); },
      stepReopen: function (runId, cellId) { return mutate(runId, function (run) { return opStepReopen(run, cellId, me()); }).then(function (run) { return cellOf(run, cellId); }); },
      cellEdit: function (runId, cellId, patch) { return mutate(runId, function (run) { return opCellEdit(run, cellId, patch || {}, me()); }); },
      rowInsert: function (runId, o) { return mutateCtx(runId, function (run, c) { return opRowInsert(run, c, o || {}, me()); }); },
      rowRemove: function (runId, rowId) { return mutate(runId, function (run) { return opRowRemove(run, rowId, me()); }); },
      rowMove: function (runId, rowId, dir) { return mutate(runId, function (run) { return opRowMove(run, rowId, dir, me()); }); },
      rowEdit: function (runId, rowId, patch) { return mutate(runId, function (run) { return opRowEdit(run, rowId, patch || {}, me()); }); },
      cellSet: function (runId, rowId, leafId, spec) { return mutateCtx(runId, function (run, c) { return opCellSet(run, c, rowId, leafId, spec || {}, me()); }); },
      cellClear: function (runId, rowId, leafId) { return mutate(runId, function (run) { return opCellClear(run, rowId, leafId, me()); }); },
      splitAdd: function (runId, o) { return mutate(runId, function (run) { return opSplitAdd(run, o || {}, me()); }); },
      splitEdit: function (runId, splitId, patch) { return mutate(runId, function (run) { return opSplitEdit(run, splitId, patch || {}, me()); }); },
      splitRemove: function (runId, splitId) { return mutate(runId, function (run) { return opSplitRemove(run, splitId, me()); }); },
      splitClose: function (runId, rowId) { return mutate(runId, function (run) { return opSplitClose(run, rowId, me()); }); },
      copyFlow: function (runId, flowId) { return mutateCtx(runId, function (run, c) { return opCopyFlow(run, c, flowId, me()); }); },

      listLogs: function (runId, limit, scope) { var m = me(); if (!m) return Promise.resolve([]); return this.listRuns({ scope: runId ? 'all' : (scope || 'mine') }).then(function (runs) { var ids = {}; runs.forEach(function (r) { if (!runId || r.id === runId) ids[r.id] = 1; }); var q = client.from('run_logs').select('*'); if (runId) q = q.eq('run_id', runId); return q.order('created_at', { ascending: false }).limit(limit || 5000).then(unwrap).then(function (rows) { return rows.map(toLog).filter(function (l) { return runId ? true : ids[l.runId]; }); }); }); },
      savePhoto: function (dataUrl) { var key = 'ph-' + uid() + '.jpg'; return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) { return photoBucket().upload(key, blob, { contentType: 'image/jpeg' }); }).then(unwrap).then(function () { return key; }); },
      loadPhoto: function (key) { if (!key) return Promise.resolve(null); var r = photoBucket().getPublicUrl(key); return Promise.resolve(r && r.data ? r.data.publicUrl : null); },
      deletePhoto: function (key) { return key ? photoBucket().remove([key]).then(function () {}).catch(function () {}) : Promise.resolve(); },
      exportJSON: null, importJSON: null, resetAll: null
    };
  }

  window.DSILStore = {
    create: function (cfg) { cfg = cfg || {}; return cfg.backend === 'supabase' ? SupabaseStore(cfg) : LocalStore(cfg); },
    normFields: normFields, defaults: defaults, progress: progress, hashPin: hashPin, refCell: refCellMaker(), cloneRef: cloneRef, always: always,
    TERMINAL: TERMINAL, RUN_STATUS: RUN_STATUS, STEP_STATUS: STEP_STATUS, ACTIONS: ACTIONS
  };
})();
