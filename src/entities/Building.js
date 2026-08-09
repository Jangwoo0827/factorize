/**
 * src/entities/Building.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 것: Direction, DIRECTION_VECTORS, Building,
 *                     Miner, Conveyor, Storage, tryDeliverItem, createBuilding
 *
 * Phase 3부터 건물이 실제 행동(생산/운송/저장)을 갖기 시작하므로,
 * Miner/Conveyor/Storage를 Building을 상속하는 서브클래스로 분리했다.
 * 각 서브클래스는 자신의 update(dt, world)를 스스로 구현한다
 * (별도의 ConveyorSystem/ProductionSystem 클래스를 만들지 않고,
 *  건물 스스로 자기 행동을 아는 다형성 방식을 택했다 - 새 건물을
 *  추가할 때 중앙 System을 수정할 필요가 없다).
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { Entity, Item } from './Entity.js';
import { ResourceRegistry } from '../resources/Resources.js';
import { ObjectPool, Logger } from '../utils/Utils.js';

/**
 * 채굴기/용광로가 새 아이템을 만들 때마다 new Item()을 호출하는 대신,
 * 창고/판매기가 아이템을 소비한 뒤 반납하는 재사용 풀에서 가져온다.
 * 공장 규모가 커져 초당 수십~수백 개의 아이템이 생성/소비될 때
 * 가비지 컬렉션 부담을 줄이기 위함이다.
 */
const itemPool = new ObjectPool(
    () => new Item(0, 0, null),
    (item, tileX, tileY, resourceType) => {
        item.tileX = tileX;
        item.tileY = tileY;
        item.resourceType = resourceType;
        item.progress = 0;
        item.worldX = 0;
        item.worldY = 0;
        item.prevWorldX = 0;
        item.prevWorldY = 0;
        item.entryDirection = null;
    },
);

/** 건물의 방향 (컨베이어 등에서 사용). 90도 단위 4방향. */
export const Direction = Object.freeze({
    RIGHT: 0,
    DOWN: 1,
    LEFT: 2,
    UP: 3,
});

/** Direction 값 -> (dx, dy) 단위 벡터. */
export const DIRECTION_VECTORS = [
    { x: 1, y: 0 },  // RIGHT
    { x: 0, y: 1 },  // DOWN
    { x: -1, y: 0 }, // LEFT
    { x: 0, y: -1 }, // UP
];

/**
 * 컨베이어 위 아이템의 실제 픽셀(월드) 좌표를 계산한다.
 * progress 0~0.5 구간은 "진입 가장자리 -> 중심", 0.5~1 구간은
 * "중심 -> 배출 가장자리"로 나눠서 계산한다. 진입 방향과 배출 방향을
 * 따로 받기 때문에, 방향이 꺾이는 컨베이어(코너)에서도 실제 들어온
 * 쪽에서 실제 나가는 쪽으로 자연스럽게 이어지는 경로를 그릴 수 있다.
 * (진입=배출 방향의 반대인 직선 구간에서는 기존과 동일한 직선 경로가 된다.)
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} entryDirection 이 칸에 실제로 들어온 방향 (Direction 값)
 * @param {number} exitDirection 이 칸이 배출하는 방향 (보통 건물의 rotation)
 * @param {number} progress 0~1
 * @returns {{x: number, y: number}}
 */
function computeItemWorldPosition(tileX, tileY, entryDirection, exitDirection, progress) {
    const tileSize = CONFIG.TILE.SIZE;
    const centerX = tileX * tileSize + tileSize / 2;
    const centerY = tileY * tileSize + tileSize / 2;

    if (progress <= 0.5) {
        // 진입 가장자리(0.5만큼 떨어짐) -> 중심(0)으로 이동
        const entryVec = DIRECTION_VECTORS[entryDirection];
        const frac = 0.5 - progress;
        return {
            x: centerX + entryVec.x * frac * tileSize,
            y: centerY + entryVec.y * frac * tileSize,
        };
    }

    // 중심(0) -> 배출 가장자리(0.5만큼 떨어짐)로 이동
    const exitVec = DIRECTION_VECTORS[exitDirection];
    const frac = progress - 0.5;
    return {
        x: centerX + exitVec.x * frac * tileSize,
        y: centerY + exitVec.y * frac * tileSize,
    };
}

/** Direction 값의 반대 방향을 반환한다 (RIGHT<->LEFT, UP<->DOWN). */
function oppositeDirection(direction) {
    return (direction + 2) % 4;
}

export class Building extends Entity {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} typeId CONFIG.BUILDINGS의 키
     * @param {number} rotation Direction 값 (0~3)
     */
    constructor(tileX, tileY, typeId, rotation = Direction.RIGHT) {
        super(tileX, tileY);
        this.typeId = typeId;
        this.rotation = rotation;

        // 전력망에 연결된 경우의 공급 비율 (0=완전 부족, 1=완전 공급).
        // 전력이 필요 없는 건물(Storage, Seller 등)은 참조하지 않으므로 기본값 1로 둔다.
        this.powerRatio = 1;

        // 업그레이드 레벨 (1부터 시작, CONFIG.UPGRADE.MAX_LEVEL까지).
        this.level = 1;
    }

    /** 이 건물의 설정 정의를 반환한다 (라벨, 색상, 모양 등). */
    get definition() {
        return CONFIG.BUILDINGS[this.typeId];
    }

    /**
     * 이 건물이 전력망에 참여하는지 여부. 기본값은 false이며, 전력을
     * 생산/소비하는 건물(Generator, PowerWire, Miner 등)이 override한다.
     * @returns {boolean}
     */
    isPowerNode() {
        return false;
    }

    /** 이 건물이 초당 공급하는 전력량. 기본값 0. */
    getPowerSupply() {
        return 0;
    }

    /** 이 건물이 초당 필요로 하는 전력량. 기본값 0. */
    getPowerDemand() {
        return 0;
    }

    /**
     * PowerSystem이 매 틱 계산한 공급 비율(0~1)을 설정한다.
     * @param {number} ratio
     */
    setPowerRatio(ratio) {
        this.powerRatio = ratio;
    }

    /** 더 업그레이드할 수 있는지 (최대 레벨 미만인지) 여부. */
    canUpgrade() {
        return this.level < CONFIG.UPGRADE.MAX_LEVEL;
    }

    /**
     * 다음 레벨로 올라가는 데 필요한 비용을 반환한다. 이미 최대 레벨이면 null.
     * 건물 자신의 배치 비용(definition.cost)에 배율을 곱해서, 비싼 건물일수록
     * 업그레이드도 비싸지게 한다 (모든 건물이 똑같이 50/150/400원이던 시절엔
     * 싼 건물부터 업그레이드하는 게 항상 유리했다).
     * @returns {number | null}
     */
    getUpgradeCost() {
        if (!this.canUpgrade()) return null;
        const multiplier = CONFIG.UPGRADE.COST_MULTIPLIER_PER_LEVEL[this.level - 1];
        return Math.round((this.definition?.cost ?? 0) * multiplier);
    }

    /**
     * 현재 레벨에 따른 성능 배율. 레벨 1이면 1배(기본 성능)이며,
     * 레벨이 오를 때마다 CONFIG.UPGRADE.SPEED_MULTIPLIER_PER_LEVEL만큼 늘어난다.
     * 각 건물이 이 값을 어디에 적용할지(생산 속도/전력 공급량/판매가 등)는
     * 하위 클래스가 알아서 결정한다.
     * @returns {number}
     */
    getSpeedMultiplier() {
        return 1 + (this.level - 1) * CONFIG.UPGRADE.SPEED_MULTIPLIER_PER_LEVEL;
    }

    /**
     * 자금이 충분하면 실제로 레벨을 하나 올린다.
     * @param {import('../systems/Systems.js').Economy} economy
     * @returns {boolean} 업그레이드 성공 여부
     */
    upgrade(economy) {
        if (!this.canUpgrade()) return false;

        const cost = this.getUpgradeCost();
        if (!economy.spendMoney(cost)) return false;

        this.level += 1;
        return true;
    }

    /**
     * 이 건물을 저장 가능한 순수 데이터로 변환한다.
     * 하위 클래스는 super.serialize()로 공통 필드를 받아온 뒤
     * 자신만의 상태(생산 타이머, 보관량 등)를 추가로 담아 반환한다.
     * @returns {object}
     */
    serialize() {
        return {
            typeId: this.typeId,
            tileX: this.tileX,
            tileY: this.tileY,
            rotation: this.rotation,
            level: this.level,
        };
    }

    /**
     * 저장된 데이터로부터 이 건물만의 추가 상태를 복원한다.
     * (typeId/tileX/tileY/rotation은 createBuilding()이 생성 시점에 이미 반영하므로 여기서 다루지 않는다.)
     * 하위 클래스는 super.restoreState(data)로 공통 필드(레벨 등)를 먼저 복원한 뒤
     * 자신만의 상태를 이어서 복원한다.
     * @param {object} data
     */
    restoreState(data) {
        this.level = data.level ?? 1;
    }

    /**
     * 이 건물이 지금 아이템 하나를 받아들일 수 있는지 여부.
     * 기본값은 false이며, 아이템을 받을 수 있는 건물(Conveyor, Storage 등)이 override한다.
     * @param {Item} item
     * @param {import('../world/World.js').World} [world] 전역 상태(활성 계약 등)를 참조해야 하는
     *   건물(ContractOffice 등)을 위해 전달된다. tryDeliverItem이 넘겨준다.
     * @returns {boolean}
     */
    canAcceptItem(item, world) {
        void item;
        void world;
        return false;
    }

    /**
     * 아이템을 실제로 받아들인다. canAcceptItem이 true를 반환한 직후에만 호출되어야 한다.
     * @param {Item} item
     * @param {number} [incomingDirection] 아이템이 들어온 방향(Direction 값). tryDeliverItem이 전달한다.
     * @param {import('../world/World.js').World} [world] 전역 상태(자금 등)가 필요한 건물을 위해 전달된다.
     */
    acceptItem(item, incomingDirection, world) {
        void item;
        void incomingDirection;
        void world;
    }

    /**
     * 이 건물의 진행 중인 작업 비율(0~1)을 반환한다. 진행 중인 작업이 없으면 null.
     * 기본값은 null이며, 제련 등 시간이 걸리는 작업을 하는 건물(Furnace 등)이 override한다.
     * @returns {number | null}
     */
    getProgressRatio() {
        return null;
    }

    /**
     * 이 건물이 지금 배출/전달이 막혀서 대기 중인지 여부. 경고/알림 시스템이
     * 주기적으로 샘플링해 "막힌 건물 수"를 센다. 기본값은 false이며, 완제품을
     * 만들어 배출하는 건물(Miner, Furnace 등)과 아이템을 운반하는 건물
     * (Conveyor, Inserter 등)이 override한다.
     * @returns {boolean}
     */
    isBlocked() {
        return false;
    }

    /**
     * 우측 정보 패널(InspectorPanel)에 표시할 정보를 반환한다.
     * 배열의 첫 항목은 패널 제목으로 쓰이고, 나머지는 "라벨: 값" 줄로 표시된다.
     * 하위 클래스는 super.getInspectorInfo()로 공통 정보를 받아온 뒤
     * 자신만의 정보(생산 진행률, 보관량 등)를 추가로 push한다.
     * @returns {{label: string, value: string}[]}
     */
    getInspectorInfo() {
        const info = [
            { label: '종류', value: this.definition?.label ?? this.typeId },
            { label: '위치', value: `(${this.tileX}, ${this.tileY})` },
            { label: '레벨', value: `Lv.${this.level}` },
        ];

        if (this.isPowerNode()) {
            if (this.getPowerSupply() > 0) {
                info.push({ label: '전력 공급', value: `${Math.round(this.getPowerSupply())}` });
            }
            if (this.getPowerDemand() > 0) {
                info.push({
                    label: '전력',
                    value: `${Math.round(this.powerRatio * 100)}% (수요 ${this.getPowerDemand()})`,
                });
            }
        }

        return info;
    }

    /**
     * 건물을 화면에 그린다. 실제 좌표 변환(월드->화면)은 Renderer가
     * 담당하고, 이 메서드는 이미 계산된 화면 좌표/크기만 받는다.
     * @param {CanvasRenderingContext2D} ctx
     * @param {number} screenX 타일의 화면상 좌상단 x
     * @param {number} screenY 타일의 화면상 좌상단 y
     * @param {number} screenSize 타일 한 변의 화면상 크기
     * @param {{alpha?: number, colorOverride?: string, connections?: {right: boolean, down: boolean, left: boolean, up: boolean}}} [options]
     *        alpha: 투명도 (건설 미리보기 등에 사용, 기본 1)
     *        colorOverride: 지정하면 정의된 색상 대신 이 색을 사용
     *        (예: 배치 불가능한 위치의 미리보기를 빨간색으로 표시)
     *        connections: 전선(wire) 도형 전용 - 상하좌우 실제 연결 여부 (Renderer가 계산해서 전달)
     */
    render(ctx, screenX, screenY, screenSize, options = {}) {
        const def = this.definition;
        if (!def) return;

        const { alpha = 1, colorOverride, connections } = options;
        const renderDef = colorOverride ? { ...def, color: colorOverride } : def;

        ctx.save();
        ctx.globalAlpha = alpha;

        switch (renderDef.shape) {
            case 'circle':
                this.#renderCircle(ctx, screenX, screenY, screenSize, renderDef);
                break;
            case 'arrow':
                this.#renderArrow(ctx, screenX, screenY, screenSize, renderDef);
                break;
            case 'generator':
                this.#renderGenerator(ctx, screenX, screenY, screenSize, renderDef);
                break;
            case 'wire':
                this.#renderWire(ctx, screenX, screenY, screenSize, renderDef, connections);
                break;
            case 'inserter':
                this.#renderInserter(ctx, screenX, screenY, screenSize, renderDef);
                break;
            case 'splitter':
                this.#renderRouter(ctx, screenX, screenY, screenSize, renderDef, true);
                break;
            case 'merger':
                this.#renderRouter(ctx, screenX, screenY, screenSize, renderDef, false);
                break;
            default:
                this.#renderSquare(ctx, screenX, screenY, screenSize, renderDef);
        }

        // 도형 자체가 방향을 드러내지 않는 건물(원/사각형)은 별도의 작은
        // 화살표 표식으로 현재 배출 방향을 보여준다 (예: 채굴기).
        if (def.showDirectionIndicator) {
            this.#renderDirectionIndicator(ctx, screenX, screenY, screenSize);
        }

        const progressRatio = this.getProgressRatio();
        if (progressRatio !== null) {
            this.#renderProgressArc(ctx, screenX, screenY, screenSize, progressRatio);
        }

        // 전력이 필요한데 완전히 끊긴(작동이 멈춘) 건물만 경고 아이콘을 띄운다.
        // 일부만 부족해 느리게라도 작동 중이면(0 < powerRatio < 1) 경고를 띄우지 않는다.
        if (this.isPowerNode() && this.getPowerDemand() > 0 && this.powerRatio <= 0) {
            this.#renderPowerWarning(ctx, screenX, screenY, screenSize);
        }

        ctx.restore();
    }

    #renderSquare(ctx, x, y, size, def) {
        const margin = size * 0.08;
        ctx.fillStyle = def.color;
        ctx.fillRect(x + margin, y + margin, size - margin * 2, size - margin * 2);
        ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(x + margin, y + margin, size - margin * 2, size - margin * 2);
    }

    #renderCircle(ctx, x, y, size, def) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const radius = size * 0.36;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = def.color;
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.stroke();
    }

    /**
     * this.rotation(0=→, 1=↓, 2=←, 3=↑) 방향을 가리키는 삼각형 화살표.
     * ctx.translate/rotate를 사용하므로 호출 전후 상태는 render()의
     * save/restore가 책임진다.
     */
    #renderArrow(ctx, x, y, size, def) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const half = size * 0.32;

        ctx.translate(cx, cy);
        ctx.rotate((Math.PI / 2) * this.rotation);

        // 오른쪽(→)을 기준(rotation=0)으로 그리는 삼각형
        ctx.beginPath();
        ctx.moveTo(half, 0);
        ctx.lineTo(-half * 0.6, -half * 0.7);
        ctx.lineTo(-half * 0.6, half * 0.7);
        ctx.closePath();
        ctx.fillStyle = def.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.stroke();
    }

    /**
     * 원/사각형처럼 회전이 시각적으로 드러나지 않는 도형 위에, 타일 가장자리에
     * 작은 삼각형 노치를 그려 현재 배출 방향(this.rotation)을 표시한다.
     * render()의 ctx.save()/ctx.restore() 안에서 호출되므로, 여기서
     * translate/rotate를 해도 다른 그리기에 영향을 주지 않는다.
     */
    #renderDirectionIndicator(ctx, x, y, size) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const edgeDist = size * 0.42;
        const triHalf = size * 0.08;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((Math.PI / 2) * this.rotation);

        ctx.beginPath();
        ctx.moveTo(edgeDist + triHalf, 0);
        ctx.lineTo(edgeDist - triHalf, -triHalf);
        ctx.lineTo(edgeDist - triHalf, triHalf);
        ctx.closePath();
        ctx.fillStyle = CONFIG.RENDER.BG_COLOR;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = CONFIG.RENDER.ACCENT_CYAN;
        ctx.stroke();

        ctx.restore();
    }

    /**
     * 시간이 걸리는 작업(제련 등)의 진행 상태를 타일 가장자리를 따라
     * 도는 얇은 호(arc)로 표시한다.
     * @param {number} ratio 0~1
     */
    #renderProgressArc(ctx, x, y, size, ratio) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const radius = size * 0.46;
        const startAngle = -Math.PI / 2; // 12시 방향에서 시작

        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, radius, startAngle, startAngle + Math.PI * 2 * ratio);
        ctx.strokeStyle = CONFIG.RENDER.ACCENT_CYAN;
        ctx.lineWidth = 3;
        ctx.lineCap = 'round';
        ctx.stroke();
        ctx.restore();
    }

    /** 발전기: 원 도형 안에 번개 모양을 그려 채굴기(단순 원)와 구별한다. */
    #renderGenerator(ctx, x, y, size, def) {
        this.#renderCircle(ctx, x, y, size, def);

        const cx = x + size / 2;
        const cy = y + size / 2;
        const s = size * 0.16;

        ctx.beginPath();
        ctx.moveTo(cx + s * 0.2, cy - s * 1.1);
        ctx.lineTo(cx - s * 0.6, cy + s * 0.1);
        ctx.lineTo(cx - s * 0.05, cy + s * 0.1);
        ctx.lineTo(cx - s * 0.2, cy + s * 1.1);
        ctx.lineTo(cx + s * 0.6, cy - s * 0.1);
        ctx.lineTo(cx + s * 0.05, cy - s * 0.1);
        ctx.closePath();
        ctx.fillStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.fill();
    }

    /** 기계 팔: 회전 방향으로 뻗는 팔과 집게를 그려 입출력 방향을 명확히 한다. */
    #renderInserter(ctx, x, y, size, def) {
        const cx = x + size / 2;
        const cy = y + size / 2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((Math.PI / 2) * this.rotation);

        ctx.fillStyle = def.color;
        ctx.fillRect(-size * 0.16, -size * 0.16, size * 0.32, size * 0.32);
        ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(-size * 0.16, -size * 0.16, size * 0.32, size * 0.32);

        ctx.strokeStyle = def.color;
        ctx.lineWidth = size * 0.12;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(size * 0.1, 0);
        ctx.lineTo(size * 0.34, 0);
        ctx.stroke();

        ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(size * 0.38, -size * 0.12);
        ctx.lineTo(size * 0.46, -size * 0.2);
        ctx.moveTo(size * 0.38, size * 0.12);
        ctx.lineTo(size * 0.46, size * 0.2);
        ctx.stroke();
        ctx.restore();
    }

    /** 분배기/합류기: 회전 방향을 기준으로 갈라지거나 모이는 흐름을 표시한다. */
    #renderRouter(ctx, x, y, size, def, isSplitter) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const half = size * 0.37;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((Math.PI / 2) * this.rotation);
        ctx.strokeStyle = def.color;
        ctx.lineWidth = size * 0.1;
        ctx.lineCap = 'round';

        ctx.beginPath();
        if (isSplitter) {
            ctx.moveTo(-half, 0);
            ctx.lineTo(-size * 0.05, 0);
            ctx.lineTo(half, -half * 0.65);
            ctx.moveTo(-size * 0.05, 0);
            ctx.lineTo(half, half * 0.65);
        } else {
            ctx.moveTo(-half, -half * 0.65);
            ctx.lineTo(size * 0.05, 0);
            ctx.moveTo(-half, half * 0.65);
            ctx.lineTo(size * 0.05, 0);
            ctx.lineTo(half, 0);
        }
        ctx.stroke();

        ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.lineWidth = 2;
        ctx.strokeRect(-size * 0.4, -size * 0.4, size * 0.8, size * 0.8);
        ctx.restore();
    }

    /**
     * 전선: 실제로 연결된 방향으로만 선을 그려 직선/코너/T자/십자/막다른 끝
     * 모양이 자동으로 결정된다 (연결 정보가 없으면, 예: 배치 미리보기,
     * 네 방향 모두 연결된 것처럼 기본 표시한다).
     * @param {{right: boolean, down: boolean, left: boolean, up: boolean} | undefined} connections
     */
    #renderWire(ctx, x, y, size, def, connections) {
        const cx = x + size / 2;
        const cy = y + size / 2;
        const half = size * 0.5; // 이웃 타일 중심까지 닿도록 가장자리까지 그린다

        const conn = connections ?? { right: true, down: true, left: true, up: true };

        ctx.strokeStyle = def.color;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';

        ctx.beginPath();
        if (conn.right) { ctx.moveTo(cx, cy); ctx.lineTo(cx + half, cy); }
        if (conn.left) { ctx.moveTo(cx, cy); ctx.lineTo(cx - half, cy); }
        if (conn.down) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy + half); }
        if (conn.up) { ctx.moveTo(cx, cy); ctx.lineTo(cx, cy - half); }

        // 연결이 하나도 없으면(고립된 전선) 짧은 십자 표식만 남긴다.
        const hasAnyConnection = conn.right || conn.left || conn.down || conn.up;
        if (!hasAnyConnection) {
            const stub = size * 0.16;
            ctx.moveTo(cx - stub, cy);
            ctx.lineTo(cx + stub, cy);
            ctx.moveTo(cx, cy - stub);
            ctx.lineTo(cx, cy + stub);
        }

        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, cy, size * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
        ctx.fill();
    }

    /** 전력이 부족한 건물의 우상단에 작은 경고 아이콘(느낌표)을 표시한다. */
    #renderPowerWarning(ctx, x, y, size) {
        const cx = x + size * 0.82;
        const cy = y + size * 0.18;
        const r = size * 0.12;

        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = CONFIG.RENDER.GHOST_INVALID_COLOR;
        ctx.fill();

        ctx.fillStyle = CONFIG.RENDER.BG_COLOR;
        ctx.fillRect(cx - r * 0.14, cy - r * 0.55, r * 0.28, r * 0.7);
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.45, r * 0.14, 0, Math.PI * 2);
        ctx.fill();
    }
}

/**
 * 대상 건물에게 아이템 전달을 시도하는 공통 헬퍼.
 * @param {import('../world/World.js').World} world
 * @param {number} fromTileX
 * @param {number} fromTileY
 * @param {number} direction Direction 값 - 이 방향으로 한 칸 인접한 타일에 전달을 시도한다.
 * @param {Item} item
 * @returns {boolean} 전달 성공 여부
 */
export function tryDeliverItem(world, fromTileX, fromTileY, direction, item) {
    const vec = DIRECTION_VECTORS[direction];
    const targetBuilding = world.getBuildingAt(fromTileX + vec.x, fromTileY + vec.y);

    if (!targetBuilding || !targetBuilding.canAcceptItem(item, world)) {
        return false;
    }

    // direction은 "source -> target" 방향이므로, target 입장에서 실제로
    // 들어온 방향은 그 반대다. Conveyor는 이 값을 받아 진입 경로 계산에 사용하고,
    // Seller처럼 전역 상태(자금 등)가 필요한 건물은 world를 통해 접근한다.
    targetBuilding.acceptItem(item, direction, world);
    return true;
}

/**
 * 주기적으로 아이템을 생산해 정면 방향으로 배출하는 건물.
 * 채굴기는 등급(티어)이 있다 - MinerT1/T2/T3가 각각 typeId만 다르게 넘겨
 * 이 클래스를 그대로 쓴다 (Crusher/Washer가 Processor를 공유하는 것과 같은 패턴).
 * 등급별 채굴 간격/전력 소모는 definition.miningInterval / definition.powerDemand로
 * 오버라이드할 수 있고, 없으면 기본 채굴기 수치(CONFIG.PRODUCTION/POWER)를 쓴다.
 */
export class Miner extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} typeId
     * @param {number} rotation
     */
    constructor(tileX, tileY, typeId, rotation) {
        super(tileX, tileY, typeId, rotation);
        this.productionTimer = 0;
        this.selectedResource = this.definition.producesResource;
        /** @type {Item | null} 생산 완료되어 배출을 기다리는 아이템 */
        this.pendingOutput = null;
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return this.definition.powerDemand ?? CONFIG.POWER.MINER_DEMAND;
    }

    /** 이 등급의 채굴기가 아이템 하나를 만드는 데 걸리는 시간(초). */
    #getInterval() {
        return this.definition.miningInterval ?? CONFIG.PRODUCTION.MINER_INTERVAL;
    }

    isBlocked() {
        return this.pendingOutput !== null;
    }

    /**
     * @param {number} dt
     * @param {import('../world/World.js').World} world
     */
    update(dt, world) {
        // 이미 만들어둔 아이템이 배출을 기다리고 있으면, 새로 생산하지 않고
        // 같은 아이템으로 배출만 계속 재시도한다 (막혀 있는 동안 매 틱 새
        // 아이템을 만들었다가 버리는 낭비를 없앤 것).
        if (this.pendingOutput) {
            const delivered = tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.pendingOutput);
            if (delivered) {
                this.pendingOutput = null;
                this.productionTimer = 0;
            }
            return;
        }

        const interval = this.#getInterval();
        // 전력이 부족하면(powerRatio < 1) 그만큼 생산 타이머가 천천히 찬다.
        this.productionTimer += dt * this.powerRatio * this.getSpeedMultiplier();

        if (this.productionTimer < interval) return;

        const resourceType = this.selectedResource;
        this.pendingOutput = itemPool.acquire(this.tileX, this.tileY, resourceType);
        world.stats.recordProduced(resourceType);

        const delivered = tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.pendingOutput);
        if (delivered) {
            this.pendingOutput = null;
            this.productionTimer = 0;
        }
        // 전달 실패 시 pendingOutput을 그대로 들고 있다가 다음 틱에 재시도한다.
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        const interval = this.#getInterval();
        const resourceLabel = ResourceRegistry.getDefinition(this.selectedResource)?.label
            ?? this.selectedResource;

        info.push({ label: '생산 자원', value: resourceLabel });
        info.push({ label: '변경', value: '선택 후 M 키' });
        if (this.pendingOutput) {
            info.push({ label: '상태', value: '배출 대기 중 (막힘)' });
        } else {
            info.push({ label: '생산 진행', value: `${Math.round(Math.min(this.productionTimer / interval, 1) * 100)}%` });
        }
        return info;
    }

    serialize() {
        return {
            ...super.serialize(),
            productionTimer: this.productionTimer,
            selectedResource: this.selectedResource,
            pendingOutput: this.pendingOutput ? { resourceType: this.pendingOutput.resourceType } : null,
        };
    }

    restoreState(data) {
        super.restoreState(data);
        this.productionTimer = data.productionTimer ?? 0;
        this.selectedResource = data.selectedResource ?? this.definition.producesResource;
        this.pendingOutput = data.pendingOutput
            ? new Item(this.tileX, this.tileY, data.pendingOutput.resourceType)
            : null;
    }

    cycleResource() {
        const resources = this.definition.selectableResources ?? [this.definition.producesResource];
        const index = resources.indexOf(this.selectedResource);
        this.selectedResource = resources[(index + 1) % resources.length];
    }

    /**
     * 이 채굴기가 캘 수 있는 자원이면 바로 그 자원으로 바꾼다 (다중 선택 일괄
     * 변경용 - cycleResource()처럼 한 칸씩 넘기지 않고 원하는 자원으로 직행한다).
     * @param {string} resourceType
     * @returns {boolean} 이 채굴기가 그 자원을 캘 수 있어서 실제로 바뀌었는지 여부
     */
    setResource(resourceType) {
        const resources = this.definition.selectableResources ?? [this.definition.producesResource];
        if (!resources.includes(resourceType)) return false;
        this.selectedResource = resourceType;
        return true;
    }
}

export class MinerT1 extends Miner { constructor(x, y, r) { super(x, y, 'miner', r); } }
export class MinerT2 extends Miner { constructor(x, y, r) { super(x, y, 'miner_t2', r); } }
export class MinerT3 extends Miner { constructor(x, y, r) { super(x, y, 'miner_t3', r); } }

/**
 * 아이템을 자신의 정면 방향으로 옮기는 건물.
 * 칸 하나에 여러 아이템을 동시에 담을 수 있으며, 앞선 아이템과
 * CONVEYOR_MIN_GAP 이상의 간격을 유지하며 뒤따라간다 (실제 벨트처럼
 * 여러 개가 줄지어 흐르는 모습을 만들기 위함).
 */
export class Conveyor extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} typeId
     * @param {number} rotation
     */
    constructor(tileX, tileY, typeId, rotation) {
        super(tileX, tileY, typeId, rotation);
        /**
         * 진행도(progress) 오름차순으로 정렬된 배열.
         * items[0]이 가장 뒤(진입 지점에 가까움), 마지막 원소가 가장 앞(배출 지점에 가까움).
         * @type {Item[]}
         */
        this.items = [];
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return this.definition.powerDemand ?? CONFIG.POWER.CONVEYOR_DEMAND;
    }

    /** 맨 앞 아이템이 배출 지점(progress=1)에 도착했는데 다음 칸이 안 받아줘서 대기 중인지. */
    isBlocked() {
        if (this.items.length === 0) return false;
        return this.items[this.items.length - 1].progress >= 1;
    }

    /** 진입 지점(progress=0)에 새 아이템을 넣을 여유 공간이 있는지 확인한다. */
    canAcceptItem() {
        if (this.items.length === 0) return true;
        const backItem = this.items[0];
        return backItem.progress >= CONFIG.PRODUCTION.CONVEYOR_MIN_GAP;
    }

    /**
     * @param {Item} item
     * @param {number} incomingDirection 아이템이 실제로 들어온 방향 (source -> target 방향)
     */
    acceptItem(item, incomingDirection) {
        item.tileX = this.tileX;
        item.tileY = this.tileY;
        item.progress = 0;
        // source->target 방향의 반대가 곧 이 칸에서 "들어온 쪽" 방향이다.
        item.entryDirection = oppositeDirection(incomingDirection);

        const pos = computeItemWorldPosition(this.tileX, this.tileY, item.entryDirection, this.rotation, 0);
        item.worldX = pos.x;
        item.worldY = pos.y;
        // 넘겨받는 시점의 위치는 이전 건물(채굴기/컨베이어)의 배출 지점과 동일하므로,
        // prevWorld도 같은 값으로 맞춰 순간이동처럼 보이지 않게 한다.
        item.prevWorldX = pos.x;
        item.prevWorldY = pos.y;

        this.items.unshift(item);
    }

    /**
     * @param {number} dt
     * @param {import('../world/World.js').World} world
     */
    update(dt, world) {
        if (this.items.length === 0) return;

        const speed = (this.definition.conveyorSpeed ?? CONFIG.PRODUCTION.CONVEYOR_SPEED) * this.powerRatio * this.getSpeedMultiplier();
        const minGap = CONFIG.PRODUCTION.CONVEYOR_MIN_GAP;

        // 가장 앞선 아이템부터 처리해야, 뒤따르는 아이템이 "방금 갱신된" 앞 아이템의
        // 진행도를 기준으로 자신의 최대 진행 가능 지점을 계산할 수 있다.
        for (let i = this.items.length - 1; i >= 0; i--) {
            const item = this.items[i];
            item.prevWorldX = item.worldX;
            item.prevWorldY = item.worldY;

            // 맨 앞 아이템은 배출 지점(1)까지, 그 외에는 바로 앞 아이템과의 간격만큼만 전진 가능.
            const maxProgress = (i === this.items.length - 1)
                ? 1
                : this.items[i + 1].progress - minGap;

            item.progress = Math.min(item.progress + speed * dt, Math.max(maxProgress, item.progress));

            // 항상 이 아이템 고유의 entryDirection(들어온 방향)을 기준으로 경로를 계산한다.
            const entryDirection = item.entryDirection ?? oppositeDirection(this.rotation);
            const pos = computeItemWorldPosition(this.tileX, this.tileY, entryDirection, this.rotation, item.progress);
            item.worldX = pos.x;
            item.worldY = pos.y;
        }

        // 맨 앞 아이템이 배출 지점에 도착했으면 다음 칸으로 전달을 시도한다.
        const frontItem = this.items[this.items.length - 1];
        if (frontItem.progress >= 1) {
            const delivered = tryDeliverItem(world, this.tileX, this.tileY, this.rotation, frontItem);
            if (delivered) {
                this.items.pop();
            }
            // 전달 실패 시 progress=1 상태로 대기 -> 병목현상이 시각적으로 드러난다.
        }
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        info.push({ label: '적재 아이템', value: `${this.items.length}개` });
        return info;
    }

    serialize() {
        return {
            ...super.serialize(),
            items: this.items.map((item) => ({
                resourceType: item.resourceType,
                progress: item.progress,
                entryDirection: item.entryDirection,
            })),
        };
    }

    restoreState(data) {
        super.restoreState(data);
        this.items = (data.items ?? []).map((itemData) => {
            const item = new Item(this.tileX, this.tileY, itemData.resourceType);
            item.progress = itemData.progress ?? 0;
            item.entryDirection = itemData.entryDirection ?? oppositeDirection(this.rotation);

            const pos = computeItemWorldPosition(this.tileX, this.tileY, item.entryDirection, this.rotation, item.progress);
            item.worldX = pos.x;
            item.worldY = pos.y;
            item.prevWorldX = pos.x;
            item.prevWorldY = pos.y;

            return item;
        });
    }
}

export class ConveyorT1 extends Conveyor { constructor(x, y, r) { super(x, y, 'conveyor', r); } }
export class ConveyorT2 extends Conveyor { constructor(x, y, r) { super(x, y, 'conveyor_t2', r); } }
export class ConveyorT3 extends Conveyor { constructor(x, y, r) { super(x, y, 'conveyor_t3', r); } }


/** 들어오는 아이템을 무제한으로 저장하는 건물 (Phase 3 범위: 용량 제한 없음). */
export class Storage extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} rotation
     */
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'storage', rotation);
        /** @type {Record<string, number>} 자원 종류별 저장 개수 */
        this.storedCounts = {};
    }

    canAcceptItem() {
        return true;
    }

    acceptItem(item) {
        this.storedCounts[item.resourceType] = (this.storedCounts[item.resourceType] ?? 0) + 1;
        // 창고는 아이템의 최종 도착지이므로, 다 쓴 아이템을 풀에 돌려준다.
        itemPool.release(item);
    }

    /**
     * 기계 팔이 꺼내 갈 아이템 하나를 만든다. 창고는 아이템 객체 대신 수량만
     * 저장하므로, 꺼내는 시점에 풀에서 아이템을 다시 확보한다.
     * @returns {Item | null}
     */
    takeItem() {
        const entry = Object.entries(this.storedCounts).find(([, count]) => count > 0);
        if (!entry) return null;

        const [resourceType] = entry;
        this.storedCounts[resourceType] -= 1;
        if (this.storedCounts[resourceType] === 0) {
            delete this.storedCounts[resourceType];
        }
        return itemPool.acquire(this.tileX, this.tileY, resourceType);
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        const entries = Object.entries(this.storedCounts);

        if (entries.length === 0) {
            info.push({ label: '보관량', value: '비어있음' });
        } else {
            for (const [resourceType, count] of entries) {
                const label = ResourceRegistry.getDefinition(resourceType)?.label ?? resourceType;
                info.push({ label, value: `${count}개` });
            }
        }

        return info;
    }

    serialize() {
        return { ...super.serialize(), storedCounts: { ...this.storedCounts } };
    }

    restoreState(data) {
        super.restoreState(data);
        this.storedCounts = { ...(data.storedCounts ?? {}) };
    }
}

/**
 * 원료를 받아 일정 시간 뒤 완제품으로 바꿔 정면 방향으로 배출하는 건물.
 * 동시에 원료 1개(제련 중) + 완제품 1개(배출 대기)까지만 처리하는 단순화된 모델이다.
 */
export class Furnace extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} rotation
     */
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'furnace', rotation);
        /** @type {Item | null} 현재 제련 중인 원료 */
        this.inputItem = null;
        this.smeltTimer = 0;
        /** @type {Item | null} 제련 완료되어 배출을 기다리는 완제품 */
        this.pendingOutput = null;
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return CONFIG.POWER.FURNACE_DEMAND;
    }

    canAcceptItem(item) {
        // 이미 처리 중이거나 배출을 기다리는 게 있으면 새 원료를 받지 않는다.
        if (this.inputItem || this.pendingOutput) return false;
        return Boolean(CONFIG.RECIPES[item.resourceType]);
    }

    isBlocked() {
        return this.pendingOutput !== null;
    }

    acceptItem(item) {
        this.inputItem = item;
        this.smeltTimer = 0;
    }

    getProgressRatio() {
        if (!this.inputItem) return null;
        const recipe = CONFIG.RECIPES[this.inputItem.resourceType];
        if (!recipe) return null;
        return Math.min(this.smeltTimer / recipe.duration, 1);
    }

    /**
     * @param {number} dt
     * @param {import('../world/World.js').World} world
     */
    update(dt, world) {
        // 완제품 배출을 우선 시도한다 (막혀서 대기 중이었을 수 있음).
        if (this.pendingOutput) {
            const delivered = tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.pendingOutput);
            if (delivered) {
                this.pendingOutput = null;
            }
            return; // 배출 대기 중에는 새 제련을 시작하지 않는다.
        }

        if (!this.inputItem) return;

        const recipe = CONFIG.RECIPES[this.inputItem.resourceType];
        this.smeltTimer += dt * this.powerRatio * this.getSpeedMultiplier();
        if (this.smeltTimer < recipe.duration) return;

        this.pendingOutput = itemPool.acquire(this.tileX, this.tileY, recipe.output);
        world.stats.recordProduced(recipe.output);
        // 원료는 완제품으로 "변환"되어 사라지는 것이므로, 다 쓴 원료 아이템 객체를 반납한다.
        itemPool.release(this.inputItem);
        this.inputItem = null;
        this.smeltTimer = 0;
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();

        if (this.inputItem) {
            const recipe = CONFIG.RECIPES[this.inputItem.resourceType];
            const fromLabel = ResourceRegistry.getDefinition(this.inputItem.resourceType)?.label;
            const toLabel = ResourceRegistry.getDefinition(recipe.output)?.label;
            const percent = Math.round((this.smeltTimer / recipe.duration) * 100);
            info.push({ label: '제련 중', value: `${fromLabel} → ${toLabel} (${percent}%)` });
        } else if (this.pendingOutput) {
            const label = ResourceRegistry.getDefinition(this.pendingOutput.resourceType)?.label;
            info.push({ label: '배출 대기', value: label ?? this.pendingOutput.resourceType });
        } else {
            info.push({ label: '상태', value: '대기 중 (원료 없음)' });
        }

        return info;
    }

    serialize() {
        return {
            ...super.serialize(),
            inputItem: this.inputItem ? { resourceType: this.inputItem.resourceType } : null,
            smeltTimer: this.smeltTimer,
            pendingOutput: this.pendingOutput ? { resourceType: this.pendingOutput.resourceType } : null,
        };
    }

    restoreState(data) {
        super.restoreState(data);
        this.inputItem = data.inputItem
            ? new Item(this.tileX, this.tileY, data.inputItem.resourceType)
            : null;
        this.smeltTimer = data.smeltTimer ?? 0;
        this.pendingOutput = data.pendingOutput
            ? new Item(this.tileX, this.tileY, data.pendingOutput.resourceType)
            : null;
    }
}

/** 들어오는 아이템을 즉시 판매해 자금으로 바꾸는 건물 (Phase 4 범위: 용량 제한 없음). */
export class Seller extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} rotation
     */
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'seller', rotation);
        this.totalSold = 0;
        this.totalRevenue = 0;
    }

    canAcceptItem() {
        return true;
    }

    /**
     * @param {Item} item
     * @param {number} incomingDirection
     * @param {import('../world/World.js').World} world
     */
    acceptItem(item, incomingDirection, world) {
        const price = Math.round((CONFIG.ECONOMY.SELL_PRICES[item.resourceType] ?? 0) * this.getSpeedMultiplier());
        world.economy.addMoney(price);
        world.stats.recordSold(item.resourceType, price);
        this.totalSold += 1;
        this.totalRevenue += price;
        // 판매기도 아이템의 최종 도착지이므로 다 쓴 아이템을 풀에 돌려준다.
        itemPool.release(item);
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        info.push({ label: '누적 판매', value: `${this.totalSold}개` });
        info.push({ label: '누적 수익', value: `${this.totalRevenue}` });
        return info;
    }

    serialize() {
        return { ...super.serialize(), totalSold: this.totalSold, totalRevenue: this.totalRevenue };
    }

    restoreState(data) {
        super.restoreState(data);
        this.totalSold = data.totalSold ?? 0;
        this.totalRevenue = data.totalRevenue ?? 0;
    }
}

/**
 * 판매기와 달리 아무거나 받지 않고, 지금 활성 계약(world.contracts)이 필요로
 * 하는 자원만 받아 그 진행도에 반영한다. 계약이 다 채워지면 보상(돈+RP)을 주고
 * 다음 계약으로 넘어간다. 실제 판정/보상 로직은 world.contracts(ContractSystem)가
 * 갖고 있고, 이 건물은 배달 지점 역할만 한다.
 */
export class ContractOffice extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} rotation
     */
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'contract_office', rotation);
        /** 이 건물이 지금까지 계약에 반영한 아이템 총 개수 (개별 인스펙터 표시용). */
        this.totalDelivered = 0;
    }

    /**
     * @param {Item} item
     * @param {import('../world/World.js').World} world
     */
    canAcceptItem(item, world) {
        return Boolean(world?.contracts?.needsResource(item.resourceType));
    }

    /**
     * @param {Item} item
     * @param {number} incomingDirection
     * @param {import('../world/World.js').World} world
     */
    acceptItem(item, incomingDirection, world) {
        world.contracts.deliver(item.resourceType);
        this.totalDelivered += 1;
        itemPool.release(item);

        if (world.contracts.isComplete()) {
            const finishedLabel = world.contracts.active.label;
            const reward = world.contracts.complete();
            if (reward.money) world.economy.addMoney(reward.money);
            if (reward.rp) world.researchSystem.addResearchPoints(reward.rp);
            Logger.info(`계약 완료: ${finishedLabel} (+${reward.money ?? 0}원, +${reward.rp ?? 0}RP)`);
        }
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        info.push({ label: '누적 납품', value: `${this.totalDelivered}개` });
        info.push({ label: '자세히 보기', value: '상단 "계약" 패널 참고' });
        return info;
    }

    serialize() {
        return { ...super.serialize(), totalDelivered: this.totalDelivered };
    }

    restoreState(data) {
        super.restoreState(data);
        this.totalDelivered = data.totalDelivered ?? 0;
    }
}

/** 전력망에 고정된 전력을 공급하는 건물 (Phase 5 범위: 연료 없이 항상 최대 출력). */
export class Generator extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} typeId
     * @param {number} rotation
     */
    constructor(tileX, tileY, typeId, rotation) {
        super(tileX, tileY, typeId, rotation);
    }

    isPowerNode() {
        return true;
    }

    getPowerSupply() {
        return (this.definition.powerOutput ?? CONFIG.POWER.GENERATOR_OUTPUT) * this.getSpeedMultiplier();
    }
}

export class GeneratorT1 extends Generator { constructor(x, y, r) { super(x, y, 'generator', r); } }
export class GeneratorT2 extends Generator { constructor(x, y, r) { super(x, y, 'generator_t2', r); } }
export class GeneratorT3 extends Generator { constructor(x, y, r) { super(x, y, 'generator_t3', r); } }

/** 전력만 생산/소비하지 않고, 서로 떨어진 전력 건물들을 이어주는 중계 건물. */
export class PowerWire extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} rotation
     */
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'wire', rotation);
    }

    isPowerNode() {
        return true;
    }
}

/** 전력을 받아 초당 일정량의 연구 포인트(RP)를 전역 연구 시스템에 공급하는 건물. */
export class Lab extends Building {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {number} rotation
     */
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'lab', rotation);
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return CONFIG.POWER.LAB_DEMAND;
    }

    /**
     * @param {number} dt
     * @param {import('../world/World.js').World} world
     */
    update(dt, world) {
        // 전력이 부족하면(powerRatio < 1) 연구 속도도 그만큼 줄어든다.
        world.researchSystem.addResearchPoints(CONFIG.RESEARCH.LAB_OUTPUT * dt * this.powerRatio * this.getSpeedMultiplier());
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        const currentOutput = (CONFIG.RESEARCH.LAB_OUTPUT * this.powerRatio * this.getSpeedMultiplier()).toFixed(1);
        info.push({ label: '연구 포인트 생산', value: `${currentOutput}/초` });
        return info;
    }
}

/**
 * typeId에 맞는 Building 서브클래스를 생성한다.
 * 등록되지 않은 typeId는 행동이 없는 기본 Building으로 생성된다.
 * @param {string} typeId
 * @param {number} tileX
 * @param {number} tileY
 * @param {number} rotation
 * @returns {Building}
 */
export function createBuilding(typeId, tileX, tileY, rotation) {
    const BuildingClass = BUILDING_CLASSES[typeId];
    return BuildingClass
        ? new BuildingClass(tileX, tileY, rotation)
        : new Building(tileX, tileY, typeId, rotation);
}

/**
 * 저장된 데이터로부터 건물을 복원한다.
 * createBuilding()으로 올바른 타입의 인스턴스를 만든 뒤, restoreState()로
 * 그 건물만의 추가 상태(생산 타이머, 보관량 등)를 되돌려놓는다.
 * @param {object} data serialize()가 만든 형태의 데이터
 * @returns {Building}
 */
export function deserializeBuilding(data) {
    const building = createBuilding(data.typeId, data.tileX, data.tileY, data.rotation);
    building.restoreState(data);
    return building;
}

/**
 * 뒤쪽 인접 창고에서 아이템 하나를 꺼내, 정면 인접 건물로 넘긴다.
 * 배출 대상이 막히면 아이템을 들고 기다리므로 자원이 사라지지 않는다.
 */
export class Inserter extends Building {
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'inserter', rotation);
        this.transferTimer = 0;
        /** @type {Item | null} */
        this.heldItem = null;
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return CONFIG.POWER.INSERTER_DEMAND;
    }

    isBlocked() {
        return this.heldItem !== null;
    }

    update(dt, world) {
        if (this.heldItem) {
            if (tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.heldItem)) {
                this.heldItem = null;
                this.transferTimer = 0;
            }
            return;
        }

        this.transferTimer += dt * this.powerRatio * this.getSpeedMultiplier();
        if (this.transferTimer < CONFIG.PRODUCTION.INSERTER_INTERVAL) return;

        const sourceDirection = oppositeDirection(this.rotation);
        const sourceVec = DIRECTION_VECTORS[sourceDirection];
        const source = world.getBuildingAt(this.tileX + sourceVec.x, this.tileY + sourceVec.y);
        if (!(source instanceof Storage)) return;

        this.heldItem = source.takeItem();
        if (!this.heldItem) return;

        if (tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.heldItem)) {
            this.heldItem = null;
            this.transferTimer = 0;
        }
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        const heldLabel = this.heldItem
            ? (ResourceRegistry.getDefinition(this.heldItem.resourceType)?.label ?? this.heldItem.resourceType)
            : '없음';
        info.push({ label: '운반 중', value: heldLabel });
        info.push({ label: '방향', value: '뒤쪽 창고 → 정면 건물' });
        return info;
    }

    serialize() {
        return {
            ...super.serialize(),
            transferTimer: this.transferTimer,
            heldItem: this.heldItem ? { resourceType: this.heldItem.resourceType } : null,
        };
    }

    restoreState(data) {
        super.restoreState(data);
        this.transferTimer = data.transferTimer ?? 0;
        this.heldItem = data.heldItem
            ? itemPool.acquire(this.tileX, this.tileY, data.heldItem.resourceType)
            : null;
    }

}

/**
 * 뒤쪽에서 받은 아이템을 정면 기준 좌/우 두 갈래로 번갈아 보낸다.
 * 한쪽 라인이 막히면 다른 쪽을 먼저 시도해, 생산 라인의 정체를 줄인다.
 */
export class Splitter extends Building {
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'splitter', rotation);
        /** @type {Item | null} */
        this.pendingItem = null;
        this.transferTimer = 0;
        this.nextOutputIndex = 0;
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return CONFIG.POWER.ROUTER_DEMAND;
    }

    isBlocked() {
        return this.pendingItem !== null;
    }

    canAcceptItem() {
        return this.pendingItem === null;
    }

    acceptItem(item) {
        this.pendingItem = item;
        this.transferTimer = 0;
    }

    update(dt, world) {
        if (!this.pendingItem) return;

        this.transferTimer += dt * this.powerRatio * this.getSpeedMultiplier();
        if (this.transferTimer < CONFIG.PRODUCTION.ROUTER_INTERVAL) return;

        // 회전 방향을 정면으로 볼 때, 왼쪽/오른쪽은 각각 -90/+90도다.
        const directions = [
            (this.rotation + 3) % 4,
            (this.rotation + 1) % 4,
        ];
        for (let offset = 0; offset < directions.length; offset++) {
            const index = (this.nextOutputIndex + offset) % directions.length;
            if (tryDeliverItem(world, this.tileX, this.tileY, directions[index], this.pendingItem)) {
                this.pendingItem = null;
                this.transferTimer = 0;
                this.nextOutputIndex = (index + 1) % directions.length;
                return;
            }
        }
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        info.push({ label: '출력', value: '정면 기준 좌/우 교대' });
        info.push({ label: '상태', value: this.pendingItem ? '분배 대기' : '입력 대기' });
        return info;
    }

    serialize() {
        return {
            ...super.serialize(),
            transferTimer: this.transferTimer,
            nextOutputIndex: this.nextOutputIndex,
            pendingItem: this.pendingItem ? { resourceType: this.pendingItem.resourceType } : null,
        };
    }

    restoreState(data) {
        super.restoreState(data);
        this.transferTimer = data.transferTimer ?? 0;
        this.nextOutputIndex = data.nextOutputIndex ?? 0;
        this.pendingItem = data.pendingItem
            ? itemPool.acquire(this.tileX, this.tileY, data.pendingItem.resourceType)
            : null;
    }
}

/** 두 옆 방향에서 들어온 아이템을 받아 정면의 한 라인으로 보낸다. */
export class Merger extends Building {
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'merger', rotation);
        /** @type {Item | null} */
        this.pendingItem = null;
        this.transferTimer = 0;
    }

    isPowerNode() {
        return true;
    }

    getPowerDemand() {
        return CONFIG.POWER.ROUTER_DEMAND;
    }

    isBlocked() {
        return this.pendingItem !== null;
    }

    canAcceptItem() {
        return this.pendingItem === null;
    }

    acceptItem(item) {
        this.pendingItem = item;
        this.transferTimer = 0;
    }

    update(dt, world) {
        if (!this.pendingItem) return;

        this.transferTimer += dt * this.powerRatio * this.getSpeedMultiplier();
        if (this.transferTimer < CONFIG.PRODUCTION.ROUTER_INTERVAL) return;

        if (tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.pendingItem)) {
            this.pendingItem = null;
            this.transferTimer = 0;
        }
    }

    getInspectorInfo() {
        const info = super.getInspectorInfo();
        info.push({ label: '입력', value: '정면 기준 좌/우' });
        info.push({ label: '상태', value: this.pendingItem ? '합류 대기' : '입력 대기' });
        return info;
    }

    serialize() {
        return {
            ...super.serialize(),
            transferTimer: this.transferTimer,
            pendingItem: this.pendingItem ? { resourceType: this.pendingItem.resourceType } : null,
        };
    }

    restoreState(data) {
        super.restoreState(data);
        this.transferTimer = data.transferTimer ?? 0;
        this.pendingItem = data.pendingItem
            ? itemPool.acquire(this.tileX, this.tileY, data.pendingItem.resourceType)
            : null;
    }
}

class Processor extends Building {
    constructor(tileX, tileY, typeId, rotation) {
        super(tileX, tileY, typeId, rotation);
        this.inputItem = null;
        this.pendingOutput = null;
        this.timer = 0;
    }

    isPowerNode() { return true; }
    getPowerDemand() { return CONFIG.POWER.FURNACE_DEMAND; }
    canAcceptItem(item) { return !this.inputItem && !this.pendingOutput && Boolean(CONFIG.PROCESSING_RECIPES[this.typeId][item.resourceType]); }
    acceptItem(item) { this.inputItem = item; this.timer = 0; }
    isBlocked() { return this.pendingOutput !== null; }
    update(dt, world) {
        if (this.pendingOutput) {
            if (tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.pendingOutput)) this.pendingOutput = null;
            return;
        }
        if (!this.inputItem) return;
        this.timer += dt * this.powerRatio * this.getSpeedMultiplier();
        if (this.timer < CONFIG.PRODUCTION.PROCESSOR_INTERVAL) return;
        const output = CONFIG.PROCESSING_RECIPES[this.typeId][this.inputItem.resourceType];
        this.pendingOutput = itemPool.acquire(this.tileX, this.tileY, output);
        world.stats.recordProduced(output);
        itemPool.release(this.inputItem);
        this.inputItem = null;
        this.timer = 0;
    }
    getInspectorInfo() {
        const info = super.getInspectorInfo();
        info.push({ label: '상태', value: this.pendingOutput ? '배출 대기' : this.inputItem ? '가공 중' : '원료 대기' });
        return info;
    }
    serialize() { return { ...super.serialize(), timer: this.timer, inputItem: this.inputItem ? { resourceType: this.inputItem.resourceType } : null, pendingOutput: this.pendingOutput ? { resourceType: this.pendingOutput.resourceType } : null }; }
    restoreState(data) {
        super.restoreState(data); this.timer = data.timer ?? 0;
        this.inputItem = data.inputItem ? itemPool.acquire(this.tileX, this.tileY, data.inputItem.resourceType) : null;
        this.pendingOutput = data.pendingOutput ? itemPool.acquire(this.tileX, this.tileY, data.pendingOutput.resourceType) : null;
    }
}

export class Crusher extends Processor { constructor(x, y, r) { super(x, y, 'crusher', r); } }
export class Washer extends Processor { constructor(x, y, r) { super(x, y, 'washer', r); } }

/** 여러 재료를 받아 선택된 조립 레시피의 완제품으로 바꾸는 건물. */
export class Assembler extends Building {
    constructor(tileX, tileY, rotation) {
        super(tileX, tileY, 'assembler', rotation);
        this.recipeIndex = 0;
        this.inputCounts = {};
        this.timer = 0;
        this.pendingOutput = null;
    }

    get recipe() { return CONFIG.ASSEMBLY_RECIPES[this.recipeIndex]; }
    isPowerNode() { return true; }
    getPowerDemand() { return CONFIG.POWER.FURNACE_DEMAND; }
    canAcceptItem(item) { return Boolean(this.recipe.inputs[item.resourceType]); }
    acceptItem(item) { this.inputCounts[item.resourceType] = (this.inputCounts[item.resourceType] ?? 0) + 1; itemPool.release(item); }
    hasIngredients() { return Object.entries(this.recipe.inputs).every(([id, count]) => (this.inputCounts[id] ?? 0) >= count); }
    isBlocked() { return this.pendingOutput !== null; }
    update(dt, world) {
        if (this.pendingOutput) {
            if (tryDeliverItem(world, this.tileX, this.tileY, this.rotation, this.pendingOutput)) this.pendingOutput = null;
            return;
        }
        if (!this.hasIngredients()) return;
        this.timer += dt * this.powerRatio * this.getSpeedMultiplier();
        if (this.timer < CONFIG.PRODUCTION.PROCESSOR_INTERVAL) return;
        for (const [id, count] of Object.entries(this.recipe.inputs)) this.inputCounts[id] -= count;
        this.pendingOutput = itemPool.acquire(this.tileX, this.tileY, this.recipe.output);
        world.stats.recordProduced(this.recipe.output);
        this.timer = 0;
    }
    cycleRecipe() { this.recipeIndex = (this.recipeIndex + 1) % CONFIG.ASSEMBLY_RECIPES.length; this.timer = 0; }
    getInspectorInfo() {
        const info = super.getInspectorInfo();
        const materials = Object.entries(this.recipe.inputs).map(([id, count]) => `${ResourceRegistry.getDefinition(id)?.label ?? id} ${this.inputCounts[id] ?? 0}/${count}`).join(', ');
        info.push({ label: '레시피', value: `${this.recipe.label} (선택 후 F 키)` });
        info.push({ label: '재료', value: materials });
        info.push({ label: '상태', value: this.pendingOutput ? '배출 대기' : this.hasIngredients() ? '조립 중' : '재료 대기' });
        return info;
    }
    serialize() { return { ...super.serialize(), recipeIndex: this.recipeIndex, inputCounts: { ...this.inputCounts }, timer: this.timer, pendingOutput: this.pendingOutput ? { resourceType: this.pendingOutput.resourceType } : null }; }
    restoreState(data) {
        super.restoreState(data); this.recipeIndex = data.recipeIndex ?? 0; this.inputCounts = { ...(data.inputCounts ?? {}) }; this.timer = data.timer ?? 0;
        this.pendingOutput = data.pendingOutput ? itemPool.acquire(this.tileX, this.tileY, data.pendingOutput.resourceType) : null;
    }
}

const BUILDING_CLASSES = {
    miner: MinerT1,
    miner_t2: MinerT2,
    miner_t3: MinerT3,
    conveyor: ConveyorT1,
    conveyor_t2: ConveyorT2,
    conveyor_t3: ConveyorT3,
    storage: Storage,
    furnace: Furnace,
    seller: Seller,
    contract_office: ContractOffice,
    generator: GeneratorT1,
    generator_t2: GeneratorT2,
    generator_t3: GeneratorT3,
    wire: PowerWire,
    lab: Lab,
    inserter: Inserter,
    splitter: Splitter,
    merger: Merger,
    crusher: Crusher,
    washer: Washer,
    assembler: Assembler,
};
