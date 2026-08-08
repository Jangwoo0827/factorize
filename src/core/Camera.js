/**
 * src/core/Camera.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Camera
 *
 * 카메라는 "목표값(target)"과 "현재값(current)"을 분리해서 관리한다.
 * 드래그/키보드/휠 입력은 항상 목표값만 바꾸고, update(dt)에서
 * 현재값이 목표값으로 서서히(지수 감쇠) 수렴하도록 만들어
 * 부드러운 이동/줌 애니메이션을 만든다.
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { clamp } from '../utils/Utils.js';

export class Camera {
    constructor() {
        // 현재 값 (렌더링에 사용됨)
        this.x = 0;
        this.y = 0;
        this.zoom = 1;

        // 목표 값 (입력이 갱신함)
        this.targetX = 0;
        this.targetY = 0;
        this.targetZoom = 1;

        this.viewportWidth = 0;
        this.viewportHeight = 0;
    }

    /**
     * 뷰포트 크기를 갱신한다 (창 리사이즈 시 호출).
     * @param {number} width
     * @param {number} height
     */
    setViewportSize(width, height) {
        this.viewportWidth = width;
        this.viewportHeight = height;
    }

    /**
     * 화면 픽셀 이동량만큼 카메라를 즉시 이동시킨다 (드래그용).
     * 드래그는 손끝을 그대로 따라가야 하므로 보간 없이 즉시 반영한다.
     * @param {number} screenDx
     * @param {number} screenDy
     */
    panByScreenDelta(screenDx, screenDy) {
        this.targetX -= screenDx / this.targetZoom;
        this.targetY -= screenDy / this.targetZoom;
        this.x = this.targetX;
        this.y = this.targetY;
    }

    /**
     * 키보드 입력으로 카메라를 이동시킨다 (보간 대상: targetX/Y).
     * @param {number} dirX -1, 0, 1
     * @param {number} dirY -1, 0, 1
     * @param {number} dt
     */
    panByKeyboard(dirX, dirY, dt) {
        const speed = CONFIG.CAMERA.KEYBOARD_PAN_SPEED / this.targetZoom;
        this.targetX += dirX * speed * dt;
        this.targetY += dirY * speed * dt;
    }

    /**
     * 특정 화면 좌표(보통 마우스 커서)를 고정점으로 삼아 확대/축소한다.
     * @param {number} screenX
     * @param {number} screenY
     * @param {number} factor 1보다 크면 확대, 작으면 축소
     */
    zoomAt(screenX, screenY, factor) {
        const worldBefore = this.screenToWorld(screenX, screenY);

        const newZoom = clamp(this.targetZoom * factor, CONFIG.CAMERA.MIN_ZOOM, CONFIG.CAMERA.MAX_ZOOM);
        this.targetZoom = newZoom;

        // 새 줌 값 기준으로, 같은 화면 좌표가 가리키는 월드 좌표를 다시 구해
        // 그 차이만큼 목표 위치를 보정한다 -> 커서 아래 지점이 화면상 고정된다.
        const worldAfterZoomOnly = this.#screenToWorldWithTarget(screenX, screenY);
        this.targetX += worldBefore.x - worldAfterZoomOnly.x;
        this.targetY += worldBefore.y - worldAfterZoomOnly.y;
    }

    /** targetX/targetY/targetZoom 기준으로 screenToWorld를 계산하는 내부 헬퍼. */
    #screenToWorldWithTarget(screenX, screenY) {
        return {
            x: (screenX - this.viewportWidth / 2) / this.targetZoom + this.targetX,
            y: (screenY - this.viewportHeight / 2) / this.targetZoom + this.targetY,
        };
    }

    /**
     * 목표값으로 현재값을 서서히 수렴시킨다. 매 고정 타임스텝마다 호출된다.
     * @param {number} dt
     */
    update(dt) {
        // 프레임(타임스텝) 크기와 무관하게 일정한 감쇠 속도를 갖도록
        // 지수 감쇠 공식을 사용한다: t = 1 - e^(-smoothing * dt)
        const t = 1 - Math.exp(-CONFIG.CAMERA.SMOOTHING * dt);
        this.x += (this.targetX - this.x) * t;
        this.y += (this.targetY - this.y) * t;
        this.zoom += (this.targetZoom - this.zoom) * t;
    }

    /**
     * 월드 좌표를 화면(캔버스 CSS 픽셀) 좌표로 변환한다.
     * @param {number} worldX
     * @param {number} worldY
     */
    worldToScreen(worldX, worldY) {
        return {
            x: (worldX - this.x) * this.zoom + this.viewportWidth / 2,
            y: (worldY - this.y) * this.zoom + this.viewportHeight / 2,
        };
    }

    /**
     * 화면 좌표를 월드 좌표로 변환한다.
     * @param {number} screenX
     * @param {number} screenY
     */
    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.viewportWidth / 2) / this.zoom + this.x,
            y: (screenY - this.viewportHeight / 2) / this.zoom + this.y,
        };
    }

    /** 현재 화면에 보이는 월드 좌표 범위를 반환한다 (렌더링 컬링에 사용). */
    getVisibleWorldBounds() {
        const topLeft = this.screenToWorld(0, 0);
        const bottomRight = this.screenToWorld(this.viewportWidth, this.viewportHeight);
        return {
            minX: topLeft.x,
            minY: topLeft.y,
            maxX: bottomRight.x,
            maxY: bottomRight.y,
        };
    }
}