/* =====================================================================
   DSIL Run Sheet – 라이브러리: 공정 모듈(재사용 단위) + 공정 흐름(모듈·흐름의 재조합 = 런시트 템플릿)
   해시: #tab=modules | #tab=flows  (+ &edit=<id>)
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore;
  var esc = U.esc, fmtDate = U.fmtDate, fmtDuration = U.fmtDuration, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, promptDlg = U.promptDlg, empty = U.empty;
  var store = S.create(CFG);
  var state = { ready: false, error: null, tab: 'modules', modules: [], flows: [], runs: [], editModule: null, editFlow: null, draft: [], q: '' };

  function uid() { return 'it-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function modById(id) { return state.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function flowById(id) { return state.flows.filter(function (f) { return f.id === id; })[0] || null; }
  function readHash() { var m = /tab=(\w+)/.exec(window.location.hash); state.tab = m && m[1] === 'flows' ? 'flows' : 'modules'; }
  function me() { return store.getMe(); }

  function reload() { return Promise.all([store.listModules(), store.listFlows(), store.listRuns()]).then(function (r) { state.modules = r[0]; state.flows = r[1]; state.runs = r[2]; }); }

  /* 흐름 항목 전개 (미리보기용, store.expandFlow 와 같은 규칙) */
  function expandItems(items, path, group) {
    var out = [];
    (items || []).forEach(function (it) {
      if (it.kind === 'flow') {
        var f = flowById(it.refId);
        if (!f) { out.push({ name: '(삭제된 흐름)', group: group, missing: true }); return; }
        if (path.indexOf(f.id) >= 0) { out.push({ name: '(순환 참조: ' + f.name + ')', group: group, missing: true }); return; }
        out = out.concat(expandItems(f.items, path.concat([f.id]), (group ? group + ' › ' : '') + (it.label || f.name)));
      } else {
        var m = modById(it.refId);
        if (!m) { out.push({ name: '(삭제된 모듈)', group: group, missing: true }); return; }
        out.push({ name: it.label || m.name, group: group, module: m, params: Object.assign(S.defaults(m.fields), it.params || {}), minutes: m.minutes || 0, note: it.note });
      }
    });
    return out;
  }
  function moduleUsage(id) {
    return { flows: state.flows.filter(function (f) { return f.items.some(function (it) { return it.kind === 'module' && it.refId === id; }); }), runs: state.runs.filter(function (r) { return r.steps.some(function (s) { return s.moduleId === id; }); }).length };
  }
  function flowUsage(id) {
    return { flows: state.flows.filter(function (f) { return f.id !== id && f.items.some(function (it) { return it.kind === 'flow' && it.refId === id; }); }), runs: state.runs.filter(function (r) { return r.flowId === id; }).length };
  }

  /* ---------- 렌더 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var name = me();
    slot.innerHTML = '<button type="button" class="btn btn-sm' + (name ? '' : ' btn-outline-primary') + '" data-action="set-me"><i class="ti ti-user me-1"></i>' + (name ? esc(name) : '내 이름 설정') + '</button>';
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    var tabs = '<ul class="nav nav-tabs mb-3"><li class="nav-item"><a class="nav-link' + (state.tab === 'modules' ? ' active' : '') + '" href="#tab=modules"><i class="ti ti-box me-1"></i>공정 모듈 <span class="badge bg-secondary-lt ms-1">' + state.modules.length + '</span></a></li><li class="nav-item"><a class="nav-link' + (state.tab === 'flows' ? ' active' : '') + '" href="#tab=flows"><i class="ti ti-git-branch me-1"></i>공정 흐름 <span class="badge bg-secondary-lt ms-1">' + state.flows.length + '</span></a></li></ul>';
    app.innerHTML = tabs + (state.tab === 'flows' ? renderFlows() : renderModules());
  }

  function renderModules() {
    var q = state.q.trim().toLowerCase();
    var list = state.modules.filter(function (m) { return !q || [m.name, m.equipment, m.description, P.catInfo(m.category).label].join(' ').toLowerCase().indexOf(q) >= 0; });
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div><div class="text-secondary small">모듈은 한 번 정의해 두고 여러 흐름·런에서 재사용하는 공정 단위입니다. 조건 항목(온도·시간·레시피 등)과 확인 사항을 여기서 정합니다.</div></div>'
      + '<div class="d-flex gap-2"><input type="search" class="form-control form-control-sm" id="mod-q" placeholder="검색" value="' + esc(state.q) + '" style="width:12rem"><button type="button" class="btn btn-sm btn-primary" data-action="mod-new"><i class="ti ti-plus me-1"></i>모듈 추가</button></div></div>';
    if (state.editModule) html += moduleEditor(state.editModule);
    if (!list.length) return html + '<div class="card">' + empty('box-off', '모듈이 없습니다', '"모듈 추가"로 첫 공정 모듈을 만드세요.') + '</div>';
    var cats = (CFG.categories || []).map(function (c) { return c.id; });
    list.sort(function (a, b) { var ca = cats.indexOf(a.category), cb = cats.indexOf(b.category); return ca !== cb ? ca - cb : a.name.localeCompare(b.name, 'ko'); });
    html += '<div class="card"><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>모듈</th><th class="w-1">분류</th><th>장비</th><th>조건 항목</th><th class="w-1">예상</th><th class="w-1">사용</th><th class="w-1"></th></tr></thead><tbody>'
      + list.map(function (m) {
        var u = moduleUsage(m.id);
        return '<tr' + (m.active === false ? ' class="text-secondary"' : '') + '><td><div class="fw-medium">' + esc(m.name) + (m.active === false ? ' <span class="badge bg-secondary-lt">비활성</span>' : '') + '</div>' + (m.description ? '<div class="small text-secondary">' + esc(m.description) + '</div>' : '') + '</td><td>' + P.catBadge(m.category) + '</td><td class="small">' + esc(m.equipment || '-') + '</td>'
          + '<td class="small">' + (m.fields.length ? m.fields.map(function (f) { return esc(f.label) + (f.unit ? '(' + esc(f.unit) + ')' : '') + (f.required ? '*' : ''); }).join(', ') : '<span class="text-secondary">없음</span>') + (m.checklist.length ? '<div class="text-secondary">확인 ' + m.checklist.length + '항목</div>' : '') + '</td>'
          + '<td class="text-nowrap small">' + (m.minutes ? fmtDuration(m.minutes) : '-') + '</td><td class="text-nowrap small">' + (u.flows.length ? '<span title="' + esc(u.flows.map(function (f) { return f.name; }).join(', ')) + '">흐름 ' + u.flows.length + '</span>' : '') + (u.runs ? (u.flows.length ? ' · ' : '') + '런 ' + u.runs : '') + (!u.flows.length && !u.runs ? '-' : '') + '</td>'
          + '<td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="mod-copy" data-id="' + esc(m.id) + '" title="복제"><i class="ti ti-copy"></i></button><button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="mod-edit" data-id="' + esc(m.id) + '" title="수정"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="mod-delete" data-id="' + esc(m.id) + '" title="삭제"><i class="ti ti-trash"></i></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }
  function moduleEditor(m) {
    var isNew = !m.id;
    return '<div class="card mb-3 border-primary" id="mod-form-card"><div class="card-header"><h3 class="card-title">' + (isNew ? '모듈 추가' : '모듈 수정: ' + esc(m.name)) + '</h3></div><div class="card-body"><form id="module-form">'
      + '<input type="hidden" name="modId" value="' + esc(m.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label required">모듈 이름</label><input type="text" class="form-control" name="name" required value="' + esc(m.name || '') + '" autocomplete="off" placeholder="예: ALD 유전막"></div>'
      + '<div class="col-md-3"><label class="form-label">분류</label><select class="form-select" name="category">' + (CFG.categories || []).map(function (c) { return '<option value="' + c.id + '"' + ((m.category || 'etc') === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-3"><label class="form-label">장비</label><input type="text" class="form-control" name="equipment" value="' + esc(m.equipment || '') + '" autocomplete="off"></div>'
      + '<div class="col-md-2"><label class="form-label">예상 시간(분)</label><input type="number" class="form-control" name="minutes" min="0" value="' + esc(m.minutes || '') + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-6"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="' + esc(m.description || '') + '" autocomplete="off"></div>'
      + '<div class="col-md-6"><label class="form-label">확인 사항 <span class="form-label-description">한 줄에 하나, 기록 창에 체크리스트로 표시</span></label><textarea class="form-control" name="checklist" rows="2">' + esc((m.checklist || []).join('\n')) + '</textarea></div></div>'
      + (isNew ? '' : '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="active"' + (m.active !== false ? ' checked' : '') + '><span class="form-check-label">사용 중 (끄면 새 흐름·스텝 추가 목록에서 숨김)</span></label>')
      + '<div class="d-flex align-items-center justify-content-between mt-4 mb-1"><div class="subheader mb-0">조건 항목 <span class="text-secondary fw-normal text-lowercase">런시트에서 계획값·실제값을 적는 칸</span></div><button type="button" class="btn btn-sm" data-action="field-add"><i class="ti ti-plus me-1"></i>항목</button></div>'
      + '<div class="text-secondary small mb-2">이름 · 종류 · 단위 · 선택지(선택 종류) · 기본값(흐름의 계획값으로 들어감) · 필수. 저장 키는 유지되므로 이름을 바꿔도 지난 기록과 연결됩니다.</div>'
      + '<div id="field-rows">' + (m.fields || []).map(P.fieldRowHtml).join('') + '</div>'
      + '<div class="mt-4 d-flex gap-2"><button type="submit" class="btn btn-primary">' + (isNew ? '추가' : '저장') + '</button><button type="button" class="btn" data-action="mod-cancel">취소</button></div></form></div></div>';
  }

  function renderFlows() {
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div class="text-secondary small">흐름은 모듈(또는 다른 흐름)을 순서대로 엮은 런시트 템플릿입니다. 런을 시작하면 이 순서대로 스텝이 만들어지고, 서브 흐름은 펼쳐져 들어갑니다.</div>'
      + '<button type="button" class="btn btn-sm btn-primary" data-action="flow-new"><i class="ti ti-plus me-1"></i>흐름 추가</button></div>';
    if (state.editFlow) html += flowEditor(state.editFlow);
    if (!state.flows.length) return html + '<div class="card">' + empty('git-branch', '흐름이 없습니다', '"흐름 추가"에서 모듈을 순서대로 넣으세요.') + '</div>';
    html += '<div class="card"><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>흐름</th><th>구성</th><th class="w-1">스텝</th><th class="w-1">예상</th><th class="w-1">사용</th><th class="w-1"></th></tr></thead><tbody>'
      + state.flows.map(function (f) {
        var ex = expandItems(f.items, [f.id], ''), u = flowUsage(f.id);
        var mins = ex.reduce(function (a, s) { return a + (s.minutes || 0); }, 0);
        return '<tr><td><div class="fw-medium">' + esc(f.name) + '</div>' + (f.device ? '<div class="small text-primary">' + esc(f.device) + '</div>' : '') + (f.description ? '<div class="small text-secondary">' + esc(f.description) + '</div>' : '') + '</td>'
          + '<td class="small">' + f.items.map(function (it) { var ref = it.kind === 'flow' ? flowById(it.refId) : modById(it.refId); return '<span class="badge ' + (it.kind === 'flow' ? 'bg-purple-lt' : 'bg-blue-lt') + ' me-1 mb-1">' + (it.kind === 'flow' ? '<i class="ti ti-git-branch"></i> ' : '') + esc(it.label || (ref ? ref.name : '?')) + '</span>'; }).join('') + '</td>'
          + '<td class="text-nowrap tnum">' + ex.filter(function (s) { return !s.missing; }).length + (ex.some(function (s) { return s.missing; }) ? ' <span class="text-red" title="삭제된 모듈/흐름 포함">!</span>' : '') + '</td><td class="text-nowrap small">' + (mins ? fmtDuration(mins) : '-') + '</td>'
          + '<td class="text-nowrap small">' + (u.flows.length ? '흐름 ' + u.flows.length : '') + (u.runs ? (u.flows.length ? ' · ' : '') + '런 ' + u.runs : '') + (!u.flows.length && !u.runs ? '-' : '') + '</td>'
          + '<td class="text-end text-nowrap"><a href="../index.html?new=' + encodeURIComponent(f.id) + '" class="btn btn-sm btn-primary me-1"><i class="ti ti-player-play me-1"></i>런 시작</a><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="flow-copy" data-id="' + esc(f.id) + '" title="복제"><i class="ti ti-copy"></i></button><button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="flow-edit" data-id="' + esc(f.id) + '" title="수정"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="flow-delete" data-id="' + esc(f.id) + '" title="삭제"><i class="ti ti-trash"></i></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }
  function flowEditor(f) {
    var isNew = !f.id;
    var mods = state.modules.filter(function (m) { return m.active !== false; });
    var cats = CFG.categories || [];
    var modOpts = cats.map(function (c) { var ms = mods.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc(c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
    var flowOpts = state.flows.filter(function (x) { return x.id !== f.id && !expandItems(x.items, [x.id], '').some(function (s) { return /순환/.test(s.name); }) && !(f.id && flowUsage(f.id).flows.some(function (y) { return y.id === x.id; })); }).map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + ' (' + x.items.length + '항목)</option>'; }).join('');
    var ex = expandItems(state.draft, f.id ? [f.id] : [], '');
    var mins = ex.reduce(function (a, s) { return a + (s.minutes || 0); }, 0);
    var html = '<div class="card mb-3 border-primary" id="flow-form-card"><div class="card-header"><h3 class="card-title">' + (isNew ? '흐름 추가' : '흐름 수정: ' + esc(f.name)) + '</h3></div><div class="card-body"><form id="flow-form">'
      + '<input type="hidden" name="flowId" value="' + esc(f.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-5"><label class="form-label required">흐름 이름</label><input type="text" class="form-control" name="name" required value="' + esc(f.name || '') + '" autocomplete="off" placeholder="예: MoS2 백게이트 FET"></div>'
      + '<div class="col-md-3"><label class="form-label">소자 종류</label><input type="text" class="form-control" name="device" value="' + esc(f.device || '') + '" autocomplete="off"></div>'
      + '<div class="col-md-4"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="' + esc(f.description || '') + '" autocomplete="off"></div></div>'
      + '<div class="row g-3 mt-2"><div class="col-lg-7"><div class="subheader mb-2">구성 (순서대로)</div><div id="flow-items">' + (state.draft.length ? state.draft.map(itemRow).join('') : '<div class="text-secondary small py-2">아래에서 모듈이나 흐름을 추가하세요.</div>') + '</div>'
      + '<div class="row g-2 mt-2 align-items-end"><div class="col-md-6"><label class="form-label small">모듈 추가</label><div class="input-group"><select class="form-select" id="add-module">' + modOpts + '</select><button type="button" class="btn" data-action="item-add-module"><i class="ti ti-plus"></i></button></div></div>'
      + '<div class="col-md-6"><label class="form-label small">흐름 추가 (서브 흐름)</label><div class="input-group"><select class="form-select" id="add-flow"' + (flowOpts ? '' : ' disabled') + '>' + (flowOpts || '<option value="">넣을 수 있는 흐름 없음</option>') + '</select><button type="button" class="btn" data-action="item-add-flow"' + (flowOpts ? '' : ' disabled') + '><i class="ti ti-plus"></i></button></div></div></div></div>'
      + '<div class="col-lg-5"><div class="subheader mb-2">펼친 런시트 미리보기 <span class="text-secondary fw-normal">' + ex.filter(function (s) { return !s.missing; }).length + '스텝' + (mins ? ' · 예상 ' + fmtDuration(mins) : '') + '</span></div>'
      + (ex.length ? '<ol class="preview-list">' + ex.map(function (s) { return '<li' + (s.missing ? ' class="text-red"' : '') + '>' + (s.group ? '<span class="step-group">' + esc(s.group) + '</span>' : '') + '<span class="fw-medium">' + esc(s.name) + '</span>' + (s.module ? '<span class="small text-secondary d-block">' + esc(P.text(s.module.fields, s.params, ' · ')) + '</span>' : '') + '</li>'; }).join('') + '</ol>' : '<div class="text-secondary small">항목이 없습니다.</div>') + '</div></div>'
      + '<div class="mt-4 d-flex gap-2"><button type="submit" class="btn btn-primary">' + (isNew ? '추가' : '저장') + '</button><button type="button" class="btn" data-action="flow-cancel">취소</button></div></form></div></div>';
    return html;
  }
  function itemRow(it, i) {
    var ref = it.kind === 'flow' ? flowById(it.refId) : modById(it.refId);
    var name = ref ? ref.name : '(삭제됨)';
    var sub = ref ? (it.kind === 'flow' ? ref.items.length + '항목 · ' + expandItems(ref.items, [ref.id], '').length + '스텝' : (ref.equipment || P.catInfo(ref.category).label)) : '';
    var pt = ref && it.kind === 'module' && Object.keys(it.params || {}).length ? P.text(ref.fields, it.params, ' · ') : '';
    return '<div class="flow-item" data-item="' + esc(it.id) + '"><span class="step-num">' + (i + 1) + '</span>'
      + '<div class="flex-fill"><div><span class="badge ' + (it.kind === 'flow' ? 'bg-purple-lt' : 'bg-blue-lt') + ' me-1">' + (it.kind === 'flow' ? '흐름' : '모듈') + '</span><b>' + esc(name) + '</b> <span class="small text-secondary">' + esc(sub) + '</span></div>'
      + '<div class="row g-1 mt-1"><div class="col-6"><input type="text" class="form-control form-control-sm" data-f="label" placeholder="표시 이름 (선택)" value="' + esc(it.label || '') + '"></div><div class="col-6"><input type="text" class="form-control form-control-sm" data-f="note" placeholder="메모 · 지시" value="' + esc(it.note || '') + '"></div></div>'
      + (pt ? '<div class="small text-primary mt-1"><i class="ti ti-adjustments"></i> ' + esc(pt) + '</div>' : '') + '</div>'
      + '<div class="d-flex flex-column gap-1">' + (it.kind === 'module' && ref ? '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="item-params" data-id="' + esc(it.id) + '" title="계획 조건 (모듈 기본값과 다른 값)"><i class="ti ti-adjustments"></i></button>' : '') + '<span class="d-flex gap-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="item-move" data-id="' + esc(it.id) + '" data-dir="up" title="위로"><i class="ti ti-chevron-up"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="item-move" data-id="' + esc(it.id) + '" data-dir="down" title="아래로"><i class="ti ti-chevron-down"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="item-remove" data-id="' + esc(it.id) + '" title="빼기"><i class="ti ti-x"></i></button></span></div></div>';
  }
  function syncDraftFromDom() {
    $all('#flow-items [data-item]').forEach(function (row) {
      var it = state.draft.filter(function (x) { return x.id === row.getAttribute('data-item'); })[0]; if (!it) return;
      it.label = row.querySelector('[data-f="label"]').value; it.note = row.querySelector('[data-f="note"]').value;
    });
  }
  function rerenderFlowEditor() { var card = $('#flow-form-card'); if (!card || !state.editFlow) return; var v = readForm($('#flow-form')); state.editFlow.name = v.name; state.editFlow.device = v.device; state.editFlow.description = v.description; var tmp = document.createElement('div'); tmp.innerHTML = flowEditor(state.editFlow); card.replaceWith(tmp.firstElementChild); }

  function itemParamsDialog(it) {
    var m = modById(it.refId); if (!m) return Promise.resolve(null);
    var d = S.defaults(m.fields);
    var body = '<div class="text-secondary small mb-2">' + esc(m.name) + ' 의 계획 조건입니다. 모듈 기본값과 다른 값만 이 흐름에 저장됩니다.</div>' + P.inputs(m.fields, Object.assign({}, d, it.params || {}), { optional: true });
    return dialog({ title: '계획 조건 · ' + (it.label || m.name), bodyHtml: body, okLabel: '적용', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var vals = P.read(m.fields, v), diff = {};
      m.fields.forEach(function (f) { var x = vals[f.key]; if (x === undefined) return; if (f.type === 'check') { if (!!x !== !!d[f.key]) diff[f.key] = !!x; return; } if (String(x) === '' ) { if (d[f.key] !== undefined) diff[f.key] = ''; return; } if (String(x) !== String(d[f.key] === undefined ? '' : d[f.key])) diff[f.key] = f.type === 'number' && !isNaN(Number(x)) ? Number(x) : x; });
      it.params = diff; return it;
    });
  }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function scrollTo(sel) { var el = $(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  document.addEventListener('input', function (e) { if (e.target.id === 'mod-q') { state.q = e.target.value; var card = $('#mod-form-card'); render(); if (card) { /* keep editor */ } var q = $('#mod-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } } });
  document.addEventListener('submit', function (e) {
    var fid = e.target.getAttribute && e.target.getAttribute('id');
    if (fid === 'module-form') {
      e.preventDefault();
      var v = readForm(e.target);
      var m = { id: v.modId || undefined, name: v.name, category: v.category, equipment: v.equipment, minutes: v.minutes, description: v.description, checklist: v.checklist, fields: P.readFieldRows(e.target) };
      if ('active' in v) m.active = !!v.active;
      if (state.editModule && state.editModule.createdAt) m.createdAt = state.editModule.createdAt;
      store.saveModule(m).then(function (saved) { toast('모듈 "' + saved.name + '" 을 저장했습니다.'); state.editModule = null; return refresh(); }).catch(handleError);
    }
    if (fid === 'flow-form') {
      e.preventDefault();
      syncDraftFromDom();
      var fv = readForm(e.target);
      var f = { id: fv.flowId || undefined, name: fv.name, device: fv.device, description: fv.description, items: state.draft.map(function (it) { return { id: it.id, kind: it.kind, refId: it.refId, label: it.label, note: it.note, params: it.params || {} }; }) };
      if (state.editFlow && state.editFlow.createdAt) f.createdAt = state.editFlow.createdAt;
      store.saveFlow(f).then(function (saved) { toast('흐름 "' + saved.name + '" 을 저장했습니다.'); state.editFlow = null; state.draft = []; return refresh(); }).catch(handleError);
    }
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id');
    switch (action) {
      case 'set-me': promptDlg({ title: '내 이름', message: '기록에 작업자로 붙는 이름입니다. 이 브라우저에 기억됩니다.', input: 'text', placeholder: '홍길동', okLabel: '저장' }).then(function (v) { if (v === null) return; return store.setMe(v).then(function () { renderChrome(); }); }).catch(handleError); break;
      /* 모듈 */
      case 'mod-new': state.editModule = { fields: [], checklist: [] }; render(); scrollTo('#mod-form-card'); break;
      case 'mod-edit': state.editModule = JSON.parse(JSON.stringify(modById(id))); render(); scrollTo('#mod-form-card'); break;
      case 'mod-copy': { var src = modById(id); if (!src) break; var cp = JSON.parse(JSON.stringify(src)); delete cp.id; delete cp.createdAt; cp.name = src.name + ' (복제)'; state.editModule = cp; render(); scrollTo('#mod-form-card'); break; }
      case 'mod-cancel': state.editModule = null; render(); break;
      case 'mod-delete': {
        var md = modById(id); if (!md) break; var mu = moduleUsage(id);
        confirmDlg({ title: '모듈 삭제', message: '"' + md.name + '" 모듈을 삭제할까요?' + (mu.flows.length || mu.runs ? ' 흐름 ' + mu.flows.length + '개 · 런 ' + mu.runs + '개에서 쓰고 있어 삭제 대신 비활성화됩니다.' : ''), okLabel: '삭제', danger: true })
          .then(function (ok) { if (!ok) return; return store.deleteModule(id).then(function (r) { toast(r && r.deactivated ? '사용 중이라 비활성화했습니다.' : '삭제했습니다.'); return refresh(); }); }).catch(handleError); break;
      }
      case 'field-add': { var rows = $('#field-rows'); if (rows) { rows.insertAdjacentHTML('beforeend', P.fieldRowHtml({})); var last = rows.lastElementChild.querySelector('[data-f="label"]'); if (last) last.focus(); } break; }
      case 'field-remove': { var fr = el.closest('[data-row]'); if (fr) fr.remove(); break; }
      case 'field-up': case 'field-down': { var row = el.closest('[data-row]'); if (!row) break; if (action === 'field-up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); if (action === 'field-down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); break; }
      /* 흐름 */
      case 'flow-new': state.editFlow = { items: [] }; state.draft = []; render(); scrollTo('#flow-form-card'); break;
      case 'flow-edit': { var fe = flowById(id); if (!fe) break; state.editFlow = JSON.parse(JSON.stringify(fe)); state.draft = state.editFlow.items.map(function (it) { return Object.assign({}, it, { id: it.id || uid() }); }); render(); scrollTo('#flow-form-card'); break; }
      case 'flow-copy': { var fs = flowById(id); if (!fs) break; var fc = JSON.parse(JSON.stringify(fs)); delete fc.id; delete fc.createdAt; fc.name = fs.name + ' (복제)'; state.editFlow = fc; state.draft = fc.items.map(function (it) { return Object.assign({}, it, { id: uid() }); }); render(); scrollTo('#flow-form-card'); break; }
      case 'flow-cancel': state.editFlow = null; state.draft = []; render(); break;
      case 'flow-delete': {
        var fd = flowById(id); if (!fd) break; var fu = flowUsage(id);
        if (fu.flows.length) { toast('"' + fu.flows.map(function (x) { return x.name; }).join(', ') + '" 흐름이 이 흐름을 포함하고 있어 삭제할 수 없습니다.', true); break; }
        confirmDlg({ title: '흐름 삭제', message: '"' + fd.name + '" 흐름을 삭제할까요?' + (fu.runs ? ' 이미 만들어진 런 ' + fu.runs + '개는 그대로 남습니다.' : ''), okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteFlow(id).then(function () { toast('삭제했습니다.'); return refresh(); }); }).catch(handleError); break;
      }
      case 'item-add-module': { var sel = $('#add-module'); if (!sel || !sel.value) break; syncDraftFromDom(); state.draft.push({ id: uid(), kind: 'module', refId: sel.value, label: '', note: '', params: {} }); rerenderFlowEditor(); break; }
      case 'item-add-flow': { var sf = $('#add-flow'); if (!sf || !sf.value) break; syncDraftFromDom(); state.draft.push({ id: uid(), kind: 'flow', refId: sf.value, label: '', note: '', params: {} }); rerenderFlowEditor(); break; }
      case 'item-remove': syncDraftFromDom(); state.draft = state.draft.filter(function (it) { return it.id !== id; }); rerenderFlowEditor(); break;
      case 'item-move': { syncDraftFromDom(); var i = state.draft.findIndex(function (it) { return it.id === id; }); var j = el.getAttribute('data-dir') === 'up' ? i - 1 : i + 1; if (i < 0 || j < 0 || j >= state.draft.length) break; var t = state.draft[i]; state.draft[i] = state.draft[j]; state.draft[j] = t; rerenderFlowEditor(); break; }
      case 'item-params': { syncDraftFromDom(); var ip = state.draft.filter(function (it) { return it.id === id; })[0]; if (!ip) break; itemParamsDialog(ip).then(function (res) { if (res) rerenderFlowEditor(); }).catch(handleError); break; }
    }
  });
  window.addEventListener('hashchange', function () { readHash(); state.editModule = null; state.editFlow = null; state.draft = []; render(); });

  store.init().then(function () { state.ready = true; readHash(); store.onChange(function () { reload().then(function () { if (!state.editModule && !state.editFlow) render(); }).catch(handleError); }); return refresh(); })
    .catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
