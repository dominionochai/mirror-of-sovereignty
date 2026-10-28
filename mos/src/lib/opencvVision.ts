import type * as CvNamespace from '@techstark/opencv-js';

/** The OpenCV.js runtime, typed from the package's own declarations. */
export type OpenCv = typeof CvNamespace;

/** A fitted pupil, in pixel coordinates of the image it was fitted on. */
export interface PupilEllipse {
  cx: number;
  cy: number;
  /** Full axis lengths in pixels (width/height of the rotated rect). */
  width: number;
  height: number;
  /** Rotation of the `width` axis, in degrees, clockwise in image coordinates. */
  angleDeg: number;
}

/** A corneal glint is a tiny, very bright reflection of the light source on the eye. */
const GLINT_MIN_BRIGHTNESS = 200;
const GLINT_MIN_CONTRAST = 70;
/** Pixels within this many grey levels of the peak count as part of the glint. */
const GLINT_PEAK_BAND = 25;
/** A single hot pixel is sensor noise, not a reflection. */
const GLINT_MIN_PIXELS = 2;
/** A real glint is tiny; a bright region larger than this share of the crop is skin or sclera. */
const GLINT_MAX_AREA_RATIO = 0.06;

const RUNTIME_TIMEOUT_MS = 30_000;
const GAUSSIAN_KERNEL = 5;
/** A pupil blob must cover at least this share of the eye crop… */
const MIN_AREA_RATIO = 0.01;
/** …and at most this share (larger blobs are lids, brows, or shadow). */
const MAX_AREA_RATIO = 0.6;
/** fitEllipse needs at least five contour points. */
const MIN_CONTOUR_POINTS = 5;
/** Opening removes thin dark structures (lashes, lid lines) before contouring. */
const OPEN_KERNEL = 3;
/** Reject crops with too little tonal range: Otsu would split flat skin into noise. */
const MIN_CONTRAST = 40;
/** Pupils are near-circular; elongated blobs are lashes or lid shadow. */
const MAX_ASPECT_RATIO = 1.8;
/** The crop is centred on the iris, so the pupil must sit near its centre (fraction of crop size). */
const MAX_CENTRE_OFFSET = 0.3;
/** The pupil must be at least this much darker than the crop average (0-255 grey levels). */
const MIN_DARKNESS_GAP = 25;

type Deletable = { delete?: () => void };

let runtimePromise: Promise<OpenCv> | null = null;

function isReady(cv: Partial<OpenCv> | undefined): cv is OpenCv {
  return typeof cv?.Mat === 'function' && typeof cv.threshold === 'function';
}

/** Where the browser loads OpenCV.js from (copied there by scripts/copy-opencv.mjs). */
export const OPENCV_SCRIPT_URL = "/opencv/opencv.js";

type OpenCvGlobal = { cv?: Partial<OpenCv> | PromiseLike<OpenCv> };

/** Injects OpenCV.js as a classic script and resolves to what it exports on `window.cv`. */
function loadScript(): Promise<Partial<OpenCv> | PromiseLike<OpenCv>> {
  const scope = window as unknown as OpenCvGlobal;
  if (scope.cv) return Promise.resolve(scope.cv);
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = OPENCV_SCRIPT_URL;
    script.async = true;
    script.onload = () => (scope.cv ? resolve(scope.cv) : reject(new Error("OpenCV.js loaded but did not define `cv`.")));
    script.onerror = () => reject(new Error(`Could not load ${OPENCV_SCRIPT_URL}. Run \`npm install\` (it copies the file into public/).`));
    document.head.appendChild(script);
  });
}

/** Kept out of the bundler's sight: the browser must never bundle the package (see scripts/copy-opencv.mjs). */
const PACKAGE_NAME = "@techstark/opencv-js";

async function importPackage(): Promise<Partial<OpenCv> | PromiseLike<OpenCv>> {
  const imported = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ PACKAGE_NAME)) as unknown as {
    default?: Partial<OpenCv> | PromiseLike<OpenCv>;
  };
  return imported.default ?? (imported as Partial<OpenCv>);
}

async function initRuntime(): Promise<OpenCv> {
  // The OpenCV 5 build is a thenable that resolves once its WASM is compiled. In a browser it must be
  // loaded as a script; Node (the tests) can import the package directly.
  const candidate = await (typeof document === "undefined" ? importPackage() : loadScript());
  const cv = (await candidate) as Partial<OpenCv> & { onRuntimeInitialized?: () => void };
  if (isReady(cv)) return cv;

  return new Promise<OpenCv>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for the OpenCV.js runtime.")),
      RUNTIME_TIMEOUT_MS,
    );
    const previous = cv.onRuntimeInitialized;
    cv.onRuntimeInitialized = () => {
      previous?.call(cv);
      clearTimeout(timeout);
      if (isReady(cv)) resolve(cv);
      else reject(new Error("OpenCV.js initialised without the required APIs."));
    };
  });
}

/** Loads OpenCV.js once and shares the instance. A failed load can be retried. */
export function loadOpenCv(): Promise<OpenCv> {
  if (!runtimePromise) {
    runtimePromise = initRuntime().catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

/** Position of the corneal glint in an eye crop, in pixels. */
export interface Glint {
  cx: number;
  cy: number;
}

/**
 * Finds the corneal glint: the brightest point of the crop, accepted only when
 * it is bright in absolute terms, stands well above the crop average and is
 * small. Returns null otherwise (no light source, or the eye is closed).
 */
export function findGlint(cv: OpenCv, eyeCrop: HTMLCanvasElement): Glint | null {
  const owned: Deletable[] = [];
  const own = <T extends Deletable>(value: T): T => {
    owned.push(value);
    return value;
  };
  try {
    // Measured on the unblurred crop: blurring spreads a pinpoint reflection below the brightness threshold.
    const gray = own(new cv.Mat());
    cv.cvtColor(own(cv.imread(eyeCrop)), gray, cv.COLOR_RGBA2GRAY);

    const peak = cv.minMaxLoc(gray, own(new cv.Mat()));
    const average = cv.mean(gray)[0];
    if (peak.maxVal < GLINT_MIN_BRIGHTNESS || peak.maxVal - average < GLINT_MIN_CONTRAST) return null;

    // Average the positions of all near-peak pixels so the glint centre is sub-pixel and stable.
    const bright = own(new cv.Mat());
    cv.threshold(gray, bright, peak.maxVal - GLINT_PEAK_BAND, 255, cv.THRESH_BINARY);
    const area = cv.countNonZero(bright);
    if (area < GLINT_MIN_PIXELS || area > eyeCrop.width * eyeCrop.height * GLINT_MAX_AREA_RATIO) return null;
    const moments = cv.moments(bright, true);
    if (moments.m00 === 0) return null;
    return { cx: moments.m10 / moments.m00, cy: moments.m01 / moments.m00 };
  } finally {
    for (let i = owned.length - 1; i >= 0; i -= 1) owned[i].delete?.();
  }
}

/** True when the region inside `contour` is markedly darker than the whole crop. */
function isClearlyDarker(cv: OpenCv, gray: CvNamespace.Mat, contour: CvNamespace.Mat): boolean {
  const mask = cv.Mat.zeros(gray.rows, gray.cols, cv.CV_8UC1);
  const single = new cv.MatVector();
  try {
    single.push_back(contour);
    cv.drawContours(mask, single, 0, new cv.Scalar(255), cv.FILLED);
    const inside = cv.mean(gray, mask)[0];
    const overall = cv.mean(gray)[0];
    return overall - inside >= MIN_DARKNESS_GAP;
  } finally {
    single.delete();
    mask.delete();
  }
}

/**
 * Fits an ellipse to the pupil in a small crop of one eye.
 *
 * `eyeCrop` must be centred on the iris (e.g. from a face-landmark iris
 * centre). The crop is blurred and Otsu-thresholded so the dark pupil becomes
 * the foreground; the largest roundish blob near the crop centre that is
 * clearly darker than its surroundings wins. Returns null when no plausible
 * pupil is present (e.g. the eye is closed).
 */
export function fitPupilEllipse(cv: OpenCv, eyeCrop: HTMLCanvasElement): PupilEllipse | null {
  const owned: Deletable[] = [];
  const own = <T extends Deletable>(value: T): T => {
    owned.push(value);
    return value;
  };

  try {
    const rgba = own(cv.imread(eyeCrop));
    const gray = own(new cv.Mat());
    const blurred = own(new cv.Mat());
    const binary = own(new cv.Mat());
    cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(GAUSSIAN_KERNEL, GAUSSIAN_KERNEL), 0, 0, cv.BORDER_DEFAULT);

    const range = cv.minMaxLoc(blurred, own(new cv.Mat()));
    if (range.maxVal - range.minVal < MIN_CONTRAST) return null;

    cv.threshold(blurred, binary, 0, 255, cv.THRESH_BINARY_INV | cv.THRESH_OTSU);
    const kernel = own(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(OPEN_KERNEL, OPEN_KERNEL)));
    cv.morphologyEx(binary, binary, cv.MORPH_OPEN, kernel);

    const contours = own(new cv.MatVector());
    const hierarchy = own(new cv.Mat());
    cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

    const cropArea = eyeCrop.width * eyeCrop.height;
    const centre = { x: eyeCrop.width / 2, y: eyeCrop.height / 2 };
    const maxDistance = Math.hypot(centre.x, centre.y);

    let bestScore = 0;
    let best: PupilEllipse | null = null;
    for (let i = 0; i < contours.size(); i += 1) {
      const contour = contours.get(i);
      try {
        if (contour.rows < MIN_CONTOUR_POINTS) continue;
        const area = cv.contourArea(contour);
        if (area < cropArea * MIN_AREA_RATIO || area > cropArea * MAX_AREA_RATIO) continue;

        const perimeter = cv.arcLength(contour, true);
        const circularity = perimeter > 0 ? Math.min(1, (4 * Math.PI * area) / (perimeter * perimeter)) : 0;
        const rect = cv.fitEllipse(contour);
        const longAxis = Math.max(rect.size.width, rect.size.height);
        const shortAxis = Math.min(rect.size.width, rect.size.height);
        if (shortAxis <= 0 || longAxis / shortAxis > MAX_ASPECT_RATIO) continue;
        if (
          Math.abs(rect.center.x - centre.x) > eyeCrop.width * MAX_CENTRE_OFFSET ||
          Math.abs(rect.center.y - centre.y) > eyeCrop.height * MAX_CENTRE_OFFSET
        ) continue;
        const centrality = 1 - Math.hypot(rect.center.x - centre.x, rect.center.y - centre.y) / maxDistance;
        const score = area * circularity * centrality;
        if (score > bestScore && isClearlyDarker(cv, blurred, contour)) {
          bestScore = score;
          best = {
            cx: rect.center.x,
            cy: rect.center.y,
            width: rect.size.width,
            height: rect.size.height,
            angleDeg: rect.angle,
          };
        }
      } finally {
        contour.delete();
      }
    }
    return best;
  } finally {
    for (let i = owned.length - 1; i >= 0; i -= 1) owned[i].delete?.();
  }
}
