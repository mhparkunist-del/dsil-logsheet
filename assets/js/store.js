/* =====================================================================
   DSIL Log Sheet – data layer
   ---------------------------------------------------------------------
   두 어댑터(local / supabase)가 같은 비동기 인터페이스를 제공합니다.

     init() / getSession() / signIn(payload) / signUp(payload) / signOut()
     securityEvent(ev) / listSecurityEvents()
     listAccounts() / approveAccount(id) / rejectAccount(id) / setAccountStatus(id, status)
     setAccountRole(id, role) / resetAccountPin(id, pin) / changeMyPin(old, new) / verifyAdminPin(pin)
     listEquipment()                    -> Equipment[] (비활성 포함, active 플래그)
     saveEquipment(eq)                  -> 관리자. id 가 있으면 수정
     deleteEquipment(id)                -> 관리자. 기록이 있으면 비활성화만 ({deactivated})
     resolveIssue(equipmentId, note)    -> 관리자 또는 장비 담당자
     listEntries({equipmentId, from, to, userId, includeDeleted}) -> Entry[] (start 내림차순)
     startEntry({equipmentId, start, sample, purpose, values})     -> 사용 시작(open)
     closeEntry(id, {end, sample, values, condition, issues, note}) -> 사용 종료(closed)
     createEntry({...})                  -> 지난 사용 기록을 한 번에 입력(closed)
     updateEntry(id, patch)              -> 본인(기한 내) 또는 관리자
     deleteEntry(id, reason)             -> 관리자, 또는 본인의 open 기록. 소프트 삭제
     restoreEntry(id)                    -> 관리자
     listAudit()                         -> 관리자. 추가만 되는 변경 이력
     canEdit(entry)                      -> boolean (동기)
     onChange(cb) -> unsubscribe / exportJSON() / importJSON(obj) / resetDemo() (local 전용)

   Equipment { id, name, location, managerName, model, color, fields:[{key,label,type,unit,options,required}],
               rules, allowConcurrent, active, createdAt, issue:{open,note,by,at,entryId}|null }
   Entry     { id, createdAt, equipmentId, userId, userName, start, end, sample, purpose, values:{key:value},
               condition:'normal'|'issue', issues, note, status:'open'|'closed', closedAt,
               updatedAt, updatedBy, deleted, deletedAt, deletedBy, deleteReason }
   Audit     { id, createdAt, action, entryId, equipmentId, byId, byName, detail }
   ===================================================================== */
(function () {
  'use strict';

  var DATA_KEY = 'dsil-logsheet-v1';
  var SESSION_KEY = 'dsil-logsheet-session-v1';
  var SUPER_ADMIN = { id: 'admin-1', name: '관리자', seedPin: '0000' };
  var FIELD_TYPES = ['text', 'number', 'select', 'textarea'];
  var LABELS = { equipmentId: '장비', start: '시작', end: '종료', sample: '시료/소자', purpose: '목적·내용', condition: '장비 상태', issues: '이상 내용', note: '비고' };

  function uid() {
    if (window.crypto && crypto.randomUUID) { try { return crypto.randomUUID(); } catch (e) { /* fall through */ } }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function nowISO() { return new Date().toISOString(); }
  function nameKey(s) { return String(s || '').replace(/\s+/g, '').toLowerCase(); }
  function clone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function str(v) { return String(v === null || v === undefined ? '' : v).trim(); }
  function fmtShort(iso) { if (!iso) return ''; var d = new Date(iso); if (isNaN(d)) return String(iso); return pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function toISO(v) { if (!v) return null; var d = new Date(v); return isNaN(d) ? null : d.toISOString(); }
  function lsCfg(cfg) { return Object.assign({ editWindowDays: 7, maxHours: 48, futureToleranceMinutes: 5 }, cfg.logsheet || {}); }

  /* PIN 해시 (SHA-256 hex). 보안 컨텍스트가 아니면 약한 대체 해시 – 로컬 데모용 */
  function fallbackHash(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv-' + h.toString(16);
  }
  function hashPin(pin) {
    var s = String(pin);
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      }).catch(function () { return fallbackHash(s); });
    }
    return Promise.resolve(fallbackHash(s));
  }

  /* ---------- 장비 조건 항목 ---------- */
  function normFields(list) {
    if (!Array.isArray(list)) return [];
    var out = [], seen = {};
    list.forEach(function (f, i) {
      if (!f) return;
      var label = str(f.label); if (!label) return;
      var key = str(f.key).replace(/[^A-Za-z0-9_-]/g, '') || ('f' + (i + 1));
      if (seen[key]) key = key + '_' + (i + 1);
      seen[key] = 1;
      var type = FIELD_TYPES.indexOf(f.type) >= 0 ? f.type : 'text';
      var options = Array.isArray(f.options) ? f.options : String(f.options || '').split(',');
      options = options.map(function (o) { return str(o); }).filter(Boolean);
      out.push({ key: key, label: label, type: type, unit: str(f.unit), options: type === 'select' ? options : [], required: !!f.required });
    });
    return out;
  }
  function fieldMap(eq) { var m = {}; ((eq && eq.fields) || []).forEach(function (f) { m[f.key] = f; }); return m; }
  function cleanValues(eq, values) {
    var out = {}; values = values || {};
    ((eq && eq.fields) || []).forEach(function (f) {
      var v = values[f.key]; if (v === undefined || v === null) return;
      v = str(v); if (v === '') return;
      if (f.type === 'number') { var n = Number(v); if (isNaN(n)) return; out[f.key] = n; } else out[f.key] = v;
    });
    return out;
  }
  function missingRequired(eq, values) {
    var miss = ((eq && eq.fields) || []).filter(function (f) { return f.required && (values[f.key] === undefined || values[f.key] === ''); });
    return miss.length ? '필수 조건 항목을 입력하세요: ' + miss.map(function (f) { return f.label; }).join(', ') : null;
  }
  function templateFields(cfg, key) { var t = cfg.fieldTemplates && cfg.fieldTemplates[key]; return t ? clone(t.fields || []) : []; }
  function buildEquipment(cfg, d) {
    return { id: uid(), name: str(d.name), location: str(d.location), managerName: str(d.managerName), model: str(d.model), color: d.color || '#004191',
      fields: normFields(d.fields && d.fields.length ? d.fields : templateFields(cfg, d.template)), rules: str(d.rules), allowConcurrent: !!d.allowConcurrent, active: true, createdAt: nowISO(), issue: null };
  }

  function publicAccount(a) { return { id: a.id, name: a.name, role: a.role || 'member', status: a.status || 'pending', createdAt: a.createdAt, approvedAt: a.approvedAt || null, approvedBy: a.approvedBy || null }; }
  function publicEquipment(e) {
    return { id: e.id, name: e.name, location: e.location || '', managerName: e.managerName || '', model: e.model || '', color: e.color || '#004191', fields: normFields(e.fields),
      rules: e.rules || '', allowConcurrent: !!e.allowConcurrent, active: e.active !== false, createdAt: e.createdAt, issue: e.issue && e.issue.open ? clone(e.issue) : null };
  }

  function emptyData() { return { accounts: [], equipment: [], entries: [], audit: [], security: [] }; }

  function migrate(data, cfg) {
    ['accounts', 'equipment', 'entries', 'audit', 'security'].forEach(function (k) { if (!Array.isArray(data[k])) data[k] = []; });
    if (!data.accounts.some(function (a) { return a.id === SUPER_ADMIN.id || nameKey(a.name) === nameKey(SUPER_ADMIN.name); })) {
      data.accounts.unshift({ id: SUPER_ADMIN.id, name: SUPER_ADMIN.name, seedPin: SUPER_ADMIN.seedPin, role: 'admin', status: 'active', createdAt: nowISO(), approvedAt: nowISO(), approvedBy: '시스템' });
    }
    (cfg.defaultAccounts || []).forEach(function (d) {
      if (!d || !str(d.name)) return;
      if (data.accounts.some(function (a) { return nameKey(a.name) === nameKey(d.name); })) return;
      data.accounts.push({ id: uid(), name: str(d.name), seedPin: String(d.pin || '0000'), role: d.role === 'admin' ? 'admin' : 'member', status: 'active', createdAt: nowISO(), approvedAt: nowISO(), approvedBy: '기본 설정' });
    });
    (cfg.defaultEquipment || []).forEach(function (d) {
      if (!d || !str(d.name)) return;
      if (data.equipment.some(function (e) { return nameKey(e.name) === nameKey(d.name); })) return;
      data.equipment.push(buildEquipment(cfg, d));
    });
    data.equipment.forEach(function (e) { e.fields = normFields(e.fields); if (e.active === undefined) e.active = true; if (e.issue && !e.issue.open) e.issue = null; });
    data.entries.forEach(function (e) {
      if (!e.values || typeof e.values !== 'object') e.values = {};
      if (!e.status) e.status = e.end ? 'closed' : 'open';
      if (e.deleted === undefined) e.deleted = false;
      if (!e.condition) e.condition = 'normal';
    });
    return data;
  }

  /* 예시 기록 (seedDemoData): 기본 장비에 최근 3주 기록 몇 건 */
  function seedEntries(data) {
    var eq = data.equipment[0]; if (!eq) return;
    var users = data.accounts.filter(function (a) { return a.role !== 'admin'; });
    if (!users.length) return;
    var samples = ['MoS2-0901', 'W12-3', 'IGZO-TFT-07', 'Gr-cap-2', 'HfO2-stack'];
    var purposes = ['Transfer 곡선 측정', 'I-V 측정', 'C-V 측정', '소자 스크리닝', 'Output 곡선 측정'];
    for (var i = 0; i < 12; i++) {
      var u = users[i % users.length];
      var s = new Date(); s.setDate(s.getDate() - (18 - i)); s.setHours(9 + (i % 6), 30 * (i % 2), 0, 0);
      var e = new Date(s.getTime() + (60 + 25 * (i % 4)) * 60000);
      var issue = i === 7;
      data.entries.push({ id: uid(), createdAt: e.toISOString(), equipmentId: eq.id, userId: u.id, userName: u.name, start: s.toISOString(), end: e.toISOString(),
        sample: samples[i % samples.length], purpose: purposes[i % purposes.length], values: eq.fields.length ? { meas: ['Transfer', 'I-V', 'C-V', 'I-V', 'Output'][i % 5], chuck: 25 } : {},
        condition: issue ? 'issue' : 'normal', issues: issue ? '척 진공이 약함, 담당자 확인 요청' : '', note: i % 5 === 0 ? '광원 끄고 나옴' : '',
        status: 'closed', closedAt: e.toISOString(), updatedAt: null, updatedBy: null, deleted: false, deletedAt: null, deletedBy: null, deleteReason: '' });
    }
  }

  /* ---------- 공통 검증·변경 로직 (두 어댑터가 함께 사용) ---------- */
  function checkTimes(startISO, endISO, LS) {
    if (!startISO) return '시작 시각을 입력하세요.';
    var s = new Date(startISO); if (isNaN(s)) return '시작 시각이 올바르지 않습니다.';
    var tol = (LS.futureToleranceMinutes || 5) * 60000;
    if (s.getTime() > Date.now() + tol) return '시작 시각이 미래입니다.';
    if (endISO) {
      var e = new Date(endISO); if (isNaN(e)) return '종료 시각이 올바르지 않습니다.';
      if (e < s) return '종료 시각이 시작보다 빠릅니다.';
      if (e.getTime() > Date.now() + tol) return '종료 시각이 미래입니다.';
      if (e - s > (LS.maxHours || 48) * 3600000) return '사용 시간이 ' + (LS.maxHours || 48) + '시간을 넘습니다. 시각을 확인하세요.';
    }
    return null;
  }
  function fmtVal(k, v) { if (v === '' || v === null || v === undefined) return '(없음)'; if (k === 'start' || k === 'end') return fmtShort(v); if (k === 'condition') return v === 'issue' ? '이상' : '정상'; return String(v); }
  function diffEntry(a, b, eq) {
    var out = [];
    Object.keys(LABELS).forEach(function (k) {
      var x = a[k] === null || a[k] === undefined ? '' : String(a[k]), y = b[k] === null || b[k] === undefined ? '' : String(b[k]);
      if (x !== y) out.push(LABELS[k] + ': ' + fmtVal(k, x) + ' → ' + fmtVal(k, y));
    });
    var fm = fieldMap(eq), keys = {};
    Object.keys(a.values || {}).concat(Object.keys(b.values || {})).forEach(function (k) { keys[k] = 1; });
    Object.keys(keys).forEach(function (k) {
      var x = (a.values || {})[k], y = (b.values || {})[k];
      if (String(x === undefined ? '' : x) !== String(y === undefined ? '' : y)) out.push((fm[k] ? fm[k].label : k) + ': ' + fmtVal(k, x) + ' → ' + fmtVal(k, y));
    });
    return out.join(' / ');
  }
  /* 종료 패치 적용. 오류 문자열 또는 null */
  function applyClose(e, p, eq, LS) {
    var end = toISO(p.end) || nowISO();
    var terr = checkTimes(e.start, end, LS); if (terr) return terr;
    var values = Object.assign({}, e.values, cleanValues(eq, p.values));
    var miss = missingRequired(eq, values); if (miss) return miss;
    var cond = p.condition === 'issue' ? 'issue' : 'normal', issues = str(p.issues);
    if (cond === 'issue' && !issues) return '이상 내용을 입력하세요.';
    e.end = end; e.values = values; e.condition = cond; e.issues = cond === 'issue' ? issues : ''; e.note = str(p.note);
    if (p.sample !== undefined) e.sample = str(p.sample);
    e.status = 'closed'; e.closedAt = nowISO();
    return null;
  }
  /* 수정 패치 적용. 오류 문자열 또는 null (오류 시 e 는 변경되지 않음) */
  function applyPatch(e, p, eq, LS) {
    var before = clone(e);
    function fail(msg) { Object.keys(e).forEach(function (k) { delete e[k]; }); Object.assign(e, before); return msg; }
    if (p.start !== undefined) e.start = toISO(p.start) || e.start;
    if (e.status === 'closed' && p.end !== undefined) e.end = toISO(p.end) || e.end;
    var terr = checkTimes(e.start, e.status === 'closed' ? e.end : null, LS); if (terr) return fail(terr);
    if (p.sample !== undefined) e.sample = str(p.sample);
    if (p.purpose !== undefined) { var pu = str(p.purpose); if (!pu) return fail('목적·내용을 입력하세요.'); e.purpose = pu; }
    if (p.values !== undefined) e.values = cleanValues(eq, p.values);
    if (e.status === 'closed') {
      if (p.condition !== undefined) e.condition = p.condition === 'issue' ? 'issue' : 'normal';
      if (p.issues !== undefined) e.issues = str(p.issues);
      if (e.condition === 'issue' && !e.issues) return fail('이상 내용을 입력하세요.');
      if (e.condition === 'normal') e.issues = '';
      var miss = missingRequired(eq, e.values); if (miss) return fail(miss);
    }
    if (p.note !== undefined) e.note = str(p.note);
    return null;
  }
  function newEntry(user, eq, p, LS) {
    var start = toISO(p.start), end = toISO(p.end);
    if (!end) return { error: '종료 시각을 입력하세요.' };
    var terr = checkTimes(start, end, LS); if (terr) return { error: terr };
    var purpose = str(p.purpose); if (!purpose) return { error: '목적·내용을 입력하세요.' };
    var values = cleanValues(eq, p.values); var miss = missingRequired(eq, values); if (miss) return { error: miss };
    var cond = p.condition === 'issue' ? 'issue' : 'normal', issues = str(p.issues);
    if (cond === 'issue' && !issues) return { error: '이상 내용을 입력하세요.' };
    return { entry: { id: uid(), createdAt: nowISO(), equipmentId: eq.id, userId: user.id, userName: user.name, start: start, end: end, sample: str(p.sample), purpose: purpose, values: values,
      condition: cond, issues: cond === 'issue' ? issues : '', note: str(p.note), status: 'closed', closedAt: nowISO(), updatedAt: null, updatedBy: null, deleted: false, deletedAt: null, deletedBy: null, deleteReason: '' } };
  }
  function editAllowed(e, user, isAdmin, LS) {
    if (!user || !e || e.deleted) return false;
    if (isAdmin) return true;
    if (e.userId !== user.id) return false;
    if (e.status === 'open') return true;
    return Date.now() - new Date(e.createdAt).getTime() < (LS.editWindowDays || 7) * 86400000;
  }

  /* ---------- 보안 이벤트 ---------- */
  function buildSecurityEvent(ev) {
    return { id: uid(), createdAt: nowISO(), type: String(ev.type || 'other'), severity: ev.severity === 'high' ? 'high' : 'low', name: str(ev.name).slice(0, 80), detail: str(ev.detail).slice(0, 400),
      page: (window.location.pathname.split('/').slice(-2).join('/') || 'index.html').slice(0, 80), userAgent: String(navigator.userAgent || '').slice(0, 160) };
  }
  function alertText(rec) { return '[DSIL Log Sheet 보안] ' + rec.type + ' · ' + (rec.name || '-') + ' · ' + rec.detail + ' · ' + rec.page + ' · ' + rec.createdAt; }
  function sendWebhook(url, text) {
    try {
      var body = /discord/.test(url) ? { content: text } : { text: text };
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), mode: 'no-cors' }).catch(function () {});
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------------------------------------------ */
  /*  Local adapter (localStorage)                                        */
  /* ------------------------------------------------------------------ */
  function LocalStore(cfg) {
    var LS = lsCfg(cfg);
    var data = null, session = null, listeners = [];

    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function read() {
      try { data = JSON.parse(localStorage.getItem(DATA_KEY) || 'null'); } catch (e) { data = null; }
      if (!data || !Array.isArray(data.entries) || !Array.isArray(data.equipment)) {
        data = emptyData(); migrate(data, cfg); if (cfg.seedDemoData) seedEntries(data); write();
      } else migrate(data, cfg);
    }
    function write() { try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) { console.warn('localStorage write failed', e); } }
    function accountById(id) { return data.accounts.filter(function (a) { return a.id === id; })[0] || null; }
    function eqById(id) { return data.equipment.filter(function (e) { return e.id === id; })[0] || null; }
    function entryById(id) { return data.entries.filter(function (e) { return e.id === id; })[0] || null; }
    function ensureSeedHashes() {
      var todo = data.accounts.filter(function (a) { return !a.pinHash && a.seedPin; });
      if (!todo.length) return Promise.resolve();
      return Promise.all(todo.map(function (a) { return hashPin(a.seedPin).then(function (h) { a.pinHash = h; delete a.seedPin; }); })).then(function () { write(); });
    }
    function readSession() {
      try { session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { session = null; }
      if (!session || !session.user) { session = null; return; }
      var acc = accountById(session.user.id);
      if (!acc || acc.status !== 'active') { session = null; writeSession(); return; }
      session = { user: { id: acc.id, name: acc.name, email: '' }, isAdmin: acc.role === 'admin', status: 'active' };
    }
    function writeSession() { try { if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session)); else localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ } }
    function needSession() { return session ? null : new Error('로그인이 필요합니다.'); }
    function needAdmin() { if (!session) return new Error('로그인이 필요합니다.'); if (!session.isAdmin) return new Error('관리자만 할 수 있습니다.'); return null; }
    function isOwner(e) { return !!session && e.userId === session.user.id; }
    function canEdit(e) { return editAllowed(e, session && session.user, !!(session && session.isAdmin), LS); }
    function audit(action, entryId, equipmentId, detail) {
      data.audit.unshift({ id: uid(), createdAt: nowISO(), action: action, entryId: entryId || null, equipmentId: equipmentId || null, byId: session ? session.user.id : null, byName: session ? session.user.name : '', detail: str(detail).slice(0, 1000) });
      if (data.audit.length > 2000) data.audit.length = 2000;
    }
    function openIssue(eq, entry) {
      eq.issue = { open: true, note: entry.issues, by: entry.userName, at: nowISO(), entryId: entry.id };
      audit('issue', entry.id, eq.id, entry.issues);
    }
    function openEntriesOf(eqId) { return data.entries.filter(function (e) { return !e.deleted && e.status === 'open' && e.equipmentId === eqId; }); }
    function reject(msg) { return Promise.reject(msg instanceof Error ? msg : new Error(msg)); }

    window.addEventListener('storage', function (e) { if (e.key === DATA_KEY) { read(); emit(); } });

    return {
      mode: 'local',

      init: function () { read(); return ensureSeedHashes().then(function () { readSession(); }); },
      getSession: function () { return session ? clone(session) : null; },

      signIn: function (payload) {
        var name = str(payload && payload.name), pin = String(payload && payload.pin || '');
        if (!name) return reject('이름을 입력하세요.');
        var acc = data.accounts.filter(function (a) { return nameKey(a.name) === nameKey(name); })[0];
        if (!acc) return reject('등록되지 않은 이름입니다. 회원가입을 신청하세요.');
        if (acc.status === 'pending') return reject('관리자 승인 대기 중입니다. 승인 후 로그인할 수 있습니다.');
        if (acc.status === 'rejected') return reject('가입 신청이 거절되었습니다. 관리자에게 문의하세요.');
        if (acc.status === 'disabled') return reject('사용이 중지된 계정입니다.');
        return hashPin(pin).then(function (h) {
          if (h !== acc.pinHash) throw new Error('PIN이 올바르지 않습니다.');
          session = { user: { id: acc.id, name: acc.name, email: '' }, isAdmin: acc.role === 'admin', status: 'active' };
          writeSession(); emit();
          return clone(session);
        });
      },
      signUp: function (payload) {
        var name = str(payload && payload.name), pin = String(payload && payload.pin || '');
        if (!name) return reject('이름을 입력하세요.');
        if (!/^\d{4,8}$/.test(pin)) return reject('PIN은 숫자 4~8자리입니다.');
        var dup = data.accounts.filter(function (a) { return nameKey(a.name) === nameKey(name); })[0];
        if (dup) return reject(dup.status === 'pending' ? '이미 승인 대기 중인 이름입니다.' : '이미 등록된 이름입니다. 로그인하세요.');
        return hashPin(pin).then(function (h) {
          var acc = { id: uid(), name: name, pinHash: h, role: 'member', status: 'pending', createdAt: nowISO(), approvedAt: null, approvedBy: null };
          data.accounts.push(acc); write(); emit();
          return publicAccount(acc);
        });
      },
      signOut: function () { session = null; writeSession(); emit(); return Promise.resolve(); },

      securityEvent: function (ev) {
        var rec = buildSecurityEvent(ev);
        data.security.unshift(rec); if (data.security.length > 500) data.security.length = 500;
        write(); emit();
        if (rec.severity === 'high' && cfg.security && cfg.security.alertWebhookUrl) sendWebhook(cfg.security.alertWebhookUrl, alertText(rec));
        return Promise.resolve(clone(rec));
      },
      listSecurityEvents: function () { return Promise.resolve(clone(data.security)); },

      listAccounts: function () { return Promise.resolve(data.accounts.map(publicAccount)); },
      approveAccount: function (id) {
        var a = accountById(id); if (!a) return reject('계정을 찾을 수 없습니다.');
        a.status = 'active'; a.approvedAt = nowISO(); a.approvedBy = session ? session.user.name : '관리자';
        write(); emit(); return Promise.resolve(publicAccount(a));
      },
      rejectAccount: function (id) {
        var a = accountById(id); if (!a) return reject('계정을 찾을 수 없습니다.');
        if (a.status === 'pending') data.accounts = data.accounts.filter(function (x) { return x.id !== id; }); else a.status = 'rejected';
        write(); emit(); return Promise.resolve();
      },
      setAccountStatus: function (id, status) {
        var a = accountById(id); if (!a) return reject('계정을 찾을 수 없습니다.');
        if (a.role === 'admin' && status !== 'active' && data.accounts.filter(function (x) { return x.role === 'admin' && x.status === 'active'; }).length <= 1) return reject('마지막 관리자 계정은 중지할 수 없습니다.');
        a.status = status; write(); emit(); return Promise.resolve(publicAccount(a));
      },
      setAccountRole: function (id, role) {
        var a = accountById(id); if (!a) return reject('계정을 찾을 수 없습니다.');
        if (a.role === 'admin' && role !== 'admin' && data.accounts.filter(function (x) { return x.role === 'admin' && x.status === 'active'; }).length <= 1) return reject('마지막 관리자 계정의 권한은 내릴 수 없습니다.');
        a.role = role === 'admin' ? 'admin' : 'member'; write(); emit();
        if (session && session.user.id === id) { session.isAdmin = a.role === 'admin'; writeSession(); }
        return Promise.resolve(publicAccount(a));
      },
      resetAccountPin: function (id, pin) {
        var a = accountById(id); if (!a) return reject('계정을 찾을 수 없습니다.');
        if (!/^\d{4,8}$/.test(String(pin || ''))) return reject('PIN은 숫자 4~8자리입니다.');
        return hashPin(pin).then(function (h) { a.pinHash = h; write(); emit(); return publicAccount(a); });
      },
      changeMyPin: function (oldPin, newPin) {
        if (!session) return reject('로그인이 필요합니다.');
        var a = accountById(session.user.id); if (!a) return reject('계정을 찾을 수 없습니다.');
        if (!/^\d{4,8}$/.test(String(newPin || ''))) return reject('새 PIN은 숫자 4~8자리입니다.');
        return Promise.all([hashPin(oldPin), hashPin(newPin)]).then(function (hs) {
          if (hs[0] !== a.pinHash) throw new Error('현재 PIN이 올바르지 않습니다.');
          a.pinHash = hs[1]; write(); emit();
        });
      },
      verifyAdminPin: function (pin) { return Promise.resolve(!!(session && session.isAdmin) && String(pin) === String(cfg.adminPin)); },

      canEdit: canEdit,

      /* ---------- 장비 ---------- */
      listEquipment: function () { return Promise.resolve(data.equipment.map(publicEquipment)); },
      saveEquipment: function (eq) {
        var err = needAdmin(); if (err) return reject(err);
        var name = str(eq && eq.name); if (!name) return reject('장비 이름을 입력하세요.');
        if (data.equipment.some(function (x) { return x.id !== eq.id && nameKey(x.name) === nameKey(name); })) return reject('같은 이름의 장비가 이미 있습니다.');
        var cur = eq.id ? eqById(eq.id) : null;
        if (!cur) {
          cur = buildEquipment(cfg, eq); cur.name = name;
          data.equipment.push(cur); audit('equipment', null, cur.id, '장비 추가: ' + name);
        } else {
          cur.name = name; cur.location = str(eq.location); cur.managerName = str(eq.managerName); cur.model = str(eq.model); cur.color = eq.color || cur.color;
          cur.fields = normFields(eq.fields); cur.rules = str(eq.rules); cur.allowConcurrent = !!eq.allowConcurrent;
          if (eq.active !== undefined) cur.active = !!eq.active;
          audit('equipment', null, cur.id, '장비 수정: ' + name);
        }
        write(); emit(); return Promise.resolve(publicEquipment(cur));
      },
      deleteEquipment: function (id) {
        var err = needAdmin(); if (err) return reject(err);
        var eq = eqById(id); if (!eq) return reject('장비를 찾을 수 없습니다.');
        var used = data.entries.some(function (e) { return e.equipmentId === id; });
        if (used) { eq.active = false; audit('equipment', null, id, '장비 비활성화(기록 있음): ' + eq.name); }
        else { data.equipment = data.equipment.filter(function (x) { return x.id !== id; }); audit('equipment', null, id, '장비 삭제: ' + eq.name); }
        write(); emit(); return Promise.resolve({ deactivated: used });
      },
      resolveIssue: function (id, note) {
        var err = needSession(); if (err) return reject(err);
        var eq = eqById(id); if (!eq) return reject('장비를 찾을 수 없습니다.');
        if (!eq.issue || !eq.issue.open) return reject('처리할 이상 보고가 없습니다.');
        if (!session.isAdmin && nameKey(session.user.name) !== nameKey(eq.managerName)) return reject('관리자 또는 장비 담당자(' + (eq.managerName || '미지정') + ')만 점검 완료 처리할 수 있습니다.');
        var prev = eq.issue; eq.issue = null;
        audit('resolve', prev.entryId || null, eq.id, '점검 완료: ' + str(note) + (prev.note ? ' (보고: ' + prev.note + ')' : ''));
        write(); emit(); return Promise.resolve(publicEquipment(eq));
      },

      /* ---------- 기록 ---------- */
      listEntries: function (opts) {
        opts = opts || {};
        var inc = !!opts.includeDeleted && !!(session && session.isAdmin);
        var from = opts.from ? new Date(opts.from + 'T00:00:00') : null, to = opts.to ? new Date(opts.to + 'T23:59:59.999') : null;
        var out = data.entries.filter(function (e) {
          if (e.deleted && !inc) return false;
          if (opts.equipmentId && e.equipmentId !== opts.equipmentId) return false;
          if (opts.userId && e.userId !== opts.userId) return false;
          var s = new Date(e.start);
          if (from && s < from) return false;
          if (to && s > to) return false;
          return true;
        });
        out.sort(function (a, b) { return new Date(b.start) - new Date(a.start); });
        return Promise.resolve(clone(out));
      },
      getEntry: function (id) { var e = entryById(id); return Promise.resolve(e ? clone(e) : null); },
      startEntry: function (p) {
        var err = needSession(); if (err) return reject(err);
        var eq = eqById(p.equipmentId); if (!eq || eq.active === false) return reject('장비를 찾을 수 없습니다.');
        var start = toISO(p.start) || nowISO();
        var terr = checkTimes(start, null, LS); if (terr) return reject(terr);
        var purpose = str(p.purpose); if (!purpose) return reject('목적·내용을 입력하세요.');
        var open = openEntriesOf(eq.id);
        if (open.some(isOwner)) return reject('이미 이 장비를 사용 중으로 기록되어 있습니다. 먼저 종료하세요.');
        if (open.length && !eq.allowConcurrent) return reject(open[0].userName + '님이 ' + fmtShort(open[0].start) + '부터 사용 중입니다.');
        var rec = { id: uid(), createdAt: nowISO(), equipmentId: eq.id, userId: session.user.id, userName: session.user.name, start: start, end: null, sample: str(p.sample), purpose: purpose, values: cleanValues(eq, p.values),
          condition: 'normal', issues: '', note: '', status: 'open', closedAt: null, updatedAt: null, updatedBy: null, deleted: false, deletedAt: null, deletedBy: null, deleteReason: '' };
        data.entries.push(rec);
        audit('start', rec.id, eq.id, eq.name + ' · ' + fmtShort(start) + ' · ' + purpose);
        write(); emit(); return Promise.resolve(clone(rec));
      },
      closeEntry: function (id, p) {
        var err = needSession(); if (err) return reject(err);
        var e = entryById(id); if (!e || e.deleted) return reject('기록을 찾을 수 없습니다.');
        if (e.status !== 'open') return reject('이미 종료된 기록입니다.');
        if (!isOwner(e) && !session.isAdmin) return reject('본인 기록만 종료할 수 있습니다.');
        var eq = eqById(e.equipmentId);
        var cerr = applyClose(e, p || {}, eq, LS); if (cerr) return reject(cerr);
        if (!isOwner(e)) { e.updatedAt = nowISO(); e.updatedBy = session.user.name; }
        audit('close', e.id, e.equipmentId, (eq ? eq.name : '') + ' · ' + fmtShort(e.start) + '~' + fmtShort(e.end) + (e.condition === 'issue' ? ' · 이상: ' + e.issues : ''));
        if (e.condition === 'issue' && eq) openIssue(eq, e);
        write(); emit(); return Promise.resolve(clone(e));
      },
      createEntry: function (p) {
        var err = needSession(); if (err) return reject(err);
        var eq = eqById(p.equipmentId); if (!eq) return reject('장비를 찾을 수 없습니다.');
        var r = newEntry(session.user, eq, p || {}, LS); if (r.error) return reject(r.error);
        data.entries.push(r.entry);
        audit('create', r.entry.id, eq.id, eq.name + ' · ' + fmtShort(r.entry.start) + '~' + fmtShort(r.entry.end) + ' · ' + r.entry.purpose);
        if (r.entry.condition === 'issue') openIssue(eq, r.entry);
        write(); emit(); return Promise.resolve(clone(r.entry));
      },
      updateEntry: function (id, p) {
        var err = needSession(); if (err) return reject(err);
        var e = entryById(id); if (!e || e.deleted) return reject('기록을 찾을 수 없습니다.');
        if (!canEdit(e)) return reject('수정 기한(' + LS.editWindowDays + '일)이 지났거나 권한이 없습니다. 관리자에게 요청하세요.');
        var eq = eqById(e.equipmentId);
        var before = clone(e);
        var perr = applyPatch(e, p || {}, eq, LS); if (perr) return reject(perr);
        e.updatedAt = nowISO(); e.updatedBy = session.user.name;
        audit('update', e.id, e.equipmentId, diffEntry(before, e, eq) || '변경 없음');
        if (e.status === 'closed' && e.condition === 'issue' && before.condition !== 'issue' && eq) openIssue(eq, e);
        write(); emit(); return Promise.resolve(clone(e));
      },
      deleteEntry: function (id, reason) {
        var err = needSession(); if (err) return reject(err);
        var e = entryById(id); if (!e || e.deleted) return reject('기록을 찾을 수 없습니다.');
        var own = isOwner(e) && e.status === 'open';
        if (!session.isAdmin && !own) return reject('기록 삭제는 관리자만 할 수 있습니다. 본인의 사용 중 기록만 취소할 수 있습니다.');
        reason = str(reason);
        if (session.isAdmin && !own && !reason) return reject('삭제 사유를 입력하세요.');
        e.deleted = true; e.deletedAt = nowISO(); e.deletedBy = session.user.name; e.deleteReason = reason || (own ? '사용 시작 취소' : '');
        audit('delete', e.id, e.equipmentId, e.deleteReason);
        write(); emit(); return Promise.resolve();
      },
      restoreEntry: function (id) {
        var err = needAdmin(); if (err) return reject(err);
        var e = entryById(id); if (!e || !e.deleted) return reject('복구할 기록을 찾을 수 없습니다.');
        e.deleted = false; e.deletedAt = null; e.deletedBy = null; e.deleteReason = '';
        audit('restore', e.id, e.equipmentId, '');
        write(); emit(); return Promise.resolve(clone(e));
      },
      listAudit: function () { var err = needAdmin(); if (err) return reject(err); return Promise.resolve(clone(data.audit)); },

      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      exportJSON: function () { return clone(data); },
      importJSON: function (obj) {
        if (!obj || !Array.isArray(obj.entries) || !Array.isArray(obj.equipment)) throw new Error('형식이 올바르지 않습니다.');
        data = migrate(clone(obj), cfg); write(); emit();
      },
      resetDemo: function () { data = emptyData(); migrate(data, cfg); if (cfg.seedDemoData) seedEntries(data); write(); return ensureSeedHashes().then(function () { readSession(); emit(); }); }
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Supabase adapter                                                   */
  /* ------------------------------------------------------------------ */
  function loadScript(src) {
    return new Promise(function (resolve, rejectFn) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = function () { rejectFn(new Error('스크립트 로드 실패: ' + src)); };
      document.head.appendChild(s);
    });
  }
  function toEquipment(r) {
    return { id: r.id, name: r.name, location: r.location || '', managerName: r.manager_name || '', model: r.model || '', color: r.color || '#004191', fields: normFields(r.fields), rules: r.rules || '',
      allowConcurrent: !!r.allow_concurrent, active: r.active !== false, createdAt: r.created_at, issue: r.issue && r.issue.open ? r.issue : null };
  }
  function fromEquipment(e) {
    var row = { name: str(e.name), location: str(e.location), manager_name: str(e.managerName), model: str(e.model), color: e.color || '#004191', fields: normFields(e.fields), rules: str(e.rules), allow_concurrent: !!e.allowConcurrent };
    if (e.active !== undefined) row.active = !!e.active;
    if (e.id) row.id = e.id;
    return row;
  }
  function toEntry(r) {
    return { id: r.id, createdAt: r.created_at, equipmentId: r.equipment_id, userId: r.user_id, userName: r.user_name || '', start: r.start_at, end: r.end_at || null, sample: r.sample || '', purpose: r.purpose || '',
      values: (r.params && typeof r.params === 'object') ? r.params : {}, condition: r.condition || 'normal', issues: r.issues || '', note: r.note || '', status: r.status || (r.end_at ? 'closed' : 'open'), closedAt: r.closed_at || null,
      updatedAt: r.updated_at || null, updatedBy: r.updated_by || null, deleted: !!r.deleted, deletedAt: r.deleted_at || null, deletedBy: r.deleted_by || null, deleteReason: r.delete_reason || '' };
  }
  function fromEntry(e) {
    return { equipment_id: e.equipmentId, user_id: e.userId, user_name: e.userName, start_at: e.start, end_at: e.end, sample: e.sample, purpose: e.purpose, params: e.values || {}, condition: e.condition, issues: e.issues, note: e.note, status: e.status, closed_at: e.closedAt || null };
  }
  function toAudit(r) { return { id: r.id, createdAt: r.created_at, action: r.action, entryId: r.entry_id, equipmentId: r.equipment_id, byId: r.by_id, byName: r.by_name || '', detail: r.detail || '' }; }

  function SupabaseStore(cfg) {
    var LS = lsCfg(cfg);
    var client = null, session = null, profile = null, listeners = [];
    function emit() { listeners.forEach(function (cb) { try { cb(); } catch (e) { console.error(e); } }); }
    function loadProfile() {
      if (!session) { profile = null; return Promise.resolve(); }
      return client.from('profiles').select('*').eq('id', session.user.id).maybeSingle().then(function (res) { profile = res.data || null; });
    }
    function currentUser() {
      if (!session) return null;
      var name = (profile && profile.name) || (session.user.user_metadata && session.user.user_metadata.name) || session.user.email;
      return { id: session.user.id, name: name, email: session.user.email };
    }
    function isAdmin() { return !!(profile && profile.is_admin); }
    function unwrap(res) { if (res.error) throw new Error(res.error.message || String(res.error)); return res.data; }
    function reject(msg) { return Promise.reject(msg instanceof Error ? msg : new Error(msg)); }
    function needUser() { return currentUser() ? null : new Error('로그인이 필요합니다.'); }
    function fetchEntry(id) { return client.from('log_entries').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { return r ? toEntry(r) : null; }); }
    function fetchEquipment(id) { return client.from('equipment').select('*').eq('id', id).maybeSingle().then(unwrap).then(function (r) { return r ? toEquipment(r) : null; }); }
    function updateRow(id, patch) { return client.from('log_entries').update(patch).eq('id', id).select().single().then(unwrap).then(toEntry); }

    return {
      mode: 'supabase',
      init: function () {
        if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return reject('config.js 에 supabaseUrl / supabaseAnonKey 를 설정하세요.');
        return loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js').then(function () {
          client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
          return client.auth.getSession();
        }).then(function (res) { session = res.data.session; return loadProfile(); }).then(function () {
          client.auth.onAuthStateChange(function (_event, s) { session = s; loadProfile().then(emit); });
          client.channel('logsheet-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'log_entries' }, emit)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment' }, emit)
            .subscribe();
        });
      },
      getSession: function () {
        if (!session) return null;
        return { user: currentUser(), isAdmin: isAdmin(), status: profile ? (profile.status || 'pending') : 'pending' };
      },
      signIn: function (payload) {
        var email = str(payload && payload.email);
        if (!email) return reject('이메일을 입력하세요.');
        return client.auth.signInWithOtp({ email: email, options: { emailRedirectTo: window.location.href.split('#')[0], data: { name: str(payload.name) } } })
          .then(unwrap).then(function () { return { magicLinkSent: true }; });
      },
      signUp: function (payload) { return this.signIn(payload); },
      signOut: function () { return client.auth.signOut().then(function () { session = null; profile = null; emit(); }); },

      securityEvent: function (ev) {
        var rec = buildSecurityEvent(ev);
        if (rec.severity === 'high' && cfg.security && cfg.security.alertWebhookUrl) sendWebhook(cfg.security.alertWebhookUrl, alertText(rec));
        return client.rpc('log_security_event', { p_type: rec.type, p_severity: rec.severity, p_name: rec.name, p_detail: rec.detail, p_page: rec.page, p_user_agent: rec.userAgent })
          .then(unwrap).then(function () { return rec; }).catch(function () { return rec; });
      },
      listSecurityEvents: function () {
        return client.from('security_events').select('*').order('created_at', { ascending: false }).limit(200).then(unwrap).then(function (rows) {
          return rows.map(function (r) { return { id: r.id, createdAt: r.created_at, type: r.type, severity: r.severity, name: r.name || '', detail: r.detail || '', page: r.page || '', userAgent: r.user_agent || '' }; });
        });
      },
      listAccounts: function () {
        return client.from('profiles').select('*').order('created_at').then(unwrap).then(function (rows) {
          return rows.map(function (p) { return { id: p.id, name: p.name || p.email, email: p.email, role: p.is_admin ? 'admin' : 'member', status: p.status || 'pending', createdAt: p.created_at, approvedAt: p.approved_at || null, approvedBy: p.approved_by || null }; });
        });
      },
      approveAccount: function (id) { var u = currentUser(); return client.from('profiles').update({ status: 'active', approved_at: nowISO(), approved_by: u ? u.name : '' }).eq('id', id).then(unwrap).then(function () {}); },
      rejectAccount: function (id) { return client.from('profiles').update({ status: 'rejected' }).eq('id', id).then(unwrap).then(function () {}); },
      setAccountStatus: function (id, status) { return client.from('profiles').update({ status: status }).eq('id', id).then(unwrap).then(function () {}); },
      setAccountRole: function (id, role) { return client.from('profiles').update({ is_admin: role === 'admin' }).eq('id', id).then(unwrap).then(function () {}); },
      resetAccountPin: function () { return reject('공용 DB 모드는 이메일 링크로 로그인하므로 PIN이 없습니다.'); },
      changeMyPin: function () { return reject('공용 DB 모드는 이메일 링크로 로그인하므로 PIN이 없습니다.'); },
      verifyAdminPin: function (pin) { return Promise.resolve(isAdmin() && String(pin) === String(cfg.adminPin)); },

      canEdit: function (e) { return editAllowed(e, currentUser(), isAdmin(), LS); },

      listEquipment: function () { return client.from('equipment').select('*').order('created_at').then(unwrap).then(function (rows) { return rows.map(toEquipment); }); },
      saveEquipment: function (eq) {
        if (!isAdmin()) return reject('관리자만 할 수 있습니다.');
        if (!str(eq && eq.name)) return reject('장비 이름을 입력하세요.');
        return client.from('equipment').upsert(fromEquipment(eq)).select().single().then(unwrap).then(toEquipment);
      },
      deleteEquipment: function (id) {
        if (!isAdmin()) return reject('관리자만 할 수 있습니다.');
        return client.from('log_entries').select('id', { count: 'exact', head: true }).eq('equipment_id', id).then(function (res) {
          if (res.error) throw new Error(res.error.message);
          if (res.count > 0) return client.from('equipment').update({ active: false }).eq('id', id).then(unwrap).then(function () { return { deactivated: true }; });
          return client.from('equipment').delete().eq('id', id).then(unwrap).then(function () { return { deactivated: false }; });
        });
      },
      resolveIssue: function (id, note) { return client.rpc('resolve_issue', { p_equipment_id: id, p_note: str(note) }).then(unwrap).then(function () { return fetchEquipment(id); }); },

      listEntries: function (opts) {
        opts = opts || {};
        var q = client.from('log_entries').select('*');
        if (opts.equipmentId) q = q.eq('equipment_id', opts.equipmentId);
        if (opts.userId) q = q.eq('user_id', opts.userId);
        if (opts.from) q = q.gte('start_at', new Date(opts.from + 'T00:00:00').toISOString());
        if (opts.to) q = q.lte('start_at', new Date(opts.to + 'T23:59:59.999').toISOString());
        if (!(opts.includeDeleted && isAdmin())) q = q.eq('deleted', false);
        return q.order('start_at', { ascending: false }).limit(2000).then(unwrap).then(function (rows) { return rows.map(toEntry); });
      },
      getEntry: fetchEntry,
      startEntry: function (p) {
        var err = needUser(); if (err) return reject(err);
        var u = currentUser();
        var start = toISO(p.start) || nowISO();
        var terr = checkTimes(start, null, LS); if (terr) return reject(terr);
        var purpose = str(p.purpose); if (!purpose) return reject('목적·내용을 입력하세요.');
        return fetchEquipment(p.equipmentId).then(function (eq) {
          if (!eq || eq.active === false) throw new Error('장비를 찾을 수 없습니다.');
          var row = fromEntry({ equipmentId: eq.id, userId: u.id, userName: u.name, start: start, end: null, sample: str(p.sample), purpose: purpose, values: cleanValues(eq, p.values), condition: 'normal', issues: '', note: '', status: 'open', closedAt: null });
          return client.from('log_entries').insert(row).select().single().then(unwrap).then(toEntry);
        });
      },
      closeEntry: function (id, p) {
        var err = needUser(); if (err) return reject(err);
        var u = currentUser();
        return fetchEntry(id).then(function (e) {
          if (!e || e.deleted) throw new Error('기록을 찾을 수 없습니다.');
          if (e.status !== 'open') throw new Error('이미 종료된 기록입니다.');
          if (e.userId !== u.id && !isAdmin()) throw new Error('본인 기록만 종료할 수 있습니다.');
          return fetchEquipment(e.equipmentId).then(function (eq) {
            var cerr = applyClose(e, p || {}, eq, LS); if (cerr) throw new Error(cerr);
            var patch = { end_at: e.end, sample: e.sample, params: e.values, condition: e.condition, issues: e.issues, note: e.note, status: 'closed', closed_at: e.closedAt };
            if (e.userId !== u.id) patch.updated_by = u.name;
            return updateRow(id, patch);
          });
        });
      },
      createEntry: function (p) {
        var err = needUser(); if (err) return reject(err);
        var u = currentUser();
        return fetchEquipment(p.equipmentId).then(function (eq) {
          if (!eq) throw new Error('장비를 찾을 수 없습니다.');
          var r = newEntry(u, eq, p || {}, LS); if (r.error) throw new Error(r.error);
          return client.from('log_entries').insert(fromEntry(r.entry)).select().single().then(unwrap).then(toEntry);
        });
      },
      updateEntry: function (id, p) {
        var err = needUser(); if (err) return reject(err);
        var u = currentUser(), self = this;
        return fetchEntry(id).then(function (e) {
          if (!e || e.deleted) throw new Error('기록을 찾을 수 없습니다.');
          if (!self.canEdit(e)) throw new Error('수정 기한(' + LS.editWindowDays + '일)이 지났거나 권한이 없습니다. 관리자에게 요청하세요.');
          return fetchEquipment(e.equipmentId).then(function (eq) {
            var perr = applyPatch(e, p || {}, eq, LS); if (perr) throw new Error(perr);
            return updateRow(id, { start_at: e.start, end_at: e.end, sample: e.sample, purpose: e.purpose, params: e.values, condition: e.condition, issues: e.issues, note: e.note, updated_by: u.name });
          });
        });
      },
      deleteEntry: function (id, reason) {
        var err = needUser(); if (err) return reject(err);
        var u = currentUser();
        return fetchEntry(id).then(function (e) {
          if (!e || e.deleted) throw new Error('기록을 찾을 수 없습니다.');
          var own = e.userId === u.id && e.status === 'open';
          if (!isAdmin() && !own) throw new Error('기록 삭제는 관리자만 할 수 있습니다. 본인의 사용 중 기록만 취소할 수 있습니다.');
          reason = str(reason);
          if (isAdmin() && !own && !reason) throw new Error('삭제 사유를 입력하세요.');
          return updateRow(id, { deleted: true, deleted_at: nowISO(), deleted_by: u.name, delete_reason: reason || (own ? '사용 시작 취소' : '') }).then(function () {});
        });
      },
      restoreEntry: function (id) {
        if (!isAdmin()) return reject('관리자만 할 수 있습니다.');
        return updateRow(id, { deleted: false, deleted_at: null, deleted_by: null, delete_reason: '' });
      },
      listAudit: function () {
        if (!isAdmin()) return reject('관리자만 할 수 있습니다.');
        return client.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500).then(unwrap).then(function (rows) { return rows.map(toAudit); });
      },

      onChange: function (cb) { listeners.push(cb); return function () { listeners = listeners.filter(function (x) { return x !== cb; }); }; },
      exportJSON: null, importJSON: null, resetDemo: null
    };
  }

  window.DSILStore = {
    create: function (cfg) { cfg = cfg || {}; return cfg.backend === 'supabase' ? SupabaseStore(cfg) : LocalStore(cfg); },
    hashPin: hashPin, normFields: normFields, fieldMap: fieldMap
  };
})();
