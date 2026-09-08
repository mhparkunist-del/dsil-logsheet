/* =====================================================================
   DSIL Run Sheet – 예시 라이브러리 (MoS2 등 2D 반도체 소자 공정)
   처음 열 때 config.seedLibrary 가 true 면 같은 id 가 없는 항목만 라이브러리에 들어갑니다.
   운영 중에는 라이브러리 페이지에서 고치는 것이 원본이며, 이 파일은 초기값일 뿐입니다.
   field.type: text | number | select | textarea | check
   ===================================================================== */
window.DSIL_LIBRARY = {
  version: '2026-09-08a',
  modules: [
    { id: 'm-substrate-clean', name: '기판 용매 세정', category: 'clean', equipment: '습식 벤치 · 초음파 세척기', minutes: 20,
      description: 'SiO2/Si 기판의 유기물·파티클 제거.',
      fields: [
        { key: 'seq', label: '용매 순서', type: 'select', options: ['아세톤 → IPA → DI', '아세톤 → IPA', 'IPA'], default: '아세톤 → IPA → DI', required: true },
        { key: 'sonic', label: '초음파 시간', type: 'number', unit: 'min', default: 5 },
        { key: 'temp', label: '용액 온도', type: 'number', unit: '°C', default: 25 },
        { key: 'dry', label: 'N2 건조', type: 'check', default: true }
      ],
      checklist: ['기판 뒷면 긁힘·오염 확인', '핫플레이트 110 °C 탈수 베이크 2 min'] },
    { id: 'm-piranha', name: '피라냐 세정', category: 'clean', equipment: '산 처리 벤치', minutes: 30,
      description: 'H2SO4:H2O2 로 강한 유기물 제거. 반드시 보호구 착용.',
      fields: [
        { key: 'ratio', label: 'H2SO4 : H2O2', type: 'text', default: '3 : 1', required: true },
        { key: 'time', label: '처리 시간', type: 'number', unit: 'min', default: 10 },
        { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 90 }
      ],
      checklist: ['면 보호구·앞치마·내산 장갑 착용', '산을 물에 넣는 순서 준수', '폐액은 산 폐액통'] },
    { id: 'm-o2-plasma', name: 'O2 플라즈마 처리', category: 'clean', equipment: '플라즈마 애셔', minutes: 10,
      description: '레지스트 찌꺼기 제거·표면 활성화.',
      fields: [
        { key: 'power', label: '파워', type: 'number', unit: 'W', default: 50, required: true },
        { key: 'pressure', label: '압력', type: 'number', unit: 'mTorr', default: 300 },
        { key: 'flow', label: 'O2 유량', type: 'number', unit: 'sccm', default: 20 },
        { key: 'time', label: '시간', type: 'number', unit: 's', default: 60 }
      ], checklist: [] },
    { id: 'm-exfoliation', name: '기계적 박리 (MoS2)', category: 'transfer', equipment: '박리 벤치 · 핫플레이트', minutes: 40,
      description: '스카치 테이프로 벌크 결정에서 박리해 SiO2/Si 기판에 전사.',
      fields: [
        { key: 'crystal', label: '벌크 결정', type: 'text', default: 'MoS2 (2H, HQ Graphene)', required: true },
        { key: 'tape', label: '테이프', type: 'select', options: ['Scotch Magic', 'Nitto BT-150', 'PDMS 스탬프'], default: 'Scotch Magic' },
        { key: 'substrate', label: '기판', type: 'text', default: 'SiO2 285 nm / p++ Si' },
        { key: 'heat', label: '기판 가열', type: 'number', unit: '°C', default: 100 },
        { key: 'time', label: '테이프 유지 시간', type: 'number', unit: 'min', default: 2 }
      ],
      checklist: ['테이프 접힘 횟수 기록', '박리 직전 O2 플라즈마 여부 기록'] },
    { id: 'm-cvd-mos2', name: 'CVD MoS2 성장', category: 'growth', equipment: '3-zone 튜브 퍼니스 (CVD)', minutes: 180,
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
    { id: 'm-pmma-transfer', name: 'PMMA 습식 전사', category: 'transfer', equipment: '습식 벤치 · 스핀코터', minutes: 120,
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
    { id: 'm-om-inspect', name: 'OM 검사 · 플레이크 탐색', category: 'meas', equipment: '광학 현미경', minutes: 30,
      description: '플레이크 위치·층수 후보 기록.',
      fields: [
        { key: 'mag', label: '배율', type: 'select', options: ['5x', '10x', '20x', '50x', '100x'], default: '50x' },
        { key: 'coords', label: '플레이크 좌표 / 표시', type: 'textarea' },
        { key: 'layers', label: '층수 추정', type: 'text', default: '1L' },
        { key: 'files', label: '이미지 파일 / 폴더', type: 'text' }
      ], checklist: [] },
    { id: 'm-raman-pl', name: '라만 · PL 측정', category: 'meas', equipment: '라만 분광기', minutes: 40,
      description: '층수·품질 확인 (E2g/A1g 간격, PL 피크).',
      fields: [
        { key: 'laser', label: '레이저 파장', type: 'select', options: ['532 nm', '633 nm', '785 nm'], default: '532 nm' },
        { key: 'power', label: '레이저 파워', type: 'number', unit: 'mW', default: 0.5 },
        { key: 'exposure', label: '노출 시간', type: 'number', unit: 's', default: 10 },
        { key: 'acc', label: '누적 횟수', type: 'number', default: 3 },
        { key: 'grating', label: '격자', type: 'select', options: ['600 gr/mm', '1800 gr/mm'], default: '1800 gr/mm' },
        { key: 'result', label: '피크 간격 / PL 피크', type: 'text' }
      ], checklist: [] },
    { id: 'm-afm', name: 'AFM 두께 측정', category: 'meas', equipment: 'AFM', minutes: 40,
      fields: [
        { key: 'mode', label: '모드', type: 'select', options: ['Tapping', 'Contact', 'PeakForce'], default: 'Tapping' },
        { key: 'scan', label: '스캔 크기', type: 'number', unit: 'µm', default: 10 },
        { key: 'thickness', label: '측정 두께', type: 'number', unit: 'nm' }
      ], checklist: [] },
    { id: 'm-spin-pmma', name: 'PMMA 스핀코팅 (EBL)', category: 'litho', equipment: '스핀코터 · 핫플레이트', minutes: 15,
      fields: [
        { key: 'resist', label: '레지스트', type: 'select', options: ['PMMA 950 A4', 'PMMA 950 A2', 'MMA/PMMA 이중층'], default: 'PMMA 950 A4', required: true },
        { key: 'rpm', label: '스핀 속도', type: 'number', unit: 'rpm', default: 4000 },
        { key: 'time', label: '스핀 시간', type: 'number', unit: 's', default: 60 },
        { key: 'bake', label: '소프트베이크 온도', type: 'number', unit: '°C', default: 180 },
        { key: 'baketime', label: '베이크 시간', type: 'number', unit: 'min', default: 2 }
      ],
      checklist: ['기판 가장자리 비드 확인', '레지스트 유효기한 확인'] },
    { id: 'm-spin-pr', name: 'PR 스핀코팅', category: 'litho', equipment: '스핀코터 · 핫플레이트', minutes: 15,
      fields: [
        { key: 'resist', label: '레지스트', type: 'select', options: ['AZ 5214E', 'AZ GXR-601', 'S1813', 'LOR 3A + S1813'], default: 'AZ 5214E', required: true },
        { key: 'hmds', label: 'HMDS 처리', type: 'check', default: true },
        { key: 'rpm', label: '스핀 속도', type: 'number', unit: 'rpm', default: 4000 },
        { key: 'time', label: '스핀 시간', type: 'number', unit: 's', default: 40 },
        { key: 'bake', label: '소프트베이크', type: 'text', default: '110 °C / 60 s' }
      ], checklist: [] },
    { id: 'm-ebl', name: '전자빔 리소그래피 (EBL)', category: 'litho', equipment: 'EBL (JEOL/Raith)', minutes: 90,
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
    { id: 'm-photo-expose', name: '포토 노광 (마스크 얼라이너)', category: 'litho', equipment: '마스크 얼라이너', minutes: 20,
      fields: [
        { key: 'mask', label: '마스크', type: 'text', required: true },
        { key: 'mode', label: '노광 모드', type: 'select', options: ['Hard contact', 'Soft contact', 'Proximity', 'Vacuum'], default: 'Hard contact' },
        { key: 'time', label: '노광 시간', type: 'number', unit: 's', default: 8 },
        { key: 'intensity', label: '광 세기', type: 'number', unit: 'mW/cm²' },
        { key: 'reversal', label: '이미지 리버설 (베이크/플러드)', type: 'text', default: '120 °C 2 min + flood 60 s' },
        { key: 'align', label: '정렬 오차', type: 'number', unit: 'µm' }
      ], checklist: ['램프 세기 측정값 기록'] },
    { id: 'm-develop', name: '현상', category: 'litho', equipment: '습식 벤치', minutes: 10,
      fields: [
        { key: 'dev', label: '현상액', type: 'select', options: ['MIBK:IPA 1:3', 'AZ 300 MIF', 'AZ 400K 1:4', 'MF-319'], default: 'MIBK:IPA 1:3', required: true },
        { key: 'time', label: '현상 시간', type: 'number', unit: 's', default: 60 },
        { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 22 },
        { key: 'rinse', label: '린스', type: 'text', default: 'IPA 30 s → N2' },
        { key: 'check', label: '현미경 확인', type: 'check', default: true }
      ], checklist: ['패턴 열림·잔막 확인 후 다음 단계'] },
    { id: 'm-ebeam-evap', name: '전자빔 금속 증착', category: 'depo', equipment: 'E-beam Evaporator', minutes: 120,
      fields: [
        { key: 'stack', label: '금속 / 두께', type: 'text', default: 'Cr 5 nm / Au 50 nm', required: true },
        { key: 'rate', label: '증착 속도', type: 'text', default: '0.5 / 1.0 Å/s' },
        { key: 'pressure', label: '기저 압력', type: 'text', default: '< 2e-6 Torr' },
        { key: 'rotate', label: '기판 회전', type: 'check', default: true },
        { key: 'tilt', label: '기판 틸트', type: 'number', unit: '°', default: 0 }
      ],
      checklist: ['크리스탈 센서 수명 확인', '실제 증착 두께(센서) 기록'] },
    { id: 'm-thermal-evap', name: '열 증착', category: 'depo', equipment: 'Thermal Evaporator', minutes: 90,
      fields: [
        { key: 'metal', label: '금속', type: 'text', default: 'Au', required: true },
        { key: 'thickness', label: '두께', type: 'number', unit: 'nm', default: 50 },
        { key: 'current', label: '보트 전류', type: 'number', unit: 'A' },
        { key: 'pressure', label: '압력', type: 'text', default: '< 5e-6 Torr' }
      ], checklist: [] },
    { id: 'm-sputter', name: '스퍼터 증착', category: 'depo', equipment: 'Sputter', minutes: 60,
      fields: [
        { key: 'target', label: '타겟', type: 'text', required: true },
        { key: 'power', label: '파워', type: 'number', unit: 'W', default: 100 },
        { key: 'pressure', label: '공정 압력', type: 'number', unit: 'mTorr', default: 5 },
        { key: 'gas', label: '가스 / 유량', type: 'text', default: 'Ar 20 sccm' },
        { key: 'time', label: '시간', type: 'number', unit: 'min' },
        { key: 'thickness', label: '목표 두께', type: 'number', unit: 'nm' }
      ], checklist: [] },
    { id: 'm-ald', name: 'ALD 유전막', category: 'depo', equipment: 'ALD', minutes: 150,
      fields: [
        { key: 'material', label: '물질 / 전구체', type: 'select', options: ['Al2O3 (TMA + H2O)', 'HfO2 (TDMAH + H2O)', 'Al2O3 시드 + HfO2'], default: 'Al2O3 (TMA + H2O)', required: true },
        { key: 'temp', label: '공정 온도', type: 'number', unit: '°C', default: 150 },
        { key: 'cycles', label: '사이클 수', type: 'number', default: 300 },
        { key: 'thickness', label: '목표 두께', type: 'number', unit: 'nm', default: 30 },
        { key: 'purge', label: '퍼지 시간', type: 'number', unit: 's', default: 20 },
        { key: 'seed', label: '시드층 / 전처리', type: 'text' }
      ], checklist: ['챔버 컨디셔닝 여부 기록', '두께 엘립소미터 측정값 기록'] },
    { id: 'm-liftoff', name: '리프트오프', category: 'etch', equipment: '습식 벤치', minutes: 60,
      fields: [
        { key: 'solvent', label: '용액', type: 'select', options: ['아세톤', 'PG Remover', 'NMP'], default: '아세톤', required: true },
        { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 60 },
        { key: 'time', label: '시간', type: 'number', unit: 'min', default: 30 },
        { key: 'sonic', label: '초음파', type: 'text', default: '없음 (필요 시 5 s)' },
        { key: 'rinse', label: '린스', type: 'text', default: 'IPA → N2' }
      ], checklist: ['금속 잔류·들뜸 현미경 확인'] },
    { id: 'm-rie', name: 'RIE 식각', category: 'etch', equipment: 'RIE', minutes: 30,
      fields: [
        { key: 'gas', label: '가스 / 유량', type: 'text', default: 'SF6 20 sccm / O2 5 sccm', required: true },
        { key: 'power', label: 'RF 파워', type: 'number', unit: 'W', default: 50 },
        { key: 'pressure', label: '압력', type: 'number', unit: 'mTorr', default: 20 },
        { key: 'time', label: '시간', type: 'number', unit: 's', default: 20 },
        { key: 'depth', label: '식각 깊이 / 결과', type: 'text' }
      ], checklist: ['챔버 O2 클리닝 후 진행'] },
    { id: 'm-wet-etch', name: '습식 식각', category: 'etch', equipment: '습식 벤치', minutes: 20,
      fields: [
        { key: 'etchant', label: '식각액', type: 'text', default: 'BOE 6:1', required: true },
        { key: 'time', label: '시간', type: 'number', unit: 's' },
        { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 25 }
      ], checklist: [] },
    { id: 'm-anneal', name: '진공 · 분위기 어닐링', category: 'thermal', equipment: '튜브 퍼니스 (어닐링)', minutes: 180,
      fields: [
        { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 200, required: true },
        { key: 'time', label: '시간', type: 'number', unit: 'min', default: 120 },
        { key: 'atm', label: '분위기', type: 'select', options: ['진공', 'Ar', 'Ar/H2 (95/5)', 'N2'], default: 'Ar/H2 (95/5)' },
        { key: 'pressure', label: '압력', type: 'text', default: '~1e-5 Torr' },
        { key: 'ramp', label: '승온 / 냉각', type: 'text', default: '5 °C/min / 자연 냉각' }
      ], checklist: [] },
    { id: 'm-rta', name: 'RTA 급속 열처리', category: 'thermal', equipment: 'RTA', minutes: 30,
      fields: [
        { key: 'temp', label: '온도', type: 'number', unit: '°C', default: 400, required: true },
        { key: 'time', label: '유지 시간', type: 'number', unit: 's', default: 60 },
        { key: 'atm', label: '분위기', type: 'select', options: ['N2', 'Ar', 'Forming gas', '진공'], default: 'N2' },
        { key: 'ramp', label: '승온 속도', type: 'number', unit: '°C/s', default: 10 }
      ], checklist: [] },
    { id: 'm-probe-iv', name: '전기 측정 (프로브 스테이션)', category: 'meas', equipment: '프로브 스테이션 · SPA', minutes: 90,
      fields: [
        { key: 'meas', label: '측정 항목', type: 'select', options: ['Transfer', 'Output', 'Transfer + Output', 'I-V', 'C-V', 'Pulse'], default: 'Transfer + Output', required: true },
        { key: 'vds', label: 'Vds', type: 'text', default: '0.1 / 1 V' },
        { key: 'vg', label: 'Vg 범위', type: 'text', default: '-40 ~ 40 V' },
        { key: 'chuck', label: '척 온도', type: 'number', unit: '°C', default: 25 },
        { key: 'env', label: '환경', type: 'select', options: ['대기', '진공', 'N2 글로브박스'], default: '대기' },
        { key: 'ndev', label: '측정 소자 수', type: 'number' },
        { key: 'files', label: '데이터 파일 / 폴더', type: 'text' }
      ], checklist: ['프로브 팁 접촉 저항 확인', '대표 소자 ID 기록'] },
    { id: 'm-package', name: '와이어 본딩 · 패키징', category: 'etc', equipment: '와이어 본더', minutes: 60,
      fields: [
        { key: 'package', label: '패키지', type: 'text', default: 'DIP-24' },
        { key: 'wire', label: '와이어', type: 'select', options: ['Au 25 µm', 'Al 25 µm'], default: 'Au 25 µm' },
        { key: 'pads', label: '본딩 패드 수', type: 'number' }
      ], checklist: [] }
  ],

  flows: [
    { id: 'f-ebl-liftoff', name: 'EBL 패터닝', device: '', description: 'PMMA 스핀코팅 → 전자빔 노광 → 현상. 리프트오프용 서브 흐름.',
      items: [
        { kind: 'module', refId: 'm-spin-pmma' },
        { kind: 'module', refId: 'm-ebl' },
        { kind: 'module', refId: 'm-develop', params: { dev: 'MIBK:IPA 1:3', time: 60 } }
      ] },
    { id: 'f-photo-liftoff', name: '포토리소 패터닝 (리버설)', device: '', description: 'PR 스핀코팅 → 노광 → 현상. 리프트오프용 서브 흐름.',
      items: [
        { kind: 'module', refId: 'm-spin-pr' },
        { kind: 'module', refId: 'm-photo-expose' },
        { kind: 'module', refId: 'm-develop', params: { dev: 'AZ 300 MIF', time: 40 } }
      ] },
    { id: 'f-metal-contact-ebl', name: '금속 전극 형성 (EBL)', device: '', description: 'EBL 패터닝 → 전자빔 금속 증착 → 리프트오프. 소스/드레인 전극 한 세트.',
      items: [
        { kind: 'flow', refId: 'f-ebl-liftoff' },
        { kind: 'module', refId: 'm-ebeam-evap', params: { stack: 'Cr 5 nm / Au 50 nm' } },
        { kind: 'module', refId: 'm-liftoff' }
      ] },
    { id: 'f-metal-contact-photo', name: '금속 전극 형성 (포토)', device: '', description: '포토리소 패터닝 → 전자빔 금속 증착 → 리프트오프.',
      items: [
        { kind: 'flow', refId: 'f-photo-liftoff' },
        { kind: 'module', refId: 'm-ebeam-evap', params: { stack: 'Ti 10 nm / Au 60 nm' } },
        { kind: 'module', refId: 'm-liftoff' }
      ] },
    { id: 'f-mos2-bg-fet', name: 'MoS2 백게이트 FET (기계적 박리)', device: 'MoS2 back-gate FET',
      description: '박리 MoS2 플레이크 위에 EBL 로 소스/드레인을 만들고 어닐링 후 전기 측정.',
      items: [
        { kind: 'module', refId: 'm-substrate-clean' },
        { kind: 'module', refId: 'm-o2-plasma', note: '박리 전 표면 활성화', params: { power: 50, time: 60 } },
        { kind: 'module', refId: 'm-exfoliation' },
        { kind: 'module', refId: 'm-om-inspect' },
        { kind: 'module', refId: 'm-raman-pl' },
        { kind: 'flow', refId: 'f-metal-contact-ebl' },
        { kind: 'module', refId: 'm-anneal', params: { temp: 200, time: 120, atm: 'Ar/H2 (95/5)' } },
        { kind: 'module', refId: 'm-probe-iv' }
      ] },
    { id: 'f-mos2-cvd-tg', name: 'CVD MoS2 톱게이트 FET', device: 'MoS2 top-gate FET',
      description: 'CVD 성장 → 습식 전사 → 소스/드레인(EBL) → ALD 유전막 → 게이트(포토) → 전기 측정.',
      items: [
        { kind: 'module', refId: 'm-substrate-clean', label: '성장 기판 세정' },
        { kind: 'module', refId: 'm-cvd-mos2' },
        { kind: 'module', refId: 'm-pmma-transfer' },
        { kind: 'module', refId: 'm-om-inspect' },
        { kind: 'module', refId: 'm-raman-pl' },
        { kind: 'flow', refId: 'f-metal-contact-ebl', label: '소스/드레인 형성' },
        { kind: 'module', refId: 'm-ald', params: { material: 'Al2O3 시드 + HfO2', thickness: 20 } },
        { kind: 'flow', refId: 'f-metal-contact-photo', label: '톱게이트 형성' },
        { kind: 'module', refId: 'm-probe-iv', params: { vg: '-5 ~ 5 V' } }
      ] }
  ]
};
