import { findOption, parseSlot } from "./catalog";
import type { FaceGeometry } from "./face";
import { composeLayers } from "./overlays";
import type { Look } from "./types";

export interface RenderRequest {
  /** JPEG data URL of the user's face captured from the camera. */
  frame: string;
  /** Where the face is in that frame, used to place locally drawn layers. */
  face: FaceGeometry;
  look: Look;
}

export interface RenderResult {
  /** URL or data URL of the rendered image. */
  imageUrl: string;
  /** "mock" results are drawn locally and are not a real try-on. */
  source: "mock" | "youcam";
  /** Layers drawn locally on top of (or instead of) the remote result, for the UI to be honest about. */
  localSlots?: string[];
}

export interface TryOnRenderer {
  readonly name: string;
  render(request: RenderRequest, signal?: AbortSignal): Promise<RenderResult>;
}

/** One entry of a look, resolved against the catalog, as sent to the server. */
export interface ResolvedLookEntry {
  slot: string;
  categoryId: string;
  groupId: string;
  optionId: string;
  label: string;
  color: string;
  intensity: number;
  params?: Record<string, string | number>;
}

export function resolveLook(look: Look): ResolvedLookEntry[] {
  const entries: ResolvedLookEntry[] = [];
  for (const [slot, applied] of Object.entries(look)) {
    const { categoryId, groupId } = parseSlot(slot);
    const option = findOption(categoryId, groupId, applied.optionId);
    if (!option) continue;
    entries.push({
      slot, categoryId, groupId, optionId: option.id, label: option.label, color: option.color,
      intensity: applied.intensity, params: option.params,
    });
  }
  return entries;
}

/** Categories YouCam may render. Fashion is only rendered when the server has a reference garment for it. */
const REMOTE_CATEGORIES = new Set(["hair", "makeup", "fashion"]);

interface RemoteResponse {
  imageUrl?: string;
  /** Slots YouCam actually rendered. */
  handled?: string[];
  error?: string;
}

/**
 * Sends hair, makeup and (when configured) clothes to the server, which calls
 * YouCam with the secret key. Whatever YouCam has no API for (eyewear, earrings,
 * clothes without a reference garment) is drawn on top locally.
 */
export class RemoteRenderer implements TryOnRenderer {
  readonly name = "YouCam";

  /** Extra request headers, e.g. the API key entered on the start page. */
  constructor(private readonly headers: Record<string, string> = {}) {}

  async render(request: RenderRequest, signal?: AbortSignal): Promise<RenderResult> {
    const entries = resolveLook(request.look);
    const remoteEntries = entries.filter((entry) => REMOTE_CATEGORIES.has(entry.categoryId));

    let base = request.frame;
    let handled: string[] = [];
    if (remoteEntries.length > 0) {
      const response = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...this.headers },
        body: JSON.stringify({ frame: request.frame, look: remoteEntries }),
        signal,
      });
      const body = (await response.json().catch(() => ({}))) as RemoteResponse;
      if (!response.ok || !body.imageUrl) throw new Error(body.error ?? `Try-on failed (${response.status}).`);
      base = body.imageUrl;
      handled = body.handled ?? [];
    }

    const local = entries.filter((entry) => !handled.includes(entry.slot));
    const imageUrl = local.length > 0 ? await composeLayers(base, local, request.face) : base;
    return { imageUrl, source: "youcam", localSlots: local.map((entry) => entry.slot) };
  }
}
