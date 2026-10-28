import { setTimeout as delay } from "node:timers/promises";
import { BOT_USER_AGENT } from "@descontoreal/core";
import type { StoreScraper } from "../types";
import { detectBotChallenge } from "./challenge";
import { decodeBody } from "./decode";
import {
  errorMessage,
  FetchError,
  RobotsDisallowedError,
  RobotsUnavailableError,
  StoreBlockedError,
  StoreUnavailableError,
} from "./errors";
import type { Logger } from "./logger";
import { backoffDelayMs, isRetryableStatus, parseRetryAfter } from "./retry";
import { ALLOW_ALL, parseRobots, type RobotsRules } from "./robots";

/** HTTP client behind the fetcher: global fetch in production, a fake in tests. */
export type Transport = (url: string, init: RequestInit) => Promise<Response>;

export interface FetchedPage {
  /** Final URL, after redirects. */
  url: string;
  status: number;
  contentType: string | null;
  body: string;
}

/** What the runner needs from a fetcher. */
export interface PageFetcher {
  /**
   * GETs a page of the store. Throws FetchError when only this request failed (the run goes on), and
   * StoreBlockedError, StoreUnavailableError or RobotsUnavailableError when the run must stop.
   */
  fetchPage(url: string): Promise<FetchedPage>;
  /** false when robots.txt disallows the URL for our bot. Reads robots.txt on first use and throws like fetchPage. */
  robotsAllows(url: string): Promise<boolean>;
  /** Pages fetched successfully; robots.txt not included. */
  readonly pagesFetched: number;
}

export interface FetcherOptions {
  transport?: Transport;
  /** Random pause between consecutive requests; a larger robots.txt Crawl-delay wins. */
  minDelayMs?: number;
  maxDelayMs?: number;
  timeoutMs?: number;
  /** Attempts per request, the first one included. */
  maxAttempts?: number;
  retryBaseDelayMs?: number;
  /** A 429 or 503 whose Retry-After is longer stops the store for the day; a shorter one delays every later request. */
  maxRetryAfterMs?: number;
  /** Block signals in a row (403, 429 after retries, challenge page) that stop the store for the day. */
  blockThreshold?: number;
  /** URLs in a row ending in 5xx or network errors after their retries that stop the store for the day. */
  failureThreshold?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  clock?: () => Date;
  log?: Logger;
}

type FetcherSettings = Required<
  Pick<
    FetcherOptions,
    | "minDelayMs"
    | "maxDelayMs"
    | "timeoutMs"
    | "maxAttempts"
    | "retryBaseDelayMs"
    | "maxRetryAfterMs"
    | "blockThreshold"
    | "failureThreshold"
  >
>;

export const FETCHER_DEFAULTS: FetcherSettings = {
  minDelayMs: 2000,
  maxDelayMs: 5000,
  timeoutMs: 30_000,
  maxAttempts: 3,
  retryBaseDelayMs: 5000,
  maxRetryAfterMs: 120_000,
  blockThreshold: 3,
  failureThreshold: 5,
};

/** Location hops followed per request. */
export const MAX_REDIRECTS = 5;

const ACCEPT_LANGUAGE = "pt-PT,pt;q=0.9";
// Enough to recognise a challenge page without decoding a whole catalogue page twice.
const CHALLENGE_SCAN_BYTES = 32_768;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// The statuses whose Retry-After asks us to stay away (RFC 6585, RFC 9110).
const BACK_OFF_STATUSES = new Set([429, 503]);

type Sent = { ok: true; response: Response; bytes: Uint8Array } | { ok: false; error: unknown };

type Outcome =
  | { kind: "response"; response: Response; bytes: Uint8Array }
  | { kind: "blocked"; status: number; reason: string }
  | { kind: "wait-too-long"; status: number; reason: string }
  | { kind: "failed"; status: number | null; reason: string };

type Redirect = { kind: "none" } | { kind: "follow"; url: URL } | { kind: "refuse"; reason: string };

/**
 * Polite GET-only client for one store: one request at a time, a random pause between requests, robots.txt
 * read once per run, redirects followed by hand within the store's site, retries with backoff, and a stop for
 * the day when the store blocks us, asks us to stay away, or keeps failing.
 */
export class StoreFetcher implements PageFetcher {
  private readonly slug: string;
  private readonly origin: string;
  private readonly siteHost: string;
  private readonly pageHeaders: Headers;
  private readonly robotsHeaders: Headers;
  private readonly transport: Transport;
  private readonly settings: FetcherSettings;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly clock: () => Date;
  private readonly log: Logger;

  private queue: Promise<void> = Promise.resolve();
  private robots: Promise<RobotsRules> | null = null;
  private crawlDelayMs = 0;
  /** No request before this time (epoch ms), from the last Retry-After. */
  private notBefore = 0;
  private requestsMade = 0;
  private blockStreak = 0;
  private failureStreak = 0;
  private stopped: StoreBlockedError | StoreUnavailableError | null = null;
  private pages = 0;

  constructor(
    store: Pick<StoreScraper, "slug" | "baseUrl" | "requestHeaders">,
    options: FetcherOptions = {},
  ) {
    const base = new URL(store.baseUrl);
    this.slug = store.slug;
    this.origin = base.origin;
    this.siteHost = toSiteHost(base.hostname);
    this.robotsHeaders = new Headers({ "Accept-Language": ACCEPT_LANGUAGE, "User-Agent": BOT_USER_AGENT });
    this.pageHeaders = new Headers({ "Accept-Language": ACCEPT_LANGUAGE });
    for (const [name, value] of Object.entries(store.requestHeaders ?? {})) {
      this.pageHeaders.set(name, value);
    }
    // Set last: a store's headers never replace our identification.
    this.pageHeaders.set("User-Agent", BOT_USER_AGENT);
    this.transport = options.transport ?? ((url, init) => fetch(url, init));
    this.settings = {
      minDelayMs: options.minDelayMs ?? FETCHER_DEFAULTS.minDelayMs,
      maxDelayMs: options.maxDelayMs ?? FETCHER_DEFAULTS.maxDelayMs,
      timeoutMs: options.timeoutMs ?? FETCHER_DEFAULTS.timeoutMs,
      maxAttempts: options.maxAttempts ?? FETCHER_DEFAULTS.maxAttempts,
      retryBaseDelayMs: options.retryBaseDelayMs ?? FETCHER_DEFAULTS.retryBaseDelayMs,
      maxRetryAfterMs: options.maxRetryAfterMs ?? FETCHER_DEFAULTS.maxRetryAfterMs,
      blockThreshold: options.blockThreshold ?? FETCHER_DEFAULTS.blockThreshold,
      failureThreshold: options.failureThreshold ?? FETCHER_DEFAULTS.failureThreshold,
    };
    this.sleep = options.sleep ?? ((ms) => delay(ms));
    this.random = options.random ?? Math.random;
    this.clock = options.clock ?? (() => new Date());
    this.log = options.log ?? console;
  }

  get pagesFetched(): number {
    return this.pages;
  }

  fetchPage(url: string): Promise<FetchedPage> {
    return this.inTurn(() => this.fetchInTurn(url));
  }

  robotsAllows(url: string): Promise<boolean> {
    return this.inTurn(async () => {
      const robots = await this.loadRobotsOnce();
      return !URL.canParse(url) || robots.isAllowed(url);
    });
  }

  /** One task at a time, in call order: robots.txt and pages share the store's single request slot. */
  private async inTurn<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.queue;
    let release = (): void => undefined;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      return await task();
    } finally {
      release();
    }
  }

  private async fetchInTurn(url: string): Promise<FetchedPage> {
    this.throwIfStopped(url);
    const requested = this.toStoreUrl(url);
    const robots = await this.loadRobotsOnce();
    if (!robots.isAllowed(requested.href)) {
      throw new RobotsDisallowedError(requested.href);
    }
    const visited = new Set([requested.href]);
    let target = requested;
    for (;;) {
      const { response, bytes } = await this.requestPage(target.href);
      const redirect = this.redirectFrom(target, response, visited);
      if (redirect.kind === "refuse") {
        throw new FetchError(redirect.reason, target.href, response.status);
      }
      if (redirect.kind === "follow") {
        if (!robots.isAllowed(redirect.url.href)) {
          throw new RobotsDisallowedError(
            redirect.url.href,
            `Redirected to ${redirect.url.href}, which robots.txt disallows`,
          );
        }
        visited.add(redirect.url.href);
        target = redirect.url;
        continue;
      }
      this.blockStreak = 0;
      if (!response.ok) {
        const where = target === requested ? "" : ` after a redirect to ${target.href}`;
        throw new FetchError(`HTTP ${response.status}${where}`, target.href, response.status);
      }
      this.pages += 1;
      const contentType = response.headers.get("content-type");
      return { url: target.href, status: response.status, contentType, body: decodeBody(bytes, contentType) };
    }
  }

  /** One page request or redirect hop. Throws for block signals, failures after retries and stops. */
  private async requestPage(url: string): Promise<{ response: Response; bytes: Uint8Array }> {
    const outcome = await this.request(url, this.pageHeaders);
    switch (outcome.kind) {
      case "wait-too-long":
        throw this.stop(new StoreBlockedError(`${this.slug} asks us to stay away: ${outcome.reason}`, url));
      case "blocked":
        this.failureStreak = 0;
        throw this.blockSignal(url, outcome.status, outcome.reason);
      case "failed":
        throw this.serverFailure(url, outcome.status, outcome.reason);
      case "response":
        this.failureStreak = 0;
        if (outcome.response.status === 403) {
          throw this.blockSignal(url, 403, "HTTP 403");
        }
        return outcome;
    }
  }

  private toStoreUrl(url: string): URL {
    if (!URL.canParse(url)) {
      throw new FetchError("Invalid URL", url);
    }
    const target = new URL(url);
    if (!this.isStoreSite(target)) {
      throw new FetchError(`Not on the store's site (${this.siteHost})`, url);
    }
    return target;
  }

  private isStoreSite(url: URL): boolean {
    return (
      (url.protocol === "https:" || url.protocol === "http:") && toSiteHost(url.hostname) === this.siteHost
    );
  }

  /** Where a redirect leads; refused when it leaves the store's site, loops or makes too many hops. */
  private redirectFrom(from: URL, response: Response, visited: ReadonlySet<string>): Redirect {
    if (!REDIRECT_STATUSES.has(response.status)) {
      return { kind: "none" };
    }
    const location = response.headers.get("location");
    if (location === null || !URL.canParse(location, from.href)) {
      return { kind: "refuse", reason: `HTTP ${response.status} without a valid Location` };
    }
    const next = new URL(location, from.href);
    if (!this.isStoreSite(next)) {
      return { kind: "refuse", reason: `Redirected off the store's site, to ${next.host}` };
    }
    if (visited.has(next.href)) {
      return { kind: "refuse", reason: `Redirect loop at ${next.href}` };
    }
    if (visited.size > MAX_REDIRECTS) {
      return { kind: "refuse", reason: `More than ${MAX_REDIRECTS} redirects` };
    }
    return { kind: "follow", url: next };
  }

  private blockSignal(url: string, status: number, reason: string): FetchError | StoreBlockedError {
    this.blockStreak += 1;
    const { blockThreshold } = this.settings;
    this.log.warn(`${this.slug}: block signal ${this.blockStreak} of ${blockThreshold}: ${reason} (${url})`);
    if (this.blockStreak >= blockThreshold) {
      return this.stop(
        new StoreBlockedError(
          `${this.slug} blocks our bot: ${reason}, ${this.blockStreak} times in a row`,
          url,
        ),
      );
    }
    return new FetchError(`${reason} (block signal ${this.blockStreak} of ${blockThreshold})`, url, status);
  }

  /** A URL still failing after its retries. Never resets the block streak: a store may answer 403 and 503 in turn. */
  private serverFailure(
    url: string,
    status: number | null,
    reason: string,
  ): FetchError | StoreUnavailableError {
    this.failureStreak += 1;
    if (this.failureStreak >= this.settings.failureThreshold) {
      return this.stop(
        new StoreUnavailableError(
          `${this.slug} keeps failing: ${reason}, ${this.failureStreak} URLs in a row`,
          url,
        ),
      );
    }
    return new FetchError(reason, url, status);
  }

  private stop<T extends StoreBlockedError | StoreUnavailableError>(error: T): T {
    this.stopped = error;
    return error;
  }

  private throwIfStopped(url: string): void {
    if (this.stopped instanceof StoreBlockedError) {
      throw new StoreBlockedError(this.stopped.message, url);
    }
    if (this.stopped instanceof StoreUnavailableError) {
      throw new StoreUnavailableError(this.stopped.message, url);
    }
  }

  private loadRobotsOnce(): Promise<RobotsRules> {
    this.robots ??= this.loadRobots();
    return this.robots;
  }

  /** robots.txt through the same request path, following redirects within the store's site (RFC 9309, 5 hops). */
  private async loadRobots(): Promise<RobotsRules> {
    const robotsUrl = `${this.origin}/robots.txt`;
    const visited = new Set([robotsUrl]);
    let target = new URL(robotsUrl);
    for (;;) {
      const outcome = await this.request(target.href, this.robotsHeaders);
      if (outcome.kind === "wait-too-long") {
        throw this.stop(
          new StoreBlockedError(
            `${this.slug} asks us to stay away: robots.txt got ${outcome.reason}`,
            robotsUrl,
          ),
        );
      }
      if (outcome.kind === "blocked") {
        throw this.stop(
          new StoreBlockedError(`${this.slug} blocks our bot: robots.txt got ${outcome.reason}`, robotsUrl),
        );
      }
      if (outcome.kind === "failed") {
        throw new RobotsUnavailableError(`robots.txt unavailable: ${outcome.reason}`, robotsUrl);
      }
      const { response, bytes } = outcome;
      const redirect = this.redirectFrom(target, response, visited);
      if (redirect.kind === "refuse") {
        throw new RobotsUnavailableError(`robots.txt unavailable: ${redirect.reason}`, robotsUrl);
      }
      if (redirect.kind === "follow") {
        visited.add(redirect.url.href);
        target = redirect.url;
        continue;
      }
      if (response.status === 401 || response.status === 403) {
        throw this.stop(
          new StoreBlockedError(
            `${this.slug} blocks our bot: robots.txt got HTTP ${response.status}`,
            robotsUrl,
          ),
        );
      }
      if (!response.ok) {
        this.log.info(`${this.slug}: robots.txt got HTTP ${response.status}; every URL is allowed`);
        return ALLOW_ALL;
      }
      // The rules apply to the store's own origin, wherever the redirects led.
      const rules = parseRobots(robotsUrl, decodeBody(bytes, response.headers.get("content-type")));
      if (rules.crawlDelayMs !== null) {
        this.crawlDelayMs = rules.crawlDelayMs;
        this.log.info(
          `${this.slug}: robots.txt asks for a Crawl-delay of ${formatSeconds(rules.crawlDelayMs)}`,
        );
      }
      return rules;
    }
  }

  /**
   * One logical request: pacing, retries for network errors, 5xx and 429, and challenge detection. A Retry-After
   * within the cap holds back every later request, not only the retry.
   */
  private async request(url: string, headers: Headers): Promise<Outcome> {
    const { maxAttempts, maxRetryAfterMs, retryBaseDelayMs } = this.settings;
    let waitMs = 0;
    for (let attempt = 1; ; attempt += 1) {
      await this.pace(waitMs);
      const lastAttempt = attempt >= maxAttempts;
      const sent = await this.send(url, headers);
      if (!sent.ok) {
        const reason = `network error: ${errorMessage(sent.error)}`;
        if (lastAttempt) {
          return { kind: "failed", status: null, reason: `${reason} (${attempt} attempts)` };
        }
        waitMs = backoffDelayMs(attempt, retryBaseDelayMs, this.random);
        this.log.warn(`${this.slug}: ${reason}; retrying in ${formatSeconds(waitMs)} (${url})`);
        continue;
      }
      const { response, bytes } = sent;
      const head = Buffer.from(
        bytes.buffer,
        bytes.byteOffset,
        Math.min(bytes.byteLength, CHALLENGE_SCAN_BYTES),
      );
      const challenge = detectBotChallenge(response.status, response.headers, head.toString("latin1"));
      if (challenge !== null) {
        return {
          kind: "blocked",
          status: response.status,
          reason: `${challenge} challenge (HTTP ${response.status})`,
        };
      }
      if (!isRetryableStatus(response.status)) {
        return { kind: "response", response, bytes };
      }
      const now = this.clock().getTime();
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"), new Date(now));
      if (retryAfterMs !== null && retryAfterMs > maxRetryAfterMs) {
        const reason = `HTTP ${response.status} with Retry-After ${formatSeconds(retryAfterMs)}`;
        if (BACK_OFF_STATUSES.has(response.status)) {
          const cap = formatSeconds(maxRetryAfterMs);
          return {
            kind: "wait-too-long",
            status: response.status,
            reason: `${reason}, longer than the ${cap} we wait`,
          };
        }
        return { kind: "failed", status: response.status, reason };
      }
      if (retryAfterMs !== null) {
        this.notBefore = Math.max(this.notBefore, now + retryAfterMs);
      }
      if (lastAttempt) {
        const reason = `HTTP ${response.status} (${attempt} attempts)`;
        return response.status === 429
          ? { kind: "blocked", status: response.status, reason }
          : { kind: "failed", status: response.status, reason };
      }
      waitMs = backoffDelayMs(attempt, retryBaseDelayMs, this.random);
      this.log.warn(
        `${this.slug}: HTTP ${response.status}; retrying in ${formatSeconds(Math.max(waitMs, retryAfterMs ?? 0))} (${url})`,
      );
    }
  }

  /**
   * Waits before every request but the first: a random pause, raised to the Crawl-delay, a retry wait or the
   * time a Retry-After asked for.
   */
  private async pace(retryWaitMs: number): Promise<void> {
    if (this.requestsMade === 0) {
      return;
    }
    const { minDelayMs, maxDelayMs } = this.settings;
    const pauseMs = Math.round(minDelayMs + this.random() * (maxDelayMs - minDelayMs));
    const backOffMs = this.notBefore - this.clock().getTime();
    const waitMs = Math.max(pauseMs, this.crawlDelayMs, retryWaitMs, backOffMs);
    if (waitMs > 0) {
      await this.sleep(waitMs);
    }
  }

  private async send(url: string, headers: Headers): Promise<Sent> {
    this.requestsMade += 1;
    try {
      const response = await this.transport(url, {
        method: "GET",
        headers: new Headers(headers),
        // Every hop is checked against the store's site and robots.txt before it is requested.
        redirect: "manual",
        signal: AbortSignal.timeout(this.settings.timeoutMs),
      });
      return { ok: true, response, bytes: new Uint8Array(await response.arrayBuffer()) };
    } catch (error) {
      return { ok: false, error };
    }
  }
}

function toSiteHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

function formatSeconds(ms: number): string {
  return `${Math.round(ms / 100) / 10} s`;
}
