import type { OpenCv } from "./opencvVision";

/** MediaPipe face-mesh indices of the six landmarks used for pose, in the order of {@link MODEL_POINTS}. */
export const POSE_LANDMARKS = [1, 152, 33, 263, 61, 291] as const; // nose tip, chin, eye outer corners, mouth corners

/**
 * A generic head in millimetres, in image-style axes (x right, y down, z away
 * from the camera) with the nose tip at the origin. With the identity pose the
 * head faces the camera.
 */
const MODEL_POINTS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],          // nose tip
  [0, 63.6, 12.5],    // chin
  [-43.3, -32.7, 26], // eye outer corner, image-left
  [43.3, -32.7, 26],  // eye outer corner, image-right
  [-28.9, 28.9, 24.1], // mouth corner, image-left
  [28.9, 28.9, 24.1],  // mouth corner, image-right
];

/** Distance between the two eye-corner points in the model, used to guess how far away the face is. */
const EYE_SPAN_MM = 86.6;
/** Used when the eyes are too close together in the image to estimate distance. */
const DEFAULT_DISTANCE_MM = 600;

/** Length of the drawn axes in model millimetres. */
const AXIS_LENGTH_MM = 80;

export interface Point2 {
  x: number;
  y: number;
}

export interface HeadPose {
  /** Degrees. Positive yaw: face turned toward the image's right. */
  yaw: number;
  /** Degrees. Positive pitch: face tilted up. */
  pitch: number;
  /** Degrees. Positive roll: head tilted clockwise in the image. */
  roll: number;
  /** Pixel positions, in the image the landmarks were measured on. */
  axes: { origin: Point2; x: Point2; y: Point2; z: Point2 };
}

const toDegrees = (radians: number) => (radians * 180) / Math.PI;

/**
 * Estimates head pose from six face landmarks with OpenCV's `solvePnP`.
 *
 * @param imagePoints Pixel positions of the {@link POSE_LANDMARKS}, in order.
 * @param width Image width in pixels (the focal length is approximated by it).
 * @param height Image height in pixels.
 * @returns The pose, or null if OpenCV could not solve it.
 */
export function estimateHeadPose(cv: OpenCv, imagePoints: Point2[], width: number, height: number): HeadPose | null {
  if (imagePoints.length !== MODEL_POINTS.length) return null;

  const owned: Array<{ delete: () => void }> = [];
  const own = <T extends { delete: () => void }>(mat: T): T => {
    owned.push(mat);
    return mat;
  };

  try {
    const objectPoints = own(cv.matFromArray(MODEL_POINTS.length, 3, cv.CV_64F, MODEL_POINTS.flat()));
    const imagePointsMat = own(cv.matFromArray(imagePoints.length, 2, cv.CV_64F, imagePoints.flatMap((p) => [p.x, p.y])));
    const focal = width;
    const camera = own(cv.matFromArray(3, 3, cv.CV_64F, [focal, 0, width / 2, 0, focal, height / 2, 0, 0, 1]));
    const distortion = own(cv.Mat.zeros(4, 1, cv.CV_64F));
    // Six near-planar points have two mirror-image solutions, and from a blind start the solver can pick the
    // flipped one (head upside down). Start from a frontal face at the distance the eye spacing implies instead.
    const eyeSpanPx = Math.hypot(imagePoints[2].x - imagePoints[3].x, imagePoints[2].y - imagePoints[3].y);
    const distance = eyeSpanPx > 1 ? (focal * EYE_SPAN_MM) / eyeSpanPx : DEFAULT_DISTANCE_MM;
    const nose = imagePoints[0];
    const rvec = own(cv.Mat.zeros(3, 1, cv.CV_64F));
    const tvec = own(cv.matFromArray(3, 1, cv.CV_64F, [((nose.x - width / 2) * distance) / focal, ((nose.y - height / 2) * distance) / focal, distance]));

    if (!cv.solvePnP(objectPoints, imagePointsMat, camera, distortion, rvec, tvec, true, cv.SOLVEPNP_ITERATIVE)) {
      return null;
    }

    const rotation = own(new cv.Mat());
    cv.Rodrigues(rvec, rotation);
    const r = rotation.data64F;

    // Where the head's forward (toward-camera, -z) and right (+x) directions point in the camera frame.
    const forward = { x: -r[2], y: -r[5], z: -r[8] };
    const right = { x: r[0], y: r[3] };
    const yaw = toDegrees(Math.atan2(forward.x, -forward.z));
    const pitch = toDegrees(Math.atan2(-forward.y, Math.hypot(forward.x, forward.z)));
    const roll = toDegrees(Math.atan2(right.y, right.x));

    // Project the head's axes (y drawn upward, z drawn toward the viewer) for the overlay.
    const axisPoints = own(cv.matFromArray(4, 3, cv.CV_64F, [
      0, 0, 0,
      AXIS_LENGTH_MM, 0, 0,
      0, -AXIS_LENGTH_MM, 0,
      0, 0, -AXIS_LENGTH_MM,
    ]));
    const projected = own(new cv.Mat());
    cv.projectPoints(axisPoints, rvec, tvec, camera, distortion, projected);
    const p = projected.data64F;
    const at = (i: number): Point2 => ({ x: p[2 * i], y: p[2 * i + 1] });

    return { yaw, pitch, roll, axes: { origin: at(0), x: at(1), y: at(2), z: at(3) } };
  } finally {
    for (let i = owned.length - 1; i >= 0; i -= 1) owned[i].delete();
  }
}
