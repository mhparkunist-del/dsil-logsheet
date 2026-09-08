/* =====================================================================
   DSIL Run Sheet – data layer
   ---------------------------------------------------------------------
   두 어댑터(local / supabase)가 같은 비동기 인터페이스를 제공합니다. 로그인은 없고,
   "내 이름"(getMe/setMe, 브라우저에 기억)이 모든 기록의 작업자로 붙습니다.

     init() / onChange(cb) / getMe() / setMe(name)
     listModules() / saveModule(m) / deleteModule(id)          모듈 = 재사용 공정 단위 (조건 항목 정의)
     listFlows() / saveFlow(f) / deleteFlow(id) / previewFlow(id)  흐름 = 모듈·다른 흐름의 재조합 (런시트 템플릿)
     listRuns() / getRun(id) / createRun(p) / updateRun(id, patch, who) / setRunStatus(id, status, who, note)
     deleteRun(id) / cloneRun(id, p) / saveRunAsFlow(id, p)
     stepStart(runId, stepId, who) / stepLog(runId, stepId, p, who) / stepReopen(runId, stepId, who)
     sheetInsert(runId, {index, moduleId | flowId, params}, who) / sheetRemove / sheetMove(runId, stepId, dir, who) / sheetEdit(runId, stepId, patch, who)
     listLogs(runId | null, limit)
     savePhoto(dataUrl) / loadPhoto(key) / deletePhoto(key)
     exportJSON() / importJSON(obj) / resetAll()   (local 전용)

   Module { id, name, category, equipment, description, minutes, fields:[{key,label,type,unit,options,required,default}], checklist:[], active, createdAt, updatedAt }
   Flow   { id, name, device, description, items:[{id, kind:'module'|'flow', refId, label, note, params}], active, createdAt, updatedAt }
   Run    { id, code, title, flowId, flowName, sample, owner, substrate, goal, note, status:'active'|'paused'|'done'|'aborted',
            startedAt, endedAt, steps:[Step], createdAt, updatedAt }
   Step   { id, seq, group, moduleId, name, category, equipment, minutes, fields, checklist, itemNote, planned, actual,
            status:'pending'|'running'|'done'|'skipped'|'failed', operator, startedAt, endedAt, result, issues, note, photos:[key], addedInRun, updatedAt, updatedBy }
   Log    { id, runId, stepId, seq, stepName, at, who, action, detail }
   ===================================================================== */
(function () {
  'use strict';

  var DATA_KEY = 'dsil-runsheet-v1';
  var ME_KEY = 'dsil-runsheet-me';
  var FIELD_TYPES = ['text', 'number', 'select', 'textarea', 'check'];
  var TERMINAL = { done: 1, skipped: 1, failed: 1 };
  var RUN_STATUS = { active: '진행 중', paused: '보류', done: '완료', aborted: '중단' };
  var STEP_STATUS = { pending: '대기', running: '진행 중', done: '완료', skipped: '건너뜀', failed: '실패' };
  var ACTIONS = {
    'run-create': '런 시작', 'run-edit': '런 정보 수정', 'run-status': '런 상태', 'run-clone': '런 복제',
    'step-start': '스텝 시작', 'step-done': '스텝 완료', 'step-skip': '건너뜀', 'step-fail': '실패', 'step-edit': '기록 수정', 'step-reopen': '되돌림',
    'sheet-insert': '시트: 스텝 추가', 'sheet-remove': '시트: 스텝 삭제', 'sheet-move': '시트: 순서 변경', 'sheet-edit': '시트: 계획 수정'
  };

  function uid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) { /* fall through */ } }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function nowISO() { return new Date().toISOString(); }
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function toISO(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function fmtShort(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return String(iso); return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function isTrue(v) { return v === true || v === 'true' || v === '예' || v === 'on'; }
  function fail(msg) { throw new Error(msg); }

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
      if (f && f.type === 'number') { var n = Number(v); if (!isNaN(n)) out[k] = n; else out[k] = v; }
      else out[k] = v;
    });
    return out;
  }
  function missingRequired(fields, values) {
    var miss = (fields || []).filter(function (f) { if (!f.required) return false; var v = (values || {})[f.key]; return v === undefined || v === '' || v === null; });
    return miss.length ? '필수 조건 항목을 입력하세요: ' + miss.map(function (f) { return f.label; }).join(', ') : null;
  }
  function defaults(fields) { var out = {}; (fields || []).forEach(function (f) { if (f.default !== undefined) out[f.key] = f.default; }); return out; }

  /* ---------- 모듈·흐름 ---------- */
  function normModule(m, cur) {
    cur = cur || {};
    return { id: cur.id || m.id || uid(), name: str(m.name), category: str(m.category) || 'etc', equipment: str(m.equipment), description: str(m.description),
      minutes: Math.max(0, Number(m.minutes) || 0), fields: normFields(m.fields), checklist: Array.isArray(m.checklist) ? m.checklist.map(str).filter(Boolean) : String(m.checklist || '').split(/\r?\n/).map(str).filter(Boolean),
      active: m.active === undefined ? (cur.active === undefined ? true : cur.active) : !!m.active, createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function normItem(it) {
    if (!it || !it.refId) return null;
    return { id: it.id || uid(), kind: it.kind === 'flow' ? 'flow' : 'module', refId: String(it.refId), label: str(it.label), note: str(it.note), params: (it.params && typeof it.params === 'object') ? it.params : {} };
  }
  function normFlow(f, cur) {
    cur = cur || {};
    return { id: cur.id || f.id || uid(), name: str(f.name), device: str(f.device), description: str(f.description), items: (Array.isArray(f.items) ? f.items : []).map(normItem).filter(Boolean),
      active: f.active === undefined ? (cur.active === undefined ? true : cur.active) : !!f.active, createdAt: cur.createdAt || nowISO(), updatedAt: nowISO() };
  }
  function byId(list, id) { return (list || []).filter(function (x) { return x.id === id; })[0] || null; }

  /* 흐름 전개: 서브 흐름은 재귀적으로 펼치고 group 에 경로를 남김. 순환 참조는 오류 */
  function expandFlow(ctx, flowId, path, groupLabel) {
    path = path || [];
    if (path.indexOf(flowId) >= 0) fail('흐름이 자기 자신을 포함합니다 (순환 참조).');
    var flow = byId(ctx.flows, flowId); if (!flow) fail('흐름을 찾을 수 없습니다.');
    var out = [];
    flow.items.forEach(function (it) {
      if (it.kind === 'flow') {
        var label = it.label || (byId(ctx.flows, it.refId) || {}).name || '';
        var sub = expandFlow(ctx, it.refId, path.concat([flowId]), (groupLabel ? groupLabel + ' › ' : '') + label);
        if (it.params && Object.keys(it.params).length) sub.forEach(function (s) { s.planned = Object.assign({}, s.planned, cleanValues(s.fields, it.params)); });
        if (it.note) sub.forEach(function (s) { s.itemNote = s.itemNote ? s.itemNote + ' / ' + it.note : it.note; });
        out = out.concat(sub);
      } else {
        var mod = byId(ctx.modules, it.refId);
        if (!mod) { out.push({ missing: true, name: '(삭제된 모듈: ' + it.refId + ')', group: groupLabel || '', fields: [], planned: {}, itemNote: it.note }); return; }
        out.push(stepFromModule(mod, { group: groupLabel || '', name: it.label || mod.name, params: it.params, itemNote: it.note }));
      }
    });
    return out;
  }
  function stepFromModule(mod, o) {
    o = o || {};
    var fields = normFields(mod.fields);
    return { id: uid(), seq: 0, group: o.group || '', moduleId: mod.id, name: o.name || mod.name, category: mod.category || 'etc', equipment: mod.equipment || '', minutes: mod.minutes || 0,
      fields: fields, checklist: (mod.checklist || []).slice(), itemNote: o.itemNote || '', planned: Object.assign(defaults(fields), cleanValues(fields, o.params || {})), actual: {},
      status: 'pending', operator: '', startedAt: null, endedAt: null, result: '', issues: '', note: '', photos: [], addedInRun: !!o.addedInRun, updatedAt: null, updatedBy: '' };
  }
  function reseq(run) { run.steps.forEach(function (s, i) { s.seq = i + 1; }); }
  function progress(run) {
    var t = run.steps.length, d = 0, sk = 0, f = 0, r = 0;
    run.steps.forEach(function (s) { if (s.status === 'done') d++; else if (s.status === 'skipped') sk++; else if (s.status === 'failed') f++; else if (s.status === 'running') r++; });
    var cur = run.steps.filter(function (s) { return !TERMINAL[s.status]; })[0] || null;
    return { total: t, done: d, skipped: sk, failed: f, running: r, finished: d + sk + f, pct: t ? Math.round((d + sk + f) / t * 100) : 0, current: cur, allDone: t > 0 && d + sk + f === t };
  }
  function runCode(runs, prefix) {
    var d = new Date(), key = String(d.getFullYear()).slice(2) + pad2(d.getMonth() + 1) + pad2(d.getDate());
    var n = runs.filter(function (r) { return (r.code || '').indexOf((prefix || 'R') + '-' + key + '-') === 0; }).length + 1;
    return (prefix || 'R') + '-' + key + '-' + pad2(n);
  }
  function logRec(run, step, who, action, detail) {
    return { id: uid(), runId: run.id, stepId: step ? step.id : null, seq: step ? step.seq : null, stepName: step ? step.name : '', at: nowISO(), who: str(who), action: action, detail: str(detail).slice(0, 1000) };
  }
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

  /* ---------- 런 변경 연산 (순수 함수: run 을 바꾸고 로그 배열을 돌려줌) ---------- */
  function stepOf(run, stepId) { var s = byId(run.steps, stepId); if (!s) fail('스텝을 찾을 수 없습니다.'); return s; }
  function opStepStart(run, stepId, who) {
    var s = stepOf(run, stepId);
    if (s.status === 'running') fail('이미 진행 중인 스텝입니다.');
    if (TERMINAL[s.status]) fail('끝난 스텝입니다. 되돌린 뒤 다시 시작하세요.');
    s.status = 'running'; s.operator = str(who) || s.operator; s.startedAt = nowISO(); s.endedAt = null; s.updatedAt = nowISO(); s.updatedBy = str(who);
    run.updatedAt = nowISO();
    return [logRec(run, s, who, 'step-start', s.name + (s.equipment ? ' · ' + s.equipment : ''))];
  }
  function opStepLog(run, stepId, p, who) {
    var s = stepOf(run, stepId), before = clone(s);
    p = p || {};
    if (p.operator !== undefined) s.operator = str(p.operator);
    if (p.startedAt !== undefined) s.startedAt = toISO(p.startedAt);
    if (p.endedAt !== undefined) s.endedAt = toISO(p.endedAt);
    if (p.actual !== undefined) s.actual = cleanValues(s.fields, p.actual);
    if (p.result !== undefined) s.result = str(p.result);
    if (p.issues !== undefined) s.issues = str(p.issues);
    if (p.note !== undefined) s.note = str(p.note);
    if (Array.isArray(p.photos)) s.photos = p.photos.slice();
    var st = p.status || s.status;
    if (!STEP_STATUS[st]) fail('알 수 없는 상태입니다.');
    if (st === 'done') {
      var miss = missingRequired(s.fields, s.actual); if (miss) { Object.assign(s, before); fail(miss); }
      if (!s.endedAt) s.endedAt = nowISO();
      if (!s.startedAt) s.startedAt = s.endedAt;
    }
    if ((st === 'skipped' || st === 'failed') && !s.endedAt) s.endedAt = nowISO();
    if (st === 'running' && !s.startedAt) s.startedAt = nowISO();
    if (st === 'pending') { s.endedAt = null; }
    if (s.startedAt && s.endedAt && new Date(s.endedAt) < new Date(s.startedAt)) { Object.assign(s, before); fail('종료 시각이 시작보다 빠릅니다.'); }
    if (s.startedAt && new Date(s.startedAt).getTime() > Date.now() + 10 * 60000) { Object.assign(s, before); fail('시작 시각이 미래입니다.'); }
    s.status = st; s.updatedAt = nowISO(); s.updatedBy = str(who);
    run.updatedAt = nowISO();
    var action = st === 'done' ? (before.status === 'done' ? 'step-edit' : 'step-done') : st === 'skipped' ? 'step-skip' : st === 'failed' ? 'step-fail' : 'step-edit';
    var parts = [];
    var dp = diffParams(s.fields, s.planned, s.actual);
    if (action === 'step-done') { parts.push(paramText(s.fields, s.actual) || '조건 없음'); if (dp) parts.push('계획과 다름: ' + dp); }
    else if (action === 'step-edit') { var d2 = diffParams(s.fields, before.actual, s.actual); if (d2) parts.push('실제값 ' + d2); }
    if (st === 'skipped' || st === 'failed') parts.push(s.issues || s.result || '');
    if (s.result && action === 'step-done') parts.push('결과: ' + s.result);
    if (s.issues && action === 'step-done') parts.push('특이: ' + s.issues);
    return [logRec(run, s, who, action, parts.filter(Boolean).join(' · '))];
  }
  function opStepReopen(run, stepId, who) {
    var s = stepOf(run, stepId);
    if (s.status === 'pending') fail('이미 대기 상태입니다.');
    var prev = s.status; s.status = 'pending'; s.endedAt = null; s.updatedAt = nowISO(); s.updatedBy = str(who);
    run.updatedAt = nowISO();
    return [logRec(run, s, who, 'step-reopen', STEP_STATUS[prev] + ' → 대기')];
  }
  function opSheetInsert(run, ctx, o, who) {
    var newSteps = [];
    if (o.flowId) newSteps = expandFlow(ctx, o.flowId, [], (byId(ctx.flows, o.flowId) || {}).name || '').filter(function (s) { return !s.missing; });
    else if (o.moduleId) { var mod = byId(ctx.modules, o.moduleId); if (!mod) fail('모듈을 찾을 수 없습니다.'); newSteps = [stepFromModule(mod, { params: o.params, name: o.name })]; }
    else fail('추가할 모듈 또는 흐름을 고르세요.');
    if (!newSteps.length) fail('추가할 스텝이 없습니다.');
    newSteps.forEach(function (s) { s.addedInRun = true; if (o.note) s.itemNote = o.note; });
    var idx = Math.max(0, Math.min(run.steps.length, Number(o.index) || 0));
    run.steps.splice.apply(run.steps, [idx, 0].concat(newSteps));
    reseq(run); run.updatedAt = nowISO();
    return newSteps.map(function (s) { return logRec(run, s, who, 'sheet-insert', (o.index >= run.steps.length - newSteps.length ? '끝에' : (idx + 1) + '번 위치에') + ' 추가' + (o.flowId ? ' (흐름: ' + (byId(ctx.flows, o.flowId) || {}).name + ')' : '') + (paramText(s.fields, s.planned) ? ' · 계획 ' + paramText(s.fields, s.planned) : '')); });
  }
  function opSheetRemove(run, stepId, who) {
    var s = stepOf(run, stepId);
    if (s.status !== 'pending') fail('진행된 스텝은 삭제할 수 없습니다. 건너뜀으로 처리하세요.');
    if (run.steps.length <= 1) fail('마지막 스텝은 삭제할 수 없습니다.');
    var rec = logRec(run, s, who, 'sheet-remove', (s.seq) + '번 ' + s.name + ' 삭제' + (s.addedInRun ? ' (런 중 추가된 스텝)' : ''));
    run.steps = run.steps.filter(function (x) { return x.id !== stepId; });
    reseq(run); run.updatedAt = nowISO();
    return [rec];
  }
  function opSheetMove(run, stepId, dir, who) {
    var i = run.steps.findIndex(function (x) { return x.id === stepId; }); if (i < 0) fail('스텝을 찾을 수 없습니다.');
    var j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= run.steps.length) fail('더 이동할 수 없습니다.');
    var s = run.steps[i], t = run.steps[j];
    run.steps[i] = t; run.steps[j] = s;
    reseq(run); run.updatedAt = nowISO();
    return [logRec(run, s, who, 'sheet-move', s.name + ': ' + (i + 1) + '번 → ' + (j + 1) + '번')];
  }
  function opSheetEdit(run, stepId, patch, who) {
    var s = stepOf(run, stepId), parts = [];
    if (patch.name !== undefined && str(patch.name) && str(patch.name) !== s.name) { parts.push('이름: ' + s.name + ' → ' + str(patch.name)); s.name = str(patch.name); }
    if (patch.equipment !== undefined && str(patch.equipment) !== s.equipment) { parts.push('장비: ' + (s.equipment || '(없음)') + ' → ' + (str(patch.equipment) || '(없음)')); s.equipment = str(patch.equipment); }
    if (patch.itemNote !== undefined && str(patch.itemNote) !== s.itemNote) { parts.push('메모: ' + (s.itemNote || '(없음)') + ' → ' + (str(patch.itemNote) || '(없음)')); s.itemNote = str(patch.itemNote); }
    if (patch.minutes !== undefined && Number(patch.minutes) !== s.minutes) { parts.push('예상 시간: ' + s.minutes + ' → ' + Number(patch.minutes)); s.minutes = Math.max(0, Number(patch.minutes) || 0); }
    if (patch.planned !== undefined) { var np = cleanValues(s.fields, patch.planned); var d = diffParams(s.fields, s.planned, np); if (d) { parts.push('계획 조건 ' + d); s.planned = np; } }
    if (!parts.length) return [];
    s.updatedAt = nowISO(); s.updatedBy = str(who); run.updatedAt = nowISO();
    return [logRec(run, s, who, 'sheet-edit', parts.join(' / '))];
  }
  function opRunEdit(run, patch, who) {
    var LAB = { title: '제목', sample: '시료', owner: '담당자', substrate: '기판', goal: '목표', note: '메모', startedAt: '시작일' };
    var parts = [];
    Object.keys(LAB).forEach(function (k) {
      if (patch[k] === undefined) return;
      var v = k === 'startedAt' ? toISO(patch[k]) : str(patch[k]);
      if (String(v || '') !== String(run[k] || '')) { parts.push(LAB[k] + ': ' + (k === 'startedAt' ? fmtShort(run[k]) : (run[k] || '(없음)')) + ' → ' + (k === 'startedAt' ? fmtShort(v) : (v || '(없음)'))); run[k] = v; }
    });
    if (patch.title !== undefined && !str(patch.title)) fail('제목을 입력하세요.');
    if (!parts.length) return [];
    run.updatedAt = nowISO();
    return [logRec(run, null, who, 'run-edit', parts.join(' / '))];
  }
  function opRunStatus(run, status, who, note) {
    if (!RUN_STATUS[status]) fail('알 수 없는 상태입니다.');
    if (run.status === status) return [];
    var prev = run.status; run.status = status;
    if (status === 'done' || status === 'aborted') run.endedAt = nowISO(); else run.endedAt = null;
    run.updatedAt = nowISO();
    return [logRec(run, null, who, 'run-status', RUN_STATUS[prev] + ' → ' + RUN_STATUS[status] + (note ? ' · ' + note : ''))];
  }
  function buildRun(ctx, runs, cfg, p) {
    var flow = p.flowId ? byId(ctx.flows, p.flowId) : null;
    if (p.flowId && !flow) fail('흐름을 찾을 수 없습니다.');
    var title = str(p.title) || (flow ? flow.name : '') || fail('제목을 입력하세요.');
    var steps = flow ? expandFlow(ctx, flow.id, [], '') : [];
    var missing = steps.filter(function (s) { return s.missing; }).length;
    steps = steps.filter(function (s) { return !s.missing; });
    var run = { id: uid(), code: runCode(runs, cfg.runCodePrefix), title: title, flowId: flow ? flow.id : null, flowName: flow ? flow.name : '', sample: str(p.sample), owner: str(p.owner), substrate: str(p.substrate), goal: str(p.goal), note: str(p.note),
      status: 'active', startedAt: toISO(p.startedAt) || nowISO(), endedAt: null, steps: steps, createdAt: nowISO(), updatedAt: nowISO() };
    reseq(run);
    var logs = [logRec(run, null, p.owner, 'run-create', (flow ? '흐름 "' + flow.name + '" · ' : '빈 런 · ') + steps.length + '개 스텝' + (missing ? ' (삭제된 모듈 ' + missing + '개 제외)' : '') + (run.sample ? ' · 시료 ' + run.sample : ''))];
    return { run: run, logs: logs };
  }
  function buildClone(src, runs, cfg, p) {
    p = p || {};
    var run = clone(src);
    run.id = uid(); run.code = runCode(runs, cfg.runCodePrefix); run.status = 'active'; run.startedAt = nowISO(); run.endedAt = null; run.createdAt = nowISO(); run.updatedAt = nowISO();
    run.title = str(p.title) || src.title + ' (복제)'; run.sample = str(p.sample); run.owner = str(p.owner) || src.owner; run.goal = p.goal !== undefined ? str(p.goal) : src.goal; run.note = '';
    run.steps.forEach(function (s) {
      if (p.fromActual && s.status === 'done' && Object.keys(s.actual || {}).length) s.planned = clone(s.actual);
      s.id = uid(); s.actual = {}; s.status = 'pending'; s.operator = ''; s.startedAt = null; s.endedAt = null; s.result = ''; s.issues = ''; s.note = ''; s.photos = []; s.updatedAt = null; s.updatedBy = '';
    });
    reseq(run);
    return { run: run, logs: [logRec(run, null, p.owner || src.owner, 'run-clone', '"' + src.code + ' ' + src.title + '" 에서 복제' + (p.fromActual ? ' (실제값을 계획으로)' : ''))] };
  }
  function flowFromRun(run, ctx, p) {
    var items = [], skipped = 0;
    run.steps.forEach(function (s) {
      if (s.status === 'skipped' && p.dropSkipped) return;
      var mod = byId(ctx.modules, s.moduleId);
      if (!mod) { skipped++; return; }
      var params = (p.fromActual && s.status === 'done' && Object.keys(s.actual || {}).length) ? s.actual : s.planned;
      var d = defaults(mod.fields), diff = {};
      Object.keys(params || {}).forEach(function (k) { if (String(params[k]) !== String(d[k] === undefined ? '' : d[k])) diff[k] = params[k]; });
      items.push({ id: uid(), kind: 'module', refId: mod.id, label: s.name !== mod.name ? s.name : '', note: s.itemNote || '', params: diff });
    });
    if (!items.length) fail('흐름으로 저장할 스텝이 없습니다.');
    return { flow: normFlow({ name: str(p.name) || run.title, device: str(p.device), description: str(p.description) || ('런 ' + run.code + ' 에서 저장'), items: items }), skipped: skipped };
  }

  /* ---------- 라이브러리 시드 ---------- */
  function importLibrary(data, lib) {
    var added = { modules: 0, flows: 0 };
    if (!lib) return added;
    (lib.modules || []).forEach(function (m) { if (byId(data.modules, m.id)) return; data.modules.push(normModule(m, { id: m.id })); added.modules++; });
    (lib.flows || []).forEach(function (f) { if (byId(data.flows, f.id)) return; data.flows.push(normFlow(f, { id: f.id })); added.flows++; });
    data.library = { version: lib.version || '', importedAt: nowISO() };
    return added;
  }
  function emptyData() { return { modules: [], flows: [], runs: [], logs: [], library: null }; }
  function migrate(data) {
    ['modules', 'flows', 'runs', 'logs'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    data.modules.forEach(function (m) { m.fields = normFields(m.fields); if (!Array.isArray(m.checklist)) m.checklist = []; if (m.active === undefined) m.active = true; });
    data.flows.forEach(function (f) { f.items = (f.items || []).map(normItem).filter(Boolean); if (f.active === undefined) f.active = true; });
    data.runs.forEach(function (r) { if (!Array.isArray(r.steps)) r.steps = []; r.steps.forEach(function (s) { s.fields = normFields(s.fields); if (!s.planned) s.planned = {}; if (!s.actual) s.actual = {}; if (!s.photos) s.photos = []; if (!s.status) s.status = 'pending'; }); reseq(r); if (!r.status) r.status = 'active'; });
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

  /* ------------------------------------------------------------------ */
  /*  Local adapter (localStorage)                                        */
  /* ------------------------------------------------------------------ */
  function LocalStore(cfg) {
    var data = null, listeners = [];
    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function read() {
      try { data = JSON.parse(localStorage.getItem(DATA_KEY) || 'null'); } catch (e) { data = null; }
      if (!data || !Array.isArray(data.runs)) { data = emptyData(); }
      migrate(data);
      if (cfg.seedLibrary !== false && window.DSIL_LIBRARY && (!data.library || data.library.version !== window.DSIL_LIBRARY.version)) { importLibrary(data, window.DSIL_LIBRARY); }
      write();
    }
    function write() { try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) { console.warn('localStorage write failed', e); } }
    function ctx() { return { modules: data.modules, flows: data.flows }; }
    function runOf(id) { var r = byId(data.runs, id); if (!r) fail('런을 찾을 수 없습니다.'); return r; }
    function commit(logs) { (logs || []).forEach(function (l) { data.logs.unshift(l); }); if (data.logs.length > 5000) data.logs.length = 5000; write(); emit(); }
    function wrap(fn) { try { return Promise.resolve(fn()); } catch (e) { return Promise.reject(e); } }
    window.addEventListener('storage', function (e) { if (e.key === DATA_KEY) { read(); emit(); } });

    return {
      mode: 'local',
      init: function () { read(); return Promise.resolve(); },
      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      getMe: function () { try { return localStorage.getItem(ME_KEY) || ''; } catch (e) { return ''; } },
      setMe: function (name) { try { if (str(name)) localStorage.setItem(ME_KEY, str(name)); else localStorage.removeItem(ME_KEY); } catch (e) { /* ignore */ } return Promise.resolve(str(name)); },

      listModules: function () { return Promise.resolve(clone(data.modules)); },
      saveModule: function (m) {
        return wrap(function () {
          if (!str(m.name)) fail('모듈 이름을 입력하세요.');
          var cur = m.id ? byId(data.modules, m.id) : null;
          if (data.modules.some(function (x) { return x.id !== (cur && cur.id) && x.name === str(m.name); })) fail('같은 이름의 모듈이 있습니다.');
          var rec = normModule(m, cur || {});
          if (cur) Object.assign(cur, rec); else data.modules.push(rec);
          write(); emit(); return clone(cur || rec);
        });
      },
      deleteModule: function (id) {
        return wrap(function () {
          var m = byId(data.modules, id); if (!m) fail('모듈을 찾을 수 없습니다.');
          var used = data.flows.some(function (f) { return f.items.some(function (it) { return it.kind === 'module' && it.refId === id; }); }) || data.runs.some(function (r) { return r.steps.some(function (s) { return s.moduleId === id; }); });
          if (used) { m.active = false; m.updatedAt = nowISO(); } else data.modules = data.modules.filter(function (x) { return x.id !== id; });
          write(); emit(); return { deactivated: used };
        });
      },
      listFlows: function () { return Promise.resolve(clone(data.flows)); },
      saveFlow: function (f) {
        return wrap(function () {
          if (!str(f.name)) fail('흐름 이름을 입력하세요.');
          var cur = f.id ? byId(data.flows, f.id) : null;
          var rec = normFlow(f, cur || {});
          if (!rec.items.length) fail('흐름에 스텝을 하나 이상 넣으세요.');
          var tmp = { modules: data.modules, flows: data.flows.filter(function (x) { return x.id !== rec.id; }).concat([rec]) };
          expandFlow(tmp, rec.id, [], '');   /* 순환 참조 검사 */
          if (cur) Object.assign(cur, rec); else data.flows.push(rec);
          write(); emit(); return clone(cur || rec);
        });
      },
      deleteFlow: function (id) {
        return wrap(function () {
          var f = byId(data.flows, id); if (!f) fail('흐름을 찾을 수 없습니다.');
          var used = data.flows.some(function (x) { return x.id !== id && x.items.some(function (it) { return it.kind === 'flow' && it.refId === id; }); });
          if (used) fail('다른 흐름이 이 흐름을 포함하고 있어 삭제할 수 없습니다.');
          data.flows = data.flows.filter(function (x) { return x.id !== id; });
          write(); emit();
        });
      },
      previewFlow: function (id) { return wrap(function () { return expandFlow(ctx(), id, [], '').map(function (s, i) { s.seq = i + 1; return s; }); }); },

      listRuns: function () { return Promise.resolve(clone(data.runs).sort(function (a, b) { return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt); })); },
      getRun: function (id) { var r = byId(data.runs, id); return Promise.resolve(r ? clone(r) : null); },
      createRun: function (p) { return wrap(function () { var b = buildRun(ctx(), data.runs, cfg, p || {}); data.runs.push(b.run); commit(b.logs); return clone(b.run); }); },
      updateRun: function (id, patch, who) { return wrap(function () { var r = runOf(id); commit(opRunEdit(r, patch || {}, who)); return clone(r); }); },
      setRunStatus: function (id, status, who, note) { return wrap(function () { var r = runOf(id); commit(opRunStatus(r, status, who, note)); return clone(r); }); },
      deleteRun: function (id) { return wrap(function () { runOf(id); data.runs = data.runs.filter(function (r) { return r.id !== id; }); data.logs = data.logs.filter(function (l) { return l.runId !== id; }); write(); emit(); }); },
      cloneRun: function (id, p) { return wrap(function () { var b = buildClone(runOf(id), data.runs, cfg, p); data.runs.push(b.run); commit(b.logs); return clone(b.run); }); },
      saveRunAsFlow: function (id, p) { return wrap(function () { var b = flowFromRun(runOf(id), ctx(), p || {}); data.flows.push(b.flow); write(); emit(); return { flow: clone(b.flow), skipped: b.skipped }; }); },

      stepStart: function (runId, stepId, who) { return wrap(function () { var r = runOf(runId); commit(opStepStart(r, stepId, who)); return clone(byId(r.steps, stepId)); }); },
      stepLog: function (runId, stepId, p, who) { return wrap(function () { var r = runOf(runId); commit(opStepLog(r, stepId, p, who)); return clone(byId(r.steps, stepId)); }); },
      stepReopen: function (runId, stepId, who) { return wrap(function () { var r = runOf(runId); commit(opStepReopen(r, stepId, who)); return clone(byId(r.steps, stepId)); }); },
      sheetInsert: function (runId, o, who) { return wrap(function () { var r = runOf(runId); commit(opSheetInsert(r, ctx(), o || {}, who)); return clone(r); }); },
      sheetRemove: function (runId, stepId, who) { return wrap(function () { var r = runOf(runId); commit(opSheetRemove(r, stepId, who)); return clone(r); }); },
      sheetMove: function (runId, stepId, dir, who) { return wrap(function () { var r = runOf(runId); commit(opSheetMove(r, stepId, dir, who)); return clone(r); }); },
      sheetEdit: function (runId, stepId, patch, who) { return wrap(function () { var r = runOf(runId); commit(opSheetEdit(r, stepId, patch || {}, who)); return clone(r); }); },

      listLogs: function (runId, limit) { var out = runId ? data.logs.filter(function (l) { return l.runId === runId; }) : data.logs; return Promise.resolve(clone(limit ? out.slice(0, limit) : out)); },

      savePhoto: function (dataUrl) { var key = 'ph-' + uid(); return idbOp('readwrite', function (st) { return st.put(dataUrl, key); }).then(function () { return key; }); },
      loadPhoto: function (key) { return key ? idbOp('readonly', function (st) { return st.get(key); }) : Promise.resolve(null); },
      deletePhoto: function (key) { return key ? idbOp('readwrite', function (st) { return st.delete(key); }).catch(function () {}) : Promise.resolve(); },

      exportJSON: function () { return clone(data); },
      importJSON: function (obj) { if (!obj || !Array.isArray(obj.runs) || !Array.isArray(obj.modules)) fail('형식이 올바르지 않습니다.'); data = migrate(clone(obj)); write(); emit(); },
      resetAll: function () { data = emptyData(); if (cfg.seedLibrary !== false && window.DSIL_LIBRARY) importLibrary(data, window.DSIL_LIBRARY); write(); emit(); return Promise.resolve(); }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Supabase adapter – runs 는 steps 를 JSON 으로 담은 행, 로그는 run_logs */
  /* ------------------------------------------------------------------ */
  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = src; s.async = true;
      s.onload = resolve; s.onerror = function () { reject(new Error('스크립트 로드 실패: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function toModule(r) { return { id: r.id, name: r.name, category: r.category || 'etc', equipment: r.equipment || '', description: r.description || '', minutes: r.minutes || 0, fields: normFields(r.fields), checklist: r.checklist || [], active: r.active !== false, createdAt: r.created_at, updatedAt: r.updated_at }; }
  function fromModule(m) { return { id: m.id, name: m.name, category: m.category, equipment: m.equipment, description: m.description, minutes: m.minutes, fields: m.fields, checklist: m.checklist, active: m.active, updated_at: nowISO() }; }
  function toFlow(r) { return { id: r.id, name: r.name, device: r.device || '', description: r.description || '', items: (r.items || []).map(normItem).filter(Boolean), active: r.active !== false, createdAt: r.created_at, updatedAt: r.updated_at }; }
  function fromFlow(f) { return { id: f.id, name: f.name, device: f.device, description: f.description, items: f.items, active: f.active, updated_at: nowISO() }; }
  function toRun(r) { return { id: r.id, code: r.code, title: r.title, flowId: r.flow_id, flowName: r.flow_name || '', sample: r.sample || '', owner: r.owner || '', substrate: r.substrate || '', goal: r.goal || '', note: r.note || '', status: r.status || 'active', startedAt: r.started_at, endedAt: r.ended_at, steps: Array.isArray(r.steps) ? r.steps : [], createdAt: r.created_at, updatedAt: r.updated_at }; }
  function fromRun(r) { return { id: r.id, code: r.code, title: r.title, flow_id: r.flowId, flow_name: r.flowName, sample: r.sample, owner: r.owner, substrate: r.substrate, goal: r.goal, note: r.note, status: r.status, started_at: r.startedAt, ended_at: r.endedAt, steps: r.steps, updated_at: nowISO() }; }
  function toLog(r) { return { id: r.id, runId: r.run_id, stepId: r.step_id, seq: r.seq, stepName: r.step_name || '', at: r.created_at, who: r.who || '', action: r.action, detail: r.detail || '' }; }
  function fromLog(l) { return { id: l.id, run_id: l.runId, step_id: l.stepId, seq: l.seq, step_name: l.stepName, who: l.who, action: l.action, detail: l.detail, created_at: l.at }; }

  function SupabaseStore(cfg) {
    var client = null, listeners = [];
    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function unwrap(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }
    function reject(msg) { return Promise.reject(msg instanceof Error ? msg : new Error(msg)); }
    function all(table, map) { return client.from(table).select('*').order('created_at').then(unwrap).then(function (rows) { return rows.map(map); }); }
    function ctx() { return Promise.all([all('modules', toModule), all('flows', toFlow)]).then(function (r) { return { modules: r[0], flows: r[1] }; }); }
    function fetchRun(id) { return client.from('runs').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { if (!r) fail('런을 찾을 수 없습니다.'); return toRun(r); }); }
    function putRun(run, logs, isNew) {
      var q = isNew ? client.from('runs').insert(fromRun(run)) : client.from('runs').update(fromRun(run)).eq('id', run.id);
      return q.then(unwrap).then(function () { return logs && logs.length ? client.from('run_logs').insert(logs.map(fromLog)).then(unwrap) : null; }).then(function () { emit(); return run; });
    }
    function mutate(runId, fn) { return fetchRun(runId).then(function (run) { var logs = fn(run); return putRun(run, logs, false); }); }
    function mutateCtx(runId, fn) { return Promise.all([fetchRun(runId), ctx()]).then(function (r) { var logs = fn(r[0], r[1]); return putRun(r[0], logs, false); }); }
    function stepClone(run, stepId) { return clone(byId(run.steps, stepId)); }
    function photoBucket() { return client.storage.from('run-photos'); }

    return {
      mode: 'supabase',
      init: function () {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return reject('config.js 에 supabaseUrl / supabaseAnonKey 를 설정하세요.');
        return loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js').then(function () {
          client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
          client.channel('runsheet-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'runs' }, emit)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'modules' }, emit)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'flows' }, emit)
            .subscribe();
          if (cfg.seedLibrary !== false && window.DSIL_LIBRARY) {
            return client.from('modules').select('id', { count: 'exact', head: true }).then(function (res) {
              if (res.error || res.count > 0) return;
              var lib = window.DSIL_LIBRARY;
              return client.from('modules').insert(lib.modules.map(function (m) { return fromModule(normModule(m, { id: m.id })); })).then(unwrap)
                .then(function () { return client.from('flows').insert(lib.flows.map(function (f) { return fromFlow(normFlow(f, { id: f.id })); })).then(unwrap); });
            });
          }
        });
      },
      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      getMe: function () { try { return localStorage.getItem(ME_KEY) || ''; } catch (e) { return ''; } },
      setMe: function (name) { try { if (str(name)) localStorage.setItem(ME_KEY, str(name)); else localStorage.removeItem(ME_KEY); } catch (e) { /* ignore */ } return Promise.resolve(str(name)); },

      listModules: function () { return all('modules', toModule); },
      saveModule: function (m) {
        if (!str(m.name)) return reject('모듈 이름을 입력하세요.');
        var rec = normModule(m, m.id ? { id: m.id, createdAt: m.createdAt } : {});
        return client.from('modules').upsert(fromModule(rec)).select().single().then(unwrap).then(toModule);
      },
      deleteModule: function (id) {
        return Promise.all([client.from('flows').select('id, items').then(unwrap), client.from('runs').select('id, steps').then(unwrap)]).then(function (r) {
          var used = r[0].some(function (f) { return (f.items || []).some(function (it) { return it.kind === 'module' && it.refId === id; }); }) || r[1].some(function (run) { return (run.steps || []).some(function (s) { return s.moduleId === id; }); });
          if (used) return client.from('modules').update({ active: false, updated_at: nowISO() }).eq('id', id).then(unwrap).then(function () { return { deactivated: true }; });
          return client.from('modules').delete().eq('id', id).then(unwrap).then(function () { return { deactivated: false }; });
        });
      },
      listFlows: function () { return all('flows', toFlow); },
      saveFlow: function (f) {
        if (!str(f.name)) return reject('흐름 이름을 입력하세요.');
        var rec = normFlow(f, f.id ? { id: f.id, createdAt: f.createdAt } : {});
        if (!rec.items.length) return reject('흐름에 스텝을 하나 이상 넣으세요.');
        return ctx().then(function (c) { c.flows = c.flows.filter(function (x) { return x.id !== rec.id; }).concat([rec]); expandFlow(c, rec.id, [], ''); return client.from('flows').upsert(fromFlow(rec)).select().single().then(unwrap).then(toFlow); });
      },
      deleteFlow: function (id) {
        return client.from('flows').select('id, items').then(unwrap).then(function (rows) {
          if (rows.some(function (x) { return x.id !== id && (x.items || []).some(function (it) { return it.kind === 'flow' && it.refId === id; }); })) fail('다른 흐름이 이 흐름을 포함하고 있어 삭제할 수 없습니다.');
          return client.from('flows').delete().eq('id', id).then(unwrap).then(function () {});
        });
      },
      previewFlow: function (id) { return ctx().then(function (c) { return expandFlow(c, id, [], '').map(function (s, i) { s.seq = i + 1; return s; }); }); },

      listRuns: function () { return client.from('runs').select('*').order('updated_at', { ascending: false }).limit(500).then(unwrap).then(function (rows) { return rows.map(toRun); }); },
      getRun: function (id) { return client.from('runs').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { return r ? toRun(r) : null; }); },
      createRun: function (p) { return Promise.all([ctx(), client.from('runs').select('code').then(unwrap)]).then(function (r) { var b = buildRun(r[0], r[1], cfg, p || {}); return putRun(b.run, b.logs, true); }); },
      updateRun: function (id, patch, who) { return mutate(id, function (run) { return opRunEdit(run, patch || {}, who); }); },
      setRunStatus: function (id, status, who, note) { return mutate(id, function (run) { return opRunStatus(run, status, who, note); }); },
      deleteRun: function (id) { return client.from('runs').delete().eq('id', id).then(unwrap).then(function () { emit(); }); },
      cloneRun: function (id, p) { return Promise.all([fetchRun(id), client.from('runs').select('code').then(unwrap)]).then(function (r) { var b = buildClone(r[0], r[1], cfg, p); return putRun(b.run, b.logs, true); }); },
      saveRunAsFlow: function (id, p) { return Promise.all([fetchRun(id), ctx()]).then(function (r) { var b = flowFromRun(r[0], r[1], p || {}); return client.from('flows').insert(fromFlow(b.flow)).select().single().then(unwrap).then(function (row) { emit(); return { flow: toFlow(row), skipped: b.skipped }; }); }); },

      stepStart: function (runId, stepId, who) { return mutate(runId, function (run) { return opStepStart(run, stepId, who); }).then(function (run) { return stepClone(run, stepId); }); },
      stepLog: function (runId, stepId, p, who) { return mutate(runId, function (run) { return opStepLog(run, stepId, p, who); }).then(function (run) { return stepClone(run, stepId); }); },
      stepReopen: function (runId, stepId, who) { return mutate(runId, function (run) { return opStepReopen(run, stepId, who); }).then(function (run) { return stepClone(run, stepId); }); },
      sheetInsert: function (runId, o, who) { return mutateCtx(runId, function (run, c) { return opSheetInsert(run, c, o || {}, who); }); },
      sheetRemove: function (runId, stepId, who) { return mutate(runId, function (run) { return opSheetRemove(run, stepId, who); }); },
      sheetMove: function (runId, stepId, dir, who) { return mutate(runId, function (run) { return opSheetMove(run, stepId, dir, who); }); },
      sheetEdit: function (runId, stepId, patch, who) { return mutate(runId, function (run) { return opSheetEdit(run, stepId, patch || {}, who); }); },

      listLogs: function (runId, limit) { var q = client.from('run_logs').select('*'); if (runId) q = q.eq('run_id', runId); return q.order('created_at', { ascending: false }).limit(limit || 2000).then(unwrap).then(function (rows) { return rows.map(toLog); }); },

      savePhoto: function (dataUrl) {
        var key = 'ph-' + uid() + '.jpg';
        return fetch(dataUrl).then(function (r) { return r.blob(); }).then(function (blob) { return photoBucket().upload(key, blob, { contentType: 'image/jpeg' }); }).then(unwrap).then(function () { return key; });
      },
      loadPhoto: function (key) { if (!key) return Promise.resolve(null); var r = photoBucket().getPublicUrl(key); return Promise.resolve(r && r.data ? r.data.publicUrl : null); },
      deletePhoto: function (key) { return key ? photoBucket().remove([key]).then(function () {}).catch(function () {}) : Promise.resolve(); },

      exportJSON: null, importJSON: null, resetAll: null
    };
  }

  window.DSILStore = {
    create: function (cfg) { cfg = cfg || {}; return cfg.backend === 'supabase' ? SupabaseStore(cfg) : LocalStore(cfg); },
    normFields: normFields, defaults: defaults, progress: progress, TERMINAL: TERMINAL, RUN_STATUS: RUN_STATUS, STEP_STATUS: STEP_STATUS, ACTIONS: ACTIONS
  };
})();
