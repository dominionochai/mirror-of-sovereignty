import type { EyeOutline } from "./gazeContext";
import { findGlint, fitPupilEllipse, type OpenCv } from "./opencvVision";

/** Side of the iris-centred crop, as a fraction of the eye's width. */
const IRIS_CROP_RATIO = 0.55;
const MIN_CROP_PX = 12;

/** A pupil ellipse in coordinates normalised to the camera frame (0-1), plus its tilt. */
export interface NormalizedEllipse {
  cx: number;
  cy: number;
  /** Semi-axes as fractions of the frame width. */
  rx: number;
  ry: number;
  /** Degrees, clockwise in image coordinates. */
  angleDeg: number;
}

/** What OpenCV found in one eye. Positions are normalised to the camera frame (0-1). */
export interface EyeFit {
  pupil: NormalizedEllipse;
  /** The corneal glint, when the light source is visible on this eye. */
  glint: { x: number; y: number } | null;
}

/** Reusable offscreen canvas so crops don't allocate every frame. */
export interface CropScratch {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

export function createCropScratch(): CropScratch | null {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  return context ? { canvas, context } : null;
}

/**
 * Fits a pupil ellipse and finds the corneal glint in an iris-centred crop of each eye, reading pixels
 * from the (unmirrored) camera video. Eyes whose crop leaves the frame, or in
 * which no pupil is found, are skipped.
 */
export function fitEyePupils(
  cv: OpenCv,
  video: HTMLVideoElement,
  eyes: readonly EyeOutline[],
  scratch: CropScratch,
): EyeFit[] {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return [];

  const fitted: EyeFit[] = [];
  for (const eye of eyes) {
    const xs = eye.contour.map((point) => point.x * width);
    const eyeWidth = Math.max(...xs) - Math.min(...xs);
    const side = Math.max(MIN_CROP_PX, Math.round(eyeWidth * IRIS_CROP_RATIO));
    const left = Math.round(eye.iris.x * width - side / 2);
    const top = Math.round(eye.iris.y * height - side / 2);
    if (left < 0 || top < 0 || left + side > width || top + side > height) continue;

    scratch.canvas.width = side;
    scratch.canvas.height = side;
    scratch.context.drawImage(video, left, top, side, side, 0, 0, side, side);
    const pupil = fitPupilEllipse(cv, scratch.canvas);
    if (!pupil) continue;

    const glint = findGlint(cv, scratch.canvas);
    fitted.push({
      pupil: {
        cx: (left + pupil.cx) / width,
        cy: (top + pupil.cy) / height,
        rx: pupil.width / 2 / width,
        ry: pupil.height / 2 / width,
        angleDeg: pupil.angleDeg,
      },
      glint: glint ? { x: (left + glint.cx) / width, y: (top + glint.cy) / height } : null,
    });
  }
  return fitted;
}
