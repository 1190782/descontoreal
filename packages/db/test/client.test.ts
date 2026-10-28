import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb } from "../src/client";
import type { Db, ListingStatsRow, PriceHistory } from "../src/contract";
import { serveOverSocket, type ServedDatabase } from "../src/local/server";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "./helpers/database";
import {
  DAY_1,
  DAY_2,
  DAY_3,
  DAY_4,
  DAY_5,
  daysAfter,
  EAN_A,
  listingDetails,
  observation,
} from "./helpers/fixtures";

interface StoredStats {
  listing_id: number;
  computed_at: Date;
  label: string;
}

function statsRow(listingId: number, overrides: Partial<ListingStatsRow> = {}): ListingStatsRow {
  return {
    listingId,
    computedAt: DAY_2,
    currentPriceCents: 44_999,
    min30Cents: 44_999,
    min90Cents: 44_999,
    min180Cents: null,
    med90Cents: 49_999,
    max90Cents: 49_999,
    label: "bom_preco",
    warnings: ["esgotado"],
    details: { text: "10% abaixo do preço habitual dos últimos 90 dias." },
    realDiscountPct: 10.002_000_4,
    ...overrides,
  };
}

describe("createDb", () => {
  let db: PGlite;
  let served: ServedDatabase;
  let client: Db;

  async function collectHistories(batchSize: number): Promise<PriceHistory[][]> {
    const batches: PriceHistory[][] = [];
    for await (const batch of client.loadPriceHistories({ batchSize })) {
      batches.push(batch);
    }
    return batches;
  }

  async function listingIds(storeSkus: readonly string[]): Promise<number[]> {
    const results = await client.ingestObservations(
      "darty",
      DAY_1,
      storeSkus.map((storeSku) => observation(storeSku)),
    );
    return results.map((result) => result.listingId);
  }

  async function seenState(
    listingId: number,
  ): Promise<{ last_seen_at: Date; missed_runs: number; active: boolean }> {
    const result = await db.query<{ last_seen_at: Date; missed_runs: number; active: boolean }>(
      "select last_seen_at, missed_runs, active from listings where id = $1",
      [listingId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error(`listing ${listingId} not found`);
    }
    return row;
  }

  async function storedStats(): Promise<StoredStats[]> {
    const result = await db.query<StoredStats>(
      "select listing_id, computed_at, label from listing_stats order by listing_id",
    );
    return result.rows;
  }

  beforeAll(async () => {
    db = await createMigratedDatabase();
    served = await serveOverSocket(db, { port: 0 });
    client = createDb(served.databaseUrl);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await client.close();
    await served.stop();
    await db.close();
  });

  beforeEach(async () => {
    await resetData(db);
  });

  describe("scrape runs", () => {
    it("opens a running run and records its summary when it finishes", async () => {
      // Arrange
      const { runId, startedAt } = await client.startRun("darty", { partial: true });
      const summary = {
        status: "success" as const,
        pagesFetched: 12,
        listingsSeen: 340,
        errors: [{ url: "https://darty.pt/collections/tv?page=3", message: "HTTP 500" }],
      };

      // Act
      await client.finishRun(runId, summary);

      // Assert
      expect(startedAt).toBeInstanceOf(Date);
      const result = await db.query(
        `select s.slug as store, r.started_at, r.finished_at >= r.started_at as finished, r.status, r.partial,
                r.pages_fetched, r.listings_seen, r.errors
         from scrape_runs r join stores s on s.id = r.store_id
         where r.id = $1`,
        [runId],
      );
      expect(result.rows).toEqual([
        {
          store: "darty",
          started_at: startedAt,
          finished: true,
          status: "success",
          partial: true,
          pages_fetched: 12,
          listings_seen: 340,
          errors: summary.errors,
        },
      ]);
    });

    it("marks a run partial when it stopped early, and never unmarks one", async () => {
      // Arrange
      const complete = await client.startRun("darty", { partial: false });
      const stoppedEarly = await client.startRun("darty", { partial: false });
      const limited = await client.startRun("darty", { partial: true });
      const summary = { status: "success" as const, pagesFetched: 3, listingsSeen: 70, errors: [] };

      // Act
      await client.finishRun(complete.runId, summary);
      await client.finishRun(stoppedEarly.runId, { ...summary, partial: true });
      await client.finishRun(limited.runId, { ...summary, partial: false });

      // Assert
      const result = await db.query<{ id: number; partial: boolean }>(
        "select id, partial from scrape_runs order by id",
      );
      expect(result.rows).toEqual([
        { id: complete.runId, partial: false },
        { id: stoppedEarly.runId, partial: true },
        { id: limited.runId, partial: true },
      ]);
    });

    it("rejects finishing a run that does not exist", async () => {
      // Arrange
      const summary = { status: "failed" as const, pagesFetched: 0, listingsSeen: 0, errors: [] };

      // Act
      const act = client.finishRun(999, summary);

      // Assert
      await expect(act).rejects.toThrow("Unknown scrape run 999.");
    });

    it("counts listings of finished, complete runs that saw any, failed ones included, newest first", async () => {
      // Arrange
      await db.query(
        `insert into scrape_runs (store_id, started_at, finished_at, status, partial, listings_seen)
         select s.id, r.started_at, r.finished_at, r.status, r.partial, r.listings_seen
         from (values
           ('darty', $1::timestamptz, $1::timestamptz, 'success', false, 100),
           ('darty', $2::timestamptz, $2::timestamptz, 'success', true, 5),
           ('darty', $2::timestamptz, $2::timestamptz, 'failed', false, 0),
           ('darty', $3::timestamptz, $3::timestamptz, 'failed', false, 10),
           ('darty', $3::timestamptz, $3::timestamptz, 'blocked', false, 40),
           ('darty', $4::timestamptz, $4::timestamptz, 'success', false, 120),
           ('darty', $5::timestamptz, null, 'running', false, 80),
           ('radiopopular', $4::timestamptz, $4::timestamptz, 'success', false, 999)
         ) as r (store, started_at, finished_at, status, partial, listings_seen)
         join stores s on s.slug = r.store`,
        [DAY_1, DAY_2, DAY_3, DAY_4, DAY_5],
      );

      // Act
      const counts = [
        await client.recentListingCounts("darty", 7),
        await client.recentListingCounts("darty", 1),
      ];

      // Assert
      expect(counts).toEqual([[120, 10, 100], [120]]);
    });
  });

  describe("listings", () => {
    it("ingests observations and reads them back as listing states", async () => {
      // Arrange
      const items = [
        observation("A1", { priceCents: 44_999, referencePriceCents: 49_999, inStock: false }),
        observation("M1", { soldByStore: false }),
      ];

      // Act
      const results = await client.ingestObservations("darty", DAY_1, items);
      const states = await client.getListingStates("darty");

      // Assert
      expect(results.map(({ listingId: _listingId, ...result }) => result)).toEqual([
        { storeSku: "A1", productId: null, productSlug: null, status: "new" },
        { storeSku: "M1", productId: null, productSlug: null, status: "new" },
      ]);
      expect(new Set(results.map((result) => result.listingId)).size).toBe(2);
      expect([...states.keys()].toSorted()).toEqual(["A1", "M1"]);
      expect(states.get("A1")).toEqual({
        listingId: results[0]?.listingId,
        storeSku: "A1",
        productId: null,
        soldByStore: true,
        active: true,
        priceCents: 44_999,
        referencePriceCents: 49_999,
        inStock: false,
        productPageCheckedAt: null,
      });
      expect(states.get("M1")).toMatchObject({ soldByStore: false, priceCents: null, inStock: null });
    });

    it("stores the PVPr of each item, and null for items without one", async () => {
      // Arrange
      const items = [
        observation("A1", { rrpCents: 54_999 }),
        observation("B2"),
        observation("C3", { rrpCents: null }),
      ];

      // Act
      await client.ingestObservations("darty", DAY_1, items);

      // Assert
      const result = await db.query<{
        store_sku: string;
        reference_price_cents: number | null;
        rrp_cents: number | null;
      }>(
        `select l.store_sku, pp.reference_price_cents, pp.rrp_cents
         from price_points pp join listings l on l.id = pp.listing_id
         order by l.store_sku`,
      );
      expect(result.rows).toEqual([
        { store_sku: "A1", reference_price_cents: null, rrp_cents: 54_999 },
        { store_sku: "B2", reference_price_cents: null, rrp_cents: null },
        { store_sku: "C3", reference_price_cents: null, rrp_cents: null },
      ]);
    });

    it("returns nothing for an empty batch", async () => {
      // Arrange
      const items: never[] = [];

      // Act
      const results = await client.ingestObservations("darty", DAY_1, items);

      // Assert
      expect(results).toEqual([]);
    });

    it("saves listing details and reports the linked product", async () => {
      // Arrange
      const [created] = await client.ingestObservations("darty", DAY_1, [observation("A1")]);
      const listingId = created?.listingId ?? 0;

      // Act
      const outcome = await client.saveListingDetails(listingDetails(listingId, { ean: EAN_A }), DAY_2);
      const [seenAgain] = await client.ingestObservations("darty", DAY_3, [observation("A1")]);
      const state = (await client.getListingStates("darty")).get("A1");

      // Assert
      expect(outcome).toBe("created_ean");
      expect(seenAgain).toMatchObject({
        productSlug: "samsung-ww90t534dae-maquina-de-lavar-roupa",
        status: "unchanged",
      });
      expect(seenAgain?.productId).toBeTypeOf("number");
      expect(state).toMatchObject({ productId: seenAgain?.productId, productPageCheckedAt: DAY_2 });
    });

    it("stores only the known detail fields", async () => {
      // Arrange
      const [created] = await client.ingestObservations("darty", DAY_1, [observation("A1")]);
      const input = { ...listingDetails(created?.listingId ?? 0), description: "Texto copiado da loja" };

      // Act
      await client.saveListingDetails(input, null);

      // Assert
      const result = await db.query<{ details: Record<string, unknown> }>(
        "select details from listings where id = $1",
        [created?.listingId],
      );
      expect(Object.keys(result.rows[0]?.details ?? {})).not.toContain("description");
    });

    it("marks listings missing from a complete run", async () => {
      // Arrange
      await client.ingestObservations("darty", DAY_1, [observation("GONE"), observation("SEEN")]);
      await client.ingestObservations("darty", DAY_2, [observation("SEEN")]);

      // Act
      const result = await client.markMissingListings("darty", DAY_2);

      // Assert
      expect(result).toEqual({ missed: 1, deactivated: 0 });
    });

    it("deactivates a listing on the third complete run without it by default", async () => {
      // Arrange
      const [gone = 0] = await listingIds(["GONE"]);
      const runDays = [DAY_2, DAY_3, DAY_4, DAY_5];

      // Act
      const deactivated: number[] = [];
      for (const day of runDays) {
        deactivated.push((await client.markMissingListings("darty", day)).deactivated);
      }

      // Assert
      expect(deactivated).toEqual([0, 0, 1, 0]);
      expect(await seenState(gone)).toMatchObject({ missed_runs: 3, active: false });
    });

    it("waits for maxMissedRuns complete runs without a listing before deactivating it", async () => {
      // Arrange
      const [gone = 0] = await listingIds(["GONE"]);
      const runDays = Array.from({ length: 8 }, (_, index) => daysAfter(DAY_1, index + 1));

      // Act
      const deactivated: number[] = [];
      for (const day of runDays) {
        deactivated.push((await client.markMissingListings("darty", day, { maxMissedRuns: 7 })).deactivated);
      }

      // Assert
      expect(deactivated).toEqual([0, 0, 0, 0, 0, 0, 1, 0]);
      expect(await seenState(gone)).toMatchObject({ missed_runs: 7, active: false });
    });

    it.each([0, 2.5])("rejects maxMissedRuns %s", async (maxMissedRuns) => {
      // Arrange
      const [gone = 0] = await listingIds(["GONE"]);

      // Act
      const act = client.markMissingListings("darty", DAY_2, { maxMissedRuns });

      // Assert
      await expect(act).rejects.toThrow(`maxMissedRuns must be a positive integer, got ${maxMissedRuns}.`);
      expect(await seenState(gone)).toMatchObject({ missed_runs: 0 });
    });
  });

  describe("touchListings", () => {
    it("resets the missed runs and keeps the prices, so the run that follows counts one missed run", async () => {
      // Arrange
      const [listingId = 0] = await listingIds(["A1"]);
      await client.markMissingListings("darty", DAY_2);
      await client.markMissingListings("darty", DAY_3);

      // Act
      const touched = await client.touchListings("darty", ["A1", "UNKNOWN"]);

      // Assert
      expect(touched).toBe(1);
      expect(await seenState(listingId)).toEqual({ last_seen_at: DAY_1, missed_runs: 0, active: true });
      expect((await client.getListingStates("darty")).get("A1")).toMatchObject({ priceCents: 49_999 });
      expect(await client.markMissingListings("darty", DAY_4)).toEqual({ missed: 1, deactivated: 0 });
      expect(await seenState(listingId)).toEqual({ last_seen_at: DAY_1, missed_runs: 1, active: true });
    });

    it("passes SKUs with commas and quotes as they are", async () => {
      // Arrange
      const storeSkus = ['KIT "A,B"', "C\\D", "E F"];
      const ids = await listingIds(storeSkus);
      await client.markMissingListings("darty", DAY_2);

      // Act
      const touched = await client.touchListings("darty", storeSkus);

      // Assert
      expect(touched).toBe(3);
      for (const listingId of ids) {
        expect((await seenState(listingId)).missed_runs).toBe(0);
      }
    });

    it("touches nothing for an empty list", async () => {
      // Arrange
      const [listingId = 0] = await listingIds(["A1"]);
      await client.markMissingListings("darty", DAY_2);

      // Act
      const touched = await client.touchListings("darty", []);

      // Assert
      expect(touched).toBe(0);
      expect(await seenState(listingId)).toEqual({ last_seen_at: DAY_1, missed_runs: 1, active: true });
    });
  });

  describe("loadPriceHistories", () => {
    it("yields active listings sold by the store in batches, with ordered intervals", async () => {
      // Arrange
      const [listingA] = await client.ingestObservations("darty", DAY_1, [
        observation("A", { priceCents: 49_999 }),
        observation("B"),
        observation("INACTIVE"),
        observation("MARKETPLACE", { soldByStore: false }),
      ]);
      await client.ingestObservations("radiopopular", DAY_1, [observation("R")]);
      await client.ingestObservations("darty", DAY_2, [observation("A", { priceCents: 44_999 })]);
      await db.query("update listings set active = false where store_sku = 'INACTIVE'");

      // Act
      const batches = await collectHistories(2);

      // Assert
      expect(batches.map((batch) => batch.map((history) => history.storeName))).toEqual([
        ["Darty", "Darty"],
        ["Radio Popular"],
      ]);
      const [first] = batches[0] ?? [];
      expect(first).toEqual({
        listingId: listingA?.listingId,
        productId: null,
        storeSlug: "darty",
        storeName: "Darty",
        firstSeenAt: DAY_1,
        lastSeenAt: DAY_2,
        missedRuns: 0,
        intervals: [
          { priceCents: 49_999, referencePriceCents: null, inStock: true, validFrom: DAY_1, validTo: DAY_2 },
          { priceCents: 44_999, referencePriceCents: null, inStock: true, validFrom: DAY_2, validTo: null },
        ],
      });
      expect(batches[1]?.[0]?.storeSlug).toBe("radiopopular");
    });

    it("tells when each listing's price was last read and how many complete runs missed it since", async () => {
      // Arrange
      const [missedId, unpricedId, seenId] = await listingIds(["MISSED", "UNPRICED", "SEEN"]);
      await client.ingestObservations("darty", DAY_2, [observation("UNPRICED")]);
      await client.ingestObservations("darty", DAY_3, [observation("SEEN")]);
      await client.touchListings("darty", ["UNPRICED"]);
      await client.markMissingListings("darty", DAY_3);

      // Act
      const [batch] = await collectHistories(10);

      // Assert
      expect(
        batch?.map(({ listingId, lastSeenAt, missedRuns }) => ({ listingId, lastSeenAt, missedRuns })),
      ).toEqual([
        { listingId: missedId, lastSeenAt: DAY_1, missedRuns: 1 },
        { listingId: unpricedId, lastSeenAt: DAY_2, missedRuns: 1 },
        { listingId: seenId, lastSeenAt: DAY_3, missedRuns: 0 },
      ]);
    });

    it("yields nothing when there are no listings", async () => {
      // Arrange
      const batchSize = 10;

      // Act
      const batches = await collectHistories(batchSize);

      // Assert
      expect(batches).toEqual([]);
    });

    it("rejects a batch size below 1", async () => {
      // Arrange
      const batchSize = 0;

      // Act
      const act = collectHistories(batchSize);

      // Assert
      await expect(act).rejects.toThrow("batchSize must be a positive integer");
    });
  });

  describe("upsertListingStats", () => {
    it("inserts new stats and replaces them on the next run", async () => {
      // Arrange
      const [created] = await client.ingestObservations("darty", DAY_1, [observation("A1")]);
      const listingId = created?.listingId ?? 0;
      await client.upsertListingStats([statsRow(listingId)]);

      // Act
      await client.upsertListingStats([
        statsRow(listingId, {
          computedAt: DAY_3,
          label: "preco_habitual",
          warnings: [],
          realDiscountPct: null,
        }),
      ]);

      // Assert
      const result = await db.query("select * from listing_stats");
      expect(result.rows).toEqual([
        {
          listing_id: listingId,
          computed_at: DAY_3,
          current_price_cents: 44_999,
          min30_cents: 44_999,
          min90_cents: 44_999,
          min180_cents: null,
          med90_cents: 49_999,
          max90_cents: 49_999,
          label: "preco_habitual",
          warnings: [],
          details: { text: "10% abaixo do preço habitual dos últimos 90 dias." },
          real_discount_pct: null,
        },
      ]);
    });

    it("keeps warnings, details and the real discount as given", async () => {
      // Arrange
      const [created] = await client.ingestObservations("darty", DAY_1, [observation("A1")]);
      const row = statsRow(created?.listingId ?? 0, { warnings: ["esgotado", "mais_barato_noutra_loja"] });

      // Act
      await client.upsertListingStats([row]);

      // Assert
      const result = await db.query<{ warnings: string[]; details: unknown; real_discount_pct: string }>(
        "select warnings, details, real_discount_pct::text from listing_stats",
      );
      expect(result.rows).toEqual([
        {
          warnings: ["esgotado", "mais_barato_noutra_loja"],
          details: row.details,
          real_discount_pct: "10.0020004",
        },
      ]);
    });

    it("writes more rows than one batch holds", async () => {
      // Arrange
      const items = Array.from({ length: 501 }, (_, index) => observation(`SKU-${index}`));
      const results = await client.ingestObservations("darty", DAY_1, items);

      // Act
      await client.upsertListingStats(results.map((result) => statsRow(result.listingId)));

      // Assert
      const count = await db.query<{ count: number }>("select count(*)::int as count from listing_stats");
      expect(count.rows).toEqual([{ count: 501 }]);
    });
  });

  describe("replaceListingStats", () => {
    it("upserts the rows and deletes the stats of every other listing", async () => {
      // Arrange
      const [kept = 0, stale = 0, added = 0] = await listingIds(["KEPT", "STALE", "ADDED"]);
      await client.upsertListingStats([statsRow(kept), statsRow(stale)]);
      const rows = [
        statsRow(kept, { computedAt: DAY_3, label: "preco_habitual" }),
        statsRow(added, { computedAt: DAY_3 }),
      ];

      // Act
      await client.replaceListingStats(rows, DAY_3);

      // Assert
      expect(await storedStats()).toEqual([
        { listing_id: kept, computed_at: DAY_3, label: "preco_habitual" },
        { listing_id: added, computed_at: DAY_3, label: "bom_preco" },
      ]);
    });

    it("keeps the stats of every listing given when they take more than one batch", async () => {
      // Arrange
      const [stale = 0, ...classified] = await listingIds(
        Array.from({ length: 502 }, (_, index) => `SKU-${index}`),
      );
      await client.upsertListingStats([stale, ...classified].map((listingId) => statsRow(listingId)));

      // Act
      await client.replaceListingStats(
        classified.map((listingId) => statsRow(listingId, { computedAt: DAY_3 })),
        DAY_3,
      );

      // Assert
      const stored = await storedStats();
      expect(stored.map((row) => row.listing_id)).toEqual(classified);
      expect(stored.every((row) => row.computed_at.getTime() === DAY_3.getTime())).toBe(true);
    });

    it("leaves the previous stats as they were when a later batch fails", async () => {
      // Arrange
      const ids = await listingIds(Array.from({ length: 501 }, (_, index) => `SKU-${index}`));
      await client.upsertListingStats(ids.slice(0, 2).map((listingId) => statsRow(listingId)));
      const before = await db.query("select * from listing_stats order by listing_id");
      const rows = [
        ...ids
          .slice(1)
          .map((listingId) => statsRow(listingId, { computedAt: DAY_3, label: "preco_habitual" })),
        statsRow(999_999, { computedAt: DAY_3 }),
      ];

      // Act
      const act = client.replaceListingStats(rows, DAY_3);

      // Assert
      await expect(act).rejects.toThrow("listing_stats_listing_id_fkey");
      expect(before.rows).toHaveLength(2);
      expect((await db.query("select * from listing_stats order by listing_id")).rows).toEqual(before.rows);
    });

    it("rejects rows computed at another time, before changing anything", async () => {
      // Arrange
      const [listingId = 0, otherId = 0] = await listingIds(["A1", "B2"]);
      await client.upsertListingStats([statsRow(listingId), statsRow(otherId)]);
      const rows = [statsRow(listingId, { computedAt: DAY_2, label: "preco_habitual" })];

      // Act
      const act = client.replaceListingStats(rows, DAY_3);

      // Assert
      await expect(act).rejects.toThrow(
        `Stats of listing ${listingId} were computed at 2026-10-29T03:00:00.000Z, not at 2026-10-30T03:00:00.000Z.`,
      );
      expect(await storedStats()).toEqual([
        { listing_id: listingId, computed_at: DAY_2, label: "bom_preco" },
        { listing_id: otherId, computed_at: DAY_2, label: "bom_preco" },
      ]);
    });

    it("empties the table when no listing was classified", async () => {
      // Arrange
      const [listingId = 0] = await listingIds(["A1"]);
      await client.upsertListingStats([statsRow(listingId)]);

      // Act
      await client.replaceListingStats([], DAY_3);

      // Assert
      expect(await storedStats()).toEqual([]);
    });
  });

  it("refuses an invalid DATABASE_URL without repeating it", () => {
    // Arrange
    const databaseUrl = "postgresql://user:s3cret@[bad";

    // Act
    const act = (): Db => createDb(databaseUrl);

    // Assert
    expect(act).toThrow(/^DATABASE_URL is not a valid URL\.$/);
  });
});
