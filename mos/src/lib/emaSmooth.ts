/**
 * Exponential Moving Average smoother for 2D gaze coordinates.
 *
 * EMA formula: smoothed = α * current + (1-α) * previous
 *
 * α = 1   → no smoothing (raw values)
 * α = 0   → completely frozen
 * α = 0.12 → gentle smoothing with ~80ms lag at 60fps (good default)
 *
 * A smaller α reduces jitter but increases perceived lag.
 * Calibrated users may prefer α = 0.15-0.20.
 */
/** What the gaze pipeline needs from a smoother. */
export interface GazeSmoother {
  update(x: number, y: number): { x: number; y: number };
  reset(): void;
}

export class EMASmooth implements GazeSmoother {
  private alpha: number;
  private x: number | null = null;
  private y: number | null = null;

  constructor(alpha = 0.12) {
    this.alpha = alpha;
  }

  update(x: number, y: number): { x: number; y: number } {
    if (this.x === null || this.y === null) {
      this.x = x;
      this.y = y;
      return { x, y };
    }

    this.x = this.alpha * x + (1 - this.alpha) * this.x;
    this.y = this.alpha * y + (1 - this.alpha) * this.y;

    return { x: this.x, y: this.y };
  }

  /** Set α at runtime (useful for a sensitivity slider) */
  setAlpha(alpha: number) {
    this.alpha = Math.max(0.01, Math.min(1, alpha));
  }

  reset() {
    this.x = null;
    this.y = null;
  }
}
