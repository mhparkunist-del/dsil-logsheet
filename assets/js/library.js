/* =====================================================================
   DSIL Run Sheet – 라이브러리: 분류(소자/패키징)별 공정 모듈 + 공정 흐름(모듈·서브 흐름·분기점의 재조합)
   해시: #tab=modules | #tab=flows   분류 필터: state.domain
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore, L = window.DSILLayout;
  var esc = U.esc, fmtDuration = U.fmtDuration, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, empty = U.empty;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [];
  var state = { ready: false, error: null, tab: 'modules', domain: '', modules: [], flows: [], runs: [], editModule: null, editFlow: null, q: '' };

  function uid() { return 'it-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function modById(id) { return state.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function flowById(id) { return state.flows.filter(function (f) { return f.id === id; })[0] || null; }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function domainBadge(id) { return '<span class="badge ' + (id === 'package' ? 'bg-indigo-lt' : 'bg-blue-lt') + '">' + esc(domainInfo(id).short) + '</span>'; }
  function readHash() { var m = /tab=(\w+)/.exec(window.location.hash); state.tab = m && m[1] === 'flows' ? 'flows' : 'modules'; var d = /domain=(\w+)/.exec(window.location.hash); if (d) state.domain = d[1] === 'all' ? '' : d[1]; }
  function ctx() { return { modules: state.modules, flows: state.flows }; }
  function inDomain(x) { return !state.domain || x.domain === state.domain; }

  function reload() { return Promise.all([store.listModules(), store.listFlows(), store.listRuns()]).then(function (r) { state.modules = r[0]; state.flows = r[1]; state.runs = r[2]; }); }

  function moduleUsage(id) {
    var flows = state.flows.filter(function (f) { var u = false; S.eachStep(f.items, function (it) { if (it.kind === 'module' && it.refId === id) u = true; }); return u; });
    return { flows: flows, runs: state.runs.filter(function (r) { return r.steps.some(function (s) { return s.moduleId === id; }); }).length };
  }
  function flowUsage(id) {
    var flows = state.flows.filter(function (f) { if (f.id === id) return false; var u = false; S.eachStep(f.items, function (it) { if (it.kind === 'flow' && it.refId === id) u = true; }); return u; });
    return { flows: flows, runs: state.runs.filter(function (r) { return r.flowId === id; }).length };
  }
  function expandSafe(items, flowId) { try { return { tree: S.expandItems(ctx(), items, flowId ? [flowId] : [], ''), error: null }; } catch (e) { return { tree: null, error: e.message }; } }

  /* ---------- 렌더 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var m = store.getMe();
    slot.innerHTML = m.name ? '<span class="text-secondary small"><i class="ti ti-user me-1"></i>' + esc(m.name) + (m.team ? ' · ' + esc(m.team) : '') + '</span>' : '';
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    var mods = state.modules.filter(inDomain), flows = state.flows.filter(inDomain);
    var html = '<div class="d-flex flex-wrap align-items-center gap-2 mb-3"><div class="btn-group">' + [{ id: '', label: '전체' }].concat(DOMAINS).map(function (d) { return '<button type="button" class="btn' + (state.domain === d.id ? ' active btn-primary' : '') + '" data-action="domain" data-domain="' + d.id + '">' + (d.icon ? '<i class="ti ti-' + d.icon + ' me-1"></i>' : '') + esc(d.label) + '</button>'; }).join('') + '</div>'
      + '<ul class="nav nav-tabs ms-md-3 mb-0 flex-fill"><li class="nav-item"><a class="nav-link' + (state.tab === 'modules' ? ' active' : '') + '" href="#tab=modules"><i class="ti ti-box me-1"></i>공정 모듈 <span class="badge bg-secondary-lt ms-1">' + mods.length + '</span></a></li><li class="nav-item"><a class="nav-link' + (state.tab === 'flows' ? ' active' : '') + '" href="#tab=flows"><i class="ti ti-git-branch me-1"></i>공정 흐름 <span class="badge bg-secondary-lt ms-1">' + flows.length + '</span></a></li></ul></div>';
    app.innerHTML = html + (state.tab === 'flows' ? renderFlows(flows) : renderModules(mods));
  }

  /* ---------- 모듈 ---------- */
  function renderModules(mods) {
    var q = state.q.trim().toLowerCase();
    var list = mods.filter(function (m) { return !q || [m.name, m.equipment, m.description, P.catInfo(m.category).label].join(' ').toLowerCase().indexOf(q) >= 0; });
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div class="text-secondary small">모듈은 한 번 정의해 여러 흐름·런에서 재사용하는 공정 단위입니다. 분류(소자/패키징)·세부 분류·조건 항목·확인 사항을 정합니다.</div>'
      + '<div class="d-flex gap-2"><input type="search" class="form-control form-control-sm" id="mod-q" placeholder="검색" value="' + esc(state.q) + '" style="width:12rem"><button type="button" class="btn btn-sm btn-primary" data-action="mod-new"><i class="ti ti-plus me-1"></i>모듈 추가</button></div></div>';
    if (state.editModule) html += moduleEditor(state.editModule);
    if (!list.length) return html + '<div class="card">' + empty('box-off', '모듈이 없습니다', '"모듈 추가"로 첫 공정 모듈을 만드세요.') + '</div>';
    var cats = (CFG.categories || []).map(function (c) { return c.id; }), doms = DOMAINS.map(function (d) { return d.id; });
    list.sort(function (a, b) { var da = doms.indexOf(a.domain), db = doms.indexOf(b.domain); if (da !== db) return da - db; var ca = cats.indexOf(a.category), cb = cats.indexOf(b.category); return ca !== cb ? ca - cb : a.name.localeCompare(b.name, 'ko'); });
    html += '<div class="card"><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>모듈</th><th class="w-1">분류</th><th>장비</th><th>조건 항목</th><th class="w-1">사용</th><th class="w-1"></th></tr></thead><tbody>'
      + list.map(function (m) {
        var u = moduleUsage(m.id);
        return '<tr' + (m.active === false ? ' class="text-secondary"' : '') + '><td><div class="fw-medium">' + esc(m.name) + (m.active === false ? ' <span class="badge bg-secondary-lt">비활성</span>' : '') + '</div>' + (m.description ? '<div class="small text-secondary">' + esc(m.description) + '</div>' : '') + '</td><td class="text-nowrap">' + domainBadge(m.domain) + ' ' + P.catBadge(m.category) + '</td><td class="small">' + esc(m.equipment || '-') + '</td>'
          + '<td class="small">' + (m.fields.length ? m.fields.map(function (f) { return esc(f.label) + (f.unit ? '(' + esc(f.unit) + ')' : '') + (f.required ? '*' : ''); }).join(', ') : '<span class="text-secondary">없음</span>') + (m.checklist.length ? '<div class="text-secondary">확인 ' + m.checklist.length + '항목</div>' : '') + '</td>'
          + '<td class="text-nowrap small">' + (u.flows.length ? '<span title="' + esc(u.flows.map(function (f) { return f.name; }).join(', ')) + '">흐름 ' + u.flows.length + '</span>' : '') + (u.runs ? (u.flows.length ? ' · ' : '') + '런 ' + u.runs : '') + (!u.flows.length && !u.runs ? '-' : '') + '</td>'
          + '<td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="mod-copy" data-id="' + esc(m.id) + '" title="복제"><i class="ti ti-copy"></i></button><button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="mod-edit" data-id="' + esc(m.id) + '" title="수정"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="mod-delete" data-id="' + esc(m.id) + '" title="삭제"><i class="ti ti-trash"></i></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }
  function moduleEditor(m) {
    var isNew = !m.id;
    return '<div class="card mb-3 border-primary" id="mod-form-card"><div class="card-header"><h3 class="card-title">' + (isNew ? '모듈 추가' : '모듈 수정: ' + esc(m.name)) + '</h3></div><div class="card-body"><form id="module-form">'
      + '<input type="hidden" name="modId" value="' + esc(m.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-3"><label class="form-label required">공정 분류</label><select class="form-select" name="domain">' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + ((m.domain || state.domain || DOMAINS[0].id) === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-4"><label class="form-label required">모듈 이름</label><input type="text" class="form-control" name="name" required value="' + esc(m.name || '') + '" autocomplete="off" placeholder="예: ALD 유전막"></div>'
      + '<div class="col-md-3"><label class="form-label">세부 분류</label><select class="form-select" name="category">' + (CFG.categories || []).map(function (c) { return '<option value="' + c.id + '"' + ((m.category || 'etc') === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-2"><label class="form-label">예상 시간(분)</label><input type="number" class="form-control" name="minutes" min="0" value="' + esc(m.minutes || '') + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label">장비</label><input type="text" class="form-control" name="equipment" value="' + esc(m.equipment || '') + '" autocomplete="off"></div><div class="col-md-8"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="' + esc(m.description || '') + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">확인 사항 <span class="form-label-description">한 줄에 하나, 기록 창에 체크리스트로 표시</span></label><textarea class="form-control" name="checklist" rows="2">' + esc((m.checklist || []).join('\n')) + '</textarea></div>'
      + (isNew ? '' : '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="active"' + (m.active !== false ? ' checked' : '') + '><span class="form-check-label">사용 중 (끄면 새 흐름·스텝 추가 목록에서 숨김)</span></label>')
      + '<div class="d-flex align-items-center justify-content-between mt-4 mb-1"><div class="subheader mb-0">조건 항목 <span class="text-secondary fw-normal text-lowercase">런시트에서 계획값·실제값을 적는 칸</span></div><button type="button" class="btn btn-sm" data-action="field-add"><i class="ti ti-plus me-1"></i>항목</button></div>'
      + '<div class="text-secondary small mb-2">이름 · 종류 · 단위 · 선택지(선택 종류) · 기본값(흐름의 계획값으로 들어감) · 필수. 저장 키는 유지되므로 이름을 바꿔도 지난 기록과 연결됩니다.</div>'
      + '<div id="field-rows">' + (m.fields || []).map(P.fieldRowHtml).join('') + '</div>'
      + '<div class="mt-4 d-flex gap-2"><button type="submit" class="btn btn-primary">' + (isNew ? '추가' : '저장') + '</button><button type="button" class="btn" data-action="mod-cancel">취소</button></div></form></div></div>';
  }

  /* ---------- 흐름 ---------- */
  function renderFlows(flows) {
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div class="text-secondary small">흐름은 모듈(또는 다른 흐름)을 순서대로 엮은 런시트 템플릿입니다. <b>분기점</b>을 넣으면 기판 수량을 나눠 분기별로 다른 흐름을 지정하고, 분기점 뒤의 항목은 다시 합쳐진(merge) 공정이 됩니다.</div>'
      + '<button type="button" class="btn btn-sm btn-primary" data-action="flow-new"><i class="ti ti-plus me-1"></i>흐름 추가</button></div>';
    if (state.editFlow) html += flowEditor(state.editFlow);
    if (!flows.length) return html + '<div class="card">' + empty('git-branch', '흐름이 없습니다', '"흐름 추가"에서 모듈을 순서대로 넣으세요.') + '</div>';
    html += '<div class="card"><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>흐름</th><th>구성</th><th class="w-1">스텝</th><th class="w-1">수량</th><th class="w-1">사용</th><th class="w-1"></th></tr></thead><tbody>'
      + flows.map(function (f) {
        var ex = expandSafe(f.items, f.id), st = ex.tree ? L.stats(L.resolve(ex.tree)) : { steps: 0, splits: 0 }, u = flowUsage(f.id);
        return '<tr><td><div class="fw-medium">' + domainBadge(f.domain) + ' ' + esc(f.name) + '</div>' + (f.device ? '<div class="small text-primary">' + esc(f.device) + '</div>' : '') + (f.description ? '<div class="small text-secondary">' + esc(f.description) + '</div>' : '') + '</td>'
          + '<td class="small">' + itemChips(f.items) + '</td>'
          + '<td class="text-nowrap tnum">' + st.steps + (st.splits ? ' <span class="badge bg-purple-lt" title="분기점">분기 ' + st.splits + '</span>' : '') + (ex.error ? ' <span class="text-red" title="' + esc(ex.error) + '">!</span>' : '') + '</td><td class="text-nowrap small">' + esc(f.unitLabel) + ' ' + f.unitCount + '</td>'
          + '<td class="text-nowrap small">' + (u.flows.length ? '흐름 ' + u.flows.length : '') + (u.runs ? (u.flows.length ? ' · ' : '') + '런 ' + u.runs : '') + (!u.flows.length && !u.runs ? '-' : '') + '</td>'
          + '<td class="text-end text-nowrap"><a href="../index.html?new=' + encodeURIComponent(f.id) + '" class="btn btn-sm btn-primary me-1"><i class="ti ti-player-play me-1"></i>런 시작</a><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="flow-copy" data-id="' + esc(f.id) + '" title="복제"><i class="ti ti-copy"></i></button><button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="flow-edit" data-id="' + esc(f.id) + '" title="수정"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="flow-delete" data-id="' + esc(f.id) + '" title="삭제"><i class="ti ti-trash"></i></button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }
  function itemChips(items) {
    return items.map(function (it) {
      if (it.kind === 'split') return '<span class="badge bg-purple text-white me-1 mb-1"><i class="ti ti-git-branch"></i> ' + esc(it.name || '분기') + ': ' + it.branches.map(function (b) { return esc(b.name) + '(' + b.count + ')'; }).join(' / ') + '</span>';
      var ref = it.kind === 'flow' ? flowById(it.refId) : modById(it.refId);
      return '<span class="badge ' + (it.kind === 'flow' ? 'bg-purple-lt' : 'bg-blue-lt') + ' me-1 mb-1">' + (it.kind === 'flow' ? '<i class="ti ti-git-branch"></i> ' : '') + esc(it.label || (ref ? ref.name : '?')) + '</span>';
    }).join('');
  }

  /* ----- 흐름 편집기 (트리) ----- */
  function findList(items, containerId, count) {
    if (containerId === 'root') return { items: items, count: count };
    var res = null;
    (function walk(list) { list.forEach(function (n) { if (res || n.kind !== 'split') return; n.branches.forEach(function (b) { if (res) return; if (b.id === containerId) res = { items: b.items, count: b.count, branch: b }; else walk(b.items); }); }); })(items);
    return res;
  }
  function locateItem(items, id) {
    var res = null;
    (function walk(list, container) { list.forEach(function (n, i) { if (res) return; if (n.id === id) { res = { list: list, index: i, node: n, container: container }; return; } if (n.kind === 'split') n.branches.forEach(function (b) { walk(b.items, b.id); }); }); })(items, 'root');
    return res;
  }
  function itemRow(it, i, depth) {
    var ref = it.kind === 'flow' ? flowById(it.refId) : modById(it.refId);
    var name = ref ? ref.name : '(삭제됨)';
    var sub = ref ? (it.kind === 'flow' ? ref.items.length + '항목' : (ref.equipment || P.catInfo(ref.category).label)) : '';
    var pt = ref && it.kind === 'module' && Object.keys(it.params || {}).length ? P.text(ref.fields, it.params, ' · ') : (ref && it.kind === 'flow' && Object.keys(it.params || {}).length ? Object.keys(it.params).map(function (k) { return k + ': ' + it.params[k]; }).join(' · ') : '');
    return '<div class="flow-item" data-item="' + esc(it.id) + '"><span class="step-num">' + (i + 1) + '</span>'
      + '<div class="flex-fill"><div><span class="badge ' + (it.kind === 'flow' ? 'bg-purple-lt' : 'bg-blue-lt') + ' me-1">' + (it.kind === 'flow' ? '흐름' : '모듈') + '</span><b>' + esc(name) + '</b> <span class="small text-secondary">' + esc(sub) + '</span>' + (ref && ref.domain && ref.domain !== (state.editFlow && state.editFlow.domain) ? ' ' + domainBadge(ref.domain) : '') + '</div>'
      + '<div class="row g-1 mt-1"><div class="col-6"><input type="text" class="form-control form-control-sm" data-f="label" placeholder="표시 이름 (선택)" value="' + esc(it.label || '') + '"></div><div class="col-6"><input type="text" class="form-control form-control-sm" data-f="note" placeholder="메모 · 지시" value="' + esc(it.note || '') + '"></div></div>'
      + (pt ? '<div class="small text-primary mt-1"><i class="ti ti-adjustments"></i> ' + esc(pt) + '</div>' : '') + '</div>'
      + '<div class="d-flex flex-column gap-1">' + (ref ? '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="item-params" data-id="' + esc(it.id) + '" title="계획 조건 (기본값과 다른 값)"><i class="ti ti-adjustments"></i></button>' : '') + '<span class="d-flex gap-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="item-move" data-id="' + esc(it.id) + '" data-dir="up" title="위로"><i class="ti ti-chevron-up"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="item-move" data-id="' + esc(it.id) + '" data-dir="down" title="아래로"><i class="ti ti-chevron-down"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="item-remove" data-id="' + esc(it.id) + '" title="빼기"><i class="ti ti-x"></i></button></span></div></div>';
  }
  function splitBlock(sp, i, parentCount, depth) {
    var f = state.editFlow, sum = sp.branches.reduce(function (a, b) { return a + (Number(b.count) || 0); }, 0);
    return '<div class="split-block depth-' + depth + '" data-item="' + esc(sp.id) + '"><div class="split-head"><span class="step-num">' + (i + 1) + '</span><span class="badge bg-purple text-white"><i class="ti ti-git-branch"></i> 분기점</span>'
      + '<input type="text" class="form-control form-control-sm" data-f="splitName" placeholder="분기점 이름 (예: 접촉 금속)" value="' + esc(sp.name || '') + '" style="max-width:16rem">'
      + '<span class="small text-secondary text-nowrap">나눌 수량 ' + parentCount + ' ' + esc(f.unitLabel || '기판') + (sum !== parentCount ? ' · <span class="text-red fw-bold">합계 ' + sum + ' ≠ ' + parentCount + '</span>' : ' · 합계 ' + sum) + '</span>'
      + '<span class="ms-auto d-flex gap-1"><button type="button" class="btn btn-sm" data-action="branch-add" data-id="' + esc(sp.id) + '"><i class="ti ti-plus me-1"></i>분기</button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="item-move" data-id="' + esc(sp.id) + '" data-dir="up" title="위로"><i class="ti ti-chevron-up"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="item-move" data-id="' + esc(sp.id) + '" data-dir="down" title="아래로"><i class="ti ti-chevron-down"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="item-remove" data-id="' + esc(sp.id) + '" title="분기점 빼기"><i class="ti ti-x"></i></button></span></div>'
      + '<div class="split-branches">' + sp.branches.map(function (b) {
        return '<div class="split-branch" data-branch="' + esc(b.id) + '"><div class="branch-head"><i class="ti ti-arrow-bear-right text-purple"></i><input type="text" class="form-control form-control-sm" data-f="bname" value="' + esc(b.name) + '" placeholder="분기 이름"><input type="number" class="form-control form-control-sm" data-f="bcount" value="' + b.count + '" min="1" style="max-width:5rem" title="수량"><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="branch-remove" data-id="' + esc(b.id) + '" data-split="' + esc(sp.id) + '" title="이 분기 빼기"><i class="ti ti-x"></i></button></div>' + renderItems(b.items, b.id, b.count, depth + 1) + '</div>';
      }).join('') + '</div><div class="small text-secondary mt-1"><i class="ti ti-arrows-join"></i> 분기점 뒤의 항목부터 다시 합쳐진(merge) 공정</div></div>';
  }
  function addBar(containerId, count, depth) {
    var f = state.editFlow, dom = f.domain || DOMAINS[0].id;
    var mods = state.modules.filter(function (m) { return m.active !== false; });
    var cats = CFG.categories || [];
    var domOrder = DOMAINS.filter(function (d) { return d.id === dom; }).concat(DOMAINS.filter(function (d) { return d.id !== dom; }));   /* 이 흐름의 분류를 먼저 */
    var modOpts = domOrder.map(function (d) { var inD = mods.filter(function (m) { return m.domain === d.id; }); if (!inD.length) return ''; return cats.map(function (c) { var ms = inD.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc((d.id === dom ? '' : d.short + ' · ') + c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</optgroup>' : ''; }).join(''); }).join('');
    var flowPool = state.flows.filter(function (x) { return x.id !== f.id && !S.hasSplit(x.items) && !(f.id && flowUsage(f.id).flows.some(function (y) { return y.id === x.id; })); });
    var flowOpts = flowPool.filter(function (x) { return x.domain === dom; }).concat(flowPool.filter(function (x) { return x.domain !== dom; })).map(function (x) { return '<option value="' + esc(x.id) + '">' + (x.domain !== dom ? '[' + esc(domainInfo(x.domain).short) + '] ' : '') + esc(x.name) + ' (' + x.items.length + '항목)</option>'; }).join('');
    return '<div class="add-bar row g-2 align-items-end mt-1"><div class="col-md-5"><div class="input-group input-group-sm"><span class="input-group-text">모듈</span><select class="form-select" id="am-' + esc(containerId) + '">' + modOpts + '</select><button type="button" class="btn" data-action="item-add-module" data-container="' + esc(containerId) + '"><i class="ti ti-plus"></i></button></div></div>'
      + '<div class="col-md-5"><div class="input-group input-group-sm"><span class="input-group-text">흐름</span><select class="form-select" id="af-' + esc(containerId) + '"' + (flowOpts ? '' : ' disabled') + '>' + (flowOpts || '<option value="">넣을 수 있는 흐름 없음</option>') + '</select><button type="button" class="btn" data-action="item-add-flow" data-container="' + esc(containerId) + '"' + (flowOpts ? '' : ' disabled') + '><i class="ti ti-plus"></i></button></div></div>'
      + '<div class="col-md-2"><button type="button" class="btn btn-sm w-100" data-action="item-add-split" data-container="' + esc(containerId) + '"' + (count < 2 ? ' disabled title="수량이 1이라 나눌 수 없습니다"' : '') + '><i class="ti ti-git-branch me-1"></i>분기점</button></div></div>';
  }
  function renderItems(items, containerId, count, depth) {
    var html = items.length ? items.map(function (it, i) { return it.kind === 'split' ? splitBlock(it, i, count, depth) : itemRow(it, i, depth); }).join('') : '<div class="text-secondary small py-1">' + (containerId === 'root' ? '아래에서 모듈·흐름·분기점을 추가하세요.' : '이 분기에 넣을 모듈·흐름을 추가하세요.') + '</div>';
    return '<div class="items-list" data-list="' + esc(containerId) + '">' + html + '</div>' + addBar(containerId, count, depth);
  }
  function previewTable(f) {
    var ex = expandSafe(f.items, f.id);
    if (ex.error) return '<div class="alert alert-danger py-2 px-3 small mb-0">' + esc(ex.error) + '</div>';
    var err = null; try { S.checkSplits(f.items, f.unitCount, f.unitLabel); } catch (e) { err = e.message; }
    var tree = L.resolve(ex.tree), st = L.stats(tree), rows = L.rows(tree, f.unitCount, {});
    var units = []; for (var i = 0; i < f.unitCount; i++) units.push((f.unitLabel || '기판') + ' ' + (i + 1));
    var html = (err ? '<div class="alert alert-warning py-2 px-3 small">' + esc(err) + '</div>' : '') + '<div class="text-secondary small mb-1">' + st.steps + '스텝' + (st.splits ? ' · 분기점 ' + st.splits + '개' : '') + ' · 열 = ' + esc(f.unitLabel || '기판') + '</div>'
      + '<div class="table-responsive"><table class="table table-bordered split-mini"><thead><tr>' + units.map(function (u) { return '<th>' + esc(u) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function (row) {
      html += '<tr>' + row.cells.map(function (c) {
        var span = c.count > 1 ? ' colspan="' + c.count + '"' : '';
        if (c.type === 'branch-head') return '<td' + span + ' class="cell-branch-head"><b>' + esc(c.branch.name) + '</b> ' + c.branch.count + (c.mismatch ? ' <span class="text-red">!</span>' : '') + '</td>';
        if (c.type !== 'step') return '<td' + span + ' class="cell-empty"></td>';
        var s = c.step; return '<td' + span + (s.missing ? ' class="text-red"' : '') + '>' + (s.group ? '<span class="step-group">' + esc(s.group) + '</span><br>' : '') + '<b>' + esc(s.name) + '</b>' + (s.fields && s.fields.length ? '<br><span class="text-secondary">' + esc(P.text(s.fields, s.planned, ' · ')) + '</span>' : '') + '</td>';
      }).join('') + '</tr>';
    });
    return html + '</tbody></table></div>';
  }
  function flowEditor(f) {
    var isNew = !f.id;
    return '<div class="card mb-3 border-primary" id="flow-form-card"><div class="card-header"><h3 class="card-title">' + (isNew ? '흐름 추가' : '흐름 수정: ' + esc(f.name)) + '</h3></div><div class="card-body"><form id="flow-form">'
      + '<input type="hidden" name="flowId" value="' + esc(f.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-3"><label class="form-label required">공정 분류</label><select class="form-select" name="domain">' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + ((f.domain || state.domain || DOMAINS[0].id) === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-5"><label class="form-label required">흐름 이름</label><input type="text" class="form-control" name="name" required value="' + esc(f.name || '') + '" autocomplete="off" placeholder="예: MoS2 백게이트 FET"></div>'
      + '<div class="col-md-4"><label class="form-label">소자 · 대상</label><input type="text" class="form-control" name="device" value="' + esc(f.device || '') + '" autocomplete="off"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-6"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="' + esc(f.description || '') + '" autocomplete="off"></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">기판 단위 라벨</label><input type="text" class="form-control" name="unitLabel" list="unit-labels" value="' + esc(f.unitLabel || '기판') + '" autocomplete="off"><datalist id="unit-labels">' + (CFG.unitLabels || []).map(function (u) { return '<option value="' + esc(u) + '">'; }).join('') + '</datalist></div>'
      + '<div class="col-6 col-md-3"><label class="form-label required">기본 수량 <span class="form-label-description">런에서 바꿀 수 있음</span></label><input type="number" class="form-control" name="unitCount" min="1" required value="' + (f.unitCount || 1) + '"></div></div>'
      + '<div class="row g-3 mt-2"><div class="col-lg-7"><div class="subheader mb-2">구성 (순서대로) <span class="text-secondary fw-normal">분기점 안의 분기마다 따로 흐름을 넣고, 분기점 뒤에 넣는 항목은 합쳐진 공정입니다</span></div>' + renderItems(f.items, 'root', f.unitCount || 1, 0) + '</div>'
      + '<div class="col-lg-5"><div class="subheader mb-2">펼친 런시트 미리보기</div><div id="flow-preview">' + previewTable(f) + '</div></div></div>'
      + '<div class="mt-4 d-flex gap-2"><button type="submit" class="btn btn-primary">' + (isNew ? '추가' : '저장') + '</button><button type="button" class="btn" data-action="flow-cancel">취소</button></div></form></div></div>';
  }
  /* DOM 의 입력값을 편집 중인 흐름(트리)에 반영 */
  function syncFromDom() {
    var f = state.editFlow, form = $('#flow-form'); if (!f || !form) return;
    var v = readForm(form); f.domain = v.domain; f.name = v.name; f.device = v.device; f.description = v.description; f.unitLabel = v.unitLabel; f.unitCount = Math.max(1, Math.round(Number(v.unitCount)) || 1);
    $all('.flow-item[data-item]', form).forEach(function (row) { var loc = locateItem(f.items, row.getAttribute('data-item')); if (!loc) return; loc.node.label = row.querySelector('[data-f="label"]').value; loc.node.note = row.querySelector('[data-f="note"]').value; });
    $all('.split-block[data-item]', form).forEach(function (blk) { var loc = locateItem(f.items, blk.getAttribute('data-item')); if (!loc) return; var inp = blk.querySelector(':scope > .split-head [data-f="splitName"]'); if (inp) loc.node.name = inp.value; });
    $all('[data-branch]', form).forEach(function (el) {
      var bid = el.getAttribute('data-branch'), found = null;
      S.eachSplit(f.items, function (sp) { sp.branches.forEach(function (b) { if (b.id === bid) found = b; }); });
      if (!found) return;
      var n = el.querySelector(':scope > .branch-head [data-f="bname"]'), c = el.querySelector(':scope > .branch-head [data-f="bcount"]');
      if (n) found.name = n.value; if (c) found.count = Math.max(1, Math.round(Number(c.value)) || 1);
    });
  }
  function rerender() { syncFromDom(); var card = $('#flow-form-card'); if (!card) return; var tmp = document.createElement('div'); tmp.innerHTML = flowEditor(state.editFlow); card.replaceWith(tmp.firstElementChild); }
  function itemParamsDialog(it) {
    var m = it.kind === 'module' ? modById(it.refId) : null, fl = it.kind === 'flow' ? flowById(it.refId) : null;
    if (!m && !fl) return Promise.resolve(null);
    var fields = m ? m.fields : [], d = m ? S.defaults(m.fields) : {};
    var body = m ? '<div class="text-secondary small mb-2">' + esc(m.name) + ' 의 계획 조건. 모듈 기본값과 다른 값만 이 흐름에 저장됩니다.</div>' + P.inputs(fields, Object.assign({}, d, it.params || {}), { optional: true })
      : '<div class="text-secondary small mb-2">서브 흐름 "' + esc(fl.name) + '" 안의 모든 스텝에 적용할 조건을 <code>키=값</code> 으로 한 줄에 하나씩 적습니다 (예: <code>stack=Ti 10 nm / Au 50 nm</code>). 해당 키가 있는 스텝에만 반영됩니다.</div><textarea class="form-control" name="raw" rows="4">' + esc(Object.keys(it.params || {}).map(function (k) { return k + '=' + it.params[k]; }).join('\n')) + '</textarea>';
    return dialog({ title: '계획 조건 · ' + (it.label || (m ? m.name : fl.name)), bodyHtml: body, okLabel: '적용', size: 'lg' }).then(function (v) {
      if (!v) return null;
      if (fl) { var params = {}; String(v.raw || '').split(/\r?\n/).forEach(function (line) { var i = line.indexOf('='); if (i > 0) { var k = line.slice(0, i).trim(), val = line.slice(i + 1).trim(); if (k) params[k] = val; } }); it.params = params; return it; }
      var vals = P.read(fields, v), diff = {};
      fields.forEach(function (f) { var x = vals[f.key]; if (x === undefined) return; if (f.type === 'check') { if (!!x !== !!d[f.key]) diff[f.key] = !!x; return; } if (String(x) === '') { if (d[f.key] !== undefined) diff[f.key] = ''; return; } if (String(x) !== String(d[f.key] === undefined ? '' : d[f.key])) diff[f.key] = f.type === 'number' && !isNaN(Number(x)) ? Number(x) : x; });
      it.params = diff; return it;
    });
  }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function scrollTo(sel) { var el = $(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  document.addEventListener('input', function (e) {
    if (e.target.id === 'mod-q') { state.q = e.target.value; render(); var q = $('#mod-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } return; }
    if (e.target.closest('#flow-form') && (e.target.name === 'unitCount' || e.target.name === 'unitLabel' || e.target.getAttribute('data-f') === 'bcount' || e.target.getAttribute('data-f') === 'bname')) { syncFromDom(); var pv = $('#flow-preview'); if (pv) pv.innerHTML = previewTable(state.editFlow); }
  });
  document.addEventListener('change', function (e) { if (e.target.closest('#flow-form') && e.target.name === 'domain') { rerender(); } });
  document.addEventListener('submit', function (e) {
    var fid = e.target.getAttribute && e.target.getAttribute('id');
    if (fid === 'module-form') {
      e.preventDefault();
      var v = readForm(e.target);
      var m = { id: v.modId || undefined, domain: v.domain, name: v.name, category: v.category, equipment: v.equipment, minutes: v.minutes, description: v.description, checklist: v.checklist, fields: P.readFieldRows(e.target) };
      if ('active' in v) m.active = !!v.active;
      if (state.editModule && state.editModule.createdAt) m.createdAt = state.editModule.createdAt;
      store.saveModule(m).then(function (saved) { toast('모듈 "' + saved.name + '" 을 저장했습니다.'); state.editModule = null; return refresh(); }).catch(handleError);
    }
    if (fid === 'flow-form') {
      e.preventDefault();
      syncFromDom();
      var f = state.editFlow;
      store.saveFlow({ id: f.id || undefined, domain: f.domain, name: f.name, device: f.device, description: f.description, unitLabel: f.unitLabel, unitCount: f.unitCount, items: f.items, createdAt: f.createdAt })
        .then(function (saved) { toast('흐름 "' + saved.name + '" 을 저장했습니다.'); state.editFlow = null; return refresh(); }).catch(handleError);
    }
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id'), f = state.editFlow;
    switch (action) {
      case 'domain': state.domain = el.getAttribute('data-domain') || ''; state.editModule = null; state.editFlow = null; render(); break;
      /* 모듈 */
      case 'mod-new': state.editModule = { fields: [], checklist: [], domain: state.domain || DOMAINS[0].id }; render(); scrollTo('#mod-form-card'); break;
      case 'mod-edit': state.editModule = JSON.parse(JSON.stringify(modById(id))); render(); scrollTo('#mod-form-card'); break;
      case 'mod-copy': { var src = modById(id); if (!src) break; var cp = JSON.parse(JSON.stringify(src)); delete cp.id; delete cp.createdAt; cp.name = src.name + ' (복제)'; state.editModule = cp; render(); scrollTo('#mod-form-card'); break; }
      case 'mod-cancel': state.editModule = null; render(); break;
      case 'mod-delete': { var md = modById(id); if (!md) break; var mu = moduleUsage(id); confirmDlg({ title: '모듈 삭제', message: '"' + md.name + '" 모듈을 삭제할까요?' + (mu.flows.length || mu.runs ? ' 흐름 ' + mu.flows.length + '개 · 런 ' + mu.runs + '개에서 쓰고 있어 삭제 대신 비활성화됩니다.' : ''), okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteModule(id).then(function (r) { toast(r && r.deactivated ? '사용 중이라 비활성화했습니다.' : '삭제했습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'field-add': { var rows = $('#field-rows'); if (rows) { rows.insertAdjacentHTML('beforeend', P.fieldRowHtml({})); var last = rows.lastElementChild.querySelector('[data-f="label"]'); if (last) last.focus(); } break; }
      case 'field-remove': { var fr = el.closest('[data-row]'); if (fr) fr.remove(); break; }
      case 'field-up': case 'field-down': { var row = el.closest('[data-row]'); if (!row) break; if (action === 'field-up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); if (action === 'field-down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); break; }
      /* 흐름 */
      case 'flow-new': state.editFlow = { items: [], domain: state.domain || DOMAINS[0].id, unitLabel: '기판', unitCount: 1 }; render(); scrollTo('#flow-form-card'); break;
      case 'flow-edit': { var fe = flowById(id); if (!fe) break; state.editFlow = JSON.parse(JSON.stringify(fe)); render(); scrollTo('#flow-form-card'); break; }
      case 'flow-copy': { var fs = flowById(id); if (!fs) break; var fc = JSON.parse(JSON.stringify(fs)); delete fc.id; delete fc.createdAt; fc.name = fs.name + ' (복제)'; (function reid(items) { items.forEach(function (it) { it.id = uid(); if (it.kind === 'split') it.branches.forEach(function (b) { b.id = uid(); reid(b.items); }); }); })(fc.items); state.editFlow = fc; render(); scrollTo('#flow-form-card'); break; }
      case 'flow-cancel': state.editFlow = null; render(); break;
      case 'flow-delete': { var fd = flowById(id); if (!fd) break; var fu = flowUsage(id); if (fu.flows.length) { toast('"' + fu.flows.map(function (x) { return x.name; }).join(', ') + '" 흐름이 이 흐름을 포함하고 있어 삭제할 수 없습니다.', true); break; } confirmDlg({ title: '흐름 삭제', message: '"' + fd.name + '" 흐름을 삭제할까요?' + (fu.runs ? ' 이미 만들어진 런 ' + fu.runs + '개는 그대로 남습니다.' : ''), okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteFlow(id).then(function () { toast('삭제했습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'item-add-module': { var c = el.getAttribute('data-container'); var sel = $('#am-' + c); if (!sel || !sel.value || !f) break; syncFromDom(); var lst = findList(f.items, c, f.unitCount); if (!lst) break; lst.items.push({ id: uid(), kind: 'module', refId: sel.value, label: '', note: '', params: {} }); rerender(); break; }
      case 'item-add-flow': { var c2 = el.getAttribute('data-container'); var sf = $('#af-' + c2); if (!sf || !sf.value || !f) break; var sub = flowById(sf.value); if (sub && S.hasSplit(sub.items)) { toast('분기점이 있는 흐름은 서브 흐름으로 넣을 수 없습니다.', true); break; } syncFromDom(); var lst2 = findList(f.items, c2, f.unitCount); if (!lst2) break; lst2.items.push({ id: uid(), kind: 'flow', refId: sf.value, label: '', note: '', params: {} }); rerender(); break; }
      case 'item-add-split': { var c3 = el.getAttribute('data-container'); if (!f) break; syncFromDom(); var lst3 = findList(f.items, c3, f.unitCount); if (!lst3) break; if (lst3.count < 2) { toast('수량이 1이라 나눌 수 없습니다. 기본 수량을 늘리세요.', true); break; } var half = Math.ceil(lst3.count / 2); lst3.items.push({ id: uid(), kind: 'split', name: '', branches: [{ id: uid(), name: 'A', count: half, items: [] }, { id: uid(), name: 'B', count: lst3.count - half, items: [] }] }); rerender(); break; }
      case 'item-remove': { if (!f) break; syncFromDom(); var loc = locateItem(f.items, id); if (!loc) break; if (loc.node.kind === 'split' && S.countSteps([loc.node]) > 0) { if (!window.confirm('분기 안의 항목도 함께 빠집니다. 계속할까요?')) break; } loc.list.splice(loc.index, 1); rerender(); break; }
      case 'item-move': { if (!f) break; syncFromDom(); var lm = locateItem(f.items, id); if (!lm) break; var j = el.getAttribute('data-dir') === 'up' ? lm.index - 1 : lm.index + 1; if (j < 0 || j >= lm.list.length) break; var t = lm.list[lm.index]; lm.list[lm.index] = lm.list[j]; lm.list[j] = t; rerender(); break; }
      case 'item-params': { if (!f) break; syncFromDom(); var lp = locateItem(f.items, id); if (!lp) break; itemParamsDialog(lp.node).then(function (res) { if (res) rerender(); }).catch(handleError); break; }
      case 'branch-add': { if (!f) break; syncFromDom(); var ls = locateItem(f.items, id); if (!ls || ls.node.kind !== 'split') break; ls.node.branches.push({ id: uid(), name: String.fromCharCode(65 + ls.node.branches.length), count: 1, items: [] }); rerender(); break; }
      case 'branch-remove': { if (!f) break; syncFromDom(); var lb = locateItem(f.items, el.getAttribute('data-split')); if (!lb || lb.node.kind !== 'split') break; if (lb.node.branches.length <= 2) { toast('분기는 2개 이상이어야 합니다.', true); break; } var br = lb.node.branches.filter(function (b) { return b.id === id; })[0]; if (br && S.countSteps(br.items) > 0 && !window.confirm('분기 안의 항목도 함께 빠집니다. 계속할까요?')) break; lb.node.branches = lb.node.branches.filter(function (b) { return b.id !== id; }); rerender(); break; }
    }
  });
  window.addEventListener('hashchange', function () { readHash(); state.editModule = null; state.editFlow = null; render(); });

  store.init().then(function () { state.ready = true; readHash(); store.onChange(function () { reload().then(function () { if (!state.editModule && !state.editFlow) render(); }).catch(handleError); }); return refresh(); })
    .catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
