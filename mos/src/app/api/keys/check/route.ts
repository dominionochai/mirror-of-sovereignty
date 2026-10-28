import { keyFromRequest } from "@/lib/server/credentials";
import { ConfigError, UpstreamError } from "@/lib/server/errors";
import { errorResponse, json } from "@/lib/server/http";
import { checkYoucamKey } from "@/lib/server/youcam";
import type { KeyId } from "@/lib/keys";

export const runtime = "nodejs";

type Result = { ok: boolean; message: string };

async function checkGet(url: string, headers: Record<string, string>, name: string): Promise<void> {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
  if (response.status === 401 || response.status === 403 || response.status === 400) throw new UpstreamError(`${name} rejected this key.`, response.status);
  if (!response.ok) throw new UpstreamError(`${name} returned ${response.status}.`, response.status);
}

async function check(request: Request, id: KeyId): Promise<Result> {
  let key: string;
  try {
    key = keyFromRequest(request, id);
  } catch (error) {
    if (error instanceof ConfigError) return { ok: false, message: "No key entered." };
    throw error;
  }
  try {
    if (id === "youcam") await checkYoucamKey(key);
    if (id === "groq") await checkGet("https://api.groq.com/openai/v1/models", { Authorization: `Bearer ${key}` }, "Groq");
    if (id === "gemini") await checkGet("https://generativelanguage.googleapis.com/v1beta/models", { "x-goog-api-key": key }, "Gemini");
    return { ok: true, message: "Key accepted." };
  } catch (error) {
    if (error instanceof UpstreamError) return { ok: false, message: error.message };
    return { ok: false, message: "Could not reach the service to check this key." };
  }
}

/** Checks every key sent in the request headers. Keys are never logged or returned. */
export async function POST(request: Request) {
  try {
    const [youcam, groq, gemini] = await Promise.all([check(request, "youcam"), check(request, "groq"), check(request, "gemini")]);
    return json({ youcam, groq, gemini });
  } catch (error) {
    return errorResponse(error);
  }
}
