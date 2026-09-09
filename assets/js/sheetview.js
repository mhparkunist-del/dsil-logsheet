/* =====================================================================
   DSIL Run Sheet – 시트 표 렌더러 + 분기점 대화상자 조각 (런 화면·라이브러리 편집기·인쇄가 함께 씀)
   window.DSILSheetView.table(sheet, opts)
     opts.units[]         열 머리글 (없으면 unitLabel n)
     opts.rowHead(row, i, leaves)      맨 왼쪽 Step 칸 내용(HTML)
     opts.cell(cell, leaf, row, i)     스텝 칸 내용
     opts.skip(leaf, row, i)           비어 있는(건너뜀) 칸 내용
     opts.head(leaf, split, i)         분기 머리 칸 내용
     opts.merge(split, leaf)           합침 칸 내용
     opts.splitLabel(split, i) / opts.mergeLabel(split)   분기점·합침 행의 Step 칸 내용
     opts.cellClass(cell, leaf, row, i)  스텝 칸 추가 class
     opts.tableClass                    기본 'table card-table split-table'
   ===================================================================== */
(function () {
  'use strict';

  var SH = window.DSILSheet, U = window.DSILUI, esc = U.esc, $all = U.$all;

  function td(cls, inner, span) { return '<td class="' + cls + '"' + (span > 1 ? ' colspan="' + span + '"' : '') + '>' + inner + '</td>'; }
  function defaultUnits(sheet, units, unitLabel) {
    var n = Math.max(1, sheet.unitCount || 1), out = (units || []).slice(0, n);
    for (var i = 0; i < n; i++) if (!out[i]) out[i] = (unitLabel || '기판') + ' ' + (i + 1);
    return out;
  }
  /* 표의 열 = 시트 전체에서 분기 경계로 나뉘는 단위 구간 (단위마다 열을 만들지 않음). 예: 기판 16, 분기 8/8 → 열 2개 "기판 1–8", "기판 9–16" */
  function columns(sheet, lay, units, unitLabel) {
    var n = Math.max(1, sheet.unitCount || 1), marks = {}; marks[0] = 1; marks[n] = 1;
    (lay || SH.layout(sheet)).forEach(function (lr) { lr.cells.forEach(function (c) { marks[c.start] = 1; marks[c.start + c.count] = 1; }); });
    var pts = Object.keys(marks).map(Number).filter(function (p) { return p >= 0 && p <= n; }).sort(function (a, b) { return a - b; });
    var us = defaultUnits(sheet, units, unitLabel), custom = us.some(function (u, i) { return u !== (unitLabel || '기판') + ' ' + (i + 1); });
    var cols = [];
    for (var k = 0; k < pts.length - 1; k++) {
      var a = pts[k], b = pts[k + 1], text;
      if (b - a === 1) text = us[a];
      else if (custom) text = us[a] + ' ~ ' + us[b - 1] + ' (' + (b - a) + ')';
      else text = (unitLabel || '기판') + ' ' + (a + 1) + '–' + b + ' (' + (b - a) + ')';
      cols.push({ start: a, count: b - a, text: text });
    }
    return cols;
  }
  function spanOf(cols, c) { var s = 0; cols.forEach(function (col) { if (col.start >= c.start && col.start + col.count <= c.start + c.count) s++; }); return Math.max(1, s); }
  function table(sheet, o) {
    o = o || {};
    var lay = SH.layout(sheet), cols = columns(sheet, lay, o.units, o.unitLabel);
    var html = '<table class="' + (o.tableClass || 'table card-table split-table') + '"><thead><tr><th class="step-col">' + esc(o.stepLabel || 'Step') + '</th>' + cols.map(function (c) { return '<th class="unit-col">' + esc(c.text) + '</th>'; }).join('') + '</tr></thead><tbody>';
    lay.forEach(function (lr) {
      if (lr.type === 'split-head') {
        html += '<tr class="row-split-head"><td class="cell-rowhead cell-split-label">' + (o.splitLabel ? o.splitLabel(lr.split, lr.index) : '<i class="ti ti-git-branch"></i> ' + esc(lr.split.name || '분기점')) + '</td>'
          + lr.cells.map(function (c) { return c.type === 'branch-head' ? td('cell-branch-head depth-' + c.leaf.depth, o.head ? o.head(c.leaf, c.split, lr.index) : '<b>' + esc(c.leaf.name) + '</b> ' + c.count, spanOf(cols, c)) : td('cell-empty', '', spanOf(cols, c)); }).join('') + '</tr>';
      } else if (lr.type === 'row') {
        html += '<tr class="row-step" data-row="' + esc(lr.row.id) + '"><td class="cell-rowhead">' + (o.rowHead ? o.rowHead(lr.row, lr.index, lr.leaves) : (lr.index + 1) + '. ' + esc(lr.row.name)) + '</td>'
          + lr.cells.map(function (c) {
            if (c.type === 'step') return td('cell-step depth-' + c.leaf.depth + ' ' + (o.cellClass ? o.cellClass(c.cell, c.leaf, lr.row, lr.index) : ''), o.cell ? o.cell(c.cell, c.leaf, lr.row, lr.index) : esc(c.cell.name || c.cell.label || ''), spanOf(cols, c));
            return td('cell-skip depth-' + c.leaf.depth, o.skip ? o.skip(c.leaf, lr.row, lr.index) : '', spanOf(cols, c));
          }).join('') + '</tr>';
      } else {
        html += '<tr class="row-merge"><td class="cell-rowhead cell-merge-label">' + (o.mergeLabel ? o.mergeLabel(lr.split) : '<i class="ti ti-arrows-join"></i> 합침') + '</td>'
          + lr.cells.map(function (c) { return c.type === 'merge' ? td('cell-merge', o.merge ? o.merge(c.split, c.leaf) : '', spanOf(cols, c)) : td('cell-empty', '', spanOf(cols, c)); }).join('') + '</tr>';
      }
    });
    return html + '</tbody></table>';
  }
  /* 단위 이름이 기본값("기판 1, 2, …")과 다를 때만 그 목록을 돌려줌 (런 정보 표시용) */
  function customUnitNames(sheet, units, unitLabel) {
    var us = defaultUnits(sheet, units, unitLabel);
    return us.some(function (u, i) { return u !== (unitLabel || '기판') + ' ' + (i + 1); }) ? us.join(', ') : '';
  }

  /* ---------- 분기점 대화상자 조각 ---------- */
  function branchRows(branches, unitLabel) {
    return branches.map(function (b, i) { var k = b.id || ('n' + i); return '<div class="input-group input-group-sm mb-1" data-brow><input type="hidden" name="bid_' + esc(k) + '" value="' + esc(b.id || '') + '"><input type="text" class="form-control" name="bname_' + esc(k) + '" value="' + esc(b.name) + '" placeholder="분기 이름" required><input type="number" class="form-control" name="bcount_' + esc(k) + '" value="' + b.count + '" min="1" required style="max-width:6rem"><span class="input-group-text">' + esc(unitLabel) + '</span><button type="button" class="btn" data-action="brow-remove" title="이 분기 빼기"><i class="ti ti-x"></i></button></div>'; }).join('');
  }
  function readBranches(v) {
    var out = {}, order = [];
    Object.keys(v).forEach(function (k) { var mm = /^(bid|bname|bcount)_(.+)$/.exec(k); if (!mm) return; if (!out[mm[2]]) { out[mm[2]] = {}; order.push(mm[2]); } out[mm[2]][mm[1]] = v[k]; });
    return order.map(function (k) { return { id: out[k].bid || undefined, name: out[k].bname, count: out[k].bcount }; });
  }
  function rowOptions(sheet, selected, opts) {
    opts = opts || {};
    return (opts.none ? '<option value=""' + (!selected ? ' selected' : '') + '>' + esc(opts.none) + '</option>' : '') + sheet.rows.map(function (r, i) { return '<option value="' + esc(r.id) + '"' + (r.id === selected ? ' selected' : '') + '>' + (i + 1) + '. ' + esc(r.name || '(이름 없음)') + '</option>'; }).join('');
  }
  function leafLabel(l, unitLabel) { return (l.id === 'all' ? '공통 구간' : l.path.join(' › ')) + ' (' + l.count + ' ' + esc(unitLabel) + ')'; }
  /* 열려 있는 분기점 대화상자의 맥락 (미리보기 갱신용) */
  var dlg = null;
  function previewHtml(sheet, unitLabel, fromId, toId, parentId, sum, excludeId) {
    var from = SH.idx(sheet, fromId); if (from < 0) return '';
    var to = toId ? SH.idx(sheet, toId) : sheet.rows.length - 1; if (to < from) to = from;
    var leaf = SH.leavesAt(sheet, from, excludeId).filter(function (l) { return l.id === parentId; })[0];
    var n = leaf ? leaf.count : sheet.unitCount;
    return '<i class="ti ti-eye me-1"></i><b>' + (from + 1) + '행' + (to > from ? ' ~ ' + (to + 1) + '행 (' + (to - from + 1) + '행)' : ' (1행만)') + '</b>을 ' + (leaf ? leafLabel(leaf, unitLabel) : '공통 구간') + '에서 나눔 · 분기 합 <b>' + sum + '</b>'
      + (sum !== n ? ' <span class="text-red fw-bold">≠ ' + n + ' (맞춰 주세요)</span>' : ' <span class="text-green">✓</span>')
      + (toId ? '<div class="text-secondary">' + (to + 2 <= sheet.rows.length ? (to + 2) + '행부터 다시 공통(합침)' : '마지막 행까지 분기 · 뒤에 공통 행을 추가하면 그 앞에서 합쳐짐') + '</div>' : '<div class="text-secondary">끝까지 분기 · 뒤에 공통 행을 추가하면 그 앞에서 자동으로 합쳐짐</div>');
  }
  function refreshPreview(form) {
    var box = form.querySelector('#split-preview'); if (!box || !dlg) return;
    var fromSel = form.elements.fromRowId, toSel = form.elements.toRowId; if (!fromSel || !toSel) return;
    var from = SH.idx(dlg.sheet, fromSel.value), to = toSel.value ? SH.idx(dlg.sheet, toSel.value) : -1;
    if (toSel.value && to < from) toSel.value = fromSel.value;
    var parentSel = form.elements['parent_' + fromSel.value], parentId = parentSel ? parentSel.value : (dlg.parentId || 'all');
    var sum = 0; $all('[name^="bcount_"]', form).forEach(function (i) { sum += Number(i.value) || 0; });
    box.innerHTML = previewHtml(dlg.sheet, dlg.unitLabel, fromSel.value, toSel.value, parentId, sum, dlg.excludeId);
  }
  /* 분기점 추가 폼: 시작 행 · 끝 행(기본 = 시작 행 하나) · 나눌 구간(시작 행의 잎) · 분기 목록 */
  function splitAddBody(sheet, unitLabel, preFromRowId) {
    if (!sheet.rows.length) return '<div class="text-secondary">행이 없습니다. 먼저 행을 추가하세요.</div>';
    var from = preFromRowId && SH.rowById(sheet, preFromRowId) ? preFromRowId : sheet.rows[sheet.rows.length - 1].id;
    dlg = { sheet: SH.clone(sheet), unitLabel: unitLabel, parentId: null, excludeId: null };
    var html = '<div class="text-secondary small mb-2">분기점은 <b>시작 행 ~ 끝 행</b>에만 걸칩니다. 그 범위의 행은 분기마다 셀을 따로 두거나 비워서 건너뛰고, 끝 행 다음부터는 다시 공통(합침)입니다. 분기 수량의 합은 나누는 구간의 수량과 같아야 합니다.</div>'
      + '<div class="mb-2"><label class="form-label">분기점 이름 <span class="form-label-description">예: 접촉 금속, 어닐링 온도</span></label><input type="text" class="form-control" name="name" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label required">시작 행</label><select class="form-select" name="fromRowId" required>' + rowOptions(sheet, from) + '</select></div>'
      + '<div class="col-6"><label class="form-label">끝 행 <span class="form-label-description">기본: 시작 행만</span></label><select class="form-select" name="toRowId">' + rowOptions(sheet, from, { none: '끝까지 (합치지 않음)' }) + '</select></div></div>';
    html += sheet.rows.map(function (r, i) {
      var leaves = SH.leavesAt(sheet, i);
      return '<div data-show-if="fromRowId=' + esc(r.id) + '" class="mt-2"><label class="form-label">나눌 구간 <span class="form-label-description">' + (i + 1) + '행 기준</span></label><select class="form-select" name="parent_' + esc(r.id) + '">' + leaves.map(function (l) { return '<option value="' + esc(l.id) + '">' + leafLabel(l, unitLabel) + '</option>'; }).join('') + '</select></div>';
    }).join('');
    var fi = SH.idx(sheet, from), firstLeaf = SH.leavesAt(sheet, fi)[0], n = firstLeaf ? firstLeaf.count : sheet.unitCount;
    var a = Math.ceil(n / 2), b = Math.max(1, n - a);
    html += '<div class="d-flex justify-content-between align-items-center mt-3 mb-1"><div class="subheader mb-0">분기</div><button type="button" class="btn btn-sm" data-action="brow-add"><i class="ti ti-plus me-1"></i>분기</button></div><div id="brow-box" data-unit="' + esc(unitLabel) + '">' + branchRows([{ name: 'A', count: a }, { name: 'B', count: b }], unitLabel) + '</div>'
      + '<div id="split-preview" class="form-hint mt-2">' + previewHtml(sheet, unitLabel, from, from, firstLeaf ? firstLeaf.id : 'all', a + b) + '</div>';
    return html;
  }
  function readSplitAdd(v) { return { name: v.name, fromRowId: v.fromRowId, toRowId: v.toRowId || null, parentId: v['parent_' + v.fromRowId] || 'all', branches: readBranches(v) }; }
  function splitEditBody(sheet, split, unitLabel) {
    var r = SH.range(sheet, split), sum = split.branches.reduce(function (a, b) { return a + (Number(b.count) || 0); }, 0);
    dlg = { sheet: SH.clone(sheet), unitLabel: unitLabel, parentId: split.parentId, excludeId: split.id };
    return '<div class="text-secondary small mb-2">' + (split.parentId === 'all' ? '공통 구간' : '상위 분기 안') + '을 나누는 분기점입니다. 범위를 줄이면 빠진 행의 분기 셀은 하나로 합쳐지고(첫 분기 셀만 남음), 늘리면 상위 셀이 분기마다 복제됩니다. 스텝이 진행된 분기는 뺄 수 없습니다.</div>'
      + '<div class="mb-2"><label class="form-label">분기점 이름</label><input type="text" class="form-control" name="name" value="' + esc(split.name || '') + '" autocomplete="off"></div>'
      + '<div class="row g-2"><div class="col-6"><label class="form-label required">시작 행</label><select class="form-select" name="fromRowId" required>' + rowOptions(sheet, sheet.rows[r.from].id) + '</select></div>'
      + '<div class="col-6"><label class="form-label">끝 행</label><select class="form-select" name="toRowId">' + rowOptions(sheet, split.toRowId || '', { none: '끝까지 (합치지 않음)' }) + '</select></div></div>'
      + '<div class="d-flex justify-content-between align-items-center mt-3 mb-1"><div class="subheader mb-0">분기</div><button type="button" class="btn btn-sm" data-action="brow-add"><i class="ti ti-plus me-1"></i>분기</button></div><div id="brow-box" data-unit="' + esc(unitLabel) + '">' + branchRows(split.branches, unitLabel) + '</div>'
      + '<div id="split-preview" class="form-hint mt-2">' + previewHtml(sheet, unitLabel, sheet.rows[r.from].id, split.toRowId || '', split.parentId, sum, split.id) + '</div>';
  }
  function readSplitEdit(v) { return { name: v.name, fromRowId: v.fromRowId, toRowId: v.toRowId || null, branches: readBranches(v) }; }
  document.addEventListener('change', function (e) { var f = e.target.closest && e.target.closest('#modal-form'); if (f) refreshPreview(f); });
  document.addEventListener('input', function (e) { var f = e.target.closest && e.target.closest('#modal-form'); if (f && /^bcount_/.test(e.target.name || '')) refreshPreview(f); });

  /* ---------- 한 행의 분기별 조건 한 번에 (열 = 분기, 행 = 조건 항목) ----------
     cols: [{ id: leafId, label, present, locked, lockedText, name, fields, values, modName, moduleId }]
     o: { intro, sharedFields, sharedModuleId, sharedModName, sharedDefaults }  sharedFields 가 있으면 매트릭스, 없으면 분기별 카드 */
  function fmtV(v) { return v === undefined || v === null ? '' : String(v); }
  function condInput(f, name, v, disabled) {
    var dis = disabled ? ' disabled' : '';
    if (f.type === 'select') return '<select class="form-select form-select-sm" name="' + name + '"' + dis + '><option value="">-</option>' + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (fmtV(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + (fmtV(v) !== '' && (f.options || []).indexOf(fmtV(v)) < 0 ? '<option value="' + esc(v) + '" selected>' + esc(v) + '</option>' : '') + '</select>';
    if (f.type === 'check') return '<label class="form-check mb-0 d-inline-block"><input class="form-check-input" type="checkbox" name="' + name + '"' + (v === true || v === 'true' || v === '예' ? ' checked' : '') + dis + '></label>';
    if (f.type === 'textarea') return '<textarea class="form-control form-control-sm" name="' + name + '" rows="2"' + dis + '>' + esc(fmtV(v)) + '</textarea>';
    return '<input class="form-control form-control-sm" type="' + (f.type === 'number' ? 'number' : 'text') + '"' + (f.type === 'number' ? ' step="any"' : '') + ' name="' + name + '" value="' + esc(fmtV(v)) + '" autocomplete="off"' + dis + '>';
  }
  function rowCondBody(cols, o) {
    o = o || {};
    var html = o.intro ? '<div class="text-secondary small mb-2">' + o.intro + '</div>' : '';
    if (o.sharedFields) {
      html += '<div class="table-responsive"><table class="table table-sm table-bordered cond-matrix mb-2"><thead><tr><th class="cond-label"></th>' + cols.map(function (c) { return '<th class="text-center"><div class="fw-bold">' + esc(c.label) + '</div><div class="small text-secondary fw-normal">' + (c.present ? esc(c.modName || '') + (c.locked ? ' · ' + esc(c.lockedText || '진행됨') : '') : '건너뜀') + '</div></th>'; }).join('') + '</tr></thead><tbody>';
      html += '<tr><th class="cond-label">스텝 이름</th>' + cols.map(function (c) { return '<td>' + (c.present ? '<input class="form-control form-control-sm" name="l_' + esc(c.id) + '__name" value="' + esc(c.name || '') + '" autocomplete="off"' + (c.locked ? ' disabled' : '') + '>' : '<label class="form-check mb-0"><input class="form-check-input" type="checkbox" name="l_' + esc(c.id) + '__fill"><span class="form-check-label small">채우기 (' + esc(o.sharedModName || '') + ')</span></label>') + '</td>'; }).join('') + '</tr>';
      o.sharedFields.forEach(function (f) { html += '<tr><th class="cond-label">' + esc(f.label) + (f.unit ? ' <span class="text-secondary fw-normal">' + esc(f.unit) + '</span>' : '') + (f.required ? ' <span class="text-red">*</span>' : '') + '</th>' + cols.map(function (c) { return '<td>' + condInput(f, 'l_' + c.id + '__p_' + f.key, c.present ? (c.values || {})[f.key] : (o.sharedDefaults || {})[f.key], c.present && c.locked) + '</td>'; }).join('') + '</tr>'; });
      html += '<tr><th class="cond-label">이 행 건너뜀</th>' + cols.map(function (c) { return '<td class="text-center">' + (c.present && !c.locked ? '<label class="form-check mb-0 d-inline-block"><input class="form-check-input" type="checkbox" name="l_' + esc(c.id) + '__skip"></label>' : '<span class="text-secondary">-</span>') + '</td>'; }).join('') + '</tr>';
      html += '</tbody></table></div><button type="button" class="btn btn-sm" data-action="cond-copy-first"><i class="ti ti-copy me-1"></i>첫 분기 값을 모든 분기에 복사</button>';
    } else {
      html += cols.map(function (c) {
        if (!c.present) return '<div class="card card-sm mb-2"><div class="card-body py-2"><b>' + esc(c.label) + '</b> <span class="text-secondary">건너뜀 — 채우려면 표에서 이 칸의 "+ 모듈" 버튼</span></div></div>';
        return '<div class="card card-sm mb-2"><div class="card-header py-2 d-flex align-items-center"><b>' + esc(c.label) + '</b><span class="text-secondary ms-2">' + esc(c.modName || '') + '</span>' + (c.locked ? '<span class="badge bg-secondary-lt ms-2">' + esc(c.lockedText || '진행됨') + '</span>' : '<label class="form-check mb-0 ms-auto"><input class="form-check-input" type="checkbox" name="l_' + esc(c.id) + '__skip"><span class="form-check-label">이 행 건너뜀</span></label>') + '</div>'
          + '<div class="card-body py-2"><div class="row g-2"><div class="col-12"><label class="form-label mb-1">스텝 이름</label><input class="form-control form-control-sm" name="l_' + esc(c.id) + '__name" value="' + esc(c.name || '') + '" autocomplete="off"' + (c.locked ? ' disabled' : '') + '></div>'
          + (c.fields || []).map(function (f) { return '<div class="' + (f.type === 'textarea' ? 'col-12' : 'col-6 col-md-4') + '"><label class="form-label mb-1">' + esc(f.label) + (f.unit ? ' <span class="text-secondary">' + esc(f.unit) + '</span>' : '') + '</label>' + condInput(f, 'l_' + c.id + '__p_' + f.key, (c.values || {})[f.key], c.locked) + '</div>'; }).join('') + '</div></div></div>';
      }).join('');
    }
    return html;
  }
  /* 폼 값 → { leafId: {skip:true} | {fill:true, moduleId, params} | {name, params} } */
  function readRowCond(v, cols, o) {
    var out = {};
    cols.forEach(function (c) {
      var pre = 'l_' + c.id + '__';
      if (c.present) {
        if (c.locked) return;
        if (v[pre + 'skip']) { out[c.id] = { skip: true }; return; }
        var params = {}; (c.fields || []).forEach(function (f) { var x = v[pre + 'p_' + f.key]; if (x !== undefined) params[f.key] = x; });
        out[c.id] = { name: v[pre + 'name'], params: params };
      } else if (o && o.sharedFields && v[pre + 'fill']) {
        var p2 = {}; o.sharedFields.forEach(function (f) { var x = v[pre + 'p_' + f.key]; if (x !== undefined) p2[f.key] = x; });
        out[c.id] = { fill: true, moduleId: o.sharedModuleId, params: p2 };
      }
    });
    return out;
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action="cond-copy-first"]'); if (!b) return;
    var form = b.closest('form'), tbl = form && form.querySelector('.cond-matrix'); if (!tbl) return;
    $all('tbody tr', tbl).forEach(function (tr) {
      var tds = $all('td', tr); if (tds.length < 2) return;
      var src = tds[0].querySelector('input:not([type="checkbox"]),select,textarea'), srcCb = tds[0].querySelector('input[type="checkbox"]:not([name$="__skip"]):not([name$="__fill"])');
      tds.slice(1).forEach(function (td) {
        var el = td.querySelector('input:not([type="checkbox"]),select,textarea'), cb = td.querySelector('input[type="checkbox"]:not([name$="__skip"]):not([name$="__fill"])');
        if (src && el && !el.disabled && !/__name$/.test(el.name)) el.value = src.value;
        if (srcCb && cb && !cb.disabled) cb.checked = srcCb.checked;
      });
    });
    U.toast('첫 분기의 조건을 모든 분기에 복사했습니다. 저장을 눌러야 반영됩니다.');
  });

  /* 분기 행 추가·삭제 버튼 (대화상자 안) */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action="brow-add"],[data-action="brow-remove"]'); if (!el) return;
    var box = document.getElementById('brow-box'); if (!box) return;
    if (el.getAttribute('data-action') === 'brow-add') {
      var n = box.querySelectorAll('[data-brow]').length;
      box.insertAdjacentHTML('beforeend', branchRows([{ id: '', name: String.fromCharCode(65 + (n % 26)), count: 1 }], box.getAttribute('data-unit') || ''));
      var rows = box.querySelectorAll('[data-brow]'), last = rows[rows.length - 1];
      last.querySelectorAll('input').forEach(function (i) { i.name = i.name.replace(/_(n\d*|)$/, '_n' + n + '_' + Date.now().toString(36)); });
    } else {
      var row = el.closest('[data-brow]');
      if (row && box.querySelectorAll('[data-brow]').length > 2) row.remove(); else U.toast('분기는 2개 이상이어야 합니다.', true);
    }
    var form = box.closest('form'); if (form) refreshPreview(form);
  });

  window.DSILSheetView = { table: table, columns: columns, spanOf: spanOf, customUnitNames: customUnitNames, rowCondBody: rowCondBody, readRowCond: readRowCond, branchRows: branchRows, readBranches: readBranches, rowOptions: rowOptions, leafLabel: leafLabel, splitAddBody: splitAddBody, readSplitAdd: readSplitAdd, splitEditBody: splitEditBody, readSplitEdit: readSplitEdit };
})();
