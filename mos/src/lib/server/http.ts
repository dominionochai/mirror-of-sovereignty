import { BadRequestError, ConfigError, ConflictError, UpstreamError } from "./errors";

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Turns an error thrown by a route into a JSON response with a suitable status. */
export function errorResponse(error: unknown): Response {
  if (error instanceof BadRequestError) return json({ error: error.message }, 400);
  if (error instanceof ConflictError) return json({ error: error.message }, 409);
  if (error instanceof ConfigError) return json({ error: error.message }, 503);
  if (error instanceof UpstreamError) return json({ error: error.message }, 502);
  console.error("[api] unexpected error", error);
  return json({ error: "Unexpected server error." }, 500);
}

/** Reads a JSON body, rejecting anything larger than `maxBytes`. */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new BadRequestError("Request body is too large.");
  const text = await request.text();
  if (text.length > maxBytes) throw new BadRequestError("Request body is too large.");
  try {
    return JSON.parse(text);
  } catch {
    throw new BadRequestError("Request body must be valid JSON.");
  }
}
