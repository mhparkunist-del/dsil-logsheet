/* =====================================================================
   DSIL Run Sheet – 스플릿 표 레이아웃 (열 = 기판 단위, 행 = 공정)
   ---------------------------------------------------------------------
   tree: [{kind:'step', step} | {kind:'split', id, name, branches:[{id, name, count, items:[...]}]}]
   rows(tree, unitCount, opts) → [{ type:'step'|'split-head'|'branch'|'branch-foot', depth, cells:[cell] }]
   cell: { type:'step'|'branch-head'|'empty'|'branch-foot', start, count, step?, split?, branch?, depth }
   각 행의 cells 는 start 순서로 unitCount 전체를 덮습니다 (colspan = count).
   opts.foot: 분기마다 끝에 'branch-foot' 행(스텝 추가 버튼용)을 넣음.
   ===================================================================== */
(function () {
  'use strict';

  /* 런의 tree(스텝 참조) 또는 전개된 흐름(스텝 객체)을 균일한 노드로 */
  function resolve(items, stepsById) {
    return (items || []).map(function (n) {
      if (n.kind === 'split') return { kind: 'split', id: n.id, name: n.name || '', branches: (n.branches || []).map(function (b) { return { id: b.id, name: b.name, count: Math.max(1, Number(b.count) || 1), items: resolve(b.items, stepsById) }; }) };
      var step = n.step || (stepsById ? stepsById[n.id] : null) || (n.moduleId !== undefined || n.name !== undefined ? n : null);
      return step ? { kind: 'step', step: step } : null;
    }).filter(Boolean);
  }

  function build(items, start, count, depth, opts) {
    var rows = [];
    items.forEach(function (node) {
      if (node.kind === 'split') {
        var u = start, blocks = [], head = [];
        node.branches.forEach(function (b) {
          var c = Math.max(1, Number(b.count) || 1);
          head.push({ type: 'branch-head', start: u, count: c, split: node, branch: b, depth: depth });
          blocks.push({ start: u, count: c, branch: b, rows: build(b.items, u, c, depth + 1, opts) });
          u += c;
        });
        var sum = u - start;
        if (sum !== count && head.length) {
          var last = head[head.length - 1], fix = count - sum;
          if (last.count + fix >= 1) { last.count += fix; blocks[blocks.length - 1].count = last.count; } else { last.mismatch = true; }
          last.mismatch = true;
        }
        rows.push({ type: 'split-head', depth: depth, split: node, cells: head });
        var n = 0; blocks.forEach(function (b) { if (b.rows.length > n) n = b.rows.length; });
        for (var i = 0; i < n; i++) {
          rows.push({ type: 'branch', depth: depth + 1, cells: blocks.reduce(function (acc, b) {
            return acc.concat(i < b.rows.length ? b.rows[i].cells : [{ type: 'empty', start: b.start, count: b.count, branch: b.branch, depth: depth + 1 }]);
          }, []) });
        }
        if (opts.foot) rows.push({ type: 'branch-foot', depth: depth + 1, split: node, cells: blocks.map(function (b) { return { type: 'branch-foot', start: b.start, count: b.count, split: node, branch: b.branch, depth: depth + 1 }; }) });
      } else {
        rows.push({ type: 'step', depth: depth, cells: [{ type: 'step', start: start, count: count, step: node.step, depth: depth }] });
      }
    });
    return rows;
  }

  function rows(tree, unitCount, opts) { return build(tree, 0, Math.max(1, Number(unitCount) || 1), 0, opts || {}); }

  /* 트리 안의 스텝 수·분기점 수 */
  function stats(tree) {
    var s = { steps: 0, splits: 0, maxDepth: 0 };
    (function walk(items, d) { items.forEach(function (n) { if (n.kind === 'split') { s.splits++; if (d + 1 > s.maxDepth) s.maxDepth = d + 1; n.branches.forEach(function (b) { walk(b.items, d + 1); }); } else s.steps++; }); })(tree, 0);
    return s;
  }

  window.DSILLayout = { resolve: resolve, rows: rows, stats: stats };
})();
