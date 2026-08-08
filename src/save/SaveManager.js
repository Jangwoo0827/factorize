/**
 * src/save/SaveManager.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: SaveManager
 *
 * localStorage에 게임 상태를 "슬롯" 단위로 저장/불러오기한다. 슬롯을 여러 개
 * 두는 이유는 실수로 Ctrl+S 한 번에 진행 상황 전체가 덮어써지는 걸 막기
 * 위함이다 - 슬롯마다 독립된 저장이라, 한 슬롯을 잘못 저장해도 다른
 * 슬롯은 그대로 남는다.
 *
 * 실제로 "무엇을" 저장할지는 각 도메인 객체(World, Economy, ResearchSystem 등)의
 * serialize()/restoreState()가 결정하고, 이 클래스는 그것들을 하나의 JSON으로
 * 모아 슬롯별 localStorage 키와 주고받는 역할, 그리고 슬롯 목록(메타데이터)을
 * 별도의 "매니페스트" 키로 관리하는 역할을 담당한다. 슬롯 전체 데이터를 다
 * 파싱하지 않고도 목록(이름/저장 시각/건물 수 등)을 빠르게 보여주기 위함이다.
 *
 * 버전 필드(SAVE_VERSION)를 포함시켜, 이후 저장 형식이 바뀌더라도
 * 예전 버전의 저장 데이터를 안전하게 구분/거부할 수 있게 한다.
 * ------------------------------------------------------------------
 */

import { Logger } from '../utils/Utils.js';

const MANIFEST_KEY = 'factorize_save_manifest_v1';
const SLOT_KEY_PREFIX = 'factorize_save_slot_v1_';
const SAVE_VERSION = 1;

// v1(슬롯 시스템 이전) 단일 저장 키 - 마이그레이션 대상.
const LEGACY_SAVE_KEY = 'factorize_save_v1';

export class SaveManager {
    /**
     * @param {import('../world/World.js').World} world
     * @param {import('../core/Camera.js').Camera} camera
     */
    constructor(world, camera) {
        this.world = world;
        this.camera = camera;
    }

    /**
     * 저장된 슬롯 목록을 최근 저장순으로 반환한다 (메타데이터만, 전체 데이터는 안 읽음).
     * 예전 단일 저장(factorize_save_v1)이 남아있고 슬롯이 하나도 없으면,
     * 그 데이터를 슬롯 하나로 자동 이전한 뒤 반환한다.
     * @returns {{id: string, label: string, savedAt: number, buildingCount: number, money: number}[]}
     */
    static listSlots() {
        SaveManager.#migrateLegacySaveIfNeeded();
        return SaveManager.#readManifest().sort((a, b) => b.savedAt - a.savedAt);
    }

    /**
     * 현재 게임 상태를 슬롯에 저장한다. slotId를 생략하면 새 슬롯을 만든다.
     * @param {string | null} [slotId] 기존 슬롯에 덮어쓰려면 그 슬롯의 id
     * @param {string} [label] 새 슬롯을 만들 때의 이름 (생략하면 자동 생성)
     * @returns {{success: boolean, slotId: string | null}}
     */
    saveToSlot(slotId, label) {
        try {
            const id = slotId ?? `slot_${Date.now()}`;
            const savedAt = Date.now();
            const worldData = this.world.serialize();

            const data = {
                version: SAVE_VERSION,
                savedAt,
                world: worldData,
                camera: { x: this.camera.x, y: this.camera.y, zoom: this.camera.zoom },
            };
            localStorage.setItem(SLOT_KEY_PREFIX + id, JSON.stringify(data));

            const manifest = SaveManager.#readManifest();
            const existing = manifest.find((slot) => slot.id === id);
            const meta = {
                id,
                label: label ?? existing?.label ?? SaveManager.#defaultLabel(savedAt),
                savedAt,
                buildingCount: worldData.buildings?.length ?? 0,
                money: worldData.economy?.money ?? 0,
            };

            if (existing) {
                Object.assign(existing, meta);
            } else {
                manifest.push(meta);
            }
            SaveManager.#writeManifest(manifest);

            Logger.info(`'${meta.label}' 슬롯에 저장했습니다.`);
            return { success: true, slotId: id };
        } catch (err) {
            // localStorage 용량 초과, 직렬화 실패 등 어떤 이유로든 저장에
            // 실패해도 게임 자체는 계속 진행되어야 하므로 예외를 여기서 막는다.
            Logger.error('저장에 실패했습니다.', err);
            return { success: false, slotId: null };
        }
    }

    /**
     * 지정한 슬롯의 데이터를 불러와 적용한다.
     * @param {string} slotId
     * @returns {boolean} 불러오기 성공 여부
     */
    loadFromSlot(slotId) {
        const raw = localStorage.getItem(SLOT_KEY_PREFIX + slotId);
        if (!raw) {
            Logger.warn('불러올 저장 데이터가 없습니다.');
            return false;
        }

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            Logger.error('저장 데이터가 손상되어 불러올 수 없습니다.', err);
            return false;
        }

        if (!data || typeof data !== 'object' || data.version !== SAVE_VERSION) {
            Logger.error(`지원하지 않는 저장 버전입니다 (${data?.version ?? '알 수 없음'}).`);
            return false;
        }

        try {
            this.world.loadFromSaveData(data.world ?? {});

            if (data.camera) {
                this.camera.x = data.camera.x;
                this.camera.y = data.camera.y;
                this.camera.targetX = data.camera.x;
                this.camera.targetY = data.camera.y;
                this.camera.zoom = data.camera.zoom;
                this.camera.targetZoom = data.camera.zoom;
            }

            Logger.info('저장된 게임을 불러왔습니다.');
            return true;
        } catch (err) {
            // 여기서 실패하면 world가 일부만 복원된 상태일 수 있으나,
            // 어차피 새 게임 상태로 이어가는 것과 크게 다르지 않으므로
            // 별도 롤백 없이 에러만 알린다.
            Logger.error('저장 데이터를 적용하는 중 오류가 발생했습니다.', err);
            return false;
        }
    }

    /**
     * 슬롯 하나를 완전히 지운다 (데이터 + 목록에서 제거).
     * @param {string} slotId
     */
    static deleteSlot(slotId) {
        localStorage.removeItem(SLOT_KEY_PREFIX + slotId);
        const manifest = SaveManager.#readManifest().filter((slot) => slot.id !== slotId);
        SaveManager.#writeManifest(manifest);
    }

    static #readManifest() {
        try {
            const raw = localStorage.getItem(MANIFEST_KEY);
            const manifest = raw ? JSON.parse(raw) : [];
            return Array.isArray(manifest) ? manifest : [];
        } catch (err) {
            Logger.error('저장 목록을 읽는 중 오류가 발생했습니다.', err);
            return [];
        }
    }

    /**
     * @param {object[]} manifest
     */
    static #writeManifest(manifest) {
        localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
    }

    /**
     * @param {number} savedAt
     */
    static #defaultLabel(savedAt) {
        return `저장 ${new Date(savedAt).toLocaleString('ko-KR')}`;
    }

    /** 슬롯 시스템 이전의 단일 저장이 있고 슬롯이 하나도 없으면 슬롯 하나로 옮긴다. */
    static #migrateLegacySaveIfNeeded() {
        const manifest = SaveManager.#readManifest();
        if (manifest.length > 0) return;

        const legacyRaw = localStorage.getItem(LEGACY_SAVE_KEY);
        if (!legacyRaw) return;

        let legacyData;
        try {
            legacyData = JSON.parse(legacyRaw);
        } catch {
            return;
        }
        if (!legacyData || legacyData.version !== SAVE_VERSION) return;

        const id = 'slot_legacy';
        localStorage.setItem(SLOT_KEY_PREFIX + id, legacyRaw);
        SaveManager.#writeManifest([{
            id,
            label: '이전 저장',
            savedAt: legacyData.savedAt ?? Date.now(),
            buildingCount: legacyData.world?.buildings?.length ?? 0,
            money: legacyData.world?.economy?.money ?? 0,
        }]);
        localStorage.removeItem(LEGACY_SAVE_KEY);
        Logger.info('이전 저장 데이터를 슬롯으로 옮겼습니다.');
    }
}
