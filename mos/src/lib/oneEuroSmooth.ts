import type { GazeSmoother } from "./emaSmooth";

export interface OneEuroOptions {
  /** Cutoff (Hz) when the gaze is still: lower is steadier. */
  minCutoff?: number;
  /** How quickly the cutoff opens up with speed: higher follows saccades sooner. */
  beta?: number;
  /** Cutoff (Hz) for the speed estimate. */
  derivativeCutoff?: number;
  now?: () => number;
}

/** After a pause longer than this the filter restarts from the new sample. */
const MAX_GAP_S = 0.5;
const MIN_DT_S = 1 / 240;

const smoothingFactor = (cutoffHz: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dt);
};

class Axis {
  private x: number | null = null;
  private dx = 0;

  filter(value: number, dt: number, minCutoff: number, beta: number, derivativeCutoff: number): number {
    if (this.x === null) {
      this.x = value;
      return value;
    }
    const rawSpeed = (value - this.x) / dt;
    this.dx += smoothingFactor(derivativeCutoff, dt) * (rawSpeed - this.dx);
    const cutoff = minCutoff + beta * Math.abs(this.dx);
    this.x += smoothingFactor(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}

/**
 * The "1-Euro" adaptive low-pass filter for pointer and gaze data. It smooths
 * heavily while the eye fixates, which hides tracker jitter, and relaxes as the
 * eye speeds up, so saccades are followed with little lag. A fixed-weight
 * average has to trade one against the other.
 */
export class OneEuroSmooth implements GazeSmoother {
  private readonly axes = [new Axis(), new Axis()] as const;
  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly derivativeCutoff: number;
  private readonly now: () => number;
  private last: number | null = null;

  constructor({ minCutoff = 0.4, beta = 0.002, derivativeCutoff = 0.4, now = () => performance.now() }: OneEuroOptions = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.derivativeCutoff = derivativeCutoff;
    this.now = now;
  }

  update(x: number, y: number): { x: number; y: number } {
    const time = this.now();
    const gap = this.last === null ? Infinity : (time - this.last) / 1000;
    this.last = time;
    if (gap > MAX_GAP_S) this.reset(true);
    const dt = Math.max(gap === Infinity ? MIN_DT_S : gap, MIN_DT_S);
    return {
      x: this.axes[0].filter(x, dt, this.minCutoff, this.beta, this.derivativeCutoff),
      y: this.axes[1].filter(y, dt, this.minCutoff, this.beta, this.derivativeCutoff),
    };
  }

  reset(keepClock = false) {
    this.axes.forEach((axis) => axis.reset());
    if (!keepClock) this.last = null;
  }
}
