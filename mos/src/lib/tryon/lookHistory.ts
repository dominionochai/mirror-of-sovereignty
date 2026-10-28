import { DEFAULT_INTENSITY } from "./catalog";
import type { Look } from "./types";

export const INTENSITY_STEP = 10;
const MAX_HISTORY = 50;

export interface LookState {
  /** The styling currently shown. */
  present: Look;
  /** Earlier stylings, newest last. Undo pops from here. */
  past: Look[];
  /** Identifies the last change so repeated +/- on one slot collapse into one undo step. */
  lastChange: string | null;
}

export type LookAction =
  | { type: "select"; slot: string; optionId: string }
  | { type: "adjust"; slot: string; delta: number }
  | { type: "clearSlot"; slot: string }
  | { type: "undo" }
  | { type: "reset" };

export const initialLookState: LookState = { present: {}, past: [], lastChange: null };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

function push(state: LookState, next: Look, change: string | null, coalesce: boolean): LookState {
  const past = coalesce ? state.past : [...state.past, state.present].slice(-MAX_HISTORY);
  return { present: next, past, lastChange: change };
}

export function lookReducer(state: LookState, action: LookAction): LookState {
  switch (action.type) {
    case "select": {
      const current = state.present[action.slot];
      if (current?.optionId === action.optionId) return state;
      const next = { ...state.present, [action.slot]: { optionId: action.optionId, intensity: current?.intensity ?? DEFAULT_INTENSITY } };
      return push(state, next, `select:${action.slot}`, false);
    }
    case "adjust": {
      const current = state.present[action.slot];
      if (!current) return state;
      const intensity = clamp(current.intensity + action.delta, 0, 100);
      if (intensity === current.intensity) return state;
      const next = { ...state.present, [action.slot]: { ...current, intensity } };
      const change = `adjust:${action.slot}:${current.optionId}`;
      return push(state, next, change, state.lastChange === change);
    }
    case "clearSlot": {
      if (!state.present[action.slot]) return state;
      const next = { ...state.present };
      delete next[action.slot];
      return push(state, next, `clear:${action.slot}`, false);
    }
    case "undo": {
      if (state.past.length === 0) return state;
      const past = state.past.slice(0, -1);
      return { present: state.past[state.past.length - 1], past, lastChange: null };
    }
    case "reset":
      return state.present && Object.keys(state.present).length === 0 && state.past.length === 0
        ? state
        : push(state, {}, "reset", false);
  }
}
