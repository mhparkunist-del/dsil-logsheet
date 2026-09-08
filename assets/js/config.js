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

  /* 공정 모듈 분류. id 는 저장 키이므로 운영 중에 바꾸지 마세요. color 는 Tabler 색 이름. */
  categories: [
    { id: 'clean',    label: '세정 · 준비',   color: 'blue' },
    { id: 'growth',   label: '성장 · 합성',   color: 'green' },
    { id: 'transfer', label: '박리 · 전사',   color: 'teal' },
    { id: 'litho',    label: '리소그래피',    color: 'purple' },
    { id: 'depo',     label: '증착',          color: 'orange' },
    { id: 'etch',     label: '식각 · 리프트오프', color: 'red' },
    { id: 'thermal',  label: '열처리',        color: 'yellow' },
    { id: 'meas',     label: '측정 · 검사',   color: 'cyan' },
    { id: 'etc',      label: '기타',          color: 'secondary' }
  ],

  /* 런 코드: <prefix>-YYMMDD-NN (그날 몇 번째 런인지) */
  runCodePrefix: 'R',

  /* 처음 열 때 assets/data/library.js 의 예시 모듈·공정 흐름(MoS2 소자 공정)을 라이브러리에 넣을지.
     이미 같은 id 가 있으면 건드리지 않습니다. false 면 빈 라이브러리로 시작합니다. */
  seedLibrary: true,

  /* 스텝 사진: 브라우저에서 긴 변 maxEdge 픽셀 JPEG 로 줄여 저장 (local: IndexedDB, supabase: Storage 버킷 run-photos) */
  photo: { maxEdge: 1400, quality: 0.85, maxPerStep: 6 },

  /* 홈 화면 최근 활동 표시 개수 */
  recentLogs: 15,

  portalUrl: 'https://mhparkunist-del.github.io/dsil-portal/',
  labName: 'Device-to-System Integration Lab (DSIL)',
  university: 'KAIST'
};
