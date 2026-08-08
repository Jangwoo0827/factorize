/**
 * src/core/InputManager.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: InputManager
 *
 * 마우스/키보드 입력을 받아 Camera를 조작하고, 타일 클릭/철거/단축키를
 * 콜백을 통해 상위(Game)에 알려주는 역할을 담당한다.
 *
 * 주의: 이벤트 핸들러는 일반 메서드가 아니라 화살표 함수 필드로
 * 선언한다. 화살표 함수 필드는 인스턴스 생성 시 이미 this가 바인딩된
 * "값"으로 취급되므로, addEventListener/removeEventListener에 직접
 * 전달해도 Loop.js에서 겪었던 "private 메서드 재할당 불가" 문제가
 * 발생하지 않는다.
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { Logger } from '../utils/Utils.js';

/** 카메라 이동에 사용하는 키 코드 매핑. */
const PAN_KEYS = {
    KeyW: { x: 0, y: -1 },
    ArrowUp: { x: 0, y: -1 },
    KeyS: { x: 0, y: 1 },
    ArrowDown: { x: 0, y: 1 },
    KeyA: { x: -1, y: 0 },
    ArrowLeft: { x: -1, y: 0 },
    KeyD: { x: 1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
};

export class InputManager {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {import('./Camera.js').Camera} camera
     * @param {{
     *   onPrimaryAction?: (tileX: number, tileY: number) => void,
     *   onSecondaryAction?: (tileX: number, tileY: number) => void,
     *   onKeyPress?: (code: string) => void,
     *   onSaveRequest?: () => void,
     *   onLoadRequest?: () => void,
     *   onSelectionStart?: (tile: {tileX: number, tileY: number}) => void,
     *   onSelectionEnd?: () => void,
     *   onSelectionCancel?: () => void,
     * }} [callbacks]
     */
    constructor(canvas, camera, callbacks = {}) {
        this.canvas = canvas;
        this.camera = camera;
        this.callbacks = callbacks;

        this.isDragging = false;
        this.pointerMoved = false;
        this.pointerDownX = 0;
        this.pointerDownY = 0;
        this.lastPointerX = 0;
        this.lastPointerY = 0;

        // true인 동안은 좌클릭 드래그가 카메라를 팬하는 대신 사각형 영역을
        // 선택하는 데 쓰인다 (블루프린트 복사 도구가 켜져 있을 때만 true).
        // 실제 사각형 계산은 Game이 onSelectionStart 시점의 타일과
        // getHoveredTile()로 직접 하므로, 여기서는 모드 분기만 담당한다.
        this.selectionModeActive = false;

        // 드래그 중이 아니어도 항상 갱신되는, 마지막으로 알려진 마우스 위치
        // (건물 배치 미리보기/고스트 렌더링에 사용된다).
        this.hoverScreenX = 0;
        this.hoverScreenY = 0;
        this.hasHover = false;

        /** @type {Set<string>} 현재 눌려 있는 키 코드 집합 */
        this.keysDown = new Set();
    }

    /** 이벤트 리스너를 등록한다. Game.start()에서 호출된다. */
    attach() {
        this.canvas.style.cursor = 'grab';

        this.canvas.addEventListener('pointerdown', this.#onPointerDown);
        window.addEventListener('pointermove', this.#onPointerMove);
        window.addEventListener('pointerup', this.#onPointerUp);
        this.canvas.addEventListener('wheel', this.#onWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', this.#onContextMenu);
        window.addEventListener('keydown', this.#onKeyDown);
        window.addEventListener('keyup', this.#onKeyUp);
    }

    /** 이벤트 리스너를 해제한다. Game.stop()에서 호출된다. */
    detach() {
        this.canvas.removeEventListener('pointerdown', this.#onPointerDown);
        window.removeEventListener('pointermove', this.#onPointerMove);
        window.removeEventListener('pointerup', this.#onPointerUp);
        this.canvas.removeEventListener('wheel', this.#onWheel);
        this.canvas.removeEventListener('contextmenu', this.#onContextMenu);
        window.removeEventListener('keydown', this.#onKeyDown);
        window.removeEventListener('keyup', this.#onKeyUp);
    }

    /**
     * 키보드로 인한 지속적인 카메라 이동을 매 고정 타임스텝마다 처리한다.
     * @param {number} dt
     */
    update(dt) {
        let dirX = 0;
        let dirY = 0;

        for (const code of this.keysDown) {
            const dir = PAN_KEYS[code];
            if (dir) {
                dirX += dir.x;
                dirY += dir.y;
            }
        }

        if (dirX === 0 && dirY === 0) return;

        // 대각선 이동 시 속도가 √2배 빨라지지 않도록 정규화
        const length = Math.hypot(dirX, dirY);
        this.camera.panByKeyboard(dirX / length, dirY / length, dt);
    }

    /**
     * 현재 마우스가 가리키는 타일 좌표를 반환한다. 아직 마우스 위치를
     * 모르면(포인터가 캔버스에 들어온 적 없으면) null을 반환한다.
     * @returns {{tileX: number, tileY: number} | null}
     */
    getHoveredTile() {
        if (!this.hasHover) return null;

        const world = this.camera.screenToWorld(this.hoverScreenX, this.hoverScreenY);
        return {
            tileX: Math.floor(world.x / CONFIG.TILE.SIZE),
            tileY: Math.floor(world.y / CONFIG.TILE.SIZE),
        };
    }

    /**
     * 블루프린트 복사 도구처럼, 좌클릭 드래그를 카메라 팬 대신 사각형
     * 영역 선택으로 써야 하는 도구가 켜져 있는 동안 true로 설정한다.
     * @param {boolean} active
     */
    setSelectionMode(active) {
        this.selectionModeActive = active;
    }

    #screenPosFromEvent(event) {
        const rect = this.canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top,
        };
    }

    #tileFromEvent(event) {
        const { x, y } = this.#screenPosFromEvent(event);
        const world = this.camera.screenToWorld(x, y);
        return {
            tileX: Math.floor(world.x / CONFIG.TILE.SIZE),
            tileY: Math.floor(world.y / CONFIG.TILE.SIZE),
        };
    }

    #emitTileAction(event, kind) {
        const { tileX, tileY } = this.#tileFromEvent(event);

        if (kind === 'primary') {
            this.callbacks.onPrimaryAction?.(tileX, tileY);
        } else if (kind === 'secondary') {
            this.callbacks.onSecondaryAction?.(tileX, tileY);
        }
    }

    #onPointerDown = (event) => {
        // 우클릭(button === 2)은 드래그가 아니라 contextmenu 이벤트로 처리한다.
        if (event.button === 2) return;

        this.isDragging = true;
        this.pointerMoved = false;
        this.pointerDownX = event.clientX;
        this.pointerDownY = event.clientY;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;
        this.canvas.style.cursor = 'grabbing';

        if (this.selectionModeActive) {
            this.callbacks.onSelectionStart?.(this.#tileFromEvent(event));
        }
    };

    #onPointerMove = (event) => {
        const screenPos = this.#screenPosFromEvent(event);
        this.hoverScreenX = screenPos.x;
        this.hoverScreenY = screenPos.y;
        this.hasHover = true;

        if (!this.isDragging) return;

        const dx = event.clientX - this.lastPointerX;
        const dy = event.clientY - this.lastPointerY;
        this.lastPointerX = event.clientX;
        this.lastPointerY = event.clientY;

        if (!this.pointerMoved) {
            const totalDx = event.clientX - this.pointerDownX;
            const totalDy = event.clientY - this.pointerDownY;
            if (Math.hypot(totalDx, totalDy) > CONFIG.INPUT.CLICK_MOVE_THRESHOLD) {
                this.pointerMoved = true;
            }
        }

        // 영역 선택 중에는 드래그가 카메라를 움직이면 안 된다 (Game이 매
        // 프레임 pointerDown 시점 타일 ~ getHoveredTile()로 사각형을 그린다).
        if (this.selectionModeActive) return;

        this.camera.panByScreenDelta(dx, dy);
    };

    #onPointerUp = (event) => {
        if (this.selectionModeActive) {
            if (this.pointerMoved) {
                this.callbacks.onSelectionEnd?.();
            } else {
                this.callbacks.onSelectionCancel?.();
            }
            this.isDragging = false;
            this.canvas.style.cursor = 'grab';
            return;
        }

        if (this.isDragging && !this.pointerMoved) {
            this.#emitTileAction(event, 'primary');
        }
        this.isDragging = false;
        this.canvas.style.cursor = 'grab';
    };

    #onContextMenu = (event) => {
        event.preventDefault();
        this.#emitTileAction(event, 'secondary');
    };

    #onWheel = (event) => {
        event.preventDefault();

        const { x, y } = this.#screenPosFromEvent(event);
        const factor = event.deltaY < 0
            ? 1 + CONFIG.CAMERA.ZOOM_STEP
            : 1 - CONFIG.CAMERA.ZOOM_STEP;

        if (CONFIG.DEBUG.LOG_INPUT) {
            Logger.info(`wheel deltaY=${event.deltaY}, factor=${factor.toFixed(2)}`);
        }

        this.camera.zoomAt(x, y, factor);
    };

    #onKeyDown = (event) => {
        // Ctrl+S(저장)/Ctrl+L(불러오기)은 브라우저 기본 동작(페이지 저장/주소창 포커스)을
        // 막아야 하고, keysDown에도 등록하지 않아야 한다 (KeyS는 카메라 팬에도 쓰이므로,
        // 여기서 조기 반환하지 않으면 저장하는 동안 아래로 스크롤되는 것처럼 보인다).
        if (event.ctrlKey && event.code === 'KeyS') {
            event.preventDefault();
            this.callbacks.onSaveRequest?.();
            return;
        }
        if (event.ctrlKey && event.code === 'KeyL') {
            event.preventDefault();
            this.callbacks.onLoadRequest?.();
            return;
        }

        this.keysDown.add(event.code);

        // 연속 입력(누르고 있는 동안 반복 발생하는 repeat)은 제외하고,
        // 키를 처음 누른 순간에만 1회성 액션(회전, 건물 선택 등)을 알린다.
        if (!event.repeat) {
            if (CONFIG.DEBUG.LOG_INPUT) {
                Logger.info(`keydown code=${event.code}`);
            }
            this.callbacks.onKeyPress?.(event.code);
        }
    };

    #onKeyUp = (event) => {
        this.keysDown.delete(event.code);
    };
}