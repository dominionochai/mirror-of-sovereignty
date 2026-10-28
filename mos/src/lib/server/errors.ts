/** A required server setting (usually an API key) is missing. Maps to HTTP 503. */
export class ConfigError extends Error {}

/** The request conflicts with current state (e.g. a run is already in progress). Maps to HTTP 409. */
export class ConflictError extends Error {}

/** The request was malformed or over a limit. Maps to HTTP 400. */
export class BadRequestError extends Error {}

/** An upstream provider failed or returned something unusable. Maps to HTTP 502. */
export class UpstreamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}
