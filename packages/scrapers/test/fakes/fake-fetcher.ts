import { FetchError } from "../../src/http/errors";
import type { FetchedPage, PageFetcher } from "../../src/http/fetcher";

/**
 * PageFetcher over a map of URL → body or error; unknown URLs fail with HTTP 404. Records every request.
 * robots.txt allows every URL unless disallow() names it.
 */
export class FakeFetcher implements PageFetcher {
  readonly requested: string[] = [];
  readonly robotsChecked: string[] = [];
  pagesFetched = 0;
  private readonly pages = new Map<string, string | Error>();
  private readonly disallowed = new Set<string>();

  constructor(pages: Record<string, string | Error> = {}) {
    for (const [url, page] of Object.entries(pages)) {
      this.pages.set(url, page);
    }
  }

  set(url: string, page: string | Error): void {
    this.pages.set(url, page);
  }

  /** robots.txt disallows these URLs for our bot. */
  disallow(...urls: string[]): void {
    for (const url of urls) {
      this.disallowed.add(url);
    }
  }

  fetchPage(url: string): Promise<FetchedPage> {
    this.requested.push(url);
    const page = this.pages.get(url);
    if (page === undefined) {
      return Promise.reject(new FetchError("HTTP 404", url, 404));
    }
    if (page instanceof Error) {
      return Promise.reject(page);
    }
    this.pagesFetched += 1;
    return Promise.resolve({ url, status: 200, contentType: "application/json", body: page });
  }

  robotsAllows(url: string): Promise<boolean> {
    this.robotsChecked.push(url);
    return Promise.resolve(!this.disallowed.has(url));
  }
}
