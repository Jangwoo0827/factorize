/**
 * src/rendering/Renderer.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Renderer, MinimapRenderer
 * (이후 TileRenderer / EntityRenderer / DebugRenderer 로직도
 *  이 파일 내부에 메서드 또는 클래스로 추가될 예정 - Phase 3+)
 *
 * 카메라가 보고 있는 영역의 타일/건물만 계산해서 그린다 (컬링).
 * 화면 밖 타일은 순회 대상에서 아예 제외되어 맵이 아무리 커도
 * 매 프레임 비용은 "화면에 보이는 타일 수"에만 비례한다.
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { Building, Conveyor, PowerWire, DIRECTION_VECTORS } from '../entities/Building.js';
import { ResourceRegistry } from '../resources/Resources.js';
import { lerp } from '../utils/Utils.js';

export class Renderer {
    // 배치 미리보기(고스트)를 그릴 때 실제 Building 인스턴스를 재사용해
    // 매 프레임 새 객체를 만들지 않는다 (간단한 객체 재사용/풀링).
    #ghostBuilding;

    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');

        if (!this.ctx) {
            throw new Error('2D 렌더링 컨텍스트를 가져올 수 없습니다.');
        }

        this.width = 0;
        this.height = 0;
        this.dpr = window.devicePixelRatio || 1;

        this.#ghostBuilding = new Building(0, 0, null, 0);
    }

    /**
     * 캔버스 픽셀 크기를 뷰포트/DPR에 맞게 재설정한다.
     * @param {number} cssWidth
     * @param {number} cssHeight
     */
    resize(cssWidth, cssHeight) {
        this.dpr = window.devicePixelRatio || 1;
        this.width = cssWidth;
        this.height = cssHeight;

        this.canvas.width = Math.round(cssWidth * this.dpr);
        this.canvas.height = Math.round(cssHeight * this.dpr);
        this.canvas.style.width = `${cssWidth}px`;
        this.canvas.style.height = `${cssHeight}px`;

        // 이후 모든 draw 호출은 CSS 픽셀 단위로 작성할 수 있도록 스케일 고정
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    /**
     * @param {import('../core/Camera.js').Camera} camera
     * @param {import('../world/World.js').World} world
     * @param {{tileX: number, tileY: number, typeId: string, rotation: number, isValid: boolean}
     *   | {tileX: number, tileY: number, typeId: string, rotation: number, isValid: boolean}[] | null} placementPreview
     *        현재 마우스가 가리키는 위치에 그릴 배치 미리보기(고스트). 블루프린트 붙여넣기 중이면
     *        배열(건물 여러 개)이 온다. 선택된 건물이 없으면 null.
     * @param {number} alpha 고정 타임스텝 사이의 보간 비율(0~1). 아이템이 프레임 사이에서
     *        매끄럽게 움직이는 것처럼 보이게 하는 데 사용한다.
     * @param {{tileX: number, tileY: number, width: number, height: number} | null} [selectionRect]
     *        블루프린트 영역을 드래그로 선택하는 중일 때 그릴 사각형.
     */
    render(camera, world, placementPreview = null, alpha = 1, selectionRect = null) {
        this.#drawBackground();
        this.#drawTiles(camera, world, alpha);
        this.#renderPowerPulses(camera, world);
        this.#drawOriginMarker(camera);

        if (selectionRect) {
            this.#drawSelectionRect(camera, selectionRect);
        }

        if (Array.isArray(placementPreview)) {
            for (const preview of placementPreview) {
                this.#drawGhost(camera, preview);
            }
        } else if (placementPreview) {
            this.#drawGhost(camera, placementPreview);
        }
    }

    #drawBackground() {
        const { ctx, width, height } = this;
        ctx.fillStyle = CONFIG.RENDER.BG_COLOR;
        ctx.fillRect(0, 0, width, height);
    }

    /**
     * 카메라의 가시 영역에 해당하는 타일과, 그 위에 놓인 건물을 그린다.
     * @param {import('../core/Camera.js').Camera} camera
     * @param {import('../world/World.js').World} world
     * @param {number} alpha
     */
    #drawTiles(camera, world, alpha) {
        const { ctx } = this;
        const tileSize = CONFIG.TILE.SIZE;
        const chunkSize = CONFIG.WORLD.CHUNK_SIZE;
        const bounds = camera.getVisibleWorldBounds();

        // 화면 가장자리에서 타일이 잘려 보이지 않도록 여유분 1칸을 더 계산한다.
        const startTileX = Math.floor(bounds.minX / tileSize) - 1;
        const endTileX = Math.ceil(bounds.maxX / tileSize) + 1;
        const startTileY = Math.floor(bounds.minY / tileSize) - 1;
        const endTileY = Math.ceil(bounds.maxY / tileSize) + 1;

        const screenTileSize = tileSize * camera.zoom;

        for (let tileY = startTileY; tileY <= endTileY; tileY++) {
            for (let tileX = startTileX; tileX <= endTileX; tileX++) {
                // 월드에서 이 타일이 속한 청크를 즉시 생성/조회한다.
                const tile = world.getTile(tileX, tileY);

                const worldX = tileX * tileSize;
                const worldY = tileY * tileSize;
                const screen = camera.worldToScreen(worldX, worldY);

                // 체크보드 패턴으로 타일 경계를 시각적으로 구분한다.
                ctx.fillStyle = ((tileX + tileY) % 2 === 0)
                    ? CONFIG.RENDER.TILE_COLOR_A
                    : CONFIG.RENDER.TILE_COLOR_B;

                // +0.5px 여유를 주어 인접 타일 사이에 미세한 흰 선(seam)이
                // 생기는 부동소수점 반올림 문제를 방지한다.
                ctx.fillRect(screen.x, screen.y, screenTileSize + 0.5, screenTileSize + 0.5);

                // 청크 경계선을 얇게 강조해 청크 단위를 눈으로 확인할 수 있게 한다.
                if (tileX % chunkSize === 0) {
                    ctx.fillStyle = CONFIG.RENDER.CHUNK_BORDER_COLOR;
                    ctx.fillRect(screen.x, screen.y, 1.5, screenTileSize + 0.5);
                }
                if (tileY % chunkSize === 0) {
                    ctx.fillStyle = CONFIG.RENDER.CHUNK_BORDER_COLOR;
                    ctx.fillRect(screen.x, screen.y, screenTileSize + 0.5, 1.5);
                }

                if (tile.building) {
                    const renderOptions = (tile.building instanceof PowerWire)
                        ? { connections: this.#computeWireConnections(world, tileX, tileY) }
                        : undefined;
                    tile.building.render(ctx, screen.x, screen.y, screenTileSize, renderOptions);

                    if (tile.building instanceof Conveyor) {
                        this.#drawConveyorItem(camera, tile.building, alpha);
                    }
                }
            }
        }
    }

    /**
     * 현재 선택된 건물을 마우스가 가리키는 타일 위에 반투명하게 미리 보여준다.
     * 배치 불가능한 위치(이미 건물이 있음)라면 빨간색으로 표시한다.
     * @param {import('../core/Camera.js').Camera} camera
     * @param {{tileX: number, tileY: number, typeId: string, rotation: number, isValid: boolean}} preview
     */
    #drawGhost(camera, preview) {
        const tileSize = CONFIG.TILE.SIZE;
        const screenTileSize = tileSize * camera.zoom;
        const screen = camera.worldToScreen(preview.tileX * tileSize, preview.tileY * tileSize);

        this.#ghostBuilding.typeId = preview.typeId;
        this.#ghostBuilding.rotation = preview.rotation;

        this.#ghostBuilding.render(this.ctx, screen.x, screen.y, screenTileSize, {
            alpha: CONFIG.RENDER.GHOST_VALID_ALPHA,
            colorOverride: preview.isValid ? undefined : CONFIG.RENDER.GHOST_INVALID_COLOR,
        });
    }

    /**
     * 블루프린트 영역을 드래그로 선택하는 중일 때, 시작 지점부터 현재
     * 커서까지의 사각형을 반투명하게 그려 어디까지 복사될지 보여준다.
     * @param {import('../core/Camera.js').Camera} camera
     * @param {{tileX: number, tileY: number, width: number, height: number}} rect
     */
    #drawSelectionRect(camera, rect) {
        const tileSize = CONFIG.TILE.SIZE;
        const screenTileSize = tileSize * camera.zoom;
        const screen = camera.worldToScreen(rect.tileX * tileSize, rect.tileY * tileSize);
        const w = rect.width * screenTileSize;
        const h = rect.height * screenTileSize;

        const { ctx } = this;
        ctx.save();
        ctx.fillStyle = 'rgba(94, 200, 216, 0.15)';
        ctx.strokeStyle = CONFIG.RENDER.ACCENT_CYAN;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.fillRect(screen.x, screen.y, w, h);
        ctx.strokeRect(screen.x, screen.y, w, h);
        ctx.restore();
    }

    /**
     * 컨베이어가 들고 있는 모든 아이템을, 고정 타임스텝 사이의 위치(prevWorld -> world)를
     * alpha로 보간한 지점에 작은 원으로 그린다. 이렇게 하면 시뮬레이션은 60Hz로
     * 고정되어 있어도 화면상 이동은 모니터 주사율에 맞춰 매끄럽게 보인다.
     * @param {import('../core/Camera.js').Camera} camera
     * @param {import('../entities/Building.js').Conveyor} conveyor
     * @param {number} alpha
     */
    #drawConveyorItem(camera, conveyor, alpha) {
        if (conveyor.items.length === 0) return;

        const { ctx } = this;
        const radius = CONFIG.TILE.SIZE * camera.zoom * 0.16;

        for (const item of conveyor.items) {
            const worldX = lerp(item.prevWorldX, item.worldX, alpha);
            const worldY = lerp(item.prevWorldY, item.worldY, alpha);
            const screen = camera.worldToScreen(worldX, worldY);

            const resourceDef = ResourceRegistry.getDefinition(item.resourceType);

            ctx.beginPath();
            ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
            ctx.fillStyle = resourceDef?.color ?? '#ffffff';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = CONFIG.RENDER.BUILDING_STROKE_COLOR;
            ctx.stroke();
        }
    }

    /**
     * 해당 타일의 전선이 상하좌우 중 어느 쪽으로 실제 연결되는지 계산한다.
     * 이웃 타일에 전력 건물(발전기/전선/채굴기 등)이 있으면 그 방향은 연결된 것으로 본다.
     * @param {import('../world/World.js').World} world
     * @param {number} tileX
     * @param {number} tileY
     */
    #computeWireConnections(world, tileX, tileY) {
        const isPowerNeighbor = (dx, dy) => {
            const neighbor = world.getBuildingAt(tileX + dx, tileY + dy);
            return Boolean(neighbor && neighbor.isPowerNode());
        };

        return {
            right: isPowerNeighbor(1, 0),
            down: isPowerNeighbor(0, 1),
            left: isPowerNeighbor(-1, 0),
            up: isPowerNeighbor(0, -1),
        };
    }

    /**
     * 전력이 통하는 두 건물 사이를 오가는 작은 발광 점을 그려, 아이템이 흐르듯
     * 전력도 흐르고 있다는 것을 시각적으로 보여준다. 실제 시뮬레이션 상태가
     * 아니라 순수 장식용 애니메이션이므로 world/building 데이터를 바꾸지 않는다.
     * @param {import('../core/Camera.js').Camera} camera
     * @param {import('../world/World.js').World} world
     */
    #renderPowerPulses(camera, world) {
        const tileSize = CONFIG.TILE.SIZE;
        const bounds = camera.getVisibleWorldBounds();
        // 시간 기반 진행도(0~1) - 프레임 속도와 무관하게 항상 같은 속도로 흐른다.
        const t = (performance.now() / 1000 * CONFIG.RENDER.POWER_PULSE_SPEED) % 1;

        const { ctx } = this;
        ctx.save();
        ctx.shadowColor = CONFIG.RENDER.ACCENT_AMBER;
        ctx.shadowBlur = 6;
        ctx.fillStyle = CONFIG.RENDER.ACCENT_AMBER;

        for (const building of world.getAllBuildings()) {
            if (!building.isPowerNode() || building.powerRatio <= 0) continue;

            const bx = building.tileX * tileSize + tileSize / 2;
            const by = building.tileY * tileSize + tileSize / 2;

            // 화면 밖 건물은 건너뛴다 (컬링).
            if (bx < bounds.minX - tileSize || bx > bounds.maxX + tileSize
                || by < bounds.minY - tileSize || by > bounds.maxY + tileSize) {
                continue;
            }

            for (const vec of DIRECTION_VECTORS) {
                // 각 간선을 두 번 그리지 않도록, 오른쪽/아래 방향일 때만 그린다
                // (왼쪽/위쪽 이웃과의 간선은 그 이웃 입장에서 오른쪽/아래로 그려진다).
                if (vec.x < 0 || vec.y < 0) continue;

                const neighbor = world.getBuildingAt(building.tileX + vec.x, building.tileY + vec.y);
                if (!neighbor || !neighbor.isPowerNode() || neighbor.powerRatio <= 0) continue;

                const nx = neighbor.tileX * tileSize + tileSize / 2;
                const ny = neighbor.tileY * tileSize + tileSize / 2;

                const pulseWorldX = lerp(bx, nx, t);
                const pulseWorldY = lerp(by, ny, t);
                const screen = camera.worldToScreen(pulseWorldX, pulseWorldY);
                const radius = tileSize * camera.zoom * 0.06;

                ctx.beginPath();
                ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        ctx.restore();
    }

    /** 월드 원점(0, 0)에 작은 십자 마커를 그려 방향 감각을 제공한다. */
    #drawOriginMarker(camera) {
        const { ctx } = this;
        const screen = camera.worldToScreen(0, 0);
        const size = 10;

        ctx.save();
        ctx.strokeStyle = CONFIG.RENDER.ORIGIN_MARKER_COLOR;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(screen.x - size, screen.y);
        ctx.lineTo(screen.x + size, screen.y);
        ctx.moveTo(screen.x, screen.y - size);
        ctx.lineTo(screen.x, screen.y + size);
        ctx.stroke();
        ctx.restore();
    }
}

/**
 * 우하단에 항상 떠 있는 작은 미니맵. 배치된 모든 건물 + 원점을 포함하는
 * 정사각형 영역을 미니맵 크기에 맞게 축소해서 점으로 찍고, 지금 메인
 * 카메라가 보고 있는 범위를 사각형으로 표시한다. 건물이 거의 없을 때
 * 지나치게 확대되지 않도록 최소 표시 반경(MIN_SPAN_TILES)을 둔다.
 * 청크 컬링을 쓰는 메인 렌더러와 달리, 미니맵은 "배치된 건물 수"에만
 * 비례하는 가벼운 순회라 매 프레임 다시 그려도 부담이 없다.
 */
export class MinimapRenderer {
    /** 건물이 거의 없을 때도 미니맵이 과도하게 확대되지 않도록 보장하는 최소 표시 반경(타일). */
    static MIN_SPAN_TILES = 40;
    /** 바운딩 박스 바깥으로 남겨두는 여백(타일). */
    static PADDING_TILES = 10;

    /**
     * @param {HTMLCanvasElement} canvas
     */
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.size = 160; // CSS px 기준 정사각형 한 변
        this.dpr = window.devicePixelRatio || 1;

        this.canvas.width = Math.round(this.size * this.dpr);
        this.canvas.height = Math.round(this.size * this.dpr);
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        /** 가장 최근에 그린 타일 좌표 바운딩 박스 - 클릭 좌표를 월드로 되돌릴 때 사용. */
        this.lastBounds = null;
    }

    /**
     * @param {import('../world/World.js').World} world
     * @param {import('../core/Camera.js').Camera} camera
     */
    render(world, camera) {
        if (!this.ctx) return;
        const { ctx, size } = this;
        const tileSize = CONFIG.TILE.SIZE;

        ctx.fillStyle = CONFIG.RENDER.BG_COLOR;
        ctx.fillRect(0, 0, size, size);

        const buildings = [...world.getAllBuildings()];
        const cameraTileX = camera.x / tileSize;
        const cameraTileY = camera.y / tileSize;

        // 카메라 위치를 항상 포함하는 바운딩 박스를 만들고, 건물이 있으면 전부 포함하도록 넓힌다.
        let minX = cameraTileX;
        let maxX = cameraTileX;
        let minY = cameraTileY;
        let maxY = cameraTileY;
        for (const building of buildings) {
            minX = Math.min(minX, building.tileX);
            maxX = Math.max(maxX, building.tileX);
            minY = Math.min(minY, building.tileY);
            maxY = Math.max(maxY, building.tileY);
        }

        minX -= MinimapRenderer.PADDING_TILES;
        maxX += MinimapRenderer.PADDING_TILES;
        minY -= MinimapRenderer.PADDING_TILES;
        maxY += MinimapRenderer.PADDING_TILES;

        // 정사각형 미니맵에 맞춰 더 긴 변을 기준으로 정사각형화하고,
        // 건물이 거의 없어도 너무 확대되지 않도록 최소 반경을 보장한다.
        const span = Math.max(maxX - minX, maxY - minY, MinimapRenderer.MIN_SPAN_TILES);
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        minX = centerX - span / 2;
        maxX = centerX + span / 2;
        minY = centerY - span / 2;
        maxY = centerY + span / 2;

        this.lastBounds = { minX, minY, maxX, maxY };
        const scale = size / span; // 미니맵 px / 타일

        const toMinimap = (tileX, tileY) => ({
            x: (tileX - minX) * scale,
            y: (tileY - minY) * scale,
        });

        for (const building of buildings) {
            const p = toMinimap(building.tileX + 0.5, building.tileY + 0.5);
            ctx.fillStyle = building.definition?.color ?? CONFIG.RENDER.ACCENT_CYAN;
            ctx.fillRect(p.x - 1.2, p.y - 1.2, 2.4, 2.4);
        }

        // 원점(0, 0) 마커 - 메인 화면의 십자 마커와 같은 의미.
        const origin = toMinimap(0, 0);
        ctx.strokeStyle = CONFIG.RENDER.ORIGIN_MARKER_COLOR;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(origin.x - 3, origin.y);
        ctx.lineTo(origin.x + 3, origin.y);
        ctx.moveTo(origin.x, origin.y - 3);
        ctx.lineTo(origin.x, origin.y + 3);
        ctx.stroke();

        // 현재 메인 카메라가 보고 있는 영역을 사각형으로 표시.
        const visible = camera.getVisibleWorldBounds();
        const viewTopLeft = toMinimap(visible.minX / tileSize, visible.minY / tileSize);
        const viewBottomRight = toMinimap(visible.maxX / tileSize, visible.maxY / tileSize);
        ctx.strokeStyle = CONFIG.RENDER.ACCENT_CYAN;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(
            viewTopLeft.x,
            viewTopLeft.y,
            viewBottomRight.x - viewTopLeft.x,
            viewBottomRight.y - viewTopLeft.y,
        );
    }

    /**
     * 미니맵 캔버스 안의 클릭 좌표(CSS px)를 월드 좌표로 변환한다.
     * 아직 한 번도 render()하지 않았으면 null.
     * @param {number} canvasX
     * @param {number} canvasY
     * @returns {{x: number, y: number} | null}
     */
    canvasToWorld(canvasX, canvasY) {
        if (!this.lastBounds) return null;
        const { minX, minY, maxX } = this.lastBounds;
        const scale = this.size / (maxX - minX);
        const tileSize = CONFIG.TILE.SIZE;
        return {
            x: (minX + canvasX / scale) * tileSize,
            y: (minY + canvasY / scale) * tileSize,
        };
    }
}