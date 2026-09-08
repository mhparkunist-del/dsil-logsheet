/* =====================================================================
   DSIL Run Sheet – data layer
   ---------------------------------------------------------------------
   두 어댑터(local / supabase)가 같은 비동기 인터페이스를 제공합니다.
   로그인(이름 + PIN)이 있고, 런은 만든 사람(ownerId)만 보고 고칩니다. 완료된 런을 "아카이브"에 올리면 모두가 볼 수 있습니다(읽기 전용).
   기본 제공(seed) 라이브러리는 수정·삭제할 수 없고 복사해서 씁니다.

     init() / onChange(cb)
     getSession() → {user:{id,name,team}, isAdmin} | null ; getMe() → {id,name,team,isAdmin}
     signIn({name, pin}) / signUp({name, team, pin}) / signOut() / changeMyPin(old, new) / setMyTeam(team)
     listAccounts() (관리자) / resetAccountPin(id, pin) (관리자) / setAccountTeam(id, team) (관리자)
     listModules() / saveModule(m) / deleteModule(id)        seed 항목은 수정·삭제 불가, 남의 항목도 불가(복사만)
     listFlows() / saveFlow(f) / deleteFlow(id) / previewFlow(id)
     listRuns({scope:'mine'|'archive'|'all'}) / getRun(id) / createRun(p) / updateRun(id, patch) / setRunStatus(id, status, note) / setArchived(id, flag)
     deleteRun(id) / cloneRun(id, p) / saveRunAsFlow(id, p)
     stepLog(runId, stepId, p, who) / stepQuick(runId, stepId) / stepReopen(runId, stepId)
     sheetInsert(runId, {container, index, moduleId | flowId, name, params, note}) / sheetRemove / sheetMove / sheetEdit
     splitAdd(runId, {container, index, name, branches}) / splitEdit(runId, splitId, {name, branches}) / splitRemove(runId, splitId)
     listLogs(runId | null, limit, scope)
     savePhoto / loadPhoto / deletePhoto ; exportJSON / importJSON / resetAll (local)

   Account { id, name, team, pinHash, role:'admin'|'member', createdAt }
   Module  { id, domain, name, category, equipment, description, minutes, fields, checklist, active, seed, ownerId, ownerName, createdAt, updatedAt }
   Flow    { id, domain, name, device, description, unitLabel, unitCount, items:[Item], active, seed, ownerId, ownerName, createdAt, updatedAt }
   Item    { id, kind:'module'|'flow', refId, label, note, params } | { id, kind:'split', name, branches:[{id, name, count, items:[Item]}] }
   Run     { id, code, ownerId, domain, team, owner, title, flowId, flowName, sample, substrate, goal, note, unitLabel, unitCount, units:[name],
             tree:[{kind:'step', id} | {kind:'split', id, name, branches:[{id,name,count,items}]}], steps:[Step], status, archived, archivedAt, startedAt, endedAt, createdAt, updatedAt }
   Step    { id, seq, branchPath:[name], group, moduleId, name, category, equipment, minutes, fields, checklist, itemNote, planned, actual,
             status:'pending'|'done'|'skipped'|'failed', operator, team, date, result, issues, note, photos:[key], addedInRun, updatedAt, updatedBy }
   Log     { id, runId, stepId, seq, stepName, branch, at, date, who, team, action, detail }
   ===================================================================== */
(function () {
  'use strict';

  var DATA_KEY = 'dsil-runsheet-v2';
  var OLD_KEY = 'dsil-runsheet-v1';
  var SESSION_KEY = 'dsil-runsheet-session';
  var SUPER_ADMIN = { id: 'admin-1', name: '관리자', team: '관리자', seedPin: '0000' };
  var FIELD_TYPES = ['text', 'number', 'select', 'textarea', 'check'];
  var TERMINAL = { done: 1, skipped: 1, failed: 1 };
  var RUN_STATUS = { active: '진행 중', paused: '보류', done: '완료', aborted: '중단' };
  var STEP_STATUS = { pending: '대기', done: '완료', skipped: '건너뜀', failed: '실패' };
  var ACTIONS = {
    'run-create': '런 시작', 'run-edit': '런 정보 수정', 'run-status': '런 상태', 'run-clone': '런 복제', 'run-archive': '아카이브 올림', 'run-unarchive': '아카이브 내림',
    'step-done': '스텝 완료', 'step-skip': '건너뜀', 'step-fail': '실패', 'step-edit': '기록 수정', 'step-reopen': '되돌림',
    'sheet-insert': '시트: 스텝 추가', 'sheet-remove': '시트: 스텝 삭제', 'sheet-move': '시트: 순서 변경', 'sheet-edit': '시트: 계획 수정',
    'sheet-split-add': '시트: 분기점 추가', 'sheet-split-edit': '시트: 분기 수정', 'sheet-split-remove': '시트: 분기점 삭제'
  };

  function uid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) { /* fall through */ } }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function nowISO() { return new Date().toISOString(); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function localDate(iso) { if (!iso) return null; var d = new Date(iso); if (isNaN(d)) return String(iso).slice(0, 10); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function today() { return localDate(new Date().toISOString()); }
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function toISO(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function isTrue(v) { return v === true || v === 'true' || v === '예' || v === 'on'; }
  function fail(msg) { throw new Error(msg); }
  function byId(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0] || null; }
  function letter(i) { return String.fromCharCode(65 + (i % 26)); }
  function nameKey(s) { return str(s).replace(/\s+/g, '').toLowerCase(); }

  /* ---------- PIN 해시 (SHA-256 hex; 보안 컨텍스트가 아니면 약한 대체 해시) ---------- */
  function fallbackHash(s) { var h = 0x811c9dc5; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return 'fnv-' + h.toString(16); }
  function hashPin(pin) {
    var s = String(pin);
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }).catch(function () { return fallbackHash(s); });
    }
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

  /* ---------- 모듈 · 흐름(트리) ---------- */
  function normModule(m, cur) {
    cur = cur || {};
    return { id: cur.id || m.id || uid(), domain: str(m.domain) || cur.domain || 'device', name: str(m.name), category: str(m.category) || 'etc', equipment: str(m.equipment), description: str(m.description),
      minutes: Math.max(0, Number(m.minutes) || 0), fields: normFields(m.fields), checklist: Array.isArray(m.checklist) ? m.checklist.map(str).filter(Boolean) : String(m.checklist || '').split(/\r?\n/).map(str).filter(Boolean),
      active: m.active === undefined ? (cur.active === undefined ? true : cur.active) : !!m.active, seed: !!cur.seed, ownerId: cur.ownerId || null, ownerName: cur.ownerName || '', createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function normItem(it) {
    if (!it) return null;
    if (it.kind === 'split') {
      var branches = (Array.isArray(it.branches) ? it.branches : []).map(function (b, i) {
        return { id: b.id || uid(), name: str(b.name) || letter(i), count: Math.max(1, Math.round(Number(b.count)) || 1), items: (Array.isArray(b.items) ? b.items : []).map(normItem).filter(Boolean) };
      });
      return { id: it.id || uid(), kind: 'split', name: str(it.name), branches: branches };
    }
    if (!it.refId) return null;
    return { id: it.id || uid(), kind: it.kind === 'flow' ? 'flow' : 'module', refId: String(it.refId), label: str(it.label), note: str(it.note), params: (it.params && typeof it.params === 'object') ? it.params : {} };
  }
  function normFlow(f, cur) {
    cur = cur || {};
    return { id: cur.id || f.id || uid(), domain: str(f.domain) || cur.domain || 'device', name: str(f.name), device: str(f.device), description: str(f.description),
      unitLabel: str(f.unitLabel) || cur.unitLabel || '기판', unitCount: Math.max(1, Math.round(Number(f.unitCount)) || cur.unitCount || 1),
      items: (Array.isArray(f.items) ? f.items : []).map(normItem).filter(Boolean),
      active: f.active === undefined ? (cur.active === undefined ? true : cur.active) : !!f.active, seed: !!cur.seed, ownerId: cur.ownerId || null, ownerName: cur.ownerName || '', createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function hasSplit(items) { return (items || []).some(function (it) { return it.kind === 'split'; }); }
  function eachSplit(items, fn) { (items || []).forEach(function (it) { if (it.kind !== 'split') return; fn(it); it.branches.forEach(function (b) { eachSplit(b.items, fn); }); }); }
  function eachStep(items, fn, names) { names = names || []; (items || []).forEach(function (n) { if (n.kind === 'split') n.branches.forEach(function (b) { eachStep(b.items, fn, names.concat([b.name])); }); else fn(n, names); }); }
  function countSteps(items) { var n = 0; eachStep(items, function () { n++; }); return n; }
  function checkSplits(items, count, unitLabel) {
    (items || []).forEach(function (it) {
      if (it.kind !== 'split') return;
      var label = it.name ? '분기점 "' + it.name + '"' : '분기점';
      if (!it.branches || it.branches.length < 2) fail(label + ': 분기는 2개 이상이어야 합니다.');
      var sum = 0, names = {};
      it.branches.forEach(function (b) {
        if (!str(b.name)) fail(label + ': 분기 이름을 입력하세요.');
        if (names[b.name]) fail(label + ': 분기 이름이 겹칩니다 (' + b.name + ').');
        names[b.name] = 1;
        if (!(Number(b.count) >= 1)) fail(label + ': 분기 "' + b.name + '" 수량은 1 이상이어야 합니다.');
        sum += Number(b.count);
      });
      if (sum !== count) fail(label + ': 분기 수량 합(' + sum + ')이 나눌 수량(' + count + (unitLabel ? ' ' + unitLabel : '') + ')과 다릅니다.');
      it.branches.forEach(function (b) { checkSplits(b.items, b.count, unitLabel); });
    });
  }
  function stepFromModule(mod, o) {
    o = o || {};
    var fields = normFields(mod.fields);
    return { kind: 'step', id: uid(), seq: 0, branchPath: [], group: o.group || '', moduleId: mod.id, name: o.name || mod.name, category: mod.category || 'etc', equipment: mod.equipment || '', minutes: mod.minutes || 0,
      fields: fields, checklist: (mod.checklist || []).slice(), itemNote: o.itemNote || '', planned: Object.assign(defaults(fields), cleanValues(fields, o.params || {})), actual: {},
      status: 'pending', operator: '', team: '', date: null, result: '', issues: '', note: '', photos: [], addedInRun: !!o.addedInRun, updatedAt: null, updatedBy: '' };
  }
  function missingStep(name, group, note) { return { kind: 'step', missing: true, id: uid(), name: name, group: group || '', fields: [], planned: {}, itemNote: note || '' }; }
  function expandItems(ctx, items, path, group) {
    var out = [];
    (items || []).forEach(function (it) {
      if (it.kind === 'split') {
        out.push({ kind: 'split', id: it.id, name: it.name || '', branches: it.branches.map(function (b) { return { id: b.id, name: b.name, count: b.count, items: expandItems(ctx, b.items, path, group) }; }) });
      } else if (it.kind === 'flow') {
        var sub = byId(ctx.flows, it.refId);
        if (!sub) { out.push(missingStep('(삭제된 흐름: ' + it.refId + ')', group, it.note)); return; }
        if (path.indexOf(sub.id) >= 0) fail('흐름이 자기 자신을 포함합니다 (순환 참조).');
        if (hasSplit(sub.items)) fail('분기점이 있는 흐름은 서브 흐름으로 넣을 수 없습니다: ' + sub.name);
        var label = it.label || sub.name;
        var subItems = expandItems(ctx, sub.items, path.concat([sub.id]), (group ? group + ' › ' : '') + label);
        eachStep(subItems, function (s) {
          if (s.missing) return;
          if (it.params && Object.keys(it.params).length) s.planned = Object.assign({}, s.planned, cleanValues(s.fields, it.params));
          if (it.note) s.itemNote = s.itemNote ? s.itemNote + ' / ' + it.note : it.note;
        });
        out = out.concat(subItems);
      } else {
        var mod = byId(ctx.modules, it.refId);
        if (!mod) { out.push(missingStep('(삭제된 모듈: ' + it.refId + ')', group, it.note)); return; }
        out.push(stepFromModule(mod, { group: group, name: it.label || mod.name, params: it.params, itemNote: it.note }));
      }
    });
    return out;
  }
  function expandFlowTree(ctx, flowId) { var flow = byId(ctx.flows, flowId); if (!flow) fail('흐름을 찾을 수 없습니다.'); return expandItems(ctx, flow.items, [flow.id], ''); }
  function pruneMissing(items, onMissing) {
    return items.filter(function (n) { if (n.kind !== 'split' && n.missing) { if (onMissing) onMissing(n); return false; } return true; })
      .map(function (n) { if (n.kind === 'split') n.branches.forEach(function (b) { b.items = pruneMissing(b.items, onMissing); }); return n; });
  }
  function remapSplitIds(items) { (items || []).forEach(function (n) { if (n.kind === 'split') { n.id = uid(); n.branches.forEach(function (b) { b.id = uid(); remapSplitIds(b.items); }); } }); }
  function refTree(items, steps) {
    return items.map(function (n) {
      if (n.kind === 'split') return { kind: 'split', id: n.id, name: n.name || '', branches: n.branches.map(function (b) { return { id: b.id, name: b.name, count: b.count, items: refTree(b.items, steps) }; }) };
      var s = Object.assign({}, n); delete s.kind; delete s.missing; steps.push(s);
      return { kind: 'step', id: s.id };
    });
  }
  function eachRef(items, fn, names) { names = names || []; (items || []).forEach(function (n) { if (n.kind === 'split') n.branches.forEach(function (b) { eachRef(b.items, fn, names.concat([b.name])); }); else fn(n, names); }); }
  function reseq(run) {
    var map = {}; run.steps.forEach(function (s) { map[s.id] = s; });
    var n = 0, ordered = [];
    eachRef(run.tree, function (ref, names) { var s = map[ref.id]; if (!s) return; s.seq = ++n; s.branchPath = names.slice(); ordered.push(s); });
    run.steps.forEach(function (s) { if (ordered.indexOf(s) < 0) { s.seq = ++n; ordered.push(s); } });
    run.steps = ordered;
  }
  function findContainer(run, container) {
    if (!container || container === 'root') return { id: 'root', items: run.tree, count: run.unitCount, name: '' };
    var found = null;
    (function walk(items) { (items || []).forEach(function (n) { if (found || n.kind !== 'split') return; n.branches.forEach(function (b) { if (found) return; if (b.id === container) found = { id: b.id, items: b.items, count: b.count, name: b.name, branch: b, split: n }; else walk(b.items); }); }); })(run.tree);
    if (!found) fail('분기를 찾을 수 없습니다.');
    return found;
  }
  function locateNode(run, id) {
    var res = null;
    (function walk(items, container, count) { (items || []).forEach(function (n, i) { if (res) return; if (n.id === id) { res = { list: items, index: i, node: n, container: container, count: count }; return; } if (n.kind === 'split') n.branches.forEach(function (b) { walk(b.items, b.id, b.count); }); }); })(run.tree, 'root', run.unitCount);
    if (!res) fail('스텝을 찾을 수 없습니다.');
    return res;
  }
  function countUnder(items) { var n = 0; eachRef(items, function () { n++; }); return n; }
  function makeUnits(label, count, old) { var u = (old || []).slice(0, count); for (var i = 0; i < count; i++) u[i] = u[i] || label + ' ' + (i + 1); return u; }

  function progress(run) {
    var t = run.steps.length, d = 0, sk = 0, f = 0;
    run.steps.forEach(function (s) { if (s.status === 'done') d++; else if (s.status === 'skipped') sk++; else if (s.status === 'failed') f++; });
    var cur = run.steps.filter(function (s) { return !TERMINAL[s.status]; })[0] || null;
    return { total: t, done: d, skipped: sk, failed: f, finished: d + sk + f, pct: t ? Math.round((d + sk + f) / t * 100) : 0, current: cur, allDone: t > 0 && d + sk + f === t };
  }
  function runCode(runs, prefix) {
    var d = new Date(), key = String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    var n = runs.filter(function (r) { return (r.code || '').indexOf((prefix || 'R') + '-' + key + '-') === 0; }).length + 1;
    return (prefix || 'R') + '-' + key + '-' + pad2(n);
  }
  function meOf(me) { me = me || {}; return { name: str(me.name), team: str(me.team) }; }
  function logRec(run, step, me, action, detail, date) {
    var m = meOf(me);
    return { id: uid(), runId: run.id, stepId: step ? step.id : null, seq: step ? step.seq : null, stepName: step ? step.name : '', branch: step && step.branchPath && step.branchPath.length ? step.branchPath.join(' › ') : '',
      at: nowISO(), date: date || today(), who: m.name, team: m.team || run.team || '', action: action, detail: str(detail).slice(0, 1000) };
  }
  function stepOf(run, stepId) { var s = byId(run.steps, stepId); if (!s) fail('스텝을 찾을 수 없습니다.'); return s; }
  function branchText(s) { return s.branchPath && s.branchPath.length ? ' [' + s.branchPath.join(' › ') + ']' : ''; }

  /* ---------- 런 변경 연산 (run 을 바꾸고 로그 배열을 돌려줌) ---------- */
  function opStepLog(run, stepId, p, me) {
    var s = stepOf(run, stepId), before = clone(s); p = p || {};
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
    s.status = st; s.updatedAt = nowISO(); s.updatedBy = str(me && me.name);
    run.updatedAt = nowISO();
    var action = st === 'done' ? (before.status === 'done' ? 'step-edit' : 'step-done') : st === 'skipped' ? 'step-skip' : st === 'failed' ? 'step-fail' : 'step-edit';
    var parts = [];
    if (action === 'step-done') { parts.push(paramText(s.fields, s.actual) || '조건 없음'); var dp = diffParams(s.fields, s.planned, s.actual); if (dp) parts.push('계획과 다름: ' + dp); }
    else if (action === 'step-edit') { var d2 = diffParams(s.fields, before.actual, s.actual); if (d2) parts.push('실제값 ' + d2); if (before.status !== st) parts.push(STEP_STATUS[before.status] + ' → ' + STEP_STATUS[st]); }
    if (st === 'skipped' || st === 'failed') parts.push(s.issues || s.result || '');
    if (s.result && action === 'step-done') parts.push('결과: ' + s.result);
    if (s.issues && action === 'step-done') parts.push('특이: ' + s.issues);
    return [logRec(run, s, { name: s.operator || (me && me.name), team: s.team || (me && me.team) }, action, parts.filter(Boolean).join(' · '), s.date)];
  }
  function opStepQuick(run, stepId, me) {
    var s = stepOf(run, stepId), m = meOf(me);
    if (TERMINAL[s.status]) fail('이미 끝난 스텝입니다.');
    if (!m.name) fail('로그인이 필요합니다.');
    var miss = missingRequired(s.fields, s.planned);
    if (miss) fail('계획값에 빈 필수 항목이 있어 바로 완료할 수 없습니다. "기록"에서 입력하세요. (' + miss.replace('필수 조건 항목을 입력하세요: ', '') + ')');
    s.actual = clone(s.planned); s.operator = m.name; s.team = m.team; s.date = today(); s.status = 'done'; s.updatedAt = nowISO(); s.updatedBy = m.name;
    run.updatedAt = nowISO();
    return [logRec(run, s, m, 'step-done', '계획대로 완료 · ' + (paramText(s.fields, s.actual) || '조건 없음'), s.date)];
  }
  function opStepReopen(run, stepId, me) {
    var s = stepOf(run, stepId);
    if (s.status === 'pending') fail('이미 대기 상태입니다.');
    var prev = s.status; s.status = 'pending'; s.date = null; s.updatedAt = nowISO(); s.updatedBy = str(me && me.name);
    run.updatedAt = nowISO();
    return [logRec(run, s, me, 'step-reopen', STEP_STATUS[prev] + ' → 대기')];
  }
  function opSheetInsert(run, ctx, o, me) {
    var c = findContainer(run, o.container), nodes, logs = [], flowName = '';
    if (o.flowId) {
      var fl = byId(ctx.flows, o.flowId); if (!fl) fail('흐름을 찾을 수 없습니다.');
      flowName = fl.name;
      if (hasSplit(fl.items)) {
        if (c.id !== 'root') fail('분기점이 있는 흐름은 공통 구간(맨 바깥)에만 넣을 수 있습니다.');
        var empty = !run.steps.length && !hasSplit(run.tree);
        if (fl.unitCount !== run.unitCount) {
          if (!empty) fail('흐름의 수량(' + fl.unitCount + ')이 이 런의 수량(' + run.unitCount + ')과 달라 넣을 수 없습니다. 런 정보에서 수량을 맞추거나 분기점을 직접 만드세요.');
          logs.push(logRec(run, null, me, 'run-edit', '수량: ' + run.unitCount + ' → ' + fl.unitCount + ' (흐름 "' + fl.name + '" 복사)'));
          run.unitCount = fl.unitCount; if (!run.unitLabel) run.unitLabel = fl.unitLabel; run.units = makeUnits(run.unitLabel, run.unitCount, run.units);
        }
        nodes = pruneMissing(expandItems(ctx, fl.items, [fl.id], ''));
        remapSplitIds(nodes);
        checkSplits(nodes, run.unitCount, run.unitLabel);
        if (!run.flowId) { run.flowId = fl.id; run.flowName = fl.name; }
      } else nodes = pruneMissing(expandItems(ctx, fl.items, [fl.id], o.whole ? '' : fl.name));
    } else if (o.moduleId) {
      var mod = byId(ctx.modules, o.moduleId); if (!mod) fail('모듈을 찾을 수 없습니다.');
      nodes = [stepFromModule(mod, { params: o.params, name: o.name })];
    } else fail('추가할 모듈 또는 흐름을 고르세요.');
    if (!nodes.length) fail('추가할 스텝이 없습니다.');
    var newSteps = [], refs = refTree(nodes, newSteps);
    newSteps.forEach(function (s) { s.addedInRun = true; if (o.note) s.itemNote = o.note; run.steps.push(s); });
    var idx = Math.max(0, Math.min(c.items.length, Number(o.index) || 0));
    c.items.splice.apply(c.items, [idx, 0].concat(refs));
    reseq(run); run.updatedAt = nowISO();
    if (newSteps.length > 3 && o.flowId) logs.push(logRec(run, null, me, 'sheet-insert', '흐름 "' + flowName + '" 복사: ' + newSteps.length + '개 스텝' + (hasSplit(refs) ? ' · 분기점 포함' : '') + (c.name ? ' (분기 ' + c.name + ')' : '')));
    else newSteps.forEach(function (s) { logs.push(logRec(run, s, me, 'sheet-insert', s.seq + '번 ' + s.name + branchText(s) + ' 추가' + (o.flowId ? ' (흐름: ' + flowName + ')' : '') + (paramText(s.fields, s.planned) ? ' · 계획 ' + paramText(s.fields, s.planned) : ''))); });
    return logs;
  }
  function opSheetRemove(run, stepId, me) {
    var s = stepOf(run, stepId);
    if (s.status !== 'pending') fail('진행된 스텝은 삭제할 수 없습니다. 건너뜀으로 처리하세요.');
    var loc = locateNode(run, stepId);
    var rec = logRec(run, s, me, 'sheet-remove', s.seq + '번 ' + s.name + branchText(s) + ' 삭제' + (s.addedInRun ? ' (런 중 추가된 스텝)' : ''));
    loc.list.splice(loc.index, 1);
    run.steps = run.steps.filter(function (x) { return x.id !== stepId; });
    reseq(run); run.updatedAt = nowISO();
    return [rec];
  }
  function opSheetMove(run, stepId, dir, me) {
    var s = stepOf(run, stepId), loc = locateNode(run, stepId);
    var j = dir === 'up' ? loc.index - 1 : loc.index + 1;
    if (j < 0 || j >= loc.list.length) fail('같은 구간 안에서 더 이동할 수 없습니다.');
    var t = loc.list[loc.index]; loc.list[loc.index] = loc.list[j]; loc.list[j] = t;
    var before = s.seq; reseq(run); run.updatedAt = nowISO();
    return [logRec(run, s, me, 'sheet-move', s.name + branchText(s) + ': ' + before + '번 → ' + s.seq + '번')];
  }
  function opSheetEdit(run, stepId, patch, me) {
    var s = stepOf(run, stepId), parts = [];
    if (patch.name !== undefined && str(patch.name) && str(patch.name) !== s.name) { parts.push('이름: ' + s.name + ' → ' + str(patch.name)); s.name = str(patch.name); }
    if (patch.equipment !== undefined && str(patch.equipment) !== s.equipment) { parts.push('장비: ' + (s.equipment || '(없음)') + ' → ' + (str(patch.equipment) || '(없음)')); s.equipment = str(patch.equipment); }
    if (patch.itemNote !== undefined && str(patch.itemNote) !== s.itemNote) { parts.push('메모: ' + (s.itemNote || '(없음)') + ' → ' + (str(patch.itemNote) || '(없음)')); s.itemNote = str(patch.itemNote); }
    if (patch.planned !== undefined) { var np = cleanValues(s.fields, patch.planned); var d = diffParams(s.fields, s.planned, np); if (d) { parts.push('계획 조건 ' + d); s.planned = np; } }
    if (!parts.length) return [];
    s.updatedAt = nowISO(); s.updatedBy = str(me && me.name); run.updatedAt = nowISO();
    return [logRec(run, s, me, 'sheet-edit', parts.join(' / '))];
  }
  function opSplitAdd(run, o, me) {
    var c = findContainer(run, o.container);
    if (c.count < 2) fail('나눌 수량이 ' + c.count + ' 이라 분기를 만들 수 없습니다.');
    var branches = (o.branches || []).map(function (b, i) { return { id: uid(), name: str(b.name) || letter(i), count: Math.round(Number(b.count)) || 0, items: [] }; });
    var node = { kind: 'split', id: uid(), name: str(o.name), branches: branches };
    checkSplits([node], c.count, run.unitLabel);
    var idx = Math.max(0, Math.min(c.items.length, Number(o.index) || 0));
    c.items.splice(idx, 0, node);
    reseq(run); run.updatedAt = nowISO();
    return [logRec(run, null, me, 'sheet-split-add', (c.name ? '분기 ' + c.name + ' 안에 ' : '') + '분기점' + (node.name ? ' "' + node.name + '"' : '') + ' 추가: ' + branches.map(function (b) { return b.name + ' ' + b.count; }).join(' / ') + ' ' + run.unitLabel)];
  }
  function opSplitEdit(run, splitId, o, me) {
    var loc = locateNode(run, splitId), node = loc.node;
    if (node.kind !== 'split') fail('분기점이 아닙니다.');
    var before = node.branches.map(function (b) { return b.name + ' ' + b.count; }).join(' / ');
    var saved = clone(node);
    var keep = [];
    (o.branches || []).forEach(function (b, i) {
      var ex = b.id ? byId(node.branches, b.id) : null;
      if (ex) { ex.name = str(b.name) || ex.name; ex.count = Math.round(Number(b.count)) || ex.count; keep.push(ex); }
      else keep.push({ id: uid(), name: str(b.name) || letter(i), count: Math.round(Number(b.count)) || 0, items: [] });
    });
    function restore() { node.name = saved.name; node.branches = saved.branches; }
    var removing = node.branches.filter(function (b) { return keep.indexOf(b) < 0 && countUnder(b.items) > 0; })[0];
    if (removing) { restore(); fail('분기 "' + removing.name + '" 에 스텝이 있어 뺄 수 없습니다. 스텝을 먼저 삭제하세요.'); }
    node.branches = keep; if (o.name !== undefined) node.name = str(o.name);
    try { checkSplits([node], loc.count, run.unitLabel); } catch (e) { restore(); throw e; }
    reseq(run); run.updatedAt = nowISO();
    return [logRec(run, null, me, 'sheet-split-edit', '분기점' + (node.name ? ' "' + node.name + '"' : '') + ': ' + before + ' → ' + node.branches.map(function (b) { return b.name + ' ' + b.count; }).join(' / '))];
  }
  function opSplitRemove(run, splitId, me) {
    var loc = locateNode(run, splitId), node = loc.node;
    if (node.kind !== 'split') fail('분기점이 아닙니다.');
    if (node.branches.some(function (b) { return countUnder(b.items) > 0; })) fail('분기 안에 스텝이 있어 분기점을 지울 수 없습니다.');
    loc.list.splice(loc.index, 1);
    reseq(run); run.updatedAt = nowISO();
    return [logRec(run, null, me, 'sheet-split-remove', '분기점' + (node.name ? ' "' + node.name + '"' : '') + ' 삭제 (' + node.branches.map(function (b) { return b.name; }).join(' / ') + ')')];
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
      if (n !== run.unitCount) {
        if (hasSplit(run.tree)) fail('분기점이 있는 런은 수량을 바꿀 수 없습니다. 분기 수정에서 수량을 조정하세요.');
        parts.push('수량: ' + run.unitCount + ' → ' + n); run.unitCount = n; run.units = makeUnits(run.unitLabel, n, run.units);
      }
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
    var missing = 0;
    var tree = flow ? pruneMissing(expandFlowTree(ctx, flow.id), function () { missing++; }) : [];
    eachSplit(tree, function (sp) {
      if (p.splits && p.splits[sp.id] !== undefined) sp.name = str(p.splits[sp.id]);
      sp.branches.forEach(function (b) { var o = p.branches && p.branches[b.id]; if (!o) return; if (o.name !== undefined && str(o.name)) b.name = str(o.name); if (o.count !== undefined && o.count !== '') b.count = Math.round(Number(o.count)) || 0; });
    });
    checkSplits(tree, unitCount, unitLabel);
    remapSplitIds(tree);
    var steps = [], refs = refTree(tree, steps);
    var run = { id: uid(), code: runCode(runs, cfg.runCodePrefix), ownerId: me.id, domain: domain, team: team, owner: str(p.owner) || me.name, title: title, flowId: flow ? flow.id : null, flowName: flow ? flow.name : '',
      sample: str(p.sample), substrate: str(p.substrate), goal: str(p.goal), note: str(p.note), unitLabel: unitLabel, unitCount: unitCount, units: makeUnits(unitLabel, unitCount, Array.isArray(p.units) ? p.units.map(str) : []), tree: refs, steps: steps,
      status: 'active', archived: false, archivedAt: null, startedAt: toISO(p.startedAt) || nowISO(), endedAt: null, createdAt: nowISO(), updatedAt: nowISO() };
    reseq(run);
    var nSplit = 0; eachSplit(run.tree, function () { nSplit++; });
    var logs = [logRec(run, null, { name: run.owner, team: run.team }, 'run-create', (flow ? '흐름 "' + flow.name + '" 복사 · ' : '빈 런시트 · ') + steps.length + '개 스텝 · ' + unitLabel + ' ' + unitCount + (nSplit ? ' · 분기점 ' + nSplit + '개' : '') + (missing ? ' (삭제된 모듈 ' + missing + '개 제외)' : '') + (run.sample ? ' · 시료 ' + run.sample : ''))];
    return { run: run, logs: logs };
  }
  function buildClone(src, runs, cfg, p, me) {
    p = p || {};
    var run = clone(src), idMap = {};
    run.id = uid(); run.code = runCode(runs, cfg.runCodePrefix); run.ownerId = me.id; run.status = 'active'; run.archived = false; run.archivedAt = null; run.startedAt = nowISO(); run.endedAt = null; run.createdAt = nowISO(); run.updatedAt = nowISO();
    run.title = str(p.title) || src.title + ' (복제)'; run.sample = str(p.sample); run.team = str(p.team) || me.team || src.team; run.owner = str(p.owner) || me.name; run.goal = p.goal !== undefined ? str(p.goal) : src.goal; run.note = '';
    run.steps.forEach(function (s) {
      var nid = uid(); idMap[s.id] = nid; s.id = nid;
      if (p.fromActual && s.status === 'done' && Object.keys(s.actual || {}).length) s.planned = clone(s.actual);
      s.actual = {}; s.status = 'pending'; s.operator = ''; s.team = ''; s.date = null; s.result = ''; s.issues = ''; s.note = ''; s.photos = []; s.updatedAt = null; s.updatedBy = '';
    });
    (function remap(items) { items.forEach(function (n) { if (n.kind === 'split') { n.id = uid(); n.branches.forEach(function (b) { b.id = uid(); remap(b.items); }); } else n.id = idMap[n.id] || n.id; }); })(run.tree);
    reseq(run);
    return { run: run, logs: [logRec(run, null, { name: run.owner, team: run.team }, 'run-clone', '"' + src.code + ' ' + src.title + '" 에서 복제' + (p.fromActual ? ' (실제값을 계획으로)' : ''))] };
  }
  function flowFromRun(run, ctx, p, me) {
    var stats = { skipped: 0 };
    function fromItems(items) {
      var out = [];
      items.forEach(function (n) {
        if (n.kind === 'split') { out.push({ id: uid(), kind: 'split', name: n.name || '', branches: n.branches.map(function (b) { return { id: uid(), name: b.name, count: b.count, items: fromItems(b.items) }; }) }); return; }
        var s = byId(run.steps, n.id); if (!s) return;
        if (s.status === 'skipped' && p.dropSkipped) return;
        var mod = byId(ctx.modules, s.moduleId); if (!mod) { stats.skipped++; return; }
        var params = (p.fromActual && s.status === 'done' && Object.keys(s.actual || {}).length) ? s.actual : s.planned;
        var d = defaults(mod.fields), diff = {};
        Object.keys(params || {}).forEach(function (k) { if (String(params[k]) !== String(d[k] === undefined ? '' : d[k])) diff[k] = params[k]; });
        out.push({ id: uid(), kind: 'module', refId: mod.id, label: s.name !== mod.name ? s.name : '', note: s.itemNote || '', params: diff });
      });
      return out;
    }
    var items = fromItems(run.tree);
    if (!countSteps(items)) fail('흐름으로 저장할 스텝이 없습니다.');
    var flow = normFlow({ name: str(p.name) || run.title, domain: run.domain, device: str(p.device), description: str(p.description) || ('런 ' + run.code + ' 에서 저장'), unitLabel: run.unitLabel, unitCount: run.unitCount, items: items }, { ownerId: me.id, ownerName: me.name });
    checkSplits(flow.items, flow.unitCount, flow.unitLabel);
    return { flow: flow, skipped: stats.skipped };
  }

  /* ---------- 시드 · 마이그레이션 ---------- */
  function importLibrary(data, lib) {
    var added = { modules: 0, flows: 0 };
    if (!lib) return added;
    (lib.modules || []).forEach(function (m) { if (byId(data.modules, m.id)) return; data.modules.push(normModule(m, { id: m.id, seed: true })); added.modules++; });
    (lib.flows || []).forEach(function (f) { if (byId(data.flows, f.id)) return; data.flows.push(normFlow(f, { id: f.id, seed: true })); added.flows++; });
    data.library = { version: lib.version || '', importedAt: nowISO() };
    return added;
  }
  function emptyData() { return { accounts: [], modules: [], flows: [], runs: [], logs: [], library: null }; }
  function migrate(data, cfg, lib) {
    cfg = cfg || {};
    ['accounts', 'modules', 'flows', 'runs', 'logs'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    if (!data.accounts.some(function (a) { return a.id === SUPER_ADMIN.id || nameKey(a.name) === nameKey(SUPER_ADMIN.name); })) data.accounts.unshift({ id: SUPER_ADMIN.id, name: SUPER_ADMIN.name, team: SUPER_ADMIN.team, seedPin: SUPER_ADMIN.seedPin, role: 'admin', createdAt: nowISO() });
    (cfg.defaultAccounts || []).forEach(function (d) { if (!d || !str(d.name) || data.accounts.some(function (a) { return nameKey(a.name) === nameKey(d.name); })) return; data.accounts.push({ id: uid(), name: str(d.name), team: str(d.team), seedPin: String(d.pin || '0000'), role: d.role === 'admin' ? 'admin' : 'member', createdAt: nowISO() }); });
    var seedM = {}, seedF = {}; if (lib) { (lib.modules || []).forEach(function (m) { seedM[m.id] = 1; }); (lib.flows || []).forEach(function (f) { seedF[f.id] = 1; }); }
    data.modules.forEach(function (m) { m.fields = normFields(m.fields); if (!Array.isArray(m.checklist)) m.checklist = []; if (m.active === undefined) m.active = true; if (!m.domain) m.domain = 'device'; if (seedM[m.id]) m.seed = true; if (m.seed === undefined) m.seed = false; if (m.ownerId === undefined) m.ownerId = null; if (!m.ownerName) m.ownerName = ''; });
    data.flows.forEach(function (f) { f.items = (f.items || []).map(normItem).filter(Boolean); if (f.active === undefined) f.active = true; if (!f.domain) f.domain = 'device'; if (!f.unitLabel) f.unitLabel = '기판'; if (!(f.unitCount >= 1)) f.unitCount = 1; if (seedF[f.id]) f.seed = true; if (f.seed === undefined) f.seed = false; if (f.ownerId === undefined) f.ownerId = null; if (!f.ownerName) f.ownerName = ''; });
    data.runs.forEach(function (r) {
      if (!Array.isArray(r.steps)) r.steps = [];
      if (!r.domain) r.domain = 'device'; if (r.team === undefined) r.team = ''; if (!r.unitLabel) r.unitLabel = '기판'; if (!(r.unitCount >= 1)) r.unitCount = 1;
      if (r.ownerId === undefined) r.ownerId = null; if (r.archived === undefined) r.archived = false; if (r.archivedAt === undefined) r.archivedAt = null;
      if (!Array.isArray(r.units) || r.units.length !== r.unitCount) r.units = makeUnits(r.unitLabel, r.unitCount, r.units);
      r.steps.forEach(function (s) {
        s.fields = normFields(s.fields); if (!s.planned) s.planned = {}; if (!s.actual) s.actual = {}; if (!s.photos) s.photos = [];
        if (s.status === 'running') s.status = 'pending'; if (!s.status) s.status = 'pending';
        if (s.date === undefined) s.date = s.endedAt ? localDate(s.endedAt) : (s.startedAt ? localDate(s.startedAt) : null);
        delete s.startedAt; delete s.endedAt; delete s.closedAt;
        if (s.team === undefined) s.team = ''; if (!Array.isArray(s.branchPath)) s.branchPath = [];
      });
      if (!Array.isArray(r.tree)) r.tree = r.steps.map(function (s) { return { kind: 'step', id: s.id }; });
      reseq(r);
      if (!r.status) r.status = 'active';
    });
    data.logs.forEach(function (l) { if (l.team === undefined) l.team = ''; if (!l.date) l.date = localDate(l.at); if (l.branch === undefined) l.branch = ''; });
    return data;
  }

  /* ---------- 사진 (IndexedDB) ---------- */
  var IDB_NAME = 'dsil-runsheet-photos', IDB_STORE = 'photos';
  function idb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('이 브라우저는 사진 저장을 지원하지 않습니다.'));
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function idbOp(mode, fn) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(IDB_STORE, mode), st = tx.objectStore(IDB_STORE), req = fn(st);
        tx.oncomplete = function () { resolve(req ? req.result : undefined); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  /* ---------- 세션 (브라우저) ---------- */
  function readSessionRaw() { try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; } }
  function writeSessionRaw(s) { try { if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }

  /* ------------------------------------------------------------------ */
  /*  Local adapter (localStorage)                                        */
  /* ------------------------------------------------------------------ */
  function LocalStore(cfg) {
    var data = null, session = null, listeners = [];
    var LIB = window.DSIL_LIBRARY || null;
    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function read() {
      try { data = JSON.parse(localStorage.getItem(DATA_KEY) || 'null'); } catch (e) { data = null; }
      if (!data || !Array.isArray(data.runs)) {
        var old = null; try { old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null'); } catch (e) { old = null; }
        data = (old && Array.isArray(old.runs)) ? old : emptyData();
      }
      migrate(data, cfg, LIB);
      if (cfg.seedLibrary !== false && LIB && (!data.library || data.library.version !== LIB.version)) importLibrary(data, LIB);
      write();
    }
    function write() { try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) { console.warn('localStorage write failed', e); } }
    function ensureSeedHashes() {
      var todo = data.accounts.filter(function (a) { return !a.pinHash && a.seedPin; });
      if (!todo.length) return Promise.resolve();
      return Promise.all(todo.map(function (a) { return hashPin(a.seedPin).then(function (h) { a.pinHash = h; delete a.seedPin; }); })).then(function () { write(); });
    }
    function accountById(id) { return byId(data.accounts, id); }
    function readSession() {
      var s = readSessionRaw(); session = null;
      if (!s || !s.user) return;
      var acc = accountById(s.user.id); if (!acc) { writeSessionRaw(null); return; }
      session = { user: { id: acc.id, name: acc.name, team: acc.team || '' }, isAdmin: acc.role === 'admin' };
    }
    function me() { return session ? { id: session.user.id, name: session.user.name, team: session.user.team, isAdmin: session.isAdmin } : null; }
    function requireMe() { var m = me(); if (!m) fail('로그인이 필요합니다.'); return m; }
    function mix(over) { var m = requireMe(); return Object.assign({}, m, over && over.name ? { name: str(over.name), team: str(over.team) || m.team } : {}); }
    function canView(r) { var m = me(); if (!m) return false; return m.isAdmin || !!r.archived || !r.ownerId || r.ownerId === m.id; }
    function canEdit(r) { var m = me(); if (!m) return false; if (r.archived) return false; return m.isAdmin || !r.ownerId || r.ownerId === m.id; }
    function isOwner(r) { var m = me(); return !!m && (m.isAdmin || !r.ownerId || r.ownerId === m.id); }
    function ctx() { return { modules: data.modules, flows: data.flows }; }
    function runOf(id) { var r = byId(data.runs, id); if (!r || !canView(r)) fail('런을 찾을 수 없거나 볼 권한이 없습니다.'); return r; }
    function editableRun(id) { var r = runOf(id); if (!canEdit(r)) fail(r.archived ? '아카이브된 런은 읽기 전용입니다. 고치려면 아카이브에서 내리세요.' : '이 런을 고칠 권한이 없습니다.'); return r; }
    function commit(logs) { (logs || []).forEach(function (l) { data.logs.unshift(l); }); if (data.logs.length > 8000) data.logs.length = 8000; write(); emit(); }
    function wrap(fn) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }
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

      /* ---------- 계정 ---------- */
      signIn: function (p) {
        var name = str(p && p.name), pin = String(p && p.pin || '');
        if (!name) return Promise.reject(new Error('이름을 입력하세요.'));
        var acc = data.accounts.filter(function (a) { return nameKey(a.name) === nameKey(name); })[0];
        if (!acc) return Promise.reject(new Error('등록되지 않은 이름입니다.' + (cfg.allowSignup !== false ? ' 회원가입을 하세요.' : '')));
        return hashPin(pin).then(function (h) {
          if (h !== acc.pinHash) throw new Error('PIN이 올바르지 않습니다.');
          session = { user: { id: acc.id, name: acc.name, team: acc.team || '' }, isAdmin: acc.role === 'admin' };
          writeSessionRaw(session); emit(); return clone(session);
        });
      },
      signUp: function (p) {
        if (cfg.allowSignup === false) return Promise.reject(new Error('회원가입이 닫혀 있습니다. 관리자에게 계정을 요청하세요.'));
        var name = str(p && p.name), team = str(p && p.team), pin = String(p && p.pin || '');
        if (!name) return Promise.reject(new Error('이름을 입력하세요.'));
        if (!team) return Promise.reject(new Error('팀을 입력하세요.'));
        if (!validPin(pin)) return Promise.reject(new Error('PIN은 숫자 4~8자리입니다.'));
        if (data.accounts.some(function (a) { return nameKey(a.name) === nameKey(name); })) return Promise.reject(new Error('이미 등록된 이름입니다. 로그인하세요.'));
        return hashPin(pin).then(function (h) {
          var acc = { id: uid(), name: name, team: team, pinHash: h, role: 'member', createdAt: nowISO() };
          data.accounts.push(acc); write();
          session = { user: { id: acc.id, name: acc.name, team: acc.team }, isAdmin: false };
          writeSessionRaw(session); emit(); return clone(session);
        });
      },
      signOut: function () { session = null; writeSessionRaw(null); emit(); return Promise.resolve(); },
      changeMyPin: function (oldPin, newPin) {
        return wrap(function () { var m = requireMe(); var acc = accountById(m.id); if (!validPin(newPin)) fail('새 PIN은 숫자 4~8자리입니다.'); return Promise.all([hashPin(oldPin), hashPin(newPin)]).then(function (hs) { if (hs[0] !== acc.pinHash) throw new Error('현재 PIN이 올바르지 않습니다.'); acc.pinHash = hs[1]; write(); }); });
      },
      setMyTeam: function (team) { return wrap(function () { var m = requireMe(); if (!str(team)) fail('팀을 입력하세요.'); var acc = accountById(m.id); acc.team = str(team); session.user.team = acc.team; writeSessionRaw(session); write(); emit(); return clone(session); }); },
      listAccounts: function () { return wrap(function () { var m = requireMe(); if (!m.isAdmin) fail('관리자만 볼 수 있습니다.'); return data.accounts.map(publicAccount); }); },
      resetAccountPin: function (id, pin) { return wrap(function () { var m = requireMe(); if (!m.isAdmin) fail('관리자만 할 수 있습니다.'); var acc = accountById(id); if (!acc) fail('계정을 찾을 수 없습니다.'); if (!validPin(pin)) fail('PIN은 숫자 4~8자리입니다.'); return hashPin(pin).then(function (h) { acc.pinHash = h; write(); return publicAccount(acc); }); }); },
      setAccountTeam: function (id, team) { return wrap(function () { var m = requireMe(); if (!m.isAdmin) fail('관리자만 할 수 있습니다.'); var acc = accountById(id); if (!acc) fail('계정을 찾을 수 없습니다.'); acc.team = str(team); write(); emit(); return publicAccount(acc); }); },

      /* ---------- 라이브러리 ---------- */
      listModules: function () { return Promise.resolve(clone(data.modules)); },
      saveModule: function (m) {
        return wrap(function () {
          if (!str(m.name)) fail('모듈 이름을 입력하세요.');
          var cur = m.id ? byId(data.modules, m.id) : null;
          var who = libItemCheck(cur, '모듈');
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
          var used = data.flows.some(function (f) { var u = false; eachStep(f.items, function (it) { if (it.kind === 'module' && it.refId === id) u = true; }); return u; }) || data.runs.some(function (r) { return r.steps.some(function (s) { return s.moduleId === id; }); });
          if (used) { m.active = false; m.updatedAt = nowISO(); } else data.modules = data.modules.filter(function (x) { return x.id !== id; });
          write(); emit(); return { deactivated: used };
        });
      },
      listFlows: function () { return Promise.resolve(clone(data.flows)); },
      saveFlow: function (f) {
        return wrap(function () {
          if (!str(f.name)) fail('흐름 이름을 입력하세요.');
          var cur = f.id ? byId(data.flows, f.id) : null;
          var who = libItemCheck(cur, '흐름');
          var rec = normFlow(f, cur || { ownerId: who.id, ownerName: who.name });
          if (!countSteps(rec.items) && !hasSplit(rec.items)) fail('흐름에 스텝을 하나 이상 넣으세요.');
          checkSplits(rec.items, rec.unitCount, rec.unitLabel);
          var tmp = { modules: data.modules, flows: data.flows.filter(function (x) { return x.id !== rec.id; }).concat([rec]) };
          expandFlowTree(tmp, rec.id);
          if (cur) Object.assign(cur, rec); else data.flows.push(rec);
          write(); emit(); return clone(cur || rec);
        });
      },
      deleteFlow: function (id) {
        return wrap(function () {
          var f = byId(data.flows, id); if (!f) fail('흐름을 찾을 수 없습니다.');
          libItemCheck(f, '흐름');
          var used = data.flows.some(function (x) { if (x.id === id) return false; var u = false; eachStep(x.items, function (it) { if (it.kind === 'flow' && it.refId === id) u = true; }); return u; });
          if (used) fail('다른 흐름이 이 흐름을 포함하고 있어 삭제할 수 없습니다.');
          data.flows = data.flows.filter(function (x) { return x.id !== id; });
          write(); emit();
        });
      },
      previewFlow: function (id) { return wrap(function () { return expandFlowTree(ctx(), id); }); },

      /* ---------- 런 ---------- */
      listRuns: function (opts) {
        opts = opts || {};
        var m = me(), scope = opts.scope || 'mine';
        var out = data.runs.filter(function (r) {
          if (scope === 'all') return !!(m && m.isAdmin);
          if (scope === 'archive') return !!r.archived;
          return !!m && (r.ownerId === m.id || !r.ownerId);
        });
        return Promise.resolve(clone(out).sort(function (a, b) { return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt); }));
      },
      getRun: function (id) { var r = byId(data.runs, id); if (!r || !canView(r)) return Promise.resolve(null); var c = clone(r); c.canEdit = canEdit(r); c.isOwner = isOwner(r); return Promise.resolve(c); },
      createRun: function (p) { return wrap(function () { var b = buildRun(ctx(), data.runs, cfg, p || {}, requireMe()); data.runs.push(b.run); if (p && str(p.team) && session && !session.user.team) { var acc = accountById(session.user.id); if (acc) { acc.team = str(p.team); session.user.team = acc.team; writeSessionRaw(session); } } commit(b.logs); return clone(b.run); }); },
      updateRun: function (id, patch) { return wrap(function () { var r = editableRun(id); commit(opRunEdit(r, patch || {}, me())); return clone(r); }); },
      setRunStatus: function (id, status, note) { return wrap(function () { var r = runOf(id); if (!isOwner(r)) fail('이 런의 상태를 바꿀 권한이 없습니다.'); commit(opRunStatus(r, status, me(), note)); return clone(r); }); },
      setArchived: function (id, flag) { return wrap(function () { var r = runOf(id); if (!isOwner(r)) fail('런을 만든 사람만 아카이브를 바꿀 수 있습니다.'); commit(opRunArchive(r, flag, me())); return clone(r); }); },
      deleteRun: function (id) { return wrap(function () { var r = runOf(id); if (!isOwner(r)) fail('런을 만든 사람만 삭제할 수 있습니다.'); data.runs = data.runs.filter(function (x) { return x.id !== id; }); data.logs = data.logs.filter(function (l) { return l.runId !== id; }); write(); emit(); }); },
      cloneRun: function (id, p) { return wrap(function () { var b = buildClone(runOf(id), data.runs, cfg, p, requireMe()); data.runs.push(b.run); commit(b.logs); return clone(b.run); }); },
      saveRunAsFlow: function (id, p) { return wrap(function () { var b = flowFromRun(runOf(id), ctx(), p || {}, requireMe()); data.flows.push(b.flow); write(); emit(); return { flow: clone(b.flow), skipped: b.skipped }; }); },

      stepLog: function (runId, stepId, p, who) { return wrap(function () { var r = editableRun(runId); commit(opStepLog(r, stepId, p, mix(who))); return clone(byId(r.steps, stepId)); }); },
      stepQuick: function (runId, stepId) { return wrap(function () { var r = editableRun(runId); commit(opStepQuick(r, stepId, requireMe())); return clone(byId(r.steps, stepId)); }); },
      stepReopen: function (runId, stepId) { return wrap(function () { var r = editableRun(runId); commit(opStepReopen(r, stepId, me())); return clone(byId(r.steps, stepId)); }); },
      sheetInsert: function (runId, o) { return wrap(function () { var r = editableRun(runId); commit(opSheetInsert(r, ctx(), o || {}, me())); return clone(r); }); },
      sheetRemove: function (runId, stepId) { return wrap(function () { var r = editableRun(runId); commit(opSheetRemove(r, stepId, me())); return clone(r); }); },
      sheetMove: function (runId, stepId, dir) { return wrap(function () { var r = editableRun(runId); commit(opSheetMove(r, stepId, dir, me())); return clone(r); }); },
      sheetEdit: function (runId, stepId, patch) { return wrap(function () { var r = editableRun(runId); commit(opSheetEdit(r, stepId, patch || {}, me())); return clone(r); }); },
      splitAdd: function (runId, o) { return wrap(function () { var r = editableRun(runId); commit(opSplitAdd(r, o || {}, me())); return clone(r); }); },
      splitEdit: function (runId, splitId, o) { return wrap(function () { var r = editableRun(runId); commit(opSplitEdit(r, splitId, o || {}, me())); return clone(r); }); },
      splitRemove: function (runId, splitId) { return wrap(function () { var r = editableRun(runId); commit(opSplitRemove(r, splitId, me())); return clone(r); }); },

      listLogs: function (runId, limit, scope) {
        var m = me(); if (!m) return Promise.resolve([]);
        var visible = {}; data.runs.forEach(function (r) { if (runId ? (r.id === runId && canView(r)) : (scope === 'all' ? m.isAdmin : scope === 'archive' ? r.archived : (r.ownerId === m.id || !r.ownerId))) visible[r.id] = 1; });
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
  /*  Supabase adapter – accounts/modules/flows/runs/run_logs 테이블. 권한 검사는 클라이언트에서 (내부용) */
  /* ------------------------------------------------------------------ */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = resolve; s.onerror = function () { reject(new Error('스크립트 로드 실패: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function toModule(r) { return { id: r.id, domain: r.domain || 'device', name: r.name, category: r.category || 'etc', equipment: r.equipment || '', description: r.description || '', minutes: r.minutes || 0, fields: normFields(r.fields), checklist: r.checklist || [], active: r.active !== false, seed: !!r.seed, ownerId: r.owner_id || null, ownerName: r.owner_name || '', createdAt: r.created_at, updatedAt: r.updated_at }; }
  function fromModule(m) { return { id: m.id, domain: m.domain, name: m.name, category: m.category, equipment: m.equipment, description: m.description, minutes: m.minutes, fields: m.fields, checklist: m.checklist, active: m.active, seed: !!m.seed, owner_id: m.ownerId, owner_name: m.ownerName, updated_at: nowISO() }; }
  function toFlow(r) { return { id: r.id, domain: r.domain || 'device', name: r.name, device: r.device || '', description: r.description || '', unitLabel: r.unit_label || '기판', unitCount: r.unit_count || 1, items: (r.items || []).map(normItem).filter(Boolean), active: r.active !== false, seed: !!r.seed, ownerId: r.owner_id || null, ownerName: r.owner_name || '', createdAt: r.created_at, updatedAt: r.updated_at }; }
  function fromFlow(f) { return { id: f.id, domain: f.domain, name: f.name, device: f.device, description: f.description, unit_label: f.unitLabel, unit_count: f.unitCount, items: f.items, active: f.active, seed: !!f.seed, owner_id: f.ownerId, owner_name: f.ownerName, updated_at: nowISO() }; }
  function toRun(r) { var run = { id: r.id, code: r.code, ownerId: r.owner_id || null, domain: r.domain || 'device', team: r.team || '', owner: r.owner || '', title: r.title, flowId: r.flow_id, flowName: r.flow_name || '', sample: r.sample || '', substrate: r.substrate || '', goal: r.goal || '', note: r.note || '', unitLabel: r.unit_label || '기판', unitCount: r.unit_count || 1, units: Array.isArray(r.units) ? r.units : [], tree: Array.isArray(r.tree) ? r.tree : null, steps: Array.isArray(r.steps) ? r.steps : [], status: r.status || 'active', archived: !!r.archived, archivedAt: r.archived_at || null, startedAt: r.started_at, endedAt: r.ended_at, createdAt: r.created_at, updatedAt: r.updated_at }; migrate({ runs: [run] }); return run; }
  function fromRun(r) { return { id: r.id, code: r.code, owner_id: r.ownerId, domain: r.domain, team: r.team, owner: r.owner, title: r.title, flow_id: r.flowId, flow_name: r.flowName, sample: r.sample, substrate: r.substrate, goal: r.goal, note: r.note, unit_label: r.unitLabel, unit_count: r.unitCount, units: r.units, tree: r.tree, steps: r.steps, status: r.status, archived: !!r.archived, archived_at: r.archivedAt, started_at: r.startedAt, ended_at: r.endedAt, updated_at: nowISO() }; }
  function toLog(r) { return { id: r.id, runId: r.run_id, stepId: r.step_id, seq: r.seq, stepName: r.step_name || '', branch: r.branch || '', at: r.created_at, date: r.date || localDate(r.created_at), who: r.who || '', team: r.team || '', action: r.action, detail: r.detail || '' }; }
  function fromLog(l) { return { id: l.id, run_id: l.runId, step_id: l.stepId, seq: l.seq, step_name: l.stepName, branch: l.branch, who: l.who, team: l.team, action: l.action, detail: l.detail, date: l.date, created_at: l.at }; }
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
    function canView(r) { var m = me(); if (!m) return false; return m.isAdmin || !!r.archived || !r.ownerId || r.ownerId === m.id; }
    function canEdit(r) { var m = me(); if (!m) return false; if (r.archived) return false; return m.isAdmin || !r.ownerId || r.ownerId === m.id; }
    function isOwner(r) { var m = me(); return !!m && (m.isAdmin || !r.ownerId || r.ownerId === m.id); }
    function all(table, map) { return client.from(table).select('*').order('created_at').then(unwrap).then(function (rows) { return rows.map(map); }); }
    function ctx() { return Promise.all([all('modules', toModule), all('flows', toFlow)]).then(function (r) { return { modules: r[0], flows: r[1] }; }); }
    function fetchRun(id) { return client.from('runs').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { if (!r) fail('런을 찾을 수 없습니다.'); var run = toRun(r); if (!canView(run)) fail('이 런을 볼 권한이 없습니다.'); return run; }); }
    function fetchEditable(id) { return fetchRun(id).then(function (run) { if (!canEdit(run)) fail(run.archived ? '아카이브된 런은 읽기 전용입니다.' : '이 런을 고칠 권한이 없습니다.'); return run; }); }
    function putRun(run, logs, isNew) {
      var q = isNew ? client.from('runs').insert(fromRun(run)) : client.from('runs').update(fromRun(run)).eq('id', run.id);
      return q.then(unwrap).then(function () { return logs && logs.length ? client.from('run_logs').insert(logs.map(fromLog)).then(unwrap) : null; }).then(function () { emit(); return run; });
    }
    function mutate(runId, fn) { return fetchEditable(runId).then(function (run) { var logs = fn(run); return putRun(run, logs, false); }); }
    function mutateCtx(runId, fn) { return Promise.all([fetchEditable(runId), ctx()]).then(function (r) { var logs = fn(r[0], r[1]); return putRun(r[0], logs, false); }); }
    function stepClone(run, stepId) { return clone(byId(run.steps, stepId)); }
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
          client.channel('runsheet-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, emit)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'modules' }, emit)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'flows' }, emit)
            .subscribe();
          return client.from('accounts').select('id', { count: 'exact', head: true }).then(function (res) {
            if (res.error || res.count > 0) return;
            var accs = [{ id: SUPER_ADMIN.id, name: SUPER_ADMIN.name, team: SUPER_ADMIN.team, pin: SUPER_ADMIN.seedPin, role: 'admin' }].concat((cfg.defaultAccounts || []).map(function (d) { return { id: uid(), name: str(d.name), team: str(d.team), pin: String(d.pin || '0000'), role: 'member' }; }));
            return Promise.all(accs.map(function (a) { return hashPin(a.pin).then(function (h) { return { id: a.id, name: a.name, team: a.team, pin_hash: h, role: a.role }; }); })).then(function (rows) { return client.from('accounts').insert(rows).then(unwrap); });
          }).then(function () {
            if (cfg.seedLibrary === false || !LIB) return;
            return client.from('modules').select('id', { count: 'exact', head: true }).then(function (res) {
              if (res.error || res.count > 0) return;
              return client.from('modules').insert(LIB.modules.map(function (m) { return fromModule(normModule(m, { id: m.id, seed: true })); })).then(unwrap)
                .then(function () { return client.from('flows').insert(LIB.flows.map(function (f) { return fromFlow(normFlow(f, { id: f.id, seed: true })); })).then(unwrap); });
            });
          });
        });
      },
      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      getSession: function () { return session ? clone(session) : null; },
      getMe: function () { return me() || { id: null, name: '', team: '', isAdmin: false }; },
      signIn: function (p) {
        var name = str(p && p.name), pin = String(p && p.pin || '');
        if (!name) return reject('이름을 입력하세요.');
        return Promise.all([accountByName(name), hashPin(pin)]).then(function (r) { var acc = r[0]; if (!acc) fail('등록되지 않은 이름입니다.'); if (r[1] !== acc.pinHash) fail('PIN이 올바르지 않습니다.'); session = { user: { id: acc.id, name: acc.name, team: acc.team }, isAdmin: acc.role === 'admin' }; writeSessionRaw(session); emit(); return clone(session); });
      },
      signUp: function (p) {
        if (cfg.allowSignup === false) return reject('회원가입이 닫혀 있습니다.');
        var name = str(p && p.name), team = str(p && p.team), pin = String(p && p.pin || '');
        if (!name) return reject('이름을 입력하세요.'); if (!team) return reject('팀을 입력하세요.'); if (!validPin(pin)) return reject('PIN은 숫자 4~8자리입니다.');
        return accountByName(name).then(function (dup) { if (dup) fail('이미 등록된 이름입니다. 로그인하세요.'); return hashPin(pin); }).then(function (h) { var row = { id: uid(), name: name, team: team, pin_hash: h, role: 'member' }; return client.from('accounts').insert(row).then(unwrap).then(function () { session = { user: { id: row.id, name: name, team: team }, isAdmin: false }; writeSessionRaw(session); emit(); return clone(session); }); });
      },
      signOut: function () { session = null; writeSessionRaw(null); emit(); return Promise.resolve(); },
      changeMyPin: function (oldPin, newPin) { var m = me(); if (!m) return reject('로그인이 필요합니다.'); if (!validPin(newPin)) return reject('새 PIN은 숫자 4~8자리입니다.'); return Promise.all([client.from('accounts').select('*').eq('id', m.id).maybeSingle().then(unwrap), hashPin(oldPin), hashPin(newPin)]).then(function (r) { if (!r[0] || r[0].pin_hash !== r[1]) fail('현재 PIN이 올바르지 않습니다.'); return client.from('accounts').update({ pin_hash: r[2] }).eq('id', m.id).then(unwrap); }); },
      setMyTeam: function (team) { var m = me(); if (!m) return reject('로그인이 필요합니다.'); if (!str(team)) return reject('팀을 입력하세요.'); return client.from('accounts').update({ team: str(team) }).eq('id', m.id).then(unwrap).then(function () { session.user.team = str(team); writeSessionRaw(session); emit(); return clone(session); }); },
      listAccounts: function () { var m = me(); if (!m || !m.isAdmin) return reject('관리자만 볼 수 있습니다.'); return all('accounts', function (r) { return publicAccount(toAccount(r)); }); },
      resetAccountPin: function (id, pin) { var m = me(); if (!m || !m.isAdmin) return reject('관리자만 할 수 있습니다.'); if (!validPin(pin)) return reject('PIN은 숫자 4~8자리입니다.'); return hashPin(pin).then(function (h) { return client.from('accounts').update({ pin_hash: h }).eq('id', id).then(unwrap); }); },
      setAccountTeam: function (id, team) { var m = me(); if (!m || !m.isAdmin) return reject('관리자만 할 수 있습니다.'); return client.from('accounts').update({ team: str(team) }).eq('id', id).then(unwrap).then(function () { emit(); }); },

      listModules: function () { return all('modules', toModule); },
      saveModule: function (m) {
        if (!str(m.name)) return reject('모듈 이름을 입력하세요.');
        return (m.id ? client.from('modules').select('*').eq('id', m.id).maybeSingle().then(unwrap).then(function (r) { return r ? toModule(r) : null; }) : Promise.resolve(null)).then(function (cur) {
          var who = libCheck(cur, '모듈'); var rec = normModule(m, cur || { ownerId: who.id, ownerName: who.name });
          return client.from('modules').upsert(fromModule(rec)).select().single().then(unwrap).then(toModule);
        });
      },
      deleteModule: function (id) {
        return Promise.all([client.from('modules').select('*').eq('id', id).maybeSingle().then(unwrap), client.from('flows').select('id, items').then(unwrap), client.from('runs').select('id, steps').then(unwrap)]).then(function (r) {
          var cur = r[0] ? toModule(r[0]) : null; if (!cur) fail('모듈을 찾을 수 없습니다.'); libCheck(cur, '모듈');
          var used = r[1].some(function (f) { var u = false; eachStep((f.items || []).map(normItem).filter(Boolean), function (it) { if (it.kind === 'module' && it.refId === id) u = true; }); return u; }) || r[2].some(function (run) { return (run.steps || []).some(function (s) { return s.moduleId === id; }); });
          if (used) return client.from('modules').update({ active: false, updated_at: nowISO() }).eq('id', id).then(unwrap).then(function () { return { deactivated: true }; });
          return client.from('modules').delete().eq('id', id).then(unwrap).then(function () { return { deactivated: false }; });
        });
      },
      listFlows: function () { return all('flows', toFlow); },
      saveFlow: function (f) {
        if (!str(f.name)) return reject('흐름 이름을 입력하세요.');
        return Promise.all([f.id ? client.from('flows').select('*').eq('id', f.id).maybeSingle().then(unwrap).then(function (r) { return r ? toFlow(r) : null; }) : Promise.resolve(null), ctx()]).then(function (r) {
          var cur = r[0], c = r[1], who = libCheck(cur, '흐름'); var rec = normFlow(f, cur || { ownerId: who.id, ownerName: who.name });
          if (!countSteps(rec.items) && !hasSplit(rec.items)) fail('흐름에 스텝을 하나 이상 넣으세요.');
          checkSplits(rec.items, rec.unitCount, rec.unitLabel); c.flows = c.flows.filter(function (x) { return x.id !== rec.id; }).concat([rec]); expandFlowTree(c, rec.id);
          return client.from('flows').upsert(fromFlow(rec)).select().single().then(unwrap).then(toFlow);
        });
      },
      deleteFlow: function (id) {
        return client.from('flows').select('*').then(unwrap).then(function (rows) {
          var cur = rows.filter(function (x) { return x.id === id; }).map(toFlow)[0]; if (!cur) fail('흐름을 찾을 수 없습니다.'); libCheck(cur, '흐름');
          if (rows.some(function (x) { if (x.id === id) return false; var u = false; eachStep((x.items || []).map(normItem).filter(Boolean), function (it) { if (it.kind === 'flow' && it.refId === id) u = true; }); return u; })) fail('다른 흐름이 이 흐름을 포함하고 있어 삭제할 수 없습니다.');
          return client.from('flows').delete().eq('id', id).then(unwrap).then(function () {});
        });
      },
      previewFlow: function (id) { return ctx().then(function (c) { return expandFlowTree(c, id); }); },

      listRuns: function (opts) {
        opts = opts || {}; var m = me(), scope = opts.scope || 'mine';
        if (!m) return Promise.resolve([]);
        var q = client.from('runs').select('*');
        if (scope === 'archive') q = q.eq('archived', true); else if (scope !== 'all' || !m.isAdmin) q = q.or('owner_id.eq.' + m.id + ',owner_id.is.null');
        return q.order('updated_at', { ascending: false }).limit(500).then(unwrap).then(function (rows) { return rows.map(toRun); });
      },
      getRun: function (id) { return client.from('runs').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { if (!r) return null; var run = toRun(r); if (!canView(run)) return null; run.canEdit = canEdit(run); run.isOwner = isOwner(run); return run; }); },
      createRun: function (p) { var m = requireMe(); return Promise.all([ctx(), client.from('runs').select('code').then(unwrap)]).then(function (r) { var b = buildRun(r[0], r[1], cfg, p || {}, m); return putRun(b.run, b.logs, true); }); },
      updateRun: function (id, patch) { return mutate(id, function (run) { return opRunEdit(run, patch || {}, me()); }); },
      setRunStatus: function (id, status, note) { return fetchRun(id).then(function (run) { if (!isOwner(run)) fail('권한이 없습니다.'); var logs = opRunStatus(run, status, me(), note); return putRun(run, logs, false); }); },
      setArchived: function (id, flag) { return fetchRun(id).then(function (run) { if (!isOwner(run)) fail('권한이 없습니다.'); var logs = opRunArchive(run, flag, me()); return putRun(run, logs, false); }); },
      deleteRun: function (id) { return fetchRun(id).then(function (run) { if (!isOwner(run)) fail('권한이 없습니다.'); return client.from('runs').delete().eq('id', id).then(unwrap).then(function () { emit(); }); }); },
      cloneRun: function (id, p) { var m = requireMe(); return Promise.all([fetchRun(id), client.from('runs').select('code').then(unwrap)]).then(function (r) { var b = buildClone(r[0], r[1], cfg, p, m); return putRun(b.run, b.logs, true); }); },
      saveRunAsFlow: function (id, p) { var m = requireMe(); return Promise.all([fetchRun(id), ctx()]).then(function (r) { var b = flowFromRun(r[0], r[1], p || {}, m); return client.from('flows').insert(fromFlow(b.flow)).select().single().then(unwrap).then(function (row) { emit(); return { flow: toFlow(row), skipped: b.skipped }; }); }); },

      stepLog: function (runId, stepId, p, who) { return mutate(runId, function (run) { return opStepLog(run, stepId, p, mix(who)); }).then(function (run) { return stepClone(run, stepId); }); },
      stepQuick: function (runId, stepId) { return mutate(runId, function (run) { return opStepQuick(run, stepId, requireMe()); }).then(function (run) { return stepClone(run, stepId); }); },
      stepReopen: function (runId, stepId) { return mutate(runId, function (run) { return opStepReopen(run, stepId, me()); }).then(function (run) { return stepClone(run, stepId); }); },
      sheetInsert: function (runId, o) { return mutateCtx(runId, function (run, c) { return opSheetInsert(run, c, o || {}, me()); }); },
      sheetRemove: function (runId, stepId) { return mutate(runId, function (run) { return opSheetRemove(run, stepId, me()); }); },
      sheetMove: function (runId, stepId, dir) { return mutate(runId, function (run) { return opSheetMove(run, stepId, dir, me()); }); },
      sheetEdit: function (runId, stepId, patch) { return mutate(runId, function (run) { return opSheetEdit(run, stepId, patch || {}, me()); }); },
      splitAdd: function (runId, o) { return mutate(runId, function (run) { return opSplitAdd(run, o || {}, me()); }); },
      splitEdit: function (runId, splitId, o) { return mutate(runId, function (run) { return opSplitEdit(run, splitId, o || {}, me()); }); },
      splitRemove: function (runId, splitId) { return mutate(runId, function (run) { return opSplitRemove(run, splitId, me()); }); },

      listLogs: function (runId, limit, scope) {
        var m = me(); if (!m) return Promise.resolve([]);
        return this.listRuns({ scope: runId ? 'all' : (scope || 'mine') }).then(function (runs) {
          var ids = {}; runs.forEach(function (r) { if (!runId || r.id === runId) ids[r.id] = 1; });
          if (runId && !ids[runId]) { /* 내 런 목록에 없으면 아카이브 등 볼 수 있는 런인지 개별 확인 */ }
          var q = client.from('run_logs').select('*'); if (runId) q = q.eq('run_id', runId);
          return q.order('created_at', { ascending: false }).limit(limit || 5000).then(unwrap).then(function (rows) { return rows.map(toLog).filter(function (l) { return runId ? true : ids[l.runId]; }); });
        });
      },

      savePhoto: function (dataUrl) { var key = 'ph-' + uid() + '.jpg'; return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) { return photoBucket().upload(key, blob, { contentType: 'image/jpeg' }); }).then(unwrap).then(function () { return key; }); },
      loadPhoto: function (key) { if (!key) return Promise.resolve(null); var r = photoBucket().getPublicUrl(key); return Promise.resolve(r && r.data ? r.data.publicUrl : null); },
      deletePhoto: function (key) { return key ? photoBucket().remove([key]).then(function () {}).catch(function () {}) : Promise.resolve(); },
      exportJSON: null, importJSON: null, resetAll: null
    };
  }

  window.DSILStore = {
    create: function (cfg) { cfg = cfg || {}; return cfg.backend === 'supabase' ? SupabaseStore(cfg) : LocalStore(cfg); },
    normFields: normFields, defaults: defaults, progress: progress, expandItems: expandItems, hasSplit: hasSplit, checkSplits: checkSplits, countSteps: countSteps, eachSplit: eachSplit, eachStep: eachStep, hashPin: hashPin,
    TERMINAL: TERMINAL, RUN_STATUS: RUN_STATUS, STEP_STATUS: STEP_STATUS, ACTIONS: ACTIONS
  };
})();
