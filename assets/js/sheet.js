/* =====================================================================
   DSIL Run Sheet – 시트 모델 (행 = 큰 스텝, 열 = 기판 단위, 분기점 = 행 범위에 걸친 열 분할)
   ---------------------------------------------------------------------
   sheet = { unitCount, rows:[Row], splits:[Split] }
   Row   = { id, category, name, note, cells: { [leafId]: cell | undefined } }   leafId 'all' = 공통(분기 없음), 그 외 분기 id
   Split = { id, name, parentId:'all'|branchId, fromRowId, toRowId|null(끝까지), branches:[{id, name, count}] }
   - 분기 범위 안의 행은 분기마다 셀(스텝)을 갖거나 비워 둡니다(= 그 분기는 그 행을 건너뜀). 범위가 끝나면 다시 공통(merge).
   - 분기 안에 또 분기점을 둘 수 있습니다(parentId = 상위 분기 id, 범위는 상위 범위 안).
   cell 은 불투명(런: 스텝 객체, 흐름: 모듈 참조). 셀을 만들고 복제하고 지워도 되는지는 호출자가 콜백으로 정합니다.
   ===================================================================== */
(function () {
  'use strict';

  function uid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) { /* fall through */ } }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function fail(msg) { throw new Error(msg); }
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  function letter(i) { return String.fromCharCode(65 + (i % 26)); }

  function idx(sheet, rowId) { for (var i = 0; i < sheet.rows.length; i++) if (sheet.rows[i].id === rowId) return i; return -1; }
  function rowById(sheet, id) { return sheet.rows.filter(function (r) { return r.id === id; })[0] || null; }
  function splitById(sheet, id) { return (sheet.splits || []).filter(function (s) { return s.id === id; })[0] || null; }
  function branchOf(sheet, leafId) { for (var i = 0; i < (sheet.splits || []).length; i++) { var s = sheet.splits[i]; for (var j = 0; j < s.branches.length; j++) if (s.branches[j].id === leafId) return { split: s, branch: s.branches[j] }; } return null; }
  function depthOf(sheet, split) { var d = 0, p = split.parentId, guard = 0; while (p && p !== 'all' && guard++ < 50) { var b = branchOf(sheet, p); if (!b) break; d++; p = b.split.parentId; } return d; }
  function range(sheet, s) {
    var from = idx(sheet, s.fromRowId), to = s.toRowId ? idx(sheet, s.toRowId) : sheet.rows.length - 1;
    if (from < 0) from = 0; if (to < 0) to = sheet.rows.length - 1; if (to < from) to = from;
    return { from: from, to: to };
  }
  /* i 행에 걸친 분기점(얕은 것부터). exclude 는 분기점 id 또는 제외 판정 함수 */
  function activeAt(sheet, i, exclude) { return (sheet.splits || []).filter(function (s) { if (typeof exclude === 'function' ? exclude(s) : s.id === exclude) return false; var r = range(sheet, s); return r.from <= i && i <= r.to; }).sort(function (a, b) { return depthOf(sheet, a) - depthOf(sheet, b); }); }
  /* i 행의 열 분할(잎 목록, 기판 순서) */
  function leavesAt(sheet, i, excludeId) {
    var leaves = [{ id: 'all', name: '', count: sheet.unitCount, start: 0, path: [], depth: 0, splitId: null }];
    activeAt(sheet, i, excludeId).forEach(function (s) {
      var k = -1; leaves.forEach(function (l, n) { if (l.id === s.parentId) k = n; });
      if (k < 0) return;
      var parent = leaves[k], u = parent.start;
      var out = s.branches.map(function (b) { var l = { id: b.id, name: b.name, count: Math.max(1, Number(b.count) || 1), start: u, path: parent.path.concat([b.name]), depth: parent.depth + 1, splitId: s.id, parentId: parent.id }; u += l.count; return l; });
      leaves.splice.apply(leaves, [k, 1].concat(out));
    });
    return leaves;
  }
  function leafIds(sheet, i) { return leavesAt(sheet, i).map(function (l) { return l.id; }).join('|'); }
  function openSplits(sheet) { return (sheet.splits || []).filter(function (s) { return !s.toRowId; }); }

  /* ---------- 검증 ---------- */
  function validate(sheet, unitLabel) {
    if (!(sheet.unitCount >= 1)) fail('수량은 1 이상이어야 합니다.');
    (sheet.splits || []).forEach(function (s) {
      var label = s.name ? '분기점 "' + s.name + '"' : '분기점';
      if (!s.branches || s.branches.length < 2) fail(label + ': 분기는 2개 이상이어야 합니다.');
      var names = {};
      s.branches.forEach(function (b) { if (!str(b.name)) fail(label + ': 분기 이름을 입력하세요.'); if (names[b.name]) fail(label + ': 분기 이름이 겹칩니다 (' + b.name + ').'); names[b.name] = 1; if (!(Number(b.count) >= 1)) fail(label + ': 분기 "' + b.name + '" 수량은 1 이상이어야 합니다.'); });
      if (idx(sheet, s.fromRowId) < 0) fail(label + ': 시작 행이 없습니다.');
      if (s.toRowId && idx(sheet, s.toRowId) < 0) fail(label + ': 끝 행이 없습니다.');
      var r = range(sheet, s);
      if (s.toRowId && idx(sheet, s.toRowId) < idx(sheet, s.fromRowId)) fail(label + ': 끝 행이 시작 행보다 앞에 있습니다.');
      var sum = s.branches.reduce(function (a, b) { return a + Number(b.count); }, 0);
      for (var i = r.from; i <= r.to; i++) {
        var leaves = leavesAt(sheet, i, s.id), p = leaves.filter(function (l) { return l.id === s.parentId; })[0];
        if (!p) fail(label + ': ' + (i + 1) + '행에서 나눌 상위 구간이 없습니다 (상위 분기의 범위 안에만 둘 수 있습니다).');
        if (sum !== p.count) fail(label + ': 분기 수량 합(' + sum + ')이 나눌 수량(' + p.count + (unitLabel ? ' ' + unitLabel : '') + ')과 다릅니다.');
        var dup = activeAt(sheet, i).filter(function (x) { return x.parentId === s.parentId; });
        if (dup.length > 1) fail(label + ': ' + (i + 1) + '행에서 같은 구간을 나누는 분기점이 둘 이상입니다.');
      }
    });
  }
  function stats(sheet) {
    var cells = 0; sheet.rows.forEach(function (r) { Object.keys(r.cells || {}).forEach(function (k) { if (r.cells[k]) cells++; }); });
    return { rows: sheet.rows.length, cells: cells, splits: (sheet.splits || []).length };
  }

  /* ---------- 레이아웃 (표 행 목록) ---------- */
  function layout(sheet) {
    var out = [];
    sheet.rows.forEach(function (row, i) {
      var leaves = leavesAt(sheet, i);
      (sheet.splits || []).filter(function (s) { return range(sheet, s).from === i; }).sort(function (a, b) { return depthOf(sheet, a) - depthOf(sheet, b); }).forEach(function (s) {
        /* 머리 행은 이 분기점보다 깊은(안쪽) 분기점을 빼고 나눈 열 분할로 그림 → 같은 행에서 시작하는 안쪽 분기점이 있어도 상위 분기 이름이 보임 */
        var d = depthOf(sheet, s), lv = leavesAt(sheet, i, function (x) { return depthOf(sheet, x) > d; });
        out.push({ type: 'split-head', split: s, index: i, cells: lv.map(function (l) { return l.splitId === s.id ? { type: 'branch-head', start: l.start, count: l.count, leaf: l, split: s } : { type: 'empty', start: l.start, count: l.count, leaf: l }; }) });
      });
      out.push({ type: 'row', row: row, index: i, leaves: leaves, cells: leaves.map(function (l) { var c = row.cells ? row.cells[l.id] : null; return { type: c ? 'step' : 'skip', start: l.start, count: l.count, leaf: l, cell: c || null, row: row }; }) });
      (sheet.splits || []).filter(function (s) { return s.toRowId && range(sheet, s).to === i && i < sheet.rows.length - 1; }).sort(function (a, b) { return depthOf(sheet, b) - depthOf(sheet, a); }).forEach(function (s) {
        var next = leavesAt(sheet, i + 1);
        out.push({ type: 'merge', split: s, index: i, cells: next.map(function (l) { return { type: l.id === s.parentId ? 'merge' : 'empty', start: l.start, count: l.count, leaf: l, split: s }; }) });
      });
    });
    return out;
  }

  /* ---------- 연산 (sheet 를 바꿈; 실패 시 예외, 호출자가 사본으로 되돌림) ---------- */
  function newRow(spec) { return { id: uid(), category: str(spec.category) || 'etc', name: str(spec.name), note: str(spec.note), cells: {} }; }
  /* spec.cells: { [leafId]: cellSpec } 또는 { all: cellSpec } (all 은 그 행의 모든 잎에 복사) */
  function rowInsert(sheet, index, spec, mkCell) {
    var row = newRow(spec);
    index = Math.max(0, Math.min(sheet.rows.length, Number(index) || 0));
    sheet.rows.splice(index, 0, row);
    var leaves = leavesAt(sheet, index), specs = spec.cells || {};
    leaves.forEach(function (l) { var cs = specs[l.id] || specs.all; if (cs) row.cells[l.id] = mkCell(cs, l, row); });
    if (!row.name) { var first = leaves.map(function (l) { return row.cells[l.id]; }).filter(Boolean)[0]; row.name = first ? (first.name || first.label || '') : ''; }
    return row;
  }
  function rowRemove(sheet, rowId, canRemove) {
    var i = idx(sheet, rowId); if (i < 0) fail('행을 찾을 수 없습니다.');
    var row = sheet.rows[i];
    Object.keys(row.cells || {}).forEach(function (k) { if (row.cells[k] && !canRemove(row.cells[k])) fail((i + 1) + '행에 진행된 스텝이 있어 지울 수 없습니다.'); });
    var keep = [];
    (sheet.splits || []).forEach(function (s) {
      var r = range(sheet, s);
      if (r.from === i && r.to === i) return;                       /* 한 행짜리 분기점은 함께 삭제 */
      if (s.fromRowId === rowId) s.fromRowId = sheet.rows[i + 1].id;
      if (s.toRowId === rowId) s.toRowId = sheet.rows[i - 1].id;
      keep.push(s);
    });
    sheet.splits = keep;
    sheet.rows.splice(i, 1);
    return row;
  }
  function rowMove(sheet, rowId, dir) {
    var i = idx(sheet, rowId); if (i < 0) fail('행을 찾을 수 없습니다.');
    var j = dir === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= sheet.rows.length) fail('더 이동할 수 없습니다.');
    var a = activeAt(sheet, i).map(function (s) { return s.id; }).join('|'), b = activeAt(sheet, j).map(function (s) { return s.id; }).join('|');
    if (a !== b) fail('분기 구간을 넘어 이동할 수 없습니다. 분기점 범위를 먼저 조정하세요.');
    var lo = Math.min(i, j), hi = Math.max(i, j), rLo = sheet.rows[lo], rHi = sheet.rows[hi];
    sheet.rows[lo] = rHi; sheet.rows[hi] = rLo;
    (sheet.splits || []).forEach(function (s) {
      if (s.fromRowId === rLo.id || s.fromRowId === rHi.id) s.fromRowId = sheet.rows[lo].id;
      if (s.toRowId === rLo.id || s.toRowId === rHi.id) s.toRowId = sheet.rows[hi].id;
    });
    return j;
  }
  function rowEdit(sheet, rowId, patch) {
    var row = rowById(sheet, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var parts = [];
    if (patch.category !== undefined && str(patch.category) !== row.category) { parts.push('대분류: ' + row.category + ' → ' + str(patch.category)); row.category = str(patch.category) || 'etc'; }
    if (patch.name !== undefined && str(patch.name) !== row.name) { parts.push('이름: ' + (row.name || '(없음)') + ' → ' + (str(patch.name) || '(없음)')); row.name = str(patch.name); }
    if (patch.note !== undefined && str(patch.note) !== row.note) { parts.push('메모: ' + (row.note || '(없음)') + ' → ' + (str(patch.note) || '(없음)')); row.note = str(patch.note); }
    return parts;
  }
  function cellSet(sheet, rowId, leafId, spec, mkCell) {
    var i = idx(sheet, rowId); if (i < 0) fail('행을 찾을 수 없습니다.');
    var row = sheet.rows[i], leaf = leavesAt(sheet, i).filter(function (l) { return l.id === leafId; })[0];
    if (!leaf) fail('이 행에서 활성화된 분기가 아닙니다.');
    row.cells[leafId] = mkCell(spec, leaf, row);
    if (!row.name) row.name = row.cells[leafId].name || row.cells[leafId].label || '';
    return row.cells[leafId];
  }
  function cellClear(sheet, rowId, leafId, canRemove) {
    var row = rowById(sheet, rowId); if (!row) fail('행을 찾을 수 없습니다.');
    var c = row.cells[leafId]; if (!c) return null;
    if (!canRemove(c)) fail('진행된 스텝은 뺄 수 없습니다.');
    delete row.cells[leafId];
    return c;
  }
  /* 분기점 추가: 범위 안 행들의 상위 셀을 각 분기로 복제 */
  function splitAdd(sheet, o, cloneCell, canSplit) {
    var s = { id: uid(), name: str(o.name), parentId: o.parentId || 'all', fromRowId: o.fromRowId, toRowId: o.toRowId || null,
      branches: (o.branches || []).map(function (b, i) { return { id: uid(), name: str(b.name) || letter(i), count: Math.round(Number(b.count)) || 0 }; }) };
    if (!s.fromRowId) fail('분기점이 시작할 행을 고르세요.');
    sheet.splits = (sheet.splits || []).concat([s]);
    validate(sheet, o.unitLabel);
    var r = range(sheet, s);
    for (var i = r.from; i <= r.to; i++) {
      var row = sheet.rows[i], pc = row.cells[s.parentId];
      if (pc) { if (!canSplit(pc)) fail((i + 1) + '행 "' + (row.name || '') + '" 은 이미 진행되어 나눌 수 없습니다.'); s.branches.forEach(function (b) { row.cells[b.id] = cloneCell(pc, b); }); delete row.cells[s.parentId]; }
    }
    return s;
  }
  /* 분기 수정: 이름·분기 목록(이름/수량/추가/삭제)·범위(from/to). 범위가 줄면 상위 셀로 합치고, 늘면 상위 셀을 분기로 복제 */
  function splitEdit(sheet, splitId, patch, cloneCell, canSplit, canRemove) {
    var s = splitById(sheet, splitId); if (!s) fail('분기점을 찾을 수 없습니다.');
    var oldR = range(sheet, s);
    if (patch.name !== undefined) s.name = str(patch.name);
    if (patch.branches) {
      var keep = [];
      patch.branches.forEach(function (b, i) {
        var ex = b.id ? s.branches.filter(function (x) { return x.id === b.id; })[0] : null;
        if (ex) { ex.name = str(b.name) || ex.name; ex.count = Math.round(Number(b.count)) || ex.count; keep.push(ex); }
        else keep.push({ id: uid(), name: str(b.name) || letter(i), count: Math.round(Number(b.count)) || 0 });
      });
      s.branches.forEach(function (b) {
        if (keep.indexOf(b) >= 0) return;
        for (var i = oldR.from; i <= oldR.to; i++) { var c = sheet.rows[i].cells[b.id]; if (c && !canRemove(c)) fail('분기 "' + b.name + '" 에 진행된 스텝이 있어 뺄 수 없습니다.'); }
        for (var k = oldR.from; k <= oldR.to; k++) delete sheet.rows[k].cells[b.id];
        (sheet.splits || []).forEach(function (x) { if (x.parentId === b.id) fail('분기 "' + b.name + '" 안에 분기점이 있어 뺄 수 없습니다.'); });
      });
      s.branches = keep;
    }
    if (patch.fromRowId !== undefined) s.fromRowId = patch.fromRowId;
    if (patch.toRowId !== undefined) s.toRowId = patch.toRowId || null;
    validate(sheet, patch.unitLabel);
    var newR = range(sheet, s);
    /* 범위에서 빠진 행: 분기 셀 → 상위 셀 (첫 셀만 남김) */
    for (var i = oldR.from; i <= oldR.to; i++) {
      if (i >= newR.from && i <= newR.to) continue;
      var row = sheet.rows[i], firstC = null;
      s.branches.forEach(function (b) { var c = row.cells[b.id]; if (!c) return; if (!firstC) firstC = c; else if (!canRemove(c)) fail((i + 1) + '행: 분기 "' + b.name + '" 에 진행된 스텝이 있어 합칠 수 없습니다.'); delete row.cells[b.id]; });
      if (firstC) row.cells[s.parentId] = firstC;
    }
    /* 새로 들어온 행: 상위 셀 → 분기로 복제 */
    for (var j = newR.from; j <= newR.to; j++) {
      if (j >= oldR.from && j <= oldR.to) continue;
      var row2 = sheet.rows[j], pc = row2.cells[s.parentId];
      if (pc) { if (!canSplit(pc)) fail((j + 1) + '행 "' + (row2.name || '') + '" 은 이미 진행되어 나눌 수 없습니다.'); s.branches.forEach(function (b) { row2.cells[b.id] = cloneCell(pc, b); }); delete row2.cells[s.parentId]; }
    }
    return s;
  }
  function splitRemove(sheet, splitId, canRemove) {
    var s = splitById(sheet, splitId); if (!s) fail('분기점을 찾을 수 없습니다.');
    var ids = s.branches.map(function (b) { return b.id; });
    (sheet.splits || []).forEach(function (x) { if (ids.indexOf(x.parentId) >= 0) fail('안쪽 분기점을 먼저 지우세요.'); });
    var r = range(sheet, s);
    for (var i = r.from; i <= r.to; i++) {
      var row = sheet.rows[i], firstC = null;
      s.branches.forEach(function (b) { var c = row.cells[b.id]; if (!c) return; if (!firstC) firstC = c; else if (!canRemove(c)) fail((i + 1) + '행: 분기 "' + b.name + '" 에 진행된 스텝이 있어 합칠 수 없습니다.'); delete row.cells[b.id]; });
      if (firstC) row.cells[s.parentId] = firstC;
    }
    sheet.splits = sheet.splits.filter(function (x) { return x.id !== splitId; });
    return s;
  }
  /* 다른 시트(흐름)의 행·분기점을 끝에 붙임. 빈 시트면 수량을 가져올 수 있음(opts.adopt). mkCell(srcCell, leaf, row) 로 셀 변환 */
  function appendSheet(sheet, src, mkCell, opts) {
    opts = opts || {};
    var empty = !sheet.rows.length;
    var srcSplits = (src.splits || []);
    if (srcSplits.length) {
      if (openSplits(sheet).length) fail('끝까지 이어지는 분기점이 열려 있어 분기점이 있는 흐름을 이어 붙일 수 없습니다. 먼저 분기점의 끝 행을 정하세요.');
      if (src.unitCount !== sheet.unitCount) { if (empty && opts.adopt) sheet.unitCount = src.unitCount; else fail('흐름의 수량(' + src.unitCount + ')이 이 런의 수량(' + sheet.unitCount + ')과 달라 넣을 수 없습니다. 런 정보에서 수량을 맞추거나 분기점을 직접 만드세요.'); }
    }
    var base = sheet.rows.length, rowMap = {}, leafMap = { all: 'all' }, added = [];
    srcSplits.forEach(function (s) { s.branches.forEach(function (b) { leafMap[b.id] = uid(); }); });
    src.rows.forEach(function (r) { rowMap[r.id] = uid(); });
    var newSplits = srcSplits.map(function (s) { return { id: uid(), name: s.name || '', parentId: leafMap[s.parentId] || 'all', fromRowId: rowMap[s.fromRowId], toRowId: s.toRowId ? rowMap[s.toRowId] : null, branches: s.branches.map(function (b) { return { id: leafMap[b.id], name: b.name, count: b.count }; }) }; });
    src.rows.forEach(function (r) {
      var row = { id: rowMap[r.id], category: r.category || 'etc', name: r.name || '', note: r.note || '', cells: {} };
      sheet.rows.push(row); added.push(row);
    });
    sheet.splits = (sheet.splits || []).concat(newSplits);
    src.rows.forEach(function (r, k) {
      var row = added[k], leaves = leavesAt(sheet, base + k);
      var srcCells = r.cells || {};
      leaves.forEach(function (l) {
        var srcLeaf = Object.keys(leafMap).filter(function (o) { return leafMap[o] === l.id; })[0];
        var sc = (srcLeaf && srcCells[srcLeaf]) || (l.id === 'all' ? srcCells.all : null);
        if (!sc && l.id !== 'all' && !srcSplits.length) sc = srcCells.all;   /* 열린 분기 구간에 공통 행을 붙일 때: 모든 분기에 복사 */
        if (sc) row.cells[l.id] = mkCell(sc, l, row);
      });
    });
    validate(sheet, opts.unitLabel);
    return added;
  }
  /* 모든 셀 순회 (행 순서, 잎 순서) */
  function eachCell(sheet, fn) {
    sheet.rows.forEach(function (row, i) { leavesAt(sheet, i).forEach(function (l) { var c = row.cells && row.cells[l.id]; if (c) fn(c, row, l, i); }); });
  }
  function findCell(sheet, cellId) {
    var res = null;
    eachCell(sheet, function (c, row, leaf, i) { if (!res && c.id === cellId) res = { cell: c, row: row, leaf: leaf, index: i }; });
    return res;
  }
  /* 행·분기·셀 id 를 모두 새로 발급 (복사·복제용, 제자리에서 바꿈) */
  function reid(sheet) {
    var rowMap = {}, leafMap = { all: 'all' };
    (sheet.splits || []).forEach(function (s) { s.id = uid(); s.branches.forEach(function (b) { var n = uid(); leafMap[b.id] = n; b.id = n; }); });
    (sheet.splits || []).forEach(function (s) { s.parentId = leafMap[s.parentId] || s.parentId; });
    sheet.rows.forEach(function (r) {
      var n = uid(); rowMap[r.id] = n; r.id = n;
      var cells = {}; Object.keys(r.cells || {}).forEach(function (k) { var c = r.cells[k]; if (c && typeof c === 'object' && c.id) c.id = uid(); cells[leafMap[k] || k] = c; }); r.cells = cells;
    });
    (sheet.splits || []).forEach(function (s) { s.fromRowId = rowMap[s.fromRowId] || s.fromRowId; s.toRowId = s.toRowId ? (rowMap[s.toRowId] || s.toRowId) : null; });
    return sheet;
  }
  /* 끝까지 열려 있는 분기점을 마지막 행에서 닫음 (그 뒤에 붙는 행은 공통). 닫은 분기점 목록 반환 */
  function closeOpenSplits(sheet) {
    var last = sheet.rows[sheet.rows.length - 1]; if (!last) return [];
    var closed = [];
    (sheet.splits || []).forEach(function (s) { if (!s.toRowId) { s.toRowId = last.id; closed.push(s); } });
    return closed;
  }
  /* i 행부터 공통으로: i 행에 걸쳐 있으면서 그 앞에서 시작한 분기점들의 끝 행을 i-1 행으로 (안쪽 분기점부터). 닫은 분기점 목록 반환 */
  function splitCloseAt(sheet, rowId, cloneCell, canSplit, canRemove, unitLabel) {
    var i = idx(sheet, rowId); if (i < 0) fail('행을 찾을 수 없습니다.');
    if (i < 1) fail('첫 행에서는 합칠 수 없습니다. 분기점을 삭제하세요.');
    var prev = sheet.rows[i - 1].id;
    var list = (sheet.splits || []).filter(function (s) { var r = range(sheet, s); return r.from < i && i <= r.to; }).sort(function (a, b) { return depthOf(sheet, b) - depthOf(sheet, a); });
    if (!list.length) fail('이 행에 걸쳐 있는 분기점이 없습니다.');
    list.forEach(function (s) { splitEdit(sheet, s.id, { toRowId: prev, unitLabel: unitLabel }, cloneCell, canSplit, canRemove); });
    return list;
  }
  /* 행을 index 에 넣었을 때 그 행이 갖게 될 잎 목록 (미리보기용, 시트는 바꾸지 않음) */
  function leavesIfInserted(sheet, index) {
    var tmp = clone(sheet); var row = rowInsert(tmp, index, { name: '_' }, function () { return null; });
    return leavesAt(tmp, idx(tmp, row.id));
  }
  /* 옛 트리 모델(v2) → 시트 */
  function fromTree(tree, stepsById, unitCount) {
    var sheet = { unitCount: unitCount, rows: [], splits: [] };
    function build(items, parentId) {
      items.forEach(function (n) {
        if (n.kind !== 'split') {
          var s = stepsById ? stepsById[n.id] : n; if (!s) return;
          var row = { id: uid(), category: s.category || 'etc', name: s.name || '', note: s.itemNote || '', cells: {} };
          row.cells[parentId] = s; sheet.rows.push(row);
          return;
        }
        var sp = { id: uid(), name: n.name || '', parentId: parentId, fromRowId: null, toRowId: null, branches: n.branches.map(function (b) { return { id: uid(), name: b.name, count: b.count }; }) };
        var startIdx = sheet.rows.length, maxLen = 0;
        var subs = n.branches.map(function (b, bi) { var tmp = { unitCount: b.count, rows: [], splits: [] }; var save = sheet; sheet = tmp; build(b.items, sp.branches[bi].id); sheet = save; if (tmp.rows.length > maxLen) maxLen = tmp.rows.length; return tmp; });
        for (var k = 0; k < maxLen; k++) {
          var row = { id: uid(), category: 'etc', name: '', note: '', cells: {} };
          subs.forEach(function (tmp, bi) { var tr = tmp.rows[k]; if (!tr) return; Object.keys(tr.cells).forEach(function (key) { row.cells[key] = tr.cells[key]; }); if (!row.name) { row.name = tr.name; row.category = tr.category; } });
          sheet.rows.push(row);
        }
        subs.forEach(function (tmp) { tmp.splits.forEach(function (x) { sheet.splits.push(x); }); });
        if (maxLen > 0) { sp.fromRowId = sheet.rows[startIdx].id; sp.toRowId = sheet.rows[sheet.rows.length - 1].id; sheet.splits.push(sp); }
      });
    }
    build(tree || [], 'all');
    return sheet;
  }

  window.DSILSheet = { uid: uid, clone: clone, idx: idx, rowById: rowById, splitById: splitById, branchOf: branchOf, depthOf: depthOf, range: range, leavesAt: leavesAt, leafIds: leafIds, openSplits: openSplits, validate: validate, stats: stats, layout: layout,
    rowInsert: rowInsert, rowRemove: rowRemove, rowMove: rowMove, rowEdit: rowEdit, cellSet: cellSet, cellClear: cellClear, splitAdd: splitAdd, splitEdit: splitEdit, splitRemove: splitRemove, appendSheet: appendSheet, eachCell: eachCell, findCell: findCell, reid: reid, leavesIfInserted: leavesIfInserted, closeOpenSplits: closeOpenSplits, splitCloseAt: splitCloseAt, fromTree: fromTree };
})();
