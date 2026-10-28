import { DAY_MS, formatCents, getStore, type PriceInterval, type StoreSlug } from "@descontoreal/core";
import type { ListingStatsRow, PriceHistory } from "@descontoreal/db";
import { describe, expect, it } from "vitest";
import { formatStatsSummary, runStats, type StatsSummary } from "../../src/jobs/stats";
import { FakeStatsDb } from "./fake-stats-db";

// 06:00 in Lisbon too: winter time is UTC.
const NOW = new Date("2026-11-27T06:00:00.000Z");

interface Step {
  price: number;
  /** How long the price held, in days. */
  days: number;
  reference?: number;
  inStock?: boolean;
}

interface ListingOptions {
  store?: StoreSlug;
  productId?: number | null;
  /** The last price ended this many days ago, so no interval is current. */
  closedDaysAgo?: number;
  /** When a run last saw the listing; defaults to the end of the last price. */
  lastSeenAt?: Date;
  missedRuns?: number;
  /** The history ends here instead of at NOW. */
  now?: Date;
}

// Oldest price first; the last step is the current price.
const NEW_LISTING: Step[] = [{ price: 50_000, days: 10 }];
const REAL_DISCOUNT: Step[] = [
  { price: 40_000, days: 30 },
  { price: 50_000, days: 115 },
  { price: 45_000, days: 5, reference: 50_000 },
];

function daysAgo(days: number, now: Date = NOW): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** One listing's contiguous history, ending at NOW (or options.now) unless closed. */
function listing(listingId: number, steps: readonly Step[], options: ListingOptions = {}): PriceHistory {
  const store = options.store ?? "darty";
  const now = options.now ?? NOW;
  const closedDaysAgo = options.closedDaysAgo ?? 0;
  const intervals = steps.map((step, index): PriceInterval => {
    const endDaysAgo = closedDaysAgo + steps.slice(index + 1).reduce((sum, later) => sum + later.days, 0);
    const isCurrent = index === steps.length - 1 && options.closedDaysAgo === undefined;
    return {
      priceCents: step.price,
      referencePriceCents: step.reference ?? null,
      inStock: step.inStock ?? true,
      validFrom: daysAgo(endDaysAgo + step.days, now),
      validTo: isCurrent ? null : daysAgo(endDaysAgo, now),
    };
  });
  return {
    listingId,
    productId: options.productId ?? null,
    storeSlug: store,
    storeName: getStore(store).name,
    firstSeenAt: intervals[0]?.validFrom ?? now,
    lastSeenAt: options.lastSeenAt ?? daysAgo(closedDaysAgo, now),
    missedRuns: options.missedRuns ?? 0,
    intervals,
  };
}

/** A listing that has held one price for 40 days: enough history, no announced discount. */
function steadyListing(listingId: number, price: number, options: ListingOptions = {}): PriceHistory {
  return listing(listingId, [{ price, days: 40 }], options);
}

function savedRow(db: FakeStatsDb, listingId: number): ListingStatsRow | undefined {
  return db.savedRows.find((row) => row.listingId === listingId);
}

describe("runStats", () => {
  it("saves the window stats, label and numbers of a listing with a current price", async () => {
    // Arrange
    const db = new FakeStatsDb([[listing(1, REAL_DISCOUNT)]]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(db.savedRows).toHaveLength(1);
    expect(savedRow(db, 1)).toMatchObject({
      listingId: 1,
      computedAt: NOW,
      currentPriceCents: 45_000,
      min30Cents: 45_000,
      min90Cents: 45_000,
      min180Cents: 40_000,
      med90Cents: 50_000,
      max90Cents: 50_000,
      label: "desconto_real",
      warnings: [],
      realDiscountPct: 10,
    });
  });

  it("keeps the classification texts and numbers as the row details", async () => {
    // Arrange
    const db = new FakeStatsDb([[listing(1, REAL_DISCOUNT)]]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.details).toMatchObject({
      label: "desconto_real",
      labelName: "Desconto real",
      text: "10% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual dos últimos 90 dias.",
      tone: "positive",
      announcedDiscount: true,
      warnings: [],
      numbers: {
        priceCents: 45_000,
        referencePriceCents: 50_000,
        m30Cents: 50_000,
        med90Cents: 50_000,
        realDiscountPct: 10,
      },
    });
  });

  it("counts the history in Lisbon calendar days, whatever the hour the job runs", async () => {
    // Arrange
    const firstPrice = new Date("2026-10-28T11:00:00.000Z");
    const history: PriceHistory = {
      listingId: 1,
      productId: null,
      storeSlug: "darty",
      storeName: getStore("darty").name,
      firstSeenAt: firstPrice,
      lastSeenAt: new Date("2026-11-27T05:10:00.000Z"),
      missedRuns: 0,
      intervals: [
        {
          priceCents: 50_000,
          referencePriceCents: null,
          inStock: true,
          validFrom: firstPrice,
          validTo: null,
        },
      ],
    };
    const db = new FakeStatsDb([[history]]);
    const afterALongRun = new Date("2026-11-27T08:30:00.000Z");

    // Act
    const summary = await runStats(db, afterALongRun);

    // Assert
    expect(summary.labels).toEqual({ preco_habitual: 1 });
    expect(savedRow(db, 1)?.details).toMatchObject({
      label: "preco_habitual",
      numbers: { trackedSince: firstPrice.toISOString(), historyDays: 30 },
    });
  });

  it("warns when another store sells the same product at least 3% cheaper", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7 }),
        steadyListing(2, 45_000, { store: "radiopopular", productId: 7 }),
      ],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.warnings).toEqual(["mais_barato_noutra_loja"]);
    expect(savedRow(db, 1)?.details).toMatchObject({
      warnings: [
        { code: "mais_barato_noutra_loja", text: `Radio Popular tem este produto a ${formatCents(45_000)}.` },
      ],
    });
    expect(savedRow(db, 2)?.warnings).toEqual([]);
  });

  it("compares only current in-stock prices of the same product in other stores", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7 }),
        steadyListing(2, 30_000, { store: "darty", productId: 7 }),
        listing(3, [{ price: 20_000, days: 40, inStock: false }], { store: "radiopopular", productId: 7 }),
        steadyListing(4, 10_000, { store: "fnac", productId: 8 }),
        steadyListing(5, 25_000, { store: "radiopopular", productId: 7, closedDaysAgo: 2 }),
        steadyListing(6, 48_400, { store: "worten", productId: 7 }),
        steadyListing(7, 48_000, { store: "fnac", productId: 7 }),
      ],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.details).toMatchObject({
      warnings: [
        { code: "mais_barato_noutra_loja", text: `Fnac tem este produto a ${formatCents(48_000)}.` },
      ],
    });
  });

  it("quotes an offer last seen yesterday in Lisbon, as when that store's run failed today", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7 }),
        steadyListing(2, 45_000, {
          store: "radiopopular",
          productId: 7,
          lastSeenAt: new Date("2026-11-26T00:30:00.000Z"),
        }),
      ],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.warnings).toEqual(["mais_barato_noutra_loja"]);
  });

  it("never quotes an offer last seen two Lisbon calendar days ago, even within 48 hours", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7 }),
        steadyListing(2, 45_000, {
          store: "radiopopular",
          productId: 7,
          lastSeenAt: new Date("2026-11-25T23:30:00.000Z"),
        }),
      ],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.warnings).toEqual([]);
  });

  it("counts those calendar days in Lisbon time, not in UTC", async () => {
    // Arrange
    const summerMorning = new Date("2027-04-15T06:00:00.000Z");
    // 00:30 on 14 April in Lisbon (summer time, UTC+1), so yesterday; still 13 April in UTC.
    const afterLisbonMidnight = new Date("2027-04-13T23:30:00.000Z");
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7, now: summerMorning }),
        steadyListing(2, 45_000, {
          store: "radiopopular",
          productId: 7,
          now: summerMorning,
          lastSeenAt: afterLisbonMidnight,
        }),
      ],
    ]);

    // Act
    await runStats(db, summerMorning);

    // Assert
    expect(savedRow(db, 1)?.warnings).toEqual(["mais_barato_noutra_loja"]);
  });

  it("never quotes an offer the last complete run of its store missed", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7 }),
        steadyListing(2, 45_000, {
          store: "radiopopular",
          productId: 7,
          lastSeenAt: daysAgo(1),
          missedRuns: 1,
        }),
      ],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.warnings).toEqual([]);
  });

  it("quotes the cheapest offer still on sale, not a cheaper one that is out of date", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [
        steadyListing(1, 50_000, { store: "darty", productId: 7 }),
        steadyListing(2, 40_000, {
          store: "radiopopular",
          productId: 7,
          lastSeenAt: daysAgo(3),
          missedRuns: 3,
        }),
        steadyListing(3, 48_000, { store: "fnac", productId: 7 }),
      ],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.details).toMatchObject({
      warnings: [
        { code: "mais_barato_noutra_loja", text: `Fnac tem este produto a ${formatCents(48_000)}.` },
      ],
    });
  });

  it("never compares listings that have no product", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [steadyListing(1, 50_000, { store: "darty" }), steadyListing(2, 10_000, { store: "radiopopular" })],
    ]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(savedRow(db, 1)?.warnings).toEqual([]);
  });

  it("leaves out listings without a current price", async () => {
    // Arrange
    const db = new FakeStatsDb([[listing(1, NEW_LISTING), listing(2, NEW_LISTING, { closedDaysAgo: 2 })]]);

    // Act
    const summary = await runStats(db, NOW);

    // Assert
    expect(db.savedRows.map((row) => row.listingId)).toEqual([1]);
    expect(summary).toEqual({ labels: { historico_insuficiente: 1 }, classified: 1, withoutCurrentPrice: 1 });
  });

  it("classifies the listings of every batch and counts them per label", async () => {
    // Arrange
    const db = new FakeStatsDb([
      [listing(1, NEW_LISTING), listing(2, REAL_DISCOUNT)],
      [listing(3, NEW_LISTING)],
    ]);

    // Act
    const summary = await runStats(db, NOW);

    // Assert
    expect(db.savedRows.map((row) => row.listingId)).toEqual([1, 2, 3]);
    expect(summary).toEqual({
      labels: { historico_insuficiente: 2, desconto_real: 1 },
      classified: 3,
      withoutCurrentPrice: 0,
    });
  });

  it("replaces listing_stats in a single call, with the rows of every batch computed now", async () => {
    // Arrange
    const histories = Array.from({ length: 1_001 }, (_, index) => listing(index + 1, NEW_LISTING));
    const db = new FakeStatsDb([histories.slice(0, 500), histories.slice(500)]);

    // Act
    await runStats(db, NOW);

    // Assert
    expect(db.replacements).toHaveLength(1);
    expect(db.replacements[0]?.computedAt).toBe(NOW);
    expect(db.replacements[0]?.rows.map((row) => row.listingId)).toEqual(
      histories.map((history) => history.listingId),
    );
  });

  it("empties listing_stats when there are no listings", async () => {
    // Arrange
    const db = new FakeStatsDb([]);

    // Act
    const summary = await runStats(db, NOW);

    // Assert
    expect(db.replacements).toEqual([{ rows: [], computedAt: NOW }]);
    expect(summary).toEqual({ labels: {}, classified: 0, withoutCurrentPrice: 0 });
  });
});

describe("formatStatsSummary", () => {
  it("lists every label in the methodology's order, in pt-PT", () => {
    // Arrange
    const summary: StatsSummary = {
      labels: { historico_insuficiente: 2, desconto_real: 1 },
      classified: 3,
      withoutCurrentPrice: 1,
    };

    // Act
    const text = formatStatsSummary(summary);

    // Assert
    expect(text).toBe(
      [
        "Artigos classificados: 3",
        "Sem preço atual (não classificados): 1",
        "Por rótulo:",
        "  Histórico insuficiente: 2",
        "  Mínimo histórico: 0",
        "  Desconto real: 1",
        "  Subiu antes de descer: 0",
        "  Desconto pequeno: 0",
        "  Sem desconto real: 0",
        "  Bom preço: 0",
        "  Acima do habitual: 0",
        "  Preço habitual: 0",
      ].join("\n"),
    );
  });
});
