/**
 * Adaptive Motor Control Layer: turns a few seconds of raw gaze + blink data
 * into a {@link MotorProfile} that drives every interactive element in the UI.
 * Pure functions only, so the whole layer can be unit tested without a camera.
 */

export interface GazeSample {
  /** Milliseconds, any monotonic clock. */
  t: number;
  /** Screen pixels. */
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface MotorProfile {
  /** RMS dispersion of gaze while fixating, in px. Lower = steadier. */
  stabilityPx: number;
  tolerance: "low" | "medium" | "high";
  /** Dwell time required to select. */
  dwellMs: number;
  /** Multiplier applied to minimum target size. */
  targetScale: number;
  /** Whether a blink may select the focused target. */
  blinkSelect: boolean;
  /** Portion of the screen the user can comfortably reach; the UI is laid out inside it. */
  safeZone: Rect;
  /** Fraction of the screen area inside the safe zone. */
  reachPct: number;
}

export const MIN_DWELL_MS = 400;
export const MAX_DWELL_MS = 1200;
/** Dispersion at or below this is treated as perfectly steady. */
export const STEADY_PX = 8;
/** Dispersion at or above this is treated as the most tremor-affected case. */
export const UNSTEADY_PX = 60;
/** More involuntary blinks than this per second while fixating disables blink selection. */
export const MAX_SPURIOUS_BLINKS_PER_SEC = 0.5;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** Root-mean-square distance of the samples from their centroid, in px. */
export function dispersion(samples: GazeSample[]): number {
  if (samples.length < 2) return 0;
  const cx = samples.reduce((sum, s) => sum + s.x, 0) / samples.length;
  const cy = samples.reduce((sum, s) => sum + s.y, 0) / samples.length;
  const variance = samples.reduce((sum, s) => sum + (s.x - cx) ** 2 + (s.y - cy) ** 2, 0) / samples.length;
  return Math.sqrt(variance);
}

/**
 * Gaze stability: dispersion over sliding windows of `windowMs`, reported as the
 * median so one saccade or a lost-tracking frame does not dominate.
 */
export function gazeStability(samples: GazeSample[], windowMs = 1000): number {
  if (samples.length < 2) return 0;
  const sorted = [...samples].sort((a, b) => a.t - b.t);
  const last = sorted[sorted.length - 1].t;
  const first = sorted[0].t;
  if (last - first < windowMs) return dispersion(sorted);

  const results: number[] = [];
  const step = windowMs / 4;
  for (let start = first; start + windowMs <= last + 1; start += step) {
    const window = sorted.filter((s) => s.t >= start && s.t < start + windowMs);
    if (window.length >= 2) results.push(dispersion(window));
  }
  if (results.length === 0) return dispersion(sorted);
  results.sort((a, b) => a - b);
  // Lower median: tremor raises every window, whereas a glitch only spoils a few.
  return results[Math.floor((results.length - 1) / 2)];
}

/** Maps stability to a dwell time: steady users get fast selection, tremor users get more time. */
export function dwellForStability(stabilityPx: number): number {
  const t = clamp((stabilityPx - STEADY_PX) / (UNSTEADY_PX - STEADY_PX), 0, 1);
  return Math.round((MIN_DWELL_MS + t * (MAX_DWELL_MS - MIN_DWELL_MS)) / 50) * 50;
}

export function toleranceForStability(stabilityPx: number): MotorProfile["tolerance"] {
  if (stabilityPx < 20) return "low";
  if (stabilityPx < 40) return "medium";
  return "high";
}

/** Larger targets for shakier gaze: 1x when steady up to 1.6x when severely unsteady. */
export function targetScaleForStability(stabilityPx: number): number {
  const t = clamp((stabilityPx - STEADY_PX) / (UNSTEADY_PX - STEADY_PX), 0, 1);
  return Math.round((1 + t * 0.6) * 100) / 100;
}

/**
 * Blink selection is only safe when natural blinks are rare enough not to fire
 * by accident while the user is deliberately fixating.
 */
export function blinkSelectSafe(spuriousBlinks: number, fixationMs: number): boolean {
  if (fixationMs <= 0) return false;
  return spuriousBlinks / (fixationMs / 1000) <= MAX_SPURIOUS_BLINKS_PER_SEC;
}

function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const index = clamp(Math.round((sortedValues.length - 1) * p), 0, sortedValues.length - 1);
  return sortedValues[index];
}

/**
 * Safe zone from the gaze points the user produced while looking at the screen
 * edges: the 5th-95th percentile bounding box, pulled in by `margin`, never
 * smaller than `minFraction` of the screen in either direction.
 */
export function safeZoneFromReach(
  samples: GazeSample[],
  screen: { width: number; height: number },
  margin = 0.04,
  minFraction = 0.45,
): Rect {
  const full: Rect = { left: 0, top: 0, right: screen.width, bottom: screen.height };
  if (samples.length < 10) return full;

  const xs = samples.map((s) => s.x).sort((a, b) => a - b);
  const ys = samples.map((s) => s.y).sort((a, b) => a - b);
  let left = percentile(xs, 0.05);
  let right = percentile(xs, 0.95);
  let top = percentile(ys, 0.05);
  let bottom = percentile(ys, 0.95);

  const insetX = screen.width * margin;
  const insetY = screen.height * margin;
  left += insetX;
  right -= insetX;
  top += insetY;
  bottom -= insetY;

  const minW = screen.width * minFraction;
  const minH = screen.height * minFraction;
  if (right - left < minW) {
    const mid = (left + right) / 2;
    left = mid - minW / 2;
    right = mid + minW / 2;
  }
  if (bottom - top < minH) {
    const mid = (top + bottom) / 2;
    top = mid - minH / 2;
    bottom = mid + minH / 2;
  }
  return {
    left: clamp(left, 0, screen.width),
    right: clamp(right, 0, screen.width),
    top: clamp(top, 0, screen.height),
    bottom: clamp(bottom, 0, screen.height),
  };
}

export interface ProfilingInput {
  /** Gaze while the user held a single fixation target. */
  fixation: GazeSample[];
  /** Gaze while the user looked toward the screen edges. */
  reach: GazeSample[];
  /** Blink events counted during the fixation phase. */
  spuriousBlinks: number;
  fixationMs: number;
  screen: { width: number; height: number };
}

export function buildProfile(input: ProfilingInput): MotorProfile {
  const stabilityPx = gazeStability(input.fixation);
  const safeZone = safeZoneFromReach(input.reach, input.screen);
  const area = (safeZone.right - safeZone.left) * (safeZone.bottom - safeZone.top);
  return {
    stabilityPx: Math.round(stabilityPx * 10) / 10,
    tolerance: toleranceForStability(stabilityPx),
    dwellMs: dwellForStability(stabilityPx),
    targetScale: targetScaleForStability(stabilityPx),
    blinkSelect: blinkSelectSafe(input.spuriousBlinks, input.fixationMs),
    safeZone,
    reachPct: Math.round((area / (input.screen.width * input.screen.height)) * 100),
  };
}

/** Preset profiles for demos and for users who cannot complete profiling. */
export function presetProfile(
  kind: "steady" | "moderate" | "high",
  screen: { width: number; height: number },
): MotorProfile {
  const stabilityPx = { steady: 6, moderate: 28, high: 55 }[kind];
  const inset = { steady: 0.02, moderate: 0.08, high: 0.16 }[kind];
  const safeZone: Rect = {
    left: screen.width * inset,
    right: screen.width * (1 - inset),
    top: screen.height * inset,
    bottom: screen.height * (1 - inset),
  };
  return {
    stabilityPx,
    tolerance: toleranceForStability(stabilityPx),
    dwellMs: dwellForStability(stabilityPx),
    targetScale: targetScaleForStability(stabilityPx),
    blinkSelect: kind !== "high",
    safeZone,
    reachPct: Math.round((1 - 2 * inset) ** 2 * 100),
  };
}
