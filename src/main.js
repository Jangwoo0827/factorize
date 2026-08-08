/**
 * src/main.js
 * ------------------------------------------------------------------
 * FACTORIZE 진입점.
 * DOM이 준비되면 저장 슬롯이 있는지 확인해 시작 화면(런처)을 보여줄지
 * 정하고, 사용자가 슬롯을 고르거나 "새 게임 시작"을 누르면 그때 Game
 * 인스턴스를 만들고 시작한다. 이 파일은 조립/부트스트랩 이외의 로직을
 * 갖지 않는다.
 * ------------------------------------------------------------------
 */

import { Game } from './core/Game.js';
import { SaveManager } from './save/SaveManager.js';
import { UIManager } from './ui/UIManager.js';
import { Logger } from './utils/Utils.js';

function showFatalError(message) {
    const overlay = document.getElementById('fatal-error');
    if (overlay) {
        overlay.textContent = `FACTORIZE 실행 중 오류가 발생했습니다: ${message}`;
        overlay.classList.add('is-visible');
    }
}

/**
 * id로 필수 DOM 요소를 찾는다. 없으면 null을 반환하고 에러를 기록한다.
 * @param {string} id
 * @returns {HTMLElement | null}
 */
function requireElement(id) {
    const el = document.getElementById(id);
    if (!el) {
        Logger.error(`#${id} 요소를 찾을 수 없습니다.`);
    }
    return el;
}

function bootstrap() {
    const canvas = requireElement('game-canvas');
    const statElements = {
        fps: requireElement('stat-fps'),
        zoom: requireElement('stat-zoom'),
        tile: requireElement('stat-tile'),
        ore: requireElement('stat-ore'),
        money: requireElement('stat-money'),
        prodRate: requireElement('stat-prod-rate'),
        incomeRate: requireElement('stat-income-rate'),
    };
    const uiElements = {
        buildMenu: requireElement('build-menu'),
        buildMenuToggle: requireElement('build-menu-toggle'),
        researchBar: requireElement('research-bar'),
        objective: requireElement('objective-panel'),
        inspector: requireElement('inspector-panel'),
        miniLog: requireElement('mini-log'),
        savePanel: requireElement('save-panel'),
        loadPanel: requireElement('load-panel'),
        recipeToggle: requireElement('recipe-toggle'),
        recipePanel: requireElement('recipe-panel'),
        graphToggle: requireElement('graph-toggle'),
        graphPanel: requireElement('graph-panel'),
        settingsToggle: requireElement('settings-toggle'),
        settingsPanel: requireElement('settings-panel'),
        progressToggle: requireElement('progress-toggle'),
        progressPanel: requireElement('progress-panel'),
        minimapCanvas: requireElement('minimap-canvas'),
    };
    const launcherOverlay = requireElement('launcher-overlay');
    const launcherSlotPickerContainer = requireElement('launcher-slot-picker');

    const missingRequired = !canvas
        || !uiElements.buildMenu
        || !uiElements.researchBar
        || !uiElements.objective
        || !uiElements.inspector
        || !uiElements.miniLog
        || !uiElements.savePanel
        || !uiElements.loadPanel
        || !uiElements.recipeToggle
        || !uiElements.recipePanel
        || !uiElements.graphToggle
        || !uiElements.graphPanel
        || !uiElements.buildMenuToggle
        || !uiElements.settingsToggle
        || !uiElements.settingsPanel
        || !uiElements.progressToggle
        || !uiElements.progressPanel
        || !uiElements.minimapCanvas
        || !launcherOverlay
        || !launcherSlotPickerContainer;

    if (missingRequired) {
        showFatalError('필수 UI 요소를 찾을 수 없습니다. index.html이 최신 버전인지 확인해주세요.');
        return;
    }

    /**
     * Game을 실제로 만들고 시작한다. slotId가 있으면 그 저장을 불러온 뒤 시작한다.
     * @param {string | null} slotId
     */
    function startGame(slotId) {
        try {
            const game = new Game(canvas, statElements, uiElements);

            if (slotId) {
                game.saveManager.loadFromSlot(slotId);
                game.activeSlotId = slotId;
            }

            game.start();

            // 디버깅 편의를 위해 전역에 노출 (프로덕션 배포 시 제거 가능)
            window.__FACTORIZE__ = game;

            Logger.info('FACTORIZE 부트스트랩 완료');
        } catch (err) {
            Logger.error('게임 초기화에 실패했습니다.', err);
            showFatalError(err.message ?? String(err));
        }
    }

    const slots = SaveManager.listSlots();

    // 저장된 게임이 하나도 없으면(첫 방문) 시작 화면 없이 바로 새 게임으로 진입한다.
    if (slots.length === 0) {
        launcherOverlay.classList.add('is-hidden');
        startGame(null);
        return;
    }

    // 저장된 게임이 있으면 시작 화면에서 고르게 한다.
    const uiManager = new UIManager();
    uiManager.initSaveSlotPicker(launcherSlotPickerContainer, {
        onSelectSlot: (slotId) => {
            launcherOverlay.classList.add('is-hidden');
            startGame(slotId);
        },
        onNewGame: () => {
            launcherOverlay.classList.add('is-hidden');
            startGame(null);
        },
        onDeleteSlot: (slotId) => {
            SaveManager.deleteSlot(slotId);
            uiManager.saveSlotPicker.render('이어할 게임을 고르세요', SaveManager.listSlots());
        },
    });
    uiManager.saveSlotPicker.render('이어할 게임을 고르세요', slots);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
