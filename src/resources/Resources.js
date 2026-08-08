/**
 * src/resources/Resources.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 것: ResourceType, RESOURCE_DEFINITIONS, ResourceRegistry
 *
 * 초기 콘텐츠로 철광석/구리광석/석탄 세 종류를 정의해둔다.
 * Phase 3에서는 채굴기가 철광석만 생산하지만, 나머지 자원은 Phase 4
 * (용광로 제련 레시피)부터 실제로 쓰이기 시작한다.
 * ------------------------------------------------------------------
 */

/** 자원 종류 식별자. */
export const ResourceType = Object.freeze({
    IRON_ORE: 'iron_ore',
    COPPER_ORE: 'copper_ore',
    COAL: 'coal',
    IRON_INGOT: 'iron_ingot',
    COPPER_INGOT: 'copper_ingot',
    IRON_POWDER: 'iron_powder',
    COPPER_POWDER: 'copper_powder',
    WASHED_IRON_ORE: 'washed_iron_ore',
    WASHED_COPPER_ORE: 'washed_copper_ore',
    GEAR: 'gear',
    MOTOR: 'motor',
    CIRCUIT: 'circuit',
    GOLD_ORE: 'gold_ore',
    TITANIUM_ORE: 'titanium_ore',
    RARE_CRYSTAL: 'rare_crystal',
    GOLD_INGOT: 'gold_ingot',
    TITANIUM_INGOT: 'titanium_ingot',
    GOLD_POWDER: 'gold_powder',
    TITANIUM_POWDER: 'titanium_powder',
    WASHED_GOLD_ORE: 'washed_gold_ore',
    WASHED_TITANIUM_ORE: 'washed_titanium_ore',
    ALLOY_FRAME: 'alloy_frame',
    PRECISION_CIRCUIT: 'precision_circuit',
    POWER_CORE: 'power_core',
});

/** 자원별 표시 정보 (이름, 아이템 렌더링 색상). */
const RESOURCE_DEFINITIONS = {
    [ResourceType.IRON_ORE]: { id: ResourceType.IRON_ORE, label: '철광석', color: '#c98a5b' },
    [ResourceType.COPPER_ORE]: { id: ResourceType.COPPER_ORE, label: '구리광석', color: '#e08a4c' },
    [ResourceType.COAL]: { id: ResourceType.COAL, label: '석탄', color: '#5c5c5c' },
    [ResourceType.IRON_INGOT]: { id: ResourceType.IRON_INGOT, label: '철괴', color: '#d8dee6' },
    [ResourceType.COPPER_INGOT]: { id: ResourceType.COPPER_INGOT, label: '구리괴', color: '#e8935a' },
    [ResourceType.IRON_POWDER]: { id: ResourceType.IRON_POWDER, label: '철가루', color: '#b7a18b' },
    [ResourceType.COPPER_POWDER]: { id: ResourceType.COPPER_POWDER, label: '구리가루', color: '#c87d4f' },
    [ResourceType.WASHED_IRON_ORE]: { id: ResourceType.WASHED_IRON_ORE, label: '세척 철광석', color: '#d3b18a' },
    [ResourceType.WASHED_COPPER_ORE]: { id: ResourceType.WASHED_COPPER_ORE, label: '세척 구리광석', color: '#f0ad70' },
    [ResourceType.GEAR]: { id: ResourceType.GEAR, label: '기어', color: '#9ca8b4' },
    [ResourceType.MOTOR]: { id: ResourceType.MOTOR, label: '모터', color: '#668bc4' },
    [ResourceType.CIRCUIT]: { id: ResourceType.CIRCUIT, label: '회로', color: '#67c78b' },
    [ResourceType.GOLD_ORE]: { id: ResourceType.GOLD_ORE, label: '금광석', color: '#f0c419' },
    [ResourceType.TITANIUM_ORE]: { id: ResourceType.TITANIUM_ORE, label: '티타늄광석', color: '#9fb4bd' },
    [ResourceType.RARE_CRYSTAL]: { id: ResourceType.RARE_CRYSTAL, label: '희귀 결정', color: '#c77dff' },
    [ResourceType.GOLD_INGOT]: { id: ResourceType.GOLD_INGOT, label: '금괴', color: '#e8c547' },
    [ResourceType.TITANIUM_INGOT]: { id: ResourceType.TITANIUM_INGOT, label: '티타늄괴', color: '#c7d8de' },
    [ResourceType.GOLD_POWDER]: { id: ResourceType.GOLD_POWDER, label: '금가루', color: '#f5d97a' },
    [ResourceType.TITANIUM_POWDER]: { id: ResourceType.TITANIUM_POWDER, label: '티타늄가루', color: '#b3c2c9' },
    [ResourceType.WASHED_GOLD_ORE]: { id: ResourceType.WASHED_GOLD_ORE, label: '세척 금광석', color: '#f7dc6f' },
    [ResourceType.WASHED_TITANIUM_ORE]: { id: ResourceType.WASHED_TITANIUM_ORE, label: '세척 티타늄광석', color: '#a8bcc4' },
    [ResourceType.ALLOY_FRAME]: { id: ResourceType.ALLOY_FRAME, label: '합금 프레임', color: '#7d98a1' },
    [ResourceType.PRECISION_CIRCUIT]: { id: ResourceType.PRECISION_CIRCUIT, label: '정밀 회로', color: '#8ee6a8' },
    [ResourceType.POWER_CORE]: { id: ResourceType.POWER_CORE, label: '동력 코어', color: '#e879f9' },
};

export class ResourceRegistry {
    /**
     * @param {string} resourceType
     * @returns {{id: string, label: string, color: string} | undefined}
     */
    static getDefinition(resourceType) {
        return RESOURCE_DEFINITIONS[resourceType];
    }
}
