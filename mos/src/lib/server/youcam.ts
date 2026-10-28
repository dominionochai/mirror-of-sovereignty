import { UpstreamError } from "./errors";
import { extractResultUrl } from "../tryon/youcamPayloads";

/**
 * YouCam (Perfect Corp) API client, following the public API reference:
 *   POST /s2s/v2.0/file                 -> upload URL + file_id
 *   POST /s2s/v2.0/task/<feature>       -> task_id
 *   GET  /s2s/v2.0/task/<feature>/<id>  -> task_status running | success | error
 * Auth is `Authorization: Bearer <API key>`. Results are only kept for hours,
 * so callers should download them straight away.
 */
export const DEFAULT_YOUCAM_BASE_URL = "https://yce-api-01.makeupar.com";

export const YOUCAM_TASKS = {
  hairColor: "/s2s/v2.0/task/hair-color",
  makeup: "/s2s/v2.0/task/makeup-vto",
  cloth: "/s2s/v2.0/task/cloth-v4",
} as const;

const FILE_PATH = "/s2s/v2.0/file";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 60_000;

function baseUrl(): string {
  return (process.env.YOUCAM_BASE_URL?.trim() || DEFAULT_YOUCAM_BASE_URL).replace(/\/$/, "");
}

async function youcamFetch(apiKey: string, path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) throw new UpstreamError(`YouCam returned ${response.status}: ${text.slice(0, 300)}`, response.status);
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new UpstreamError("YouCam returned a response that is not JSON.");
  }
}

/** Decodes a base64 `data:` URL into bytes and its content type. */
export function parseDataUrl(dataUrl: string): { bytes: Buffer; contentType: string } {
  const match = /^data:([\w/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new UpstreamError("The image was not a base64 data URL.");
  return { contentType: match[1], bytes: Buffer.from(match[2], "base64") };
}

interface FileResponse {
  files?: { file_id?: string; requests?: { url?: string; method?: string; headers?: Record<string, string | number> }[] }[];
}

/** The File API's examples declare JPEGs as `image/jpg`. */
export function declaredContentType(contentType: string): string {
  return contentType === "image/jpeg" ? "image/jpg" : contentType;
}

/** Uploads an image through the File API and returns its file id. */
export async function uploadImage(apiKey: string, dataUrl: string): Promise<string> {
  const { bytes, contentType } = parseDataUrl(dataUrl);
  const created = (await youcamFetch(apiKey, FILE_PATH, {
    method: "POST",
    body: JSON.stringify({ files: [{ content_type: declaredContentType(contentType), file_name: "frame.jpg", file_size: bytes.length }] }),
  })) as FileResponse;

  const file = created.files?.[0];
  const upload = file?.requests?.[0];
  if (!file?.file_id || !upload?.url) throw new UpstreamError("YouCam's File API response did not contain an upload URL.");

  // Use exactly the headers YouCam returned for the upload; fall back to the image's own type.
  const headers: Record<string, string> = { "Content-Type": contentType };
  for (const [name, value] of Object.entries(upload.headers ?? {})) headers[name] = String(value);
  const response = await fetch(upload.url, { method: upload.method ?? "PUT", headers, body: new Uint8Array(bytes) });
  if (!response.ok) throw new UpstreamError(`Uploading the image failed (${response.status}).`, response.status);
  return file.file_id;
}

/** Creates a task, polls it until it finishes and returns the result image URL. */
export async function runTask(apiKey: string, taskPath: string, body: Record<string, unknown>): Promise<string> {
  const created = await youcamFetch(apiKey, taskPath, { method: "POST", body: JSON.stringify(body) });
  const taskId = (created.data as { task_id?: string } | undefined)?.task_id;
  if (!taskId) throw new UpstreamError("YouCam did not return a task id.");

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const polled = await youcamFetch(apiKey, `${taskPath}/${encodeURIComponent(taskId)}`, { method: "GET" });
    const data = polled.data as { task_status?: string; error?: string | null; error_message?: string } | undefined;
    if (data?.task_status === "success") {
      const url = extractResultUrl(data);
      if (!url) throw new UpstreamError("YouCam finished but returned no result image.");
      return url;
    }
    if (data?.task_status === "error") {
      throw new UpstreamError(`YouCam could not process this image: ${data.error_message ?? data.error ?? "unknown error"}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new UpstreamError("YouCam took too long to respond.");
}

/** Downloads a result image and returns it as a data URL, so the browser can draw on it without CORS limits. */
export async function downloadAsDataUrl(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new UpstreamError(`Could not download the result image (${response.status}).`);
  const type = response.headers.get("content-type") ?? "image/jpeg";
  return `data:${type};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
}

/** Cheap key check: asks the File API for an upload slot, which needs a valid key but does no processing. */
export async function checkYoucamKey(apiKey: string): Promise<void> {
  const response = await fetch(`${baseUrl()}${FILE_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ files: [{ content_type: "image/jpg", file_name: "key-check.jpg", file_size: 1024 }] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 401 || response.status === 403) throw new UpstreamError("YouCam rejected this key.", response.status);
  if (!response.ok) throw new UpstreamError(`YouCam returned ${response.status} for the key check.`, response.status);
}
