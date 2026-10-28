import { DAY_MS, formatCents, type StoreSlug } from "@descontoreal/core";
import {
  applyMigrations,
  createDb,
  type Db,
  type ListingDetailsInput,
  seedReferenceData,
} from "@descontoreal/db";
import {
  createLocalPglite,
  pgliteExecutor,
  serveOverSocket,
  type ServedDatabase,
} from "@descontoreal/db/local";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runStats } from "../../src/jobs/stats";

type LocalDatabase = Awaited<ReturnType<typeof createLocalPglite>>;

// PGlite starts and migrates in a few seconds; a slow CI machine needs more than Vitest's default hook timeout.
const SETUP_TIMEOUT_MS = 60_000;
const NOW = new Date("2026-11-27T06:00:00.000Z");

interface Reading {
  daysAgo: number;
  priceCents: number;
  referencePriceCents?: number;
}

interface ProductFacts {
  ean: string;
  brand: string;
  model: string;
}

const SAMSUNG: ProductFacts = { ean: "8806094932287", brand: "Samsung", model: "WW90" };
const BOSCH: ProductFacts = { ean: "4006381333931", brand: "Bosch", model: "WAN28" };
const LG: ProductFacts = { ean: "5901234123457", brand: "LG", model: "F4WR" };

interface SavedStatsRow {
  listing_id: number;
  computed_at: Date;
  current_price_cents: number;
  label: string;
  warnings: string[];
  details: { warnings: { code: string; text: string }[] };
  real_discount_pct: number | null;
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY_MS);
}

describe("runStats with the real database client", () => {
  let database: LocalDatabase;
  let served: ServedDatabase;
  let client: Db;

  /** Records the readings oldest first, as the daily runs would, and returns the listing id. */
  async function observe(
    storeSlug: StoreSlug,
    storeSku: string,
    readings: readonly Reading[],
  ): Promise<number> {
    let listingId = 0;
    for (const reading of readings) {
      const [result] = await client.ingestObservations(storeSlug, daysAgo(reading.daysAgo), [
        {
          storeSku,
          url: `https://example.test/${storeSlug}/${storeSku}`,
          rawTitle: "Samsung WW90",
          soldByStore: true,
          priceCents: reading.priceCents,
          referencePriceCents: reading.referencePriceCents ?? null,
          inStock: true,
        },
      ]);
      listingId = result?.listingId ?? 0;
    }
    return listingId;
  }

  /** Links the listing to the product with the EAN, so listings of different stores share it. */
  async function linkToProduct(listingId: number, product: ProductFacts = SAMSUNG): Promise<void> {
    const name = `${product.brand} ${product.model}`;
    const details: ListingDetailsInput = {
      listingId,
      rawEan: product.ean,
      ean: product.ean,
      brand: product.brand,
      model: product.model,
      brandNorm: product.brand.toLowerCase(),
      modelNorm: product.model,
      name,
      slugBase: name.toLowerCase().replaceAll(" ", "-"),
      categorySlug: null,
      imageUrl: null,
      specs: {},
      soldByStore: true,
    };
    await client.saveListingDetails(details, daysAgo(60));
  }

  async function savedStatsRows(): Promise<SavedStatsRow[]> {
    const { rows } = await database.query<SavedStatsRow>(
      `select listing_id::int as listing_id, computed_at, current_price_cents, label, warnings, details,
              real_discount_pct::float8 as real_discount_pct
       from listing_stats order by listing_id`,
    );
    return rows;
  }

  beforeAll(async () => {
    database = await createLocalPglite();
    const executor = pgliteExecutor(database);
    await applyMigrations(executor);
    await seedReferenceData(executor);
    served = await serveOverSocket(database, { port: 0 });
    client = createDb(served.databaseUrl);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await client.close();
    await served.stop();
    await database.close();
  });

  it("saves rows listing_stats accepts, with labels, warnings and details", async () => {
    // Arrange
    const darty = await observe("darty", "D-1", [
      { daysAgo: 60, priceCents: 50_000 },
      { daysAgo: 5, priceCents: 45_000, referencePriceCents: 50_000 },
    ]);
    const radiopopular = await observe("radiopopular", "R-1", [
      { daysAgo: 60, priceCents: 42_000 },
      { daysAgo: 0, priceCents: 42_000 },
    ]);
    await linkToProduct(darty);
    await linkToProduct(radiopopular);

    // Act
    const summary = await runStats(client, NOW);

    // Assert
    expect(summary).toEqual({
      labels: { desconto_real: 1, preco_habitual: 1 },
      classified: 2,
      withoutCurrentPrice: 0,
    });
    const rows = await savedStatsRows();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.listing_id === darty)).toMatchObject({
      computed_at: NOW,
      current_price_cents: 45_000,
      label: "desconto_real",
      warnings: ["mais_barato_noutra_loja"],
      details: {
        warnings: [
          {
            code: "mais_barato_noutra_loja",
            text: `Radio Popular tem este produto a ${formatCents(42_000)}.`,
          },
        ],
      },
      real_discount_pct: 10,
    });
    expect(rows.find((row) => row.listing_id === radiopopular)).toMatchObject({
      current_price_cents: 42_000,
      label: "preco_habitual",
      warnings: [],
      real_discount_pct: null,
    });
  });

  it("drops the rows of deactivated listings and never quotes an offer a complete run missed", async () => {
    // Arrange
    const darty = await observe("darty", "D-2", [
      { daysAgo: 60, priceCents: 60_000 },
      { daysAgo: 0, priceCents: 60_000 },
    ]);
    const missed = await observe("radiopopular", "R-2", [
      { daysAgo: 60, priceCents: 50_000 },
      { daysAgo: 1, priceCents: 50_000 },
    ]);
    const gone = await observe("darty", "D-3", [{ daysAgo: 60, priceCents: 30_000 }]);
    await linkToProduct(darty, BOSCH);
    await linkToProduct(missed, BOSCH);
    await runStats(client, NOW);
    const todaysRunStart = new Date(NOW.getTime() - 60 * 60 * 1000);
    await client.markMissingListings("radiopopular", todaysRunStart);
    await client.markMissingListings("darty", todaysRunStart, { maxMissedRuns: 1 });

    // Act
    await runStats(client, NOW);

    // Assert
    const rows = await savedStatsRows();
    expect(rows.find((row) => row.listing_id === gone)).toBeUndefined();
    expect(rows.find((row) => row.listing_id === darty)).toMatchObject({
      computed_at: NOW,
      current_price_cents: 60_000,
      warnings: [],
    });
    expect(rows.find((row) => row.listing_id === missed)).toMatchObject({ current_price_cents: 50_000 });
  });

  it("never quotes an offer whose store saw it today without reading its price", async () => {
    // Arrange
    const darty = await observe("darty", "D-4", [
      { daysAgo: 60, priceCents: 60_000 },
      { daysAgo: 0, priceCents: 60_000 },
    ]);
    const unpriced = await observe("radiopopular", "R-4", [
      { daysAgo: 60, priceCents: 50_000 },
      { daysAgo: 1, priceCents: 50_000 },
    ]);
    await linkToProduct(darty, LG);
    await linkToProduct(unpriced, LG);
    const todaysRunStart = new Date(NOW.getTime() - 60 * 60 * 1000);
    await client.touchListings("radiopopular", ["R-4"]);
    await client.markMissingListings("radiopopular", todaysRunStart);

    // Act
    await runStats(client, NOW);

    // Assert
    const rows = await savedStatsRows();
    expect(rows.find((row) => row.listing_id === darty)).toMatchObject({
      current_price_cents: 60_000,
      warnings: [],
    });
    expect(rows.find((row) => row.listing_id === unpriced)).toMatchObject({ current_price_cents: 50_000 });
  });
});
