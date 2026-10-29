import { BOT_POLICY, BOT_USER_AGENT } from "@descontoreal/core";
import { describe, expect, it } from "vitest";
import {
  FetchError,
  RobotsDisallowedError,
  RobotsUnavailableError,
  StoreBlockedError,
} from "../../src/http/errors";
import { FETCHER_DEFAULTS, type FetcherOptions, StoreFetcher } from "../../src/http/fetcher";
import type { Logger } from "../../src/http/logger";
import {
  fakeTransport,
  redirectResponse,
  type Reply,
  textResponse,
  type TransportCall,
} from "../fakes/fake-transport";

const NOW = new Date("2026-10-28T03:00:00Z");
const BASE = "https://loja.test";
const ROBOTS = `${BASE}/robots.txt`;
const PAGE = `${BASE}/c/televisores`;
const WWW_PAGE = "https://www.loja.test/c/televisores";
const OTHER = `${BASE}/c/monitores`;
const silentLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

interface Setup {
  fetcher: StoreFetcher;
  calls: TransportCall[];
  sleeps: number[];
}

/**
 * No pauses by default, backoff base 1 s with no jitter, a clock that only moves when the fetcher sleeps, and a
 * robots.txt that allows everything.
 */
function setup(
  routes: Record<string, Reply | Reply[]>,
  options: FetcherOptions = {},
  requestHeaders?: Record<string, string>,
): Setup {
  const { transport, calls } = fakeTransport({
    [ROBOTS]: textResponse("User-agent: *\nDisallow:"),
    ...routes,
  });
  const sleeps: number[] = [];
  let nowMs = NOW.getTime();
  const fetcher = new StoreFetcher(
    { slug: "darty", baseUrl: BASE, requestHeaders },
    {
      transport,
      minDelayMs: 0,
      maxDelayMs: 0,
      retryBaseDelayMs: 1000,
      random: () => 0,
      clock: () => new Date(nowMs),
      sleep: (ms) => {
        sleeps.push(ms);
        nowMs += ms;
        return Promise.resolve();
      },
      log: silentLog,
      ...options,
    },
  );
  return { fetcher, calls, sleeps };
}

function urlsOf(calls: readonly TransportCall[]): string[] {
  return calls.map((call) => call.url);
}

/** Error name of each settled fetch, or "page" for a page. */
function outcomesOf(results: readonly unknown[]): string[] {
  return results.map((result) => (result instanceof Error ? result.name : "page"));
}

/** Fetches the URLs one after the other, keeping each page or error. */
async function fetchEach(fetcher: StoreFetcher, urls: readonly string[]): Promise<unknown[]> {
  const results: unknown[] = [];
  for (const url of urls) {
    results.push(await settle(fetcher.fetchPage(url)));
  }
  return results;
}

function headerOf(call: TransportCall | undefined, name: string): string | null {
  return new Headers(call?.init.headers).get(name);
}

/** The value or the error of a promise, so Act and Assert stay apart. */
async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

describe("StoreFetcher requests", () => {
  it("reads robots.txt once, then GETs pages with our User-Agent and pt-PT", async () => {
    // Arrange
    const { fetcher, calls } = setup({
      [PAGE]: textResponse("<p>tv</p>"),
      [`${PAGE}?page=2`]: textResponse("<p>tv 2</p>"),
    });

    // Act
    const first = await fetcher.fetchPage(PAGE);
    const second = await fetcher.fetchPage(`${PAGE}?page=2`);

    // Assert
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, `${PAGE}?page=2`]);
    expect(calls.map((call) => call.init.method)).toEqual(["GET", "GET", "GET"]);
    expect(headerOf(calls[1], "user-agent")).toBe(BOT_USER_AGENT);
    expect(headerOf(calls[1], "accept-language")).toBe("pt-PT,pt;q=0.9");
    expect([first.body, second.body]).toEqual(["<p>tv</p>", "<p>tv 2</p>"]);
    expect(fetcher.pagesFetched).toBe(2);
  });

  it("adds the store's headers but never lets them replace the User-Agent", async () => {
    // Arrange
    const { fetcher, calls } = setup(
      { [PAGE]: textResponse("{}") },
      {},
      {
        Accept: "application/json",
        "user-agent": "Mozilla/5.0",
      },
    );

    // Act
    await fetcher.fetchPage(PAGE);

    // Assert
    expect(headerOf(calls[1], "accept")).toBe("application/json");
    expect(headerOf(calls[1], "user-agent")).toBe(BOT_USER_AGENT);
  });

  it("never requests URLs outside the store's site", async () => {
    // Arrange
    const { fetcher, calls } = setup({});

    // Act
    const result = await settle(fetcher.fetchPage("https://outra.test/produto"));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect(calls).toEqual([]);
  });

  it("counts only the pages fetched successfully", async () => {
    // Arrange
    const { fetcher } = setup({ [`${BASE}/a`]: textResponse("a"), [`${BASE}/b`]: textResponse("gone", 404) });

    // Act
    await fetcher.fetchPage(`${BASE}/a`);
    const missing = await settle(fetcher.fetchPage(`${BASE}/b`));

    // Assert
    expect(missing).toBeInstanceOf(FetchError);
    expect((missing as FetchError).status).toBe(404);
    expect(fetcher.pagesFetched).toBe(1);
  });
});

describe("StoreFetcher robots.txt", () => {
  it("never requests a URL that robots.txt disallows", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [ROBOTS]: textResponse("User-agent: *\nDisallow: /pesquisa") });

    // Act
    const result = await settle(fetcher.fetchPage(`${BASE}/pesquisa?q=tv`));

    // Assert
    expect(result).toBeInstanceOf(RobotsDisallowedError);
    expect(urlsOf(calls)).toEqual([ROBOTS]);
  });

  it("allows every URL when robots.txt is missing", async () => {
    // Arrange
    const { fetcher } = setup({
      [ROBOTS]: textResponse("Not found", 404),
      [`${BASE}/qualquer`]: textResponse("ok"),
    });

    // Act
    const page = await fetcher.fetchPage(`${BASE}/qualquer`);

    // Assert
    expect(page.body).toBe("ok");
  });

  it("stops the store when robots.txt answers 403, without requesting the page", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [ROBOTS]: textResponse("Access Denied", 403) });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(StoreBlockedError);
    expect(urlsOf(calls)).toEqual([ROBOTS]);
  });

  it("fails the run when robots.txt keeps answering 5xx", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [ROBOTS]: textResponse("Bad gateway", 502) });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(RobotsUnavailableError);
    expect(urlsOf(calls)).toEqual([ROBOTS, ROBOTS, ROBOTS]);
  });

  it("tells the runner which URLs robots.txt disallows, from the one robots.txt read", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [ROBOTS]: textResponse("User-agent: *\nDisallow: /pesquisa") });

    // Act
    const answers = [
      await fetcher.robotsAllows(PAGE),
      await fetcher.robotsAllows(`${BASE}/pesquisa?q=tv`),
      await fetcher.robotsAllows(OTHER),
    ];

    // Assert
    expect(answers).toEqual([true, false, true]);
    expect(urlsOf(calls)).toEqual([ROBOTS]);
  });

  it("follows a robots.txt redirect within the store's site and applies its rules", async () => {
    // Arrange
    const wwwRobots = "https://www.loja.test/robots.txt";
    const { fetcher, calls } = setup({
      [ROBOTS]: redirectResponse(wwwRobots),
      [wwwRobots]: textResponse("User-agent: *\nDisallow: /pesquisa"),
    });

    // Act
    const result = await settle(fetcher.fetchPage(`${BASE}/pesquisa?q=tv`));

    // Assert
    expect(result).toBeInstanceOf(RobotsDisallowedError);
    expect(urlsOf(calls)).toEqual([ROBOTS, wwwRobots]);
  });

  it("fails the run when robots.txt redirects off the store's site, without following it", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [ROBOTS]: redirectResponse("https://outra.test/robots.txt", 302) });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(RobotsUnavailableError);
    expect((result as RobotsUnavailableError).message).toMatch(/outra\.test/);
    expect(urlsOf(calls)).toEqual([ROBOTS]);
  });
});

describe("StoreFetcher pacing", () => {
  it("paces and backs off by default as the bot page says (BOT_POLICY)", () => {
    // Act
    const { minDelayMs, maxDelayMs, maxRetryAfterMs } = FETCHER_DEFAULTS;

    // Assert
    expect({ minDelayMs, maxDelayMs, maxRetryAfterMs }).toEqual({
      minDelayMs: BOT_POLICY.minDelayMs,
      maxDelayMs: BOT_POLICY.maxDelayMs,
      maxRetryAfterMs: BOT_POLICY.maxRetryAfterMs,
    });
  });

  it("makes one request at a time, with the random 2-5 s pause between requests", async () => {
    // Arrange
    const events: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const tracked =
      (body: string): Reply =>
      async (url) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        events.push(`GET ${new URL(url).pathname}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return textResponse(body);
      };
    const { fetcher } = setup(
      {
        [ROBOTS]: tracked("User-agent: *\nDisallow:"),
        [`${BASE}/a`]: tracked("a"),
        [`${BASE}/b`]: tracked("b"),
        [`${BASE}/c`]: tracked("c"),
      },
      {
        minDelayMs: 2000,
        maxDelayMs: 5000,
        random: () => 0.25,
        sleep: (ms) => {
          events.push(`sleep ${ms}`);
          return Promise.resolve();
        },
      },
    );

    // Act
    const pages = await Promise.all([
      fetcher.fetchPage(`${BASE}/a`),
      fetcher.fetchPage(`${BASE}/b`),
      fetcher.fetchPage(`${BASE}/c`),
    ]);

    // Assert
    expect(maxInFlight).toBe(1);
    expect(events).toEqual([
      "GET /robots.txt",
      "sleep 2750",
      "GET /a",
      "sleep 2750",
      "GET /b",
      "sleep 2750",
      "GET /c",
    ]);
    expect(pages.map((page) => page.body)).toEqual(["a", "b", "c"]);
  });

  it("waits the robots.txt Crawl-delay when it is longer than the pause", async () => {
    // Arrange
    const { fetcher, sleeps } = setup(
      { [ROBOTS]: textResponse("User-agent: *\nCrawl-delay: 10"), [PAGE]: textResponse("ok") },
      { minDelayMs: 2000, maxDelayMs: 5000, random: () => 0.5 },
    );

    // Act
    await fetcher.fetchPage(PAGE);
    await fetcher.fetchPage(PAGE);

    // Assert
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("keeps the random pause when the Crawl-delay is shorter", async () => {
    // Arrange
    const { fetcher, sleeps } = setup(
      { [ROBOTS]: textResponse("User-agent: *\nCrawl-delay: 1"), [PAGE]: textResponse("ok") },
      { minDelayMs: 2000, maxDelayMs: 5000, random: () => 0.5 },
    );

    // Act
    await fetcher.fetchPage(PAGE);

    // Assert
    expect(sleeps).toEqual([3500]);
  });
});

describe("StoreFetcher retries", () => {
  it("retries a 503 with backoff, then returns the page", async () => {
    // Arrange
    const { fetcher, calls, sleeps } = setup({ [PAGE]: [textResponse("busy", 503), textResponse("ok")] });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page.body).toBe("ok");
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, PAGE]);
    expect(sleeps).toEqual([500]);
  });

  it("waits for Retry-After before retrying", async () => {
    // Arrange
    const { fetcher, sleeps } = setup({
      [PAGE]: [textResponse("busy", 503, { "Retry-After": "7" }), textResponse("ok")],
    });

    // Act
    await fetcher.fetchPage(PAGE);

    // Assert
    expect(sleeps).toEqual([7000]);
  });

  it("waits out a Retry-After of a couple of minutes, as Darty's 126 s, instead of stopping the store", async () => {
    // Arrange
    const { fetcher, calls, sleeps } = setup({
      [PAGE]: [textResponse("busy", 503, { "Retry-After": "126" }), textResponse("ok")],
    });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page.body).toBe("ok");
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, PAGE]);
    expect(sleeps).toEqual([126_000]);
  });

  it.each([429, 503])(
    "stops the store for the day, naming Retry-After, when a %i asks to wait longer than the cap",
    async (status) => {
      // Arrange
      const { fetcher, calls } = setup({
        [PAGE]: textResponse("maintenance", status, { "Retry-After": "3600" }),
        [OTHER]: textResponse("ok"),
      });

      // Act
      const results = await fetchEach(fetcher, [PAGE, OTHER]);

      // Assert
      expect(outcomesOf(results)).toEqual(["StoreBlockedError", "StoreBlockedError"]);
      expect((results[0] as StoreBlockedError).message).toBe(
        `darty asks us to stay away: HTTP ${status} with Retry-After 3600 s, longer than the ${BOT_POLICY.maxRetryAfterMs / 1000} s we wait`,
      );
      expect(urlsOf(calls)).toEqual([ROBOTS, PAGE]);
    },
  );

  it("holds back every later request, not only the retries, until a shorter Retry-After has passed", async () => {
    // Arrange
    const { fetcher, calls, sleeps } = setup({
      [PAGE]: textResponse("busy", 503, { "Retry-After": "7" }),
      [OTHER]: textResponse("ok"),
    });

    // Act
    const results = await fetchEach(fetcher, [PAGE, OTHER]);

    // Assert
    expect(outcomesOf(results)).toEqual(["FetchError", "page"]);
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, PAGE, PAGE, OTHER]);
    expect(sleeps).toEqual([7000, 7000, 7000]);
  });

  it("gives up a URL at once when a 500 carries a Retry-After longer than the cap", async () => {
    // Arrange
    const { fetcher, calls } = setup({
      [PAGE]: textResponse("error", 500, { "Retry-After": "3600" }),
      [OTHER]: textResponse("ok"),
    });

    // Act
    const results = await fetchEach(fetcher, [PAGE, OTHER]);

    // Assert
    expect(outcomesOf(results)).toEqual(["FetchError", "page"]);
    expect((results[0] as FetchError).status).toBe(500);
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, OTHER]);
  });

  it("fails the request after three attempts with 5xx", async () => {
    // Arrange
    const { fetcher, calls, sleeps } = setup({ [PAGE]: textResponse("error", 500) });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect((result as FetchError).status).toBe(500);
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, PAGE, PAGE]);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("retries network errors and timeouts, with a timeout signal on every request", async () => {
    // Arrange
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    const { fetcher, calls, sleeps } = setup({
      [PAGE]: [new TypeError("fetch failed"), timeout, textResponse("ok")],
    });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page.body).toBe("ok");
    expect(sleeps).toEqual([500, 1000]);
    expect(calls.every((call) => call.init.signal instanceof AbortSignal)).toBe(true);
  });

  it("reports a network failure after the last attempt", async () => {
    // Arrange
    const { fetcher } = setup({ [PAGE]: new TypeError("fetch failed") });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect((result as FetchError).status).toBeNull();
    expect((result as FetchError).message).toMatch(/fetch failed/);
  });
});

describe("StoreFetcher blocks", () => {
  it("stops the store after three 403s in a row and makes no further requests", async () => {
    // Arrange
    const { fetcher, calls } = setup({
      [`${BASE}/a`]: textResponse("Forbidden", 403),
      [`${BASE}/b`]: textResponse("Forbidden", 403),
      [`${BASE}/c`]: textResponse("Forbidden", 403),
      [`${BASE}/d`]: textResponse("ok"),
    });

    // Act
    const results = [
      await settle(fetcher.fetchPage(`${BASE}/a`)),
      await settle(fetcher.fetchPage(`${BASE}/b`)),
      await settle(fetcher.fetchPage(`${BASE}/c`)),
      await settle(fetcher.fetchPage(`${BASE}/d`)),
    ];

    // Assert
    expect(results.map((result) => (result instanceof Error ? result.name : "page"))).toEqual([
      "FetchError",
      "FetchError",
      "StoreBlockedError",
      "StoreBlockedError",
    ]);
    expect(urlsOf(calls)).toEqual([ROBOTS, `${BASE}/a`, `${BASE}/b`, `${BASE}/c`]);
  });

  it("resets the block streak after a page that works", async () => {
    // Arrange
    const { fetcher } = setup({
      [`${BASE}/a`]: textResponse("Forbidden", 403),
      [`${BASE}/b`]: textResponse("Forbidden", 403),
      [`${BASE}/c`]: textResponse("ok"),
      [`${BASE}/d`]: textResponse("Forbidden", 403),
    });

    // Act
    const results = [
      await settle(fetcher.fetchPage(`${BASE}/a`)),
      await settle(fetcher.fetchPage(`${BASE}/b`)),
      await settle(fetcher.fetchPage(`${BASE}/c`)),
      await settle(fetcher.fetchPage(`${BASE}/d`)),
    ];

    // Assert
    expect(results.map((result) => (result instanceof Error ? result.name : "page"))).toEqual([
      "FetchError",
      "FetchError",
      "page",
      "FetchError",
    ]);
  });

  it("counts a 429 that persists after retries as a block signal", async () => {
    // Arrange
    const { fetcher, calls } = setup({
      [`${BASE}/a`]: textResponse("Too many", 429),
      [`${BASE}/b`]: textResponse("Too many", 429),
      [`${BASE}/c`]: textResponse("Too many", 429),
    });

    // Act
    const results = [
      await settle(fetcher.fetchPage(`${BASE}/a`)),
      await settle(fetcher.fetchPage(`${BASE}/b`)),
      await settle(fetcher.fetchPage(`${BASE}/c`)),
    ];

    // Assert
    expect(results.map((result) => (result instanceof Error ? result.name : "page"))).toEqual([
      "FetchError",
      "FetchError",
      "StoreBlockedError",
    ]);
    expect(calls).toHaveLength(1 + 3 * 3);
  });

  it("treats a challenge page as a block signal, without retrying", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [PAGE]: textResponse("<title>Just a moment...</title>", 503) });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect((result as FetchError).message).toMatch(/Cloudflare challenge/);
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE]);
  });

  it("keeps counting 403s across a URL that fails with 5xx", async () => {
    // Arrange
    const { fetcher } = setup({
      [`${BASE}/a`]: textResponse("Forbidden", 403),
      [`${BASE}/b`]: textResponse("Bad gateway", 502),
      [`${BASE}/c`]: textResponse("Forbidden", 403),
      [`${BASE}/d`]: textResponse("Forbidden", 403),
    });

    // Act
    const results = await fetchEach(
      fetcher,
      ["a", "b", "c", "d"].map((path) => `${BASE}/${path}`),
    );

    // Assert
    expect(outcomesOf(results)).toEqual(["FetchError", "FetchError", "FetchError", "StoreBlockedError"]);
  });
});

describe("StoreFetcher failing store", () => {
  it("stops the store for the day after 5 URLs in a row end in 5xx or network errors", async () => {
    // Arrange
    const urls = ["a", "b", "c", "d", "e", "f"].map((path) => `${BASE}/${path}`);
    const { fetcher, calls } = setup({
      [`${BASE}/a`]: textResponse("error", 500),
      [`${BASE}/b`]: new TypeError("fetch failed"),
      [`${BASE}/c`]: textResponse("Bad gateway", 502),
      [`${BASE}/d`]: textResponse("busy", 503),
      [`${BASE}/e`]: textResponse("error", 500),
      [`${BASE}/f`]: textResponse("ok"),
    });

    // Act
    const results = await fetchEach(fetcher, urls);

    // Assert
    expect(outcomesOf(results)).toEqual([
      "FetchError",
      "FetchError",
      "FetchError",
      "FetchError",
      "StoreUnavailableError",
      "StoreUnavailableError",
    ]);
    expect((results[4] as Error).message).toBe("darty keeps failing: HTTP 500 (3 attempts), 5 URLs in a row");
    expect(calls).toHaveLength(1 + 5 * 3);
    expect(urlsOf(calls)).not.toContain(`${BASE}/f`);
  });

  it("starts counting again after a URL that gets an answer", async () => {
    // Arrange
    const failing = ["a", "b", "c", "d", "e", "f", "g", "h"].map((path) => `${BASE}/${path}`);
    const routes: Record<string, Reply> = { [`${BASE}/gone`]: textResponse("Not found", 404) };
    for (const url of failing) {
      routes[url] = textResponse("busy", 503);
    }
    const { fetcher } = setup(routes, { maxAttempts: 1 });

    // Act
    const results = await fetchEach(fetcher, [...failing.slice(0, 4), `${BASE}/gone`, ...failing.slice(4)]);

    // Assert
    expect(outcomesOf(results)).toEqual(Array.from({ length: 9 }, () => "FetchError"));
  });
});

describe("StoreFetcher bodies", () => {
  it("decodes an ISO-8859-1 page by its Content-Type", async () => {
    // Arrange
    const bytes = new Uint8Array([0x4d, 0xe1, 0x71, 0x75, 0x69, 0x6e, 0x61, 0x20, 0x80]);
    const { fetcher } = setup({
      [PAGE]: new Response(bytes, { headers: { "Content-Type": "text/html; charset=ISO-8859-1" } }),
    });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page.body).toBe("Máquina €");
    expect(page.contentType).toBe("text/html; charset=ISO-8859-1");
  });
});

describe("StoreFetcher redirects", () => {
  it("follows a redirect between the bare and the www host itself, never letting fetch follow one", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [PAGE]: redirectResponse(WWW_PAGE), [WWW_PAGE]: textResponse("tv") });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page).toMatchObject({ url: WWW_PAGE, status: 200, body: "tv" });
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, WWW_PAGE]);
    expect(calls.map((call) => call.init.redirect)).toEqual(["manual", "manual", "manual"]);
    expect(fetcher.pagesFetched).toBe(1);
  });

  it("resolves a relative Location against the URL that redirected", async () => {
    // Arrange
    const target = `${BASE}/c/tv?pagina=1`;
    const { fetcher } = setup({
      [PAGE]: redirectResponse("/c/tv?pagina=1", 302),
      [target]: textResponse("tv"),
    });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page.url).toBe(target);
  });

  it("refuses a redirect off the store's site without requesting it", async () => {
    // Arrange
    const { fetcher, calls } = setup({ [PAGE]: redirectResponse("https://outra.test/entrar", 302) });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect((result as FetchError).message).toBe("Redirected off the store's site, to outra.test");
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE]);
    expect(fetcher.pagesFetched).toBe(0);
  });

  it("refuses a redirect to a URL that robots.txt disallows, without requesting it", async () => {
    // Arrange
    const { fetcher, calls } = setup({
      [ROBOTS]: textResponse("User-agent: *\nDisallow: /conta"),
      [PAGE]: redirectResponse("/conta/entrar", 302),
    });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(RobotsDisallowedError);
    expect((result as RobotsDisallowedError).message).toBe(
      `Redirected to ${BASE}/conta/entrar, which robots.txt disallows`,
    );
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE]);
  });

  it("paces every hop like any other request, Crawl-delay included", async () => {
    // Arrange
    const { fetcher, sleeps } = setup(
      {
        [ROBOTS]: textResponse("User-agent: *\nCrawl-delay: 10"),
        [PAGE]: redirectResponse(WWW_PAGE),
        [WWW_PAGE]: textResponse("tv"),
      },
      { minDelayMs: 2000, maxDelayMs: 5000, random: () => 0.5 },
    );

    // Act
    await fetcher.fetchPage(PAGE);

    // Assert
    expect(sleeps).toEqual([10_000, 10_000]);
  });

  it("retries a hop that answers 503", async () => {
    // Arrange
    const { fetcher, calls, sleeps } = setup({
      [PAGE]: redirectResponse(WWW_PAGE),
      [WWW_PAGE]: [textResponse("busy", 503), textResponse("tv")],
    });

    // Act
    const page = await fetcher.fetchPage(PAGE);

    // Assert
    expect(page.body).toBe("tv");
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, WWW_PAGE, WWW_PAGE]);
    expect(sleeps).toEqual([500]);
  });

  it("counts a 403 at the end of a redirect as a block signal", async () => {
    // Arrange
    const routes: Record<string, Reply> = {};
    for (const path of ["a", "b", "c"]) {
      routes[`${BASE}/${path}`] = redirectResponse(`/bloqueado/${path}`, 302);
      routes[`${BASE}/bloqueado/${path}`] = textResponse("Forbidden", 403);
    }
    const { fetcher } = setup(routes);

    // Act
    const results = await fetchEach(
      fetcher,
      ["a", "b", "c"].map((path) => `${BASE}/${path}`),
    );

    // Assert
    expect(outcomesOf(results)).toEqual(["FetchError", "FetchError", "StoreBlockedError"]);
  });

  it("stops at a redirect loop without requesting a URL twice", async () => {
    // Arrange
    const { fetcher, calls } = setup({
      [PAGE]: redirectResponse(OTHER),
      [OTHER]: redirectResponse(PAGE),
    });

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect((result as FetchError).message).toBe(`Redirect loop at ${PAGE}`);
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, OTHER]);
  });

  it("follows at most 5 redirects", async () => {
    // Arrange
    const hops = Array.from({ length: 6 }, (_, index) => `${BASE}/r${index + 1}`);
    const routes: Record<string, Reply> = { [PAGE]: redirectResponse(hops[0] ?? "") };
    for (const [index, hop] of hops.entries()) {
      routes[hop] = redirectResponse(hops[index + 1] ?? `${BASE}/fim`);
    }
    const { fetcher, calls } = setup(routes);

    // Act
    const result = await settle(fetcher.fetchPage(PAGE));

    // Assert
    expect(result).toBeInstanceOf(FetchError);
    expect((result as FetchError).message).toBe("More than 5 redirects");
    expect(urlsOf(calls)).toEqual([ROBOTS, PAGE, ...hops.slice(0, 5)]);
  });
});
