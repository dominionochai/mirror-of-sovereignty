import type { CalibrationSample, GazeCalibration } from "./calibration";
import type { OpenCv } from "./opencvVision";

/** A homography needs four point pairs; the app collects five. */
const MIN_SAMPLES = 4;
/** Projective weights below this are numerically meaningless. */
const MIN_WEIGHT = 1e-9;

/**
 * Calibration with a projective transform fitted by OpenCV's `findHomography`.
 * An eye looking at a flat screen follows a perspective relationship, which
 * an affine fit can only approximate, so corners of the screen come out more
 * accurate.
 */
export class HomographyCalibration implements GazeCalibration {
  private samples: CalibrationSample[] = [];
  private h: Float64Array | null = null;

  constructor(private readonly cv: OpenCv) {}

  addSample(sample: CalibrationSample) {
    this.samples.push(sample);
    this.h = this.samples.length >= MIN_SAMPLES ? this.fit() : null;
  }

  apply(irisX: number, irisY: number): { x: number; y: number } | null {
    const h = this.h;
    if (!h) return null;
    const w = h[6] * irisX + h[7] * irisY + h[8];
    if (Math.abs(w) < MIN_WEIGHT) return null;
    return {
      x: (h[0] * irisX + h[1] * irisY + h[2]) / w,
      y: (h[3] * irisX + h[4] * irisY + h[5]) / w,
    };
  }

  get sampleCount() {
    return this.samples.length;
  }

  get isReady() {
    return this.h !== null;
  }

  reset() {
    this.samples = [];
    this.h = null;
  }

  private fit(): Float64Array | null {
    const { cv } = this;
    const source = cv.matFromArray(this.samples.length, 1, cv.CV_64FC2, this.samples.flatMap((s) => [s.irisX, s.irisY]));
    const target = cv.matFromArray(this.samples.length, 1, cv.CV_64FC2, this.samples.flatMap((s) => [s.screenX, s.screenY]));
    let homography: { data64F: Float64Array; rows: number; cols: number; delete: () => void } | null = null;
    try {
      homography = cv.findHomography(source, target, 0);
      if (!homography || homography.rows !== 3 || homography.cols !== 3) return null;
      const values = Float64Array.from(homography.data64F);
      return values.every(Number.isFinite) ? values : null;
    } catch {
      return null;
    } finally {
      homography?.delete();
      source.delete();
      target.delete();
    }
  }
}
