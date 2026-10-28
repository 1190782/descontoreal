import type { Db, ListingDetailsInput, MatchOutcome } from "@descontoreal/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FetchError, StoreBlockedError, StoreUnavailableError } from "../../src/http/errors";
import { type PageFetcher, StoreFetcher } from "../../src/http/fetcher";
import type { Logger } from "../../src/http/logger";
import { notifyAdmin } from "../../src/notify";
import type { RunReport } from "../../src/runner/report";
import { runStore, type RunStoreOptions, UnknownCategoryError } from "../../src/runner/run-store";
import type { StoreCategory, StoreScraper } from "../../src/types";
import { FAKE_RUN_ID, FakeDb } from "../fakes/fake-db";
import { FakeFetcher } from "../fakes/fake-fetcher";
import {
  createFakeStore,
  FAKE_STORE_NAME,
  FAKE_STORE_URL,
  fakeCategory,
  listingBody,
  listingItem,
  productBody,
  productDetails,
  productUrl,
  VALID_EAN,
} from "../fakes/fake-store";
import {
  fakeTransport,
  jsonResponse,
  redirectResponse,
  type Reply,
  textResponse,
} from "../fakes/fake-transport";

vi.mock("../../src/notify", () => ({ notifyAdmin: vi.fn(() => Promise.resolve()) }));

const NOW = new Date("2026-10-28T03:00:00Z");
const ROBOTS = `${FAKE_STORE_URL}/robots.txt`;
const OTHER_EAN = "4006381333931";
const WITH_EAN = { ean: VALID_EAN };
const silentLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const notifyAdminMock = vi.mocked(notifyAdmin);

beforeEach(() => {
  notifyAdminMock.mockClear();
});

function run(
  scraper: StoreScraper,
  fetcher: PageFetcher,
  db: Db | null,
  options: Partial<RunStoreOptions> = {},
): Promise<RunReport> {
  return runStore({ scraper, fetcher, db, now: () => NOW, log: silentLog, ...options });
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 86_400_000);
}

function ingestedSkus(db: FakeDb): string[][] {
  return db.ingests.map((ingest) => ingest.items.map((item) => item.storeSku));
}

function skuOfListing(db: FakeDb, listingId: number): string | undefined {
  return [...db.states.values()].find((state) => state.listingId === listingId)?.storeSku;
}

function savedFor(db: FakeDb): { sku: string | undefined; checkedAt: Date | null }[] {
  return db.savedDetails.map((saved) => ({
    sku: skuOfListing(db, saved.input.listingId),
    checkedAt: saved.productPageCheckedAt,
  }));
}

async function settle(promise: Promise<unknown>): Promise<unknown> {
  try {
    return await promise;
  } catch (error) {
    return error;
  }
}

function productPageStore(categories: readonly StoreCategory[]): StoreScraper {
  return createFakeStore(categories, { pricesFromProductPage: true });
}

/** Every request takes a minute of the run's clock. */
function minutePerRequest(fetcher: FakeFetcher, clock: { ms: number }): PageFetcher {
  return {
    get pagesFetched(): number {
      return fetcher.pagesFetched;
    },
    fetchPage: (url) => {
      clock.ms += 60_000;
      return fetcher.fetchPage(url);
    },
    robotsAllows: (url) => fetcher.robotsAllows(url),
  };
}

/** A StoreFetcher over fake routes, with no pauses and no waits between retries. */
function storeFetcher(
  store: StoreScraper,
  routes: Record<string, Reply>,
): {
  fetcher: StoreFetcher;
  requested: () => string[];
} {
  const { transport, calls } = fakeTransport(routes);
  const fetcher = new StoreFetcher(store, {
    transport,
    minDelayMs: 0,
    maxDelayMs: 0,
    sleep: () => Promise.resolve(),
    log: silentLog,
  });
  return { fetcher, requested: () => calls.map((call) => call.url) };
}

describe("runStore listing pages", () => {
  it("follows nextPageUrl to the last page and ingests one batch per listing page", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const page2 = `${tv.url}?page=2`;
    const page3 = `${tv.url}?page=3`;
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", WITH_EAN)], page2),
      [page2]: listingBody([listingItem("C", WITH_EAN), listingItem("D", WITH_EAN)], page3),
      [page3]: listingBody([listingItem("E", WITH_EAN)]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, page2, page3]);
    expect(ingestedSkus(db)).toEqual([["A", "B"], ["C", "D"], ["E"]]);
    expect(report).toMatchObject({ status: "success", listingsSeen: 5, new: 5, pagesFetched: 3 });
  });

  it("stops after --limit unique items, as a partial run", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const page2 = `${tv.url}?page=2`;
    const page3 = `${tv.url}?page=3`;
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", WITH_EAN)], page2),
      [page2]: listingBody([listingItem("C", WITH_EAN), listingItem("D", WITH_EAN)], page3),
      [page3]: listingBody([listingItem("E", WITH_EAN)]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db, { limit: 3 });

    // Assert
    expect(fetcher.requested).toEqual([tv.url, page2]);
    expect(ingestedSkus(db)).toEqual([["A", "B"], ["C"]]);
    expect(report).toMatchObject({ status: "success", partial: true, listingsSeen: 3 });
    expect(db.startedRuns).toEqual([{ storeSlug: "darty", partial: true }]);
    expect(db.calls).not.toContain("markMissingListings");
  });

  it("keeps the first category of an item seen in two categories", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", WITH_EAN)]),
      [monitors.url]: listingBody([listingItem("B", WITH_EAN), listingItem("C", WITH_EAN)]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, db);

    // Assert
    expect(report.listingsSeen).toBe(3);
    expect(ingestedSkus(db)).toEqual([["A", "B"], ["C"]]);
    expect(report.sampleItems.map((sample) => [sample.storeSku, sample.categoryKey])).toEqual([
      ["A", "tv"],
      ["B", "tv"],
      ["C", "monitores"],
    ]);
    expect(db.savedDetails.map((saved) => saved.input.categorySlug)).toEqual([
      "televisores",
      "televisores",
      "monitores",
    ]);
  });

  it("stops a category at a pagination loop and records it", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const page2 = `${tv.url}?page=2`;
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN)], page2),
      [page2]: listingBody([listingItem("B", WITH_EAN)], tv.url),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, page2]);
    expect(report.errors.map((error) => error.message)).toEqual(["Pagination loop in category tv"]);
    expect(db.calls).not.toContain("markMissingListings");
  });

  it("skips items whose price is not integer cents, without counting them as seen", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("A", WITH_EAN),
        listingItem("B", { ...WITH_EAN, priceCents: 499.99 }),
        listingItem("", WITH_EAN),
      ]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report.listingsSeen).toBe(1);
    expect(ingestedSkus(db)).toEqual([["A"]]);
    expect(report.errorCount).toBe(2);
  });

  it("records a listing page that cannot be parsed and does not mark listings missing", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN)]),
      [monitors.url]: "<html>layout novo</html>",
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, db);

    // Assert
    expect(report.status).toBe("success");
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toMatch(/^Listing page not parsed/);
    expect(db.calls).not.toContain("markMissingListings");
  });

  it("records a category whose pages keep no items", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const monitorsPage2 = `${monitors.url}?page=2`;
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN)]),
      [monitors.url]: listingBody([], monitorsPage2),
      [monitorsPage2]: listingBody([]),
    });

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, new FakeDb());

    // Assert
    expect(fetcher.requested).toEqual([tv.url, monitors.url, monitorsPage2]);
    expect(report.errors).toEqual([{ url: monitors.url, message: "No items in category monitores" }]);
  });

  it("goes on to the next page after a page that keeps no items", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const page2 = `${tv.url}?page=2`;
    const page3 = `${tv.url}?page=3`;
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([], page2),
      [page2]: listingBody([listingItem("A", WITH_EAN)], page3),
      [page3]: listingBody([]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, page2, page3]);
    expect(ingestedSkus(db)).toEqual([["A"]]);
    expect(report.errors).toEqual([]);
    expect(db.calls).toContain("markMissingListings");
  });

  it("passes the listing's PVPr through, as information next to the price", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("R", { ...WITH_EAN, rrpCents: 59_999 }),
        listingItem("S", WITH_EAN),
      ]),
    });
    const db = new FakeDb();

    // Act
    await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(db.ingests[0]?.items.map((item) => [item.storeSku, item.priceCents, item.rrpCents])).toEqual([
      ["R", 49_999, 59_999],
      ["S", 49_999, null],
    ]);
  });

  it("skips an item whose PVPr is not integer cents", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("A", WITH_EAN),
        listingItem("B", { ...WITH_EAN, rrpCents: 599.99 }),
      ]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(ingestedSkus(db)).toEqual([["A"]]);
    expect(report.errors.map((error) => error.message)).toEqual([
      "Listing item skipped: recommended price 599.99 is not a positive integer of cents",
    ]);
  });
});

describe("runStore sellers", () => {
  it("drops items sold by other sellers", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("A", WITH_EAN),
        listingItem("M", { ...WITH_EAN, sellerName: "Vendedor X" }),
      ]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report).toMatchObject({ listingsSeen: 2, droppedMarketplace: 1, new: 1 });
    expect(ingestedSkus(db)).toEqual([["A"]]);
  });

  it("reads the product page of a new listing whose seller the listing does not show", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const unknownSeller = { sellerName: null };
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("U1", unknownSeller),
        listingItem("U2", unknownSeller),
        listingItem("U3", unknownSeller),
      ]),
      [productUrl("U1")]: productBody(productDetails("U1")),
      [productUrl("U2")]: productBody(productDetails("U2", { sellerName: "Outro Vendedor" })),
      [productUrl("U3")]: productBody(productDetails("U3", { sellerName: null })),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("U1"), productUrl("U2"), productUrl("U3")]);
    expect(db.ingests[0]?.items.map((item) => [item.storeSku, item.soldByStore])).toEqual([
      ["U1", true],
      ["U2", false],
      ["U3", false],
    ]);
    expect(report).toMatchObject({ droppedMarketplace: 2, new: 1, productPagesFetched: 3 });
    expect(savedFor(db)).toEqual([{ sku: "U1", checkedAt: NOW }]);
  });

  it("uses the stored seller of a known listing and re-ingests known marketplace listings", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("K1", { productPageCheckedAt: daysAgo(1) });
    db.addListing("K2", { soldByStore: false, priceCents: null, productPageCheckedAt: daysAgo(1) });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("K1", { sellerName: null }),
        listingItem("K2", { sellerName: null }),
      ]),
    });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url]);
    expect(db.ingests[0]?.items.map((item) => [item.storeSku, item.soldByStore])).toEqual([
      ["K1", true],
      ["K2", false],
    ]);
    expect(report).toMatchObject({ droppedMarketplace: 1, unchanged: 1 });
  });

  it("skips a new listing with an unknown seller when its product page fails", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("U", { sellerName: null })]),
      [productUrl("U")]: "não é JSON",
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(ingestedSkus(db)).toEqual([["A"]]);
    expect(report.errors.map((error) => error.message.split(":")[0])).toEqual(["Product page not parsed"]);
  });
});

describe("runStore price jumps", () => {
  it("stores a suspicious jump the product page confirms", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("J", { priceCents: 100_000, productPageCheckedAt: daysAgo(1) });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("J", { priceCents: 20_000 })]),
      [productUrl("J")]: productBody(productDetails("J", { priceCents: 20_000 })),
    });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(db.ingests[0]?.items.map((item) => item.priceCents)).toEqual([20_000]);
    expect(report).toMatchObject({ changed: 1, skippedJumps: 0, revisited: 0 });
    expect(savedFor(db)).toEqual([{ sku: "J", checkedAt: NOW }]);
  });

  it("skips the item today when the product page does not confirm the jump", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("J", { priceCents: 100_000, productPageCheckedAt: daysAgo(1) });
    db.addListing("K", { productPageCheckedAt: daysAgo(1) });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("J", { priceCents: 20_000 }), listingItem("K")]),
      [productUrl("J")]: productBody(productDetails("J", { priceCents: 100_000 })),
    });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(ingestedSkus(db)).toEqual([["K"]]);
    expect(report.skippedJumps).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]?.message).toMatch(/^Price jump .* not confirmed: product page shows /);
    expect(report.errors[0]?.url).toBe(productUrl("J"));
  });
});

describe("runStore product facts", () => {
  it("saves facts from the listing without a request, and from the product page otherwise", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("L1", { ean: VALID_EAN, brand: "LG", model: "OLED55C46LA.AEU" }),
        listingItem("L2"),
      ]),
      [productUrl("L2")]: productBody(productDetails("L2", { ean: OTHER_EAN })),
    });
    const db = new FakeDb();

    // Act
    await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("L2")]);
    expect(savedFor(db)).toEqual([
      { sku: "L1", checkedAt: null },
      { sku: "L2", checkedAt: NOW },
    ]);
    expect(
      db.savedDetails.map((saved) => [saved.input.ean, saved.input.modelNorm, saved.input.specs]),
    ).toEqual([
      [VALID_EAN, "OLED55C46LA", {}],
      [OTHER_EAN, "QE55Q67CA", { Ecrã: "55 polegadas" }],
    ]);
  });

  it("caps product pages at maxProductPages and still stores every price", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("N1"), listingItem("N2"), listingItem("N3")]),
      [productUrl("N1")]: productBody(productDetails("N1")),
      [productUrl("N2")]: productBody(productDetails("N2")),
      [productUrl("N3")]: productBody(productDetails("N3")),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db, { maxProductPages: 1 });

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("N1")]);
    expect(ingestedSkus(db)).toEqual([["N1", "N2", "N3"]]);
    expect(report).toMatchObject({ productPagesFetched: 1, budgetExhausted: 2 });
    expect(savedFor(db)).toEqual([{ sku: "N1", checkedAt: NOW }]);
  });

  it("records facts that the database refuses and goes on", async () => {
    // Arrange
    class RefusingDb extends FakeDb {
      override saveListingDetails(
        _input: ListingDetailsInput,
        _checkedAt: Date | null,
      ): Promise<MatchOutcome> {
        return Promise.reject(new Error("duplicate key"));
      }
    }
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", WITH_EAN)]),
    });
    const db = new RefusingDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report.status).toBe("success");
    expect(report.errorCount).toBe(2);
    expect(report.errors[0]?.message).toMatch(/not saved: duplicate key$/);
  });
});

describe("runStore weekly revisit", () => {
  it("reads about a seventh of the product pages, never-checked and oldest first", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    const skus = Array.from({ length: 14 }, (_, index) => `S${String(index + 1).padStart(2, "0")}`);
    for (const sku of skus) {
      db.addListing(sku, { productPageCheckedAt: daysAgo(2) });
    }
    db.addListing("S01", { productPageCheckedAt: daysAgo(8) });
    db.addListing("S02", { productPageCheckedAt: null });
    db.addListing("S03", { productPageCheckedAt: daysAgo(30) });
    const fetcher = new FakeFetcher({ [tv.url]: listingBody(skus.map((sku) => listingItem(sku))) });
    for (const sku of skus) {
      fetcher.set(productUrl(sku), productBody(productDetails(sku)));
    }

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("S02"), productUrl("S03")]);
    expect(report).toMatchObject({ unchanged: 14, revisited: 2 });
    expect(savedFor(db)).toEqual([
      { sku: "S02", checkedAt: NOW },
      { sku: "S03", checkedAt: NOW },
    ]);
  });

  it("counts Lisbon calendar days, so a check 7 days ago at a later hour is due", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    const skus = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];
    for (const sku of skus) {
      db.addListing(sku, { productPageCheckedAt: daysAgo(1) });
    }
    db.addListing("R7", { productPageCheckedAt: new Date("2026-10-21T04:00:00Z") });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody(skus.map((sku) => listingItem(sku))),
      [productUrl("R7")]: productBody(productDetails("R7")),
    });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("R7")]);
    expect(report.revisited).toBe(1);
  });

  // Lisbon was on summer time (UTC+1) until 25 October 2026; the run is on 28 October at 03:00 (UTC+0).
  it.each([
    ["2026-10-21T22:30:00Z", "23:30 on 21 October in Lisbon, 7 calendar days ago", 1],
    ["2026-10-21T23:30:00Z", "00:30 on 22 October in Lisbon, 6 calendar days ago", 0],
  ])(
    "counts the revisit across the clock change: a check at %s (%s) gives %i revisit",
    async (checkedAt, _when, revisited) => {
      // Arrange
      const tv = fakeCategory("tv");
      const db = new FakeDb();
      const skus = ["R1", "R2", "R3", "R4", "R5", "R6", "R7"];
      for (const sku of skus) {
        db.addListing(sku, { productPageCheckedAt: daysAgo(1) });
      }
      db.addListing("R7", { productPageCheckedAt: new Date(checkedAt) });
      const fetcher = new FakeFetcher({
        [tv.url]: listingBody(skus.map((sku) => listingItem(sku))),
        [productUrl("R7")]: productBody(productDetails("R7")),
      });

      // Act
      const report = await run(createFakeStore([tv]), fetcher, db);

      // Assert
      expect(report.revisited).toBe(revisited);
    },
  );
});

describe("runStore prices from product pages", () => {
  it("stores the product page's price, reference price, PVPr and stock, never the listing's", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("P1", { priceCents: 99_999, referencePriceCents: 129_999, rrpCents: 99_999 }),
      ]),
      [productUrl("P1")]: productBody(
        productDetails("P1", {
          priceCents: 84_999,
          referencePriceCents: 89_999,
          rrpCents: 99_999,
          inStock: false,
        }),
      ),
    });
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(db.ingests[0]?.items).toEqual([
      {
        storeSku: "P1",
        url: productUrl("P1"),
        rawTitle: "Televisor P1",
        soldByStore: true,
        priceCents: 84_999,
        referencePriceCents: 89_999,
        rrpCents: 99_999,
        inStock: false,
      },
    ]);
    expect(report).toMatchObject({
      status: "success",
      new: 1,
      pricePagesFetched: 1,
      productPagesFetched: 0,
      skippedPrices: 0,
    });
  });

  it("skips today, with an error, an item whose product page fails, shows no price or another SKU", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const failing = ["GONE", "BROKEN", "NOPRICE", "OTHER"];
    const priced = Array.from({ length: 10 }, (_, index) => `OK${index}`);
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([...failing, ...priced].map((sku) => listingItem(sku, { priceCents: 99_999 }))),
      [productUrl("BROKEN")]: "<html>layout novo</html>",
      [productUrl("NOPRICE")]: productBody(productDetails("NOPRICE", { priceCents: null })),
      [productUrl("OTHER")]: productBody(productDetails("T00000001")),
    });
    for (const sku of priced) {
      fetcher.set(productUrl(sku), productBody(productDetails(sku, { priceCents: 79_999 })));
    }
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(ingestedSkus(db)).toEqual([priced]);
    expect(db.ingests[0]?.items.map((item) => item.priceCents)).toEqual(priced.map(() => 79_999));
    expect(report).toMatchObject({
      status: "success",
      listingsSeen: 14,
      pricePagesFetched: 14,
      skippedPrices: 4,
    });
    expect(report.errors).toEqual([
      { url: productUrl("GONE"), message: "HTTP 404" },
      { url: productUrl("BROKEN"), message: expect.stringMatching(/^Product page not parsed: /) as string },
      {
        url: productUrl("NOPRICE"),
        message: "Price not read, item skipped today: the product page shows no price",
      },
      {
        url: productUrl("OTHER"),
        message: 'Price not read, item skipped today: the product page shows SKU "T00000001"',
      },
    ]);
  });

  it("fails the run and emails the admin when most product pages give no price", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("OK"), listingItem("X1"), listingItem("X2")]),
      [productUrl("OK")]: productBody(productDetails("OK")),
      [productUrl("X1")]: "<html>layout novo</html>",
      [productUrl("X2")]: "<html>layout novo</html>",
    });
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(report.status).toBe("failed");
    expect(report.errors.at(-1)?.message).toBe("Broken run: 2 of 3 product pages gave no price");
    expect(ingestedSkus(db)).toEqual([["OK"]]);
    expect(db.calls).not.toContain("markMissingListings");
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
  });

  it("reads every price page whatever maxProductPages says, and never twice for a price jump", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("J", { priceCents: 100_000, productPageCheckedAt: daysAgo(1) });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("J", { priceCents: 100_000 }), listingItem("N")]),
      [productUrl("J")]: productBody(productDetails("J", { priceCents: 20_000 })),
      [productUrl("N")]: productBody(productDetails("N")),
    });

    // Act
    const report = await run(productPageStore([tv]), fetcher, db, { maxProductPages: 0 });

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("J"), productUrl("N")]);
    expect(db.ingests[0]?.items.map((item) => [item.storeSku, item.priceCents])).toEqual([
      ["J", 20_000],
      ["N", 49_999],
    ]);
    expect(report).toMatchObject({
      changed: 1,
      new: 1,
      skippedJumps: 0,
      pricePagesFetched: 2,
      productPagesFetched: 0,
      budgetExhausted: 0,
    });
  });

  it("saves the same page's facts for new listings and checks a week old, without a second request", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("FRESH", { productPageCheckedAt: daysAgo(6) });
    db.addListing("WEEK", { productPageCheckedAt: daysAgo(7) });
    db.addListing("NEVER", { productPageCheckedAt: null });
    const skus = ["NEW", "FRESH", "WEEK", "NEVER"];
    const fetcher = new FakeFetcher({ [tv.url]: listingBody(skus.map((sku) => listingItem(sku, WITH_EAN))) });
    for (const sku of skus) {
      fetcher.set(productUrl(sku), productBody(productDetails(sku, { ean: OTHER_EAN })));
    }

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, ...skus.map((sku) => productUrl(sku))]);
    expect(savedFor(db)).toEqual([
      { sku: "NEW", checkedAt: NOW },
      { sku: "WEEK", checkedAt: NOW },
      { sku: "NEVER", checkedAt: NOW },
    ]);
    expect(db.savedDetails.map((saved) => saved.input.ean)).toEqual([OTHER_EAN, OTHER_EAN, OTHER_EAN]);
    expect(report.revisited).toBe(0);
  });

  it("decides an unknown seller from the same page", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const unknownSeller = { sellerName: null };
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("U1", unknownSeller), listingItem("U2", unknownSeller)]),
      [productUrl("U1")]: productBody(productDetails("U1")),
      [productUrl("U2")]: productBody(productDetails("U2", { sellerName: "Outro Vendedor" })),
    });
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url, productUrl("U1"), productUrl("U2")]);
    expect(db.ingests[0]?.items.map((item) => [item.storeSku, item.soldByStore])).toEqual([
      ["U1", true],
      ["U2", false],
    ]);
    expect(report).toMatchObject({ droppedMarketplace: 1, new: 1 });
  });

  it("shows the product page's prices in the dry run and leaves skipped items out of the sample", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody(["A", "GONE", "B", "C"].map((sku) => listingItem(sku, { priceCents: 99_999 }))),
      [productUrl("A")]: productBody(productDetails("A", { priceCents: 84_999, rrpCents: 99_999 })),
      [productUrl("B")]: productBody(productDetails("B", { priceCents: 79_999, inStock: false })),
      [productUrl("C")]: productBody(productDetails("C", { priceCents: 74_999, ean: OTHER_EAN })),
    });

    // Act
    const report = await run(productPageStore([tv]), fetcher, null);

    // Assert
    expect(report.status).toBe("success");
    expect(
      report.sampleItems.map((sample) => [
        sample.storeSku,
        sample.priceCents,
        sample.rrpCents,
        sample.inStock,
        sample.ean,
      ]),
    ).toEqual([
      ["A", 84_999, 99_999, true, VALID_EAN],
      ["B", 79_999, null, false, VALID_EAN],
      ["C", 74_999, null, true, OTHER_EAN],
    ]);
  });
});

describe("runStore time limit", () => {
  it("stops requesting at maxMinutes, stores what was read and ends as a partial run with an email", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const page2 = `${tv.url}?page=2`;
    const skus = ["P1", "P2", "P3"];
    const pages = new FakeFetcher({
      [tv.url]: listingBody(
        skus.map((sku) => listingItem(sku)),
        page2,
      ),
      [page2]: listingBody([listingItem("P4")]),
    });
    for (const sku of skus) {
      pages.set(productUrl(sku), productBody(productDetails(sku)));
    }
    const clock = { ms: NOW.getTime() };
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), minutePerRequest(pages, clock), db, {
      maxMinutes: 3,
      now: () => new Date(clock.ms),
    });

    // Assert
    expect(pages.requested).toEqual([tv.url, productUrl("P1"), productUrl("P2")]);
    expect(ingestedSkus(db)).toEqual([["P1", "P2"]]);
    expect(savedFor(db).map((saved) => saved.sku)).toEqual(["P1", "P2"]);
    expect(report).toMatchObject({ status: "success", partial: true, timeLimitMinutes: 3, listingsSeen: 2 });
    expect(db.startedRuns).toEqual([{ storeSlug: "darty", partial: false }]);
    expect(db.finishedRuns[0]?.summary).toMatchObject({ status: "success", partial: true });
    expect(db.calls).not.toContain("recentListingCounts:7");
    expect(db.calls).not.toContain("markMissingListings");
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    expect(notifyAdminMock.mock.calls[0]?.[0]).toBe(
      `DescontoReal: recolha interrompida (${FAKE_STORE_NAME})`,
    );
  });

  it("ends a run that finishes within maxMinutes as a complete run, without an email", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const pages = new FakeFetcher({
      [tv.url]: listingBody([listingItem("P1")]),
      [productUrl("P1")]: productBody(productDetails("P1")),
    });
    const clock = { ms: NOW.getTime() };
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), minutePerRequest(pages, clock), db, {
      maxMinutes: 3,
      now: () => new Date(clock.ms),
    });

    // Assert
    expect(report).toMatchObject({ status: "success", partial: false, timeLimitMinutes: null });
    expect(db.finishedRuns[0]?.summary.partial).toBeUndefined();
    expect(db.calls).toContain("markMissingListings");
    expect(notifyAdminMock).not.toHaveBeenCalled();
  });
});

describe("runStore end of run", () => {
  it("marks missing listings after a complete run, from the run's own start time", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });
    const db = new FakeDb();
    let ticks = 0;
    const clock = (): Date => {
      ticks += 1;
      return new Date(NOW.getTime() + ticks * 1000);
    };

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db, { now: clock });

    // Assert
    expect(report.status).toBe("success");
    expect(db.calls).toContain("recentListingCounts:7");
    expect(db.missingMarks).toEqual([
      { seenSince: new Date(NOW.getTime() + 1000), maxMissedRuns: undefined },
    ]);
    expect(db.ingests[0]?.observedAt.getTime()).toBeGreaterThan(NOW.getTime() + 1000);
    expect(db.finishedRuns).toEqual([
      { runId: FAKE_RUN_ID, summary: { status: "success", pagesFetched: 1, listingsSeen: 1, errors: [] } },
    ]);
  });

  it("passes the store's maxMissedRuns to markMissingListings", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });
    const db = new FakeDb();

    // Act
    await run(createFakeStore([tv], { maxMissedRuns: 5 }), fetcher, db);

    // Assert
    expect(db.missingMarks).toEqual([{ seenSince: NOW, maxMissedRuns: 5 }]);
  });

  it("never marks missing listings in a partial --category run", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN)]),
      [monitors.url]: listingBody([listingItem("B", WITH_EAN)]),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, db, { categoryKey: "monitores" });

    // Assert
    expect(fetcher.requested).toEqual([monitors.url]);
    expect(report.partial).toBe(true);
    expect(db.startedRuns).toEqual([{ storeSlug: "darty", partial: true }]);
    expect(db.calls).not.toContain("markMissingListings");
    expect(db.calls).not.toContain("recentListingCounts:7");
  });

  it("rejects an unknown --category before starting the run", async () => {
    // Arrange
    const db = new FakeDb();
    const fetcher = new FakeFetcher();

    // Act
    const result = await settle(
      run(createFakeStore([fakeCategory("tv")]), fetcher, db, { categoryKey: "tablets" }),
    );

    // Assert
    expect(result).toBeInstanceOf(UnknownCategoryError);
    expect((result as UnknownCategoryError).available).toEqual(["tv"]);
    expect(db.calls).toEqual([]);
    expect(fetcher.requested).toEqual([]);
  });

  it("fails a run with far fewer listings than usual, emails the admin and keeps listings active", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", WITH_EAN)]),
    });
    const db = new FakeDb();
    db.recentCounts = [100, 110, 90];

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report.status).toBe("failed");
    expect(report.errors.map((error) => error.message)).toEqual([
      "Broken run: 2 listings seen, recent average 100",
    ]);
    // Complete, so it joins the average: the baseline follows a lasting change of catalogue size.
    expect(db.finishedRuns[0]?.summary).toMatchObject({ status: "failed", listingsSeen: 2 });
    expect(db.finishedRuns[0]?.summary.partial).toBeUndefined();
    expect(db.calls).not.toContain("markMissingListings");
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    const [subject, text] = notifyAdminMock.mock.calls[0] ?? [];
    expect(subject).toBe(`DescontoReal: recolha falhada (${FAKE_STORE_NAME})`);
    expect(text).toContain("Artigos vistos: 2");
  });

  it("fails a run that sees no listings and keeps the first 50 errors plus that one", async () => {
    // Arrange
    const categories = Array.from({ length: 60 }, (_, index) => fakeCategory(`c${index}`));
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore(categories), new FakeFetcher(), db);

    // Assert
    expect(report.status).toBe("failed");
    expect(report.errorCount).toBe(61);
    expect(report.errors).toHaveLength(50);
    expect(report.errors[49]?.message).toMatch(/^No listings seen/);
    expect(db.finishedRuns[0]?.summary.errors).toHaveLength(50);
  });

  it("records a failed, partial run, emails the admin and rethrows when the database fails", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });
    const db = new FakeDb();
    db.ingestError = new Error("ligação perdida");

    // Act
    const result = await settle(run(createFakeStore([tv]), fetcher, db));

    // Assert
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe("ligação perdida");
    expect(db.finishedRuns[0]?.summary).toMatchObject({ status: "failed", partial: true });
    expect(db.finishedRuns[0]?.summary.errors.map((error) => error.message)).toEqual([
      "Run failed: ligação perdida",
    ]);
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "the store blocks us",
      "blocked",
      new StoreBlockedError("darty blocks our bot: HTTP 403, 3 times in a row", productUrl("B")),
    ],
    [
      "the store keeps failing",
      "failed",
      new StoreUnavailableError(
        "darty keeps failing: HTTP 503 (3 attempts), 5 URLs in a row",
        productUrl("B"),
      ),
    ],
  ])(
    "records a run stopped because %s as partial, so its count never joins the average",
    async (_case, status, stop) => {
      // Arrange
      const tv = fakeCategory("tv");
      const fetcher = new FakeFetcher({
        [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", { sellerName: null })]),
        [productUrl("B")]: stop,
      });
      const db = new FakeDb();

      // Act
      const report = await run(createFakeStore([tv]), fetcher, db);

      // Assert
      expect(report).toMatchObject({ status, partial: true, listingsSeen: 2 });
      expect(db.startedRuns).toEqual([{ storeSlug: "darty", partial: false }]);
      expect(db.finishedRuns[0]?.summary).toMatchObject({ status, partial: true, listingsSeen: 2 });
      expect(db.calls).not.toContain("recentListingCounts:7");
    },
  );

  it("asks the site to revalidate the products whose price changed", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("R1", { priceCents: 50_000, productPageCheckedAt: daysAgo(1) });
    db.addListing("R2", { priceCents: 60_000, productPageCheckedAt: daysAgo(1) });
    db.addListing("R3", { productPageCheckedAt: daysAgo(1) });
    db.productSlugs.set("R1", "samsung-qe55q67ca-televisor");
    db.productSlugs.set("R2", "lg-oled55c46la-televisor");
    db.productSlugs.set("R3", "sony-xr55x90l-televisor");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([
        listingItem("R1", { priceCents: 45_000 }),
        listingItem("R2", { priceCents: 55_000 }),
        listingItem("R3"),
      ]),
    });
    const endpoint = "https://descontoreal.test/api/revalidate";
    const { transport, calls } = fakeTransport({ [endpoint]: jsonResponse('{"revalidated":2}') });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db, {
      revalidation: { siteUrl: "https://descontoreal.test/", secret: "segredo-de-teste", transport },
    });

    // Assert
    expect(report).toMatchObject({ changed: 2, unchanged: 1 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(endpoint);
    expect(calls[0]?.init.method).toBe("POST");
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer segredo-de-teste");
    expect(calls[0]?.init.body).toBe(
      JSON.stringify({ slugs: ["samsung-qe55q67ca-televisor", "lg-oled55c46la-televisor"] }),
    );
  });
});

describe("runStore blocks", () => {
  it("stops a store that answers 403 three times in a row, records it as blocked and emails the admin", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const laptops = fakeCategory("portateis", { categorySlug: "portateis" });
    const { transport, calls } = fakeTransport({
      [`${FAKE_STORE_URL}/robots.txt`]: textResponse("User-agent: *\nDisallow:"),
      [tv.url]: textResponse("Forbidden", 403),
      [monitors.url]: textResponse("Forbidden", 403),
      [laptops.url]: textResponse("Forbidden", 403),
    });
    const store = createFakeStore([tv, monitors, laptops]);
    const fetcher = new StoreFetcher(store, { transport, minDelayMs: 0, maxDelayMs: 0, log: silentLog });
    const db = new FakeDb();

    // Act
    const report = await run(store, fetcher, db);

    // Assert
    expect(report.status).toBe("blocked");
    expect(calls).toHaveLength(4);
    expect(db.finishedRuns[0]?.summary.status).toBe("blocked");
    expect(report.errors.at(-1)?.message).toMatch(/blocks our bot: HTTP 403, 3 times in a row/);
    expect(db.calls).not.toContain("markMissingListings");
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    expect(notifyAdminMock.mock.calls[0]?.[0]).toBe(`DescontoReal: recolha bloqueada (${FAKE_STORE_NAME})`);
  });

  it("stops at once when robots.txt answers 403", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const { transport, calls } = fakeTransport({
      [`${FAKE_STORE_URL}/robots.txt`]: textResponse("Access Denied", 403),
    });
    const store = createFakeStore([tv]);
    const fetcher = new StoreFetcher(store, { transport, minDelayMs: 0, maxDelayMs: 0, log: silentLog });

    // Act
    const report = await run(store, fetcher, new FakeDb());

    // Assert
    expect(report.status).toBe("blocked");
    expect(calls.map((call) => call.url)).toEqual([`${FAKE_STORE_URL}/robots.txt`]);
  });

  it("keeps the items of the current page that were already decided when the block comes", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", { sellerName: null })]),
      [productUrl("B")]: new StoreBlockedError(
        "darty blocks our bot: HTTP 403, 3 times in a row",
        productUrl("B"),
      ),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report.status).toBe("blocked");
    expect(ingestedSkus(db)).toEqual([["A"]]);
  });
});

describe("runStore failing store", () => {
  it("stops a store whose URLs keep failing, keeps what it read, records a failed run and emails the admin", async () => {
    // Arrange
    const first = fakeCategory("c0");
    const failing = ["c1", "c2", "c3", "c4", "c5"].map((key) => fakeCategory(key));
    const last = fakeCategory("c6");
    const routes: Record<string, Reply> = {
      [ROBOTS]: textResponse("User-agent: *\nDisallow:"),
      [first.url]: jsonResponse(listingBody([listingItem("A", WITH_EAN)])),
      [last.url]: jsonResponse(listingBody([listingItem("Z", WITH_EAN)])),
    };
    for (const category of failing) {
      routes[category.url] = textResponse("Service unavailable", 503);
    }
    const store = createFakeStore([first, ...failing, last]);
    const { fetcher, requested } = storeFetcher(store, routes);
    const db = new FakeDb();

    // Act
    const report = await run(store, fetcher, db);

    // Assert
    expect(report.status).toBe("failed");
    expect(ingestedSkus(db)).toEqual([["A"]]);
    expect(requested()).not.toContain(last.url);
    expect(report.errors.at(-1)).toEqual({
      url: failing[4]?.url,
      message: "darty keeps failing: HTTP 503 (3 attempts), 5 URLs in a row",
    });
    expect(db.finishedRuns[0]?.summary.status).toBe("failed");
    expect(db.calls).not.toContain("markMissingListings");
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    const [subject, text] = notifyAdminMock.mock.calls[0] ?? [];
    expect(subject).toBe(`DescontoReal: recolha falhada (${FAKE_STORE_NAME})`);
    expect(text?.split("\n").slice(0, 2)).toEqual([
      `A recolha da loja ${FAKE_STORE_NAME} falhou.`,
      `Motivo: ${failing[4]?.url}: darty keeps failing: HTTP 503 (3 attempts), 5 URLs in a row`,
    ]);
  });

  it("keeps the items of the current page that were already decided when the store stops failing", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN), listingItem("B", { sellerName: null })]),
      [productUrl("B")]: new StoreUnavailableError(
        "darty keeps failing: HTTP 503 (3 attempts), 5 URLs in a row",
        productUrl("B"),
      ),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report.status).toBe("failed");
    expect(ingestedSkus(db)).toEqual([["A"]]);
  });
});

describe("runStore robots.txt", () => {
  it("ends the run as blocked, naming robots.txt, when robots.txt disallows every category to our bot", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const store = createFakeStore([tv, monitors]);
    const { fetcher, requested } = storeFetcher(store, {
      [ROBOTS]: textResponse("User-agent: *\nAllow: /\n\nUser-agent: DescontoRealBot\nDisallow: /c/"),
    });
    const db = new FakeDb();

    // Act
    const report = await run(store, fetcher, db);

    // Assert
    expect(report.status).toBe("blocked");
    expect(report.errors).toEqual([
      { url: ROBOTS, message: "darty blocks our bot: robots.txt disallows every category URL (2)" },
    ]);
    expect(requested()).toEqual([ROBOTS]);
    expect(db.finishedRuns[0]?.summary.status).toBe("blocked");
    expect(notifyAdminMock.mock.calls[0]?.[0]).toBe(`DescontoReal: recolha bloqueada (${FAKE_STORE_NAME})`);
  });

  it("says when robots.txt disallows the whole site", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const store = createFakeStore([tv]);
    const { fetcher } = storeFetcher(store, { [ROBOTS]: textResponse("User-agent: *\nDisallow: /") });

    // Act
    const report = await run(store, fetcher, null);

    // Assert
    expect(report.status).toBe("blocked");
    expect(report.errors.map((error) => error.message)).toEqual([
      "darty blocks our bot: robots.txt disallows the whole site",
    ]);
  });

  it("skips the categories robots.txt disallows, reads the others and ends as a partial run with an email", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });
    fetcher.disallow(monitors.url);
    const db = new FakeDb();
    db.recentCounts = [100, 110, 90];

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, db);

    // Assert
    expect(fetcher.requested).toEqual([tv.url]);
    expect(report).toMatchObject({ status: "success", partial: true, listingsSeen: 1 });
    expect(report.incompleteCategories).toEqual([
      { key: "monitores", url: monitors.url, failedUrl: monitors.url, reason: "robots-txt" },
    ]);
    expect(report.errors).toEqual([
      { url: monitors.url, message: "Category monitores skipped: robots.txt disallows it" },
    ]);
    expect(db.finishedRuns[0]?.summary).toMatchObject({ status: "success", partial: true });
    expect(db.calls).not.toContain("recentListingCounts:7");
    expect(db.calls).not.toContain("markMissingListings");
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    const [subject, text] = notifyAdminMock.mock.calls[0] ?? [];
    expect(subject).toBe(`DescontoReal: recolha incompleta (${FAKE_STORE_NAME})`);
    expect(text).toContain(`  - ${monitors.url} (proibida pelo robots.txt)`);
  });

  it("ends the run as blocked, naming robots.txt, when it disallows the product pages a store's prices come from", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const store = productPageStore([tv]);
    const { fetcher, requested } = storeFetcher(store, {
      [ROBOTS]: textResponse("User-agent: DescontoRealBot\nDisallow: /p/\n"),
      [tv.url]: jsonResponse(listingBody(["P1", "P2", "P3"].map((sku) => listingItem(sku)))),
    });
    const db = new FakeDb();

    // Act
    const report = await run(store, fetcher, db);

    // Assert
    const reason = "darty blocks our bot: robots.txt disallows the product pages, where the prices are";
    expect(report).toMatchObject({
      status: "blocked",
      partial: true,
      pricePagesFetched: 0,
      skippedPrices: 0,
    });
    expect(report.errors).toEqual([{ url: productUrl("P1"), message: reason }]);
    expect(requested()).toEqual([ROBOTS, tv.url]);
    expect(db.finishedRuns[0]?.summary).toMatchObject({ status: "blocked", partial: true });
    expect(db.calls).not.toContain("markMissingListings");
    const [subject, text] = notifyAdminMock.mock.calls[0] ?? [];
    expect(subject).toBe(`DescontoReal: recolha bloqueada (${FAKE_STORE_NAME})`);
    expect(text?.split("\n")[1]).toBe(`Motivo: ${productUrl("P1")}: ${reason}`);
  });

  it("keeps the prices read before the first product page robots.txt disallows", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody(["P1", "P2", "P3"].map((sku) => listingItem(sku))),
      [productUrl("P1")]: productBody(productDetails("P1")),
      [productUrl("P3")]: productBody(productDetails("P3")),
    });
    fetcher.disallow(productUrl("P2"));
    const db = new FakeDb();

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(report).toMatchObject({ status: "blocked", partial: true, pricePagesFetched: 1 });
    expect(fetcher.requested).toEqual([tv.url, productUrl("P1")]);
    expect(ingestedSkus(db)).toEqual([["P1"]]);
  });

  it("skips today a price page that redirects to a URL robots.txt disallows, without blocking the store", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const store = productPageStore([tv]);
    const priced = ["P1", "P2", "P3", "P4"];
    const routes: Record<string, Reply> = {
      [ROBOTS]: textResponse("User-agent: *\nDisallow: /search\n"),
      [tv.url]: jsonResponse(listingBody(["GONE", ...priced].map((sku) => listingItem(sku)))),
      [productUrl("GONE")]: redirectResponse("/search?q=GONE"),
    };
    for (const sku of priced) {
      routes[productUrl(sku)] = jsonResponse(productBody(productDetails(sku)));
    }
    const { fetcher } = storeFetcher(store, routes);
    const db = new FakeDb();

    // Act
    const report = await run(store, fetcher, db);

    // Assert
    expect(report).toMatchObject({ status: "success", partial: false, skippedPrices: 1 });
    expect(report.errors).toEqual([
      {
        url: productUrl("GONE"),
        message: `Redirected to ${FAKE_STORE_URL}/search?q=GONE, which robots.txt disallows`,
      },
    ]);
    expect(ingestedSkus(db)).toEqual([priced]);
  });
});

describe("runStore incomplete crawl", () => {
  it("stays a success that marks nothing missing when a listing page fails, and emails the admin the category URLs", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const monitorsPage2 = `${monitors.url}?page=2`;
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("A", WITH_EAN)]),
      [monitors.url]: listingBody([listingItem("B", WITH_EAN)], monitorsPage2),
      [monitorsPage2]: new FetchError("HTTP 503 (3 attempts)", monitorsPage2, 503),
    });
    const db = new FakeDb();

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, db);

    // Assert
    expect(report).toMatchObject({ status: "success", partial: true, listingsSeen: 2 });
    expect(report.incompleteCategories).toEqual([
      { key: "monitores", url: monitors.url, failedUrl: monitorsPage2, reason: "listing-page" },
    ]);
    expect(db.calls).not.toContain("markMissingListings");
    expect(db.finishedRuns[0]?.summary.partial).toBe(true);
    expect(notifyAdminMock).toHaveBeenCalledTimes(1);
    const [subject, text] = notifyAdminMock.mock.calls[0] ?? [];
    expect(subject).toBe(`DescontoReal: recolha incompleta (${FAKE_STORE_NAME})`);
    expect(text?.split("\n")[0]).toBe(
      `A recolha da loja ${FAKE_STORE_NAME} terminou, mas 1 categoria não foi lida até ao fim (lista abaixo). ` +
        "Os preços lidos foram gravados. Como a recolha ficou incompleta, nenhum artigo foi marcado como desaparecido hoje.",
    );
    expect(text).toContain(`Categorias incompletas: 1\n  - ${monitors.url} (falhou ${monitorsPage2})`);
  });

  it("keeps a truncated count out of the broken-run baseline", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });
    const db = new FakeDb();
    db.recentCounts = [20, 20, 20, 20, 20, 20, 20];

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, db);

    // Assert
    expect(report).toMatchObject({ status: "success", partial: true, listingsSeen: 1 });
    expect(db.calls).not.toContain("recentListingCounts:7");
    expect(db.finishedRuns[0]?.summary).toMatchObject({ status: "success", partial: true });
  });

  it("names a category whose first page failed", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, new FakeDb());

    // Assert
    expect(report.incompleteCategories).toEqual([
      { key: "monitores", url: monitors.url, failedUrl: monitors.url, reason: "listing-page" },
    ]);
    expect(notifyAdminMock.mock.calls[0]?.[1]).toContain(`  - ${monitors.url} (falhou a primeira página)`);
  });

  it("never emails about an incomplete dry run", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const monitors = fakeCategory("monitores", { categorySlug: "monitores" });
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });

    // Act
    const report = await run(createFakeStore([tv, monitors]), fetcher, null);

    // Assert
    expect(report.incompleteCategories).toHaveLength(1);
    expect(notifyAdminMock).not.toHaveBeenCalled();
  });
});

describe("runStore listings seen without a price", () => {
  it("resets their missed runs before marking missing listings, so a listing seen every day stays active", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    const unpriced = ["GONE", "NOPRICE", "OTHER"];
    const priced = Array.from({ length: 12 }, (_, index) => `OK${index}`);
    for (const sku of [...unpriced, ...priced]) {
      db.addListing(sku, { productPageCheckedAt: daysAgo(1) });
    }
    db.addListing("INACTIVE", { active: false, productPageCheckedAt: daysAgo(1) });
    const listed = [...unpriced, "INACTIVE", "NEW", ...priced];
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody(listed.map((sku) => listingItem(sku))),
      [productUrl("NOPRICE")]: productBody(productDetails("NOPRICE", { priceCents: null })),
      [productUrl("OTHER")]: productBody(productDetails("T00000001")),
    });
    for (const sku of priced) {
      fetcher.set(productUrl(sku), productBody(productDetails(sku)));
    }

    // Act
    const report = await run(productPageStore([tv]), fetcher, db);

    // Assert
    expect(report).toMatchObject({ status: "success", skippedPrices: 5 });
    expect(db.touches).toEqual([unpriced]);
    expect(db.calls.indexOf("touchListings")).toBeLessThan(db.calls.indexOf("markMissingListings"));
  });

  it("keeps a listing whose price jump was not confirmed as seen", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("J", { priceCents: 100_000, productPageCheckedAt: daysAgo(1) });
    db.addListing("K", { productPageCheckedAt: daysAgo(1) });
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody([listingItem("J", { priceCents: 20_000 }), listingItem("K")]),
      [productUrl("J")]: productBody(productDetails("J", { priceCents: 100_000 })),
    });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(report.skippedJumps).toBe(1);
    expect(ingestedSkus(db)).toEqual([["K"]]);
    expect(db.touches).toEqual([["J"]]);
  });

  it("touches nothing when every listing got its price", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const db = new FakeDb();
    db.addListing("A", { productPageCheckedAt: daysAgo(1) });
    const fetcher = new FakeFetcher({ [tv.url]: listingBody([listingItem("A", WITH_EAN)]) });

    // Act
    await run(createFakeStore([tv]), fetcher, db);

    // Assert
    expect(db.calls).not.toContain("touchListings");
    expect(db.calls).toContain("markMissingListings");
  });
});

describe("runStore dry run", () => {
  it("never touches a database, reads at most 5 product pages and never revalidates", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const skus = ["N1", "N2", "N3", "N4", "N5", "N6", "N7"];
    const fetcher = new FakeFetcher({ [tv.url]: listingBody(skus.map((sku) => listingItem(sku))) });
    for (const sku of skus) {
      fetcher.set(productUrl(sku), productBody(productDetails(sku)));
    }
    const { transport, calls } = fakeTransport({});

    // Act
    const report = await run(createFakeStore([tv]), fetcher, null, {
      revalidation: { siteUrl: "https://descontoreal.test", secret: "segredo-de-teste", transport },
    });

    // Assert
    expect(report).toMatchObject({
      status: "success",
      dryRun: true,
      new: 7,
      productPagesFetched: 5,
      budgetExhausted: 2,
    });
    expect(calls).toEqual([]);
    expect(notifyAdminMock).not.toHaveBeenCalled();
  });

  it("shows the first 10 items with the seller decision and the EAN from the product page", async () => {
    // Arrange
    const tv = fakeCategory("tv");
    const items = [
      listingItem("A", WITH_EAN),
      listingItem("M", { ...WITH_EAN, sellerName: "Vendedor X" }),
      listingItem("U", { sellerName: null }),
      ...Array.from({ length: 9 }, (_, index) => listingItem(`I${index + 1}`, WITH_EAN)),
    ];
    const fetcher = new FakeFetcher({
      [tv.url]: listingBody(items),
      [productUrl("U")]: productBody(productDetails("U", { ean: OTHER_EAN })),
    });

    // Act
    const report = await run(createFakeStore([tv]), fetcher, null);

    // Assert
    expect(report.sampleItems).toHaveLength(10);
    expect(
      report.sampleItems.slice(0, 3).map((sample) => [sample.storeSku, sample.soldByStore, sample.ean]),
    ).toEqual([
      ["A", true, VALID_EAN],
      ["M", false, VALID_EAN],
      ["U", true, OTHER_EAN],
    ]);
    expect(report.sampleItems.at(-1)?.storeSku).toBe("I7");
  });

  it("fails without emailing when nothing was found", async () => {
    // Arrange
    const tv = fakeCategory("tv");

    // Act
    const report = await run(createFakeStore([tv]), new FakeFetcher({ [tv.url]: listingBody([]) }), null);

    // Assert
    expect(report.status).toBe("failed");
    expect(notifyAdminMock).not.toHaveBeenCalled();
  });
});
