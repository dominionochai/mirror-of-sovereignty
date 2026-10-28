/**
 * API keys and studio settings. Shared by the start page (browser) and the
 * server routes. Keys are kept in this browser's localStorage and sent to this
 * app's own API routes as request headers; they are never logged or echoed.
 */

export type KeyId = "youcam" | "groq" | "gemini";
export type Mode = "mock" | "youcam";

export interface KeyField {
  id: KeyId;
  label: string;
  /** Environment variable used when no key is sent with the request. */
  envName: string;
  required: boolean;
  placeholder: string;
  help: string;
}

export const KEY_FIELDS: KeyField[] = [
  {
    id: "youcam",
    label: "YouCam API key",
    envName: "YOUCAM_API_KEY",
    required: true,
    placeholder: "Paste your YouCam API key",
    help: "Renders hair colour, makeup and clothes. Create one in the API Key tab of the YouCam console.",
  },
  {
    id: "groq",
    label: "Groq API key",
    envName: "GROQ_API_KEY",
    required: false,
    placeholder: "Optional (gsk_…)",
    help: "Optional. Saved for later; the studio does not use it yet.",
  },
  {
    id: "gemini",
    label: "Gemini API key",
    envName: "GEMINI_API_KEY",
    required: false,
    placeholder: "Optional (AIza…)",
    help: "Optional. Saved for later; the studio does not use it yet.",
  },
];

/** Request header that carries each key to the API routes. */
export const KEY_HEADER: Record<KeyId, string> = {
  youcam: "x-youcam-key",
  groq: "x-groq-key",
  gemini: "x-gemini-key",
};

export const STORAGE_KEY = "ms.settings.v1";
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 512;

/** Cleans what people paste: whitespace, surrounding quotes, a `Bearer ` prefix, `NAME=` prefixes. */
export function sanitizeKey(raw: string): string {
  let key = raw.trim();
  key = key.replace(/^[A-Z][A-Z0-9_]*\s*=\s*/, "");
  key = key.replace(/^(["'`])(.*)\1$/, "$2").trim();
  key = key.replace(/^Bearer\s+/i, "").trim();
  return key;
}

/** True when the value could be an API key: a single token of sensible length with no control characters. */
export function isPlausibleKey(key: string): boolean {
  return key.length >= MIN_KEY_LENGTH && key.length <= MAX_KEY_LENGTH && /^[\x21-\x7e]+$/.test(key);
}

export interface Settings {
  keys: Partial<Record<KeyId, string>>;
  mode: Mode;
}

export const EMPTY_SETTINGS: Settings = { keys: {}, mode: "mock" };

/** Reads stored settings defensively: anything unexpected falls back to the defaults. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { keys: {}, mode: "mock" };
  try {
    const value = JSON.parse(raw) as { keys?: Record<string, unknown>; mode?: unknown };
    const keys: Partial<Record<KeyId, string>> = {};
    for (const field of KEY_FIELDS) {
      const stored = value.keys?.[field.id];
      if (typeof stored === "string") {
        const clean = sanitizeKey(stored);
        if (isPlausibleKey(clean)) keys[field.id] = clean;
      }
    }
    return { keys, mode: value.mode === "youcam" ? "youcam" : "mock" };
  } catch {
    return { keys: {}, mode: "mock" };
  }
}

export function loadSettings(): Settings {
  try {
    return parseSettings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return { keys: {}, mode: "mock" };
  }
}

/** Returns false when the browser refused to store (private mode, blocked storage). */
export function saveSettings(settings: Settings): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}

export function clearSettings(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clear if storage is unavailable.
  }
}

/** Headers for an API call: only keys that look valid are sent. */
export function keyHeaders(keys: Partial<Record<KeyId, string>>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const field of KEY_FIELDS) {
    const key = keys[field.id];
    if (key && isPlausibleKey(key)) headers[KEY_HEADER[field.id]] = key;
  }
  return headers;
}
