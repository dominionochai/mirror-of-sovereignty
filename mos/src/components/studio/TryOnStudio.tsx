"use client";

import { keyHeaders, loadSettings } from "@/lib/keys";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type CSSProperties } from "react";
import { useGaze } from "@/lib/gazeContext";
import { useGazeSelect } from "@/hooks/useGazeSelect";
import { presetProfile, type MotorProfile } from "@/lib/motor/profile";
import { DEFAULT_FACE, faceFromLandmarks, type FaceGeometry } from "@/lib/tryon/face";
import { CATALOG, findGroup, findOption, parseSlot, slotKey } from "@/lib/tryon/catalog";
import { INTENSITY_STEP, initialLookState, lookReducer } from "@/lib/tryon/lookHistory";
import { MockRenderer } from "@/lib/tryon/mockRenderer";
import { RemoteRenderer, type TryOnRenderer } from "@/lib/tryon/renderer";
import type { CategoryId } from "@/lib/tryon/types";

const RENDER_DEBOUNCE_MS = 500;

interface TryOnStudioProps {
  profile: MotorProfile;
  onProfileChange: (profile: MotorProfile) => void;
  onReprofile: () => void;
  /** The X-ray view is open on top: pause selection here so only its buttons respond. */
  xrayOpen?: boolean;
  onOpenXray: () => void;
}

type CompareLock = "A" | "B" | null;

function createRenderer(): TryOnRenderer {
  const settings = loadSettings();
  const envMode = process.env.NEXT_PUBLIC_TRYON_RENDERER === "youcam";
  return settings.mode === "youcam" || envMode ? new RemoteRenderer(keyHeaders(settings.keys)) : new MockRenderer();
}

export function TryOnStudio({ profile, onProfileChange, onReprofile, xrayOpen = false, onOpenXray }: TryOnStudioProps) {
  const { stream, overlayRef } = useGaze();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<TryOnRenderer | null>(null);
  /** The face frame every render in this styling session is based on, so results stay consistent. */
  const originalRef = useRef<string | null>(null);
  /** Where the face was in that frame. */
  const faceRef = useRef<FaceGeometry>(DEFAULT_FACE);

  const [look, dispatch] = useReducer(lookReducer, initialLookState);
  const [categoryId, setCategoryId] = useState<CategoryId>("hair");
  const [groupId, setGroupId] = useState("color");
  const [activeSlot, setActiveSlot] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [lock, setLock] = useState<CompareLock>(null);
  const [touchLocked, setTouchLocked] = useState(true);
  const [rendered, setRendered] = useState<{ url: string; source: string; local: number } | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optionsHeight, setOptionsHeight] = useState(0);

  const category = CATALOG.find((c) => c.id === categoryId) ?? CATALOG[0];
  const group = findGroup(category.id, groupId) ?? category.groups[0];
  const scale = profile.targetScale;

  // Measure the options column so large targets in a small safe zone switch to two columns instead of overflowing.
  useEffect(() => {
    const element = optionsRef.current;
    if (!element) return;
    const update = () => setOptionsHeight(element.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // ── Camera preview ────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (video && stream) {
      video.srcObject = stream;
      void video.play().catch(() => undefined);
    }
  }, [stream, compare]);

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  // A fixed placeholder lets the studio run for layout and demo purposes with no camera.
  const placeholderFrame = useCallback((): string => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#d9c3cf";
      ctx.fillRect(0, 0, 640, 480);
      ctx.fillStyle = "#b99aab";
      ctx.beginPath();
      ctx.ellipse(320, 250, 120, 150, 0, 0, 2 * Math.PI);
      ctx.fill();
    }
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  /** Fixes the frame and face position that every render in this styling session is based on. */
  const lockOriginal = useCallback((): string => {
    if (originalRef.current) return originalRef.current;
    const real = captureFrame();
    originalRef.current = real ?? placeholderFrame();
    faceRef.current = (real ? faceFromLandmarks(overlayRef.current.landmarks) : null) ?? DEFAULT_FACE;
    return originalRef.current;
  }, [captureFrame, placeholderFrame, overlayRef]);

  // ── Rendering: debounce look changes, drop stale responses ────────────────
  useEffect(() => {
    if (Object.keys(look.present).length === 0) {
      originalRef.current = null;
      setOriginal(null);
      setRendered(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      rendererRef.current ??= createRenderer();
      setRendering(true);
      setError(null);
      try {
        const frame = lockOriginal();
        setOriginal(frame);
        const result = await rendererRef.current.render({ frame, face: faceRef.current, look: look.present }, controller.signal);
        if (!controller.signal.aborted) setRendered({ url: result.imageUrl, source: result.source, local: result.localSlots?.length ?? 0 });
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Rendering failed.");
      } finally {
        if (!controller.signal.aborted) setRendering(false);
      }
    }, RENDER_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [look.present, lockOriginal]);

  // ── Actions ───────────────────────────────────────────────────────────────
  const selectCategory = (id: CategoryId) => {
    const next = CATALOG.find((c) => c.id === id);
    if (!next) return;
    setCategoryId(id);
    setGroupId(next.groups[0].id);
  };

  const selectOption = (optionId: string) => {
    const slot = slotKey(category.id, group.id);
    dispatch({ type: "select", slot, optionId });
    setActiveSlot(slot);
  };

  const adjust = (delta: number) => {
    if (activeSlot) dispatch({ type: "adjust", slot: activeSlot, delta });
  };

  const toggleCompare = () => {
    setCompare((on) => !on);
    setLock(null);
    setOriginal(lockOriginal());
  };

  const handleAction = (id: string) => {
    if (id.startsWith("cat:")) selectCategory(id.slice(4) as CategoryId);
    else if (id.startsWith("grp:")) setGroupId(id.slice(4));
    else if (id.startsWith("opt:")) selectOption(id.slice(4));
    else if (id === "intensity-up") adjust(INTENSITY_STEP);
    else if (id === "intensity-down") adjust(-INTENSITY_STEP);
    else if (id === "compare") toggleCompare();
    else if (id === "undo") dispatch({ type: "undo" });
    else if (id === "reprofile") onReprofile();
    else if (id === "xray") onOpenXray();
    else if (id === "lock-A") setLock("A");
    else if (id === "lock-B") setLock("B");
  };

  // Presenter shortcuts: 1/2/3 switch to a preset motor profile, T toggles the touch lock.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      const screen = { width: window.innerWidth, height: window.innerHeight };
      if (event.key === "1") onProfileChange(presetProfile("steady", screen));
      else if (event.key === "2") onProfileChange(presetProfile("moderate", screen));
      else if (event.key === "3") onProfileChange(presetProfile("high", screen));
      else if (event.key.toLowerCase() === "t") setTouchLocked((locked) => !locked);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onProfileChange]);

  const { focusedId, progress } = useGazeSelect({
    rootRef,
    dwellMs: profile.dwellMs,
    blinkSelect: profile.blinkSelect,
    enabled: !xrayOpen,
  });

  // ── Derived display values ────────────────────────────────────────────────
  const active = activeSlot ? look.present[activeSlot] : undefined;
  const activeInfo = useMemo(() => {
    if (!activeSlot || !active) return null;
    const { categoryId: c, groupId: g } = parseSlot(activeSlot);
    return { group: findGroup(c, g), option: findOption(c, g, active.optionId) };
  }, [activeSlot, active]);
  const canAdjust = Boolean(activeInfo?.group?.adjustable);

  const zone = profile.safeZone;
  const rootStyle = {
    left: zone.left,
    top: zone.top,
    width: zone.right - zone.left,
    height: zone.bottom - zone.top,
    "--scale": scale,
  } as CSSProperties;

  const gazeButton = (id: string, label: string, opts: { pressed?: boolean; disabled?: boolean; swatch?: string; small?: boolean; flex?: number } = {}) => (
    <button
      key={id}
      type="button"
      className={opts.small ? "ms-tile ms-tile--sm" : "ms-tile"}
      data-gaze-action={id}
      data-focused={focusedId === id ? "true" : undefined}
      aria-pressed={opts.pressed}
      disabled={opts.disabled}
      onClick={() => handleAction(id)}
      style={{ "--p": focusedId === id ? progress : 0, ...(opts.flex ? { flex: opts.flex } : {}) } as CSSProperties}
    >
      {opts.swatch && <span className="ms-swatch" aria-hidden="true" style={{ "--c": opts.swatch } as CSSProperties} />}
      <span>{label}</span>
    </button>
  );

  const optionCount = group.options.length;
  const oneColumnFits = optionsHeight === 0 || optionCount * 56 * scale + (optionCount - 1) * 12 <= optionsHeight;
  const optionCols = oneColumnFits ? 1 : 2;
  const stageImage = rendered?.url ?? null;
  const hasLook = Object.keys(look.present).length > 0;
  const localCount = rendered?.local ?? 0;

  return (
    <div
      ref={rootRef}
      className="ms-root"
      style={rootStyle}
      // Real pointer clicks are swallowed while the touch lock is on; gaze selection calls element.click(), which is untrusted.
      onClickCapture={(event: { nativeEvent: Event; stopPropagation: () => void; preventDefault: () => void }) => {
        if (touchLocked && event.nativeEvent.isTrusted) {
          event.stopPropagation();
          event.preventDefault();
        }
      }}
    >
      <header className="ms-topbar">
        <div className="ms-brand">
          MOTOR SOVEREIGNTY
          <small>HANDS-FREE TRY-ON · GAZE + DWELL{profile.blinkSelect ? " + BLINK" : ""}</small>
        </div>
        <div className="ms-chips">
          <span className="ms-chip" data-tone={touchLocked ? "alert" : undefined}>{touchLocked ? "TOUCH DISABLED" : "TOUCH ENABLED"}</span>
          <span className="ms-chip">DWELL {profile.dwellMs}ms</span>
          <span className="ms-chip">TOLERANCE {profile.tolerance.toUpperCase()}</span>
          <span className="ms-chip" data-tone={profile.blinkSelect ? "ok" : undefined}>BLINK {profile.blinkSelect ? "ON" : "OFF"}</span>
        </div>
      </header>

      <nav className="ms-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }} aria-label="Categories">
        {CATALOG.map((c) => gazeButton(`cat:${c.id}`, c.label, { pressed: c.id === category.id }))}
      </nav>

      <div className="ms-grid" style={{ gridTemplateColumns: `repeat(${category.groups.length}, minmax(0, 1fr))` }} aria-label="Groups">
        {category.groups.map((g) => gazeButton(`grp:${g.id}`, g.label, { pressed: g.id === group.id, small: true }))}
      </div>

      <div className="ms-main">
        <div className="ms-options" aria-label="Options" ref={optionsRef}>
          <div className="ms-options-inner" style={{ "--cols": optionCols, "--rows": Math.ceil(group.options.length / optionCols) } as CSSProperties}>
            {group.options.map((o) => {
              const applied = look.present[slotKey(category.id, group.id)]?.optionId === o.id;
              return gazeButton(`opt:${o.id}`, o.label, { pressed: applied, swatch: o.color });
            })}
          </div>
        </div>

        <div className="ms-stage">
          {/* Always mounted so frames can be captured whatever is on screen. */}
          <video ref={videoRef} autoPlay muted playsInline style={{ visibility: stageImage || compare ? "hidden" : "visible" }} />
          {compare ? (
            (["A", "B"] as const).map((side) => {
              const id = `lock-${side}`;
              const locked = lock === side;
              return (
                <button
                  key={side}
                  type="button"
                  className="ms-pane"
                  data-gaze-action={id}
                  data-focused={focusedId === id ? "true" : undefined}
                  onClick={() => handleAction(id)}
                  style={{ flex: lock === null ? 1 : locked ? 3 : 1 }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={(side === "A" ? original : stageImage ?? original) ?? undefined} alt={side === "A" ? "Original" : "Full styling"} />
                  <span className="ms-label">{side === "A" ? "A · ORIGINAL" : "B · FULL STYLING"}{locked ? " · LOCKED" : ""}</span>
                </button>
              );
            })
          ) : (
            <>
              {stageImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={stageImage} alt="Try-on result" />
              )}
              {rendered?.source === "mock" && <span className="ms-label" data-tone="warn">MOCK PREVIEW · NOT A REAL TRY-ON</span>}
              {rendered?.source === "youcam" && (
                <span className="ms-label">YOUCAM{localCount > 0 ? ` + ${localCount} LOCAL` : ""}</span>
              )}
              {rendering && <span className="ms-label ms-label--right">RENDERING…</span>}
              {!hasLook && <span className="ms-hint">LOOK AT AN OPTION AND HOLD TO APPLY IT</span>}
              {error && <span className="ms-error" role="alert">{error}</span>}
            </>
          )}
        </div>
      </div>

      <div className="ms-controls">
        {gazeButton("intensity-down", "− LESS", { disabled: !canAdjust })}
        <div className="ms-meter" aria-live="polite">
          <span className="ms-meter-title">{activeInfo?.option ? `${activeInfo.group?.label} · ${activeInfo.option.label}`.toUpperCase() : "SELECT AN OPTION"}</span>
          <div className="ms-meter-bar"><div style={{ width: `${canAdjust && active ? active.intensity : 0}%` }} /></div>
          <span className="ms-meter-value">{canAdjust && active ? `${active.intensity}%` : "—"}</span>
        </div>
        {gazeButton("intensity-up", "MORE +", { disabled: !canAdjust })}
        {gazeButton("compare", compare ? "EXIT COMPARE" : "COMPARE", { pressed: compare })}
        {gazeButton("undo", "UNDO", { disabled: look.past.length === 0 })}
        {gazeButton("reprofile", "PROFILE")}
        {gazeButton("xray", "X-RAY")}
      </div>

      <footer className="ms-footer">
        <span>STABILITY {profile.stabilityPx}px · TARGETS ×{profile.targetScale} · REACH {profile.reachPct}%</span>
        <span>PRESETS 1·2·3 · TOUCH LOCK T</span>
      </footer>
    </div>
  );
}
