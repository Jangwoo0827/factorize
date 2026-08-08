/**
 * src/utils/Utils.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 것:
 *   - clamp      : 값을 [min, max] 범위로 제한하는 순수 함수.
 *   - lerp       : 선형 보간 함수.
 *   - ObjectPool : 객체 생성/폐기를 반복하는 대신 재사용하는 범용 풀.
 *   - Logger     : 콘솔 출력을 일관된 포맷/레벨로 감싸는 유틸리티.
 * ------------------------------------------------------------------
 */

/**
 * 값을 min~max 범위로 제한한다.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
}

/**
 * a와 b 사이를 t(0~1) 비율로 선형 보간한다.
 * 고정 타임스텝 업데이트 사이의 렌더링을 부드럽게 이어주는 데 사용한다.
 * @param {number} a
 * @param {number} b
 * @param {number} t
 * @returns {number}
 */
export function lerp(a, b, t) {
    return a + (b - a) * t;
}

/**
 * 범용 오브젝트 풀.
 * 자주 생성/폐기되는 객체(예: 컨베이어 위 아이템)를 매번 new로 만들지
 * 않고 재사용해서, GC(가비지 컬렉션) 압박과 할당 비용을 줄인다.
 *
 * factory()는 "빈 껍데기" 객체를 만드는 역할만 하고, 실제 초기값 설정은
 * 항상 reset()이 담당한다 (새로 만들었든 재사용했든 동일한 경로를 타므로
 * 초기화 누락 버그를 방지할 수 있다).
 */
export class ObjectPool {
    /**
     * @param {() => object} factory 빈 객체를 생성하는 함수 (풀이 비어있을 때만 호출됨)
     * @param {(obj: object, ...args: any[]) => void} reset 객체를 초기 상태로 되돌리는 함수
     */
    constructor(factory, reset) {
        this.factory = factory;
        this.reset = reset;
        /** @type {object[]} */
        this.pool = [];
    }

    /**
     * 풀에서 객체 하나를 꺼내(없으면 새로 만들어) 초기화한 뒤 반환한다.
     * @param {...any} args reset()에 그대로 전달된다.
     */
    acquire(...args) {
        const obj = this.pool.length > 0 ? this.pool.pop() : this.factory();
        this.reset(obj, ...args);
        return obj;
    }

    /**
     * 다 쓴 객체를 풀에 반납한다. 이후 acquire()가 이 객체를 재사용할 수 있다.
     * @param {object} obj
     */
    release(obj) {
        this.pool.push(obj);
    }

    /** 현재 풀에 대기 중인(재사용 가능한) 객체 수. 디버깅/검증용. */
    get size() {
        return this.pool.length;
    }
}

/**
 * Logger
 * 게임 전역에서 사용하는 로깅 클래스.
 * 콘솔 출력 포맷을 통일하고, 이후 화면 내 MiniLog와 연동할 수 있도록
 * 리스너 등록 구조를 갖춘다.
 */
export class Logger {
    static PREFIX = '[FACTORIZE]';

    /** MiniLog 등 UI가 로그를 구독할 수 있도록 리스너 목록 관리 */
    static #listeners = [];

    static onLog(callback) {
        if (typeof callback === 'function') {
            Logger.#listeners.push(callback);
        }
    }

    static #emit(level, message) {
        for (const listener of Logger.#listeners) {
            try {
                listener(level, message);
            } catch {
                // 리스너 내부 오류가 로깅 자체를 중단시키지 않도록 무시한다.
            }
        }
    }

    static info(message) {
        console.info(`${Logger.PREFIX} ${message}`);
        Logger.#emit('info', message);
    }

    static warn(message) {
        console.warn(`${Logger.PREFIX} ${message}`);
        Logger.#emit('warn', message);
    }

    static error(message, error) {
        if (error) {
            console.error(`${Logger.PREFIX} ${message}`, error);
        } else {
            console.error(`${Logger.PREFIX} ${message}`);
        }
        Logger.#emit('error', message);
    }
}