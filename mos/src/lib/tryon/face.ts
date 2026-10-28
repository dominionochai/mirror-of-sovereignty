/** Face points used to place overlays. All coordinates are fractions (0-1) of the unmirrored camera frame. */
export interface Point {
  x: number;
  y: number;
}

export interface FaceGeometry {
  /** Eye centres; `leftEye` is the one with the smaller x in the image. */
  leftEye: Point;
  rightEye: Point;
  mouth: { left: Point; right: Point; top: Point; bottom: Point };
  forehead: Point;
  chin: Point;
  /** Widest points of the face; `cheekLeft` has the smaller x. */
  cheekLeft: Point;
  cheekRight: Point;
}

/** A plausible face centred in a 4:3 frame, for when no landmarks are available. */
export const DEFAULT_FACE: FaceGeometry = {
  leftEye: { x: 0.4, y: 0.43 },
  rightEye: { x: 0.6, y: 0.43 },
  mouth: { left: { x: 0.43, y: 0.66 }, right: { x: 0.57, y: 0.66 }, top: { x: 0.5, y: 0.645 }, bottom: { x: 0.5, y: 0.685 } },
  forehead: { x: 0.5, y: 0.21 },
  chin: { x: 0.5, y: 0.83 },
  cheekLeft: { x: 0.3125, y: 0.52 },
  cheekRight: { x: 0.6875, y: 0.52 },
};

/** MediaPipe FaceLandmarker indices (the face mesh has 468 points, 478 with irises). */
const IDX = {
  eyeA: [33, 133, 159, 145],
  eyeB: [263, 362, 386, 374],
  mouthLeft: 61,
  mouthRight: 291,
  mouthTop: 0,
  mouthBottom: 17,
  forehead: 10,
  chin: 152,
  cheekA: 234,
  cheekB: 454,
};

const MIN_LANDMARKS = 468;

/** Builds geometry from interleaved x,y landmarks, or null when there is no usable face. */
export function faceFromLandmarks(landmarks: ArrayLike<number> | null | undefined): FaceGeometry | null {
  if (!landmarks || landmarks.length < MIN_LANDMARKS * 2) return null;
  const at = (index: number): Point => ({ x: landmarks[2 * index], y: landmarks[2 * index + 1] });
  const mean = (indices: number[]): Point => {
    const points = indices.map(at);
    return { x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length };
  };
  const byX = (a: Point, b: Point): [Point, Point] => (a.x <= b.x ? [a, b] : [b, a]);

  const [leftEye, rightEye] = byX(mean(IDX.eyeA), mean(IDX.eyeB));
  const [mouthLeft, mouthRight] = byX(at(IDX.mouthLeft), at(IDX.mouthRight));
  const [cheekLeft, cheekRight] = byX(at(IDX.cheekA), at(IDX.cheekB));
  const face: FaceGeometry = {
    leftEye,
    rightEye,
    mouth: { left: mouthLeft, right: mouthRight, top: at(IDX.mouthTop), bottom: at(IDX.mouthBottom) },
    forehead: at(IDX.forehead),
    chin: at(IDX.chin),
    cheekLeft,
    cheekRight,
  };
  // Reject degenerate meshes (all zeros, or a face squashed to a line).
  const eyeGap = rightEye.x - leftEye.x;
  return eyeGap > 0.02 && face.chin.y > face.forehead.y + 0.05 ? face : null;
}
