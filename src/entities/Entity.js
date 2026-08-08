/**
 * src/entities/Entity.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Entity, Item
 * (향후 Player 클래스도 실제로 필요해지는 시점에 이 파일에 추가된다.)
 *
 * 모든 게임 내 오브젝트(건물, 아이템 등)의 최소 공통 기반.
 * 타일 좌표(tileX, tileY) 기준으로 위치를 갖는다.
 * ------------------------------------------------------------------
 */

export class Entity {
    /**
     * @param {number} tileX
     * @param {number} tileY
     */
    constructor(tileX, tileY) {
        this.tileX = tileX;
        this.tileY = tileY;
    }

    /**
     * 고정 타임스텝 업데이트. 하위 클래스가 필요할 때 override한다.
     * @param {number} dt
     */
    update(dt) {
        void dt;
    }
}

/**
 * 컨베이어를 따라 흐르는 개별 아이템.
 * 현재 위치한 타일(tileX, tileY)과, 그 타일 안에서의 진행도(progress:
 * 0=진입 가장자리, 1=배출 가장자리)로 위치를 표현한다.
 */
export class Item extends Entity {
    /**
     * @param {number} tileX
     * @param {number} tileY
     * @param {string} resourceType src/resources/Resources.js의 ResourceType 값
     */
    constructor(tileX, tileY, resourceType) {
        super(tileX, tileY);
        this.resourceType = resourceType;
        this.progress = 0;

        // 렌더링 보간(부드러운 이동)을 위한 실제 픽셀 좌표.
        // 매 고정 타임스텝마다 소유 건물(Conveyor)이 이 값을 갱신한다.
        this.worldX = 0;
        this.worldY = 0;
        this.prevWorldX = 0;
        this.prevWorldY = 0;

        // 현재 칸에 실제로 어느 방향에서 들어왔는지 (Direction 값).
        // 코너(꺾이는 컨베이어)에서 진입/배출 방향이 다를 때 올바른 경로를
        // 그리기 위해 필요하다. Conveyor.acceptItem()이 매번 갱신한다.
        this.entryDirection = null;
    }
}