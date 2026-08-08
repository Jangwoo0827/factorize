/**
 * src/world/World.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Tile, Chunk, World
 *
 * 월드는 청크(Chunk) 단위로 타일을 관리한다.
 * 청크는 카메라가 실제로 필요로 할 때(getOrCreateChunk)만 생성되므로,
 * 맵 전체를 미리 할당하지 않고도 사실상 무한한 크기를 지원할 수 있다.
 *
 * 참고: 현재는 한 번 생성된 청크를 영구히 메모리에 보관한다. 다만 청크
 * 안의 타일은 전부 GROUND뿐이라 저장할 실질적 정보가 없으므로, Phase 8
 * 세이브 시스템은 청크/타일을 저장하지 않고 "배치된 건물 목록"만
 * 저장한다 (불러올 때 필요한 타일은 다시 자동 생성됨).
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { AchievementSystem, Economy, PowerSystem, ProductionStats, ResearchSystem } from '../systems/Systems.js';
import { deserializeBuilding } from '../entities/Building.js';

/** 타일 종류. Phase 1에서는 GROUND만 존재하며, 이후 자원 타일이 추가된다. */
export const TileType = Object.freeze({
    GROUND: 'ground',
});

/** 개별 타일의 데이터 홀더. */
export class Tile {
    /**
     * @param {number} tileX 월드 기준 타일 좌표
     * @param {number} tileY 월드 기준 타일 좌표
     * @param {string} type
     */
    constructor(tileX, tileY, type = TileType.GROUND) {
        this.tileX = tileX;
        this.tileY = tileY;
        this.type = type;
        /** @type {import('../entities/Building.js').Building | null} */
        this.building = null;
    }
}

/** size x size 개의 Tile을 소유하는 청크. */
export class Chunk {
    /**
     * @param {number} chunkX
     * @param {number} chunkY
     * @param {number} size 청크 한 변의 타일 개수
     */
    constructor(chunkX, chunkY, size) {
        this.chunkX = chunkX;
        this.chunkY = chunkY;
        this.size = size;
        this.tiles = new Array(size * size);

        for (let localY = 0; localY < size; localY++) {
            for (let localX = 0; localX < size; localX++) {
                const worldTileX = chunkX * size + localX;
                const worldTileY = chunkY * size + localY;
                this.tiles[localY * size + localX] = new Tile(worldTileX, worldTileY);
            }
        }
    }

    /**
     * 청크 로컬 좌표(0 ~ size-1)로 타일을 가져온다.
     * @param {number} localX
     * @param {number} localY
     * @returns {Tile}
     */
    getLocalTile(localX, localY) {
        return this.tiles[localY * this.size + localX];
    }
}

/** 청크들의 컨테이너이자 월드 좌표 <-> 청크 좌표 변환을 담당하는 클래스. */
export class World {
    /**
     * @param {number} chunkSize
     */
    constructor(chunkSize) {
        this.chunkSize = chunkSize;
        /** @type {Map<string, Chunk>} key: "chunkX,chunkY" */
        this.chunks = new Map();
        /**
         * 배치된 모든 건물의 평면(flat) 목록. 매 틱 건물을 업데이트할 때
         * 청크/타일을 전부 순회하지 않고 이 Set만 순회하면 되도록 하기
         * 위한 것 (업데이트 비용을 "배치된 건물 수"에만 비례하게 만든다).
         * @type {Set<import('../entities/Building.js').Building>}
         */
        this.buildings = new Set();

        /**
         * typeId별 배치된 건물 개수. ObjectivePanel처럼 "이 종류가 하나라도
         * 있는가"를 매 프레임 확인하는 곳에서, 건물 수만큼 스캔하는 대신
         * O(1)로 답할 수 있게 하기 위한 캐시 (placeBuilding/removeBuilding이 갱신).
         * @type {Map<string, number>}
         */
        this.buildingCountsByType = new Map();

        /** 전역 자금 상태. 특정 건물에 속하지 않으므로 World가 소유한다. */
        this.economy = new Economy(CONFIG.ECONOMY.STARTING_MONEY);

        /** 전역 연구 상태. Lab 건물과 ResearchBar UI가 함께 참조한다. */
        this.researchSystem = new ResearchSystem();

        /**
         * 생산/판매 이벤트를 집계하는 전역 통계. 순간 수치(초당 생산량 등)는
         * 세이브 대상이 아니지만, 누적 값(총 수익 등)은 마일스톤/업적이
         * 참조하므로 저장된다 (World.serialize() 참고).
         */
        this.stats = new ProductionStats();

        /** 업적 달성 상태. CONFIG.ACHIEVEMENTS를 기준으로 매 틱 확인된다. */
        this.achievements = new AchievementSystem();

        /**
         * 전력망 계산. 그래프 위상은 placeBuilding()/removeBuilding()이 전력
         * 건물을 배치/철거할 때만 markDirty()로 무효화되고, 나머지 틱은
         * 캐시된 위상으로 공급/수요만 다시 합산한다 (성능 최적화).
         */
        this.powerSystem = new PowerSystem();
    }

    #chunkKey(chunkX, chunkY) {
        return `${chunkX},${chunkY}`;
    }

    /**
     * 해당 청크 좌표의 청크를 가져오거나, 없으면 새로 생성한다.
     * @param {number} chunkX
     * @param {number} chunkY
     * @returns {Chunk}
     */
    getOrCreateChunk(chunkX, chunkY) {
        const key = this.#chunkKey(chunkX, chunkY);
        let chunk = this.chunks.get(key);
        if (!chunk) {
            chunk = new Chunk(chunkX, chunkY, this.chunkSize);
            this.chunks.set(key, chunk);
        }
        return chunk;
    }

    /**
     * 월드 타일 좌표로 타일을 가져온다. 해당 청크가 없으면 생성한다.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {Tile}
     */
    getTile(tileX, tileY) {
        const chunkX = Math.floor(tileX / this.chunkSize);
        const chunkY = Math.floor(tileY / this.chunkSize);
        const chunk = this.getOrCreateChunk(chunkX, chunkY);

        const localX = tileX - chunkX * this.chunkSize;
        const localY = tileY - chunkY * this.chunkSize;
        return chunk.getLocalTile(localX, localY);
    }

    /** 현재 메모리에 로드되어 있는 청크 개수 (디버그/최적화 확인용). */
    getLoadedChunkCount() {
        return this.chunks.size;
    }

    /**
     * 해당 타일에 건물을 배치한다. 이미 건물이 있으면 배치하지 않고 false를 반환한다.
     * @param {number} tileX
     * @param {number} tileY
     * @param {import('../entities/Building.js').Building} building
     * @returns {boolean} 배치 성공 여부
     */
    placeBuilding(tileX, tileY, building) {
        const tile = this.getTile(tileX, tileY);
        if (tile.building) {
            return false;
        }
        tile.building = building;
        this.buildings.add(building);
        this.buildingCountsByType.set(building.typeId, (this.buildingCountsByType.get(building.typeId) ?? 0) + 1);
        if (building.isPowerNode()) this.powerSystem.markDirty();
        return true;
    }

    /**
     * 해당 타일의 건물을 철거한다.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean} 철거 성공 여부 (건물이 없었으면 false)
     */
    removeBuilding(tileX, tileY) {
        const tile = this.getTile(tileX, tileY);
        if (!tile.building) {
            return false;
        }
        this.buildings.delete(tile.building);
        const remaining = (this.buildingCountsByType.get(tile.building.typeId) ?? 1) - 1;
        if (remaining > 0) {
            this.buildingCountsByType.set(tile.building.typeId, remaining);
        } else {
            this.buildingCountsByType.delete(tile.building.typeId);
        }
        if (tile.building.isPowerNode()) this.powerSystem.markDirty();
        tile.building = null;
        return true;
    }

    /**
     * 이 typeId의 건물이 하나라도 배치되어 있는지 O(1)로 확인한다.
     * (건물 수만큼 스캔하는 배열 검색 대신 buildingCountsByType 캐시를 쓴다.)
     * @param {string} typeId
     * @returns {boolean}
     */
    hasBuildingType(typeId) {
        return (this.buildingCountsByType.get(typeId) ?? 0) > 0;
    }

    /**
     * 해당 타일에 건물이 있는지(=배치 가능한지) 확인한다.
     * @param {number} tileX
     * @param {number} tileY
     * @returns {boolean}
     */
    isTileOccupied(tileX, tileY) {
        return this.getTile(tileX, tileY).building !== null;
    }

    /**
     * 해당 타일의 건물을 반환한다 (없으면 null).
     * @param {number} tileX
     * @param {number} tileY
     * @returns {import('../entities/Building.js').Building | null}
     */
    getBuildingAt(tileX, tileY) {
        return this.getTile(tileX, tileY).building;
    }

    /**
     * 배치된 모든 건물을 순회 가능한 형태로 반환한다 (매 틱 업데이트용).
     * @returns {Set<import('../entities/Building.js').Building>}
     */
    getAllBuildings() {
        return this.buildings;
    }

    /**
     * 저장 가능한 순수 데이터로 변환한다. 타일/청크는 저장하지 않고,
     * 배치된 건물과 전역 상태(자금/연구/누적 통계/업적)만 저장한다.
     * @returns {object}
     */
    serialize() {
        return {
            chunkSize: this.chunkSize,
            buildings: [...this.buildings].map((building) => building.serialize()),
            economy: { money: this.economy.getBalance() },
            research: {
                points: this.researchSystem.getPoints(),
                unlockedTechIds: [...this.researchSystem.unlockedTechIds],
            },
            stats: this.stats.serialize(),
            achievements: this.achievements.serialize(),
        };
    }

    /**
     * 저장된 데이터로 현재 월드 상태를 완전히 대체한다.
     * 기존에 배치되어 있던 건물/청크는 전부 버려지고 저장된 내용으로 다시 채워진다.
     * @param {object} data World.serialize()가 만든 형태의 데이터
     */
    loadFromSaveData(data) {
        // 기존 청크(타일 캐시)와 건물 목록을 비운다. 타일은 필요할 때
        // getTile()이 다시 생성해주므로 안전하게 버려도 된다.
        this.chunks.clear();
        this.buildings.clear();
        this.buildingCountsByType.clear();

        for (const buildingData of data.buildings ?? []) {
            const building = deserializeBuilding(buildingData);
            this.placeBuilding(building.tileX, building.tileY, building);
        }

        this.economy.setBalance(data.economy?.money ?? CONFIG.ECONOMY.STARTING_MONEY);
        this.researchSystem.restoreState(data.research);
        this.stats.restoreState(data.stats);
        this.achievements.restoreState(data.achievements);
    }
}