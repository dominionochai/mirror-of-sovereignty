import { BadRequestError } from "@/lib/server/errors";
import { keyFromRequest } from "@/lib/server/credentials";
import { errorResponse, json, readJson } from "@/lib/server/http";
import { downloadAsDataUrl, runTask, uploadImage, YOUCAM_TASKS } from "@/lib/server/youcam";
import type { ResolvedLookEntry } from "@/lib/tryon/renderer";
import { buildClothBody, buildHairColorBody, buildMakeupBody } from "@/lib/tryon/youcamPayloads";

export const runtime = "nodejs";
// Each feature is an upload plus a task with polling, so a full look can take a while.
export const maxDuration = 120;

const MAX_BODY_BYTES = 4_000_000;
const MAX_ENTRIES = 12;
const REMOTE_CATEGORIES = ["hair", "makeup", "fashion"];

function parseBody(body: unknown): { frame: string; look: ResolvedLookEntry[] } {
  const value = body as { frame?: unknown; look?: unknown };
  if (typeof value?.frame !== "string" || !value.frame.startsWith("data:image/")) {
    throw new BadRequestError("`frame` must be an image data URL.");
  }
  if (!Array.isArray(value.look) || value.look.length === 0 || value.look.length > MAX_ENTRIES) {
    throw new BadRequestError(`\`look\` must list between 1 and ${MAX_ENTRIES} items.`);
  }
  const look = value.look.map((raw): ResolvedLookEntry => {
    const entry = raw as Partial<ResolvedLookEntry>;
    if (
      typeof entry.slot !== "string" || typeof entry.categoryId !== "string" || !REMOTE_CATEGORIES.includes(entry.categoryId) ||
      typeof entry.groupId !== "string" || typeof entry.optionId !== "string" || typeof entry.label !== "string" ||
      typeof entry.color !== "string" || typeof entry.intensity !== "number"
    ) {
      throw new BadRequestError("Each look item needs slot, categoryId, groupId, optionId, label, color and intensity.");
    }
    return {
      slot: entry.slot, categoryId: entry.categoryId, groupId: entry.groupId, optionId: entry.optionId, label: entry.label,
      color: entry.color, intensity: Math.max(0, Math.min(100, entry.intensity)), params: entry.params,
    };
  });
  return { frame: value.frame, look };
}

/**
 * Reference garment for clothes: the option's own `ref_file_url`, or an
 * environment variable such as YOUCAM_CLOTH_REF_JACKET_FORMAL. YouCam's clothes
 * try-on needs a reference outfit image, so without one the garment is drawn locally.
 */
function clothReference(entry: ResolvedLookEntry): string | null {
  const own = entry.params?.ref_file_url;
  if (typeof own === "string" && own) return own;
  const envName = `YOUCAM_CLOTH_REF_${entry.optionId.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
  return process.env[envName]?.trim() || null;
}

export async function POST(request: Request) {
  try {
    const apiKey = keyFromRequest(request, "youcam");
    const { frame, look } = parseBody(await readJson(request, MAX_BODY_BYTES));
    const hair = look.filter((entry) => entry.categoryId === "hair" && entry.groupId === "color");
    const makeup = look.filter((entry) => entry.categoryId === "makeup");
    const clothes = look
      .map((entry) => ({ entry, ref: entry.categoryId === "fashion" ? clothReference(entry) : null }))
      .filter((item): item is { entry: ResolvedLookEntry; ref: string } => item.ref !== null);

    const handled: string[] = [];
    // Each step reads the previous result by URL (YouCam accepts `src_file_url`), so the frame is uploaded once.
    let source: Record<string, unknown> | null = null;
    let resultUrl: string | null = null;
    const sourceFor = async () => source ?? (source = { src_file_id: await uploadImage(apiKey, frame) });

    if (hair.length > 0) {
      resultUrl = await runTask(apiKey, YOUCAM_TASKS.hairColor, { ...(await sourceFor()), ...buildHairColorBody(hair[0]) });
      source = { src_file_url: resultUrl };
      handled.push(hair[0].slot);
    }
    if (makeup.length > 0) {
      const body = buildMakeupBody(makeup);
      if (body.effects.length > 0) {
        resultUrl = await runTask(apiKey, YOUCAM_TASKS.makeup, { ...(await sourceFor()), ...body });
        source = { src_file_url: resultUrl };
        handled.push(...makeup.map((entry) => entry.slot));
      }
    }
    if (clothes.length > 0) {
      const { entry, ref } = clothes[0];
      const category = process.env.YOUCAM_CLOTH_CATEGORY?.trim() || "auto";
      resultUrl = await runTask(apiKey, YOUCAM_TASKS.cloth, { ...(await sourceFor()), ...buildClothBody(ref, category) });
      handled.push(entry.slot);
    }

    // Nothing for YouCam to do: hand the frame back so the client can draw the rest.
    return json({ imageUrl: resultUrl ? await downloadAsDataUrl(resultUrl) : frame, handled });
  } catch (error) {
    return errorResponse(error);
  }
}
