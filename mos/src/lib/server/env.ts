import { ConfigError } from "./errors";

/** Returns a required environment variable or throws a {@link ConfigError} naming it. */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set. Add it to .env.local and restart the dev server.`);
  return value;
}
