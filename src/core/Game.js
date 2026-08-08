/**
 * src/core/Game.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Game
 *
 * 게임 전체를 조립하는 최상위 클래스. 실제 로직은 갖지 않고,
 * World / Camera / InputManager / UIManager / Loop / Renderer 등
 * 하위 모듈을 생성하고 연결하는 역할만 담당한다.
 * (건물 배치/철거/회전 조율은 Game이 각 모듈 사이의 "접착제" 역할로
 *  수행하며, Phase 3+에서 SystemManager가 생기면 생산/운송 로직은
 *  그쪽으로 옮겨간다.)
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { Loop } from './Loop.js';
import { Camera } from './Camera.js';
import { InputManager } from './InputManager.js';
import { World } from '../world/World.js';
import { Renderer } from '../rendering/Renderer.js';
import { Assembler, createBuilding, Direction, Miner, Storage } from '../entities/Building.js';
import { UIManager, BULLDOZE_TOOL_ID, BLUEPRINT_TOOL_ID, MULTI_SELECT_TOOL_ID } from '../ui/UIManager.js';
import { PowerSystem } from '../systems/Systems.js';
import { SaveManager } from '../save/SaveManager.js';
import { Logger } from '../utils/Utils.js';

export class Game {
    /** window resize 리스너에 등록/해제할 #handleResize의 바인딩된 참조 */
    #boundHandleResize;

    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{fps: HTMLElement, zoom: HTMLElement, tile: HTMLElement, ore: HTMLElement, money: HTMLElement, prodRate: HTMLElement, incomeRate: HTMLElement}} statElements
     *        하단 상태바에 표시할 DOM 요소들.
     * @param {{buildMenu: HTMLElement, researchBar: HTMLElement, objective: HTMLElement, inspector: HTMLElement, miniLog: HTMLElement, savePanel: HTMLElement}} uiElements
     *        각 UI 패널이 삽입될 컨테이너들.
     */
    constructor(canvas, statElements, uiElements) {
        this.canvas = canvas;
        this.statElements = statElements;

        this.world = new World(CONFIG.WORLD.CHUNK_SIZE);
        this.camera = new Camera();
        this.renderer = new Renderer(canvas);
        this.uiManager = new UIManager();
        this.saveManager = new SaveManager(this.world, this.camera);
        this.autoSaveTimer = 0;

        this.inputManager = new InputManager(canvas, this.camera, {
            onPrimaryAction: (tileX, tileY) => this.#handlePrimaryAction(tileX, tileY),
            onSecondaryAction: (tileX, tileY) => this.#handleSecondaryAction(tileX, tileY),
            onKeyPress: (code) => this.#handleKeyPress(code),
            onSaveRequest: () => this.#handleSaveRequest(),
            onLoadRequest: () => this.#handleLoadRequest(),
            onSelectionStart: (tile) => this.#handleSelectionStart(tile),
            onSelectionEnd: () => this.#handleSelectionEnd(),
            onSelectionCancel: () => this.#handleSelectionCancel(),
        });

        // 현재 배치하려는 건물의 방향 (컨베이어 등에서 R키로 회전)
        this.pendingRotation = Direction.RIGHT;

        // 건설 도구 없이 클릭해서 정보를 확인 중인 건물 (우측 InspectorPanel에 표시됨)
        /** @type {import('../entities/Building.js').Building | null} */
        this.inspectedBuilding = null;

        // 다중 선택 도구로 드래그해 고른 건물들. inspectedBuilding과는 상호 배타적이며,
        // 비어있지 않으면 InspectorPanel이 단일 건물 대신 이 목록을 보여준다.
        /** @type {import('../entities/Building.js').Building[]} */
        this.selectedBuildings = [];

        // 블루프린트 복사/붙여넣기 상태. blueprint가 null이면 "영역을 드래그해서
        // 복사하는 중"이고, 값이 있으면 "커서를 따라다니며 붙여넣기를 기다리는 중"이다.
        /** @type {{dx: number, dy: number, typeId: string, rotation: number}[] | null} */
        this.blueprint = null;
        /** @type {{tileX: number, tileY: number} | null} 드래그 시작 지점 (블루프린트/다중 선택 드래그 중에만 값이 있음) */
        this.selectionDragStart = null;

        this.buildMenuPanel = this.uiManager.initBuildMenu(uiElements.buildMenu, uiElements.buildMenuToggle, (selectedId) => {
            // 도구를 바꾸면 이전에 돌려둔 방향은 초기화하는 편이 직관적이다.
            this.pendingRotation = Direction.RIGHT;

            // 블루프린트/다중 선택 도구를 새로 선택하면 항상 빈 상태로 시작하고,
            // 다른 도구로 바뀌면 진행 중이던 복사/붙여넣기나 선택을 정리한다.
            this.blueprint = null;
            this.selectionDragStart = null;
            this.selectedBuildings = [];
            this.inputManager.setSelectionMode(selectedId === BLUEPRINT_TOOL_ID || selectedId === MULTI_SELECT_TOOL_ID);
        }, this.world.researchSystem);

        this.researchBarPanel = this.uiManager.initResearchBar(uiElements.researchBar, (techId) => {
            this.#handleResearchClick(techId);
        });

        this.objectivePanel = this.uiManager.initObjectivePanel(uiElements.objective);

        this.inspectorPanel = this.uiManager.initInspectorPanel(uiElements.inspector);
        this.miniLog = this.uiManager.initMiniLog(uiElements.miniLog);
        this.savePanel = this.uiManager.initSavePanel(
            uiElements.savePanel,
            () => this.#handleSaveRequest(),
            () => this.#handleLoadRequest(),
        );
        this.recipePanel = this.uiManager.initRecipePanel(uiElements.recipeToggle, uiElements.recipePanel);
        this.productionGraphPanel = this.uiManager.initProductionGraphPanel(uiElements.graphToggle, uiElements.graphPanel);
        this.settingsPanel = this.uiManager.initSettingsPanel(uiElements.settingsToggle, uiElements.settingsPanel);
        this.progressPanel = this.uiManager.initProgressPanel(uiElements.progressToggle, uiElements.progressPanel);

        this.loop = new Loop(
            (dt) => this.#update(dt),
            (alpha) => this.#render(alpha),
        );

        // private 메서드(#handleResize)는 재할당이 불가능하므로,
        // bind된 결과를 별도의 필드에 보관한다.
        this.#boundHandleResize = this.#handleResize.bind(this);
    }

    /** 게임을 시작한다. 초기 리사이즈 후 입력을 연결하고 루프를 가동한다. */
    start() {
        this.#boundHandleResize();
        window.addEventListener('resize', this.#boundHandleResize);
        this.inputManager.attach();
        this.loop.start();
    }

    /** 게임을 정지하고 리스너를 정리한다. */
    stop() {
        this.loop.stop();
        this.inputManager.detach();
        window.removeEventListener('resize', this.#boundHandleResize);
    }

    #handleResize() {
        const width = window.innerWidth;
        const height = window.innerHeight;
        this.renderer.resize(width, height);
        this.camera.setViewportSize(width, height);
    }

    /**
     * 좌클릭(드래그가 아닌 순수 클릭) 처리.
     * - 해체 도구가 선택되어 있으면 철거한다.
     * - 아무 도구도 선택되어 있지 않으면, 클릭한 타일의 건물을 정보 패널에 표시한다.
     * - 건물이 선택되어 있으면 배치한다.
     * @param {number} tileX
     * @param {number} tileY
     */
    #handlePrimaryAction(tileX, tileY) {
        const selectedId = this.buildMenuPanel.getSelectedId();

        if (selectedId === BLUEPRINT_TOOL_ID && this.blueprint) {
            this.#pasteBlueprintAt(tileX, tileY);
            return;
        }

        if (selectedId === BULLDOZE_TOOL_ID) {
            this.#removeBuildingAt(tileX, tileY);
            return;
        }

        if (!selectedId) {
            // 건설 도구가 없으면 좌클릭은 "정보 확인"으로 동작한다.
            this.inspectedBuilding = this.world.getBuildingAt(tileX, tileY);
            this.selectedBuildings = [];
            return;
        }

        if (!this.world.researchSystem.isBuildingUnlocked(selectedId)) {
            Logger.warn(`'${selectedId}'는 아직 연구로 해금되지 않았습니다.`);
            return;
        }

        if (this.world.isTileOccupied(tileX, tileY)) {
            Logger.warn(`(${tileX}, ${tileY}) 타일에는 이미 건물이 있어 배치할 수 없습니다.`);
            return;
        }

        const cost = CONFIG.BUILDINGS[selectedId]?.cost ?? 0;
        if (!this.world.economy.spendMoney(cost)) {
            Logger.warn(`자금이 부족합니다 (필요: ${cost}원, 보유: ${this.world.economy.getBalance()}원).`);
            return;
        }

        const building = createBuilding(selectedId, tileX, tileY, this.pendingRotation);
        this.world.placeBuilding(tileX, tileY, building);
        Logger.info(`${building.definition?.label ?? selectedId} 배치됨 (${tileX}, ${tileY}) - ${cost}원`);
    }

    /**
     * 우클릭 처리: 해당 타일의 건물을 철거한다 (선택된 도구와 무관하게 항상 동작).
     * @param {number} tileX
     * @param {number} tileY
     */
    #handleSecondaryAction(tileX, tileY) {
        this.#removeBuildingAt(tileX, tileY);
    }

    /**
     * 실제 건물 판매를 수행하는 공통 로직. 좌클릭(해체 도구)/우클릭 양쪽에서 호출된다.
     * 철거 대상이 현재 정보 패널에 표시 중이던 건물이면 패널도 함께 비운다.
     * @param {number} tileX
     * @param {number} tileY
     */
    #removeBuildingAt(tileX, tileY) {
        const targetBuilding = this.world.getBuildingAt(tileX, tileY);
        const removed = this.world.removeBuilding(tileX, tileY);

        if (!removed) return;

        const originalCost = targetBuilding.definition?.cost ?? 0;
        const refund = Math.floor(originalCost * CONFIG.ECONOMY.BUILDING_SELL_RATE);
        if (refund > 0) {
            this.world.economy.addMoney(refund);
        }

        if (this.inspectedBuilding === targetBuilding) {
            this.inspectedBuilding = null;
        }
        if (this.selectedBuildings.includes(targetBuilding)) {
            this.selectedBuildings = this.selectedBuildings.filter((b) => b !== targetBuilding);
        }
        Logger.info(`${targetBuilding.definition?.label ?? targetBuilding.typeId} 판매됨 (+${refund}원)`);
    }

    /**
     * 블루프린트/다중 선택 영역 드래그가 시작될 때(InputManager) 호출된다.
     * @param {{tileX: number, tileY: number}} tile
     */
    #handleSelectionStart(tile) {
        this.selectionDragStart = tile;
    }

    /**
     * 드래그로 영역 선택이 끝났을 때 호출된다. 어떤 도구가 선택되어 있었는지에
     * 따라 블루프린트 캡처 또는 다중 선택(일괄 업그레이드용) 중 하나로 처리한다.
     */
    #handleSelectionEnd() {
        const start = this.selectionDragStart;
        const end = this.inputManager.getHoveredTile();
        this.selectionDragStart = null;

        if (!start || !end) return;

        const selectedId = this.buildMenuPanel.getSelectedId();

        if (selectedId === MULTI_SELECT_TOOL_ID) {
            const buildings = this.#getBuildingsInRect(start, end).buildings;
            this.selectedBuildings = buildings;
            this.inspectedBuilding = null;
            if (buildings.length === 0) {
                Logger.warn('선택한 영역에 건물이 없습니다.');
            } else {
                Logger.info(`건물 ${buildings.length}개 선택됨`);
            }
            return;
        }

        // 그 외에는 블루프린트 도구 - 캡처 후엔 클릭으로 바로 붙여넣을 수 있도록 selectionMode를 끈다.
        const entries = this.#captureBlueprint(start, end);
        if (entries.length === 0) {
            Logger.warn('선택한 영역에 건물이 없습니다.');
            return;
        }

        this.blueprint = entries;
        this.inputManager.setSelectionMode(false);
        Logger.info(`블루프린트 복사됨 (건물 ${entries.length}개) - 클릭해서 붙여넣기, R로 회전`);
    }

    /** 드래그 없이 클릭만 했을 때(영역 선택 취소) 호출된다. 캡처할 게 없으므로 아무 동작도 하지 않는다. */
    #handleSelectionCancel() {
        this.selectionDragStart = null;
    }

    /**
     * 사각형 영역(두 타일 기준, 순서 무관) 안에 있는 건물들을 모아 반환한다.
     * 블루프린트 캡처와 다중 선택 둘 다 이 위에서 동작한다.
     * @param {{tileX: number, tileY: number}} start
     * @param {{tileX: number, tileY: number}} end
     * @returns {{buildings: import('../entities/Building.js').Building[], minX: number, minY: number}}
     */
    #getBuildingsInRect(start, end) {
        const minX = Math.min(start.tileX, end.tileX);
        const maxX = Math.max(start.tileX, end.tileX);
        const minY = Math.min(start.tileY, end.tileY);
        const maxY = Math.max(start.tileY, end.tileY);

        const buildings = [];
        for (let tileY = minY; tileY <= maxY; tileY++) {
            for (let tileX = minX; tileX <= maxX; tileX++) {
                const building = this.world.getBuildingAt(tileX, tileY);
                if (building) buildings.push(building);
            }
        }
        return { buildings, minX, minY };
    }

    /**
     * 사각형 영역 안의 건물들을 좌상단 기준 상대 좌표(dx, dy)로 캡처한다.
     * 건물의 진행 중인 상태(적재량/타이머 등)는 담지 않고 종류+방향만 담아,
     * 도장 찍듯 여러 번 붙여넣을 수 있게 한다.
     * @param {{tileX: number, tileY: number}} start
     * @param {{tileX: number, tileY: number}} end
     * @returns {{dx: number, dy: number, typeId: string, rotation: number}[]}
     */
    #captureBlueprint(start, end) {
        const { buildings, minX, minY } = this.#getBuildingsInRect(start, end);
        return buildings.map((building) => ({
            dx: building.tileX - minX,
            dy: building.tileY - minY,
            typeId: building.typeId,
            rotation: building.rotation,
        }));
    }

    /**
     * 현재 들고 있는 블루프린트를 anchor 타일(좌상단)에 도장 찍듯 붙여넣는다.
     * 이미 건물이 있거나, 아직 연구로 해금 안 됐거나, 자금이 부족한 칸은
     * 조용히 건너뛰고 나머지만 배치한다 (부분 배치를 허용해 큰 블루프린트도
     * 자금이 허락하는 만큼은 바로 짓게 한다). 블루프린트 자체는 계속
     * 들고 있으므로 다른 위치에 또 붙여넣을 수 있다.
     * @param {number} anchorX
     * @param {number} anchorY
     */
    #pasteBlueprintAt(anchorX, anchorY) {
        let placed = 0;

        for (const entry of this.blueprint) {
            const tileX = anchorX + entry.dx;
            const tileY = anchorY + entry.dy;

            if (this.world.isTileOccupied(tileX, tileY)) continue;
            if (!this.world.researchSystem.isBuildingUnlocked(entry.typeId)) continue;

            const cost = CONFIG.BUILDINGS[entry.typeId]?.cost ?? 0;
            if (!this.world.economy.spendMoney(cost)) continue;

            const building = createBuilding(entry.typeId, tileX, tileY, entry.rotation);
            this.world.placeBuilding(tileX, tileY, building);
            placed += 1;
        }

        Logger.info(`블루프린트 붙여넣기: ${placed}/${this.blueprint.length}개 배치됨`);
    }

    /**
     * 들고 있는 블루프린트 전체를 시계 방향으로 90도 회전한다. 개별 건물의
     * rotation은 하나씩 다음 Direction으로 넘기고, 상대 좌표는 (dx, dy) -> (-dy, dx)로
     * 회전한 뒤(Direction.RIGHT->DOWN->LEFT->UP과 같은 회전 방향) 다시 좌상단이
     * (0, 0)이 되도록 원점을 맞춘다.
     * @param {{dx: number, dy: number, typeId: string, rotation: number}[]} blueprint
     * @returns {{dx: number, dy: number, typeId: string, rotation: number}[]}
     */
    #rotateBlueprint(blueprint) {
        const rotated = blueprint.map((entry) => ({
            dx: -entry.dy,
            dy: entry.dx,
            typeId: entry.typeId,
            rotation: (entry.rotation + 1) % 4,
        }));

        const minDx = Math.min(...rotated.map((entry) => entry.dx));
        const minDy = Math.min(...rotated.map((entry) => entry.dy));

        return rotated.map((entry) => ({ ...entry, dx: entry.dx - minDx, dy: entry.dy - minDy }));
    }

    /**
     * 단축키 처리.
     * @param {string} code KeyboardEvent.code
     */
    #handleKeyPress(code) {
        if (code === 'KeyX') {
            this.buildMenuPanel.select(BULLDOZE_TOOL_ID);
            return;
        }

        if (code === 'Escape') {
            this.buildMenuPanel.select(null);
            this.inspectedBuilding = null;
            this.selectedBuildings = [];
            return;
        }

        if (code === 'KeyR') {
            if (this.blueprint) {
                this.blueprint = this.#rotateBlueprint(this.blueprint);
            } else {
                this.pendingRotation = (this.pendingRotation + 1) % 4;
            }
            return;
        }

        if (code === 'KeyM' && this.inspectedBuilding instanceof Miner) {
            this.inspectedBuilding.cycleResource();
            const label = this.inspectedBuilding.getInspectorInfo().find((row) => row.label === '생산 자원')?.value;
            Logger.info(`채굴 자원 변경: ${label}`);
            return;
        }

        if (code === 'KeyF' && this.inspectedBuilding instanceof Assembler) {
            this.inspectedBuilding.cycleRecipe();
            Logger.info(`조립 레시피 변경: ${this.inspectedBuilding.recipe.label}`);
        }
    }

    /**
     * 상단 연구 바에서 기술 연구 버튼을 눌렀을 때 처리한다.
     * @param {string} techId
     */
    #handleResearchClick(techId) {
        const success = this.world.researchSystem.tryResearch(techId);
        if (success) {
            Logger.info(`연구 완료: ${techId}`);
            // 새로 해금된 건물이 있을 수 있으니 좌측 건물 패널을 갱신한다.
            this.buildMenuPanel.refresh();
        }
    }

    /**
     * 우측 정보 패널의 "업그레이드" 버튼을 눌렀을 때 처리한다. 다중 선택 중이면
     * building 자리에 배열이 오는데, building.upgrade()가 건물마다 스스로
     * 자금/레벨 상한을 확인하므로 단일/일괄 업그레이드를 같은 루프로 처리할 수 있다.
     * @param {import('../entities/Building.js').Building | import('../entities/Building.js').Building[]} selection
     */
    #handleUpgradeClick(selection) {
        const buildings = Array.isArray(selection) ? selection : [selection];
        let upgraded = 0;
        for (const building of buildings) {
            if (building.upgrade(this.world.economy)) {
                upgraded += 1;
                this.world.stats.recordUpgrade();
            }
        }

        if (buildings.length === 1) {
            const building = buildings[0];
            if (upgraded > 0) {
                Logger.info(`${building.definition?.label ?? building.typeId} Lv.${building.level}로 업그레이드됨`);
            } else {
                Logger.warn('자금이 부족하거나 이미 최대 레벨입니다.');
            }
            return;
        }

        Logger.info(`일괄 업그레이드: ${upgraded}/${buildings.length}개 성공`);
    }

    /** 저장 버튼 클릭 또는 Ctrl+S 입력을 처리한다. */
    #handleSaveRequest() {
        const success = this.saveManager.save();
        const timeLabel = new Date().toLocaleTimeString();
        this.savePanel.setStatus(success ? `저장됨 (${timeLabel})` : '저장 실패');
    }

    /**
     * 불러오기 버튼 클릭 또는 Ctrl+L 입력을 처리한다.
     * 성공하면 연구 상태가 완전히 바뀌었을 수 있으므로 건물 패널을 처음부터
     * 다시 만들고, 이전에 확인 중이던 건물/선택 상태도 초기화한다.
     */
    #handleLoadRequest() {
        const success = this.saveManager.load();
        const timeLabel = new Date().toLocaleTimeString();
        this.savePanel.setStatus(success ? `불러옴 (${timeLabel})` : '불러올 데이터 없음');

        if (success) {
            this.buildMenuPanel.rebuild();
            this.inspectedBuilding = null;
            this.selectedBuildings = [];
            this.pendingRotation = Direction.RIGHT;
        }
    }

    /**
     * 고정 타임스텝 시뮬레이션 업데이트.
     * @param {number} dt
     */
    #update(dt) {
        this.inputManager.update(dt);
        this.camera.update(dt);

        // 건물들이 이번 틱의 powerRatio를 참고해 동작해야 하므로, 개별
        // 건물 업데이트보다 먼저 전력망을 계산한다.
        PowerSystem.update(this.world);

        for (const building of this.world.getAllBuildings()) {
            building.update(dt, this.world);
        }

        this.world.stats.update(dt);
        this.#checkAchievements();
        this.#updateAutoSave(dt);
    }

    /** 새로 달성한 업적이 있으면 미니로그에 알린다. */
    #checkAchievements() {
        const newlyUnlocked = this.world.achievements.checkAll(this.world);
        for (const achievement of newlyUnlocked) {
            Logger.info(`업적 달성: ${achievement.label}`);
        }
    }

    /**
     * 일정 주기마다 자동으로 저장한다.
     * @param {number} dt
     */
    #updateAutoSave(dt) {
        this.autoSaveTimer += dt;
        if (this.autoSaveTimer < CONFIG.SAVE.AUTO_SAVE_INTERVAL) return;

        this.autoSaveTimer = 0;
        const success = this.saveManager.save();
        const timeLabel = new Date().toLocaleTimeString();
        this.savePanel.setStatus(success ? `자동 저장됨 (${timeLabel})` : '자동 저장 실패');
    }

    /**
     * 매 프레임 렌더링.
     * @param {number} alpha 고정 타임스텝 사이의 보간 비율(0~1)
     */
    #render(alpha) {
        this.renderer.render(this.camera, this.world, this.#getPlacementPreview(), alpha, this.#getSelectionRect());
        this.researchBarPanel.update(this.world.researchSystem);
        this.objectivePanel.update(this.world);
        this.inspectorPanel.update(
            this.selectedBuildings.length > 0 ? this.selectedBuildings : this.inspectedBuilding,
            this.world.economy,
            (selection) => this.#handleUpgradeClick(selection),
        );
        this.buildMenuPanel.updateAffordability(this.world.economy);
        this.productionGraphPanel.update(this.world.stats);
        this.progressPanel.update(this.world);
        this.#updateStatusBar();
    }

    /**
     * 현재 마우스가 가리키는 위치에 그릴 배치 미리보기 정보를 계산한다.
     * 건물이 선택되어 있지 않으면 null을 반환해 아무것도 그리지 않는다.
     * 블루프린트를 붙여넣기 대기 중이면, 건물 하나가 아니라 블루프린트에
     * 담긴 모든 건물의 고스트 배열을 반환한다.
     * @returns {{tileX: number, tileY: number, typeId: string, rotation: number, isValid: boolean}
     *   | {tileX: number, tileY: number, typeId: string, rotation: number, isValid: boolean}[] | null}
     */
    #getPlacementPreview() {
        const selectedId = this.buildMenuPanel.getSelectedId();
        if (!selectedId || selectedId === BULLDOZE_TOOL_ID || selectedId === MULTI_SELECT_TOOL_ID) return null;

        const hovered = this.inputManager.getHoveredTile();
        if (!hovered) return null;

        if (selectedId === BLUEPRINT_TOOL_ID) {
            if (!this.blueprint) return null; // 아직 영역을 선택하는 중 -> 단일 고스트 대신 선택 사각형만 보여준다.

            return this.blueprint.map((entry) => {
                const tileX = hovered.tileX + entry.dx;
                const tileY = hovered.tileY + entry.dy;
                const isFree = !this.world.isTileOccupied(tileX, tileY);
                const isUnlocked = this.world.researchSystem.isBuildingUnlocked(entry.typeId);
                return {
                    tileX,
                    tileY,
                    typeId: entry.typeId,
                    rotation: entry.rotation,
                    isValid: isFree && isUnlocked,
                };
            });
        }

        const cost = CONFIG.BUILDINGS[selectedId]?.cost ?? 0;
        const canAfford = this.world.economy.getBalance() >= cost;
        const isFree = !this.world.isTileOccupied(hovered.tileX, hovered.tileY);

        return {
            tileX: hovered.tileX,
            tileY: hovered.tileY,
            typeId: selectedId,
            rotation: this.pendingRotation,
            isValid: isFree && canAfford,
        };
    }

    /**
     * 블루프린트 영역을 드래그로 선택하는 중일 때, 시작 타일부터 현재 커서
     * 타일까지의 사각형을 계산한다. 선택 중이 아니면 null.
     * @returns {{tileX: number, tileY: number, width: number, height: number} | null}
     */
    #getSelectionRect() {
        if (!this.selectionDragStart) return null;

        const hovered = this.inputManager.getHoveredTile();
        if (!hovered) return null;

        const start = this.selectionDragStart;
        const minX = Math.min(start.tileX, hovered.tileX);
        const minY = Math.min(start.tileY, hovered.tileY);
        const maxX = Math.max(start.tileX, hovered.tileX);
        const maxY = Math.max(start.tileY, hovered.tileY);

        return { tileX: minX, tileY: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }

    #updateStatusBar() {
        const { fps, zoom, tile, ore, money, prodRate, incomeRate } = this.statElements;

        if (fps) {
            const currentFps = this.loop.getFps();
            fps.textContent = `${currentFps}`;
            fps.classList.toggle('stat-value--warn', currentFps > 0 && currentFps < 45);
        }

        if (zoom) {
            zoom.textContent = `${Math.round(this.camera.zoom * 100)}%`;
        }

        if (tile) {
            const tileSize = CONFIG.TILE.SIZE;
            const tileX = Math.floor(this.camera.x / tileSize);
            const tileY = Math.floor(this.camera.y / tileSize);
            tile.textContent = `${tileX}, ${tileY}`;
        }

        if (ore) {
            ore.textContent = `${this.#getTotalStoredCount()}`;
        }

        if (money) {
            money.textContent = `${this.world.economy.getBalance()}`;
        }

        if (prodRate) {
            prodRate.textContent = `${this.world.stats.getTotalProductionRate()}/s`;
        }

        if (incomeRate) {
            incomeRate.textContent = `+${this.world.stats.getIncomeRate()}/s`;
        }
    }

    /** 모든 창고에 저장된 자원 개수를 합산한다 (디버그/데모용 지표). */
    #getTotalStoredCount() {
        let total = 0;
        for (const building of this.world.getAllBuildings()) {
            if (!(building instanceof Storage)) continue;
            for (const count of Object.values(building.storedCounts)) {
                total += count;
            }
        }
        return total;
    }
}
