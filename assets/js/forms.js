/* =====================================================================
   DSIL Log Sheet – 기록 입력 대화상자 (홈·로그시트 페이지 공용)
   window.DSILForms: startDialog / closeDialog / entryDialog
   ===================================================================== */
(function () {
  'use strict';

  var U = window.DSILUI;
  var esc = U.esc, dialog = U.dialog, toast = U.toast, toLocalInput = U.toLocalInput, fromLocalInput = U.fromLocalInput;

  function prefix(eqId) { return 'v_' + String(eqId).replace(/[^A-Za-z0-9_-]/g, '') + '_'; }

  /* 장비의 조건 항목 입력 HTML. 이름은 v_<장비id>_<key> 로 붙여 장비마다 구분 */
  function fieldInputs(eq, values, opts) {
    opts = opts || {};
    values = values || {};
    if (!eq || !eq.fields || !eq.fields.length) return '';
    var p = prefix(eq.id);
    var cols = eq.fields.map(function (f) {
      var name = p + f.key;
      var v = values[f.key]; v = (v === undefined || v === null) ? '' : v;
      var req = !!f.required && !opts.optional;
      var label = '<label class="form-label' + (req ? ' required' : '') + '">' + esc(f.label) + (f.unit ? ' <span class="form-label-description">' + esc(f.unit) + '</span>' : '') + '</label>';
      var input;
      if (f.type === 'select') input = '<select class="form-select" name="' + name + '"' + (req ? ' required' : '') + '><option value="">선택</option>' + f.options.map(function (o) { return '<option value="' + esc(o) + '"' + (String(v) === o ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') + '</select>';
      else if (f.type === 'textarea') input = '<textarea class="form-control" name="' + name + '" rows="2"' + (req ? ' required' : '') + '>' + esc(v) + '</textarea>';
      else input = '<input class="form-control" name="' + name + '" type="' + (f.type === 'number' ? 'number' : 'text') + '"' + (f.type === 'number' ? ' step="any"' : '') + ' value="' + esc(v) + '"' + (req ? ' required' : '') + ' autocomplete="off">';
      return '<div class="col-6 col-md-4">' + label + input + '</div>';
    });
    return '<div class="subheader mt-3 mb-2">' + esc(opts.title || '공정 · 측정 조건') + (opts.optional ? ' <span class="text-secondary fw-normal text-lowercase">(종료할 때 채워도 됩니다)</span>' : '') + '</div><div class="row g-2">' + cols.join('') + '</div>';
  }

  function readValues(eq, v) {
    var out = {};
    if (!eq) return out;
    var p = prefix(eq.id);
    (eq.fields || []).forEach(function (f) { var x = v[p + f.key]; if (x !== undefined) out[f.key] = x; });
    return out;
  }

  function eqOptions(list, selectedId) {
    return list.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === selectedId ? ' selected' : '') + '>' + esc(e.name) + (e.location ? ' (' + esc(e.location) + ')' : '') + '</option>'; }).join('');
  }

  /* 모든 장비의 조건 블록을 만들고 data-show-if 로 선택된 장비 것만 보이게 (숨은 블록의 입력은 disabled) */
  function fieldBlocks(list, valuesByEq, opts) {
    return list.map(function (e) { return '<div data-show-if="equipmentId=' + esc(e.id) + '">' + fieldInputs(e, valuesByEq && valuesByEq[e.id], opts) + '</div>'; }).join('');
  }

  function conditionBlock(entry) {
    var c = entry && entry.condition === 'issue' ? 'issue' : 'normal';
    return '<div class="subheader mt-3 mb-2">장비 상태</div>'
      + '<div class="form-selectgroup">'
      + '<label class="form-selectgroup-item"><input type="radio" name="condition" value="normal" class="form-selectgroup-input"' + (c === 'normal' ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-circle-check text-green me-1"></i>정상</span></label>'
      + '<label class="form-selectgroup-item"><input type="radio" name="condition" value="issue" class="form-selectgroup-input"' + (c === 'issue' ? ' checked' : '') + '><span class="form-selectgroup-label"><i class="ti ti-alert-triangle text-red me-1"></i>이상 있음</span></label>'
      + '</div>'
      + '<div data-show-if="condition=issue" class="mt-2"><label class="form-label required">이상 내용</label><textarea class="form-control" name="issues" rows="2" required placeholder="증상, 발생 시점, 조치한 내용">' + esc(entry && entry.issues || '') + '</textarea>'
      + '<div class="form-hint">저장하면 장비 카드에 이상 보고가 표시되고, 담당자나 관리자가 점검 완료 처리할 때까지 유지됩니다.</div></div>';
  }

  /* 사용 시작: 장비·시작 시각·시료·목적 (+ 조건은 선택) → store.startEntry */
  function startDialog(store, list, preId) {
    var active = list.filter(function (e) { return e.active !== false; });
    if (!active.length) { toast('등록된 장비가 없습니다. 관리자에게 장비 등록을 요청하세요.', true); return Promise.resolve(null); }
    var sel = active.some(function (e) { return e.id === preId; }) ? preId : active[0].id;
    var body = '<div class="row g-2"><div class="col-md-7"><label class="form-label required">장비</label><select class="form-select" name="equipmentId" required>' + eqOptions(active, sel) + '</select></div>'
      + '<div class="col-md-5"><label class="form-label required">시작 시각</label><input type="datetime-local" class="form-control" name="start" required value="' + toLocalInput() + '"></div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-5"><label class="form-label">시료 / 소자 ID</label><input type="text" class="form-control" name="sample" placeholder="예: W12-3, MoS2-0907" autocomplete="off"></div>'
      + '<div class="col-md-7"><label class="form-label required">목적 · 내용</label><input type="text" class="form-control" name="purpose" required placeholder="예: TFT transfer 측정" autocomplete="off"></div></div>'
      + fieldBlocks(active, null, { optional: true });
    return dialog({ title: '사용 시작', bodyHtml: body, okLabel: '사용 시작', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var eq = active.filter(function (e) { return e.id === v.equipmentId; })[0];
      return store.startEntry({ equipmentId: v.equipmentId, start: fromLocalInput(v.start), sample: v.sample, purpose: v.purpose, values: readValues(eq, v) });
    });
  }

  /* 사용 종료: 종료 시각·조건·장비 상태·비고 → store.closeEntry */
  function closeDialog(store, entry, eq) {
    var body = '<div class="text-secondary small mb-2"><i class="ti ti-device-desktop-analytics me-1"></i>' + esc(eq ? eq.name : '') + ' · ' + esc(U.fmtDateTime(entry.start)) + ' 시작 · ' + esc(entry.purpose || '') + '</div>'
      + '<div class="row g-2"><div class="col-md-6"><label class="form-label required">종료 시각</label><input type="datetime-local" class="form-control" name="end" required value="' + toLocalInput() + '" min="' + toLocalInput(entry.start) + '"></div>'
      + '<div class="col-md-6"><label class="form-label">시료 / 소자 ID</label><input type="text" class="form-control" name="sample" value="' + esc(entry.sample || '') + '" autocomplete="off"></div></div>'
      + (eq ? fieldInputs(eq, entry.values) : '')
      + conditionBlock(entry)
      + '<div class="mt-3"><label class="form-label">비고</label><textarea class="form-control" name="note" rows="2" placeholder="다음 사용자에게 남길 메모, 소모품 교체 등">' + esc(entry.note || '') + '</textarea></div>';
    return dialog({ title: '사용 종료', bodyHtml: body, okLabel: '종료 기록', size: 'lg' }).then(function (v) {
      if (!v) return null;
      return store.closeEntry(entry.id, { end: fromLocalInput(v.end), sample: v.sample, values: readValues(eq, v), condition: v.condition, issues: v.issues, note: v.note });
    });
  }

  /* 지난 사용 기록 직접 입력(entry 없음) / 기록 수정(entry 있음) */
  function entryDialog(store, list, entry) {
    var editing = !!entry;
    var pool = editing ? list.filter(function (e) { return e.id === entry.equipmentId; }) : list.filter(function (e) { return e.active !== false; });
    if (!pool.length) { toast(editing ? '기록의 장비를 찾을 수 없습니다.' : '등록된 장비가 없습니다.', true); return Promise.resolve(null); }
    var sel = editing ? entry.equipmentId : pool[0].id;
    var isOpen = editing && entry.status === 'open';
    var valuesByEq = {}; if (editing) valuesByEq[entry.equipmentId] = entry.values;
    var body = '<div class="row g-2"><div class="col-md-4"><label class="form-label required">장비</label><select class="form-select" name="equipmentId" required>' + eqOptions(pool, sel) + '</select></div>'
      + '<div class="col-md-4"><label class="form-label required">시작</label><input type="datetime-local" class="form-control" name="start" required value="' + toLocalInput(editing ? entry.start : null) + '"></div>'
      + '<div class="col-md-4"><label class="form-label' + (isOpen ? '' : ' required') + '">종료</label><input type="datetime-local" class="form-control" name="end"' + (isOpen ? ' disabled' : ' required') + ' value="' + (editing ? (entry.end ? toLocalInput(entry.end) : '') : toLocalInput()) + '">'
      + (isOpen ? '<div class="form-hint">사용 중인 기록입니다. 종료는 "사용 종료" 버튼으로 하세요.</div>' : '') + '</div></div>'
      + '<div class="row g-2 mt-1"><div class="col-md-5"><label class="form-label">시료 / 소자 ID</label><input type="text" class="form-control" name="sample" value="' + esc(editing ? entry.sample : '') + '" autocomplete="off"></div>'
      + '<div class="col-md-7"><label class="form-label required">목적 · 내용</label><input type="text" class="form-control" name="purpose" required value="' + esc(editing ? entry.purpose : '') + '" autocomplete="off"></div></div>'
      + fieldBlocks(pool, valuesByEq, { optional: isOpen })
      + (isOpen ? '' : conditionBlock(entry))
      + '<div class="mt-3"><label class="form-label">비고</label><textarea class="form-control" name="note" rows="2">' + esc(editing ? entry.note : '') + '</textarea></div>'
      + (editing && !isOpen ? '<div class="form-hint mt-2">수정 내용은 변경 이력에 남습니다.</div>' : '');
    return dialog({ title: editing ? '기록 수정' : '지난 사용 기록 입력', bodyHtml: body, okLabel: editing ? '저장' : '기록 저장', size: 'lg' }).then(function (v) {
      if (!v) return null;
      var eq = pool.filter(function (e) { return e.id === v.equipmentId; })[0];
      var payload = { equipmentId: v.equipmentId, start: fromLocalInput(v.start), sample: v.sample, purpose: v.purpose, values: readValues(eq, v), note: v.note };
      if (!isOpen) { payload.end = v.end ? fromLocalInput(v.end) : null; payload.condition = v.condition; payload.issues = v.issues; }
      return editing ? store.updateEntry(entry.id, payload) : store.createEntry(payload);
    });
  }

  window.DSILForms = { fieldInputs: fieldInputs, readValues: readValues, startDialog: startDialog, closeDialog: closeDialog, entryDialog: entryDialog };
})();
