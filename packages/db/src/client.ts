import { isStoreSlug, type PriceInterval } from "@descontoreal/core";
import { createSql, type DbQueries } from "./connection";
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
} from "./contract";

const DEFAULT_HISTORY_BATCH_SIZE = 500;
const DEFAULT_MAX_MISSED_RUNS = 3;
const STATS_BATCH_SIZE = 500;
const CLOSE_TIMEOUT_SECONDS = 5;

const INGEST_STATUSES: ReadonlySet<string> = new Set<IngestStatus>(["new", "unchanged", "changed"]);
const MATCH_OUTCOMES: ReadonlySet<string> = new Set<MatchOutcome>([
  "already_linked",
  "linked_ean",
  "created_ean",
  "linked_brand_model",
  "candidate",
  "created",
]);

interface ListingStateRow {
  id: number;
  store_sku: string;
  product_id: number | null;
  sold_by_store: boolean;
  active: boolean;
  product_page_checked_at: Date | null;
  price_cents: number | null;
  reference_price_cents: number | null;
  in_stock: boolean | null;
}

interface IngestRow {
  store_sku: string;
  listing_id: number;
  product_id: number | null;
  product_slug: string | null;
  status: string;
}

interface HistoryRow {
  listing_id: number;
  product_id: number | null;
  first_seen_at: Date;
  last_seen_at: Date;
  missed_runs: number;
  store_slug: string;
  store_name: string;
  price_cents: number | null;
  reference_price_cents: number | null;
  in_stock: boolean | null;
  valid_from: Date | null;
  valid_to: Date | null;
}

/** Db backed by postgres.js. `databaseUrl` is the Supabase session pooler URL (DATABASE_URL). */
export function createDb(databaseUrl: string): Db {
  const sql = createSql(databaseUrl);

  return {
    async startRun(storeSlug, options) {
      const rows = await sql<{ id: number; started_at: Date }[]>`
        insert into scrape_runs (store_id, partial)
        select s.id, ${options.partial} from stores s where s.slug = ${storeSlug}
        returning id, started_at
      `;
      const row = rows[0];
      if (!row) {
        throw new Error(`Unknown store "${storeSlug}". Run pnpm db:seed.`);
      }
      return { runId: row.id, startedAt: row.started_at };
    },

    async finishRun(runId, summary) {
      const rows = await sql`
        update scrape_runs
        set status = ${summary.status},
            finished_at = now(),
            pages_fetched = ${summary.pagesFetched},
            listings_seen = ${summary.listingsSeen},
            errors = ${JSON.stringify(summary.errors)}::text::jsonb,
            partial = partial or ${summary.partial ?? false}
        where id = ${runId}
        returning id
      `;
      if (rows.length === 0) {
        throw new Error(`Unknown scrape run ${runId}.`);
      }
    },

    async recentListingCounts(storeSlug, limit) {
      const rows = await sql<{ listings_seen: number }[]>`
        select r.listings_seen
        from scrape_runs r
        join stores s on s.id = r.store_id
        where s.slug = ${storeSlug} and r.status in ('success', 'failed') and not r.partial
          and r.finished_at is not null and r.listings_seen > 0
        order by r.started_at desc, r.id desc
        limit ${limit}
      `;
      return rows.map((row) => row.listings_seen);
    },

    async getListingStates(storeSlug) {
      const rows = await sql<ListingStateRow[]>`
        select l.id, l.store_sku, l.product_id, l.sold_by_store, l.active, l.product_page_checked_at,
               pp.price_cents, pp.reference_price_cents, pp.in_stock
        from listings l
        join stores s on s.id = l.store_id
        left join price_points pp on pp.listing_id = l.id and pp.valid_to is null
        where s.slug = ${storeSlug}
      `;
      return new Map(rows.map((row) => [row.store_sku, toListingState(row)]));
    },

    async ingestObservations(storeSlug, observedAt, items) {
      if (items.length === 0) {
        return [];
      }
      const payload = JSON.stringify(items.map(observationPayload));
      const rows = await sql<IngestRow[]>`
        select * from ingest_observations(${storeSlug}, ${observedAt}, ${payload}::text::jsonb)
      `;
      return rows.map(toIngestResult);
    },

    async saveListingDetails(input, productPageCheckedAt) {
      const rows = await sql<{ outcome: string }[]>`
        select save_listing_details(${JSON.stringify(detailsPayload(input))}::text::jsonb, ${productPageCheckedAt}) as outcome
      `;
      const outcome = rows[0]?.outcome ?? "";
      if (!isMatchOutcome(outcome)) {
        throw new Error(`Unexpected match outcome "${outcome}".`);
      }
      return outcome;
    },

    async touchListings(storeSlug, storeSkus) {
      if (storeSkus.length === 0) {
        return 0;
      }
      const rows = await sql<{ touched: number }[]>`
        select touch_listings(${storeSlug}, ${sql.array([...storeSkus])}) as touched
      `;
      return rows[0]?.touched ?? 0;
    },

    async markMissingListings(storeSlug, seenSince, options = {}) {
      const maxMissedRuns = options.maxMissedRuns ?? DEFAULT_MAX_MISSED_RUNS;
      if (!Number.isInteger(maxMissedRuns) || maxMissedRuns < 1) {
        throw new Error(`maxMissedRuns must be a positive integer, got ${maxMissedRuns}.`);
      }
      const rows = await sql<{ missed: number; deactivated: number }[]>`
        select missed, deactivated from mark_missing_listings(${storeSlug}, ${seenSince}, ${maxMissedRuns})
      `;
      return { missed: rows[0]?.missed ?? 0, deactivated: rows[0]?.deactivated ?? 0 };
    },

    async *loadPriceHistories(options = {}) {
      const batchSize = options.batchSize ?? DEFAULT_HISTORY_BATCH_SIZE;
      if (!Number.isInteger(batchSize) || batchSize < 1) {
        throw new Error(`batchSize must be a positive integer, got ${batchSize}.`);
      }
      let afterListingId = 0;
      for (;;) {
        const rows = await sql<HistoryRow[]>`
          with batch as (
            select l.id, l.product_id, l.first_seen_at, l.last_seen_at, l.missed_runs,
                   s.slug as store_slug, s.name as store_name
            from listings l
            join stores s on s.id = l.store_id
            where l.active and l.sold_by_store and l.id > ${afterListingId}
            order by l.id
            limit ${batchSize}
          )
          select b.id as listing_id, b.product_id, b.first_seen_at, b.last_seen_at, b.missed_runs, b.store_slug,
                 b.store_name, pp.price_cents, pp.reference_price_cents, pp.in_stock, pp.valid_from, pp.valid_to
          from batch b
          left join price_points pp on pp.listing_id = b.id
          order by b.id, pp.valid_from
        `;
        const batch = groupHistories(rows);
        if (batch.histories.length > 0) {
          yield batch.histories;
        }
        if (batch.listingCount < batchSize) {
          return;
        }
        afterListingId = batch.lastListingId;
      }
    },

    async upsertListingStats(rows) {
      await upsertStats(sql, rows);
    },

    async replaceListingStats(rows, computedAt) {
      const misdated = rows.find((row) => row.computedAt.getTime() !== computedAt.getTime());
      if (misdated) {
        throw new Error(
          `Stats of listing ${misdated.listingId} were computed at ${misdated.computedAt.toISOString()}, ` +
            `not at ${computedAt.toISOString()}.`,
        );
      }
      const listingIds = rows.map((row) => row.listingId);
      await sql.begin(async (tx) => {
        await upsertStats(tx, rows);
        await tx`
          delete from listing_stats ls
          where not exists (
            select 1 from unnest(${tx.array(listingIds)}::bigint[]) as kept (listing_id)
            where kept.listing_id = ls.listing_id
          )
        `;
      });
    },

    async close() {
      await sql.end({ timeout: CLOSE_TIMEOUT_SECONDS });
    },
  };
}

async function upsertStats(sql: DbQueries, rows: readonly ListingStatsRow[]): Promise<void> {
  for (let start = 0; start < rows.length; start += STATS_BATCH_SIZE) {
    const batch: readonly ListingStatsRow[] = rows.slice(start, start + STATS_BATCH_SIZE);
    await sql`
      insert into listing_stats (
        listing_id, computed_at, current_price_cents, min30_cents, min90_cents, min180_cents,
        med90_cents, max90_cents, label, warnings, details, real_discount_pct
      )
      select r."listingId", r."computedAt", r."currentPriceCents", r."min30Cents", r."min90Cents",
             r."min180Cents", r."med90Cents", r."max90Cents", r.label, r.warnings, r.details,
             r."realDiscountPct"
      from jsonb_to_recordset(${JSON.stringify(batch)}::text::jsonb) as r (
        "listingId" bigint, "computedAt" timestamptz, "currentPriceCents" integer,
        "min30Cents" integer, "min90Cents" integer, "min180Cents" integer, "med90Cents" integer,
        "max90Cents" integer, label text, warnings text[], details jsonb, "realDiscountPct" numeric
      )
      on conflict (listing_id) do update
      set computed_at = excluded.computed_at,
          current_price_cents = excluded.current_price_cents,
          min30_cents = excluded.min30_cents,
          min90_cents = excluded.min90_cents,
          min180_cents = excluded.min180_cents,
          med90_cents = excluded.med90_cents,
          max90_cents = excluded.max90_cents,
          label = excluded.label,
          warnings = excluded.warnings,
          details = excluded.details,
          real_discount_pct = excluded.real_discount_pct
    `;
  }
}

function toListingState(row: ListingStateRow): ListingState {
  return {
    listingId: row.id,
    storeSku: row.store_sku,
    productId: row.product_id,
    soldByStore: row.sold_by_store,
    active: row.active,
    priceCents: row.price_cents,
    referencePriceCents: row.reference_price_cents,
    inStock: row.in_stock,
    productPageCheckedAt: row.product_page_checked_at,
  };
}

function toIngestResult(row: IngestRow): IngestResult {
  const status = row.status;
  if (!isIngestStatus(status)) {
    throw new Error(`Unexpected ingest status "${status}".`);
  }
  return {
    storeSku: row.store_sku,
    listingId: row.listing_id,
    productId: row.product_id,
    productSlug: row.product_slug,
    status,
  };
}

function isIngestStatus(value: string): value is IngestStatus {
  return INGEST_STATUSES.has(value);
}

function isMatchOutcome(value: string): value is MatchOutcome {
  return MATCH_OUTCOMES.has(value);
}

/** Only the known fields, with the PVPr always present: an item without one stores null. */
function observationPayload(item: ObservationInput): Required<ObservationInput> {
  return {
    storeSku: item.storeSku,
    url: item.url,
    rawTitle: item.rawTitle,
    soldByStore: item.soldByStore,
    priceCents: item.priceCents,
    referencePriceCents: item.referencePriceCents,
    rrpCents: item.rrpCents ?? null,
    inStock: item.inStock,
  };
}

/** Only the known fields: the database keeps them as the listing's details. */
function detailsPayload(input: ListingDetailsInput): ListingDetailsInput {
  return {
    listingId: input.listingId,
    rawEan: input.rawEan,
    ean: input.ean,
    brand: input.brand,
    model: input.model,
    brandNorm: input.brandNorm,
    modelNorm: input.modelNorm,
    name: input.name,
    slugBase: input.slugBase,
    categorySlug: input.categorySlug,
    imageUrl: input.imageUrl,
    specs: input.specs,
    soldByStore: input.soldByStore,
  };
}

function groupHistories(rows: readonly HistoryRow[]): {
  histories: PriceHistory[];
  listingCount: number;
  lastListingId: number;
} {
  const histories: PriceHistory[] = [];
  let current: PriceHistory | null = null;
  let listingCount = 0;
  let lastListingId = 0;
  for (const row of rows) {
    if (row.listing_id !== lastListingId) {
      listingCount += 1;
      lastListingId = row.listing_id;
      if (!isStoreSlug(row.store_slug)) {
        throw new Error(`Store "${row.store_slug}" is not in core STORES.`);
      }
      current = {
        listingId: row.listing_id,
        productId: row.product_id,
        storeSlug: row.store_slug,
        storeName: row.store_name,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        missedRuns: row.missed_runs,
        intervals: [],
      };
      histories.push(current);
    }
    if (current && row.price_cents !== null && row.in_stock !== null && row.valid_from !== null) {
      const interval: PriceInterval = {
        priceCents: row.price_cents,
        referencePriceCents: row.reference_price_cents,
        inStock: row.in_stock,
        validFrom: row.valid_from,
        validTo: row.valid_to,
      };
      current.intervals.push(interval);
    }
  }
  return {
    histories: histories.filter((history) => history.intervals.length > 0),
    listingCount,
    lastListingId,
  };
}
