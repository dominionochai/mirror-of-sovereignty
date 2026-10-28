'use client';

import { createContext, useContext, MutableRefObject } from 'react';

export interface GazePosition {
  x: number;
  y: number;
}

/** One eye as seen by the face tracker. Coordinates are normalised to [0, 1]. */
export interface EyeOutline {
  /** Six eyelid points in loop order: outer corner, upper lid x2, inner corner, lower lid x2. */
  contour: GazePosition[];
  /** Iris centre. */
  iris: GazePosition;
}

/**
 * Latest tracker output for visualisation. Coordinates are normalised to the
 * *unmirrored* camera frame (the same space MediaPipe reports in).
 */
export interface TrackingOverlay {
  eyes: EyeOutline[];
  /**
   * All face landmarks as interleaved x,y pairs (so `[2i]`, `[2i+1]` is landmark i),
   * or null when no face is visible. The buffer is reused between frames, so read
   * it immediately and never keep a reference.
   */
  landmarks: Float32Array | null;
}

export type HoverState = { isHovering: boolean; dwellPct: number; snapTarget?: GazePosition };

export interface GazeState {
  // ── Reactive state (triggers re-renders only on discrete events) ──
  blinkCount: number;       // increments on every intentional blink
  isFaceDetected: boolean;
  isCalibrated: boolean;
  isTracking: boolean;      // camera running + face model ready
  isCalibrating: boolean;
  calibrationStep: number;  // 0-4 (5-point calibration)
  initStatus: 'idle' | 'loading-model' | 'requesting-camera' | 'ready' | 'error';
  errorMessage: string;
  isWebGPU: boolean;        // whether WebGPU delegate is active
  /** How raw iris ratios become screen positions: OpenCV's projective fit once it has loaded, an affine fit until then. */
  calibrationModel: 'affine' | 'homography';
  stream: MediaStream | null;

  // ── High-frequency refs (updated every frame, no React re-render) ──
  // Read these directly in RAF loops, not in render
  gazePositionRef: MutableRefObject<GazePosition>;
  rawIrisRef: MutableRefObject<GazePosition>;
  /** Eye geometry for the live X-ray view; empty while no face is visible. */
  overlayRef: MutableRefObject<TrackingOverlay>;
  // Shared hover state: GazeButton writes, GazeCursor reads — zero React renders
  hoverStateRef: MutableRefObject<HoverState>;

  // ── Methods ──
  initialize: () => void;
  startCalibration: () => void;
  recordCalibrationPoint: () => void; // called externally to capture current iris pos
  resetCalibration: () => void;
}

const noop = () => {};
const dummyRef = { current: { x: 0, y: 0 } };
const dummyOverlay = { current: { eyes: [], landmarks: null } };
const dummyHover = { current: { isHovering: false, dwellPct: 0 } };

export const GazeContext = createContext<GazeState>({
  blinkCount: 0,
  isFaceDetected: false,
  isCalibrated: false,
  isTracking: false,
  isCalibrating: false,
  calibrationStep: 0,
  initStatus: 'idle',
  errorMessage: '',
  isWebGPU: false,
  calibrationModel: 'affine',
  stream: null,
  gazePositionRef: dummyRef as MutableRefObject<GazePosition>,
  rawIrisRef: dummyRef as MutableRefObject<GazePosition>,
  overlayRef: dummyOverlay as MutableRefObject<TrackingOverlay>,
  hoverStateRef: dummyHover as MutableRefObject<HoverState>,
  initialize: noop,
  startCalibration: noop,
  recordCalibrationPoint: noop,
  resetCalibration: noop,
});

export function useGaze() {
  return useContext(GazeContext);
}
