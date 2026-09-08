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
  function table(sheet, o) {
    o = o || {};
    var lay = SH.layout(sheet), units = o.units || [], n = Math.max(1, sheet.unitCount || 1);
    for (var i = 0; i < n; i++) if (!units[i]) units[i] = (o.unitLabel || '기판') + ' ' + (i + 1);
    var html = '<table class="' + (o.tableClass || 'table card-table split-table') + '"><thead><tr><th class="step-col">' + esc(o.stepLabel || 'Step') + '</th>' + units.slice(0, n).map(function (u) { return '<th class="unit-col">' + esc(u) + '</th>'; }).join('') + '</tr></thead><tbody>';
    lay.forEach(function (lr) {
      if (lr.type === 'split-head') {
        html += '<tr class="row-split-head"><td class="cell-rowhead cell-split-label">' + (o.splitLabel ? o.splitLabel(lr.split, lr.index) : '<i class="ti ti-git-branch"></i> ' + esc(lr.split.name || '분기점')) + '</td>'
          + lr.cells.map(function (c) { return c.type === 'branch-head' ? td('cell-branch-head depth-' + c.leaf.depth, o.head ? o.head(c.leaf, c.split, lr.index) : '<b>' + esc(c.leaf.name) + '</b> ' + c.count, c.count) : td('cell-empty', '', c.count); }).join('') + '</tr>';
      } else if (lr.type === 'row') {
        html += '<tr class="row-step" data-row="' + esc(lr.row.id) + '"><td class="cell-rowhead">' + (o.rowHead ? o.rowHead(lr.row, lr.index, lr.leaves) : (lr.index + 1) + '. ' + esc(lr.row.name)) + '</td>'
          + lr.cells.map(function (c) {
            if (c.type === 'step') return td('cell-step depth-' + c.leaf.depth + ' ' + (o.cellClass ? o.cellClass(c.cell, c.leaf, lr.row, lr.index) : ''), o.cell ? o.cell(c.cell, c.leaf, lr.row, lr.index) : esc(c.cell.name || c.cell.label || ''), c.count);
            return td('cell-skip depth-' + c.leaf.depth, o.skip ? o.skip(c.leaf, lr.row, lr.index) : '', c.count);
          }).join('') + '</tr>';
      } else {
        html += '<tr class="row-merge"><td class="cell-rowhead cell-merge-label">' + (o.mergeLabel ? o.mergeLabel(lr.split) : '<i class="ti ti-arrows-join"></i> 합침') + '</td>'
          + lr.cells.map(function (c) { return c.type === 'merge' ? td('cell-merge', o.merge ? o.merge(c.split, c.leaf) : '', c.count) : td('cell-empty', '', c.count); }).join('') + '</tr>';
      }
    });
    return html + '</tbody></table>';
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

  window.DSILSheetView = { table: table, branchRows: branchRows, readBranches: readBranches, rowOptions: rowOptions, leafLabel: leafLabel, splitAddBody: splitAddBody, readSplitAdd: readSplitAdd, splitEditBody: splitEditBody, readSplitEdit: readSplitEdit };
})();
