/* =====================================================================
   DSIL Run Sheet – 공정 조건(파라미터) 입력·표시 + 조건 항목 정의 편집기
   window.DSILParams
   ===================================================================== */
(function () {
  'use strict';

  var U = window.DSILUI, esc = U.esc, $all = U.$all;
  var CFG = window.DSIL_CONFIG || {};
  var TYPES = { text: '텍스트', number: '숫자', select: '선택', textarea: '긴 글', check: '체크' };

  function catInfo(id) {
    var c = (CFG.categories || []).filter(function (x) { return x.id === id; })[0];
    return c || { id: id || 'etc', label: id || '기타', color: 'secondary' };
  }
  function catBadge(id) { var c = catInfo(id); return '<span class="badge bg-' + c.color + '-lt">' + esc(c.label) + '</span>'; }
  function isTrue(v) { return v === true || v === 'true' || v === '예' || v === 'on'; }
  function fmtVal(f, v) {
    if (v === undefined || v === null || v === '') return '';
    if (f && f.type === 'check') return isTrue(v) ? '예' : '아니오';
    return String(v);
  }

  /* 값 입력 폼. 이름은 p_<key>. opts.planned 가 있으면 계획값을 힌트로 표시, opts.optional 이면 required 무시 */
  function inputs(fields, values, opts) {
    opts = opts || {}; values = values || {};
    var planned = opts.planned || null;
    if (!fields || !fields.length) return '<div class="text-secondary small">이 모듈에는 조건 항목이 없습니다.</div>';
    return '<div class="row g-2">' + fields.map(function (f) {
      var name = 'p_' + f.key, v = values[f.key]; if (v === undefined || v === null) v = '';
      var req = !!f.required && !opts.optional;
      var hint = '';
      if (planned && planned[f.key] !== undefined && planned[f.key] !== '' && planned[f.key] !== null) {
        var diff = String(planned[f.key]) !== String(v) && v !== '';
        hint = '<div class="form-hint param-plan' + (diff ? ' is-diff' : '') + '">계획 <b>' + esc(fmtVal(f, planned[f.key])) + (f.unit ? ' ' + esc(f.unit) : '') + '</b></div>';
      }
      var label = '<label class="form-label' + (req ? ' required' : '') + '">' + esc(f.label) + (f.unit ? ' <span class="form-label-description">' + esc(f.unit) + '</span>' : '') + '</label>';
      var input;
      if (f.type === 'select') input = '<select class="form-select" name="' + name + '"' + (req ? ' required' : '') + '><option value="">선택</option>' + (f.options || []).map(function (o) { return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + (v !== '' && (f.options || []).indexOf(String(v)) < 0 ? '<option value="' + esc(v) + '" selected>' + esc(v) + '</option>' : '') + '</select>';
      else if (f.type === 'textarea') input = '<textarea class="form-control" name="' + name + '" rows="2"' + (req ? ' required' : '') + '>' + esc(v) + '</textarea>';
      else if (f.type === 'check') input = '<label class="form-check mt-2 mb-0"><input class="form-check-input" type="checkbox" name="' + name + '"' + (isTrue(v) ? ' checked' : '') + '><span class="form-check-label">예</span></label>';
      else input = '<input class="form-control" name="' + name + '" type="' + (f.type === 'number' ? 'number' : 'text') + '"' + (f.type === 'number' ? ' step="any"' : '') + ' value="' + esc(v) + '"' + (req ? ' required' : '') + ' autocomplete="off">';
      return '<div class="' + (f.type === 'textarea' ? 'col-12' : 'col-6 col-md-4') + '">' + label + input + hint + '</div>';
    }).join('') + '</div>';
  }
  function read(fields, v) {
    var out = {};
    (fields || []).forEach(function (f) { var x = v['p_' + f.key]; if (x !== undefined) out[f.key] = x; });
    return out;
  }

  /* 값 요약(HTML). planned 를 주면 다른 값을 강조 */
  function summary(fields, values, planned) {
    values = values || {};
    var fm = {}; (fields || []).forEach(function (f) { fm[f.key] = f; });
    var keys = (fields || []).map(function (f) { return f.key; });
    Object.keys(values).forEach(function (k) { if (!fm[k]) keys.push(k); });
    keys = keys.filter(function (k) { var v = values[k]; return v !== undefined && v !== null && v !== '' && !(fm[k] && fm[k].type === 'check' && !isTrue(v)); });
    if (!keys.length) return '<span class="text-secondary">-</span>';
    return '<div class="param-list">' + keys.map(function (k) {
      var f = fm[k] || { label: k };
      var diff = planned && planned[k] !== undefined && planned[k] !== '' && String(planned[k]) !== String(values[k]);
      return '<span' + (diff ? ' class="is-diff" title="계획: ' + esc(fmtVal(f, planned[k])) + '"' : '') + '>' + esc(f.label) + ' <b>' + esc(fmtVal(f, values[k])) + (f.unit ? ' ' + esc(f.unit) : '') + '</b></span>';
    }).join('') + '</div>';
  }
  function text(fields, values, sep) {
    values = values || {};
    var fm = {}; (fields || []).forEach(function (f) { fm[f.key] = f; });
    var keys = (fields || []).map(function (f) { return f.key; });
    Object.keys(values).forEach(function (k) { if (!fm[k]) keys.push(k); });
    return keys.filter(function (k) { var v = values[k]; return v !== undefined && v !== null && v !== '' && !(fm[k] && fm[k].type === 'check' && !isTrue(v)); })
      .map(function (k) { var f = fm[k] || { label: k }; return f.label + ': ' + fmtVal(f, values[k]) + (f.unit ? ' ' + f.unit : ''); }).join(sep || '; ');
  }
  function diffText(fields, before, after) {
    before = before || {}; after = after || {};
    var fm = {}; (fields || []).forEach(function (f) { fm[f.key] = f; });
    var keys = {}; Object.keys(before).concat(Object.keys(after)).forEach(function (k) { keys[k] = 1; });
    return Object.keys(keys).filter(function (k) { return String(before[k] === undefined ? '' : before[k]) !== String(after[k] === undefined ? '' : after[k]); })
      .map(function (k) { var f = fm[k] || { label: k }; return f.label + ': ' + (fmtVal(f, before[k]) || '(없음)') + ' → ' + (fmtVal(f, after[k]) || '(없음)'); }).join(' / ');
  }

  /* ---------- 조건 항목 정의 편집기 (라이브러리 모듈 편집) ---------- */
  function fieldRowHtml(f) {
    f = f || {};
    return '<div class="field-row" data-row>'
      + '<input type="hidden" data-f="key" value="' + esc(f.key || '') + '">'
      + '<input type="text" class="form-control form-control-sm" data-f="label" placeholder="항목 이름" value="' + esc(f.label || '') + '" required>'
      + '<select class="form-select form-select-sm" data-f="type">' + Object.keys(TYPES).map(function (t) { return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + TYPES[t] + '</option>'; }).join('') + '</select>'
      + '<input type="text" class="form-control form-control-sm" data-f="unit" placeholder="단위" value="' + esc(f.unit || '') + '">'
      + '<input type="text" class="form-control form-control-sm" data-f="options" placeholder="선택지 (쉼표 구분)" value="' + esc((f.options || []).join(', ')) + '">'
      + '<input type="text" class="form-control form-control-sm" data-f="default" placeholder="기본값" value="' + esc(f.default === undefined || f.default === null ? '' : f.default) + '">'
      + '<label class="form-check mb-0"><input class="form-check-input" type="checkbox" data-f="required"' + (f.required ? ' checked' : '') + '><span class="form-check-label">필수</span></label>'
      + '<span class="d-flex gap-1"><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="field-up" title="위로"><i class="ti ti-chevron-up"></i></button><button type="button" class="btn btn-sm btn-ghost-secondary btn-icon" data-action="field-down" title="아래로"><i class="ti ti-chevron-down"></i></button><button type="button" class="btn btn-sm btn-ghost-danger btn-icon" data-action="field-remove" title="항목 삭제"><i class="ti ti-x"></i></button></span>'
      + '</div>';
  }
  function readFieldRows(root) {
    return $all('[data-row]', root).map(function (row) {
      function g(k) { return row.querySelector('[data-f="' + k + '"]'); }
      return { key: g('key').value || ('f' + Math.random().toString(36).slice(2, 7)), label: g('label').value, type: g('type').value, unit: g('unit').value, options: g('options').value, default: g('default').value, required: g('required').checked };
    });
  }

  window.DSILParams = { TYPES: TYPES, catInfo: catInfo, catBadge: catBadge, isTrue: isTrue, fmtVal: fmtVal, inputs: inputs, read: read, summary: summary, text: text, diffText: diffText, fieldRowHtml: fieldRowHtml, readFieldRows: readFieldRows };
})();
