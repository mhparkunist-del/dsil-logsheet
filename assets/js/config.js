/* =====================================================================
   DSIL Log Sheet – runtime configuration
   ---------------------------------------------------------------------
   backend
     'local'    : 브라우저 localStorage 에 저장 (설치 없이 바로 동작, 데모/개인용)
     'supabase' : Supabase(Postgres) 공용 DB 사용 – 연구실 전체가 같은 로그시트를 봄
                  → supabase/schema.sql 을 Supabase SQL Editor 에서 실행한 뒤
                    아래 supabaseUrl / supabaseAnonKey 를 채우세요.
   ===================================================================== */
window.DSIL_CONFIG = {
  backend: 'local',

  supabaseUrl: '',
  supabaseAnonKey: '',

  /* 관리자 탭에 들어갈 때마다 묻는 PIN. 공용 DB 모드에서는 profiles.is_admin 인 사람만 이 단계까지 옵니다. */
  adminPin: '0000',
  /* PIN 을 맞힌 뒤 관리자 잠금이 유지되는 시간(분). 지나면 다시 묻습니다. */
  adminUnlockMinutes: 10,

  /* 기본 계정 (local 모드): 처음 열 때 없으면 승인된 구성원으로 만들어 둡니다. 같은 이름이 이미 있으면 건드리지 않습니다.
     PIN 은 저장 시 SHA-256 으로 해시되며, 각자 로그인 후 바꾸는 것을 권장합니다. 슈퍼계정 "관리자 / 0000" 은 항상 있습니다. */
  defaultAccounts: [
    { name: '이현진', pin: '0000' },
    { name: '백승훈', pin: '0000' },
    { name: '위동진', pin: '0000' },
    { name: '김형준', pin: '0000' },
    { name: '음성민', pin: '0000' },
    { name: '양희수', pin: '0000' }
  ],

  /* 기본 장비 (local 모드): 이름이 같은 장비가 없으면 만들어 둡니다.
     template 은 아래 fieldTemplates 의 키. fields 를 직접 주면 template 보다 우선합니다. */
  defaultEquipment: [
    { name: '프로브 스테이션', location: 'E3-3 2302호', managerName: '백승훈', color: '#004191', template: 'probe', allowConcurrent: false,
      rules: '사용 후 척을 원위치하고 광원을 끕니다. 프로브 팁 손상 시 즉시 담당자에게 알립니다.' }
  ],

  /* 장비별 로그시트 항목(공정·측정 조건) 템플릿. 관리자 탭에서 장비를 만들 때 고르고, 항목은 자유롭게 고쳐 쓸 수 있습니다.
     type: text | number | select | textarea, unit 은 표시용, options 는 select 전용. */
  fieldTemplates: {
    generic:    { label: '기본 (조건 항목 없음)', fields: [] },
    probe:      { label: '프로브 스테이션 · 전기 측정', fields: [
      { key: 'meas',  label: '측정 항목', type: 'select', options: ['I-V', 'C-V', 'Transfer', 'Output', 'Pulse', '기타'], required: true },
      { key: 'chuck', label: '척 온도', type: 'number', unit: '°C' },
      { key: 'probe', label: '프로브 / 카드', type: 'text' }
    ] },
    furnace:    { label: '퍼니스 · CVD', fields: [
      { key: 'temp',     label: '온도', type: 'number', unit: '°C', required: true },
      { key: 'gas',      label: '가스', type: 'text' },
      { key: 'flow',     label: '유량', type: 'number', unit: 'sccm' },
      { key: 'pressure', label: '압력', type: 'number', unit: 'Torr' },
      { key: 'time',     label: '공정 시간', type: 'number', unit: 'min' }
    ] },
    deposition: { label: '스퍼터 · 이베퍼레이터 · ALD', fields: [
      { key: 'target',    label: '타겟 / 소스', type: 'text', required: true },
      { key: 'power',     label: '파워', type: 'number', unit: 'W' },
      { key: 'pressure',  label: '압력', type: 'number', unit: 'mTorr' },
      { key: 'time',      label: '공정 시간', type: 'number', unit: 'min' },
      { key: 'thickness', label: '두께', type: 'number', unit: 'nm' }
    ] },
    etch:       { label: 'RIE · 플라즈마', fields: [
      { key: 'gas',      label: '가스 / 유량', type: 'text' },
      { key: 'power',    label: '파워', type: 'number', unit: 'W' },
      { key: 'pressure', label: '압력', type: 'number', unit: 'mTorr' },
      { key: 'time',     label: '공정 시간', type: 'number', unit: 's' }
    ] },
    spin:       { label: '스핀코터 · 핫플레이트', fields: [
      { key: 'material', label: '물질 / 레지스트', type: 'text' },
      { key: 'rpm',      label: '회전 속도', type: 'number', unit: 'rpm' },
      { key: 'time',     label: '시간', type: 'number', unit: 's' },
      { key: 'bake',     label: '베이크', type: 'text', unit: '°C / min' }
    ] },
    analysis:   { label: '현미경 · 분석 장비', fields: [
      { key: 'mode',  label: '모드', type: 'text' },
      { key: 'mag',   label: '배율 / 조건', type: 'text' },
      { key: 'files', label: '저장 파일 / 폴더', type: 'text' }
    ] }
  },

  /* 로그시트 규칙 */
  logsheet: {
    editWindowDays: 7,          /* 본인 기록을 고칠 수 있는 기간(일). 지나면 관리자만 수정 */
    maxHours: 48,               /* 1건 최대 사용 시간(시간). 넘으면 입력 오류로 간주 */
    futureToleranceMinutes: 5,  /* 시작·종료 시각이 현재보다 이만큼 이상 미래이면 거부 */
    printBlankRows: 5,          /* 인쇄용 로그시트 끝에 붙는 빈 줄 수 (손으로 이어 쓸 때) */
    recentLimit: 12             /* 홈 화면 최근 기록 표시 개수 */
  },

  /* 보안: 로그인 잠금·매크로 의심 감지·알림 */
  security: {
    maxLoginFailures: 5,       /* 같은 이름으로 연속 실패 허용 횟수. 넘으면 잠금 */
    lockoutMinutes: 10,        /* 잠금 시간(분) */
    macroThresholdMs: 1200,    /* 페이지가 뜬 뒤 이 시간(ms) 안에 제출되면 매크로 의심으로 기록·알림 */
    /* 알림 웹훅(Discord 또는 Slack incoming webhook URL). 비우면 관리자 화면의 보안 이벤트에만 남습니다.
       이 파일은 공개 저장소에 올라가므로 웹훅 주소가 노출됩니다. 노출이 싫으면 공용 DB 모드에서 DB 웹훅을 쓰세요. */
    alertWebhookUrl: ''
  },

  /* local 모드 첫 실행 시 예시 기록을 채울지 여부. false 면 계정·장비만 있는 빈 로그시트로 시작합니다. */
  seedDemoData: false,

  portalUrl: 'https://mhparkunist-del.github.io/dsil-portal/',
  labName: 'Device-to-System Integration Lab (DSIL)',
  university: 'KAIST'
};
