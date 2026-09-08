/* =====================================================================
   DSIL Run Sheet – 라이브러리: 분류(소자/패키징)별 공정 모듈 + 공정 흐름(행 × 분기 시트 템플릿)
   기본 제공(seed) 항목은 수정·삭제 불가(복사만). 내가 만든 항목만 수정·삭제. 해시: #tab=modules | #tab=flows
   흐름 편집기는 런시트와 같은 표(행 = 큰 스텝 · 대분류, 열 = 단위)에서 행·셀·분기점을 직접 고칩니다.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.DSIL_CONFIG || {};
  var U = window.DSILUI, P = window.DSILParams, S = window.DSILStore, SH = window.DSILSheet, SV = window.DSILSheetView;
  var esc = U.esc, $ = U.$, $all = U.$all, toast = U.toast, readForm = U.readForm, dialog = U.dialog, confirmDlg = U.confirmDlg, empty = U.empty;
  var store = S.create(CFG);
  var DOMAINS = CFG.domains || [];
  var CATS = CFG.categories || [];
  var state = { ready: false, error: null, tab: 'modules', domain: '', mineOnly: false, modules: [], flows: [], runs: [], editModule: null, editFlow: null, q: '' };

  function me() { return store.getMe(); }
  function modById(id) { return state.modules.filter(function (m) { return m.id === id; })[0] || null; }
  function flowById(id) { return state.flows.filter(function (f) { return f.id === id; })[0] || null; }
  function domainInfo(id) { return DOMAINS.filter(function (d) { return d.id === id; })[0] || { id: id, label: id || '-', short: id || '-' }; }
  function domainBadge(id) { return '<span class="badge ' + (id === 'package' ? 'bg-indigo-lt' : 'bg-blue-lt') + '">' + esc(domainInfo(id).short) + '</span>'; }
  function readHash() { var m = /tab=(\w+)/.exec(window.location.hash); state.tab = m && m[1] === 'flows' ? 'flows' : 'modules'; var d = /domain=(\w+)/.exec(window.location.hash); if (d) state.domain = d[1] === 'all' ? '' : d[1]; }
  function inDomain(x) { return !state.domain || x.domain === state.domain; }
  function canEditItem(x) { var m = me(); return !x.seed && !!m.id && (m.isAdmin || !x.ownerId || x.ownerId === m.id); }
  function isMine(x) { var m = me(); return !!m.id && x.ownerId === m.id; }
  function ownerBadge(x) { return x.seed ? '<span class="badge bg-secondary-lt" title="기본 제공: 수정·삭제 불가, 복사해서 쓰세요"><i class="ti ti-lock"></i> 기본</span>' : (isMine(x) ? '<span class="badge bg-green-lt">내 것</span>' : (x.ownerName ? '<span class="badge bg-secondary-lt">' + esc(x.ownerName) + '</span>' : '')); }
  function visible(list) { return list.filter(inDomain).filter(function (x) { return !state.mineOnly || isMine(x); }); }
  function usesModule(sheet, id) { return (sheet.rows || []).some(function (r) { return Object.keys(r.cells || {}).some(function (k) { return r.cells[k] && r.cells[k].moduleId === id; }); }); }
  function catSelect(name, value, allowFollow) { return '<select class="form-select" name="' + name + '">' + (allowFollow ? '<option value=""' + (!value ? ' selected' : '') + '>모듈 분류 따르기</option>' : '') + CATS.map(function (c) { return '<option value="' + c.id + '"' + (value === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select>'; }

  function reload() { return Promise.all([store.listModules(), store.listFlows(), store.listRuns({ scope: 'mine' })]).then(function (r) { state.modules = r[0]; state.flows = r[1]; state.runs = r[2]; }); }

  function moduleUsage(id) { return { flows: state.flows.filter(function (f) { return usesModule(f, id); }), runs: state.runs.filter(function (r) { return usesModule(r, id); }).length }; }
  function flowUsage(id) { return { runs: state.runs.filter(function (r) { return r.flowId === id; }).length }; }

  /* ---------- 렌더 ---------- */
  function renderChrome() {
    var slot = $('#user-slot'); if (!slot) return;
    var m = me();
    slot.innerHTML = m.id ? '<a href="../index.html" class="btn btn-sm"><span class="avatar avatar-xs ' + (m.isAdmin ? 'bg-primary text-white' : 'bg-blue-lt') + ' me-1">' + esc(m.name.charAt(0)) + '</span>' + esc(m.name) + (m.team ? ' <span class="text-secondary">· ' + esc(m.team) + '</span>' : '') + '</a>' : '';
  }
  function render() {
    var app = $('#app'); renderChrome(); if (!app) return;
    if (state.error) { app.innerHTML = '<div class="alert alert-danger"><h4 class="alert-title">오류</h4><div class="text-secondary">' + esc(state.error) + '</div></div>'; return; }
    if (!state.ready) { app.innerHTML = '<div class="text-secondary text-center py-5">불러오는 중…</div>'; return; }
    var mods = visible(state.modules), flows = visible(state.flows);
    var html = '<div class="d-flex flex-wrap align-items-center gap-2 mb-3"><div class="btn-group">' + [{ id: '', label: '전체' }].concat(DOMAINS).map(function (d) { return '<button type="button" class="btn' + (state.domain === d.id ? ' active btn-primary' : '') + '" data-action="domain" data-domain="' + d.id + '">' + (d.icon ? '<i class="ti ti-' + d.icon + ' me-1"></i>' : '') + esc(d.label) + '</button>'; }).join('') + '</div>'
      + '<label class="form-check mb-0 ms-2"><input class="form-check-input" type="checkbox" data-action="mine-only"' + (state.mineOnly ? ' checked' : '') + '><span class="form-check-label">내가 만든 것만</span></label>'
      + '<ul class="nav nav-tabs ms-md-3 mb-0 flex-fill"><li class="nav-item"><a class="nav-link' + (state.tab === 'modules' ? ' active' : '') + '" href="#tab=modules"><i class="ti ti-box me-1"></i>공정 모듈 <span class="badge bg-secondary-lt ms-1">' + mods.length + '</span></a></li><li class="nav-item"><a class="nav-link' + (state.tab === 'flows' ? ' active' : '') + '" href="#tab=flows"><i class="ti ti-git-branch me-1"></i>공정 흐름 <span class="badge bg-secondary-lt ms-1">' + flows.length + '</span></a></li></ul></div>';
    app.innerHTML = html + (state.tab === 'flows' ? renderFlows(flows) : renderModules(mods));
  }

  /* ---------- 모듈 ---------- */
  function renderModules(mods) {
    var q = state.q.trim().toLowerCase();
    var list = mods.filter(function (m) { return !q || [m.name, m.equipment, m.description, P.catInfo(m.category).label].join(' ').toLowerCase().indexOf(q) >= 0; });
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div class="text-secondary small">모듈은 한 번 정의해 여러 런시트에서 재사용하는 공정 단위입니다. <span class="badge bg-secondary-lt"><i class="ti ti-lock"></i> 기본</span> 항목은 수정·삭제할 수 없고 <i class="ti ti-copy"></i> 복사해서 내 것으로 만듭니다.</div>'
      + '<div class="d-flex gap-2"><input type="search" class="form-control form-control-sm" id="mod-q" placeholder="검색" value="' + esc(state.q) + '" style="width:12rem"><button type="button" class="btn btn-sm btn-primary" data-action="mod-new"><i class="ti ti-plus me-1"></i>모듈 추가</button></div></div>';
    if (state.editModule) html += moduleEditor(state.editModule);
    if (!list.length) return html + '<div class="card">' + empty('box-off', '모듈이 없습니다', state.mineOnly ? '기본 모듈을 복사하거나 "모듈 추가"로 만드세요.' : '"모듈 추가"로 첫 공정 모듈을 만드세요.') + '</div>';
    var cats = CATS.map(function (c) { return c.id; }), doms = DOMAINS.map(function (d) { return d.id; });
    list.sort(function (a, b) { var da = doms.indexOf(a.domain), db = doms.indexOf(b.domain); if (da !== db) return da - db; var ca = cats.indexOf(a.category), cb = cats.indexOf(b.category); return ca !== cb ? ca - cb : a.name.localeCompare(b.name, 'ko'); });
    html += '<div class="card"><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>모듈</th><th class="w-1">분류</th><th>장비</th><th>조건 항목</th><th class="w-1">출처</th><th class="w-1"></th></tr></thead><tbody>'
      + list.map(function (m) {
        var ed = canEditItem(m);
        return '<tr' + (m.active === false ? ' class="text-secondary"' : '') + '><td><div class="fw-medium">' + esc(m.name) + (m.active === false ? ' <span class="badge bg-secondary-lt">비활성</span>' : '') + '</div>' + (m.description ? '<div class="small text-secondary">' + esc(m.description) + '</div>' : '') + '</td><td class="text-nowrap">' + domainBadge(m.domain) + ' ' + P.catBadge(m.category) + '</td><td class="small">' + esc(m.equipment || '-') + '</td>'
          + '<td class="small">' + (m.fields.length ? m.fields.map(function (f) { return esc(f.label) + (f.unit ? '(' + esc(f.unit) + ')' : '') + (f.required ? '*' : ''); }).join(', ') : '<span class="text-secondary">없음</span>') + (m.checklist.length ? '<div class="text-secondary">확인 ' + m.checklist.length + '항목</div>' : '') + '</td>'
          + '<td class="text-nowrap">' + ownerBadge(m) + '</td>'
          + '<td class="text-end text-nowrap"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="mod-copy" data-id="' + esc(m.id) + '" title="복사해서 내 모듈로"><i class="ti ti-copy"></i></button>' + (ed ? '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="mod-edit" data-id="' + esc(m.id) + '" title="수정"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="mod-delete" data-id="' + esc(m.id) + '" title="삭제"><i class="ti ti-trash"></i></button>' : '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="mod-view" data-id="' + esc(m.id) + '" title="보기"><i class="ti ti-eye"></i></button>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }
  function moduleEditor(m) {
    var isNew = !m.id, view = !!m._view;
    return '<div class="card mb-3 border-primary" id="mod-form-card"><div class="card-header"><h3 class="card-title">' + (view ? '모듈 보기: ' + esc(m.name) + ' <span class="text-secondary fw-normal small">(수정하려면 복사)</span>' : isNew ? '모듈 추가' : '모듈 수정: ' + esc(m.name)) + '</h3></div><div class="card-body"><form id="module-form"><fieldset' + (view ? ' disabled' : '') + '>'
      + '<input type="hidden" name="modId" value="' + esc(m.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-3"><label class="form-label required">공정 분류</label><select class="form-select" name="domain">' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + ((m.domain || state.domain || DOMAINS[0].id) === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-4"><label class="form-label required">모듈 이름</label><input type="text" class="form-control" name="name" required value="' + esc(m.name || '') + '" autocomplete="off" placeholder="예: ALD 유전막"></div>'
      + '<div class="col-md-3"><label class="form-label">세부 분류 <span class="form-label-description">행의 대분류 기본값</span></label><select class="form-select" name="category">' + CATS.map(function (c) { return '<option value="' + c.id + '"' + ((m.category || 'etc') === c.id ? ' selected' : '') + '>' + esc(c.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-2"><label class="form-label">예상 시간(분)</label><input type="number" class="form-control" name="minutes" min="0" value="' + esc(m.minutes || '') + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-4"><label class="form-label">장비</label><input type="text" class="form-control" name="equipment" value="' + esc(m.equipment || '') + '" autocomplete="off"></div><div class="col-md-8"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="' + esc(m.description || '') + '" autocomplete="off"></div></div>'
      + '<div class="mt-2"><label class="form-label">확인 사항 <span class="form-label-description">한 줄에 하나, 기록 창에 체크리스트로 표시</span></label><textarea class="form-control" name="checklist" rows="2">' + esc((m.checklist || []).join('\n')) + '</textarea></div>'
      + (isNew || view ? '' : '<label class="form-check mt-3"><input class="form-check-input" type="checkbox" name="active"' + (m.active !== false ? ' checked' : '') + '><span class="form-check-label">사용 중 (끄면 새 흐름·행 추가 목록에서 숨김)</span></label>')
      + '<div class="d-flex align-items-center justify-content-between mt-4 mb-1"><div class="subheader mb-0">조건 항목 <span class="text-secondary fw-normal text-lowercase">런시트에서 계획값·실제값을 적는 칸</span></div>' + (view ? '' : '<button type="button" class="btn btn-sm" data-action="field-add"><i class="ti ti-plus me-1"></i>항목</button>') + '</div>'
      + '<div class="text-secondary small mb-2">이름 · 종류 · 단위 · 선택지(선택 종류) · 기본값(계획값으로 들어감) · 필수. 저장 키는 유지되므로 이름을 바꿔도 지난 기록과 연결됩니다.</div>'
      + '<div id="field-rows">' + (m.fields || []).map(P.fieldRowHtml).join('') + '</div></fieldset>'
      + '<div class="mt-4 d-flex gap-2">' + (view ? '<button type="button" class="btn btn-primary" data-action="mod-copy" data-id="' + esc(m.id) + '"><i class="ti ti-copy me-1"></i>복사해서 내 모듈로</button>' : '<button type="submit" class="btn btn-primary">' + (isNew ? '추가' : '저장') + '</button>') + '<button type="button" class="btn" data-action="mod-cancel">' + (view ? '닫기' : '취소') + '</button></div></form></div></div>';
  }

  /* ---------- 흐름 ---------- */
  function renderFlows(flows) {
    var html = '<div class="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-3"><div class="text-secondary small">흐름은 런시트 템플릿입니다. 런을 만들 때 복사해 시작하거나, 런시트 편집에서 통째로 불러옵니다. 행은 <b>큰 스텝(대분류)</b>이고, <b>분기점</b>은 행 범위에 걸쳐 수량을 나눕니다. 분기 구간에서도 행은 맞춰지며, 셀을 비우면 그 분기는 그 행을 건너뜁니다.</div>'
      + '<button type="button" class="btn btn-sm btn-primary" data-action="flow-new"><i class="ti ti-plus me-1"></i>흐름 추가</button></div>';
    if (state.editFlow) html += flowEditor(state.editFlow);
    if (!flows.length) return html + '<div class="card">' + empty('git-branch', '흐름이 없습니다', state.mineOnly ? '기본 흐름을 복사하거나 "흐름 추가"로 만드세요.' : '"흐름 추가"에서 모듈을 행으로 넣으세요.') + '</div>';
    html += '<div class="card"><div class="table-responsive"><table class="table table-vcenter card-table"><thead><tr><th>흐름</th><th>구성 (행)</th><th class="w-1">스텝</th><th class="w-1">수량</th><th class="w-1">출처</th><th class="w-1"></th></tr></thead><tbody>'
      + flows.map(function (f) {
        var st = SH.stats(f), ed = canEditItem(f), err = null; try { SH.validate(f, f.unitLabel); } catch (e) { err = e.message; }
        return '<tr><td><div class="fw-medium">' + domainBadge(f.domain) + ' ' + esc(f.name) + '</div>' + (f.device ? '<div class="small text-primary">' + esc(f.device) + '</div>' : '') + (f.description ? '<div class="small text-secondary">' + esc(f.description) + '</div>' : '') + '</td>'
          + '<td class="small">' + rowChips(f) + '</td>'
          + '<td class="text-nowrap tnum">' + st.rows + '행 · ' + st.cells + (st.splits ? ' <span class="badge bg-purple-lt" title="분기점">분기 ' + st.splits + '</span>' : '') + (err ? ' <span class="text-red" title="' + esc(err) + '">!</span>' : '') + '</td><td class="text-nowrap small">' + esc(f.unitLabel) + ' ' + f.unitCount + '</td>'
          + '<td class="text-nowrap">' + ownerBadge(f) + '</td>'
          + '<td class="text-end text-nowrap"><a href="../index.html?new=' + encodeURIComponent(f.id) + '" class="btn btn-sm btn-primary me-1" title="이 흐름을 복사해 새 런 시작"><i class="ti ti-player-play me-1"></i>런 시작</a><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="flow-copy" data-id="' + esc(f.id) + '" title="복사해서 내 흐름으로"><i class="ti ti-copy"></i></button>' + (ed ? '<button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="flow-edit" data-id="' + esc(f.id) + '" title="수정"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="flow-delete" data-id="' + esc(f.id) + '" title="삭제"><i class="ti ti-trash"></i></button>' : '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="flow-view" data-id="' + esc(f.id) + '" title="보기"><i class="ti ti-eye"></i></button>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return html;
  }
  function rowChips(f) {
    var splitAt = {}; (f.splits || []).forEach(function (s) { splitAt[s.fromRowId] = (splitAt[s.fromRowId] || []).concat([s]); });
    return f.rows.map(function (r, i) {
      var c = P.catInfo(r.category);
      return (splitAt[r.id] || []).map(function (s) { return '<span class="badge bg-purple text-white me-1 mb-1"><i class="ti ti-git-branch"></i> ' + esc(s.name || '분기') + ': ' + s.branches.map(function (b) { return esc(b.name) + '(' + b.count + ')'; }).join(' / ') + '</span>'; }).join('')
        + '<span class="badge bg-' + c.color + '-lt me-1 mb-1" title="' + esc(c.label) + '">' + (i + 1) + '. ' + esc(r.name || '?') + '</span>';
    }).join('');
  }

  /* ----- 흐름 편집기 (시트 표) ----- */
  function cellRefHtml(c, leaf, row, i) {
    var f = state.editFlow, mod = modById(c.moduleId), view = !!f._view;
    var html = '<div><b>' + esc(c.label || (mod ? mod.name : '(삭제된 모듈)')) + '</b>' + (c.label && mod ? ' <span class="small text-secondary">' + esc(mod.name) + '</span>' : '') + (mod && mod.domain !== f.domain ? ' ' + domainBadge(mod.domain) : '') + '</div>'
      + (mod && mod.equipment ? '<div class="small text-secondary">' + esc(mod.equipment) + '</div>' : '')
      + (mod && Object.keys(c.params || {}).length ? '<div class="small text-primary"><i class="ti ti-adjustments"></i> ' + esc(P.text(mod.fields, c.params, ' · ')) + '</div>' : '')
      + (c.note ? '<div class="small text-secondary">' + esc(c.note) + '</div>' : '');
    if (!view) html += '<div class="d-flex gap-1 mt-1"><button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="fe-cell-params" data-id="' + esc(c.id) + '" title="계획 조건 · 표시 이름"><i class="ti ti-adjustments"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="fe-cell-clear" data-row="' + esc(row.id) + '" data-leaf="' + esc(leaf.id) + '" title="이 칸 비우기 (이 분기는 이 행을 건너뜀)"><i class="ti ti-x"></i></button></div>';
    return html;
  }
  function editorTable(f) {
    var view = !!f._view;
    return SV.table(f, { unitLabel: f.unitLabel, tableClass: 'table table-bordered split-table sheet-editor',
      rowHead: function (row, i) {
        var html = '<div class="d-flex gap-2 align-items-start"><span class="step-num">' + (i + 1) + '</span><div class="flex-fill min-w-0"><div class="fw-bold row-name">' + esc(row.name || '(이름 없음)') + '</div><div>' + P.catBadge(row.category) + '</div>' + (row.note ? '<div class="small text-secondary"><i class="ti ti-note"></i> ' + esc(row.note) + '</div>' : '') + '</div></div>';
        if (!view) html += '<div class="d-flex flex-wrap gap-1 mt-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="fe-row-insert" data-index="' + i + '" title="이 앞에 행"><i class="ti ti-row-insert-top"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="fe-row-move" data-id="' + esc(row.id) + '" data-dir="up"' + (i === 0 ? ' disabled' : '') + '><i class="ti ti-chevron-up"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="fe-row-move" data-id="' + esc(row.id) + '" data-dir="down"' + (i === f.rows.length - 1 ? ' disabled' : '') + '><i class="ti ti-chevron-down"></i></button><button type="button" class="btn btn-sm btn-ghost-primary btn-icon" data-action="fe-row-edit" data-id="' + esc(row.id) + '" title="대분류·이름·메모"><i class="ti ti-pencil"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon text-purple" data-action="fe-split-add" data-row="' + esc(row.id) + '" title="이 행부터 분기점"' + (f.unitCount < 2 ? ' disabled' : '') + '><i class="ti ti-git-branch"></i></button>' + (canCloseAt(f, i) ? '<button type="button" class="btn btn-sm btn-ghost-secondary btn-icon text-primary" data-action="fe-split-close" data-row="' + esc(row.id) + '" title="이 행부터 공통 (앞 행에서 분기 합침)"><i class="ti ti-arrows-join"></i></button>' : '') + '<button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="fe-row-remove" data-id="' + esc(row.id) + '" title="행 삭제"><i class="ti ti-x"></i></button></div>';
        return html;
      },
      cell: cellRefHtml,
      skip: function (leaf, row) { return '<div class="cell-skip-text"><i class="ti ti-arrow-narrow-down"></i> 건너뜀</div>' + (view ? '' : '<button type="button" class="btn btn-sm mt-1" data-action="fe-cell-set" data-row="' + esc(row.id) + '" data-leaf="' + esc(leaf.id) + '"><i class="ti ti-plus me-1"></i>모듈</button>'); },
      head: function (leaf, split) { return '<div class="d-flex justify-content-between align-items-center gap-1 flex-wrap"><div><i class="ti ti-git-branch me-1"></i><b>' + esc(leaf.name) + '</b> <span class="small">' + leaf.count + ' ' + esc(f.unitLabel) + '</span></div>' + (view ? '' : '<span class="d-flex gap-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="fe-split-edit" data-id="' + esc(split.id) + '" title="분기 수정"><i class="ti ti-adjustments"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="fe-split-remove" data-id="' + esc(split.id) + '" title="분기점 삭제"><i class="ti ti-x"></i></button></span>') + '</div>'; },
      merge: function () { return '<i class="ti ti-arrows-join"></i> 합침'; },
      splitLabel: function (sp) { var r = SH.range(f, sp); return '<i class="ti ti-git-branch text-purple"></i> <b>' + esc(sp.name || '분기점') + '</b><div class="small text-secondary">' + (r.from + 1) + '~' + (sp.toRowId ? (r.to + 1) : '끝') + '행</div>'; },
      mergeLabel: function (sp) { return '<i class="ti ti-arrows-join text-primary"></i> <b>' + esc(sp.name || '분기') + '</b> 끝'; } });
  }
  function addBar(f) {
    var dom = f.domain || DOMAINS[0].id;
    var mods = state.modules.filter(function (m) { return m.active !== false; });
    var domOrder = DOMAINS.filter(function (d) { return d.id === dom; }).concat(DOMAINS.filter(function (d) { return d.id !== dom; }));
    var modOpts = domOrder.map(function (d) { var inD = mods.filter(function (m) { return m.domain === d.id; }); if (!inD.length) return ''; return CATS.map(function (c) { var ms = inD.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc((d.id === dom ? '' : d.short + ' · ') + c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('') + '</optgroup>' : ''; }).join(''); }).join('');
    var pool = state.flows.filter(function (x) { return x.id !== f.id && x.active !== false; });
    var flowOpts = pool.filter(function (x) { return x.domain === dom; }).concat(pool.filter(function (x) { return x.domain !== dom; })).map(function (x) { var st = SH.stats(x); return '<option value="' + esc(x.id) + '">' + (x.domain !== dom ? '[' + esc(domainInfo(x.domain).short) + '] ' : '') + esc(x.name) + ' (' + st.rows + '행' + (st.splits ? ' · 분기 ' + st.splits + ' · ' + esc(x.unitLabel) + ' ' + x.unitCount : '') + ')</option>'; }).join('');
    return '<div class="add-bar row g-2 align-items-end mt-2"><div class="col-md-5"><div class="input-group input-group-sm"><span class="input-group-text">모듈 → 행</span><select class="form-select" id="fe-am">' + modOpts + '</select><button type="button" class="btn" data-action="fe-add-module" title="끝에 행 추가 (모든 분기에 같은 셀)"><i class="ti ti-plus"></i></button><button type="button" class="btn" data-action="fe-row-insert" data-index="end" title="대분류·이름·분기 지정해서 추가"><i class="ti ti-adjustments"></i></button></div></div>'
      + '<div class="col-md-5"><div class="input-group input-group-sm"><span class="input-group-text">흐름 이어 붙이기</span><select class="form-select" id="fe-af"' + (flowOpts ? '' : ' disabled') + '>' + (flowOpts || '<option value="">넣을 수 있는 흐름 없음</option>') + '</select><button type="button" class="btn" data-action="fe-add-flow"' + (flowOpts ? '' : ' disabled') + '><i class="ti ti-plus"></i></button></div></div>'
      + '<div class="col-md-2"><button type="button" class="btn btn-sm w-100" data-action="fe-split-add"' + (f.unitCount < 2 ? ' disabled title="수량이 1이라 나눌 수 없습니다"' : '') + '><i class="ti ti-git-branch me-1"></i>분기점</button></div></div>';
  }
  function flowEditor(f) {
    var isNew = !f.id, view = !!f._view, err = null, st = SH.stats(f);
    try { SH.validate(f, f.unitLabel); } catch (e) { err = e.message; }
    return '<div class="card mb-3 border-primary" id="flow-form-card"><div class="card-header"><h3 class="card-title">' + (view ? '흐름 보기: ' + esc(f.name) + ' <span class="text-secondary fw-normal small">(수정하려면 복사)</span>' : isNew ? '흐름 추가' : '흐름 수정: ' + esc(f.name)) + '</h3></div><div class="card-body"><form id="flow-form"><fieldset' + (view ? ' disabled' : '') + '>'
      + '<input type="hidden" name="flowId" value="' + esc(f.id || '') + '">'
      + '<div class="row g-2"><div class="col-md-3"><label class="form-label required">공정 분류</label><select class="form-select" name="domain">' + DOMAINS.map(function (d) { return '<option value="' + d.id + '"' + ((f.domain || state.domain || DOMAINS[0].id) === d.id ? ' selected' : '') + '>' + esc(d.label) + '</option>'; }).join('') + '</select></div>'
      + '<div class="col-md-5"><label class="form-label required">흐름 이름</label><input type="text" class="form-control" name="name" required value="' + esc(f.name || '') + '" autocomplete="off" placeholder="예: MoS2 백게이트 FET"></div>'
      + '<div class="col-md-4"><label class="form-label">소자 · 대상</label><input type="text" class="form-control" name="device" value="' + esc(f.device || '') + '" autocomplete="off"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-6"><label class="form-label">설명</label><input type="text" class="form-control" name="description" value="' + esc(f.description || '') + '" autocomplete="off"></div>'
      + '<div class="col-6 col-md-3"><label class="form-label">단위</label><select class="form-select" name="unitLabel">' + (CFG.unitLabels || []).map(function (u) { return '<option value="' + esc(u) + '"' + ((f.unitLabel || '기판') === u ? ' selected' : '') + '>' + esc(u) + '</option>'; }).join('') + ((CFG.unitLabels || []).indexOf(f.unitLabel || '기판') < 0 ? '<option value="' + esc(f.unitLabel) + '" selected>' + esc(f.unitLabel) + '</option>' : '') + '</select></div>'
      + '<div class="col-6 col-md-3"><label class="form-label required">기본 수량 <span class="form-label-description">런에서 바꿀 수 있음</span></label><input type="number" class="form-control" name="unitCount" min="1" required value="' + (f.unitCount || 1) + '"' + ((f.splits || []).length ? ' title="분기점이 있으면 분기 수량 합과 맞아야 합니다"' : '') + '></div></div></fieldset>'
      + '<div class="d-flex flex-wrap align-items-center gap-2 mt-3 mb-1"><div class="subheader mb-0">런시트 (행 = 큰 스텝 · 대분류, 열 = ' + esc(f.unitLabel || '기판') + ')</div><span class="text-secondary small">' + st.rows + '행 · ' + st.cells + '스텝' + (st.splits ? ' · 분기점 ' + st.splits + '개' : '') + '</span></div>'
      + (err ? '<div class="alert alert-warning py-2 px-3 small">' + esc(err) + '</div>' : '')
      + (f.rows.length ? '<div class="table-responsive">' + editorTable(f) + '</div>' : '<div class="text-secondary small py-2">아래에서 모듈을 행으로 추가하거나 흐름을 이어 붙이세요.</div>')
      + (view ? '' : addBar(f))
      + '<div class="mt-4 d-flex gap-2">' + (view ? '<button type="button" class="btn btn-primary" data-action="flow-copy" data-id="' + esc(f.id) + '"><i class="ti ti-copy me-1"></i>복사해서 내 흐름으로</button>' : '<button type="submit" class="btn btn-primary"' + (err ? ' disabled' : '') + '>' + (isNew ? '추가' : '저장') + '</button>') + '<button type="button" class="btn" data-action="flow-cancel">' + (view ? '닫기' : '취소') + '</button></div></form></div></div>';
  }
  function syncFromDom() {
    var f = state.editFlow, form = $('#flow-form'); if (!f || !form || f._view) return;
    var v = readForm(form); f.domain = v.domain; f.name = v.name; f.device = v.device; f.description = v.description; f.unitLabel = v.unitLabel; f.unitCount = Math.max(1, Math.round(Number(v.unitCount)) || 1);
  }
  function rerender() { var card = $('#flow-form-card'); if (!card) return; var tmp = document.createElement('div'); tmp.innerHTML = flowEditor(state.editFlow); card.replaceWith(tmp.firstElementChild); }
  /* 편집 연산: 사본에서 실행, 성공하면 반영 */
  function mutate(fn) {
    syncFromDom();
    var work = SH.clone(state.editFlow);
    fn(work);
    state.editFlow = work; rerender(); return true;
  }
  function tryMutate(fn) { try { return mutate(fn); } catch (e) { toast(e.message, true); return false; } }
  function canCloseAt(sheet, i) { return (sheet.splits || []).some(function (s) { var rg = SH.range(sheet, s); return rg.from < i && i <= rg.to; }); }
  function moduleOptions(domain, showAll) {
    var mods = state.modules.filter(function (m) { return m.active !== false && (showAll || m.domain === domain); });
    var html = CATS.map(function (c) { var ms = mods.filter(function (m) { return m.category === c.id; }); return ms.length ? '<optgroup label="' + esc(c.label) + '">' + ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + (m.domain !== domain ? ' [' + esc(domainInfo(m.domain).short) + ']' : '') + '</option>'; }).join('') + '</optgroup>' : ''; }).join('');
    return { html: html, mods: mods };
  }
  function moduleBlock(domain, preModule) {
    var opt = moduleOptions(domain, false), optAll = moduleOptions(domain, true);
    return '<div class="d-flex align-items-end gap-2"><div class="flex-fill"><label class="form-label required">모듈</label><select class="form-select" name="moduleId" required>' + (preModule ? opt.html.replace('value="' + preModule + '"', 'value="' + preModule + '" selected') : opt.html) + '</select></div><label class="form-check mb-2 text-nowrap"><input class="form-check-input" type="checkbox" name="showAll"><span class="form-check-label">다른 분류도</span></label></div>'
      + '<div data-show-if="showAll=true"><label class="form-label">모든 분류의 모듈</label><select class="form-select" name="moduleIdAll">' + optAll.html + '</select></div>'
      + '<div class="mt-2"><label class="form-label">표시 이름 <span class="form-label-description">비우면 모듈 이름</span></label><input type="text" class="form-control" name="cellLabel" autocomplete="off"></div>'
      + optAll.mods.map(function (m) { return '<div data-show-if="moduleId=' + esc(m.id) + '" class="mt-2 param-block"><div class="subheader mb-1">계획 조건 <span class="text-secondary fw-normal">기본값과 다른 값만 저장</span></div>' + P.inputs(m.fields, S.defaults(m.fields), { optional: true }) + '</div>'; }).join('');
  }
  function paramsDiff(mod, vals) {
    var d = S.defaults(mod.fields), diff = {};
    mod.fields.forEach(function (fd) { var x = vals[fd.key]; if (x === undefined) return; if (fd.type === 'check') { if (!!x !== !!d[fd.key]) diff[fd.key] = !!x; return; } if (String(x) === '') { if (d[fd.key] !== undefined) diff[fd.key] = ''; return; } if (String(x) !== String(d[fd.key] === undefined ? '' : d[fd.key])) diff[fd.key] = fd.type === 'number' && !isNaN(Number(x)) ? Number(x) : x; });
    return diff;
  }
  function readModuleSpec(v) { var id = v.showAll && v.moduleIdAll ? v.moduleIdAll : v.moduleId, mod = modById(id); if (!mod) throw new Error('모듈을 고르세요.'); return { moduleId: id, label: v.cellLabel, params: paramsDiff(mod, P.read(mod.fields, v)), mod: mod }; }
  function rowInsertDialog(index, preModule) {
    var f = state.editFlow, atEnd = index >= f.rows.length, leaves = SH.leavesIfInserted(f, index);
    var body = '<div class="text-secondary small mb-2"><i class="ti ti-map-pin me-1"></i>위치: ' + (atEnd ? '끝' : (index + 1) + '행 앞') + (leaves.length > 1 ? ' · 분기 구간 (' + leaves.map(function (l) { return esc(l.name); }).join(' / ') + ')' : ' · 공통 구간') + '</div>'
      + '<div class="row g-2"><div class="col-md-4"><label class="form-label">대분류</label>' + catSelect('category', '', true) + '</div><div class="col-md-8"><label class="form-label">행 이름 <span class="form-label-description">비우면 모듈 이름</span></label><input type="text" class="form-control" name="rowName" autocomplete="off"></div></div>'
      + (leaves.length > 1 ? '<div class="mt-2"><label class="form-label">어느 분기에</label><select class="form-select" name="target">' + (atEnd ? '<option value="__common">공통 행 — 열린 분기점을 이 행 앞에서 합치고 여기서부터 다시 공통</option>' : '') + '<option value="__all">모든 분기 (같은 셀을 분기마다)</option>' + leaves.map(function (l) { return '<option value="' + esc(l.id) + '">' + SV.leafLabel(l, f.unitLabel) + ' 에만 (다른 분기는 건너뜀)</option>'; }).join('') + '</select></div>' : '')
      + '<div class="mt-2">' + moduleBlock(f.domain, preModule) + '</div><div class="mt-2"><label class="form-label">행 메모</label><input type="text" class="form-control" name="note" autocomplete="off"></div>';
    return dialog({ title: '행 추가', bodyHtml: body, okLabel: '추가', size: 'lg', submit: function (v) {
      var spec = readModuleSpec(v), cells = {}; cells[v.target && v.target !== '__all' && v.target !== '__common' ? v.target : 'all'] = spec;
      return mutate(function (w) { if (atEnd && (!v.target || v.target === '__common')) SH.closeOpenSplits(w); SH.rowInsert(w, atEnd ? w.rows.length : index, { category: v.category || spec.mod.category, name: v.rowName || spec.label || spec.mod.name, note: v.note, cells: cells }, S.refCell); SH.validate(w, w.unitLabel); });
    } });
  }
  function cellSetDialog(rowId, leafId) {
    var f = state.editFlow, row = SH.rowById(f, rowId), i = SH.idx(f, rowId), leaf = SH.leavesAt(f, i).filter(function (l) { return l.id === leafId; })[0];
    return dialog({ title: '이 분기의 셀 채우기', bodyHtml: '<div class="text-secondary small mb-2">' + (i + 1) + '행 "' + esc(row.name) + '" · ' + (leaf ? SV.leafLabel(leaf, f.unitLabel) : '') + '</div>' + moduleBlock(f.domain, ''), okLabel: '넣기', size: 'lg', submit: function (v) {
      var spec = readModuleSpec(v);
      return mutate(function (w) { SH.cellSet(w, rowId, leafId, spec, S.refCell); });
    } });
  }
  function cellParamsDialog(cellId) {
    var f = state.editFlow, at = SH.findCell(f, cellId); if (!at) return Promise.resolve(false);
    var c = at.cell, mod = modById(c.moduleId); if (!mod) { toast('모듈을 찾을 수 없습니다.', true); return Promise.resolve(false); }
    var body = '<div class="text-secondary small mb-2">' + (at.index + 1) + '행 "' + esc(at.row.name) + '"' + (at.leaf.path.length ? ' · <span class="step-group">' + esc(at.leaf.path.join(' › ')) + '</span>' : '') + ' · ' + esc(mod.name) + '. 모듈 기본값과 다른 값만 저장됩니다.</div>'
      + '<div class="row g-2"><div class="col-md-6"><label class="form-label">표시 이름 <span class="form-label-description">비우면 모듈 이름</span></label><input type="text" class="form-control" name="label" value="' + esc(c.label || '') + '" autocomplete="off"></div><div class="col-md-6"><label class="form-label">메모</label><input type="text" class="form-control" name="note" value="' + esc(c.note || '') + '" autocomplete="off"></div></div>'
      + '<div class="subheader mt-3 mb-1">계획 조건</div>' + P.inputs(mod.fields, Object.assign({}, S.defaults(mod.fields), c.params || {}), { optional: true });
    return dialog({ title: '셀 조건 · ' + (c.label || mod.name), bodyHtml: body, okLabel: '적용', size: 'lg', submit: function (v) {
      return mutate(function (w) { var x = SH.findCell(w, cellId); x.cell.label = v.label; x.cell.note = v.note; x.cell.params = paramsDiff(mod, P.read(mod.fields, v)); });
    } });
  }
  function rowEditDialog(rowId) {
    var f = state.editFlow, row = SH.rowById(f, rowId);
    var body = '<div class="row g-2"><div class="col-md-4"><label class="form-label required">대분류</label>' + catSelect('category', row.category, false) + '</div><div class="col-md-8"><label class="form-label required">행 이름</label><input type="text" class="form-control" name="name" required value="' + esc(row.name) + '" autocomplete="off"></div></div><div class="mt-2"><label class="form-label">메모</label><input type="text" class="form-control" name="note" value="' + esc(row.note) + '" autocomplete="off"></div>';
    return dialog({ title: '행 수정 · ' + (SH.idx(f, rowId) + 1) + '. ' + row.name, bodyHtml: body, okLabel: '저장', size: 'md', submit: function (v) { return mutate(function (w) { SH.rowEdit(w, rowId, v); }); } });
  }
  function splitAddDialog(preRowId) {
    var f = state.editFlow;
    return dialog({ title: '분기점 추가', bodyHtml: SV.splitAddBody(f, f.unitLabel, preRowId), okLabel: '분기점 만들기', size: 'md', submit: function (v) { return mutate(function (w) { SH.splitAdd(w, Object.assign({ unitLabel: w.unitLabel }, SV.readSplitAdd(v)), S.cloneRef, S.always); }); } });
  }
  function splitEditDialog(splitId) {
    var f = state.editFlow, sp = SH.splitById(f, splitId);
    return dialog({ title: '분기 수정 · ' + (sp.name || '분기점'), bodyHtml: SV.splitEditBody(f, sp, f.unitLabel), okLabel: '저장', size: 'md', submit: function (v) { return mutate(function (w) { SH.splitEdit(w, splitId, Object.assign({ unitLabel: w.unitLabel }, SV.readSplitEdit(v)), S.cloneRef, S.always, S.always); }); } });
  }
  function copyOf(src, kind) { var cp = JSON.parse(JSON.stringify(src)); delete cp.id; delete cp.createdAt; delete cp.seed; delete cp.ownerId; delete cp.ownerName; delete cp._view; cp.name = src.name + ' (복사)'; if (kind === 'flow') SH.reid(cp); return cp; }

  /* ---------- 이벤트 ---------- */
  function handleError(err) { console.error(err); toast(err && err.message ? err.message : String(err), true); }
  function refresh() { return reload().then(render).catch(handleError); }
  function scrollTo(sel) { var el = $(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  document.addEventListener('input', function (e) {
    if (e.target.id === 'mod-q') { state.q = e.target.value; render(); var q = $('#mod-q'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } return; }
    if (e.target.closest('#flow-form') && e.target.name === 'unitCount') { syncFromDom(); rerender(); var inp = $('#flow-form [name="unitCount"]'); if (inp) inp.focus(); }
  });
  document.addEventListener('change', function (e) {
    if (e.target.closest('#flow-form') && (e.target.name === 'domain' || e.target.name === 'unitLabel')) { syncFromDom(); rerender(); return; }
    if (e.target.getAttribute('data-action') === 'mine-only') { state.mineOnly = e.target.checked; state.editModule = null; state.editFlow = null; render(); }
  });
  document.addEventListener('submit', function (e) {
    var fid = e.target.getAttribute && e.target.getAttribute('id');
    if (fid === 'module-form') {
      e.preventDefault();
      var v = readForm(e.target);
      var m = { id: v.modId || undefined, domain: v.domain, name: v.name, category: v.category, equipment: v.equipment, minutes: v.minutes, description: v.description, checklist: v.checklist, fields: P.readFieldRows(e.target) };
      if ('active' in v) m.active = !!v.active;
      store.saveModule(m).then(function (saved) { toast('모듈 "' + saved.name + '" 을 저장했습니다.'); state.editModule = null; return refresh(); }).catch(handleError);
    }
    if (fid === 'flow-form') {
      e.preventDefault();
      syncFromDom();
      var f = state.editFlow;
      store.saveFlow({ id: f.id || undefined, domain: f.domain, name: f.name, device: f.device, description: f.description, unitLabel: f.unitLabel, unitCount: f.unitCount, rows: f.rows, splits: f.splits })
        .then(function (saved) { toast('흐름 "' + saved.name + '" 을 저장했습니다.'); state.editFlow = null; return refresh(); }).catch(handleError);
    }
  });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]'); if (!el) return;
    var action = el.getAttribute('data-action'), id = el.getAttribute('data-id'), f = state.editFlow;
    switch (action) {
      case 'domain': state.domain = el.getAttribute('data-domain') || ''; state.editModule = null; state.editFlow = null; render(); break;
      case 'mod-new': state.editModule = { fields: [], checklist: [], domain: state.domain || DOMAINS[0].id }; render(); scrollTo('#mod-form-card'); break;
      case 'mod-edit': state.editModule = JSON.parse(JSON.stringify(modById(id))); render(); scrollTo('#mod-form-card'); break;
      case 'mod-view': state.editModule = Object.assign(JSON.parse(JSON.stringify(modById(id))), { _view: true }); render(); scrollTo('#mod-form-card'); break;
      case 'mod-copy': { var src = modById(id); if (!src) break; state.editModule = copyOf(src, 'module'); render(); scrollTo('#mod-form-card'); toast('복사본을 편집 중입니다. 저장하면 내 모듈이 됩니다.'); break; }
      case 'mod-cancel': state.editModule = null; render(); break;
      case 'mod-delete': { var md = modById(id); if (!md) break; var mu = moduleUsage(id); confirmDlg({ title: '모듈 삭제', message: '"' + md.name + '" 모듈을 삭제할까요?' + (mu.flows.length || mu.runs ? ' 흐름 ' + mu.flows.length + '개 · 런 ' + mu.runs + '개에서 쓰고 있어 삭제 대신 비활성화됩니다.' : ''), okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteModule(id).then(function (r) { toast(r && r.deactivated ? '사용 중이라 비활성화했습니다.' : '삭제했습니다.'); return refresh(); }); }).catch(handleError); break; }
      case 'field-add': { var rows = $('#field-rows'); if (rows) { rows.insertAdjacentHTML('beforeend', P.fieldRowHtml({})); var last = rows.lastElementChild.querySelector('[data-f="label"]'); if (last) last.focus(); } break; }
      case 'field-remove': { var fr = el.closest('[data-row]'); if (fr) fr.remove(); break; }
      case 'field-up': case 'field-down': { var row = el.closest('[data-row]'); if (!row) break; if (action === 'field-up' && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling); if (action === 'field-down' && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row); break; }
      case 'flow-new': state.editFlow = { rows: [], splits: [], domain: state.domain || DOMAINS[0].id, unitLabel: '기판', unitCount: 1 }; render(); scrollTo('#flow-form-card'); break;
      case 'flow-edit': { var fe = flowById(id); if (!fe) break; state.editFlow = JSON.parse(JSON.stringify(fe)); render(); scrollTo('#flow-form-card'); break; }
      case 'flow-view': { var fv = flowById(id); if (!fv) break; state.editFlow = Object.assign(JSON.parse(JSON.stringify(fv)), { _view: true }); render(); scrollTo('#flow-form-card'); break; }
      case 'flow-copy': { var fs = flowById(id); if (!fs) break; state.editFlow = copyOf(fs, 'flow'); render(); scrollTo('#flow-form-card'); toast('복사본을 편집 중입니다. 저장하면 내 흐름이 됩니다.'); break; }
      case 'flow-cancel': state.editFlow = null; render(); break;
      case 'flow-delete': { var fd = flowById(id); if (!fd) break; var fu = flowUsage(id); confirmDlg({ title: '흐름 삭제', message: '"' + fd.name + '" 흐름을 삭제할까요?' + (fu.runs ? ' 이미 만들어진 런 ' + fu.runs + '개는 그대로 남습니다.' : ''), okLabel: '삭제', danger: true }).then(function (ok) { if (!ok) return; return store.deleteFlow(id).then(function () { toast('삭제했습니다.'); return refresh(); }); }).catch(handleError); break; }
      /* ----- 흐름 편집기 ----- */
      case 'fe-add-module': { var sel = $('#fe-am'); if (!sel || !sel.value || !f) break; var mod = modById(sel.value); tryMutate(function (w) { SH.closeOpenSplits(w); SH.rowInsert(w, w.rows.length, { category: mod ? mod.category : 'etc', name: mod ? mod.name : '', cells: { all: { moduleId: sel.value } } }, S.refCell); }); break; }
      case 'fe-add-flow': { var sf = $('#fe-af'); if (!sf || !sf.value || !f) break; var sub = flowById(sf.value); if (!sub) break; tryMutate(function (w) { SH.closeOpenSplits(w); SH.appendSheet(w, sub, S.refCell, { adopt: !w.rows.length, unitLabel: w.unitLabel }); }); break; }
      case 'fe-row-insert': { if (!f) break; syncFromDom(); var ix = el.getAttribute('data-index'); var pm = $('#fe-am'); rowInsertDialog(ix === 'end' ? f.rows.length : Number(ix) || 0, ix === 'end' && pm ? pm.value : '').catch(handleError); break; }
      case 'fe-row-remove': { if (!f) break; tryMutate(function (w) { SH.rowRemove(w, id, S.always); }); break; }
      case 'fe-row-move': { if (!f) break; tryMutate(function (w) { SH.rowMove(w, id, el.getAttribute('data-dir')); }); break; }
      case 'fe-row-edit': { if (!f) break; syncFromDom(); rowEditDialog(id).catch(handleError); break; }
      case 'fe-cell-set': { if (!f) break; syncFromDom(); cellSetDialog(el.getAttribute('data-row'), el.getAttribute('data-leaf')).catch(handleError); break; }
      case 'fe-cell-clear': { if (!f) break; var rid = el.getAttribute('data-row'), lid = el.getAttribute('data-leaf'); tryMutate(function (w) { SH.cellClear(w, rid, lid, S.always); }); break; }
      case 'fe-cell-params': { if (!f) break; syncFromDom(); cellParamsDialog(id).catch(handleError); break; }
      case 'fe-split-add': { if (!f) break; syncFromDom(); if (!f.rows.length) { toast('먼저 행을 추가하세요.', true); break; } splitAddDialog(el.getAttribute('data-row') || null).catch(handleError); break; }
      case 'fe-split-edit': { if (!f) break; syncFromDom(); splitEditDialog(id).catch(handleError); break; }
      case 'fe-split-remove': { if (!f) break; tryMutate(function (w) { SH.splitRemove(w, id, S.always); }); break; }
      case 'fe-split-close': { if (!f) break; var rowC = el.getAttribute('data-row'); tryMutate(function (w) { SH.splitCloseAt(w, rowC, S.cloneRef, S.always, S.always, w.unitLabel); }); break; }
    }
  });
  window.addEventListener('hashchange', function () { readHash(); state.editModule = null; state.editFlow = null; render(); });

  store.init().then(function () {
    if (!store.getSession()) { window.location.replace('../index.html?next=library'); return; }
    state.ready = true; readHash(); store.onChange(function () { reload().then(function () { if (!state.editModule && !state.editFlow) render(); }).catch(handleError); }); return refresh();
  }).catch(function (err) { state.error = err && err.message ? err.message : String(err); render(); });
})();
