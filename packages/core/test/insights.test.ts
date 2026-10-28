import { describe, expect, it } from "vitest";
import type { PriceInterval } from "../src/history";
import {
  cheapestStoreShare,
  currentOffers,
  highestPriceBetween,
  isProductIndexable,
  type ListingHistory,
  lowestPriceBetween,
  priceSummary,
  productFaq,
  trackedSince,
} from "../src/insights";
import { formatCents } from "../src/money";
import type { StoreSlug } from "../src/stores";

const NOW = new Date("2026-11-20T10:00:00Z");
const SEEN_TODAY = new Date("2026-11-20T04:30:00Z");
const STORE_NAMES: Record<StoreSlug, string> = {
  darty: "Darty",
  radiopopular: "Radio Popular",
  worten: "Worten",
  fnac: "Fnac",
};

function interval(priceCents: number, from: string, to: string | null, inStock = true): PriceInterval {
  return {
    priceCents,
    referencePriceCents: null,
    inStock,
    validFrom: new Date(from),
    validTo: to === null ? null : new Date(to),
  };
}

function listing(
  listingId: number,
  storeSlug: StoreSlug,
  intervals: PriceInterval[],
  overrides: Partial<ListingHistory> = {},
): ListingHistory {
  return {
    listingId,
    storeSlug,
    storeName: STORE_NAMES[storeSlug],
    missedRuns: 0,
    lastSeenAt: SEEN_TODAY,
    intervals,
    ...overrides,
  };
}

/** Darty 519,99 € until 5 Nov, then 449,99 €; Radio Popular 479,99 € all along, both since 28 Oct. */
function twoStores(): ListingHistory[] {
  return [
    listing(1, "darty", [
      interval(51_999, "2026-10-28T04:00:00Z", "2026-11-05T04:00:00Z"),
      interval(44_999, "2026-11-05T04:00:00Z", null),
    ]),
    listing(2, "radiopopular", [interval(47_999, "2026-10-28T05:00:00Z", null)]),
  ];
}

describe("currentOffers", () => {
  it("lists the current offers cheapest first", () => {
    // Act
    const offers = currentOffers(twoStores(), NOW);

    // Assert
    expect(offers).toEqual([
      { listingId: 1, storeSlug: "darty", storeName: "Darty", priceCents: 44_999 },
      { listingId: 2, storeSlug: "radiopopular", storeName: "Radio Popular", priceCents: 47_999 },
    ]);
  });

  it("leaves out prices out of stock, missed by the last run or without a current interval", () => {
    // Arrange
    const listings = [
      listing(1, "darty", [interval(44_999, "2026-11-05T04:00:00Z", null, false)]),
      listing(2, "radiopopular", [interval(47_999, "2026-10-28T05:00:00Z", null)], { missedRuns: 1 }),
      listing(3, "radiopopular", [interval(39_999, "2026-10-28T05:00:00Z", "2026-11-10T05:00:00Z")]),
    ];

    // Act
    const offers = currentOffers(listings, NOW);

    // Assert
    expect(offers).toEqual([]);
  });
});

describe("trackedSince", () => {
  it("returns the start of the first price of any listing", () => {
    // Act
    const since = trackedSince(twoStores());

    // Assert
    expect(since).toEqual(new Date("2026-10-28T04:00:00Z"));
  });

  it("returns null without prices", () => {
    // Act
    const since = trackedSince([listing(1, "darty", [])]);

    // Assert
    expect(since).toBeNull();
  });
});

describe("lowestPriceBetween and highestPriceBetween", () => {
  it("clip the start of a price that began before the window", () => {
    // Arrange
    const from = new Date("2026-11-01T00:00:00Z");

    // Act
    const highest = highestPriceBetween(twoStores(), from, NOW);

    // Assert
    expect(highest).toEqual({ priceCents: 51_999, storeName: "Darty", since: from });
  });

  it("ignore prices that ended before the window", () => {
    // Arrange
    const from = new Date("2026-11-06T00:00:00Z");

    // Act
    const highest = highestPriceBetween(twoStores(), from, NOW);

    // Assert
    expect(highest?.priceCents).toBe(47_999);
  });

  it("keep the earliest of two equal lowest prices", () => {
    // Arrange
    const listings = [
      listing(1, "darty", [interval(39_999, "2026-11-10T04:00:00Z", null)]),
      listing(2, "radiopopular", [interval(39_999, "2026-11-02T05:00:00Z", null)]),
    ];

    // Act
    const lowest = lowestPriceBetween(listings, new Date("2026-10-28T00:00:00Z"), NOW);

    // Assert
    expect(lowest).toEqual({
      priceCents: 39_999,
      storeName: "Radio Popular",
      since: new Date("2026-11-02T05:00:00Z"),
    });
  });
});

describe("cheapestStoreShare", () => {
  it("returns the store that was strictly cheapest on most of the days compared", () => {
    // Act
    const cheapest = cheapestStoreShare(twoStores(), new Date("2026-10-28T04:00:00Z"), NOW);

    // Assert: Radio Popular from 28 Oct to 4 Nov (8 days), Darty from 5 to 20 Nov (16 days).
    expect(cheapest).toEqual({ storeName: "Darty", share: 16 / 24 });
  });

  it("counts a tie for no store and skips days with a single store", () => {
    // Arrange
    const listings = [
      listing(1, "darty", [interval(44_999, "2026-11-18T04:00:00Z", null)]),
      listing(2, "radiopopular", [
        interval(44_999, "2026-11-16T05:00:00Z", "2026-11-20T05:00:00Z"),
        interval(42_999, "2026-11-20T05:00:00Z", null),
      ]),
    ];

    // Act
    const cheapest = cheapestStoreShare(listings, new Date("2026-11-16T05:00:00Z"), NOW);

    // Assert: 16 and 17 Nov have one store, 18 and 19 Nov are ties, 20 Nov goes to Radio Popular.
    expect(cheapest).toEqual({ storeName: "Radio Popular", share: 1 / 3 });
  });

  it("returns null with a single store", () => {
    // Arrange
    const listings = [listing(1, "darty", [interval(44_999, "2026-10-28T04:00:00Z", null)])];

    // Act
    const cheapest = cheapestStoreShare(listings, new Date("2026-10-28T04:00:00Z"), NOW);

    // Assert
    expect(cheapest).toBeNull();
  });
});

describe("isProductIndexable", () => {
  it.each([
    [{ historyDays: 13, storeCount: 1 }, false],
    [{ historyDays: 14, storeCount: 1 }, true],
    [{ historyDays: 2, storeCount: 2 }, true],
  ])("isProductIndexable(%j) is %s", (input, expected) => {
    // Act
    const indexable = isProductIndexable(input);

    // Assert
    expect(indexable).toBe(expected);
  });
});

describe("priceSummary", () => {
  it("states the range since tracking started and the cheapest store", () => {
    // Act
    const summary = priceSummary(twoStores(), NOW);

    // Assert
    expect(summary).toBe(
      `Desde 28 de outubro de 2026, o preço variou entre ${formatCents(44_999)} e ${formatCents(51_999)}. ` +
        "A Darty foi a loja mais barata em 67% dos dias.",
    );
  });

  it("says the price never changed when it did not", () => {
    // Arrange
    const listings = [listing(1, "darty", [interval(44_999, "2026-10-28T04:00:00Z", null)])];

    // Act
    const summary = priceSummary(listings, NOW);

    // Assert
    expect(summary).toBe(`Desde 28 de outubro de 2026, o preço foi sempre ${formatCents(44_999)}.`);
  });

  it("looks back 90 days once the history is longer", () => {
    // Arrange
    const listings = [
      listing(1, "darty", [
        interval(59_999, "2026-01-10T04:00:00Z", "2026-08-01T04:00:00Z"),
        interval(44_999, "2026-08-01T04:00:00Z", null),
      ]),
    ];

    // Act
    const summary = priceSummary(listings, NOW);

    // Assert
    expect(summary).toBe(`Nos últimos 90 dias, o preço foi sempre ${formatCents(44_999)}.`);
  });

  it("returns null without prices", () => {
    // Act
    const summary = priceSummary([listing(1, "darty", [])], NOW);

    // Assert
    expect(summary).toBeNull();
  });
});

describe("productFaq", () => {
  it("answers from the data when today's price is the lowest so far", () => {
    // Act
    const faq = productFaq("Samsung WW90T534DAE", twoStores(), NOW);

    // Assert
    expect(faq).toEqual([
      {
        question: "Qual é o preço mais baixo de Samsung WW90T534DAE hoje?",
        answer: `${formatCents(44_999)} na Darty.`,
      },
      {
        question: "O preço de Samsung WW90T534DAE já esteve mais baixo?",
        answer:
          "Não. O preço de hoje é o mais baixo desde 28 de outubro de 2026, quando começámos a seguir este produto.",
      },
      {
        question: "Em que loja é mais barato comprar Samsung WW90T534DAE?",
        answer: "Hoje é na Darty. A Darty foi a loja mais barata em 67% dos dias.",
      },
    ]);
  });

  it("names the lower price and its date when the product was cheaper before", () => {
    // Arrange
    const listings = [
      listing(1, "darty", [
        interval(44_999, "2026-10-28T04:00:00Z", "2026-10-30T04:00:00Z"),
        interval(39_999, "2026-10-30T04:00:00Z", "2026-11-01T04:00:00Z"),
        interval(44_999, "2026-11-01T04:00:00Z", null),
      ]),
    ];

    // Act
    const faq = productFaq("LG 55QNED", listings, NOW);

    // Assert
    expect(faq[1]?.answer).toBe(
      `Sim. O preço mais baixo desde 28 de outubro de 2026 foi ${formatCents(39_999)} na Darty, ` +
        "a 30 de outubro de 2026.",
    );
  });

  it("says when no store sells the product today", () => {
    // Arrange
    const listings = [listing(1, "darty", [interval(44_999, "2026-10-28T04:00:00Z", null, false)])];

    // Act
    const faq = productFaq("LG 55QNED", listings, NOW);

    // Assert
    expect(faq).toEqual([
      {
        question: "Qual é o preço mais baixo de LG 55QNED hoje?",
        answer: "Hoje não está à venda em nenhuma das lojas que seguimos.",
      },
    ]);
  });
});
