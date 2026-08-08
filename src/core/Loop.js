/**
 * src/core/Loop.js
 * ------------------------------------------------------------------
 * 이 파일에 포함된 클래스: Loop
 *
 * 고정 타임스텝(fixed timestep) 방식의 게임 루프.
 * - update(dt)는 항상 동일한 dt(1/TICK_RATE)로 호출되어 시뮬레이션의
 *   재현성/정확성을 보장한다.
 * - render(alpha)는 매 프레임(가변 주기)마다 호출되며, alpha는
 *   다음 시뮬레이션 스텝까지의 보간 비율(0~1)이다.
 * ------------------------------------------------------------------
 */

import { CONFIG } from '../../config.js';
import { Logger } from '../utils/Utils.js';

export class Loop {
    /** requestAnimationFrame에 전달할 #tick의 바인딩된 참조 */
    #boundTick;

    /**
     * @param {(dt: number) => void} onUpdate 고정 dt로 호출되는 시뮬레이션 업데이트
     * @param {(alpha: number) => void} onRender 매 프레임 호출되는 렌더 콜백
     */
    constructor(onUpdate, onRender) {
        this.onUpdate = onUpdate;
        this.onRender = onRender;

        this.fixedDt = 1 / CONFIG.LOOP.TICK_RATE;
        this.accumulator = 0;
        this.lastTime = 0;
        this.isRunning = false;
        this.rafHandle = null;

        // FPS 계측
        this.fpsFrameCount = 0;
        this.fpsElapsed = 0;
        this.currentFps = 0;

        // private 메서드(#tick)는 재할당이 불가능하므로,
        // bind된 결과를 별도의 필드에 보관한다.
        this.#boundTick = this.#tick.bind(this);
    }

    start() {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTime = performance.now() / 1000; // 이후 계산과 동일하게 '초' 단위로 통일
        this.rafHandle = requestAnimationFrame(this.#boundTick);
        Logger.info('게임 루프 시작');
    }

    stop() {
        this.isRunning = false;
        if (this.rafHandle !== null) {
            cancelAnimationFrame(this.rafHandle);
            this.rafHandle = null;
        }
        Logger.info('게임 루프 정지');
    }

    /**
     * @param {number} nowMs performance.now() 기준 현재 시각(ms)
     */
    #tick(nowMs) {
        if (!this.isRunning) return;

        const now = nowMs / 1000;
        let frameTime = now - this.lastTime;
        this.lastTime = now;

        // 탭 비활성/디버깅 등으로 frameTime이 비정상적으로 커지는 것을 방지
        if (frameTime > CONFIG.LOOP.MAX_ACCUMULATED_TIME) {
            frameTime = CONFIG.LOOP.MAX_ACCUMULATED_TIME;
        }

        this.accumulator += frameTime;

        // 고정 타임스텝만큼 쌓였을 때 update를 여러 번 실행할 수 있음
        try {
            while (this.accumulator >= this.fixedDt) {
                this.onUpdate(this.fixedDt);
                this.accumulator -= this.fixedDt;
            }
        } catch (err) {
            Logger.error('update 단계에서 예외 발생, 루프를 정지합니다.', err);
            this.stop();
            return;
        }

        const alpha = this.accumulator / this.fixedDt;

        try {
            this.onRender(alpha);
        } catch (err) {
            Logger.error('render 단계에서 예외 발생, 루프를 정지합니다.', err);
            this.stop();
            return;
        }

        this.#updateFpsCounter(frameTime);

        this.rafHandle = requestAnimationFrame(this.#boundTick);
    }

    #updateFpsCounter(frameTime) {
        this.fpsFrameCount++;
        this.fpsElapsed += frameTime;

        if (this.fpsElapsed >= CONFIG.LOOP.FPS_SAMPLE_INTERVAL) {
            this.currentFps = Math.round(this.fpsFrameCount / this.fpsElapsed);
            this.fpsFrameCount = 0;
            this.fpsElapsed = 0;
        }
    }

    getFps() {
        return this.currentFps;
    }
}