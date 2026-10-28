/**
 * Calibration system: maps raw iris ratios (0–1 normalized) to screen pixel
 * coordinates using a least-squares affine transform.
 *
 * Affine model:
 *   screenX = a·irisX + b·irisY + c
 *   screenY = d·irisX + e·irisY + f
 *
 * At least 3 non-collinear points are needed. We use 5 for robustness.
 */

export interface CalibrationSample {
  screenX: number;  // target in px
  screenY: number;
  irisX: number;    // raw gaze 0-1
  irisY: number;
}

// The 5 calibration targets (normalised screen fractions)
export const CALIBRATION_TARGETS = [
  { x: 0.1,  y: 0.1  }, // top-left
  { x: 0.9,  y: 0.1  }, // top-right
  { x: 0.5,  y: 0.5  }, // center
  { x: 0.1,  y: 0.9  }, // bottom-left
  { x: 0.9,  y: 0.9  }, // bottom-right
] as const;

type AffineCoeffs = { a: number; b: number; c: number };

/** Solve 3×3 linear system via Gaussian elimination; returns null if singular */
function solve3(M: number[][], rhs: number[]): number[] | null {
  // Build augmented matrix [M | rhs]
  const A = M.map((row, i) => [...row, rhs[i]]);
  const n = 3;

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(A[row][col]) > Math.abs(A[maxRow][col])) maxRow = row;
    }
    [A[col], A[maxRow]] = [A[maxRow], A[col]];

    if (Math.abs(A[col][col]) < 1e-10) return null; // singular

    for (let row = col + 1; row < n; row++) {
      const f = A[row][col] / A[col][col];
      for (let k = col; k <= n; k++) A[row][k] -= f * A[col][k];
    }
  }

  // Back-substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = A[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= A[i][j] * x[j];
    x[i] /= A[i][i];
  }
  return x;
}

/** Least-squares fit for screen_coord = a·ix + b·iy + c */
function fitAxis(samples: CalibrationSample[], axis: 'x' | 'y'): AffineCoeffs | null {
  // Normal equations: [Σix², Σix·iy, Σix; Σix·iy, Σiy², Σiy; Σix, Σiy, n] · [a,b,c]' = [Σix·s, Σiy·s, Σs]
  let six = 0, siy = 0, ss = 0;
  let sixx = 0, siyy = 0, sixy = 0;
  let sixs = 0, siys = 0;
  const n = samples.length;

  for (const sp of samples) {
    const s = axis === 'x' ? sp.screenX : sp.screenY;
    six  += sp.irisX;
    siy  += sp.irisY;
    ss   += s;
    sixx += sp.irisX * sp.irisX;
    siyy += sp.irisY * sp.irisY;
    sixy += sp.irisX * sp.irisY;
    sixs += sp.irisX * s;
    siys += sp.irisY * s;
  }

  const mat = [
    [sixx, sixy, six],
    [sixy, siyy, siy],
    [six,  siy,  n  ],
  ];
  const rhs = [sixs, siys, ss];

  const coeff = solve3(mat, rhs);
  if (!coeff) return null;
  return { a: coeff[0], b: coeff[1], c: coeff[2] };
}

/** What the gaze pipeline needs from a calibration model. */
export interface GazeCalibration {
  addSample(sample: CalibrationSample): void;
  /** Maps a raw iris ratio to screen pixels, or null until the model is ready. */
  apply(irisX: number, irisY: number): { x: number; y: number } | null;
  readonly sampleCount: number;
  readonly isReady: boolean;
  reset(): void;
}

export class CalibrationManager implements GazeCalibration {
  private samples: CalibrationSample[] = [];
  private xCoeffs: AffineCoeffs | null = null;
  private yCoeffs: AffineCoeffs | null = null;

  addSample(sample: CalibrationSample) {
    this.samples.push(sample);
    if (this.samples.length >= 3) this.refit();
  }

  private refit() {
    this.xCoeffs = fitAxis(this.samples, 'x');
    this.yCoeffs = fitAxis(this.samples, 'y');
  }

  /**
   * Apply the calibrated affine transform.
   * Returns null if fewer than 3 samples have been collected.
   */
  apply(irisX: number, irisY: number): { x: number; y: number } | null {
    if (!this.xCoeffs || !this.yCoeffs) return null;
    return {
      x: this.xCoeffs.a * irisX + this.xCoeffs.b * irisY + this.xCoeffs.c,
      y: this.yCoeffs.a * irisX + this.yCoeffs.b * irisY + this.yCoeffs.c,
    };
  }

  get sampleCount() { return this.samples.length; }
  get isReady()     { return this.xCoeffs !== null && this.yCoeffs !== null; }

  reset() {
    this.samples  = [];
    this.xCoeffs  = null;
    this.yCoeffs  = null;
  }
}
