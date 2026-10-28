import type { ResolvedLookEntry } from "./renderer";

/**
 * Pure builders for YouCam task bodies, following the public API reference
 * (docs.perfectcorp.com): POST /s2s/v2.0/task/hair-color and /task/makeup-vto.
 * Kept free of I/O so they can be unit tested.
 */

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const HEX = /^#[0-9a-fA-F]{6}$/;

export interface HairColorBody {
  pattern: { name: "full" };
  palettes: { color: string; color_intensity: number; shine_intensity: number }[];
}

/** One solid hair colour at the chosen strength. `color_intensity` is 0-100 in the API. */
export function buildHairColorBody(entry: ResolvedLookEntry): HairColorBody {
  if (!HEX.test(entry.color)) throw new Error(`Hair colour must be a 6-digit hex value, got "${entry.color}".`);
  return {
    pattern: { name: "full" },
    palettes: [{ color: entry.color, color_intensity: clamp(Math.round(entry.intensity), 0, 100), shine_intensity: 30 }],
  };
}

type Palette = { color: string; texture: string; colorIntensity: number };

export interface MakeupEffect {
  category: "lip_color" | "eye_shadow" | "blush";
  /** Required for lips. `name` must be a label from YouCam's lip shape catalog (e.g. "original"). */
  shape?: { name: string };
  /** Required for eye shadow and blush. `1color1` is the single-colour pattern. */
  pattern?: { name: string };
  /** Required for lips. */
  style?: { type: "full" };
  palettes: Palette[];
}

export interface MakeupBody {
  effects: MakeupEffect[];
  version: "1.0";
}

/**
 * Maps makeup entries to makeup-vto effects, following the API's OpenAPI spec:
 * lip_color needs shape + style + palettes, eye_shadow and blush need pattern +
 * palettes (one palette for the single-colour `1color1` pattern). Every palette
 * needs `texture` and `colorIntensity` (0-100); matte needs nothing else.
 */
export function buildMakeupBody(entries: ResolvedLookEntry[]): MakeupBody {
  const effects: MakeupEffect[] = [];
  for (const entry of entries) {
    if (!HEX.test(entry.color)) throw new Error(`Colour must be a 6-digit hex value, got "${entry.color}".`);
    const palette: Palette = { color: entry.color, texture: "matte", colorIntensity: clamp(Math.round(entry.intensity), 0, 100) };
    if (entry.groupId === "lips") {
      effects.push({ category: "lip_color", shape: { name: "original" }, style: { type: "full" }, palettes: [palette] });
    } else if (entry.groupId === "eyes") {
      effects.push({ category: "eye_shadow", pattern: { name: "1color1" }, palettes: [palette] });
    } else if (entry.groupId === "blush") {
      effects.push({ category: "blush", pattern: { name: "1color1" }, palettes: [palette] });
    }
  }
  return { effects, version: "1.0" };
}

/** Body for cloth-v4: the user's image plus a reference outfit (URL), as in the docs' example. */
export function buildClothBody(refFileUrl: string, garmentCategory: string): { ref_file_url: string; garment_category: string } {
  return { ref_file_url: refFileUrl, garment_category: garmentCategory };
}

/** Extracts the result image URL from a finished task. The docs show both `results.url` and `results[0].download_url`. */
export function extractResultUrl(data: unknown): string | null {
  const results = (data as { results?: unknown } | null)?.results;
  if (Array.isArray(results)) {
    const first = results[0] as { download_url?: string; url?: string } | undefined;
    return first?.download_url ?? first?.url ?? null;
  }
  const url = (results as { url?: string } | undefined)?.url;
  return typeof url === "string" ? url : null;
}
