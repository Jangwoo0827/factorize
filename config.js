/**
 * config.js
 * ------------------------------------------------------------------
 * FACTORIZE 전역 설정 파일.
 * 이 파일은 순수 데이터(상수)만 포함하며 로직을 담지 않는다.
 * 이후 Phase에서 BUILDINGS / RECIPES / ECONOMY / TECH_TREE 등이
 * 이 객체에 계속 추가된다 (현재는 Phase 0 범위만 정의).
 * ------------------------------------------------------------------
 */

export const CONFIG = {
    // 게임 기본 정보
    GAME: {
        TITLE: 'FACTORIZE',
        VERSION: '0.0.1-phase0',
    },

    // 시뮬레이션 타이밍
    LOOP: {
        TICK_RATE: 60,              // 초당 시뮬레이션 업데이트 횟수 (고정 타임스텝)
        MAX_ACCUMULATED_TIME: 0.25, // 탭 비활성 등으로 인한 dt 폭주 방지 (초)
        FPS_SAMPLE_INTERVAL: 0.5,   // FPS 표시 갱신 주기 (초)
    },

    // 타일 시스템 (Phase 1에서 본격 사용, 현재는 상수만 선언)
    TILE: {
        SIZE: 64,
    },

    // 월드 - 청크 기반 무한 맵
    WORLD: {
        CHUNK_SIZE: 16, // 청크 한 변의 타일 개수 (16x16)
    },

    // 카메라
    CAMERA: {
        MIN_ZOOM: 0.25,
        MAX_ZOOM: 3,
        ZOOM_STEP: 0.12,           // 휠 1틱당 배율 변화량
        SMOOTHING: 12,             // 클수록 목표값에 더 빠르게 수렴 (초당 감쇠율)
        KEYBOARD_PAN_SPEED: 480,   // 줌 1배 기준, 초당 이동 픽셀
    },

    // 입력
    INPUT: {
        CLICK_MOVE_THRESHOLD: 6, // 이 값(px) 이하로 움직이면 드래그가 아니라 클릭으로 간주
    },

    // 생산/운송 관련 수치
    PRODUCTION: {
        MINER_INTERVAL: 2.0,      // 채굴기가 아이템 하나를 생산하는 데 걸리는 시간(초)
        CONVEYOR_SPEED: 1.5,      // 컨베이어 위 아이템 이동 속도 (타일/초)
        CONVEYOR_MIN_GAP: 0.34,   // 같은 컨베이어 칸 위, 아이템 사이 최소 진행도 간격 (한 칸에 여러 개 허용)
        INSERTER_INTERVAL: 0.7,   // 기계 팔이 아이템 하나를 옮기는 데 걸리는 시간(초)
        ROUTER_INTERVAL: 0.18,    // 분배기/합류기가 아이템을 넘기는 간격(초)
        PROCESSOR_INTERVAL: 2.5,
    },

    // 제련 레시피: 원료 자원 -> { 완제품 자원, 제련 시간(초) }
    // 희귀 결정(rare_crystal)은 이미 정제된 상태라는 설정이라 제련/가공 없이 바로 조립에 쓰인다.
    RECIPES: {
        iron_ore: { output: 'iron_ingot', duration: 3.0 },
        copper_ore: { output: 'copper_ingot', duration: 3.0 },
        gold_ore: { output: 'gold_ingot', duration: 4.0 },
        titanium_ore: { output: 'titanium_ingot', duration: 5.0 }, // 티타늄은 정련이 까다롭다는 설정으로 가장 오래 걸림
    },

    PROCESSING_RECIPES: {
        crusher: {
            iron_ore: 'iron_powder',
            copper_ore: 'copper_powder',
            gold_ore: 'gold_powder',
            titanium_ore: 'titanium_powder',
        },
        washer: {
            iron_ore: 'washed_iron_ore',
            copper_ore: 'washed_copper_ore',
            gold_ore: 'washed_gold_ore',
            titanium_ore: 'washed_titanium_ore',
        },
    },

    ASSEMBLY_RECIPES: [
        { id: 'gear', label: '기어', inputs: { iron_ingot: 2 }, output: 'gear' },
        { id: 'motor', label: '모터', inputs: { iron_ingot: 2, copper_ingot: 1 }, output: 'motor' },
        { id: 'circuit', label: '회로', inputs: { copper_ingot: 2, coal: 1 }, output: 'circuit' },
        // 아래 세 레시피는 티어2/3 광물을 기존 광물과 섞어 쓰는 후속 콘텐츠.
        { id: 'alloy_frame', label: '합금 프레임', inputs: { titanium_ingot: 1, iron_ingot: 2 }, output: 'alloy_frame' },
        { id: 'precision_circuit', label: '정밀 회로', inputs: { gold_ingot: 1, circuit: 1 }, output: 'precision_circuit' },
        // 동력 코어: 희귀 결정(채굴기 III 전용) + 티타늄괴 + 모터를 요구하는 최종 조립품.
        { id: 'power_core', label: '동력 코어', inputs: { rare_crystal: 1, titanium_ingot: 1, motor: 1 }, output: 'power_core' },
    ],

    // 전력 - 발전기 공급량과 기계별 소비량
    POWER: {
        GENERATOR_OUTPUT: 20, // 발전기 1개가 초당 공급하는 전력량
        MINER_DEMAND: 5,
        CONVEYOR_DEMAND: 2,
        INSERTER_DEMAND: 3,
        ROUTER_DEMAND: 2,
        FURNACE_DEMAND: 8,
        LAB_DEMAND: 6,
    },

    // 경제
    ECONOMY: {
        STARTING_MONEY: 120,
        // 이미 지은 건물을 정리할 때는 구매가의 일부를 되돌려준다.
        // 배치를 되돌릴 여지를 주되, 무한 재배치로 이득을 볼 수는 없게 한다.
        BUILDING_SELL_RATE: 0.7,
        SELL_PRICES: {
            iron_ore: 2,
            copper_ore: 3,
            coal: 1,
            iron_ingot: 6,
            copper_ingot: 8,
            iron_powder: 4,
            copper_powder: 5,
            washed_iron_ore: 5,
            washed_copper_ore: 6,
            gear: 18,
            motor: 42,
            circuit: 35,
            gold_ore: 12,
            titanium_ore: 16,
            rare_crystal: 40,
            gold_ingot: 34,
            titanium_ingot: 45,
            gold_powder: 22,
            titanium_powder: 29,
            washed_gold_ore: 26,
            washed_titanium_ore: 35,
            alloy_frame: 90,
            precision_circuit: 110,
            power_core: 220,
        },
    },

    // 연구
    RESEARCH: {
        LAB_OUTPUT: 3, // 연구소 1개가 초당 생산하는 연구 포인트(RP)
    },

    // 세이브
    SAVE: {
        AUTO_SAVE_INTERVAL: 30, // 자동 저장 주기(초)
    },

    // 경고/알림: 전력 부족은 PowerSystem이 매 틱 계산하는 공급비율을 그대로 쓰고,
    // 막힘은 건물이 너무 많아 매 틱 정밀 검사하기엔 비싸므로 몇 초에 한 번만
    // 샘플링한다 (성능 최적화 - v2.3 참고).
    ALERTS: {
        BLOCKAGE_SAMPLE_INTERVAL: 5, // 막힌 건물 수를 다시 세는 주기(초)
        BLOCKAGE_MIN_COUNT: 5,       // 이 개수 미만이면 정상적인 배압으로 보고 무시
        BLOCKAGE_MIN_RATIO: 0.02,    // 전체 건물 대비 이 비율 미만도 무시 (막힌 개수/전체 건물 수)
    },

    // 자동 건설소: 등록된 블루프린트를 몇 초에 한 번씩 다음 칸에 이어 짓는다.
    AUTO_CONSTRUCTION: {
        INTERVAL: 4, // 시도 간격(초). 레벨업 시 getSpeedMultiplier()만큼 짧아진다.
    },

    // 마일스톤: "누적 수익"과 "초당 수익 최고 기록" 두 사다리. 순서대로 도달한다고
    // 가정하고, ProgressPanel이 world.stats.totalRevenue / peakIncomeRate와 비교해
    // 다음 목표까지 진행률을 보여준다 (별도 해금 상태를 저장하지 않음 - 두 수치
    // 자체가 항상 증가만 하므로 그 값만 비교해도 충분하다).
    MILESTONES: {
        totalRevenue: [
            { id: 'revenue_500', label: '첫 자립', target: 500 },
            { id: 'revenue_3000', label: '성장하는 공장', target: 3000 },
            { id: 'revenue_15000', label: '본격 가동', target: 15000 },
            { id: 'revenue_75000', label: '대량 생산 체제', target: 75000 },
            { id: 'revenue_300000', label: '산업 제국', target: 300000 },
        ],
        incomeRate: [
            { id: 'income_5', label: '꾸준한 흐름', target: 5 },
            { id: 'income_20', label: '자동화 궤도', target: 20 },
            { id: 'income_60', label: '가속 생산', target: 60 },
            { id: 'income_200', label: '메가 라인', target: 200 },
            { id: 'income_600', label: '궁극의 공장', target: 600 },
        ],
    },

    // 업적: 조건(type+target)을 만족하면 한 번만 해금된다. AchievementSystem이
    // type별 판정 로직을 갖고 있으므로, 기존 type을 재사용하는 새 업적은
    // 이 배열에 항목만 추가하면 된다.
    // type: totalRevenue(누적 수익) | totalSold(누적 판매 개수) |
    //       itemProduced(해당 자원 최초 생산) | upgradeCount(누적 업그레이드 횟수) |
    //       buildingCount(현재 배치된 건물 수) | techUnlocked(해당 기술 해금) |
    //       contractsCompleted(완료한 계약 수)
    ACHIEVEMENTS: [
        { id: 'first_sale', label: '첫 판매', description: '판매기로 처음 자원을 판매했습니다.', type: 'totalSold', target: 1 },
        { id: 'sold_100', label: '판매왕', description: '누적 100개를 판매했습니다.', type: 'totalSold', target: 100 },
        { id: 'sold_1000', label: '유통 제국', description: '누적 1,000개를 판매했습니다.', type: 'totalSold', target: 1000 },
        { id: 'buildings_10', label: '첫 공장', description: '건물 10개를 배치했습니다.', type: 'buildingCount', target: 10 },
        { id: 'buildings_50', label: '산업 단지', description: '건물 50개를 배치했습니다.', type: 'buildingCount', target: 50 },
        { id: 'buildings_150', label: '메가팩토리', description: '건물 150개를 배치했습니다.', type: 'buildingCount', target: 150 },
        { id: 'research_smelting', label: '제련의 시작', description: '제련술을 연구했습니다.', type: 'techUnlocked', target: 'tech_smelting' },
        { id: 'research_assembly', label: '자동화 완성', description: '자동 조립을 연구했습니다.', type: 'techUnlocked', target: 'tech_assembly' },
        { id: 'research_miner_t3', label: '채굴 마스터', description: '채굴기 III까지 연구했습니다.', type: 'techUnlocked', target: 'tech_miner_t3' },
        { id: 'craft_power_core', label: '정점의 부품', description: '동력 코어를 처음 제작했습니다.', type: 'itemProduced', target: 'power_core' },
        { id: 'upgrade_10', label: '숙련된 기술자', description: '건물을 총 10회 업그레이드했습니다.', type: 'upgradeCount', target: 10 },
        { id: 'upgrade_50', label: '마스터 엔지니어', description: '건물을 총 50회 업그레이드했습니다.', type: 'upgradeCount', target: 50 },
        { id: 'contract_1', label: '첫 계약', description: '계약을 처음 완료했습니다.', type: 'contractsCompleted', target: 1 },
        { id: 'contract_20', label: '신뢰받는 공급처', description: '계약을 20건 완료했습니다.', type: 'contractsCompleted', target: 20 },
    ],

    // 계약: 판매기와 달리 정해진 조합을 다 채워야 완료된다. 완료하면 판매가보다
    // 후한 보상(돈+RP)을 주고 다음 계약으로 넘어간다 - 반복 가능한 중간 목표.
    // 난이도는 요구 자원의 등급에 따라 자연스럽게 낮음->높음으로 퍼져 있다.
    CONTRACTS: [
        { id: 'contract_ore_starter', label: '광석 공급', requirements: { iron_ore: 30, coal: 10 }, reward: { money: 120, rp: 5 } },
        { id: 'contract_ingot_batch', label: '제련 부품 납품', requirements: { iron_ingot: 15, copper_ingot: 10 }, reward: { money: 250, rp: 12 } },
        { id: 'contract_gear_set', label: '기어 세트 납품', requirements: { gear: 12 }, reward: { money: 280, rp: 15 } },
        { id: 'contract_motor_line', label: '모터 라인 납품', requirements: { motor: 8, circuit: 8 }, reward: { money: 650, rp: 25 } },
        { id: 'contract_precious_ore', label: '귀금속 광석 납품', requirements: { gold_ore: 15, titanium_ore: 15 }, reward: { money: 550, rp: 20 } },
        { id: 'contract_advanced_ingot', label: '고급 합금 재료 납품', requirements: { gold_ingot: 10, titanium_ingot: 10 }, reward: { money: 950, rp: 35 } },
        { id: 'contract_alloy_frame', label: '합금 프레임 납품', requirements: { alloy_frame: 6 }, reward: { money: 700, rp: 30 } },
        { id: 'contract_power_core', label: '동력 코어 최종 납품', requirements: { power_core: 3 }, reward: { money: 900, rp: 60 } },
    ],

    // 업그레이드 - 모든 건물에 공통 적용되는 레벨업 규칙
    // [밸런스 수정] 예전엔 모든 건물이 똑같이 50/150/400원이라, 전선(3원)처럼
    // 싼 건물도 비싼 채굴기 III(220원)와 업그레이드 비용이 같아서 "일괄 업그레이드"가
    // 생기고 나니 저렴한 건물부터 거저 업그레이드하는 게 최적 전략이 되어버렸다.
    // 건물 자신의 cost에 비례한 배율로 바꿔서, 비싼/강력한 건물일수록 업그레이드도
    // 비싸지도록 고쳤다.
    UPGRADE: {
        MAX_LEVEL: 3,
        COST_MULTIPLIER_PER_LEVEL: [2.5, 6, 15], // [건물 cost 대비 배율: 1->2, 2->3, ...]
        SPEED_MULTIPLIER_PER_LEVEL: 0.35, // 레벨 하나당 +35% (생산속도/전력공급량/판매가 등 건물별로 다르게 적용)
    },

    // 기술 트리: 각 기술은 비용(RP)과 선행 조건(다른 기술 id 배열)을 가진다.
    // ResearchSystem이 이 데이터를 기반으로 해금 가능 여부를 판정한다.
    TECH_TREE: {
        tech_smelting: {
            label: '제련술',
            cost: 20,
            prerequisites: [],
        },
        tech_logistics: {
            label: '물류 자동화',
            cost: 35,
            prerequisites: ['tech_smelting'],
        },
        tech_processing: {
            label: '광물 가공',
            cost: 55,
            prerequisites: ['tech_logistics'],
        },
        tech_assembly: {
            label: '자동 조립',
            cost: 80,
            prerequisites: ['tech_processing'],
        },
        tech_miner_t2: {
            label: '채굴 기술 강화 I',
            cost: 40,
            prerequisites: ['tech_smelting'],
        },
        tech_miner_t3: {
            label: '채굴 기술 강화 II',
            cost: 90,
            prerequisites: ['tech_miner_t2', 'tech_processing'],
        },
        tech_conveyor_t2: {
            label: '물류 가속 I',
            cost: 30,
            prerequisites: ['tech_logistics'],
        },
        tech_conveyor_t3: {
            label: '물류 가속 II',
            cost: 100,
            prerequisites: ['tech_conveyor_t2', 'tech_assembly'],
        },
        tech_generator_t2: {
            label: '발전 기술 강화 I',
            cost: 45,
            prerequisites: ['tech_smelting'],
        },
        tech_generator_t3: {
            label: '발전 기술 강화 II',
            cost: 95,
            prerequisites: ['tech_generator_t2', 'tech_processing'],
        },
        tech_auto_construction: {
            label: '자동 건설 공학',
            cost: 150,
            prerequisites: ['tech_assembly'],
        },
    },

    // 건물 목록 UI(BuildMenuPanel)에 표시할 탭. 순서가 곧 탭이 나열되는 순서다.
    // 각 BUILDINGS 항목의 category 필드가 이 목록의 id와 매칭된다.
    BUILD_CATEGORIES: [
        { id: 'production', label: '채굴/생산' },
        { id: 'logistics', label: '물류' },
        { id: 'power', label: '전력' },
        { id: 'utility', label: '기타' },
    ],

    // 건물 레지스트리 - 새 건물을 추가할 때 이 객체에만 항목을 추가하면 된다.
    // (BuildMenuPanel, Building 렌더링, 단축키가 전부 이 설정을 기반으로 동작)
    // requiresTech가 없으면 처음부터 사용 가능, 있으면 해당 기술을 연구해야 해금된다.
    // cost는 배치할 때 차감되는 자금이다. category는 BUILD_CATEGORIES의 id 중 하나.
    BUILDINGS: {
        miner: {
            id: 'miner',
            label: '채굴기',
            shape: 'circle',
            color: '#ff6b35',
            cost: 20,
            category: 'production',
            producesResource: 'iron_ore', // 매장지 시스템 대신 "연구로 상위 채굴기 해금" 방식을 채택함 (설계 문서 v1.4)
            selectableResources: ['iron_ore', 'coal', 'copper_ore'],
            showDirectionIndicator: true, // 원 도형은 회전이 안 보이므로 배출 방향을 별도 표시
        },
        miner_t2: {
            id: 'miner_t2',
            label: '채굴기 II',
            shape: 'circle',
            color: '#f0c419',
            cost: 90,
            category: 'production',
            producesResource: 'iron_ore',
            selectableResources: ['iron_ore', 'coal', 'copper_ore', 'gold_ore', 'titanium_ore'],
            showDirectionIndicator: true,
            requiresTech: 'tech_miner_t2',
            miningInterval: 1.5, // 기본 채굴기(2.0초)보다 빠름
            powerDemand: 8,
        },
        miner_t3: {
            id: 'miner_t3',
            label: '채굴기 III',
            shape: 'circle',
            color: '#c77dff',
            cost: 220,
            category: 'production',
            producesResource: 'iron_ore',
            selectableResources: ['iron_ore', 'coal', 'copper_ore', 'gold_ore', 'titanium_ore', 'rare_crystal'],
            showDirectionIndicator: true,
            requiresTech: 'tech_miner_t3',
            miningInterval: 1.0,
            powerDemand: 14,
        },
        conveyor: {
            id: 'conveyor',
            label: '컨베이어',
            shape: 'arrow',
            color: '#5ec8d8',
            cost: 5,
            category: 'logistics',
        },
        conveyor_t2: {
            id: 'conveyor_t2',
            label: '컨베이어 II',
            shape: 'arrow',
            color: '#3fa9c9',
            cost: 20,
            category: 'logistics',
            requiresTech: 'tech_conveyor_t2',
            conveyorSpeed: 2.5, // 기본 컨베이어(1.5타일/초)보다 빠름
            powerDemand: 4,
        },
        conveyor_t3: {
            id: 'conveyor_t3',
            label: '컨베이어 III',
            shape: 'arrow',
            color: '#2477a8',
            cost: 60,
            category: 'logistics',
            requiresTech: 'tech_conveyor_t3',
            conveyorSpeed: 4.0,
            powerDemand: 7,
        },
        storage: {
            id: 'storage',
            label: '창고',
            shape: 'square',
            color: '#8ba3b0',
            cost: 15,
            category: 'logistics',
        },
        furnace: {
            id: 'furnace',
            label: '용광로',
            shape: 'square',
            color: '#c0563a',
            cost: 40,
            category: 'production',
            showDirectionIndicator: true, // 사각형도 회전이 안 보이므로 배출 방향 표시
            requiresTech: 'tech_smelting',
        },
        seller: {
            id: 'seller',
            label: '판매기',
            shape: 'square',
            color: '#d4af37',
            cost: 25,
            category: 'utility',
            // 원자재를 파는 기본 경제 순환은 연구로 막을 이유가 없어서 처음부터 사용 가능하게 둔다.
            // (연구 시스템은 용광로/제련만 심화 콘텐츠로 남겨둠)
        },
        auto_construction_depot: {
            id: 'auto_construction_depot',
            label: '자동 건설소',
            shape: 'square',
            color: '#7c5cff',
            cost: 250,
            category: 'utility',
            requiresTech: 'tech_auto_construction',
            showDirectionIndicator: false,
            // 등록한 블루프린트를 정해둔 방향으로 스스로 이어 짓는 건물 (6.10).
            // 늦게 해금되는 강력한 자동화 콘텐츠라 비용도 다른 utility 건물보다 높다.
        },
        contract_office: {
            id: 'contract_office',
            label: '계약소',
            shape: 'square',
            color: '#e8a33d',
            cost: 45,
            category: 'utility',
            showDirectionIndicator: false,
            // 판매기와 마찬가지로 처음부터 사용 가능 - 계약은 초반부터 방향을
            // 제시해주는 목적도 있어서 연구로 막지 않는다.
        },
        generator: {
            id: 'generator',
            label: '발전기',
            shape: 'generator',
            color: '#f5d33d',
            cost: 50,
            category: 'power',
        },
        generator_t2: {
            id: 'generator_t2',
            label: '발전기 II',
            shape: 'generator',
            color: '#f5a623',
            cost: 140,
            category: 'power',
            requiresTech: 'tech_generator_t2',
            powerOutput: 55, // 기본 발전기(20)보다 훨씬 많이 공급
        },
        generator_t3: {
            id: 'generator_t3',
            label: '발전기 III',
            shape: 'generator',
            color: '#f56b23',
            cost: 320,
            category: 'power',
            requiresTech: 'tech_generator_t3',
            powerOutput: 120,
        },
        wire: {
            id: 'wire',
            label: '전선',
            shape: 'wire',
            color: '#f5d33d',
            cost: 3,
            category: 'power',
        },
        lab: {
            id: 'lab',
            label: '연구소',
            shape: 'square',
            color: '#8a63d2',
            cost: 60,
            category: 'utility',
        },
        inserter: {
            id: 'inserter',
            label: '기계 팔',
            shape: 'inserter',
            color: '#78c77a',
            cost: 20,
            category: 'logistics',
            requiresTech: 'tech_logistics',
        },
        splitter: {
            id: 'splitter',
            label: '분배기',
            shape: 'splitter',
            color: '#b57be6',
            cost: 30,
            category: 'logistics',
            requiresTech: 'tech_logistics',
        },
        merger: {
            id: 'merger',
            label: '합류기',
            shape: 'merger',
            color: '#b57be6',
            cost: 30,
            category: 'logistics',
            requiresTech: 'tech_logistics',
        },
        crusher: { id: 'crusher', label: '분쇄기', shape: 'square', color: '#b0a49a', cost: 55, category: 'production', showDirectionIndicator: true, requiresTech: 'tech_processing' },
        washer: { id: 'washer', label: '세척기', shape: 'square', color: '#65b9de', cost: 65, category: 'production', showDirectionIndicator: true, requiresTech: 'tech_processing' },
        assembler: { id: 'assembler', label: '조립기', shape: 'square', color: '#ad74d1', cost: 100, category: 'production', showDirectionIndicator: true, requiresTech: 'tech_assembly' },
    },

    // 디버그
    DEBUG: {
        LOG_INPUT: true, // true면 키보드/휠 입력이 콘솔에 로그로 찍힘 (문제 해결 후 false로 변경)
    },

    // 렌더링 - 블루프린트 팔레트
    RENDER: {
        BG_COLOR: '#0a1628',
        TILE_COLOR_A: '#0d1f34',
        TILE_COLOR_B: '#0b1a2c',
        CHUNK_BORDER_COLOR: 'rgba(255, 107, 53, 0.35)',
        ORIGIN_MARKER_COLOR: '#ff6b35',
        BUILDING_STROKE_COLOR: 'rgba(10, 22, 40, 0.65)',
        GHOST_VALID_ALPHA: 0.5,
        GHOST_INVALID_COLOR: '#ff4d4d',
        POWER_PULSE_SPEED: 0.7, // 전력 펄스가 두 건물 사이를 오가는 속도 (edge/초)
        GRID_LINE_COLOR: 'rgba(94, 200, 216, 0.08)',
        GRID_LINE_COLOR_MAJOR: 'rgba(94, 200, 216, 0.16)',
        ACCENT_AMBER: '#ff6b35',
        ACCENT_CYAN: '#5ec8d8',
    },
};
