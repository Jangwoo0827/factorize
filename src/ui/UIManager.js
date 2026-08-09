/**
 * src/ui/UIManager.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: BuildMenuPanel, ResearchBar, InspectorPanel,
 *                     MiniLog, SavePanel, UIManager
 *
 * UI는 Canvas가 아니라 DOM으로 구성한다는 원칙에 따라, 버튼/텍스트를
 * 실제 DOM 엘리먼트로 만든다. 목록은 하드코딩하지 않고
 * CONFIG.BUILDINGS / CONFIG.TECH_TREE 레지스트리를 순회해서 생성하므로,
 * 새 건물/기술을 추가할 때 이 파일을 손댈 필요가 없다 (config.js만 수정).
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { Logger } from '../utils/Utils.js';
import { ResourceRegistry } from '../resources/Resources.js';
import { Miner } from '../entities/Building.js';

/** 해체(철거) 도구를 선택했을 때 사용하는 특수 ID. CONFIG.BUILDINGS의 키와 겹치지 않는다. */
export const BULLDOZE_TOOL_ID = 'bulldoze';

/** 블루프린트 복사/붙여넣기 도구를 선택했을 때 사용하는 특수 ID. */
export const BLUEPRINT_TOOL_ID = 'blueprint';

/** 드래그로 기존 건물 여러 개를 골라 일괄 업그레이드하는 도구를 선택했을 때 사용하는 특수 ID. */
export const MULTI_SELECT_TOOL_ID = 'multiselect';

export class BuildMenuPanel {
    /**
     * @param {HTMLElement} containerEl 버튼들이 삽입될 컨테이너
     * @param {HTMLElement} toggleEl 패널을 여닫는 좌측 가장자리 버튼
     * @param {(selectedId: string | null) => void} onSelectionChange 선택이 바뀔 때마다 호출
     * @param {import('../systems/Systems.js').ResearchSystem} researchSystem 건물별 연구 잠금 여부 판정에 사용
     */
    constructor(containerEl, toggleEl, onSelectionChange, researchSystem) {
        this.containerEl = containerEl;
        this.toggleEl = toggleEl;
        this.onSelectionChange = onSelectionChange;
        this.researchSystem = researchSystem;

        /** @type {string | null} 현재 선택된 건물 typeId 또는 BULLDOZE_TOOL_ID, 없으면 null */
        this.selectedId = null;

        /** @type {Map<string, HTMLButtonElement>} */
        this.buttonsById = new Map();

        // 마인크래프트 창작 모드 인벤토리처럼, 건물이 늘어나도 한눈에 찾을 수 있도록
        // 카테고리 탭으로 나눈다. 탭 자체(this.tabsEl)와 실제 버튼이 놓이는 그리드
        // (this.gridEl)를 분리해서, 탭 바는 그리드 CSS의 영향을 받지 않게 한다.
        this.tabsEl = document.createElement('div');
        this.tabsEl.className = 'build-menu-tabs';

        this.gridEl = document.createElement('div');
        this.gridEl.className = 'build-menu-grid';

        this.containerEl.appendChild(this.tabsEl);
        this.containerEl.appendChild(this.gridEl);

        /** @type {string | null} 현재 활성 탭(카테고리) id */
        this.activeCategory = CONFIG.BUILD_CATEGORIES[0]?.id ?? null;
        /** @type {Map<string, HTMLButtonElement>} */
        this.tabButtonsByCategory = new Map();
        this.#buildTabs();

        this.#refreshBuildingButtons();

        // 해체/블루프린트/다중 선택 도구는 연구·카테고리와 무관하게 항상 맨 뒤에,
        // 어느 탭을 보고 있든 표시한다 (건물이 아니라 "도구"이기 때문).
        this.bulldozeButtonEl = this.#createButton(
            BULLDOZE_TOOL_ID,
            '해체',
            CONFIG.RENDER.GHOST_INVALID_COLOR,
        );
        this.bulldozeButtonEl.classList.add('build-btn--bulldoze');
        this.gridEl.appendChild(this.bulldozeButtonEl);
        this.buttonsById.set(BULLDOZE_TOOL_ID, this.bulldozeButtonEl);

        this.blueprintButtonEl = this.#createButton(
            BLUEPRINT_TOOL_ID,
            '블루프린트',
            CONFIG.RENDER.ACCENT_CYAN,
        );
        this.blueprintButtonEl.classList.add('build-btn--blueprint');
        this.gridEl.appendChild(this.blueprintButtonEl);
        this.buttonsById.set(BLUEPRINT_TOOL_ID, this.blueprintButtonEl);

        this.multiSelectButtonEl = this.#createButton(
            MULTI_SELECT_TOOL_ID,
            '다중 선택',
            CONFIG.RENDER.ACCENT_AMBER,
        );
        this.multiSelectButtonEl.classList.add('build-btn--blueprint');
        this.gridEl.appendChild(this.multiSelectButtonEl);
        this.buttonsById.set(MULTI_SELECT_TOOL_ID, this.multiSelectButtonEl);

        this.#applyCategoryFilter();

        // 평소엔 화면 밖으로 접혀 있다가, 버튼을 누르면 슬라이드로 펼쳐진다
        // (건물 목록이 항상 떠 있으면 캔버스를 가리는 게 불편하다는 피드백).
        this.isOpen = false;
        this.toggleEl.addEventListener('click', () => this.setOpen(!this.isOpen));
    }

    /**
     * @param {boolean} open
     */
    setOpen(open) {
        this.isOpen = open;
        this.containerEl.classList.toggle('is-open', this.isOpen);
        this.toggleEl.classList.toggle('is-active', this.isOpen);
    }

    /** CONFIG.BUILD_CATEGORIES를 기반으로 탭 버튼을 만든다. */
    #buildTabs() {
        for (const category of CONFIG.BUILD_CATEGORIES) {
            const tabButton = document.createElement('button');
            tabButton.type = 'button';
            tabButton.className = 'build-menu-tab';
            tabButton.textContent = category.label;
            tabButton.classList.toggle('is-active', category.id === this.activeCategory);
            tabButton.addEventListener('click', () => this.#selectCategory(category.id));

            this.tabsEl.appendChild(tabButton);
            this.tabButtonsByCategory.set(category.id, tabButton);
        }
    }

    /**
     * @param {string} categoryId
     */
    #selectCategory(categoryId) {
        this.activeCategory = categoryId;
        for (const [id, tabButton] of this.tabButtonsByCategory) {
            tabButton.classList.toggle('is-active', id === categoryId);
        }
        this.#applyCategoryFilter();
    }

    /**
     * 현재 활성 탭에 속하지 않는 건물 버튼은 숨긴다. 해체/블루프린트/다중 선택
     * 도구는 카테고리가 없으므로(CONFIG.BUILDINGS에 없음) 항상 보여준다.
     */
    #applyCategoryFilter() {
        for (const [id, button] of this.buttonsById) {
            const category = CONFIG.BUILDINGS[id]?.category;
            const visible = !category || category === this.activeCategory;
            button.style.display = visible ? '' : 'none';
        }
    }

    /**
     * 연구로 새 건물이 해금됐을 수 있으니 다시 확인해 버튼을 추가한다.
     * 연구 성공 직후 Game이 호출한다 (매 프레임 폴링하지 않고 이벤트 시점에만 갱신).
     */
    refresh() {
        this.#refreshBuildingButtons();
        this.#applyCategoryFilter();
    }

    /**
     * 버튼 목록을 처음부터 다시 만든다. 저장 불러오기처럼 연구 상태가
     * (해금이 늘어나는 게 아니라) 완전히 다른 값으로 바뀔 수 있는 경우에
     * refresh()만으로는 이미 표시된 버튼을 지울 수 없으므로 이 메서드를 쓴다.
     */
    rebuild() {
        this.gridEl.innerHTML = '';
        this.buttonsById.clear();
        this.selectedId = null;

        // 해체/블루프린트/다중 선택 버튼을 먼저 다시 그리드에 붙여야, 아래
        // #refreshBuildingButtons()가 insertBefore(button, this.bulldozeButtonEl)로
        // 건물 버튼들을 그 앞에 끼워 넣을 수 있다 (innerHTML='' 직후에는 DOM에서
        // 완전히 떨어져 나가 insertBefore의 기준 노드로 쓸 수 없다).
        this.gridEl.appendChild(this.bulldozeButtonEl);
        this.buttonsById.set(BULLDOZE_TOOL_ID, this.bulldozeButtonEl);
        this.gridEl.appendChild(this.blueprintButtonEl);
        this.buttonsById.set(BLUEPRINT_TOOL_ID, this.blueprintButtonEl);
        this.gridEl.appendChild(this.multiSelectButtonEl);
        this.buttonsById.set(MULTI_SELECT_TOOL_ID, this.multiSelectButtonEl);

        this.#refreshBuildingButtons();
        this.#applyCategoryFilter();
    }

    #refreshBuildingButtons() {
        for (const def of Object.values(CONFIG.BUILDINGS)) {
            if (this.buttonsById.has(def.id)) continue; // 이미 표시 중
            if (!this.researchSystem.isBuildingUnlocked(def.id)) continue; // 아직 잠김

            const button = this.#createButton(def.id, def.label, def.color, def.cost);
            // 해체 버튼은 항상 맨 뒤에 있어야 하므로, 있으면 그 앞에 끼워 넣는다.
            this.gridEl.insertBefore(button, this.bulldozeButtonEl ?? null);
            this.buttonsById.set(def.id, button);
        }
    }

    /**
     * 상점/인벤토리 카드 형태의 버튼을 만든다: 색상 아이콘 + 이름 + 가격.
     * @param {string} id
     * @param {string} label
     * @param {string} accentColor
     * @param {number} [cost] 해체 도구처럼 비용이 없는 경우 생략
     */
    #createButton(id, label, accentColor, cost) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'build-btn';
        button.style.setProperty('--accent-color', accentColor);

        const icon = document.createElement('span');
        icon.className = 'build-btn-icon';

        const labelEl = document.createElement('span');
        labelEl.className = 'build-btn-label';
        labelEl.textContent = label;

        const costEl = document.createElement('span');
        costEl.className = 'build-btn-cost';
        costEl.textContent = cost != null ? `${cost}원` : '';

        button.appendChild(icon);
        button.appendChild(labelEl);
        button.appendChild(costEl);
        button.addEventListener('click', () => this.#handleClick(id));
        return button;
    }

    /**
     * 매 프레임 호출되어, 현재 자금으로 살 수 없는 건물의 카드를 흐리게 표시한다.
     * (실제 구매 가능 여부 최종 판정은 배치 시점에 Game이 다시 한번 확인한다.)
     * @param {import('../systems/Systems.js').Economy} economy
     */
    updateAffordability(economy) {
        const balance = economy.getBalance();
        for (const [id, button] of this.buttonsById) {
            if (id === BULLDOZE_TOOL_ID || id === BLUEPRINT_TOOL_ID || id === MULTI_SELECT_TOOL_ID) continue;
            const cost = CONFIG.BUILDINGS[id]?.cost ?? 0;
            button.classList.toggle('is-unaffordable', balance < cost);
        }
    }

    #handleClick(id) {
        // 이미 선택된 항목을 다시 누르면 선택 해제(토글)한다.
        this.select(this.selectedId === id ? null : id);
    }

    /**
     * 선택 상태를 외부(단축키 등)에서도 변경할 수 있도록 공개 메서드로 제공한다.
     * @param {string | null} id
     */
    select(id) {
        this.selectedId = id;
        this.#refreshActiveState();
        this.onSelectionChange?.(this.selectedId);
    }

    #refreshActiveState() {
        for (const [id, button] of this.buttonsById) {
            button.classList.toggle('is-active', id === this.selectedId);
        }
    }

    getSelectedId() {
        return this.selectedId;
    }
}

/**
 * 상단 연구 바. 현재 RP와, 지금 연구 가능한 기술 목록(선행 조건 충족)을 보여준다.
 * RP는 계속 누적되므로 매 프레임 update()를 호출해 버튼의 활성/비활성 상태를 갱신한다.
 */
export class ResearchBar {
    /**
     * @param {HTMLElement} containerEl
     * @param {(techId: string) => void} onResearchClick
     */
    constructor(containerEl, onResearchClick) {
        this.containerEl = containerEl;
        this.onResearchClick = onResearchClick;

        this.rpLabelEl = document.createElement('span');
        this.rpLabelEl.className = 'research-rp';

        this.listEl = document.createElement('div');
        this.listEl.className = 'research-list';

        this.containerEl.appendChild(this.rpLabelEl);
        this.containerEl.appendChild(this.listEl);

        /** @type {Map<string, HTMLButtonElement>} */
        this.buttonsByTechId = new Map();
    }

    /**
     * 매 프레임 호출되어 RP 표시와 연구 가능 목록을 최신 상태로 갱신한다.
     * @param {import('../systems/Systems.js').ResearchSystem} researchSystem
     */
    update(researchSystem) {
        const points = researchSystem.getPoints();
        this.rpLabelEl.textContent = `RP ${Math.floor(points)}`;

        const researchable = researchSystem.getResearchableTechs();
        const currentIds = new Set(researchable.map((tech) => tech.id));

        // 더 이상 연구 가능 목록에 없는(방금 해금된 등) 버튼은 제거한다.
        for (const [id, button] of this.buttonsByTechId) {
            if (!currentIds.has(id)) {
                button.remove();
                this.buttonsByTechId.delete(id);
            }
        }

        for (const tech of researchable) {
            let button = this.buttonsByTechId.get(tech.id);
            if (!button) {
                button = document.createElement('button');
                button.type = 'button';
                button.className = 'research-btn';
                button.addEventListener('click', () => this.onResearchClick(tech.id));
                this.listEl.appendChild(button);
                this.buttonsByTechId.set(tech.id, button);
            }

            const affordable = points >= tech.cost;
            button.textContent = `${tech.label} (${tech.cost} RP)`;
            button.disabled = !affordable;
            button.classList.toggle('is-affordable', affordable);
        }
    }
}

/**
 * 우측 정보 패널. 건설 도구 없이 클릭한 건물의 상세 정보를 보여준다.
 * 건물의 getInspectorInfo()가 반환하는 데이터를 그대로 표시만 하며,
 * 어떤 정보를 보여줄지는 전혀 알지 못한다 (건물이 스스로 결정).
 */
export class InspectorPanel {
    /**
     * @param {HTMLElement} containerEl
     */
    constructor(containerEl) {
        this.containerEl = containerEl;

        this.titleEl = document.createElement('div');
        this.titleEl.className = 'inspector-title';

        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'inspector-body';

        this.upgradeButtonEl = document.createElement('button');
        this.upgradeButtonEl.type = 'button';
        this.upgradeButtonEl.className = 'upgrade-btn';

        this.containerEl.appendChild(this.titleEl);
        this.containerEl.appendChild(this.bodyEl);
        this.containerEl.appendChild(this.upgradeButtonEl);

        this.upgradeButtonEl.style.display = 'none';
        this.#renderEmpty();
    }

    /**
     * 매 프레임 호출되어 현재 선택된 건물(들)의 정보를 최신 상태로 갱신한다.
     * 다중 선택 도구로 여러 건물을 드래그해 골랐다면 building 자리에 배열이 온다.
     * @param {import('../entities/Building.js').Building | import('../entities/Building.js').Building[] | null} building
     * @param {import('../systems/Systems.js').Economy} economy 업그레이드 비용 지불 가능 여부 확인에 사용
     * @param {(building: import('../entities/Building.js').Building | import('../entities/Building.js').Building[]) => void} onUpgradeClick
     * @param {(miners: import('../entities/Building.js').Miner[], resourceType: string) => void} [onResourceChange]
     *        다중 선택 중 채굴기가 포함되어 있을 때, 채굴 자원 버튼을 누르면 호출된다.
     */
    update(building, economy, onUpgradeClick, onResourceChange) {
        if (!building) {
            this.#renderEmpty();
            this.upgradeButtonEl.style.display = 'none';
            return;
        }

        if (Array.isArray(building)) {
            this.#renderMultiSelection(building, economy, onUpgradeClick, onResourceChange);
            return;
        }

        const info = building.getInspectorInfo();

        this.titleEl.textContent = info[0]?.value ?? building.typeId;

        this.bodyEl.innerHTML = '';
        for (const row of info.slice(1)) {
            const rowEl = document.createElement('div');
            rowEl.className = 'inspector-row';

            const labelEl = document.createElement('span');
            labelEl.className = 'inspector-row-label';
            labelEl.textContent = row.label;

            const valueEl = document.createElement('span');
            valueEl.className = 'inspector-row-value';
            valueEl.textContent = row.value;

            rowEl.appendChild(labelEl);
            rowEl.appendChild(valueEl);
            this.bodyEl.appendChild(rowEl);
        }

        if (building.canUpgrade()) {
            const cost = building.getUpgradeCost();
            const affordable = economy.getBalance() >= cost;

            this.upgradeButtonEl.style.display = '';
            this.upgradeButtonEl.textContent = `업그레이드 Lv.${building.level} → ${building.level + 1} (${cost}원)`;
            this.upgradeButtonEl.disabled = !affordable;
            this.upgradeButtonEl.classList.toggle('is-affordable', affordable);
            // 매 프레임 새 리스너를 추가하지 않도록 onclick 프로퍼티에 직접 대입한다.
            this.upgradeButtonEl.onclick = () => onUpgradeClick(building);
        } else {
            this.upgradeButtonEl.style.display = 'none';
        }
    }

    #renderEmpty() {
        this.titleEl.textContent = '선택된 건물 없음';
        this.bodyEl.innerHTML = '';

        const hint = document.createElement('div');
        hint.className = 'inspector-hint';
        hint.textContent = '건설 도구 없이 건물을 클릭하면 정보가 표시됩니다';
        this.bodyEl.appendChild(hint);
    }

    /**
     * 다중 선택 도구로 드래그해 고른 건물 여러 개를 한 번에 보여준다.
     * 종류가 섞여 있으면 가장 많은 종류를 대표로 제목에 내세우고,
     * 본문에는 종류별 개수를 나열한다. 업그레이드 버튼은 선택된 건물 전체를
     * 한 번에 시도하며(건물마다 개별적으로 자금/레벨 상한을 확인하므로,
     * 자금이 모자라면 되는 만큼만 업그레이드된다).
     * @param {import('../entities/Building.js').Building[]} buildings
     * @param {import('../systems/Systems.js').Economy} economy
     * @param {(buildings: import('../entities/Building.js').Building[]) => void} onUpgradeClick
     * @param {(miners: import('../entities/Building.js').Miner[], resourceType: string) => void} [onResourceChange]
     */
    #renderMultiSelection(buildings, economy, onUpgradeClick, onResourceChange) {
        const countsByType = new Map();
        for (const b of buildings) {
            countsByType.set(b.typeId, (countsByType.get(b.typeId) ?? 0) + 1);
        }

        let majorityTypeId = buildings[0].typeId;
        let majorityCount = 0;
        for (const [typeId, count] of countsByType) {
            if (count > majorityCount) {
                majorityTypeId = typeId;
                majorityCount = count;
            }
        }
        const majorityLabel = CONFIG.BUILDINGS[majorityTypeId]?.label ?? majorityTypeId;
        const isMixed = countsByType.size > 1;

        this.titleEl.textContent = isMixed
            ? `${majorityLabel} 외 (${buildings.length}개 선택됨)`
            : `${majorityLabel} (${buildings.length}개 선택됨)`;

        this.bodyEl.innerHTML = '';
        for (const [typeId, count] of countsByType) {
            const rowEl = document.createElement('div');
            rowEl.className = 'inspector-row';

            const labelEl = document.createElement('span');
            labelEl.className = 'inspector-row-label';
            labelEl.textContent = CONFIG.BUILDINGS[typeId]?.label ?? typeId;

            const valueEl = document.createElement('span');
            valueEl.className = 'inspector-row-value';
            valueEl.textContent = `${count}개`;

            rowEl.appendChild(labelEl);
            rowEl.appendChild(valueEl);
            this.bodyEl.appendChild(rowEl);
        }

        const miners = buildings.filter((b) => b instanceof Miner);
        if (miners.length > 0 && onResourceChange) {
            this.bodyEl.appendChild(this.#createMinerResourceSection(miners, onResourceChange));
        }

        const upgradable = buildings.filter((b) => b.canUpgrade());
        if (upgradable.length === 0) {
            this.upgradeButtonEl.style.display = 'none';
            return;
        }

        const totalCost = upgradable.reduce((sum, b) => sum + (b.getUpgradeCost() ?? 0), 0);
        const affordable = economy.getBalance() >= totalCost;

        this.upgradeButtonEl.style.display = '';
        this.upgradeButtonEl.textContent = `일괄 업그레이드 (${upgradable.length}개, 총 ${totalCost}원)`;
        // 단일 건물과 달리, 총액을 다 감당 못 해도 눌러서 되는 만큼만 진행할 수 있게 둔다.
        this.upgradeButtonEl.disabled = false;
        this.upgradeButtonEl.classList.toggle('is-affordable', affordable);
        this.upgradeButtonEl.onclick = () => onUpgradeClick(buildings);
    }

    /**
     * 다중 선택 안에 채굴기가 있을 때, 선택된 채굴기 전부가 캘 수 있는
     * 자원(등급이 섞여 있으면 그 교집합 - 하위 등급이 캘 수 있는 자원은
     * 상위 등급도 항상 캘 수 있으므로, 교집합은 곧 가장 낮은 등급의 목록과 같다)을
     * 버튼으로 늘어놓는다. 버튼을 누르면 선택된 채굴기 전부가 그 자원으로 즉시 바뀐다.
     * @param {import('../entities/Building.js').Miner[]} miners
     * @param {(miners: import('../entities/Building.js').Miner[], resourceType: string) => void} onResourceChange
     * @returns {HTMLElement}
     */
    #createMinerResourceSection(miners, onResourceChange) {
        const sectionEl = document.createElement('div');
        sectionEl.className = 'multi-resource-section';

        const labelEl = document.createElement('div');
        labelEl.className = 'multi-resource-label';
        labelEl.textContent = `채굴 자원 일괄 변경 (채굴기 ${miners.length}개)`;
        sectionEl.appendChild(labelEl);

        const sharedResources = miners.reduce((intersection, miner) => {
            const list = miner.definition.selectableResources ?? [miner.definition.producesResource];
            return intersection.filter((resourceType) => list.includes(resourceType));
        }, miners[0].definition.selectableResources ?? [miners[0].definition.producesResource]);

        const buttonsEl = document.createElement('div');
        buttonsEl.className = 'multi-resource-buttons';
        for (const resourceType of sharedResources) {
            const def = ResourceRegistry.getDefinition(resourceType);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'multi-resource-btn';
            btn.style.setProperty('--accent-color', def?.color ?? CONFIG.RENDER.ACCENT_CYAN);
            btn.textContent = def?.label ?? resourceType;
            btn.addEventListener('click', () => onResourceChange(miners, resourceType));

            buttonsEl.appendChild(btn);
        }
        sectionEl.appendChild(buttonsEl);

        return sectionEl;
    }
}

/**
 * 하단 미니로그. Logger.onLog()를 구독해서, 지금까지 콘솔에만 찍히던
 * 이벤트(배치, 철거, 연구 완료, 경고 등)를 화면에도 최근 N개까지 보여준다.
 */
export class MiniLog {
    /**
     * @param {HTMLElement} containerEl
     * @param {number} [maxEntries]
     */
    constructor(containerEl, maxEntries = 5) {
        this.containerEl = containerEl;
        this.maxEntries = maxEntries;
        /** @type {{level: string, message: string}[]} */
        this.entries = [];

        Logger.onLog((level, message) => this.#addEntry(level, message));
    }

    #addEntry(level, message) {
        this.entries.push({ level, message });
        if (this.entries.length > this.maxEntries) {
            this.entries.shift();
        }
        this.#render();
    }

    #render() {
        this.containerEl.innerHTML = '';
        for (const entry of this.entries) {
            const lineEl = document.createElement('div');
            lineEl.className = `mini-log-line mini-log-line--${entry.level}`;
            lineEl.textContent = entry.message;
            this.containerEl.appendChild(lineEl);
        }
    }
}

/**
 * 저장/다른 이름으로 저장/불러오기 버튼과 마지막 상태 텍스트를 보여주는 작은 패널.
 * 실제 저장/불러오기 로직은 SaveManager가 담당하고, 이 클래스는
 * 버튼 클릭을 콜백으로 전달하고 결과 메시지만 표시한다.
 * "저장"은 지금 이어가는 슬롯에 덮어쓰고, "다른 이름으로"는 새 슬롯을 만든다 -
 * 슬롯을 나눠두면 Ctrl+S 한 번 잘못 눌러도 다른 슬롯의 진행 상황은 안전하다.
 */
export class SavePanel {
    /**
     * @param {HTMLElement} containerEl
     * @param {() => void} onSaveClick
     * @param {() => void} onSaveAsClick
     * @param {() => void} onLoadClick
     */
    constructor(containerEl, onSaveClick, onSaveAsClick, onLoadClick) {
        this.containerEl = containerEl;

        const saveButton = document.createElement('button');
        saveButton.type = 'button';
        saveButton.className = 'save-btn';
        saveButton.textContent = '저장';
        saveButton.title = 'Ctrl+S';
        saveButton.addEventListener('click', onSaveClick);

        const saveAsButton = document.createElement('button');
        saveAsButton.type = 'button';
        saveAsButton.className = 'save-btn';
        saveAsButton.textContent = '다른 이름으로';
        saveAsButton.addEventListener('click', onSaveAsClick);

        const loadButton = document.createElement('button');
        loadButton.type = 'button';
        loadButton.className = 'save-btn';
        loadButton.textContent = '불러오기';
        loadButton.title = 'Ctrl+L';
        loadButton.addEventListener('click', onLoadClick);

        this.statusEl = document.createElement('span');
        this.statusEl.className = 'save-status';

        this.containerEl.appendChild(saveButton);
        this.containerEl.appendChild(saveAsButton);
        this.containerEl.appendChild(loadButton);
        this.containerEl.appendChild(this.statusEl);
    }

    /**
     * @param {string} message
     */
    setStatus(message) {
        this.statusEl.textContent = message;
    }
}

/**
 * 저장 슬롯 목록을 보여주고 고르게 하는 패널. 시작 화면(런처)과 게임 중
 * "불러오기" 버튼 양쪽에서 재사용한다 - 슬롯을 나열하는 방식 자체는 두
 * 상황에서 동일하고, 고른 다음 뭘 할지(새 Game을 만들지, 이미 떠 있는
 * Game에 반영할지)만 호출부(Game.js/main.js)가 다르기 때문이다.
 */
export class SaveSlotPicker {
    /**
     * @param {HTMLElement} containerEl
     * @param {{
     *   onSelectSlot: (slotId: string) => void,
     *   onNewGame?: () => void,
     *   onDeleteSlot?: (slotId: string) => void,
     * }} callbacks onNewGame이 있으면 "새 게임 시작" 버튼을, onDeleteSlot이 있으면
     *   슬롯마다 삭제 버튼을 보여준다 (게임 중 불러오기 패널에는 필요 없어 생략 가능).
     */
    constructor(containerEl, callbacks) {
        this.containerEl = containerEl;
        this.callbacks = callbacks;

        this.titleEl = document.createElement('div');
        this.titleEl.className = 'slot-picker-title';

        this.listEl = document.createElement('div');
        this.listEl.className = 'slot-picker-list';

        this.containerEl.appendChild(this.titleEl);
        this.containerEl.appendChild(this.listEl);

        if (callbacks.onNewGame) {
            const newGameButtonEl = document.createElement('button');
            newGameButtonEl.type = 'button';
            newGameButtonEl.className = 'slot-picker-newgame-btn';
            newGameButtonEl.textContent = '새 게임 시작';
            newGameButtonEl.addEventListener('click', () => callbacks.onNewGame());
            this.containerEl.appendChild(newGameButtonEl);
        }
    }

    /**
     * @param {string} title
     * @param {{id: string, label: string, savedAt: number, buildingCount: number, money: number}[]} slots
     */
    render(title, slots) {
        this.titleEl.textContent = title;
        this.listEl.innerHTML = '';

        if (slots.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'slot-picker-empty';
            emptyEl.textContent = '저장된 게임이 없습니다.';
            this.listEl.appendChild(emptyEl);
            return;
        }

        for (const slot of slots) {
            this.listEl.appendChild(this.#createSlotRow(slot));
        }
    }

    /**
     * @param {{id: string, label: string, savedAt: number, buildingCount: number, money: number}} slot
     */
    #createSlotRow(slot) {
        const rowEl = document.createElement('div');
        rowEl.className = 'slot-row';

        const infoEl = document.createElement('button');
        infoEl.type = 'button';
        infoEl.className = 'slot-row-info';
        infoEl.addEventListener('click', () => this.callbacks.onSelectSlot(slot.id));

        const labelEl = document.createElement('div');
        labelEl.className = 'slot-row-label';
        labelEl.textContent = slot.label;

        const metaEl = document.createElement('div');
        metaEl.className = 'slot-row-meta';
        metaEl.textContent = `${new Date(slot.savedAt).toLocaleString('ko-KR')} · 건물 ${slot.buildingCount}개 · ${slot.money}원`;

        infoEl.appendChild(labelEl);
        infoEl.appendChild(metaEl);
        rowEl.appendChild(infoEl);

        if (this.callbacks.onDeleteSlot) {
            const deleteEl = document.createElement('button');
            deleteEl.type = 'button';
            deleteEl.className = 'slot-row-delete';
            deleteEl.textContent = '삭제';
            deleteEl.addEventListener('click', (event) => {
                event.stopPropagation();
                if (window.confirm(`'${slot.label}' 슬롯을 삭제할까요? 되돌릴 수 없습니다.`)) {
                    this.callbacks.onDeleteSlot(slot.id);
                }
            });
            rowEl.appendChild(deleteEl);
        }

        return rowEl;
    }
}

/** 버튼으로 열고 닫는 제작 레시피 안내 패널. */
export class RecipePanel {
    constructor(toggleEl, containerEl) {
        this.toggleEl = toggleEl;
        this.containerEl = containerEl;
        this.isOpen = false;
        this.#render();
        this.toggleEl.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            this.containerEl.classList.toggle('is-open', this.isOpen);
            this.toggleEl.classList.toggle('is-active', this.isOpen);
        });
    }

    #render() {
        const labelOf = (id) => ResourceRegistry.getDefinition(id)?.label ?? id;
        const addSection = (title, recipes) => {
            const heading = document.createElement('div');
            heading.className = 'recipe-heading';
            heading.textContent = title;
            this.containerEl.appendChild(heading);
            for (const recipe of recipes) {
                const row = document.createElement('div');
                row.className = 'recipe-row';
                row.textContent = recipe;
                this.containerEl.appendChild(row);
            }
        };
        addSection('제련', Object.entries(CONFIG.RECIPES).map(([input, recipe]) => `${labelOf(input)} → ${labelOf(recipe.output)}`));
        addSection('가공', Object.entries(CONFIG.PROCESSING_RECIPES).flatMap(([machine, recipes]) => Object.entries(recipes).map(([input, output]) => `${machine === 'crusher' ? '분쇄기' : '세척기'}: ${labelOf(input)} → ${labelOf(output)}`)));
        addSection('조립', CONFIG.ASSEMBLY_RECIPES.map((recipe) => `${Object.entries(recipe.inputs).map(([id, count]) => `${labelOf(id)} ×${count}`).join(' + ')} → ${recipe.label}`));
    }
}

/**
 * 버튼으로 열고 닫는 설정 패널.
 * 지금 당장은 조작법 안내(예전엔 항상 화면에 떠 있던 controls-hint)만
 * 담고 있지만, 이후 실제 설정 항목(그래픽/사운드/자동저장 주기 등)이
 * 생길 것을 감안해 "제목 + 임의의 콘텐츠"를 쌓아 올리는 addSection()과,
 * 체크박스형 설정 행을 만드는 createToggleRow()를 범용으로 미리 마련해둔다.
 * 새 설정을 추가할 땐 이 클래스가 아니라 호출부(Game.js)에서
 * addSection()/createToggleRow()를 호출하기만 하면 된다.
 */
export class SettingsPanel {
    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    constructor(toggleEl, containerEl) {
        this.toggleEl = toggleEl;
        this.containerEl = containerEl;
        this.isOpen = false;

        this.sectionsEl = document.createElement('div');
        this.sectionsEl.className = 'settings-sections';
        this.containerEl.appendChild(this.sectionsEl);

        this.toggleEl.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            this.containerEl.classList.toggle('is-open', this.isOpen);
            this.toggleEl.classList.toggle('is-active', this.isOpen);
        });

        this.#renderControlsSection();
    }

    /**
     * 제목 하나 + 임의의 DOM 콘텐츠로 이루어진 섹션을 패널 끝에 추가한다.
     * @param {string} title
     * @param {HTMLElement} contentEl
     */
    addSection(title, contentEl) {
        const heading = document.createElement('div');
        heading.className = 'settings-heading';
        heading.textContent = title;
        this.sectionsEl.appendChild(heading);
        this.sectionsEl.appendChild(contentEl);
    }

    /**
     * 체크박스 + 라벨로 구성된 토글형 설정 행을 만들어 반환한다.
     * 실제 값을 저장하는 곳은 호출부(onChange)가 알아서 결정한다 —
     * 이 패널은 값을 소유하지 않고 UI만 제공한다.
     * @param {string} label
     * @param {boolean} initialValue
     * @param {(value: boolean) => void} onChange
     * @returns {HTMLLabelElement}
     */
    static createToggleRow(label, initialValue, onChange) {
        const row = document.createElement('label');
        row.className = 'settings-toggle-row';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = initialValue;
        checkbox.addEventListener('change', () => onChange(checkbox.checked));

        const labelEl = document.createElement('span');
        labelEl.textContent = label;

        row.appendChild(checkbox);
        row.appendChild(labelEl);
        return row;
    }

    /** 조작법 안내: 예전 controls-hint 패널의 내용을 이 설정 패널로 옮겨왔다. */
    #renderControlsSection() {
        const listEl = document.createElement('div');
        listEl.className = 'settings-controls-list';

        const rows = [
            ['좌클릭', '건물 배치 / 정보 확인'],
            ['우클릭', '건물 철거'],
            ['블루프린트 도구 + 드래그', '영역을 복사, 이후 클릭으로 붙여넣기'],
            ['다중 선택 도구 + 드래그', '영역 안 건물을 모두 선택해 일괄 업그레이드'],
            ['R', '배치 방향 회전 (블루프린트를 들고 있으면 블루프린트 회전)'],
            ['M', '(채굴기 선택 중) 생산 자원 변경'],
            ['F', '(조립기 선택 중) 레시피 변경'],
            ['X', '해체 도구 선택'],
            ['Esc', '도구 선택 해제'],
            ['W A S D', '카메라 이동'],
            ['마우스 휠', '줌'],
            ['Ctrl+S / Ctrl+L', '저장 / 불러오기'],
        ];

        for (const [key, desc] of rows) {
            const rowEl = document.createElement('div');
            rowEl.className = 'settings-controls-row';

            const keyEl = document.createElement('span');
            keyEl.className = 'settings-controls-key';
            keyEl.textContent = key;

            const descEl = document.createElement('span');
            descEl.className = 'settings-controls-desc';
            descEl.textContent = desc;

            rowEl.appendChild(keyEl);
            rowEl.appendChild(descEl);
            listEl.appendChild(rowEl);
        }

        this.addSection('조작법', listEl);
    }
}

/**
 * 버튼으로 열고 닫는 생산 통계 그래프 패널.
 * world.stats(ProductionStats)의 자원별 초당 생산량 이력을 자원마다
 * 한 줄의 SVG 스파크라인으로 그린다. 닫혀 있을 때는 매 프레임 다시 그리지
 * 않도록 update()에서 isOpen을 먼저 확인한다 (RecipePanel과 달리 이 패널은
 * 실시간 데이터라 열려 있는 동안은 계속 갱신이 필요함).
 */
export class ProductionGraphPanel {
    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    constructor(toggleEl, containerEl) {
        this.toggleEl = toggleEl;
        this.containerEl = containerEl;
        this.isOpen = false;

        /** @type {Map<string, {rowEl: HTMLElement, rateEl: HTMLElement, polylineEl: SVGPolylineElement}>} */
        this.rowsByResource = new Map();

        this.emptyEl = document.createElement('div');
        this.emptyEl.className = 'graph-empty';
        this.emptyEl.textContent = '아직 생산 기록이 없습니다. 채굴기를 가동해보세요.';
        this.containerEl.appendChild(this.emptyEl);

        this.toggleEl.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            this.containerEl.classList.toggle('is-open', this.isOpen);
            this.toggleEl.classList.toggle('is-active', this.isOpen);
        });
    }

    /**
     * 열려 있을 때만 호출부에서 실제로 갱신 비용이 들도록, 매 프레임 호출되어도
     * 스스로 isOpen을 확인하고 조기 반환한다.
     * @param {import('../systems/Systems.js').ProductionStats} stats
     */
    update(stats) {
        if (!this.isOpen) return;

        const types = Object.keys(stats.productionHistory);
        this.emptyEl.style.display = types.length === 0 ? '' : 'none';

        for (const [type, row] of this.rowsByResource) {
            if (!types.includes(type)) {
                row.rowEl.remove();
                this.rowsByResource.delete(type);
            }
        }

        for (const type of types) {
            let row = this.rowsByResource.get(type);
            if (!row) {
                row = this.#createRow(type);
                this.containerEl.appendChild(row.rowEl);
                this.rowsByResource.set(type, row);
            }
            this.#renderRow(row, stats.productionHistory[type]);
        }
    }

    /**
     * @param {string} resourceType
     */
    #createRow(resourceType) {
        const def = ResourceRegistry.getDefinition(resourceType);
        const color = def?.color ?? '#5ec8d8';

        const rowEl = document.createElement('div');
        rowEl.className = 'graph-row';

        const headerEl = document.createElement('div');
        headerEl.className = 'graph-row-header';

        const labelEl = document.createElement('span');
        labelEl.className = 'graph-row-label';
        labelEl.textContent = def?.label ?? resourceType;
        labelEl.style.color = color;

        const rateEl = document.createElement('span');
        rateEl.className = 'graph-row-rate';

        headerEl.appendChild(labelEl);
        headerEl.appendChild(rateEl);

        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.setAttribute('viewBox', '0 0 180 36');
        svgEl.setAttribute('preserveAspectRatio', 'none');
        svgEl.classList.add('graph-sparkline');

        const polylineEl = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
        polylineEl.setAttribute('fill', 'none');
        polylineEl.setAttribute('stroke', color);
        polylineEl.setAttribute('stroke-width', '2');
        svgEl.appendChild(polylineEl);

        rowEl.appendChild(headerEl);
        rowEl.appendChild(svgEl);

        return { rowEl, rateEl, polylineEl };
    }

    /**
     * @param {{rateEl: HTMLElement, polylineEl: SVGPolylineElement}} row
     * @param {number[]} history 최근 초당 생산량 샘플 (오래된 것 -> 최신 순)
     */
    #renderRow(row, history) {
        const currentRate = history[history.length - 1] ?? 0;
        row.rateEl.textContent = `${currentRate}/s`;

        const maxRate = Math.max(1, ...history);
        const width = 180;
        const height = 36;
        const step = history.length > 1 ? width / (history.length - 1) : 0;

        const points = history
            .map((value, index) => `${(index * step).toFixed(1)},${(height - (value / maxRate) * (height - 2)).toFixed(1)}`)
            .join(' ');

        row.polylineEl.setAttribute('points', points);
    }
}

/**
 * 버튼으로 열고 닫는 마일스톤/업적 패널.
 * 마일스톤(누적 수익, 초당 수익 최고 기록)은 world.stats의 값이 항상 증가만
 * 하므로 별도 해금 상태 없이 매번 다시 계산해서 보여준다. 업적은
 * world.achievements(AchievementSystem)가 들고 있는 해금 Set을 그대로 읽는다.
 */
export class ProgressPanel {
    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    constructor(toggleEl, containerEl) {
        this.toggleEl = toggleEl;
        this.containerEl = containerEl;
        this.isOpen = false;

        const milestoneHeading = document.createElement('div');
        milestoneHeading.className = 'settings-heading';
        milestoneHeading.textContent = '마일스톤';

        this.milestonesEl = document.createElement('div');
        this.milestonesEl.className = 'progress-milestones';

        const achievementHeading = document.createElement('div');
        achievementHeading.className = 'settings-heading';
        achievementHeading.textContent = '업적';

        this.achievementsEl = document.createElement('div');
        this.achievementsEl.className = 'progress-achievements';

        this.containerEl.appendChild(milestoneHeading);
        this.containerEl.appendChild(this.milestonesEl);
        this.containerEl.appendChild(achievementHeading);
        this.containerEl.appendChild(this.achievementsEl);

        this.toggleEl.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            this.containerEl.classList.toggle('is-open', this.isOpen);
            this.toggleEl.classList.toggle('is-active', this.isOpen);
        });
    }

    /**
     * 열려 있을 때만 실제로 다시 그린다 (RecipePanel과 달리 실시간 데이터라
     * ProductionGraphPanel과 같은 패턴을 쓴다).
     * @param {import('../world/World.js').World} world
     */
    update(world) {
        if (!this.isOpen) return;

        this.milestonesEl.innerHTML = '';
        this.#renderLadder(
            '누적 수익',
            CONFIG.MILESTONES.totalRevenue,
            world.stats.totalRevenue,
            (v) => `${Math.floor(v).toLocaleString()}원`,
        );
        this.#renderLadder(
            '초당 수익 최고 기록',
            CONFIG.MILESTONES.incomeRate,
            world.stats.peakIncomeRate,
            (v) => `${Math.floor(v).toLocaleString()}/s`,
        );

        this.achievementsEl.innerHTML = '';
        for (const achievement of CONFIG.ACHIEVEMENTS) {
            this.achievementsEl.appendChild(this.#createAchievementRow(achievement, world.achievements));
        }
    }

    /**
     * @param {string} title
     * @param {{id: string, label: string, target: number}[]} ladder
     * @param {number} currentValue
     * @param {(value: number) => string} formatValue
     */
    #renderLadder(title, ladder, currentValue, formatValue) {
        const titleEl = document.createElement('div');
        titleEl.className = 'progress-ladder-title';
        titleEl.textContent = title;

        const nextIndex = ladder.findIndex((tier) => currentValue < tier.target);
        const isMaxed = nextIndex === -1;
        const reachedCount = isMaxed ? ladder.length : nextIndex;

        const summaryEl = document.createElement('div');
        summaryEl.className = 'progress-ladder-summary';

        const barOuterEl = document.createElement('div');
        barOuterEl.className = 'progress-bar';
        const barFillEl = document.createElement('div');
        barFillEl.className = 'progress-bar-fill';
        barOuterEl.appendChild(barFillEl);

        if (isMaxed) {
            summaryEl.textContent = `모든 단계 달성! (${ladder[ladder.length - 1].label})`;
            barFillEl.style.width = '100%';
        } else {
            const tier = ladder[nextIndex];
            const prevTarget = nextIndex > 0 ? ladder[nextIndex - 1].target : 0;
            const progress = Math.max(0, Math.min(1, (currentValue - prevTarget) / (tier.target - prevTarget)));
            summaryEl.textContent = `다음: ${tier.label} (${formatValue(currentValue)} / ${formatValue(tier.target)})`;
            barFillEl.style.width = `${Math.round(progress * 100)}%`;
        }

        const countEl = document.createElement('div');
        countEl.className = 'progress-ladder-count';
        countEl.textContent = `${reachedCount}/${ladder.length} 단계 달성`;

        this.milestonesEl.appendChild(titleEl);
        this.milestonesEl.appendChild(summaryEl);
        this.milestonesEl.appendChild(barOuterEl);
        this.milestonesEl.appendChild(countEl);
    }

    /**
     * 해금 전에는 이름/설명을 가려서(???) 보상감을 남겨둔다.
     * @param {{id: string, label: string, description: string}} achievement
     * @param {import('../systems/Systems.js').AchievementSystem} achievements
     */
    #createAchievementRow(achievement, achievements) {
        const unlocked = achievements.isUnlocked(achievement.id);

        const rowEl = document.createElement('div');
        rowEl.className = `achievement-row ${unlocked ? 'is-unlocked' : 'is-locked'}`;

        const labelEl = document.createElement('span');
        labelEl.className = 'achievement-label';
        labelEl.textContent = unlocked ? `✓ ${achievement.label}` : '??? (미달성)';

        const descEl = document.createElement('span');
        descEl.className = 'achievement-desc';
        descEl.textContent = unlocked ? achievement.description : '조건을 달성하면 공개됩니다.';

        rowEl.appendChild(labelEl);
        rowEl.appendChild(descEl);
        return rowEl;
    }
}

/**
 * 버튼으로 열고 닫는 계약 패널. 지금 활성 계약(world.contracts.active)의
 * 요구 자원별 진행도를 보여준다. 실제 판정/보상 로직은 ContractSystem이 갖고
 * 있고, 이 패널은 읽기만 한다 - 계약소(ContractOffice) 건물이 배달을 받으면
 * 알아서 진행되고, 다 채워지면 자동으로 다음 계약으로 바뀐다.
 */
export class ContractPanel {
    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    constructor(toggleEl, containerEl) {
        this.toggleEl = toggleEl;
        this.containerEl = containerEl;
        this.isOpen = false;

        this.titleEl = document.createElement('div');
        this.titleEl.className = 'settings-heading';
        this.titleEl.textContent = '진행 중인 계약';

        this.bodyEl = document.createElement('div');
        this.bodyEl.className = 'contract-body';

        this.statsEl = document.createElement('div');
        this.statsEl.className = 'contract-stats';

        this.containerEl.appendChild(this.titleEl);
        this.containerEl.appendChild(this.bodyEl);
        this.containerEl.appendChild(this.statsEl);

        this.toggleEl.addEventListener('click', () => {
            this.isOpen = !this.isOpen;
            this.containerEl.classList.toggle('is-open', this.isOpen);
            this.toggleEl.classList.toggle('is-active', this.isOpen);
        });
    }

    /**
     * 열려 있을 때만 실제로 다시 그린다 (ProgressPanel과 같은 패턴).
     * @param {import('../world/World.js').World} world
     */
    update(world) {
        if (!this.isOpen) return;

        const contract = world.contracts.active;
        this.bodyEl.innerHTML = '';

        if (!contract) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'contract-empty';
            emptyEl.textContent = '진행 중인 계약이 없습니다.';
            this.bodyEl.appendChild(emptyEl);
        } else {
            const labelEl = document.createElement('div');
            labelEl.className = 'contract-label';
            labelEl.textContent = contract.label;
            this.bodyEl.appendChild(labelEl);

            for (const [resourceType, need] of Object.entries(contract.requirements)) {
                this.bodyEl.appendChild(this.#createRequirementRow(resourceType, need, contract.progress[resourceType] ?? 0));
            }

            const rewardEl = document.createElement('div');
            rewardEl.className = 'contract-reward';
            const parts = [];
            if (contract.reward.money) parts.push(`${contract.reward.money}원`);
            if (contract.reward.rp) parts.push(`RP ${contract.reward.rp}`);
            rewardEl.textContent = `보상: ${parts.join(' + ')}`;
            this.bodyEl.appendChild(rewardEl);
        }

        this.statsEl.textContent = `완료한 계약: ${world.contracts.completedCount}건`;
    }

    /**
     * @param {string} resourceType
     * @param {number} need
     * @param {number} have
     */
    #createRequirementRow(resourceType, need, have) {
        const clampedHave = Math.min(have, need);
        const def = ResourceRegistry.getDefinition(resourceType);

        const wrapperEl = document.createElement('div');
        wrapperEl.className = 'contract-requirement';

        const rowEl = document.createElement('div');
        rowEl.className = 'contract-requirement-row';

        const nameEl = document.createElement('span');
        nameEl.className = 'contract-requirement-name';
        nameEl.textContent = def?.label ?? resourceType;
        if (def?.color) nameEl.style.color = def.color;

        const countEl = document.createElement('span');
        countEl.className = 'contract-requirement-count';
        countEl.textContent = `${clampedHave} / ${need}`;

        rowEl.appendChild(nameEl);
        rowEl.appendChild(countEl);

        const barOuterEl = document.createElement('div');
        barOuterEl.className = 'progress-bar';
        const barFillEl = document.createElement('div');
        barFillEl.className = 'progress-bar-fill';
        barFillEl.style.width = `${Math.round((clampedHave / need) * 100)}%`;
        barOuterEl.appendChild(barFillEl);

        wrapperEl.appendChild(rowEl);
        wrapperEl.appendChild(barOuterEl);
        return wrapperEl;
    }
}

/**
 * 초반 플레이어가 다음에 무엇을 해야 할지 잃지 않도록 현재 목표를 한 줄로 표시한다.
 * 건물 수와 판매 실적만 읽으므로 게임 상태를 변경하지 않는다.
 */
export class ObjectivePanel {
    /** @param {HTMLElement} containerEl */
    constructor(containerEl) {
        this.containerEl = containerEl;

        this.titleEl = document.createElement('span');
        this.titleEl.className = 'objective-title';
        this.titleEl.textContent = '현재 목표';

        this.textEl = document.createElement('span');
        this.textEl.className = 'objective-text';

        this.containerEl.appendChild(this.titleEl);
        this.containerEl.appendChild(this.textEl);
    }

    /** @param {import('../world/World.js').World} world */
    update(world) {
        // 건물 수만큼 스캔하는 배열 검색 대신, World가 유지하는 O(1) 카운트 캐시를 쓴다
        // (건물이 수만 개로 늘어나면 매 프레임 배열 스캔은 감당하기 힘든 비용이 된다).
        const has = (typeId) => world.hasBuildingType(typeId);

        if (!has('miner')) {
            this.textEl.textContent = '좌측 "건설" 버튼을 열어 채굴기를 설치하세요';
        } else if (!has('conveyor')) {
            this.textEl.textContent = '컨베이어로 채굴기를 연결하세요';
        } else if (!has('seller')) {
            this.textEl.textContent = '판매기를 연결해 첫 수익을 만드세요';
        } else if (world.stats.totalSold === 0) {
            this.textEl.textContent = '광석이 판매기에 도착하도록 방향을 확인하세요';
        } else if (!has('generator')) {
            this.textEl.textContent = '발전기와 전선으로 전력망을 만드세요';
        } else if (has('storage') && !has('inserter')) {
            this.textEl.textContent = '기계 팔로 창고의 자원을 자동 운반하세요';
        } else if (!has('lab')) {
            this.textEl.textContent = '연구소를 설치해 제련술을 연구하세요';
        } else if (!world.researchSystem.unlockedTechIds.has('tech_smelting')) {
            this.textEl.textContent = 'RP 20을 모아 제련술을 연구하세요';
        } else if (!has('furnace')) {
            this.textEl.textContent = '용광로로 철판 생산을 시작하세요';
        } else if (!has('splitter')) {
            this.textEl.textContent = '분배기로 생산 라인을 두 갈래로 나누세요';
        } else if (!has('merger')) {
            this.textEl.textContent = '합류기로 여러 생산 라인을 하나로 모으세요';
        } else {
            this.textEl.textContent = '생산 라인을 업그레이드하고 공장을 확장하세요';
        }
    }
}

/**
 * UI 패널 전체를 관리하는 조립자.
 * Game이 개별 패널을 직접 알 필요 없이 UIManager를 통해서만 접근하도록 하기 위한 자리다.
 */
export class UIManager {
    constructor() {
        /** @type {BuildMenuPanel | null} */
        this.buildMenuPanel = null;
        /** @type {ResearchBar | null} */
        this.researchBar = null;
        /** @type {InspectorPanel | null} */
        this.inspectorPanel = null;
        /** @type {MiniLog | null} */
        this.miniLog = null;
        /** @type {SavePanel | null} */
        this.savePanel = null;
        /** @type {SaveSlotPicker | null} */
        this.saveSlotPicker = null;
        /** @type {ObjectivePanel | null} */
        this.objectivePanel = null;
        this.recipePanel = null;
        /** @type {ProductionGraphPanel | null} */
        this.productionGraphPanel = null;
        /** @type {SettingsPanel | null} */
        this.settingsPanel = null;
        /** @type {ProgressPanel | null} */
        this.progressPanel = null;
        /** @type {ContractPanel | null} */
        this.contractPanel = null;
    }

    /**
     * @param {HTMLElement} containerEl
     * @param {HTMLElement} toggleEl
     * @param {(selectedId: string | null) => void} onSelectionChange
     * @param {import('../systems/Systems.js').ResearchSystem} researchSystem
     */
    initBuildMenu(containerEl, toggleEl, onSelectionChange, researchSystem) {
        this.buildMenuPanel = new BuildMenuPanel(containerEl, toggleEl, onSelectionChange, researchSystem);
        return this.buildMenuPanel;
    }

    /**
     * @param {HTMLElement} containerEl
     * @param {(techId: string) => void} onResearchClick
     */
    initResearchBar(containerEl, onResearchClick) {
        this.researchBar = new ResearchBar(containerEl, onResearchClick);
        return this.researchBar;
    }

    /**
     * @param {HTMLElement} containerEl
     */
    initInspectorPanel(containerEl) {
        this.inspectorPanel = new InspectorPanel(containerEl);
        return this.inspectorPanel;
    }

    /**
     * @param {HTMLElement} containerEl
     */
    initMiniLog(containerEl) {
        this.miniLog = new MiniLog(containerEl);
        return this.miniLog;
    }

    /**
     * @param {HTMLElement} containerEl
     * @param {() => void} onSaveClick
     * @param {() => void} onSaveAsClick
     * @param {() => void} onLoadClick
     */
    initSavePanel(containerEl, onSaveClick, onSaveAsClick, onLoadClick) {
        this.savePanel = new SavePanel(containerEl, onSaveClick, onSaveAsClick, onLoadClick);
        return this.savePanel;
    }

    /**
     * @param {HTMLElement} containerEl
     * @param {{onSelectSlot: (slotId: string) => void, onNewGame?: () => void, onDeleteSlot?: (slotId: string) => void}} callbacks
     */
    initSaveSlotPicker(containerEl, callbacks) {
        this.saveSlotPicker = new SaveSlotPicker(containerEl, callbacks);
        return this.saveSlotPicker;
    }

    /** @param {HTMLElement} containerEl */
    initObjectivePanel(containerEl) {
        this.objectivePanel = new ObjectivePanel(containerEl);
        return this.objectivePanel;
    }

    initRecipePanel(toggleEl, containerEl) {
        this.recipePanel = new RecipePanel(toggleEl, containerEl);
        return this.recipePanel;
    }

    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    initProductionGraphPanel(toggleEl, containerEl) {
        this.productionGraphPanel = new ProductionGraphPanel(toggleEl, containerEl);
        return this.productionGraphPanel;
    }

    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    initSettingsPanel(toggleEl, containerEl) {
        this.settingsPanel = new SettingsPanel(toggleEl, containerEl);
        return this.settingsPanel;
    }

    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    initProgressPanel(toggleEl, containerEl) {
        this.progressPanel = new ProgressPanel(toggleEl, containerEl);
        return this.progressPanel;
    }

    /**
     * @param {HTMLElement} toggleEl
     * @param {HTMLElement} containerEl
     */
    initContractPanel(toggleEl, containerEl) {
        this.contractPanel = new ContractPanel(toggleEl, containerEl);
        return this.contractPanel;
    }
}
