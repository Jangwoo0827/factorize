/**
 * src/main.js
 * ------------------------------------------------------------------
 * FACTORIZE 진입점.
 * DOM이 준비되면 Game 인스턴스를 생성하고 시작한다.
 * 이 파일은 조립/부트스트랩 이외의 로직을 갖지 않는다.
 * ------------------------------------------------------------------
 */

import { Game } from './core/Game.js';
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
        recipeToggle: requireElement('recipe-toggle'),
        recipePanel: requireElement('recipe-panel'),
        graphToggle: requireElement('graph-toggle'),
        graphPanel: requireElement('graph-panel'),
        settingsToggle: requireElement('settings-toggle'),
        settingsPanel: requireElement('settings-panel'),
        progressToggle: requireElement('progress-toggle'),
        progressPanel: requireElement('progress-panel'),
    };

    const missingRequired = !canvas
        || !uiElements.buildMenu
        || !uiElements.researchBar
        || !uiElements.objective
        || !uiElements.inspector
        || !uiElements.miniLog
        || !uiElements.savePanel
        || !uiElements.recipeToggle
        || !uiElements.recipePanel
        || !uiElements.graphToggle
        || !uiElements.graphPanel
        || !uiElements.buildMenuToggle
        || !uiElements.settingsToggle
        || !uiElements.settingsPanel
        || !uiElements.progressToggle
        || !uiElements.progressPanel;

    if (missingRequired) {
        showFatalError('필수 UI 요소를 찾을 수 없습니다. index.html이 최신 버전인지 확인해주세요.');
        return;
    }

    try {
        const game = new Game(canvas, statElements, uiElements);
        game.start();

        // 디버깅 편의를 위해 전역에 노출 (프로덕션 배포 시 제거 가능)
        window.__FACTORIZE__ = game;

        Logger.info('FACTORIZE 부트스트랩 완료');
    } catch (err) {
        Logger.error('게임 초기화에 실패했습니다.', err);
        showFatalError(err.message ?? String(err));
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
} else {
    bootstrap();
}
