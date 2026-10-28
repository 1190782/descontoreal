import type { StoreSlug } from "@descontoreal/core";
import type {
  Db,
  IngestResult,
  ListingDetailsInput,
  ListingState,
  ListingStatsRow,
  MatchOutcome,
  ObservationInput,
  PriceHistory,
  RunSummary,
} from "@descontoreal/db";

export interface StatsReplacement {
  rows: ListingStatsRow[];
  computedAt: Date;
}

/** In-memory Db for the stats job: yields the given batches and records every listing_stats replacement. */
export class FakeStatsDb implements Db {
  readonly replacements: StatsReplacement[] = [];
  closed = false;
  closeError: Error | null = null;
  private readonly batches: readonly PriceHistory[][];

  constructor(batches: readonly PriceHistory[][] = []) {
    this.batches = batches;
  }

  get savedRows(): ListingStatsRow[] {
    return this.replacements.flatMap((replacement) => replacement.rows);
  }

  async *loadPriceHistories(): AsyncGenerator<PriceHistory[]> {
    for (const batch of this.batches) {
      // Like the real client, each batch arrives after an asynchronous query.
      yield await Promise.resolve(batch);
    }
  }

  replaceListingStats(rows: readonly ListingStatsRow[], computedAt: Date): Promise<void> {
    this.replacements.push({ rows: [...rows], computedAt });
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return this.closeError === null ? Promise.resolve() : Promise.reject(this.closeError);
  }

  upsertListingStats(_rows: readonly ListingStatsRow[]): Promise<void> {
    return notUsed();
  }

  startRun(
    _storeSlug: StoreSlug,
    _options: { partial: boolean },
  ): Promise<{ runId: number; startedAt: Date }> {
    return notUsed();
  }

  finishRun(_runId: number, _summary: RunSummary): Promise<void> {
    return notUsed();
  }

  recentListingCounts(_storeSlug: StoreSlug, _limit: number): Promise<number[]> {
    return notUsed();
  }

  getListingStates(_storeSlug: StoreSlug): Promise<Map<string, ListingState>> {
    return notUsed();
  }

  ingestObservations(
    _storeSlug: StoreSlug,
    _observedAt: Date,
    _items: readonly ObservationInput[],
  ): Promise<IngestResult[]> {
    return notUsed();
  }

  saveListingDetails(_input: ListingDetailsInput, _productPageCheckedAt: Date | null): Promise<MatchOutcome> {
    return notUsed();
  }

  touchListings(_storeSlug: StoreSlug, _storeSkus: readonly string[]): Promise<number> {
    return notUsed();
  }

  markMissingListings(
    _storeSlug: StoreSlug,
    _seenSince: Date,
    _options?: { maxMissedRuns?: number },
  ): Promise<{ missed: number; deactivated: number }> {
    return notUsed();
  }
}

function notUsed(): Promise<never> {
  return Promise.reject(new Error("Not used by the stats job"));
}
