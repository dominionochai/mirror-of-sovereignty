"use client";

import { useEffect, useRef, useState } from "react";
import { CALIBRATION_TARGETS } from "@/lib/calibration";
import { useGaze } from "@/lib/gazeContext";

/** A held gaze confirms a calibration point on its own, so no blink or touch is needed. */
const SETTLE_MS = 1800;

/** Five-point gaze calibration that confirms each point by holding gaze, blink or Enter. */
export function StudioCalibration() {
  const { isCalibrating, calibrationStep, blinkCount, recordCalibrationPoint } = useGaze();
  const [elapsed, setElapsed] = useState(0);
  const lastBlink = useRef(blinkCount);
  const startedAt = useRef(0);

  // Restart the settle timer for every point.
  useEffect(() => {
    if (!isCalibrating) return;
    startedAt.current = performance.now();
    const timer = window.setInterval(() => setElapsed(performance.now() - startedAt.current), 50);
    return () => {
      window.clearInterval(timer);
      setElapsed(0);
    };
  }, [isCalibrating, calibrationStep]);

  // Confirm after the settle time, or earlier on a deliberate blink once gaze has had a moment to land.
  useEffect(() => {
    if (!isCalibrating) return;
    if (elapsed >= SETTLE_MS) {
      startedAt.current = performance.now();
      setElapsed(0);
      recordCalibrationPoint();
    }
  }, [elapsed, isCalibrating, recordCalibrationPoint]);

  useEffect(() => {
    if (isCalibrating && blinkCount !== lastBlink.current && elapsed > 600) recordCalibrationPoint();
    lastBlink.current = blinkCount;
  }, [blinkCount, isCalibrating, elapsed, recordCalibrationPoint]);

  const target = CALIBRATION_TARGETS[calibrationStep];
  if (!isCalibrating || !target) return null;
  const pct = Math.min(1, elapsed / SETTLE_MS);

  return (
    <div className="ms-screen" style={{ zIndex: 900 }}>
      <div className="ms-center">
        <p className="ms-kicker">CALIBRATING · POINT {calibrationStep + 1} / {CALIBRATION_TARGETS.length}</p>
        <p className="ms-headline" style={{ fontSize: 18 }}>Look at the target and hold your gaze</p>
      </div>
      <div
        className="ms-target"
        style={{
          left: `${target.x * 100}%`,
          top: `${target.y * 100}%`,
          transition: "left 0.5s cubic-bezier(.4,0,.2,1), top 0.5s cubic-bezier(.4,0,.2,1)",
        }}
      >
        <svg width="84" height="84" viewBox="0 0 84 84" aria-hidden="true">
          <circle cx="42" cy="42" r="36" fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth="6" />
          <circle
            cx="42" cy="42" r="36" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 36} strokeDashoffset={2 * Math.PI * 36 * (1 - pct)}
            transform="rotate(-90 42 42)"
          />
          <circle cx="42" cy="42" r="9" fill="var(--ink)" />
        </svg>
      </div>
    </div>
  );
}
