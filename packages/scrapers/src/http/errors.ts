/** One request failed (HTTP error, network, robots.txt, or a block signal below the threshold). The run records it and goes on. */
export class FetchError extends Error {
  readonly url: string;
  readonly status: number | null;

  constructor(message: string, url: string, status: number | null = null) {
    super(message);
    this.name = "FetchError";
    this.url = url;
    this.status = status;
  }
}

/** robots.txt disallows the URL, so it was never requested. */
export class RobotsDisallowedError extends FetchError {
  constructor(url: string, message = "Disallowed by robots.txt") {
    super(message, url);
    this.name = "RobotsDisallowedError";
  }
}

/**
 * The store refuses our bot (repeated block signals, robots.txt refused, or a Retry-After longer than we wait).
 * The store stops for the day.
 */
export class StoreBlockedError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "StoreBlockedError";
    this.url = url;
  }
}

/** URLs in a row ended in 5xx or network errors after their retries. The store stops for the day and the run fails. */
export class StoreUnavailableError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "StoreUnavailableError";
    this.url = url;
  }
}

/** robots.txt could not be read (5xx or network errors after retries). RFC 9309 says to assume a full disallow. */
export class RobotsUnavailableError extends Error {
  readonly url: string;

  constructor(message: string, url: string) {
    super(message);
    this.name = "RobotsUnavailableError";
    this.url = url;
  }
}

/** Message of any thrown value, for logs and run errors. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
