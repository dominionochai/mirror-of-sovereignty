import { NormalizedLandmark, LEFT_EAR_IDX, RIGHT_EAR_IDX } from './gazeEstimator';

// ── Tunable constants ─────────────────────────────────────────────────────────
const EAR_THRESHOLD  = 0.21; // below this → eye is closing
const MIN_BLINK_MS   = 80;   // ignore sub-80ms closures (noise / natural blink variability)
const MAX_BLINK_MS   = 500;  // ignore closures > 500ms (deliberate hold, not a click blink)

// ── Geometry helper ───────────────────────────────────────────────────────────
function dist(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Compute Eye Aspect Ratio for one eye.
 *  p1 ──── p4        (horizontal)
 *  p2    p3  p5 p6   (vertical pairs)
 *
 *  EAR = (|p2-p6| + |p3-p5|) / (2 * |p1-p4|)
 */
function computeEAR(
  lm: { x: number; y: number }[],
  idx: number[]
): number {
  const [p1, p2, p3, p4, p5, p6] = idx.map(i => lm[i]);
  if (!p1 || !p2 || !p3 || !p4 || !p5 || !p6) return 0.3;

  const horizontal = dist(p1, p4);
  if (horizontal < 1e-6) return 0.3;

  return (dist(p2, p6) + dist(p3, p5)) / (2 * horizontal);
}

// ── Blink state machine ───────────────────────────────────────────────────────
type BlinkState = 'open' | 'closing';

export class BlinkDetector {
  private state: BlinkState = 'open';
  private closeTime = 0;
  private readonly onBlink: () => void;
  private _isBlinking = false;

  constructor(onBlink: () => void) {
    this.onBlink = onBlink;
  }

  /**
   * Feed the latest face landmarks and get back whether the eyes are currently
   * considered closed. Fires onBlink() when a valid intentional blink completes.
   */
  update(lm: NormalizedLandmark[]): boolean {
    const leftEAR  = computeEAR(lm, LEFT_EAR_IDX);
    const rightEAR = computeEAR(lm, RIGHT_EAR_IDX);
    const avgEAR   = (leftEAR + rightEAR) / 2;
    const eyesClosed = avgEAR < EAR_THRESHOLD;
    const now = performance.now();

    switch (this.state) {
      case 'open':
        if (eyesClosed) {
          this.state    = 'closing';
          this.closeTime = now;
          this._isBlinking = true;
        }
        break;

      case 'closing':
        if (!eyesClosed) {
          const duration = now - this.closeTime;
          if (duration >= MIN_BLINK_MS && duration <= MAX_BLINK_MS) {
            this.onBlink();
          }
          this.state       = 'open';
          this._isBlinking = false;
        }
        break;
    }

    return this._isBlinking;
  }

  get isBlinking(): boolean {
    return this._isBlinking;
  }

  reset() {
    this.state       = 'open';
    this._isBlinking = false;
  }
}
