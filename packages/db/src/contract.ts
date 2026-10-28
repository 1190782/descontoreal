import type { PriceInterval, StoreSlug } from "@descontoreal/core";

export type RunStatus = "running" | "success" | "failed" | "blocked";

export interface RunError {
  url?: string;
  message: string;
}

export interface RunSummary {
  status: Exclude<RunStatus, "running">;
  pagesFetched: number;
  listingsSeen: number;
  errors: RunError[];
  /**
   * true when a run that started complete ended partial (time budget, categories robots.txt disallows, or a stop
   * before the end: blocked, store failing, unexpected error); it then never counts as history.
   */
  partial?: boolean;
}

/** What the database knows about a listing at the start of a run. */
export interface ListingState {
  listingId: number;
  storeSku: string;
  productId: number | null;
  soldByStore: boolean;
  active: boolean;
  /** Current interval; null when the listing has no price yet (e.g. not sold by the store). */
  priceCents: number | null;
  referencePriceCents: number | null;
  inStock: boolean | null;
  productPageCheckedAt: Date | null;
}

/** One item seen in this run, ready to be stored. */
export interface ObservationInput {
  storeSku: string;
  url: string;
  rawTitle: string;
  /** false keeps the listing (so we remember it) but never records prices for it. */
  soldByStore: boolean;
  priceCents: number;
  referencePriceCents: number | null;
  /** Manufacturer's recommended price (PVPr); stored on the open interval, a change alone opens no new one. */
  rrpCents?: number | null;
  inStock: boolean;
}

export type IngestStatus = "new" | "unchanged" | "changed";

export interface IngestResult {
  storeSku: string;
  listingId: number;
  productId: number | null;
  productSlug: string | null;
  status: IngestStatus;
}

/** Facts from a product page, used to link the listing to a canonical product. */
export interface ListingDetailsInput {
  listingId: number;
  rawEan: string | null;
  /** Valid 13-digit GTIN from core normalizeGtin(), or null. */
  ean: string | null;
  brand: string | null;
  model: string | null;
  /** core normalizeBrand() / normalizeModel(). */
  brandNorm: string | null;
  modelNorm: string | null;
  /** Display name for a product created from this listing. */
  name: string;
  /** core productSlugBase(); the database appends -2, -3… on collision. */
  slugBase: string;
  categorySlug: string | null;
  imageUrl: string | null;
  specs: Record<string, string>;
  soldByStore: boolean;
}

export type MatchOutcome =
  "already_linked" | "linked_ean" | "created_ean" | "linked_brand_model" | "candidate" | "created";

export interface PriceHistory {
  listingId: number;
  productId: number | null;
  storeSlug: StoreSlug;
  storeName: string;
  firstSeenAt: Date;
  /**
   * When a run last read the listing's price, and complete runs missed since (a run that saw it without a price
   * counts as one): tell a current offer from a stale one.
   */
  lastSeenAt: Date;
  missedRuns: number;
  /** Ordered by validFrom ascending. */
  intervals: PriceInterval[];
}

export interface ListingStatsRow {
  listingId: number;
  computedAt: Date;
  currentPriceCents: number;
  min30Cents: number | null;
  min90Cents: number | null;
  min180Cents: number | null;
  med90Cents: number | null;
  max90Cents: number | null;
  /** core LabelCode */
  label: string;
  /** core WarningCode[] */
  warnings: string[];
  /** core Classification (texts and LabelNumbers) that justifies the label. */
  details: Record<string, unknown>;
  /** realDiscountPct, for ordering by real discount. */
  realDiscountPct: number | null;
}

export interface Db {
  /** Opens a scrape_runs row with status "running". Partial runs (--limit, --category) never count as history. */
  startRun(storeSlug: StoreSlug, options: { partial: boolean }): Promise<{ runId: number; startedAt: Date }>;
  finishRun(runId: number, summary: RunSummary): Promise<void>;
  /**
   * listings_seen of the last `limit` finished, non-partial runs of the store that saw listings (status success
   * or failed), newest first. Failed runs count so the baseline follows a lasting change of catalogue size.
   */
  recentListingCounts(storeSlug: StoreSlug, limit: number): Promise<number[]>;
  /** Every listing of the store, keyed by store_sku. */
  getListingStates(storeSlug: StoreSlug): Promise<Map<string, ListingState>>;
  /**
   * Upserts listings (last_seen_at = observedAt, active = true) and records price changes only:
   * same price, reference price and stock → nothing else; different → close the current interval
   * (valid_to = observedAt) and open a new one. One transaction per call.
   * An item older than the listing's last_seen_at changes nothing (status "unchanged").
   */
  ingestObservations(
    storeSlug: StoreSlug,
    observedAt: Date,
    items: readonly ObservationInput[],
  ): Promise<IngestResult[]>;
  /**
   * Stores product facts and links the listing: EAN → brand+model → match candidates → new product.
   * `productPageCheckedAt` is null when the facts came from a listing page (no product page visited).
   * `soldByStore` is only kept with the facts: ingestObservations owns the listing's sold_by_store, and
   * matching runs either way, so skip marketplace items if they should not create products.
   */
  saveListingDetails(input: ListingDetailsInput, productPageCheckedAt: Date | null): Promise<MatchOutcome>;
  /**
   * Listings that appeared in this run but got no price today (product page failed, price jump not confirmed):
   * missed_runs = 0, active = true. last_seen_at keeps the last reading with a price, so markMissingListings,
   * called next, leaves them one missed run: never deactivated while they keep appearing, and never quoted as a
   * current offer. Prices are never touched; a deactivated listing comes back without an open interval. Unknown
   * SKUs are ignored. Returns rows updated.
   */
  touchListings(storeSlug: StoreSlug, storeSkus: readonly string[]): Promise<number>;
  /**
   * After a complete run: listings not seen since `seenSince` get one more missed run; after `maxMissedRuns`
   * (default 3) in a row, active = false and the open interval is closed.
   */
  markMissingListings(
    storeSlug: StoreSlug,
    seenSince: Date,
    options?: { maxMissedRuns?: number },
  ): Promise<{ missed: number; deactivated: number }>;
  /** Price histories of active listings sold by their store, in batches. Listings without intervals are skipped. */
  loadPriceHistories(options?: { batchSize?: number }): AsyncGenerator<PriceHistory[]>;
  upsertListingStats(rows: readonly ListingStatsRow[]): Promise<void>;
  /**
   * The whole daily table in one transaction: upserts `rows` (all computed at `computedAt`) and deletes the rows
   * of every listing not in `rows`, so deactivated listings never keep a stale label. Any failure leaves the
   * previous table; a row computed at another time is rejected before anything changes.
   */
  replaceListingStats(rows: readonly ListingStatsRow[], computedAt: Date): Promise<void>;
  close(): Promise<void>;
}
