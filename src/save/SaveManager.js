/**
 * src/save/SaveManager.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: SaveManager
 *
 * localStorage에 게임 상태를 저장/불러오기한다. 실제로 "무엇을" 저장할지는
 * 각 도메인 객체(World, Economy, ResearchSystem)의 serialize()/restoreState()가
 * 결정하고, 이 클래스는 그것들을 하나의 JSON으로 모아 localStorage와
 * 주고받는 역할만 담당한다.
 *
 * 버전 필드(SAVE_VERSION)를 포함시켜, 이후 저장 형식이 바뀌더라도
 * 예전 버전의 저장 데이터를 안전하게 구분/거부할 수 있게 한다.
 * ------------------------------------------------------------------
 */

import { Logger } from '../utils/Utils.js';

const SAVE_KEY = 'factorize_save_v1';
const SAVE_VERSION = 1;

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
     * 현재 게임 상태를 localStorage에 저장한다.
     * @returns {boolean} 저장 성공 여부
     */
    save() {
        try {
            const data = {
                version: SAVE_VERSION,
                savedAt: Date.now(),
                world: this.world.serialize(),
                camera: {
                    x: this.camera.x,
                    y: this.camera.y,
                    zoom: this.camera.zoom,
                },
            };

            localStorage.setItem(SAVE_KEY, JSON.stringify(data));
            Logger.info('게임을 저장했습니다.');
            return true;
        } catch (err) {
            // localStorage 용량 초과, 직렬화 실패 등 어떤 이유로든 저장에
            // 실패해도 게임 자체는 계속 진행되어야 하므로 예외를 여기서 막는다.
            Logger.error('저장에 실패했습니다.', err);
            return false;
        }
    }

    /**
     * localStorage에 저장된 게임 상태를 불러와 적용한다.
     * 저장된 데이터가 없거나 손상되었으면 현재 상태를 건드리지 않고 false를 반환한다.
     * @returns {boolean} 불러오기 성공 여부
     */
    load() {
        const raw = localStorage.getItem(SAVE_KEY);
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

    /** 저장된 데이터가 있는지 확인한다. */
    hasSaveData() {
        return localStorage.getItem(SAVE_KEY) !== null;
    }

    /** 저장된 데이터를 삭제한다. */
    deleteSaveData() {
        localStorage.removeItem(SAVE_KEY);
    }
}