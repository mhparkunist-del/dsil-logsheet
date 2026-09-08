/* =====================================================================
   DSIL Run Sheet – PPT 한 장 출력 (PptxGenJS, 16:9). 열 = 기판 단위, 행 = 공정(스플릿 표)
   window.DSILPptx.exportRun({ run, rows, mode, text, cfg, subtitle, footer, fileName })
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

  function cellFor(c, o, fs) {
    var span = c.count > 1 ? { colspan: c.count } : {};
    if (c.type === 'branch-head') {
      return { text: [{ text: c.branch.name, options: { bold: true } }, { text: '  ' + c.branch.count + ' ' + o.run.unitLabel + (c.split.name ? ' · ' + c.split.name : ''), options: { fontSize: Math.max(5, fs - 1), color: '7A4D00' } }],
        options: Object.assign({ fill: { color: 'FFF3CD' }, align: 'center', valign: 'middle', color: '7A4D00' }, span) };
    }
    if (c.type !== 'step') return { text: '', options: Object.assign({ fill: { color: 'F5F5F5' } }, span) };
    var s = c.step, actual = o.mode === 'actual';
    var conds = o.text(s.fields, actual ? s.actual : s.planned, ' · ');
    var mark = actual ? (s.status === 'done' ? '✓ ' : s.status === 'failed' ? '✗ ' : s.status === 'skipped' ? '→ ' : '') : '';
    var runs = [{ text: mark + s.seq + '. ' + s.name, options: { bold: true } }];
    if (conds) runs.push({ text: conds, options: { fontSize: Math.max(5, fs - 1), color: '333333' } });
    if (actual) { var tail = [s.operator, s.date, s.result, s.issues ? '⚠ ' + s.issues : ''].filter(Boolean).join(' · '); if (tail) runs.push({ text: tail, options: { fontSize: Math.max(5, fs - 1), color: '666666' } }); }
    runs.forEach(function (r, i) { if (i < runs.length - 1) r.options.breakLine = true; });
    return { text: runs, options: Object.assign({ fill: { color: actual ? (STATUS_FILL[s.status] || 'FFFFFF') : 'FFFFFF' }, align: 'left', valign: 'middle' }, span) };
  }

  function exportRun(o) {
    return load().then(function () {
      var cfg = o.cfg || {}, run = o.run, font = cfg.fontFace || 'Malgun Gothic';
      var pptx = new window.PptxGenJS(); pptx.layout = 'LAYOUT_WIDE';
      var slide = pptx.addSlide();
      var W = 13.333, H = 7.5, M = 0.3, headH = 0.5, footH = 0.25;
      slide.addText([{ text: run.code + '  ' + run.title, options: { bold: true, fontSize: 15, color: '004191' } }, { text: '   ' + (o.subtitle || ''), options: { fontSize: 9, color: '555555' } }],
        { x: M, y: 0.1, w: W - 2 * M, h: headH, valign: 'middle', fontFace: font });
      var n = Math.max(1, run.unitCount), colW = (W - 2 * M) / n;
      var trs = [run.units.map(function (u) { return { text: u, options: { bold: true, fill: { color: 'E5ECF6' }, color: '004191', align: 'center', valign: 'middle' } }; })];
      var total = 1 + o.rows.length;
      var avail = H - headH - 0.15 - M - footH;
      var rowH = Math.min(0.55, avail / total);
      var fs = Math.max(cfg.minFontPt || 5, Math.min(cfg.maxFontPt || 10, Math.floor(rowH * 72 / 3.6)));
      o.rows.forEach(function (row) { trs.push(row.cells.map(function (c) { return cellFor(c, o, fs); })); });
      slide.addTable(trs, { x: M, y: headH + 0.15, w: W - 2 * M, colW: run.units.map(function () { return colW; }), rowH: rowH, fontSize: fs, fontFace: font,
        border: { type: 'solid', pt: 0.5, color: '9AA0A6' }, margin: 0.03, valign: 'middle', autoPage: false });
      slide.addText(o.footer || '', { x: M, y: H - footH - 0.05, w: W - 2 * M, h: footH, fontSize: 7, color: '777777', fontFace: font });
      return pptx.writeFile({ fileName: o.fileName || ('runsheet_' + run.code + '.pptx') });
    });
  }

  window.DSILPptx = { exportRun: exportRun, load: load };
})();
