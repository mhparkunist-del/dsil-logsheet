/* =====================================================================
   DSIL Run Sheet – PPT 한 장 출력 (PptxGenJS, 16:9). 첫 열 = Step(대분류), 나머지 열 = 기판 단위, 행 = 큰 스텝
   window.DSILPptx.exportRun({ run, layout, mode, text, catLabel, cfg, subtitle, footer, fileName })
   ===================================================================== */
(function () {
  'use strict';

  var SRC = 'https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js';
  var STATUS_FILL = { done: 'E6F4EA', skipped: 'EEEEEE', failed: 'FDE8E8', pending: 'FFFFFF' };

  function load() {
    if (window.PptxGenJS) return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script'); s.src = SRC; s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('PPT 라이브러리를 불러오지 못했습니다. 네트워크를 확인하세요.')); };
      document.head.appendChild(s);
    });
  }
  function span(c) { return c.count > 1 ? { colspan: c.count } : {}; }
  function headCell(lr, o, fs) {
    var small = Math.max(5, fs - 1);
    if (lr.type === 'split-head') return { text: [{ text: '분기점', options: { bold: true } }, { text: lr.split.name ? '  ' + lr.split.name : '', options: { fontSize: small } }], options: { fill: { color: 'F3E8F8' }, color: '6B2D86', valign: 'middle' } };
    if (lr.type === 'merge') return { text: '합침 · ' + (lr.split.name || ''), options: { fill: { color: 'EEF3FB' }, color: '004191', fontSize: small, valign: 'middle' } };
    var runs = [{ text: (lr.index + 1) + '. ' + (lr.row.name || ''), options: { bold: true, breakLine: true } }, { text: o.catLabel ? o.catLabel(lr.row.category) : (lr.row.category || ''), options: { fontSize: small, color: '555555' } }];
    if (lr.row.note) runs.push({ text: '\n' + lr.row.note, options: { fontSize: small, color: '777777' } });
    return { text: runs, options: { fill: { color: 'F5F7FA' }, valign: 'middle' } };
  }
  function bodyCell(c, lr, o, fs) {
    var small = Math.max(5, fs - 1);
    if (c.type === 'branch-head') return { text: [{ text: c.leaf.name, options: { bold: true } }, { text: '  ' + c.count + ' ' + o.run.unitLabel, options: { fontSize: small, color: '7A4D00' } }], options: Object.assign({ fill: { color: 'FFF3CD' }, align: 'center', valign: 'middle', color: '7A4D00' }, span(c)) };
    if (c.type === 'merge') return { text: '↓ 합침', options: Object.assign({ fill: { color: 'EEF3FB' }, align: 'center', valign: 'middle', color: '004191', fontSize: small }, span(c)) };
    if (c.type === 'skip') return { text: '— 건너뜀', options: Object.assign({ fill: { color: 'FAFAFA' }, align: 'center', valign: 'middle', color: '999999', fontSize: small }, span(c)) };
    if (c.type !== 'step') return { text: '', options: Object.assign({ fill: { color: 'F5F5F5' } }, span(c)) };
    var s = c.cell, actual = o.mode === 'actual';
    var conds = o.text(s.fields, actual ? s.actual : s.planned, ' · ');
    var mark = actual ? (s.status === 'done' ? '✓ ' : s.status === 'failed' ? '✗ ' : s.status === 'skipped' ? '→ ' : '') : '';
    var runs = [{ text: mark + s.name, options: { bold: true } }];
    if (s.equipment) runs.push({ text: ' ' + s.equipment, options: { fontSize: small, color: '777777' } });
    if (conds) runs.push({ text: conds, options: { fontSize: small, color: '333333' } });
    if (actual) { var tail = [s.operator, s.date, s.result, s.issues ? '⚠ ' + s.issues : ''].filter(Boolean).join(' · '); if (tail) runs.push({ text: tail, options: { fontSize: small, color: '666666' } }); }
    runs.forEach(function (r, i) { if (i < runs.length - 1 && !(i === 0 && s.equipment)) r.options.breakLine = true; });
    return { text: runs, options: Object.assign({ fill: { color: actual ? (STATUS_FILL[s.status] || 'FFFFFF') : 'FFFFFF' }, align: 'left', valign: 'middle' }, span(c)) };
  }

  function exportRun(o) {
    return load().then(function () {
      var cfg = o.cfg || {}, run = o.run, font = cfg.fontFace || 'Malgun Gothic', lay = o.layout || [];
      var pptx = new window.PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
      var slide = pptx.addSlide();
      var W = 13.333, H = 7.5, M = 0.3, headH = 0.5, footH = 0.25;
      slide.addText([{ text: run.code + '  ' + run.title, options: { bold: true, fontSize: 15, color: '004191' } }, { text: '   ' + (o.subtitle || ''), options: { fontSize: 9, color: '555555' } }],
        { x: M, y: 0.1, w: W - 2 * M, h: headH, valign: 'middle', fontFace: font });
      var n = Math.max(1, run.unitCount), stepW = Math.min(2.2, Math.max(1.4, (W - 2 * M) * 0.16)), colW = (W - 2 * M - stepW) / n;
      var units = run.units.slice(0, n); for (var i = 0; i < n; i++) if (!units[i]) units[i] = run.unitLabel + ' ' + (i + 1);
      var hdr = { bold: true, fill: { color: 'E5ECF6' }, color: '004191', align: 'center', valign: 'middle' };
      var trs = [[{ text: 'Step', options: hdr }].concat(units.map(function (u) { return { text: u, options: hdr }; }))];
      var total = 1 + lay.length;
      var avail = H - headH - 0.15 - M - footH;
      var rowH = Math.min(0.55, avail / total);
      var fs = Math.max(cfg.minFontPt || 5, Math.min(cfg.maxFontPt || 10, Math.floor(rowH * 72 / 3.6)));
      lay.forEach(function (lr) { trs.push([headCell(lr, o, fs)].concat(lr.cells.map(function (c) { return bodyCell(c, lr, o, fs); }))); });
      slide.addTable(trs, { x: M, y: headH + 0.15, w: W - 2 * M, colW: [stepW].concat(units.map(function () { return colW; })), rowH: rowH, fontSize: fs, fontFace: font,
        border: { type: 'solid', pt: 0.5, color: '9AA0A6' }, margin: 0.03, valign: 'middle', autoPage: false });
      slide.addText(o.footer || '', { x: M, y: H - footH - 0.05, w: W - 2 * M, h: footH, fontSize: 7, color: '777777', fontFace: font });
      return pptx.writeFile({ fileName: o.fileName || ('runsheet_' + run.code + '.pptx') });
    });
  }

  window.DSILPptx = { exportRun: exportRun, load: load };
})();
