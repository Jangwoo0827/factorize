/**
 * src/save/SaveManager.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: SaveManager
 *
 * 게임 상태를 "슬롯" 단위로 저장/불러오기한다. 슬롯을 여러 개 두는 이유는
 * 실수로 Ctrl+S 한 번에 진행 상황 전체가 덮어써지는 걸 막기 위함이다 -
 * 슬롯마다 독립된 저장이라, 한 슬롯을 잘못 저장해도 다른 슬롯은 그대로 남는다.
 *
 * 저장 위치가 두 곳으로 나뉜다:
 * - 슬롯 "목록"(이름/저장 시각/건물 수 등, 슬롯 하나당 몇백 바이트)은
 *   localStorage에 "매니페스트" 하나로 저장한다. 시작 화면이 Game을 만들기도
 *   전에 동기적으로 목록을 보여줘야 하므로, 여기만은 일부러 동기 API를 쓴다.
 * - 슬롯의 실제 "데이터"(건물 수만 개 분량의 world.serialize() 결과)는
 *   IndexedDB에 저장한다. localStorage는 오리진당 보통 5~10MB로 quota가
 *   작아서, 건물이 수만 개인 공장의 저장 데이터가 그 한도를 그냥 넘어버린다
 *   (실제로 QuotaExceededError로 저장이 실패하는 사례가 있었다). IndexedDB는
 *   보통 그보다 훨씬 큰(수백MB~) quota를 쓰므로 큰 공장도 안전하게 저장된다.
 *
 * 실제로 "무엇을" 저장할지는 각 도메인 객체(World, Economy, ResearchSystem 등)의
 * serialize()/restoreState()가 결정하고, 이 클래스는 그것들을 하나의 객체로
 * 모아 슬롯별로 저장/조회하는 역할만 담당한다.
 *
 * 버전 필드(SAVE_VERSION)를 포함시켜, 이후 저장 형식이 바뀌더라도
 * 예전 버전의 저장 데이터를 안전하게 구분/거부할 수 있게 한다.
 * ------------------------------------------------------------------
 */

import { Logger } from '../utils/Utils.js';

const MANIFEST_KEY = 'factorize_save_manifest_v1';
const SAVE_VERSION = 1;

// v1(슬롯 시스템 이전) 단일 저장 키 - 마이그레이션 대상.
const LEGACY_SAVE_KEY = 'factorize_save_v1';
// 슬롯 시스템 도입 초기(IndexedDB로 옮기기 전)에 슬롯 데이터를 저장하던
// localStorage 키 접두사 - 이것도 발견되면 IndexedDB로 옮긴다.
const LEGACY_SLOT_KEY_PREFIX = 'factorize_save_slot_v1_';

const DB_NAME = 'factorize_saves';
const DB_VERSION = 1;
const STORE_NAME = 'slots';

/** @type {Promise<IDBDatabase> | null} */
let dbPromise = null;

/** IndexedDB 연결을 한 번만 열고 재사용한다. */
function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                    request.result.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    return dbPromise;
}

/**
 * @param {string} key
 * @returns {Promise<object | undefined>}
 */
async function idbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const request = tx.objectStore(STORE_NAME).get(key);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/**
 * @param {string} key
 * @param {object} value
 * @returns {Promise<void>}
 */
async function idbSet(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
async function idbDelete(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

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
     * 그 데이터를 슬롯 하나로 자동 이전한 뒤 반환한다. 이 메서드는 목록을
     * 시작 화면이 Game 없이도 즉시 보여줄 수 있도록 일부러 동기(sync)로 남겨뒀다
     * (실제 데이터는 IndexedDB에 있지만, 목록에 필요한 메타데이터는 localStorage에 있다).
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
     * @returns {Promise<{success: boolean, slotId: string | null}>}
     */
    async saveToSlot(slotId, label) {
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
            await idbSet(id, data);
            // 예전(localStorage 기반) 슬롯 데이터가 같은 id로 남아있으면 정리한다
            // (안 지우면 quota만 축내는 죽은 데이터가 된다).
            localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + id);

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
            // IndexedDB 오류, 직렬화 실패 등 어떤 이유로든 저장에 실패해도
            // 게임 자체는 계속 진행되어야 하므로 예외를 여기서 막는다.
            Logger.error('저장에 실패했습니다.', err);
            return { success: false, slotId: null };
        }
    }

    /**
     * 지정한 슬롯의 데이터를 불러와 적용한다.
     * @param {string} slotId
     * @returns {Promise<boolean>} 불러오기 성공 여부
     */
    async loadFromSlot(slotId) {
        let data;
        try {
            data = await idbGet(slotId);
            if (!data) {
                data = await SaveManager.#migrateLegacySlotToIdb(slotId);
            }
        } catch (err) {
            Logger.error('저장 데이터를 읽는 중 오류가 발생했습니다.', err);
            return false;
        }

        if (!data) {
            Logger.warn('불러올 저장 데이터가 없습니다.');
            return false;
        }

        if (typeof data !== 'object' || data.version !== SAVE_VERSION) {
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
     * @returns {Promise<void>}
     */
    static async deleteSlot(slotId) {
        try {
            await idbDelete(slotId);
        } catch (err) {
            Logger.error('저장 데이터를 지우는 중 오류가 발생했습니다.', err);
        }
        localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + slotId);
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

    /** 슬롯 시스템 이전의 단일 저장이 있고 슬롯이 하나도 없으면 매니페스트에 슬롯 하나로 등록한다. */
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
        // 실제 데이터는 그대로 두고(다음 loadFromSlot에서 IndexedDB로 옮겨진다),
        // 시작 화면에 보여줄 목록에만 우선 등록한다.
        localStorage.setItem(LEGACY_SLOT_KEY_PREFIX + id, legacyRaw);
        SaveManager.#writeManifest([{
            id,
            label: '이전 저장',
            savedAt: legacyData.savedAt ?? Date.now(),
            buildingCount: legacyData.world?.buildings?.length ?? 0,
            money: legacyData.world?.economy?.money ?? 0,
        }]);
        localStorage.removeItem(LEGACY_SAVE_KEY);
        Logger.info('이전 저장 데이터를 슬롯 목록에 등록했습니다.');
    }

    /**
     * localStorage 기반이던 옛 슬롯 데이터가 이 id로 남아있으면 IndexedDB로
     * 옮기고 반환한다. 없으면 null.
     * @param {string} slotId
     * @returns {Promise<object | null>}
     */
    static async #migrateLegacySlotToIdb(slotId) {
        const raw = localStorage.getItem(LEGACY_SLOT_KEY_PREFIX + slotId);
        if (!raw) return null;

        let data;
        try {
            data = JSON.parse(raw);
        } catch (err) {
            Logger.error('예전 저장 데이터가 손상되어 옮길 수 없습니다.', err);
            localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + slotId);
            return null;
        }

        try {
            await idbSet(slotId, data);
            localStorage.removeItem(LEGACY_SLOT_KEY_PREFIX + slotId);
            Logger.info('저장 데이터를 더 큰 저장 공간(IndexedDB)으로 옮겼습니다.');
        } catch (err) {
            // 옮기기는 실패해도, 방금 읽은 데이터로 이번 불러오기는 계속 진행한다.
            Logger.error('저장 데이터를 옮기는 중 오류가 발생했습니다.', err);
        }

        return data;
    }
}
