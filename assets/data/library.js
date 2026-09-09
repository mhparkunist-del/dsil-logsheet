/* =====================================================================
   DSIL Run Sheet – 예시 라이브러리 (반도체 소자 공정 + 패키징 공정)
   처음 열 때 config.seedLibrary 가 true 면 라이브러리에 들어갑니다(기본 제공 = 수정·삭제 불가, 복사만).
   version 이 바뀌면 기본 제공 항목은 이 파일 내용으로 갱신됩니다. 개인이 만든 항목은 건드리지 않습니다.
   domain: device(반도체 소자) | package(패키징)   field.type: text | number | select | textarea | check

   흐름(런시트 템플릿) = 행(큰 스텝) × 열(기판 단위) 시트
     rows:   [{ id, category(대분류), name, note, cells: { all: 모듈참조 | <분기id>: 모듈참조 } }]   셀이 없는 분기는 그 행을 건너뜀
     splits: [{ id, name, parentId:'all'|<상위 분기id>, fromRowId, toRowId|null, branches:[{ id, name, count }] }]
     모듈참조 = { moduleId, params(모듈 기본값과 다른 계획 조건), label(표시 이름) }
   ===================================================================== */
(function () {
  function M(moduleId, params, label) { return { moduleId: moduleId, params: params || {}, label: label || '' }; }
  function R(id, category, name, cells, note) { return { id: id, category: category, name: name, note: note || '', cells: cells }; }
  function A(id, category, name, moduleId, params, note) { return R(id, category, name, { all: M(moduleId, params) }, note); }

  window.DSIL_LIBRARY = {
    version: '2026-09-09b',
    /* 자주 쓰는 기판 · 재료 (새 런 / 런 정보의 "기판 · 재료" 드롭다운). domain '' = 두 분류 모두 */
    materials: [
      { id: 'mat-sio2-285', domain: 'device', name: 'SiO2 285 nm / p++ Si', description: '표준 백게이트 기판 (열산화막 285 nm, 2D 플레이크 콘트라스트 최적)' },
      { id: 'mat-sio2-90', domain: 'device', name: 'SiO2 90 nm / p++ Si', description: '얇은 게이트 산화막 백게이트 기판' },
      { id: 'mat-sio2-300', domain: 'device', name: 'SiO2 300 nm / p++ Si', description: '열산화막 300 nm 백게이트 기판' },
      { id: 'mat-si-bare', domain: 'device', name: 'Si (100) bare', description: '산화막 없는 실리콘 웨이퍼' },
      { id: 'mat-hbn-sio2', domain: 'device', name: 'hBN / SiO2 285 nm / p++ Si', description: 'hBN 을 먼저 전사한 백게이트 기판' },
      { id: 'mat-sapphire', domain: 'device', name: 'Sapphire (c-plane, 0001)', description: 'CVD 성장용 사파이어 기판' },
      { id: 'mat-quartz', domain: 'device', name: 'Quartz (fused silica)', description: '투명 · 절연 기판 (광학 측정)' },
      { id: 'mat-glass', domain: 'device', name: 'Glass (Eagle XG)', description: '디스플레이용 무알칼리 유리' },
      { id: 'mat-pet', domain: 'device', name: 'PET 필름', description: '유연 소자용 폴리에스터 필름' },
      { id: 'mat-pi', domain: 'device', name: 'PI (폴리이미드) 필름', description: '내열 유연 기판' },
      { id: 'mat-prepattern-au', domain: 'device', name: 'Au 프리패턴 전극 기판', description: '전극이 미리 형성된 SiO2/Si 기판' },
      { id: 'mat-dip24', domain: 'package', name: 'DIP-24 패키지', description: '와이어 본딩용 세라믹 DIP' },
      { id: 'mat-qfn32', domain: 'package', name: 'QFN-32 패키지', description: '리드리스 QFN' },
      { id: 'mat-fr4', domain: 'package', name: 'FR-4 PCB 기판', description: '플립칩 · 모듈 실장용 PCB' },
      { id: 'mat-ltcc', domain: 'package', name: 'LTCC 기판', description: '저온 동시소성 세라믹' },
      { id: 'mat-si-interposer', domain: 'package', name: 'Si 인터포저', description: 'TSV 실리콘 인터포저' },
      { id: 'mat-glass-interposer', domain: 'package', name: '유리 인터포저', description: 'TGV 유리 인터포저' }
    ],
    modules: [
      /* ---------- 반도체 소자 공정 ---------- */
      { id: 'm-substrate-clean', domain: 'device', name: '기판 용매 세정', category: 'clean', equipment: '습식 벤치 · 초음파 세척기', minutes: 20,
        description: 'SiO2/Si 기판의 유기물·파티클 제거.',
        fields: [
          { key: 'seq', label: '용매 순서', type: 'select', options: ['아세톤 → IPA → DI', '아세톤 → IPA', 'IPA'], default: '아세톤 → IPA → DI', required: true },
          { key: 'sonic', label: '초음파 시간', type: 'number', unit: 'min', default: 5 },
          { key: 'temp', label: '용액 온도', type: 'number', unit: '°C', default: 25 },
          { key: 'dry', label: 'N2 건조', type: 'check', default: true }
        ],
        checklist: ['기판 뒷면 긁힘·오염 확인', '핫플레이트 110 °C 탈수 베이크 2 min'] },
      { id: 'm-piranha', domain: 'device', name: '피라냐 세정', category: 'clean', equipment: '산 처리 벤치', minutes: 30,
        description: 'H2SO4:H2O2 로 강한 유기물 제거. 반드시 보호구 착용.',
        fields: [
          { key: 'ratio', label: 'H2SO4 : H2O2', type: 'text', default: '3 : 1', required: true },
          { key: 'time', label: '처리 시간', type: 'number', unit: 'min', default: 10 },
          { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 90 }
        ],
        checklist: ['면 보호구·앞치마·내산 장갑 착용', '산을 물에 넣는 순서 준수', '폐액은 산 폐액통'] },
      { id: 'm-o2-plasma', domain: 'device', name: 'O2 플라즈마 처리', category: 'clean', equipment: '플라즈마 애셔', minutes: 10,
        description: '레지스트 찌꺼기 제거·표면 활성화.',
        fields: [
          { key: 'power', label: '파워', type: 'number', unit: 'W', default: 50, required: true },
          { key: 'pressure', label: '압력', type: 'number', unit: 'mTorr', default: 300 },
          { key: 'flow', label: 'O2 유량', type: 'number', unit: 'sccm', default: 20 },
          { key: 'time', label: '시간', type: 'number', unit: 's', default: 60 }
        ], checklist: [] },
      { id: 'm-exfoliation', domain: 'device', name: '기계적 박리 (MoS2)', category: 'transfer', equipment: '박리 벤치 · 핫플레이트', minutes: 40,
        description: '스카치 테이프로 벌크 결정에서 박리해 SiO2/Si 기판에 전사.',
        fields: [
          { key: 'crystal', label: '벌크 결정', type: 'text', default: 'MoS2 (2H, HQ Graphene)', required: true },
          { key: 'tape', label: '테이프', type: 'select', options: ['Scotch Magic', 'Nitto BT-150', 'PDMS 스탬프'], default: 'Scotch Magic' },
          { key: 'substrate', label: '기판', type: 'text', default: 'SiO2 285 nm / p++ Si' },
          { key: 'heat', label: '기판 가열', type: 'number', unit: '°C', default: 100 },
          { key: 'time', label: '테이프 유지 시간', type: 'number', unit: 'min', default: 2 }
        ],
        checklist: ['테이프 접힘 횟수 기록', '박리 직전 O2 플라즈마 여부 기록'] },
      { id: 'm-cvd-mos2', domain: 'device', name: 'CVD MoS2 성장', category: 'growth', equipment: '3-zone 튜브 퍼니스 (CVD)', minutes: 180,
        description: 'MoO3 + S 분말 CVD 성장.',
        fields: [
          { key: 'tgrowth', label: '성장 온도', type: 'number', unit: '°C', default: 750, required: true },
          { key: 'tmoo3', label: 'MoO3 존 온도', type: 'number', unit: '°C', default: 750 },
          { key: 'ts', label: 'S 존 온도', type: 'number', unit: '°C', default: 180 },
          { key: 'moo3', label: 'MoO3 양', type: 'number', unit: 'mg', default: 5 },
          { key: 's', label: 'S 양', type: 'number', unit: 'mg', default: 200 },
          { key: 'ar', label: 'Ar 유량', type: 'number', unit: 'sccm', default: 80 },
          { key: 'pressure', label: '압력', type: 'select', options: ['대기압', '저압'], default: '대기압' },
          { key: 'time', label: '성장 시간', type: 'number', unit: 'min', default: 10 },
          { key: 'ramp', label: '승온 속도', type: 'number', unit: '°C/min', default: 20 },
          { key: 'promoter', label: '프로모터 (NaCl 등)', type: 'text' }
        ],
        checklist: ['튜브 누설 검사 후 Ar 퍼지 30 min', '기판 위치(보트 중심으로부터 mm) 기록', '냉각 후 개방'] },
      { id: 'm-pmma-transfer', domain: 'device', name: 'PMMA 습식 전사', category: 'transfer', equipment: '습식 벤치 · 스핀코터', minutes: 120,
        description: '성장 기판 위 MoS2 를 PMMA 지지층으로 떼어 타겟 기판에 전사.',
        fields: [
          { key: 'pmma', label: 'PMMA', type: 'text', default: '950 A4' },
          { key: 'rpm', label: '스핀 속도', type: 'number', unit: 'rpm', default: 3000 },
          { key: 'bake', label: '베이크', type: 'text', default: '150 °C / 5 min' },
          { key: 'etchant', label: '분리 용액', type: 'select', options: ['KOH 2M', 'BOE', 'DI 물 (수 보조)'], default: 'KOH 2M', required: true },
          { key: 'etchtime', label: '분리 시간', type: 'number', unit: 'min', default: 30 },
          { key: 'rinse', label: 'DI 헹굼 횟수', type: 'number', default: 3 },
          { key: 'target', label: '타겟 기판', type: 'text', default: 'SiO2 285 nm / p++ Si' },
          { key: 'remove', label: 'PMMA 제거', type: 'text', default: '아세톤 60 °C 30 min + IPA' }
        ],
        checklist: ['전사 후 자연 건조 ≥ 1 h', 'PMMA 제거 전 80 °C 베이크로 밀착'] },
      { id: 'm-om-inspect', domain: 'device', name: 'OM 검사 · 플레이크 탐색', category: 'meas', equipment: '광학 현미경', minutes: 30,
        description: '플레이크 위치·층수 후보 기록.',
        fields: [
          { key: 'mag', label: '배율', type: 'select', options: ['5x', '10x', '20x', '50x', '100x'], default: '50x' },
          { key: 'coords', label: '플레이크 좌표 / 표시', type: 'textarea' },
          { key: 'layers', label: '층수 추정', type: 'text', default: '1L' },
          { key: 'files', label: '이미지 파일 / 폴더', type: 'text' }
        ], checklist: [] },
      { id: 'm-raman-pl', domain: 'device', name: '라만 · PL 측정', category: 'meas', equipment: '라만 분광기', minutes: 40,
        description: '층수·품질 확인 (E2g/A1g 간격, PL 피크).',
        fields: [
          { key: 'laser', label: '레이저 파장', type: 'select', options: ['532 nm', '633 nm', '785 nm'], default: '532 nm' },
          { key: 'power', label: '레이저 파워', type: 'number', unit: 'mW', default: 0.5 },
          { key: 'exposure', label: '노출 시간', type: 'number', unit: 's', default: 10 },
          { key: 'acc', label: '누적 횟수', type: 'number', default: 3 },
          { key: 'grating', label: '격자', type: 'select', options: ['600 gr/mm', '1800 gr/mm'], default: '1800 gr/mm' },
          { key: 'result', label: '피크 간격 / PL 피크', type: 'text' }
        ], checklist: [] },
      { id: 'm-afm', domain: 'device', name: 'AFM 두께 측정', category: 'meas', equipment: 'AFM', minutes: 40,
        fields: [
          { key: 'mode', label: '모드', type: 'select', options: ['Tapping', 'Contact', 'PeakForce'], default: 'Tapping' },
          { key: 'scan', label: '스캔 크기', type: 'number', unit: 'µm', default: 10 },
          { key: 'thickness', label: '측정 두께', type: 'number', unit: 'nm' }
        ], checklist: [] },
      { id: 'm-spin-pmma', domain: 'device', name: 'PMMA 스핀코팅 (EBL)', category: 'litho', equipment: '스핀코터 · 핫플레이트', minutes: 15,
        fields: [
          { key: 'resist', label: '레지스트', type: 'select', options: ['PMMA 950 A4', 'PMMA 950 A2', 'MMA/PMMA 이중층'], default: 'PMMA 950 A4', required: true },
          { key: 'rpm', label: '스핀 속도', type: 'number', unit: 'rpm', default: 4000 },
          { key: 'time', label: '스핀 시간', type: 'number', unit: 's', default: 60 },
          { key: 'bake', label: '소프트베이크 온도', type: 'number', unit: '°C', default: 180 },
          { key: 'baketime', label: '베이크 시간', type: 'number', unit: 'min', default: 2 }
        ],
        checklist: ['기판 가장자리 비드 확인', '레지스트 유효기한 확인'] },
      { id: 'm-spin-pr', domain: 'device', name: 'PR 스핀코팅', category: 'litho', equipment: '스핀코터 · 핫플레이트', minutes: 15,
        fields: [
          { key: 'resist', label: '레지스트', type: 'select', options: ['AZ 5214E', 'AZ GXR-601', 'S1813', 'LOR 3A + S1813'], default: 'AZ 5214E', required: true },
          { key: 'hmds', label: 'HMDS 처리', type: 'check', default: true },
          { key: 'rpm', label: '스핀 속도', type: 'number', unit: 'rpm', default: 4000 },
          { key: 'time', label: '스핀 시간', type: 'number', unit: 's', default: 40 },
          { key: 'bake', label: '소프트베이크', type: 'text', default: '110 °C / 60 s' }
        ], checklist: [] },
      { id: 'm-ebl', domain: 'device', name: '전자빔 리소그래피 (EBL)', category: 'litho', equipment: 'EBL (JEOL/Raith)', minutes: 90,
        fields: [
          { key: 'kv', label: '가속 전압', type: 'number', unit: 'kV', default: 30 },
          { key: 'aperture', label: '개구', type: 'number', unit: 'µm', default: 10 },
          { key: 'current', label: '빔 전류', type: 'number', unit: 'nA' },
          { key: 'dose', label: '도즈', type: 'number', unit: 'µC/cm²', default: 300, required: true },
          { key: 'field', label: '필드 크기', type: 'number', unit: 'µm', default: 100 },
          { key: 'pattern', label: '패턴 파일', type: 'text' },
          { key: 'align', label: '정렬 마크 / 오차', type: 'text' }
        ],
        checklist: ['정렬 마크 좌표 기록', '도즈 테스트 결과 참고'] },
      { id: 'm-photo-expose', domain: 'device', name: '포토 노광 (마스크 얼라이너)', category: 'litho', equipment: '마스크 얼라이너', minutes: 20,
        fields: [
          { key: 'mask', label: '마스크', type: 'text', required: true },
          { key: 'mode', label: '노광 모드', type: 'select', options: ['Hard contact', 'Soft contact', 'Proximity', 'Vacuum'], default: 'Hard contact' },
          { key: 'time', label: '노광 시간', type: 'number', unit: 's', default: 8 },
          { key: 'intensity', label: '광 세기', type: 'number', unit: 'mW/cm²' },
          { key: 'reversal', label: '이미지 리버설 (베이크/플러드)', type: 'text', default: '120 °C 2 min + flood 60 s' },
          { key: 'align', label: '정렬 오차', type: 'number', unit: 'µm' }
        ], checklist: ['램프 세기 측정값 기록'] },
      { id: 'm-develop', domain: 'device', name: '현상', category: 'litho', equipment: '습식 벤치', minutes: 10,
        fields: [
          { key: 'dev', label: '현상액', type: 'select', options: ['MIBK:IPA 1:3', 'AZ 300 MIF', 'AZ 400K 1:4', 'MF-319'], default: 'MIBK:IPA 1:3', required: true },
          { key: 'time', label: '현상 시간', type: 'number', unit: 's', default: 60 },
          { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 22 },
          { key: 'rinse', label: '린스', type: 'text', default: 'IPA 30 s → N2' },
          { key: 'check', label: '현미경 확인', type: 'check', default: true }
        ], checklist: ['패턴 열림·잔막 확인 후 다음 단계'] },
      { id: 'm-ebeam-evap', domain: 'device', name: '전자빔 금속 증착', category: 'depo', equipment: 'E-beam Evaporator', minutes: 120,
        fields: [
          { key: 'stack', label: '금속 / 두께', type: 'text', default: 'Cr 5 nm / Au 50 nm', required: true },
          { key: 'rate', label: '증착 속도', type: 'text', default: '0.5 / 1.0 Å/s' },
          { key: 'pressure', label: '기저 압력', type: 'text', default: '< 2e-6 Torr' },
          { key: 'rotate', label: '기판 회전', type: 'check', default: true },
          { key: 'tilt', label: '기판 틸트', type: 'number', unit: '°', default: 0 }
        ],
        checklist: ['크리스탈 센서 수명 확인', '실제 증착 두께(센서) 기록'] },
      { id: 'm-thermal-evap', domain: 'device', name: '열 증착', category: 'depo', equipment: 'Thermal Evaporator', minutes: 90,
        fields: [
          { key: 'metal', label: '금속', type: 'text', default: 'Au', required: true },
          { key: 'thickness', label: '두께', type: 'number', unit: 'nm', default: 50 },
          { key: 'current', label: '보트 전류', type: 'number', unit: 'A' },
          { key: 'pressure', label: '압력', type: 'text', default: '< 5e-6 Torr' }
        ], checklist: [] },
      { id: 'm-sputter', domain: 'device', name: '스퍼터 증착', category: 'depo', equipment: 'Sputter', minutes: 60,
        fields: [
          { key: 'target', label: '타겟', type: 'text', required: true },
          { key: 'power', label: '파워', type: 'number', unit: 'W', default: 100 },
          { key: 'pressure', label: '공정 압력', type: 'number', unit: 'mTorr', default: 5 },
          { key: 'gas', label: '가스 / 유량', type: 'text', default: 'Ar 20 sccm' },
          { key: 'time', label: '시간', type: 'number', unit: 'min' },
          { key: 'thickness', label: '목표 두께', type: 'number', unit: 'nm' }
        ], checklist: [] },
      { id: 'm-ald', domain: 'device', name: 'ALD 유전막', category: 'depo', equipment: 'ALD', minutes: 150,
        fields: [
          { key: 'material', label: '물질 / 전구체', type: 'select', options: ['Al2O3 (TMA + H2O)', 'HfO2 (TDMAH + H2O)', 'Al2O3 시드 + HfO2'], default: 'Al2O3 (TMA + H2O)', required: true },
          { key: 'temp', label: '공정 온도', type: 'number', unit: '°C', default: 150 },
          { key: 'cycles', label: '사이클 수', type: 'number', default: 300 },
          { key: 'thickness', label: '목표 두께', type: 'number', unit: 'nm', default: 30 },
          { key: 'purge', label: '퍼지 시간', type: 'number', unit: 's', default: 20 },
          { key: 'seed', label: '시드층 / 전처리', type: 'text' }
        ], checklist: ['챔버 컨디셔닝 여부 기록', '두께 엘립소미터 측정값 기록'] },
      { id: 'm-liftoff', domain: 'device', name: '리프트오프', category: 'etch', equipment: '습식 벤치', minutes: 60,
        fields: [
          { key: 'solvent', label: '용액', type: 'select', options: ['아세톤', 'PG Remover', 'NMP'], default: '아세톤', required: true },
          { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 60 },
          { key: 'time', label: '시간', type: 'number', unit: 'min', default: 30 },
          { key: 'sonic', label: '초음파', type: 'text', default: '없음 (필요 시 5 s)' },
          { key: 'rinse', label: '린스', type: 'text', default: 'IPA → N2' }
        ], checklist: ['금속 잔류·들뜸 현미경 확인'] },
      { id: 'm-rie', domain: 'device', name: 'RIE 식각', category: 'etch', equipment: 'RIE', minutes: 30,
        fields: [
          { key: 'gas', label: '가스 / 유량', type: 'text', default: 'SF6 20 sccm / O2 5 sccm', required: true },
          { key: 'power', label: 'RF 파워', type: 'number', unit: 'W', default: 50 },
          { key: 'pressure', label: '압력', type: 'number', unit: 'mTorr', default: 20 },
          { key: 'time', label: '시간', type: 'number', unit: 's', default: 20 },
          { key: 'depth', label: '식각 깊이 / 결과', type: 'text' }
        ], checklist: ['챔버 O2 클리닝 후 진행'] },
      { id: 'm-wet-etch', domain: 'device', name: '습식 식각', category: 'etch', equipment: '습식 벤치', minutes: 20,
        fields: [
          { key: 'etchant', label: '식각액', type: 'text', default: 'BOE 6:1', required: true },
          { key: 'time', label: '시간', type: 'number', unit: 's' },
          { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 25 }
        ], checklist: [] },
      { id: 'm-anneal', domain: 'device', name: '진공 · 분위기 어닐링', category: 'thermal', equipment: '튜브 퍼니스 (어닐링)', minutes: 180,
        fields: [
          { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 200, required: true },
          { key: 'time', label: '시간', type: 'number', unit: 'min', default: 120 },
          { key: 'atm', label: '분위기', type: 'select', options: ['진공', 'Ar', 'Ar/H2 (95/5)', 'N2'], default: 'Ar/H2 (95/5)' },
          { key: 'pressure', label: '압력', type: 'text', default: '~1e-5 Torr' },
          { key: 'ramp', label: '승온 / 냉각', type: 'text', default: '5 °C/min / 자연 냉각' }
        ], checklist: [] },
      { id: 'm-rta', domain: 'device', name: 'RTA 급속 열처리', category: 'thermal', equipment: 'RTA', minutes: 30,
        fields: [
          { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 400, required: true },
          { key: 'time', label: '유지 시간', type: 'number', unit: 's', default: 60 },
          { key: 'atm', label: '분위기', type: 'select', options: ['N2', 'Ar', 'Forming gas', '진공'], default: 'N2' },
          { key: 'ramp', label: '승온 속도', type: 'number', unit: '°C/s', default: 10 }
        ], checklist: [] },
      { id: 'm-probe-iv', domain: 'device', name: '전기 측정 (프로브 스테이션)', category: 'meas', equipment: '프로브 스테이션 · SPA', minutes: 90,
        fields: [
          { key: 'meas', label: '측정 항목', type: 'select', options: ['Transfer', 'Output', 'Transfer + Output', 'I-V', 'C-V', 'Pulse'], default: 'Transfer + Output', required: true },
          { key: 'vds', label: 'Vds', type: 'text', default: '0.1 / 1 V' },
          { key: 'vg', label: 'Vg 범위', type: 'text', default: '-40 ~ 40 V' },
          { key: 'chuck', label: '척 온도', type: 'number', unit: '°C', default: 25 },
          { key: 'env', label: '환경', type: 'select', options: ['대기', '진공', 'N2 글로브박스'], default: '대기' },
          { key: 'ndev', label: '측정 소자 수', type: 'number' },
          { key: 'files', label: '데이터 파일 / 폴더', type: 'text' }
        ], checklist: ['프로브 팁 접촉 저항 확인', '대표 소자 ID 기록'] },

      /* ---------- 패키징 공정 ---------- */
      { id: 'm-dicing', domain: 'package', name: '다이싱', category: 'assembly', equipment: '다이싱 소 (블레이드/레이저)', minutes: 60,
        description: '웨이퍼를 개별 칩으로 절단.',
        fields: [
          { key: 'method', label: '방식', type: 'select', options: ['블레이드', '레이저 (스텔스)', '플라즈마'], default: '블레이드', required: true },
          { key: 'chip', label: '칩 크기', type: 'text', default: '5 × 5 mm' },
          { key: 'speed', label: '절단 속도', type: 'number', unit: 'mm/s', default: 10 },
          { key: 'blade', label: '블레이드 / 파워', type: 'text' },
          { key: 'tape', label: '다이싱 테이프', type: 'text', default: 'UV 테이프' }
        ], checklist: ['칩핑(chipping) 현미경 검사', '절단 후 UV 조사·세정'] },
      { id: 'm-die-attach', domain: 'package', name: '다이 어태치', category: 'assembly', equipment: '다이 본더 · 경화 오븐', minutes: 90,
        fields: [
          { key: 'adhesive', label: '접착제', type: 'select', options: ['은 에폭시', '비전도성 에폭시', 'DAF 필름', '솔더'], default: '은 에폭시', required: true },
          { key: 'cure_t', label: '경화 온도', type: 'number', unit: '°C', default: 150 },
          { key: 'cure_time', label: '경화 시간', type: 'number', unit: 'min', default: 60 },
          { key: 'package', label: '패키지 / 기판', type: 'text', default: 'DIP-24' },
          { key: 'thickness', label: 'BLT (접착층 두께)', type: 'number', unit: 'µm' }
        ], checklist: ['다이 틸트·보이드 확인'] },
      { id: 'm-package', domain: 'package', name: '와이어 본딩', category: 'assembly', equipment: '와이어 본더', minutes: 60,
        fields: [
          { key: 'wire', label: '와이어', type: 'select', options: ['Au 25 µm', 'Al 25 µm', 'Cu 20 µm'], default: 'Au 25 µm', required: true },
          { key: 'method', label: '본딩 방식', type: 'select', options: ['볼 본딩', '웨지 본딩'], default: '볼 본딩' },
          { key: 'temp', label: '스테이지 온도', type: 'number', unit: '°C', default: 150 },
          { key: 'power', label: '초음파 파워 / 힘', type: 'text' },
          { key: 'pads', label: '본딩 패드 수', type: 'number' }
        ], checklist: ['풀 테스트(pull test) 결과 기록'] },
      { id: 'm-flip-bump', domain: 'package', name: '플립칩 범핑', category: 'assembly', equipment: '범핑 라인 · 리플로우', minutes: 120,
        fields: [
          { key: 'bump', label: '범프 재료', type: 'select', options: ['SnAg 솔더', 'Cu 필라 + SnAg', 'Au 스터드'], default: 'Cu 필라 + SnAg', required: true },
          { key: 'height', label: '범프 높이', type: 'number', unit: 'µm', default: 50 },
          { key: 'pitch', label: '피치', type: 'number', unit: 'µm', default: 100 },
          { key: 'ubm', label: 'UBM', type: 'text', default: 'Ti/Cu' }
        ], checklist: [] },
      { id: 'm-reflow', domain: 'package', name: '리플로우 · 플립칩 접합', category: 'assembly', equipment: '리플로우 오븐 / 플립칩 본더', minutes: 45,
        fields: [
          { key: 'peak', label: '피크 온도', type: 'number', unit: '°C', default: 245, required: true },
          { key: 'profile', label: '프로파일', type: 'text', default: '예열 150 °C 60 s → 피크 30 s' },
          { key: 'atm', label: '분위기', type: 'select', options: ['N2', '대기', '포밍가스'], default: 'N2' },
          { key: 'flux', label: '플럭스', type: 'text' }
        ], checklist: [] },
      { id: 'm-underfill', domain: 'package', name: '언더필', category: 'encap', equipment: '디스펜서 · 경화 오븐', minutes: 90,
        fields: [
          { key: 'material', label: '언더필 재료', type: 'text', default: 'CUF (모세관 언더필)' },
          { key: 'cure_t', label: '경화 온도', type: 'number', unit: '°C', default: 150 },
          { key: 'cure_time', label: '경화 시간', type: 'number', unit: 'min', default: 60 }
        ], checklist: ['보이드 검사(SAM)'] },
      { id: 'm-molding', domain: 'package', name: '몰딩 · 봉지', category: 'encap', equipment: '트랜스퍼 몰드', minutes: 60,
        fields: [
          { key: 'emc', label: 'EMC 종류', type: 'text', required: true },
          { key: 'temp', label: '몰드 온도', type: 'number', unit: '°C', default: 175 },
          { key: 'pressure', label: '압력', type: 'number', unit: 'MPa', default: 7 },
          { key: 'time', label: '경화 시간', type: 'number', unit: 's', default: 120 },
          { key: 'pmc', label: 'PMC (후경화)', type: 'text', default: '175 °C / 4 h' }
        ], checklist: ['미충진·보이드 확인'] },
      { id: 'm-pkg-inspect', domain: 'package', name: '패키지 검사 (X-ray · SAM)', category: 'meas', equipment: 'X-ray · SAM', minutes: 40,
        fields: [
          { key: 'method', label: '검사', type: 'select', options: ['X-ray', 'SAM (초음파)', 'X-ray + SAM', '단면 (cross-section)'], default: 'X-ray + SAM', required: true },
          { key: 'void', label: '보이드율', type: 'number', unit: '%' },
          { key: 'judge', label: '판정', type: 'select', options: ['양호', '조건부', '불량'] },
          { key: 'files', label: '이미지 파일', type: 'text' }
        ], checklist: [] },
      { id: 'm-reliability', domain: 'package', name: '신뢰성 시험', category: 'reliab', equipment: '열충격 챔버 · HAST', minutes: 480,
        fields: [
          { key: 'test', label: '시험', type: 'select', options: ['TC (열 사이클)', 'HAST', 'HTS (고온 보관)', '낙하'], default: 'TC (열 사이클)', required: true },
          { key: 'cond', label: '조건', type: 'text', default: '-55 ~ 125 °C' },
          { key: 'cycles', label: '사이클 / 시간', type: 'text', default: '500 cycles' },
          { key: 'judge', label: '판정', type: 'select', options: ['통과', '실패'] }
        ], checklist: ['시험 전후 전기 측정'] }
    ],

    flows: [
      { id: 'f-ebl-liftoff', domain: 'device', name: 'EBL 패터닝', device: '', unitLabel: '기판', unitCount: 1, description: 'PMMA 스핀코팅 → 전자빔 노광 → 현상. 런시트에 이어 붙이는 작은 흐름.',
        rows: [
          A('r1', 'litho', 'PMMA 스핀코팅', 'm-spin-pmma'),
          A('r2', 'litho', '전자빔 노광', 'm-ebl'),
          A('r3', 'litho', '현상', 'm-develop', { dev: 'MIBK:IPA 1:3', time: 60 })
        ], splits: [] },
      { id: 'f-photo-liftoff', domain: 'device', name: '포토리소 패터닝 (리버설)', device: '', unitLabel: '기판', unitCount: 1, description: 'PR 스핀코팅 → 노광 → 현상. 런시트에 이어 붙이는 작은 흐름.',
        rows: [
          A('r1', 'litho', 'PR 스핀코팅', 'm-spin-pr'),
          A('r2', 'litho', '포토 노광', 'm-photo-expose'),
          A('r3', 'litho', '현상', 'm-develop', { dev: 'AZ 300 MIF', time: 40 })
        ], splits: [] },
      { id: 'f-metal-contact-ebl', domain: 'device', name: '금속 전극 형성 (EBL)', device: '', unitLabel: '기판', unitCount: 1, description: 'EBL 패터닝 → 전자빔 금속 증착 → 리프트오프. 소스/드레인 전극 한 세트.',
        rows: [
          A('r1', 'litho', 'PMMA 스핀코팅', 'm-spin-pmma'),
          A('r2', 'litho', '전자빔 노광', 'm-ebl'),
          A('r3', 'litho', '현상', 'm-develop'),
          A('r4', 'depo', '금속 증착', 'm-ebeam-evap', { stack: 'Cr 5 nm / Au 50 nm' }),
          A('r5', 'etch', '리프트오프', 'm-liftoff')
        ], splits: [] },
      { id: 'f-metal-contact-photo', domain: 'device', name: '금속 전극 형성 (포토)', device: '', unitLabel: '기판', unitCount: 1, description: '포토리소 패터닝 → 전자빔 금속 증착 → 리프트오프.',
        rows: [
          A('r1', 'litho', 'PR 스핀코팅', 'm-spin-pr'),
          A('r2', 'litho', '포토 노광', 'm-photo-expose'),
          A('r3', 'litho', '현상', 'm-develop', { dev: 'AZ 300 MIF', time: 40 }),
          A('r4', 'depo', '금속 증착', 'm-ebeam-evap', { stack: 'Ti 10 nm / Au 60 nm' }),
          A('r5', 'etch', '리프트오프', 'm-liftoff')
        ], splits: [] },
      { id: 'f-mos2-bg-fet', domain: 'device', name: 'MoS2 백게이트 FET (기계적 박리)', device: 'MoS2 back-gate FET', unitLabel: '기판', unitCount: 1,
        description: '박리 MoS2 플레이크 위에 EBL 로 소스/드레인을 만들고 어닐링 후 전기 측정.',
        rows: [
          A('r1', 'clean', '기판 세정', 'm-substrate-clean'),
          A('r2', 'clean', 'O2 플라즈마', 'm-o2-plasma', { power: 50, time: 60 }, '박리 전 표면 활성화'),
          A('r3', 'transfer', '기계적 박리', 'm-exfoliation'),
          A('r4', 'meas', 'OM 플레이크 탐색', 'm-om-inspect'),
          A('r5', 'meas', '라만 · PL', 'm-raman-pl'),
          A('r6', 'litho', 'PMMA 스핀코팅', 'm-spin-pmma'),
          A('r7', 'litho', '전자빔 노광 (S/D)', 'm-ebl'),
          A('r8', 'litho', '현상', 'm-develop'),
          A('r9', 'depo', '소스/드레인 증착', 'm-ebeam-evap', { stack: 'Cr 5 nm / Au 50 nm' }),
          A('r10', 'etch', '리프트오프', 'm-liftoff'),
          A('r11', 'thermal', '어닐링', 'm-anneal', { temp: 200, time: 120, atm: 'Ar/H2 (95/5)' }),
          A('r12', 'meas', '전기 측정', 'm-probe-iv')
        ], splits: [] },
      { id: 'f-mos2-bg-fet-split', domain: 'device', name: 'MoS2 BG-FET 접촉 금속 · 어닐링 스플릿', device: 'MoS2 back-gate FET', unitLabel: '기판', unitCount: 4,
        description: '기판 4개를 접촉 금속(Cr/Au vs Ti/Au)으로 2:2 나눈 뒤 합치고, 어닐링 온도(200 vs 300 °C)로 1:3 다시 나누는 스플릿 예시. 분기 구간에서도 행(큰 스텝)은 맞춰져 있고, B 만 하는 행은 A 가 건너뜁니다.',
        rows: [
          A('r1', 'clean', '기판 세정', 'm-substrate-clean'),
          A('r2', 'transfer', '기계적 박리', 'm-exfoliation'),
          A('r3', 'meas', 'OM 플레이크 탐색', 'm-om-inspect'),
          R('r4', 'litho', 'PMMA 스핀코팅', { 'b-cr': M('m-spin-pmma'), 'b-ti': M('m-spin-pmma') }),
          R('r5', 'litho', '전자빔 노광 (S/D)', { 'b-cr': M('m-ebl'), 'b-ti': M('m-ebl') }),
          R('r6', 'litho', '현상', { 'b-cr': M('m-develop'), 'b-ti': M('m-develop') }),
          R('r7', 'depo', '접촉 금속 증착', { 'b-cr': M('m-ebeam-evap', { stack: 'Cr 5 nm / Au 50 nm' }, 'Cr/Au 증착'), 'b-ti': M('m-ebeam-evap', { stack: 'Ti 10 nm / Au 50 nm' }, 'Ti/Au 증착') }, '분기마다 금속만 다르고 나머지 조건은 같게'),
          R('r8', 'etch', '리프트오프', { 'b-cr': M('m-liftoff'), 'b-ti': M('m-liftoff') }),
          R('r9', 'clean', '접촉 후 O2 플라즈마 (B만)', { 'b-ti': M('m-o2-plasma', { power: 30, time: 30 }) }, 'A(Cr/Au)는 이 행을 건너뜀'),
          A('r10', 'meas', '전기 측정 (어닐링 전)', 'm-probe-iv', { meas: 'Transfer' }),
          R('r11', 'thermal', '어닐링', { 'b-200': M('m-anneal', { temp: 200 }, '어닐링 200 °C'), 'b-300': M('m-anneal', { temp: 300 }, '어닐링 300 °C') }),
          A('r12', 'meas', '전기 측정 (어닐링 후)', 'm-probe-iv')
        ],
        splits: [
          { id: 'sp-contact', name: '접촉 금속', parentId: 'all', fromRowId: 'r4', toRowId: 'r9', branches: [{ id: 'b-cr', name: 'A · Cr/Au', count: 2 }, { id: 'b-ti', name: 'B · Ti/Au', count: 2 }] },
          { id: 'sp-anneal', name: '어닐링 온도', parentId: 'all', fromRowId: 'r11', toRowId: 'r11', branches: [{ id: 'b-200', name: 'X · 200 °C', count: 1 }, { id: 'b-300', name: 'Y · 300 °C', count: 3 }] }
        ] },
      { id: 'f-mos2-cvd-tg', domain: 'device', name: 'CVD MoS2 톱게이트 FET', device: 'MoS2 top-gate FET', unitLabel: '기판', unitCount: 1,
        description: 'CVD 성장 → 습식 전사 → 소스/드레인(EBL) → ALD 유전막 → 게이트(포토) → 전기 측정.',
        rows: [
          A('r1', 'clean', '성장 기판 세정', 'm-substrate-clean'),
          A('r2', 'growth', 'CVD MoS2 성장', 'm-cvd-mos2'),
          A('r3', 'transfer', 'PMMA 습식 전사', 'm-pmma-transfer'),
          A('r4', 'meas', 'OM 검사', 'm-om-inspect'),
          A('r5', 'meas', '라만 · PL', 'm-raman-pl'),
          A('r6', 'litho', 'PMMA 스핀코팅', 'm-spin-pmma'),
          A('r7', 'litho', '전자빔 노광 (S/D)', 'm-ebl'),
          A('r8', 'litho', '현상', 'm-develop'),
          A('r9', 'depo', '소스/드레인 증착', 'm-ebeam-evap', { stack: 'Cr 5 nm / Au 50 nm' }),
          A('r10', 'etch', '리프트오프', 'm-liftoff'),
          A('r11', 'depo', 'ALD 유전막', 'm-ald', { material: 'Al2O3 시드 + HfO2', thickness: 20 }),
          A('r12', 'litho', 'PR 스핀코팅', 'm-spin-pr'),
          A('r13', 'litho', '포토 노광 (게이트)', 'm-photo-expose'),
          A('r14', 'litho', '현상', 'm-develop', { dev: 'AZ 300 MIF', time: 40 }),
          A('r15', 'depo', '톱게이트 증착', 'm-ebeam-evap', { stack: 'Ti 10 nm / Au 60 nm' }),
          A('r16', 'etch', '리프트오프', 'm-liftoff'),
          A('r17', 'meas', '전기 측정', 'm-probe-iv', { vg: '-5 ~ 5 V' })
        ], splits: [] },
      { id: 'f-wirebond-pkg', domain: 'package', name: '와이어 본딩 패키징', device: 'DIP / QFN', unitLabel: '칩', unitCount: 1,
        description: '다이싱 → 다이 어태치 → 와이어 본딩 → 몰딩 → 검사.',
        rows: [
          A('r1', 'assembly', '다이싱', 'm-dicing'),
          A('r2', 'assembly', '다이 어태치', 'm-die-attach'),
          A('r3', 'assembly', '와이어 본딩', 'm-package'),
          A('r4', 'encap', '몰딩', 'm-molding'),
          A('r5', 'meas', '패키지 검사', 'm-pkg-inspect')
        ], splits: [] },
      { id: 'f-flipchip-pkg', domain: 'package', name: '플립칩 패키징 · 신뢰성', device: 'Flip-chip', unitLabel: '칩', unitCount: 2,
        description: '범핑 → 리플로우 접합 → 언더필 → 검사 → 신뢰성(TC vs HAST 스플릿) → 시험 후 검사.',
        rows: [
          A('r1', 'assembly', '플립칩 범핑', 'm-flip-bump'),
          A('r2', 'assembly', '리플로우 접합', 'm-reflow'),
          A('r3', 'encap', '언더필', 'm-underfill'),
          A('r4', 'meas', '패키지 검사', 'm-pkg-inspect'),
          R('r5', 'reliab', '신뢰성 시험', { 'b-tc': M('m-reliability', { test: 'TC (열 사이클)' }, 'TC 시험'), 'b-hast': M('m-reliability', { test: 'HAST', cond: '130 °C / 85 %RH', cycles: '96 h' }, 'HAST 시험') }),
          A('r6', 'meas', '시험 후 검사', 'm-pkg-inspect')
        ],
        splits: [
          { id: 'sp-rel', name: '신뢰성 시험', parentId: 'all', fromRowId: 'r5', toRowId: 'r5', branches: [{ id: 'b-tc', name: 'TC', count: 1 }, { id: 'b-hast', name: 'HAST', count: 1 }] }
        ] }
    ]
  };
})();
