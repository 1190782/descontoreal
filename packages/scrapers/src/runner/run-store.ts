import {
  calendarDaysBetween,
  formatCents,
  isBrokenRun,
  isSuspiciousPriceJump,
  QUALITY_CONFIG,
} from "@descontoreal/core";
import type {
  Db,
  IngestResult,
  ListingDetailsInput,
  ListingState,
  ObservationInput,
  RunError,
} from "@descontoreal/db";
import { errorMessage, FetchError, StoreBlockedError, StoreUnavailableError } from "../http/errors";
import type { FetchedPage, PageFetcher } from "../http/fetcher";
import type { Logger } from "../http/logger";
import { notifyAdmin } from "../notify";
import type { ListingObservation, ListingPage, ProductDetails, StoreCategory, StoreScraper } from "../types";
import { buildListingDetails, factsFromListing, factsFromProductPage } from "./details";
import { formatAdminMessage, type IncompleteCategory, type RunReport, type SampleItem } from "./report";
import { revalidateProducts, type RevalidationConfig } from "./revalidate";

export const DEFAULT_MAX_PRODUCT_PAGES = 1500;
export const DRY_RUN_MAX_PRODUCT_PAGES = 5;
export const MAX_STORED_ERRORS = 50;
export const SAMPLE_SIZE = 10;
/** Each product page is read again about once a week, so a run revisits about a seventh of them. */
export const REVISIT_INTERVAL_DAYS = 7;
/** A progress line every so many product pages read for prices. */
export const PRICE_PAGES_PER_LOG = 100;
const MINUTE_MS = 60_000;

export interface RunStoreOptions {
  scraper: StoreScraper;
  /** null for a dry run: the database is never read or written. */
  db: Db | null;
  fetcher: PageFetcher;
  /** Only this store category (a partial run). */
  categoryKey?: string;
  /** Stop after this many unique items (a partial run). */
  limit?: number;
  /**
   * Cap on product-page requests for facts, seller checks, price jumps and the weekly revisit; 1500 by
   * default, 5 in a dry run. Product pages read for prices (StoreScraper.pricesFromProductPage) never count.
   */
  maxProductPages?: number;
  /** Stop requesting after this many minutes: what was read is stored and the run ends as partial. */
  maxMinutes?: number;
  /** Clock for the run start, observation times and the weekly revisit. Defaults to the system clock. */
  now?: () => Date;
  /** Defaults to console. */
  log?: Logger;
  /** Revalidates changed product pages on the site at the end of a real run; null or absent skips it. */
  revalidation?: RevalidationConfig | null;
}

/** --category names a key the store's config does not have. Thrown before anything is requested or written. */
export class UnknownCategoryError extends Error {
  readonly categoryKey: string;
  readonly available: string[];

  constructor(categoryKey: string, available: string[]) {
    super(`Unknown category "${categoryKey}"; the store has: ${available.join(", ")}`);
    this.name = "UnknownCategoryError";
    this.categoryKey = categoryKey;
    this.available = available;
  }
}

/**
 * Daily flow for one store (docs/PLANO.md, "Fluxo diário de cada loja"): check the categories against robots.txt,
 * walk the listing pages, keep the items sold by the store, confirm suspicious price jumps, store the
 * observations, read product pages for new listings and the weekly revisit, then record the run in scrape_runs.
 * With db null it is a dry run. Stores whose listings lack selling prices (pricesFromProductPage) get each kept
 * item's price, and its facts when due, from its product page instead. At maxMinutes the run stores what it read
 * and ends as partial. When the fetcher stops the store for the day, the run keeps what it read and returns a
 * partial report with status "blocked" (the store refuses us) or "failed" (the store keeps failing). Throws when
 * the run fails unexpectedly (after recording it, as partial too).
 */
export async function runStore(options: RunStoreOptions): Promise<RunReport> {
  const categories = await options.scraper.listCategories();
  const selected =
    options.categoryKey === undefined
      ? categories
      : categories.filter((category) => category.key === options.categoryKey);
  if (options.categoryKey !== undefined && selected.length === 0) {
    throw new UnknownCategoryError(
      options.categoryKey,
      categories.map((category) => category.key),
    );
  }
  return new StoreRun(options, selected).run();
}

/** An item that will be stored in this run. */
interface Observation {
  /** As listed, or priced by its product page for stores with pricesFromProductPage. */
  item: ListingObservation;
  category: StoreCategory;
  state: ListingState | undefined;
  soldByStore: boolean;
  /** Product page read earlier in this run (price, seller check or price-jump confirmation). */
  details: ProductDetails | null;
}

interface SellerDecision {
  soldByStore: boolean;
  source: "listing" | "stored" | "product-page";
  details: ProductDetails | null;
}

class StoreRun {
  private readonly scraper: StoreScraper;
  private readonly db: Db | null;
  private readonly fetcher: PageFetcher;
  private readonly categories: readonly StoreCategory[];
  private readonly limit: number | undefined;
  private readonly maxProductPages: number;
  private readonly maxMinutes: number | null;
  private readonly pricesFromProductPage: boolean;
  private readonly now: () => Date;
  private readonly log: Logger;
  private readonly revalidation: RevalidationConfig | null;
  /** --limit or --category: scrape_runs knows from the start that the run is partial. */
  private readonly startedPartial: boolean;
  private readonly report: RunReport;

  private states = new Map<string, ListingState>();
  private readonly seen = new Set<string>();
  /** Seen on a listing page but not stored today: product page failed, no price, or a jump not confirmed. */
  private readonly seenUnpriced = new Set<string>();
  private readonly samples = new Map<string, SampleItem>();
  private readonly productPageRead = new Set<string>();
  private readonly keptStoreSold: Observation[] = [];
  private readonly slugsToRevalidate = new Set<string>();
  /** Set when the run starts, from maxMinutes. */
  private timeLimit: { minutes: number; deadline: number } | null = null;

  constructor(options: RunStoreOptions, categories: readonly StoreCategory[]) {
    this.scraper = options.scraper;
    this.db = options.db;
    this.fetcher = options.fetcher;
    this.categories = categories;
    this.limit = options.limit;
    this.maxProductPages =
      options.maxProductPages ??
      (options.db === null ? DRY_RUN_MAX_PRODUCT_PAGES : DEFAULT_MAX_PRODUCT_PAGES);
    this.maxMinutes = options.maxMinutes ?? null;
    this.pricesFromProductPage = options.scraper.pricesFromProductPage === true;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? console;
    this.revalidation = options.revalidation ?? null;
    this.startedPartial = options.limit !== undefined || options.categoryKey !== undefined;
    this.report = {
      store: options.scraper.slug,
      status: "success",
      dryRun: options.db === null,
      partial: this.startedPartial,
      timeLimitMinutes: null,
      pagesFetched: 0,
      listingsSeen: 0,
      droppedMarketplace: 0,
      new: 0,
      changed: 0,
      unchanged: 0,
      productPagesFetched: 0,
      pricePagesFetched: 0,
      skippedPrices: 0,
      revisited: 0,
      skippedJumps: 0,
      budgetExhausted: 0,
      incompleteCategories: [],
      errors: [],
      errorCount: 0,
      sampleItems: [],
    };
  }

  async run(): Promise<RunReport> {
    // Local clock, not the database's: listings ingested from here on count as seen in this run.
    const runStart = this.now();
    if (this.maxMinutes !== null) {
      this.timeLimit = {
        minutes: this.maxMinutes,
        deadline: runStart.getTime() + this.maxMinutes * MINUTE_MS,
      };
    }
    const { slug } = this.scraper;
    const runId =
      this.db === null ? null : (await this.db.startRun(slug, { partial: this.report.partial })).runId;
    this.log.info(
      `${slug}: ${this.report.partial ? "partial" : "full"} run started${this.report.dryRun ? " (dry run)" : ""}`,
    );
    try {
      const allowed = await this.categoriesAllowedByRobots();
      if (this.db !== null) {
        this.states = await this.db.getListingStates(slug);
      }
      await this.crawl(allowed);
      await this.revisitProductPages();
      this.report.status = await this.closingStatus(runStart);
    } catch (error) {
      // Stopped before the end: its count of listings is not the store's, so it never counts as history.
      this.report.partial = true;
      if (!isStoreStop(error)) {
        this.report.status = "failed";
        this.addError({ message: `Run failed: ${errorMessage(error)}` }, true);
        await this.finishAfterFailure(runId);
        throw error;
      }
      this.report.status = error instanceof StoreBlockedError ? "blocked" : "failed";
      this.addError({ url: error.url, message: error.message }, true);
    }
    await this.finish(runId);
    return this.report;
  }

  /**
   * Checks each category's first URL against robots.txt before any listing page. When robots.txt disallows them
   * all, the store blocks us for the day; otherwise the disallowed ones are skipped and the run is partial.
   */
  private async categoriesAllowedByRobots(): Promise<StoreCategory[]> {
    const allowed: StoreCategory[] = [];
    const disallowed: StoreCategory[] = [];
    for (const category of this.categories) {
      if (await this.fetcher.robotsAllows(category.url)) {
        allowed.push(category);
      } else {
        disallowed.push(category);
      }
    }
    if (disallowed.length === 0) {
      return allowed;
    }
    const { slug, baseUrl } = this.scraper;
    if (allowed.length === 0) {
      const wholeSite = !(await this.fetcher.robotsAllows(new URL("/", baseUrl).href));
      const scope = wholeSite ? "the whole site" : `every category URL (${disallowed.length})`;
      throw new StoreBlockedError(
        `${slug} blocks our bot: robots.txt disallows ${scope}`,
        new URL("/robots.txt", baseUrl).href,
      );
    }
    this.report.partial = true;
    for (const category of disallowed) {
      this.addError({
        url: category.url,
        message: `Category ${category.key} skipped: robots.txt disallows it`,
      });
      this.markIncomplete(category, category.url, "robots-txt");
    }
    return allowed;
  }

  private async crawl(categories: readonly StoreCategory[]): Promise<void> {
    for (const category of categories) {
      if (this.limitReached() || this.timeUp()) {
        return;
      }
      await this.crawlCategory(category);
    }
  }

  private async crawlCategory(category: StoreCategory): Promise<void> {
    const visited = new Set<string>();
    let url: string | null = category.url;
    let itemsFound = 0;
    while (url !== null && !this.limitReached() && !this.timeUp()) {
      if (visited.has(url)) {
        this.addError({ url, message: `Pagination loop in category ${category.key}` });
        this.markIncomplete(category, url, "listing-page");
        return;
      }
      visited.add(url);
      const page = await this.readListingPage(url, category);
      if (page === null) {
        this.markIncomplete(category, url, "listing-page");
        return;
      }
      this.log.info(`${this.scraper.slug}: ${category.key} page ${visited.size}: ${page.items.length} items`);
      // A page can keep no items (Darty leaves out a whole page of sold-out products) and still have a next one.
      itemsFound += page.items.length;
      await this.processListingPage(page.items, category);
      url = page.nextPageUrl;
    }
    if (url === null && itemsFound === 0) {
      this.addError({ url: category.url, message: `No items in category ${category.key}` });
    }
  }

  private markIncomplete(
    category: StoreCategory,
    failedUrl: string,
    reason: IncompleteCategory["reason"],
  ): void {
    this.report.incompleteCategories.push({ key: category.key, url: category.url, failedUrl, reason });
  }

  private async readListingPage(url: string, category: StoreCategory): Promise<ListingPage | null> {
    const page = await this.fetchOrRecord(url);
    if (page === null) {
      return null;
    }
    try {
      return this.scraper.parseListingPage(page.body, page.url, category);
    } catch (error) {
      this.addError({ url, message: `Listing page not parsed: ${errorMessage(error)}` });
      return null;
    }
  }

  private async processListingPage(
    items: readonly ListingObservation[],
    category: StoreCategory,
  ): Promise<void> {
    const batch: Observation[] = [];
    let stopped: StoreBlockedError | StoreUnavailableError | null = null;
    for (const item of items) {
      if (this.limitReached() || this.timeUp()) {
        break;
      }
      if (this.seen.has(item.storeSku)) {
        continue;
      }
      const problem = invalidItemReason(item);
      if (problem !== null) {
        this.addError({ url: item.url, message: `Listing item skipped: ${problem}` });
        continue;
      }
      this.seen.add(item.storeSku);
      this.report.listingsSeen += 1;
      this.addSample(item, category);
      try {
        const observation = await this.classify(item, category);
        if (observation !== null) {
          batch.push(observation);
        }
      } catch (error) {
        if (!isStoreStop(error)) {
          throw error;
        }
        stopped = error;
        break;
      }
    }
    // Keep what this page already gave before the store stops for the day.
    const results = await this.ingest(batch);
    if (stopped !== null) {
      throw stopped;
    }
    await this.saveProductFacts(batch, results);
  }

  private async classify(item: ListingObservation, category: StoreCategory): Promise<Observation | null> {
    const state = this.states.get(item.storeSku);
    if (this.pricesFromProductPage) {
      return this.classifyByProductPage(item, category, state);
    }
    const seller = await this.resolveSeller(item, state);
    if (seller === null) {
      return null;
    }
    if (!seller.soldByStore) {
      return this.notSoldByStore(item, category, state, seller.source);
    }
    this.updateSample(item.storeSku, { soldByStore: true });
    const previousCents = state?.priceCents ?? null;
    if (previousCents === null || !isSuspiciousPriceJump(previousCents, item.priceCents)) {
      return { item, category, state, soldByStore: true, details: seller.details };
    }
    const details = await this.confirmPriceJump(item, previousCents);
    return details === null ? null : { item, category, state, soldByStore: true, details };
  }

  /**
   * For stores whose listings lack selling prices: the product page gives the price, reference price, PVPr
   * and stock. When it cannot, the item is skipped today; the listing's price is never stored.
   */
  private async classifyByProductPage(
    item: ListingObservation,
    category: StoreCategory,
    state: ListingState | undefined,
  ): Promise<Observation | null> {
    const fromListing = this.scraper.isSoldByStore(item);
    const knownSeller = fromListing ?? state?.soldByStore ?? null;
    if (knownSeller === false) {
      return this.notSoldByStore(item, category, state, fromListing === false ? "listing" : "stored");
    }
    const details = await this.readPricePage(item);
    if (details === null) {
      return this.skipPrice(item, null);
    }
    if (details.storeSku.trim() !== item.storeSku.trim()) {
      return this.skipPrice(item, `the product page shows SKU "${details.storeSku}"`);
    }
    if (knownSeller === null && this.scraper.isSoldByStore(details) !== true) {
      return this.notSoldByStore(item, category, state, "product-page");
    }
    if (details.priceCents === null) {
      return this.skipPrice(item, "the product page shows no price");
    }
    const prices = {
      priceCents: details.priceCents,
      referencePriceCents: details.referencePriceCents,
      rrpCents: details.rrpCents ?? null,
      // Stock is not a price: the listing's stands in when the page does not say.
      inStock: details.inStock ?? item.inStock,
    };
    const priced: ListingObservation = { ...item, ...prices };
    const problem = invalidItemReason(priced);
    if (problem !== null) {
      return this.skipPrice(item, problem);
    }
    this.updateSample(item.storeSku, { soldByStore: true, ...prices });
    return { item: priced, category, state, soldByStore: true, details };
  }

  private notSoldByStore(
    item: ListingObservation,
    category: StoreCategory,
    state: ListingState | undefined,
    source: SellerDecision["source"],
  ): Observation | null {
    this.updateSample(item.storeSku, { soldByStore: false });
    this.report.droppedMarketplace += 1;
    // Remembered so that, when listings do not show the seller, the next run needs no product page.
    return source === "listing" ? null : { item, category, state, soldByStore: false, details: null };
  }

  /** The item gets no price today. reason is null when the failed request or parse is already recorded. */
  private skipPrice(item: ListingObservation, reason: string | null): null {
    this.report.skippedPrices += 1;
    this.seenUnpriced.add(item.storeSku);
    this.dropSample(item.storeSku);
    if (reason !== null) {
      this.addError({ url: item.url, message: `Price not read, item skipped today: ${reason}` });
    }
    return null;
  }

  private async resolveSeller(
    item: ListingObservation,
    state: ListingState | undefined,
  ): Promise<SellerDecision | null> {
    const fromListing = this.scraper.isSoldByStore(item);
    if (fromListing !== null) {
      return { soldByStore: fromListing, source: "listing", details: null };
    }
    if (state !== undefined) {
      return { soldByStore: state.soldByStore, source: "stored", details: null };
    }
    const details = await this.readProductPage(item);
    if (details === null) {
      return null;
    }
    return { soldByStore: this.scraper.isSoldByStore(details) === true, source: "product-page", details };
  }

  private async confirmPriceJump(
    item: ListingObservation,
    previousCents: number,
  ): Promise<ProductDetails | null> {
    const details = await this.readProductPage(item);
    const pagePriceCents = details?.priceCents ?? null;
    if (details !== null && pagePriceCents === item.priceCents) {
      return details;
    }
    this.report.skippedJumps += 1;
    this.seenUnpriced.add(item.storeSku);
    const pagePrice = pagePriceCents === null ? "no price" : formatCents(pagePriceCents);
    const reason = details === null ? "product page not read" : `product page shows ${pagePrice}`;
    this.addError({
      url: item.url,
      message: `Price jump ${formatCents(previousCents)} → ${formatCents(item.priceCents)} not confirmed: ${reason}`,
    });
    return null;
  }

  /** Reads a product page within the run's budget and time; null when skipped or failed (the error is recorded). */
  private async readProductPage(item: ListingObservation): Promise<ProductDetails | null> {
    if (this.timeUp()) {
      return null;
    }
    if (this.report.productPagesFetched >= this.maxProductPages) {
      this.report.budgetExhausted += 1;
      if (this.report.budgetExhausted === 1) {
        this.log.warn(`${this.scraper.slug}: product page budget of ${this.maxProductPages} used up`);
      }
      return null;
    }
    this.report.productPagesFetched += 1;
    return this.fetchProductPage(item);
  }

  /**
   * A product page read for the item's price: the run's main work, so maxProductPages does not limit it. Without
   * product pages the store gives no prices, so robots.txt disallowing one blocks the store for the day.
   */
  private async readPricePage(item: ListingObservation): Promise<ProductDetails | null> {
    const url = this.productPageUrl(item);
    if (!(await this.fetcher.robotsAllows(url))) {
      throw new StoreBlockedError(
        `${this.scraper.slug} blocks our bot: robots.txt disallows the product pages, where the prices are`,
        url,
      );
    }
    this.report.pricePagesFetched += 1;
    const details = await this.fetchProductPage(item);
    if (this.report.pricePagesFetched % PRICE_PAGES_PER_LOG === 0) {
      this.log.info(`${this.scraper.slug}: ${this.report.pricePagesFetched} product pages read for prices`);
    }
    return details;
  }

  /** Requests and parses an item's product page; null when that failed (the error is recorded). */
  private async fetchProductPage(item: ListingObservation): Promise<ProductDetails | null> {
    const url = this.productPageUrl(item);
    const page = await this.fetchOrRecord(url);
    if (page === null) {
      return null;
    }
    try {
      const details = this.scraper.parseProductPage(page.body, page.url);
      this.productPageRead.add(item.storeSku);
      if (details.ean !== null) {
        this.updateSample(item.storeSku, { ean: details.ean });
      }
      return details;
    } catch (error) {
      this.addError({ url, message: `Product page not parsed: ${errorMessage(error)}` });
      return null;
    }
  }

  private productPageUrl(item: ListingObservation): string {
    return this.scraper.productPageUrl?.(item) ?? item.url;
  }

  private async fetchOrRecord(url: string): Promise<FetchedPage | null> {
    try {
      return await this.fetcher.fetchPage(url);
    } catch (error) {
      if (!(error instanceof FetchError)) {
        throw error;
      }
      this.addError({ url, message: error.message });
      return null;
    }
  }

  /** One database call per listing page. */
  private async ingest(batch: readonly Observation[]): Promise<Map<string, IngestResult>> {
    const results = new Map<string, IngestResult>();
    if (batch.length === 0) {
      return results;
    }
    const storeSold = batch.filter((observation) => observation.soldByStore);
    this.keptStoreSold.push(...storeSold);
    if (this.db === null) {
      this.report.new += storeSold.length;
      return results;
    }
    const ingested = await this.db.ingestObservations(
      this.scraper.slug,
      this.now(),
      batch.map(toObservationInput),
    );
    for (const result of ingested) {
      results.set(result.storeSku, result);
    }
    for (const observation of storeSold) {
      const result = results.get(observation.item.storeSku);
      if (result === undefined) {
        continue;
      }
      this.report[result.status] += 1;
      if (result.status !== "unchanged" && result.productSlug !== null) {
        this.slugsToRevalidate.add(result.productSlug);
      }
    }
    return results;
  }

  private async saveProductFacts(
    batch: readonly Observation[],
    results: ReadonlyMap<string, IngestResult>,
  ): Promise<void> {
    for (const observation of batch) {
      if (!observation.soldByStore) {
        continue;
      }
      // Undefined in a dry run: product pages are still read, to show what they give.
      const listingId = results.get(observation.item.storeSku)?.listingId;
      if (this.pricesFromProductPage) {
        // The page read for the price has the facts too: no second request.
        if (observation.details !== null && listingId !== undefined && this.factsDue(observation.state)) {
          await this.saveProductPageFacts(listingId, observation, observation.details);
        }
      } else if (observation.state === undefined) {
        await this.saveNewListingFacts(observation, listingId);
      } else if (observation.details !== null && listingId !== undefined) {
        // The product page read to confirm a price jump also counts as this week's check.
        await this.saveProductPageFacts(listingId, observation, observation.details);
      }
    }
  }

  private async saveNewListingFacts(observation: Observation, listingId: number | undefined): Promise<void> {
    const { item, category } = observation;
    if (observation.details === null && item.ean !== undefined) {
      if (listingId !== undefined) {
        await this.saveDetails(buildListingDetails(listingId, factsFromListing(item), category, true), null);
      }
      return;
    }
    // Skipped or failed pages are read later by the weekly revisit, which starts with never-checked listings.
    const details = observation.details ?? (await this.readProductPage(item));
    if (details !== null && listingId !== undefined) {
      await this.saveProductPageFacts(listingId, observation, details);
    }
  }

  private async revisitProductPages(): Promise<void> {
    const quota = Math.ceil(this.keptStoreSold.length / REVISIT_INTERVAL_DAYS);
    const now = this.now();
    const due = this.keptStoreSold
      .filter(
        (observation): observation is Observation & { state: ListingState } =>
          observation.state !== undefined &&
          !this.productPageRead.has(observation.item.storeSku) &&
          isRevisitDue(observation.state.productPageCheckedAt, now),
      )
      .sort((a, b) => compareCheckedAt(a.state.productPageCheckedAt, b.state.productPageCheckedAt))
      .slice(0, quota);
    for (const observation of due) {
      if (this.timeUp()) {
        return;
      }
      const details = await this.readProductPage(observation.item);
      if (details !== null) {
        this.report.revisited += 1;
        await this.saveProductPageFacts(observation.state.listingId, observation, details);
      }
    }
  }

  private async saveProductPageFacts(
    listingId: number,
    observation: Observation,
    details: ProductDetails,
  ): Promise<void> {
    const facts = factsFromProductPage(details, observation.item.title);
    const soldByStore = this.scraper.isSoldByStore(details) ?? true;
    await this.saveDetails(
      buildListingDetails(listingId, facts, observation.category, soldByStore),
      this.now(),
    );
  }

  private async saveDetails(input: ListingDetailsInput, productPageCheckedAt: Date | null): Promise<void> {
    if (this.db === null) {
      return;
    }
    try {
      await this.db.saveListingDetails(input, productPageCheckedAt);
    } catch (error) {
      // The price is already stored; the facts are tried again by the weekly revisit.
      this.addError({
        message: `Product facts of listing ${input.listingId} not saved: ${errorMessage(error)}`,
      });
    }
  }

  /**
   * Broken-run checks, then missing listings; only complete runs (not partial, not dry) count as history. Listings
   * seen without a price today lose their missed runs first, so they end the run with one: a listing on the store's
   * pages every day is never deactivated, and a price not read today is never quoted to other stores as an offer.
   */
  private async closingStatus(runStart: Date): Promise<"success" | "failed"> {
    const { slug } = this.scraper;
    if (this.report.listingsSeen === 0) {
      this.addError({ message: "No listings seen: the scraper or the category URLs may be broken" }, true);
      return "failed";
    }
    const { pricePagesFetched, skippedPrices } = this.report;
    // Listings look normal when only the product-page parser broke: count the pages that gave no price.
    if (pricePagesFetched - skippedPrices < pricePagesFetched * QUALITY_CONFIG.brokenRunFraction) {
      this.addError(
        { message: `Broken run: ${skippedPrices} of ${pricePagesFetched} product pages gave no price` },
        true,
      );
      return "failed";
    }
    if (this.report.incompleteCategories.length > 0) {
      // An unread category truncates the count: partial keeps it out of the broken-run baseline.
      this.report.partial = true;
      this.log.warn(`${slug}: some listing pages failed, so listings not seen are not marked missing`);
      return "success";
    }
    if (this.db === null || this.report.partial) {
      return "success";
    }
    const recentCounts = await this.db.recentListingCounts(slug, QUALITY_CONFIG.recentRuns);
    if (isBrokenRun(this.report.listingsSeen, recentCounts)) {
      const average = Math.round(recentCounts.reduce((sum, count) => sum + count, 0) / recentCounts.length);
      this.addError(
        { message: `Broken run: ${this.report.listingsSeen} listings seen, recent average ${average}` },
        true,
      );
      return "failed";
    }
    // Only listings active before the run: touching an inactive one would reactivate it without a current price.
    const unpriced = [...this.seenUnpriced].filter((storeSku) => this.states.get(storeSku)?.active === true);
    if (unpriced.length > 0) {
      const touched = await this.db.touchListings(slug, unpriced);
      this.log.info(`${slug}: ${touched} listings seen without a price today kept active`);
    }
    const { maxMissedRuns } = this.scraper;
    const { missed, deactivated } = await this.db.markMissingListings(
      slug,
      runStart,
      maxMissedRuns === undefined ? {} : { maxMissedRuns },
    );
    this.log.info(`${slug}: ${missed} listings missing from this run, ${deactivated} deactivated`);
    return "success";
  }

  private async finish(runId: number | null): Promise<void> {
    const { report, scraper } = this;
    report.pagesFetched = this.fetcher.pagesFetched;
    if (this.db !== null && runId !== null) {
      await this.db.finishRun(runId, {
        status: report.status,
        pagesFetched: report.pagesFetched,
        listingsSeen: report.listingsSeen,
        errors: report.errors,
        // Started complete, then the time limit, robots.txt or a stop before the end left part of the store unread.
        ...(report.partial && !this.startedPartial ? { partial: true } : {}),
      });
      if (
        report.status !== "success" ||
        report.timeLimitMinutes !== null ||
        report.incompleteCategories.length > 0
      ) {
        const message = formatAdminMessage(scraper.name, report);
        await notifyAdmin(message.subject, message.text);
      }
      if (this.revalidation !== null && this.slugsToRevalidate.size > 0) {
        await revalidateProducts([...this.slugsToRevalidate], this.revalidation, this.log);
      }
    }
    this.log.info(
      `${scraper.slug}: ${report.status}: ${report.listingsSeen} listings seen, ${report.new} new, ` +
        `${report.changed} changed, ${report.unchanged} unchanged, ${report.droppedMarketplace} not sold by the store, ` +
        `${report.pagesFetched} pages, ${report.pricePagesFetched + report.productPagesFetched} product pages, ` +
        `${report.errorCount} errors`,
    );
  }

  private async finishAfterFailure(runId: number | null): Promise<void> {
    try {
      await this.finish(runId);
    } catch (error) {
      this.log.error(`${this.scraper.slug}: the failed run was not recorded: ${errorMessage(error)}`);
    }
  }

  private limitReached(): boolean {
    return this.limit !== undefined && this.report.listingsSeen >= this.limit;
  }

  /** true once maxMinutes have passed; the first call to see it makes the run partial, and nothing more is requested. */
  private timeUp(): boolean {
    if (this.report.timeLimitMinutes !== null) {
      return true;
    }
    if (this.timeLimit === null || this.now().getTime() < this.timeLimit.deadline) {
      return false;
    }
    this.report.timeLimitMinutes = this.timeLimit.minutes;
    this.report.partial = true;
    this.log.warn(
      `${this.scraper.slug}: time limit of ${this.timeLimit.minutes} min reached; storing what was read and stopping`,
    );
    return true;
  }

  /** New listings, and those whose facts were last checked 7 or more Lisbon calendar days ago. */
  private factsDue(state: ListingState | undefined): boolean {
    return state === undefined || isRevisitDue(state.productPageCheckedAt, this.now());
  }

  private addSample(item: ListingObservation, category: StoreCategory): void {
    if (this.report.sampleItems.length >= SAMPLE_SIZE) {
      return;
    }
    const sample: SampleItem = {
      storeSku: item.storeSku,
      title: item.title,
      url: item.url,
      categoryKey: category.key,
      priceCents: item.priceCents,
      referencePriceCents: item.referencePriceCents,
      rrpCents: item.rrpCents ?? null,
      inStock: item.inStock,
      sellerName: item.sellerName,
      soldByStore: null,
      ean: item.ean ?? null,
    };
    this.report.sampleItems.push(sample);
    this.samples.set(item.storeSku, sample);
  }

  private updateSample(
    storeSku: string,
    update: Partial<
      Pick<SampleItem, "soldByStore" | "ean" | "priceCents" | "referencePriceCents" | "rrpCents" | "inStock">
    >,
  ): void {
    const sample = this.samples.get(storeSku);
    if (sample !== undefined) {
      Object.assign(sample, update);
    }
  }

  /** An item skipped today leaves the sample, which then shows only prices the run stores. */
  private dropSample(storeSku: string): void {
    const sample = this.samples.get(storeSku);
    if (sample !== undefined) {
      this.samples.delete(storeSku);
      this.report.sampleItems.splice(this.report.sampleItems.indexOf(sample), 1);
    }
  }

  /** Keeps the first errors; an error that ends the run always takes the last stored place. */
  private addError(error: RunError, endsRun = false): void {
    this.report.errorCount += 1;
    if (this.report.errors.length < MAX_STORED_ERRORS) {
      this.report.errors.push(error);
    } else if (endsRun) {
      this.report.errors[MAX_STORED_ERRORS - 1] = error;
    }
    const message = `${this.scraper.slug}: ${error.message}${error.url === undefined ? "" : ` (${error.url})`}`;
    if (endsRun) {
      this.log.error(message);
    } else {
      this.log.warn(message);
    }
  }
}

function toObservationInput(observation: Observation): ObservationInput {
  const { item, soldByStore } = observation;
  return {
    storeSku: item.storeSku,
    url: item.url,
    rawTitle: item.title,
    soldByStore,
    priceCents: item.priceCents,
    referencePriceCents: item.referencePriceCents,
    rrpCents: item.rrpCents ?? null,
    inStock: item.inStock,
  };
}

/** Why a parsed item cannot be stored, or null. Prices must be positive integer cents. */
function invalidItemReason(item: ListingObservation): string | null {
  if (item.storeSku.trim() === "") {
    return "empty SKU";
  }
  if (!isPositiveCents(item.priceCents)) {
    return `price ${String(item.priceCents)} is not a positive integer of cents`;
  }
  if (item.referencePriceCents !== null && !isPositiveCents(item.referencePriceCents)) {
    return `reference price ${String(item.referencePriceCents)} is not a positive integer of cents`;
  }
  const rrpCents = item.rrpCents ?? null;
  if (rrpCents !== null && !isPositiveCents(rrpCents)) {
    return `recommended price ${String(rrpCents)} is not a positive integer of cents`;
  }
  return null;
}

function isPositiveCents(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

/** Lisbon calendar days, so the weekly revisit does not drift with the run's start time. */
function isRevisitDue(checkedAt: Date | null, now: Date): boolean {
  return checkedAt === null || calendarDaysBetween(checkedAt, now) >= REVISIT_INTERVAL_DAYS;
}

/** The fetcher stopped the store for the day; the run keeps what it read. */
function isStoreStop(error: unknown): error is StoreBlockedError | StoreUnavailableError {
  return error instanceof StoreBlockedError || error instanceof StoreUnavailableError;
}

/** Never-checked listings first, then the oldest checks. */
function compareCheckedAt(a: Date | null, b: Date | null): number {
  if (a === null || b === null) {
    return (a === null ? 0 : 1) - (b === null ? 0 : 1);
  }
  return a.getTime() - b.getTime();
}
