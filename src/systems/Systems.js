/**
 * src/systems/Systems.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Economy, ProductionStats, PowerSystem, ResearchSystem, AchievementSystem
 *
 * 지금까지는 각 건물이 스스로 행동을 아는 다형성 방식으로 충분했지만,
 * "자금", "전력망", "연구 진행 상태"는 여러 건물/UI에 걸친 전역
 * 상태/계산이라 별도 클래스로 분리했다.
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { DIRECTION_VECTORS } from '../entities/Building.js';

export class Economy {
    /**
     * @param {number} startingMoney
     */
    constructor(startingMoney) {
        this.money = startingMoney;
    }

    /**
     * @param {number} amount
     */
    addMoney(amount) {
        this.money += amount;
    }

    /**
     * 지불이 가능하면 실제로 차감하고 true를 반환한다. 잔액이 부족하면
     * 아무것도 바꾸지 않고 false를 반환한다.
     * @param {number} amount
     * @returns {boolean}
     */
    spendMoney(amount) {
        if (this.money < amount) return false;
        this.money -= amount;
        return true;
    }

    getBalance() {
        return this.money;
    }

    /**
     * 저장된 데이터로부터 잔액을 복원한다.
     * @param {number} amount
     */
    setBalance(amount) {
        this.money = amount;
    }
}

/**
 * 자원 생산/판매 이벤트를 집계해 초당 처리량(rate)을 계산하고, 그래프용
 * 이력을 쌓아두는 클래스. 실제 산출 지점(채굴기/용광로/가공기/조립기의
 * 생산 완료, 판매기의 판매)에서 record*()를 호출하고, 매 틱 update(dt)를
 * 호출하면 1초 단위 창(window)마다 스냅샷을 낸다.
 *
 * 창(window) 관련 필드는 순간 수치라 세이브하지 않지만, totalRevenue 등
 * "누적" 필드는 마일스톤/업적이 참조하므로 serialize()/restoreState()로
 * World와 함께 저장된다.
 */
export class ProductionStats {
    /**
     * @param {number} historyLength 자원별로 보관할 최근 샘플(초) 개수 - 생산 그래프에서 사용
     */
    constructor(historyLength = 90) {
        this.historyLength = historyLength;
        this.windowDuration = 1;
        this.windowTimer = 0;

        /** @type {Record<string, number>} 이번 창에서 누적된 생산 개수 */
        this.producedInWindow = {};
        /** @type {Record<string, number>} 이번 창에서 누적된 판매 개수 */
        this.soldInWindow = {};
        this.revenueInWindow = 0;

        /** @type {Record<string, number>} 직전 창 기준, 자원별 초당 생산량 */
        this.productionRates = {};
        /** 직전 창 기준 초당 수익 */
        this.incomeRate = 0;

        /** @type {Record<string, number[]>} 자원별 초당 생산량 이력 (그래프용) */
        this.productionHistory = {};

        // --- 아래부터는 세이브되는 누적(lifetime) 값 - 마일스톤/업적이 참조한다 ---
        /** 지금까지 판매로 벌어들인 누적 수익 (건물 철거 환급은 포함하지 않음). */
        this.totalRevenue = 0;
        /** 지금까지 관측된 초당 수익의 최고 기록. */
        this.peakIncomeRate = 0;
        /** 지금까지 판매기가 판 아이템 총 개수. */
        this.totalSold = 0;
        /** @type {Record<string, number>} 자원별로 지금까지 생산된 누적 개수. */
        this.totalProducedByType = {};
        /** 지금까지 성공한 건물 업그레이드 총 횟수. */
        this.totalUpgrades = 0;
    }

    /**
     * @param {string} resourceType
     */
    recordProduced(resourceType) {
        this.producedInWindow[resourceType] = (this.producedInWindow[resourceType] ?? 0) + 1;
        this.totalProducedByType[resourceType] = (this.totalProducedByType[resourceType] ?? 0) + 1;
    }

    /**
     * @param {string} resourceType
     * @param {number} revenue
     */
    recordSold(resourceType, revenue) {
        this.soldInWindow[resourceType] = (this.soldInWindow[resourceType] ?? 0) + 1;
        this.revenueInWindow += revenue;
        this.totalSold += 1;
        this.totalRevenue += revenue;
    }

    /** 건물 업그레이드가 성공할 때마다 Game이 호출한다. */
    recordUpgrade() {
        this.totalUpgrades += 1;
    }

    /** @param {number} dt */
    update(dt) {
        this.windowTimer += dt;
        if (this.windowTimer < this.windowDuration) return;
        this.windowTimer -= this.windowDuration;

        this.productionRates = this.producedInWindow;
        this.incomeRate = this.revenueInWindow;
        this.peakIncomeRate = Math.max(this.peakIncomeRate, this.incomeRate);

        for (const [resourceType, count] of Object.entries(this.producedInWindow)) {
            const history = this.productionHistory[resourceType] ?? (this.productionHistory[resourceType] = []);
            history.push(count);
            if (history.length > this.historyLength) history.shift();
        }

        this.producedInWindow = {};
        this.soldInWindow = {};
        this.revenueInWindow = 0;
    }

    /** 자원 종류를 합산한 전체 초당 생산량 (StatusBar 요약용). */
    getTotalProductionRate() {
        return Object.values(this.productionRates).reduce((sum, rate) => sum + rate, 0);
    }

    /** 직전 창 기준 초당 판매 수익. */
    getIncomeRate() {
        return this.incomeRate;
    }

    /** 누적(lifetime) 값만 저장한다 - 창/이력은 불러온 뒤 다시 쌓인다. */
    serialize() {
        return {
            totalRevenue: this.totalRevenue,
            peakIncomeRate: this.peakIncomeRate,
            totalSold: this.totalSold,
            totalProducedByType: { ...this.totalProducedByType },
            totalUpgrades: this.totalUpgrades,
        };
    }

    /**
     * @param {object} data
     */
    restoreState(data) {
        this.totalRevenue = data?.totalRevenue ?? 0;
        this.peakIncomeRate = data?.peakIncomeRate ?? 0;
        this.totalSold = data?.totalSold ?? 0;
        this.totalProducedByType = { ...(data?.totalProducedByType ?? {}) };
        this.totalUpgrades = data?.totalUpgrades ?? 0;
    }
}

/**
 * 전력망을 계산하는 정적 유틸리티.
 * 개별 건물이 아니라 여러 건물에 걸친 연결 관계(그래프)를 다뤄야 하므로
 * 특정 건물의 update()에 넣기보다 별도 로직으로 분리했다.
 *
 * 동작 방식: 발전기/전선/전력을 쓰는 건물들을 4방향 인접 그래프로 보고,
 * BFS로 서로 연결된 덩어리(전력망)를 찾은 뒤, 그 안의 총 공급량과
 * 총 수요량을 비교해 공급 비율(0~1)을 계산하고 각 건물에 반영한다.
 */
export class PowerSystem {
    /**
     * 매 틱 호출되어 모든 전력망을 재계산한다.
     * @param {import('../world/World.js').World} world
     */
    static update(world) {
        const visited = new Set();

        for (const building of world.getAllBuildings()) {
            if (!building.isPowerNode() || visited.has(building)) continue;

            const network = PowerSystem.#collectNetwork(world, building, visited);
            PowerSystem.#applyNetwork(network);
        }
    }

    /**
     * BFS로 building과 연결된 전력망 전체를 찾는다.
     * @param {import('../world/World.js').World} world
     * @param {import('../entities/Building.js').Building} startBuilding
     * @param {Set} visited
     * @returns {import('../entities/Building.js').Building[]}
     */
    static #collectNetwork(world, startBuilding, visited) {
        const network = [];
        const queue = [startBuilding];
        visited.add(startBuilding);

        while (queue.length > 0) {
            const current = queue.shift();
            network.push(current);

            for (const vec of DIRECTION_VECTORS) {
                const neighbor = world.getBuildingAt(current.tileX + vec.x, current.tileY + vec.y);
                if (neighbor && neighbor.isPowerNode() && !visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }

        return network;
    }

    /**
     * 전력망 하나의 공급/수요를 합산해 비율을 계산하고, 소속 건물에 반영한다.
     * @param {import('../entities/Building.js').Building[]} network
     */
    static #applyNetwork(network) {
        let totalSupply = 0;
        let totalDemand = 0;

        for (const building of network) {
            totalSupply += building.getPowerSupply();
            totalDemand += building.getPowerDemand();
        }

        // 수요가 0이면(발전기/전선만 있는 경우) 굳이 부족할 일이 없으므로 1로 둔다.
        const ratio = totalDemand === 0 ? 1 : Math.min(1, totalSupply / totalDemand);

        for (const building of network) {
            building.setPowerRatio(ratio);
        }
    }
}

/**
 * 연구 포인트(RP) 누적과 기술 해금 상태를 관리한다.
 * CONFIG.TECH_TREE(데이터)를 기반으로 선행 조건 충족 여부를 판정하므로,
 * 새 기술을 추가할 때 이 클래스가 아니라 config.js만 수정하면 된다.
 */
export class ResearchSystem {
    constructor() {
        this.points = 0;
        /** @type {Set<string>} 해금된 기술 id 집합 */
        this.unlockedTechIds = new Set();
    }

    /**
     * @param {number} amount
     */
    addResearchPoints(amount) {
        this.points += amount;
    }

    getPoints() {
        return this.points;
    }

    /**
     * @param {string} techId
     * @returns {boolean}
     */
    isUnlocked(techId) {
        return this.unlockedTechIds.has(techId);
    }

    /**
     * 선행 조건이 모두 충족되었는지 확인한다.
     * @param {string} techId
     */
    #arePrerequisitesMet(techId) {
        const tech = CONFIG.TECH_TREE[techId];
        if (!tech) return false;
        return tech.prerequisites.every((prereqId) => this.unlockedTechIds.has(prereqId));
    }

    /**
     * 선행 조건은 충족했지만 아직 해금되지 않은(=지금 연구할 수 있는) 기술 목록.
     * @returns {{id: string, label: string, cost: number}[]}
     */
    getResearchableTechs() {
        const result = [];
        for (const [id, tech] of Object.entries(CONFIG.TECH_TREE)) {
            if (this.unlockedTechIds.has(id)) continue;
            if (!this.#arePrerequisitesMet(id)) continue;
            result.push({ id, label: tech.label, cost: tech.cost });
        }
        return result;
    }

    /**
     * 연구를 시도한다. 조건(선행 기술, 비용)을 만족하면 RP를 차감하고 해금한다.
     * @param {string} techId
     * @returns {boolean} 연구 성공 여부
     */
    tryResearch(techId) {
        const tech = CONFIG.TECH_TREE[techId];
        if (!tech || this.unlockedTechIds.has(techId)) return false;
        if (!this.#arePrerequisitesMet(techId)) return false;
        if (this.points < tech.cost) return false;

        this.points -= tech.cost;
        this.unlockedTechIds.add(techId);
        return true;
    }

    /**
     * 해당 건물이 지금 배치 가능한지(연구 조건 충족) 확인한다.
     * requiresTech가 없는 건물은 항상 true.
     * @param {string} buildingTypeId
     * @returns {boolean}
     */
    isBuildingUnlocked(buildingTypeId) {
        const def = CONFIG.BUILDINGS[buildingTypeId];
        if (!def || !def.requiresTech) return true;
        return this.unlockedTechIds.has(def.requiresTech);
    }

    /**
     * 저장된 데이터로부터 연구 상태를 복원한다.
     * @param {{points: number, unlockedTechIds: string[]}} data
     */
    restoreState(data) {
        this.points = data?.points ?? 0;
        this.unlockedTechIds = new Set(data?.unlockedTechIds ?? []);
    }
}

/**
 * CONFIG.ACHIEVEMENTS(데이터)를 기준으로 조건 충족 여부를 매 틱 확인하고,
 * 새로 달성한 업적을 Set에 기록한다. 조건 종류(type)별 판정 로직만 이
 * 클래스가 담당하므로, 새 업적을 추가할 때는 config.js에 항목만 추가하면
 * 되고(기존 type을 재사용하는 한) 이 파일은 건드릴 필요가 없다.
 */
export class AchievementSystem {
    constructor() {
        /** @type {Set<string>} 달성한 업적 id 집합 */
        this.unlockedIds = new Set();
    }

    /**
     * 매 틱 호출되어 아직 달성하지 못한 업적의 조건을 확인한다.
     * @param {import('../world/World.js').World} world
     * @returns {{id: string, label: string}[]} 이번 호출에서 새로 달성한 업적 목록
     */
    checkAll(world) {
        const newlyUnlocked = [];
        for (const achievement of CONFIG.ACHIEVEMENTS) {
            if (this.unlockedIds.has(achievement.id)) continue;
            if (!AchievementSystem.#isConditionMet(achievement, world)) continue;

            this.unlockedIds.add(achievement.id);
            newlyUnlocked.push(achievement);
        }
        return newlyUnlocked;
    }

    /**
     * @param {{type: string, target: number | string}} achievement
     * @param {import('../world/World.js').World} world
     * @returns {boolean}
     */
    static #isConditionMet(achievement, world) {
        switch (achievement.type) {
            case 'totalRevenue':
                return world.stats.totalRevenue >= achievement.target;
            case 'totalSold':
                return world.stats.totalSold >= achievement.target;
            case 'itemProduced':
                return (world.stats.totalProducedByType[achievement.target] ?? 0) >= 1;
            case 'upgradeCount':
                return world.stats.totalUpgrades >= achievement.target;
            case 'buildingCount':
                return world.getAllBuildings().size >= achievement.target;
            case 'techUnlocked':
                return world.researchSystem.isUnlocked(achievement.target);
            default:
                return false;
        }
    }

    /**
     * @param {string} id
     * @returns {boolean}
     */
    isUnlocked(id) {
        return this.unlockedIds.has(id);
    }

    getUnlockedCount() {
        return this.unlockedIds.size;
    }

    serialize() {
        return { unlockedIds: [...this.unlockedIds] };
    }

    /**
     * @param {{unlockedIds: string[]}} data
     */
    restoreState(data) {
        this.unlockedIds = new Set(data?.unlockedIds ?? []);
    }
}