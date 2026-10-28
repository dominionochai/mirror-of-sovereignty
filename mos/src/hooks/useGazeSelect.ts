import { useEffect, useRef, useState, type RefObject } from "react";
import { useGaze } from "@/lib/gazeContext";

/** Marks an element as selectable by gaze. The value identifies it in `focusedId`. */
export const GAZE_ACTION_ATTRIBUTE = "data-gaze-action";

const TICK_MS = 50;
export const MIN_DWELL_MS = 400;
/** Progress is quantised so a selection re-renders the host at most this many times. */
const PROGRESS_STEPS = 20;

interface GazeFocus {
  id: string | null;
  element: HTMLElement | null;
  startedAt: number;
  fired: boolean;
}

const NO_FOCUS: GazeFocus = { id: null, element: null, startedAt: 0, fired: false };

export interface GazeSelectOptions {
  /** Element whose descendants are selectable. */
  rootRef: RefObject<HTMLElement | null>;
  /** Dwell time before a held gaze selects. Clamped to at least {@link MIN_DWELL_MS}. */
  dwellMs?: number;
  /** Set false to pause selection (e.g. while a panel is hidden). */
  enabled?: boolean;
  /** Set false to disable blink selection (dwell only), e.g. for users whose natural blinks are frequent. Default true. */
  blinkSelect?: boolean;
  /** Called with the element's `data-gaze-action` value when a gaze announces focus. */
  onFocusChange?: (id: string | null, element: HTMLElement | null) => void;
}

/**
 * One selection path for every gaze-driven surface: any descendant of `rootRef`
 * with `data-gaze-action` is selected by holding gaze on it, or by an
 * intentional blink while focused. Selection simply calls the element's
 * native `click()`, so the same `onClick` serves gaze, mouse, touch, keyboard
 * and the on-screen agent. A blink after dwell already fired is ignored.
 */
export function useGazeSelect({ rootRef, dwellMs = 900, enabled = true, blinkSelect = true, onFocusChange }: GazeSelectOptions) {
  const { gazePositionRef, hoverStateRef, blinkCount, isTracking } = useGaze();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const focusRef = useRef<GazeFocus>(NO_FOCUS);
  const lastBlinkRef = useRef(blinkCount);
  const onFocusChangeRef = useRef(onFocusChange);
  useEffect(() => {
    onFocusChangeRef.current = onFocusChange;
  });

  useEffect(() => {
    const clearFocus = () => {
      if (focusRef.current.id !== null) onFocusChangeRef.current?.(null, null);
      focusRef.current = NO_FOCUS;
      setFocusedId(null);
      setProgress(0);
    };

    if (!enabled || !isTracking) {
      clearFocus();
      return;
    }

    const dwell = Math.max(MIN_DWELL_MS, dwellMs);
    const tick = () => {
      const root = rootRef.current;
      if (!root) return;
      const { x, y } = gazePositionRef.current;
      const target = document.elementFromPoint(x, y)?.closest<HTMLElement>(`[${GAZE_ACTION_ATTRIBUTE}]`) ?? null;
      const element = target && root.contains(target) && !(target as HTMLButtonElement).disabled ? target : null;
      if (!element) {
        clearFocus();
        return;
      }

      const id = element.getAttribute(GAZE_ACTION_ATTRIBUTE);
      if (id !== focusRef.current.id) {
        focusRef.current = { id, element, startedAt: Date.now(), fired: false };
        setFocusedId(id);
        onFocusChangeRef.current?.(id, element);
      }

      const elapsed = Math.min(1, (Date.now() - focusRef.current.startedAt) / dwell);
      setProgress(Math.round(elapsed * PROGRESS_STEPS) / PROGRESS_STEPS);
      const rect = element.getBoundingClientRect();
      hoverStateRef.current = {
        isHovering: true,
        dwellPct: elapsed,
        snapTarget: elapsed > 0.05 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : undefined,
      };

      if (elapsed >= 1 && !focusRef.current.fired) {
        focusRef.current.fired = true;
        element.click();
      }
    };

    const timer = window.setInterval(tick, TICK_MS);
    return () => {
      window.clearInterval(timer);
      clearFocus();
    };
  }, [dwellMs, enabled, gazePositionRef, hoverStateRef, isTracking, rootRef]);

  // A blink selects the focused element immediately, unless dwell already did.
  useEffect(() => {
    if (blinkCount > lastBlinkRef.current) {
      const focus = focusRef.current;
      if (enabled && blinkSelect && focus.element && !focus.fired) {
        focus.fired = true;
        focus.element.click();
      }
    }
    lastBlinkRef.current = blinkCount;
  }, [blinkCount, enabled, blinkSelect]);

  return { focusedId, progress };
}
