"use client";

import { useEffect, useRef, useState } from "react";
import { useGaze } from "@/lib/gazeContext";
import { buildProfile, presetProfile, type GazeSample, type MotorProfile } from "@/lib/motor/profile";

const FIXATION_MS = 2000;
const REACH_MS = 750;
/** Samples at the start of each phase are dropped while gaze travels to the new target. */
const FIXATION_SETTLE_MS = 500;
const REACH_SETTLE_MS = 300;
/** Edge targets, as screen fractions. */
const REACH_TARGETS = [
  { x: 0.06, y: 0.5, label: "left" },
  { x: 0.94, y: 0.5, label: "right" },
  { x: 0.5, y: 0.08, label: "top" },
  { x: 0.5, y: 0.92, label: "bottom" },
] as const;

type Phase = "ready" | "fixation" | "reach" | "done";

interface MotorProfilerProps {
  onComplete: (profile: MotorProfile) => void;
}

/**
 * The 5-second motor profile: 2 s holding one target, then 4 x 0.75 s looking at
 * the screen edges. It measures gaze stability, natural-blink frequency and
 * reach, and hands back a {@link MotorProfile}.
 */
export function MotorProfiler({ onComplete }: MotorProfilerProps) {
  const { gazePositionRef, blinkCount } = useGaze();
  const [phase, setPhase] = useState<Phase>("ready");
  const [reachIndex, setReachIndex] = useState(0);
  const blinkRef = useRef(blinkCount);
  const onCompleteRef = useRef(onComplete);
  useEffect(() => {
    onCompleteRef.current = onComplete;
  });
  useEffect(() => {
    blinkRef.current = blinkCount;
  }, [blinkCount]);

  // Short pause so the person can read the prompt, then profiling starts by itself.
  useEffect(() => {
    const timer = window.setTimeout(() => setPhase("fixation"), 1500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (phase === "ready" || phase === "done") return;

    const fixation: GazeSample[] = [];
    const reach: GazeSample[] = [];
    const startBlinks = blinkRef.current;
    const t0 = performance.now();
    let raf = 0;
    let currentReach = 0;
    let finished = false;

    const finish = () => {
      finished = true;
      const spuriousBlinks = blinkRef.current - startBlinks;
      const screen = { width: window.innerWidth, height: window.innerHeight };
      const profile = fixation.length < 10
        ? presetProfile("moderate", screen)
        : buildProfile({ fixation, reach, spuriousBlinks: Math.min(spuriousBlinks, 10), fixationMs: FIXATION_MS - FIXATION_SETTLE_MS, screen });
      setPhase("done");
      onCompleteRef.current(profile);
    };

    const tick = () => {
      if (finished) return;
      const elapsed = performance.now() - t0;
      const { x, y } = gazePositionRef.current;

      if (elapsed < FIXATION_MS) {
        if (elapsed >= FIXATION_SETTLE_MS) fixation.push({ t: elapsed, x, y });
      } else {
        const sinceReach = elapsed - FIXATION_MS;
        const index = Math.floor(sinceReach / REACH_MS);
        if (index >= REACH_TARGETS.length) {
          finish();
          return;
        }
        if (index !== currentReach) {
          currentReach = index;
          setReachIndex(index);
        }
        setPhase("reach");
        if (sinceReach - index * REACH_MS >= REACH_SETTLE_MS) reach.push({ t: elapsed, x, y });
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => {
      finished = true;
      cancelAnimationFrame(raf);
    };
    // Profiling is one run that starts when the fixation phase begins; later phase changes come from inside the loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase === "ready" || phase === "done"]);

  const target = phase === "reach" ? REACH_TARGETS[reachIndex] : { x: 0.5, y: 0.5, label: "center" };

  return (
    <div className="ms-screen" style={{ zIndex: 850 }}>
      <div className="ms-center" style={{ top: "18%" }}>
        <p className="ms-kicker">TOUCH INTERFACE DISABLED</p>
        <p className="ms-headline">
          {phase === "ready" && "Calibrating motor parameters…"}
          {phase === "fixation" && "Hold your gaze on the target"}
          {phase === "reach" && `Now glance ${target.label}`}
          {phase === "done" && "Profile ready"}
        </p>
      </div>
      {phase !== "ready" && phase !== "done" && <div className="ms-progress" aria-hidden="true"><div /></div>}
      <div className="ms-target" style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%`, transition: "left 0.25s ease, top 0.25s ease" }}>
        <div className="ms-dot" />
      </div>
    </div>
  );
}
