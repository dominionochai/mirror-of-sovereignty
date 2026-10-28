import { isPlausibleKey, KEY_FIELDS, KEY_HEADER, sanitizeKey, type KeyId } from "../keys";
import { ConfigError } from "./errors";

/**
 * The key for a service: the request's header (entered on the start page) wins,
 * then the environment variable. The message never contains a key.
 */
export function keyFromRequest(request: Request, id: KeyId): string {
  const field = KEY_FIELDS.find((candidate) => candidate.id === id);
  if (!field) throw new ConfigError(`Unknown key "${id}".`);

  const header = request.headers.get(KEY_HEADER[id]);
  if (header) {
    const key = sanitizeKey(header);
    if (!isPlausibleKey(key)) throw new ConfigError(`The ${field.label} sent with the request does not look valid. Check it on the start page.`);
    return key;
  }
  const fromEnv = process.env[field.envName]?.trim();
  if (fromEnv) return fromEnv;
  throw new ConfigError(`${field.label} is not set. Add it on the start page, or set ${field.envName} in .env.local.`);
}
