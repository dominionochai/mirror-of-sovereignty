// MediaPipe FaceLandmarker produces 478 landmarks (468 base + 10 iris)
// Landmark indices reference: https://developers.google.com/mediapipe/solutions/vision/face_landmarker

export interface NormalizedLandmark {
  x: number;  // 0-1 in image space, left→right
  y: number;  // 0-1 in image space, top→bottom
  z: number;
}

// ── Iris landmark indices ─────────────────────────────────────────────────────
// MediaPipe outputs iris centers at 468 (left eye) and 473 (right eye)
export const IRIS_LEFT  = 468; // person's LEFT eye
export const IRIS_RIGHT = 473; // person's RIGHT eye

// ── Eye corner landmarks for relative iris position ───────────────────────────
// Using these lets us remove the effect of face position in the frame
// so only gaze direction is encoded in the ratio.
export const LEFT_EYE_INNER  = 133; // medial canthus (nose side)
export const LEFT_EYE_OUTER  = 33;  // lateral canthus (ear side)
export const RIGHT_EYE_INNER = 362;
export const RIGHT_EYE_OUTER = 263;

// ── EAR (Eye Aspect Ratio) landmark indices ───────────────────────────────────
// EAR = (|P2-P6| + |P3-P5|) / (2 * |P1-P4|)
// Open eye ≈ 0.30  |  Closed eye ≈ 0.10
export const LEFT_EAR_IDX  = [33, 160, 158, 133, 153, 144];
export const RIGHT_EAR_IDX = [263, 387, 385, 362, 380, 374];

/**
 * Compute raw (normalized) gaze direction from iris landmarks.
 *
 * Returns values in the range [0, 1] where:
 *   x: 0 = screen LEFT  (after camera-mirror compensation)
 *   y: 0 = screen TOP
 *
 * The camera in `facingMode:'user'` captures the scene such that the
 * user's right side appears on the RIGHT of the raw pixel frame.
 * When the user looks LEFT on screen, their irises move RIGHT in the image.
 * So we flip x: gaze_x = 1 - iris_x.
 */
export function estimateRawGaze(
  lm: NormalizedLandmark[]
): { x: number; y: number } | null {
  const li = lm[IRIS_LEFT];
  const ri = lm[IRIS_RIGHT];
  if (!li || !ri) return null;

  // Use iris position relative to eye socket to decouple head movement from gaze
  const lio = lm[LEFT_EYE_OUTER];
  const lii = lm[LEFT_EYE_INNER];
  const rio = lm[RIGHT_EYE_OUTER];
  const rii = lm[RIGHT_EYE_INNER];

  let gazeX: number;
  let gazeY: number;

  if (lio && lii && rio && rii) {
    // Iris ratio within eye socket: 0 = outer corner, 1 = inner corner
    const leftSpan  = Math.abs(lio.x - lii.x) || 0.001;
    const rightSpan = Math.abs(rio.x - rii.x) || 0.001;

    const leftRatio  = (li.x - Math.min(lio.x, lii.x)) / leftSpan;
    const rightRatio = (ri.x - Math.min(rio.x, rii.x)) / rightSpan;
    const avgRatio   = (leftRatio + rightRatio) / 2;

    // Clamp to [0,1] and flip so left-look → small x
    gazeX = 1 - Math.max(0, Math.min(1, avgRatio));
  } else {
    // Fallback: raw iris average with mirror flip
    gazeX = 1 - (li.x + ri.x) / 2;
  }

  // Y: average of both iris centers (no flip needed)
  gazeY = (li.y + ri.y) / 2;

  return { x: gazeX, y: gazeY };
}
