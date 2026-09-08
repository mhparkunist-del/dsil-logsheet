/* =====================================================================
   DSIL Run Sheet – runtime configuration
   ---------------------------------------------------------------------
   backend
     'local'    : 브라우저 localStorage 에 저장 (설치 없이 바로 동작, 개인·데모용)
     'supabase' : Supabase(Postgres) 공용 DB – 연구실 전체가 같은 런시트를 봄
                  → supabase/schema.sql 을 Supabase SQL Editor 에서 실행한 뒤
                    아래 supabaseUrl / supabaseAnonKey 를 채우세요. (로그인 없음: URL 을 아는 사람은 누구나 읽고 씀)
   ===================================================================== */
window.DSIL_CONFIG = {
  backend: 'local',

  supabaseUrl: '',
  supabaseAnonKey: '',

  /* 공정 분류(대분류). 모듈·흐름·런이 모두 이 중 하나에 속합니다. id 는 저장 키. */
  domains: [
    { id: 'device',  label: '반도체 소자 공정', short: '소자',   icon: 'cpu' },
    { id: 'package', label: '패키징 공정',      short: '패키징', icon: 'package' }
  ],

  /* 공정 모듈 세부 분류. id 는 저장 키이므로 운영 중에 바꾸지 마세요. color 는 Tabler 색 이름. */
  categories: [
    { id: 'clean',    label: '세정 · 준비',   color: 'blue' },
    { id: 'growth',   label: '성장 · 합성',   color: 'green' },
    { id: 'transfer', label: '박리 · 전사',   color: 'teal' },
    { id: 'litho',    label: '리소그래피',    color: 'purple' },
    { id: 'depo',     label: '증착',          color: 'orange' },
    { id: 'etch',     label: '식각 · 리프트오프', color: 'red' },
    { id: 'thermal',  label: '열처리',        color: 'yellow' },
    { id: 'meas',     label: '측정 · 검사',   color: 'cyan' },
    { id: 'assembly', label: '조립 · 본딩',   color: 'indigo' },
    { id: 'encap',    label: '몰딩 · 봉지',   color: 'lime' },
    { id: 'reliab',   label: '신뢰성',        color: 'pink' },
    { id: 'etc',      label: '기타',          color: 'secondary' }
  ],

  /* 팀 이름 목록(가입·런 작성 시 선택, 직접 입력도 가능). 런·기록에 쓰인 팀은 자동으로 목록에 더해집니다. */
  teams: ['2D 소자팀', '메모리 소자팀', '패키징팀', '측정·분석팀'],

  /* 기판 단위 라벨 선택지: 런마다 "기판 4개", "웨이퍼 2장" 처럼 정합니다. (직접 입력도 가능) */
  unitLabels: ['기판', '웨이퍼', '샘플', '칩', '다이', '패키지'],

  /* 로그인: 이름 + PIN(숫자 4~8자리). 처음 열 때 없으면 만들어 두는 계정. 슈퍼계정 "관리자 / 0000" 은 항상 있습니다.
     PIN 은 SHA-256 으로 해시 저장되며 각자 로그인 후 바꾸는 것을 권장합니다. 팀이 비어 있으면 첫 로그인 때 묻습니다. */
  defaultAccounts: [
    { name: '이현진', pin: '0000', team: '' },
    { name: '백승훈', pin: '0000', team: '' },
    { name: '위동진', pin: '0000', team: '' },
    { name: '김형준', pin: '0000', team: '' },
    { name: '음성민', pin: '0000', team: '' },
    { name: '양희수', pin: '0000', team: '' }
  ],
  /* 회원가입(이름·팀·PIN) 허용 여부. false 면 관리자가 계정을 만들어야 합니다. */
  allowSignup: true,

  /* 런 코드: <prefix>-YYMMDD-NN (그날 몇 번째 런인지) */
  runCodePrefix: 'R',

  /* 처음 열 때 assets/data/library.js 의 예시 모듈·공정 흐름을 라이브러리에 넣을지. 같은 id 가 있으면 건드리지 않습니다. */
  seedLibrary: true,

  /* 스텝 사진: 브라우저에서 긴 변 maxEdge 픽셀 JPEG 로 줄여 저장 (local: IndexedDB, supabase: Storage 버킷 run-photos) */
  photo: { maxEdge: 1400, quality: 0.85, maxPerStep: 6 },

  /* 홈 화면 최근 활동 표시 개수 */
  recentLogs: 20,

  /* PPT 출력: 16:9 한 장에 스플릿 표(열 = 기판, 행 = 공정)로 맞춤 */
  pptx: { fontFace: 'Malgun Gothic', minFontPt: 5, maxFontPt: 10 },

  portalUrl: 'https://mhparkunist-del.github.io/dsil-portal/',
  labName: 'Device-to-System Integration Lab (DSIL)',
  university: 'KAIST'
};
