import type { StoreSlug } from "@descontoreal/core";
import type {
  Db,
  IngestResult,
  IngestStatus,
  ListingDetailsInput,
  ListingState,
  ListingStatsRow,
  MatchOutcome,
  ObservationInput,
  PriceHistory,
  RunSummary,
} from "@descontoreal/db";

export const FAKE_RUN_ID = 42;

/** In-memory Db for runner tests: records every call and keeps listing states between ingests. */
export class FakeDb implements Db {
  readonly calls: string[] = [];
  readonly startedRuns: { storeSlug: StoreSlug; partial: boolean }[] = [];
  readonly finishedRuns: { runId: number; summary: RunSummary }[] = [];
  readonly ingests: { observedAt: Date; items: ObservationInput[] }[] = [];
  readonly savedDetails: { input: ListingDetailsInput; productPageCheckedAt: Date | null }[] = [];
  /** The store SKUs of each touchListings call. */
  readonly touches: string[][] = [];
  readonly missingMarks: { seenSince: Date; maxMissedRuns: number | undefined }[] = [];
  readonly states = new Map<string, ListingState>();
  /** Product slug that ingestObservations returns for a store SKU (a listing linked to a product). */
  readonly productSlugs = new Map<string, string>();
  recentCounts: number[] = [];
  ingestError: Error | null = null;
  closed = false;
  private nextListingId = 1;

  /** A listing known before the run; store-sold with a price unless overridden. */
  addListing(storeSku: string, overrides: Partial<ListingState> = {}): ListingState {
    const state: ListingState = {
      listingId: this.allocateListingId(),
      storeSku,
      productId: null,
      soldByStore: true,
      active: true,
      priceCents: 49_999,
      referencePriceCents: null,
      inStock: true,
      productPageCheckedAt: null,
      ...overrides,
    };
    this.states.set(storeSku, state);
    return state;
  }

  startRun(storeSlug: StoreSlug, options: { partial: boolean }): Promise<{ runId: number; startedAt: Date }> {
    this.calls.push("startRun");
    this.startedRuns.push({ storeSlug, partial: options.partial });
    return Promise.resolve({ runId: FAKE_RUN_ID, startedAt: new Date(0) });
  }

  finishRun(runId: number, summary: RunSummary): Promise<void> {
    this.calls.push("finishRun");
    this.finishedRuns.push({ runId, summary: structuredClone(summary) });
    return Promise.resolve();
  }

  recentListingCounts(_storeSlug: StoreSlug, limit: number): Promise<number[]> {
    this.calls.push(`recentListingCounts:${limit}`);
    return Promise.resolve(this.recentCounts);
  }

  getListingStates(_storeSlug: StoreSlug): Promise<Map<string, ListingState>> {
    this.calls.push("getListingStates");
    return Promise.resolve(new Map(this.states));
  }

  ingestObservations(
    _storeSlug: StoreSlug,
    observedAt: Date,
    items: readonly ObservationInput[],
  ): Promise<IngestResult[]> {
    this.calls.push("ingestObservations");
    if (this.ingestError !== null) {
      return Promise.reject(this.ingestError);
    }
    this.ingests.push({ observedAt, items: [...items] });
    return Promise.resolve(items.map((item) => this.ingestOne(item)));
  }

  saveListingDetails(input: ListingDetailsInput, productPageCheckedAt: Date | null): Promise<MatchOutcome> {
    this.calls.push("saveListingDetails");
    this.savedDetails.push({ input, productPageCheckedAt });
    return Promise.resolve("created");
  }

  /** Known listings become active again; returns how many were known, like the rows the database updates. */
  touchListings(_storeSlug: StoreSlug, storeSkus: readonly string[]): Promise<number> {
    this.calls.push("touchListings");
    this.touches.push([...storeSkus]);
    let touched = 0;
    for (const storeSku of storeSkus) {
      const state = this.states.get(storeSku);
      if (state !== undefined) {
        this.states.set(storeSku, { ...state, active: true });
        touched += 1;
      }
    }
    return Promise.resolve(touched);
  }

  markMissingListings(
    _storeSlug: StoreSlug,
    seenSince: Date,
    options?: { maxMissedRuns?: number },
  ): Promise<{ missed: number; deactivated: number }> {
    this.calls.push("markMissingListings");
    this.missingMarks.push({ seenSince, maxMissedRuns: options?.maxMissedRuns });
    return Promise.resolve({ missed: 0, deactivated: 0 });
  }

  loadPriceHistories(): AsyncGenerator<PriceHistory[]> {
    throw new Error("Not used by the runner");
  }

  upsertListingStats(_rows: readonly ListingStatsRow[]): Promise<void> {
    return Promise.reject(new Error("Not used by the runner"));
  }

  replaceListingStats(_rows: readonly ListingStatsRow[], _computedAt: Date): Promise<void> {
    return Promise.reject(new Error("Not used by the runner"));
  }

  close(): Promise<void> {
    this.calls.push("close");
    this.closed = true;
    return Promise.resolve();
  }

  private ingestOne(item: ObservationInput): IngestResult {
    const state = this.states.get(item.storeSku);
    const status: IngestStatus =
      state === undefined ? "new" : !item.soldByStore || samePrice(state, item) ? "unchanged" : "changed";
    const next: ListingState = {
      listingId: state?.listingId ?? this.allocateListingId(),
      storeSku: item.storeSku,
      productId: state?.productId ?? null,
      soldByStore: item.soldByStore,
      active: true,
      priceCents: item.soldByStore ? item.priceCents : null,
      referencePriceCents: item.soldByStore ? item.referencePriceCents : null,
      inStock: item.soldByStore ? item.inStock : null,
      productPageCheckedAt: state?.productPageCheckedAt ?? null,
    };
    this.states.set(item.storeSku, next);
    return {
      storeSku: item.storeSku,
      listingId: next.listingId,
      productId: next.productId,
      productSlug: this.productSlugs.get(item.storeSku) ?? null,
      status,
    };
  }

  private allocateListingId(): number {
    const listingId = this.nextListingId;
    this.nextListingId += 1;
    return listingId;
  }
}

function samePrice(state: ListingState, item: ObservationInput): boolean {
  return (
    state.priceCents === item.priceCents &&
    state.referencePriceCents === item.referencePriceCents &&
    state.inStock === item.inStock
  );
}
