import { describe, expect, it } from "vitest";
import { chartSeries } from "../src/chart";
import type { ListingHistory } from "../src/insights";

const NOW = new Date("2026-11-20T10:00:00Z");

function at(iso: string): number {
  return new Date(iso).getTime();
}

describe("chartSeries", () => {
  it("turns each listing's intervals into segments, oldest first, the current one ending now", () => {
    // Arrange
    const listings: ListingHistory[] = [
      {
        listingId: 7,
        storeSlug: "darty",
        storeName: "Darty",
        missedRuns: 0,
        lastSeenAt: NOW,
        intervals: [
          {
            priceCents: 44_999,
            referencePriceCents: null,
            inStock: true,
            validFrom: new Date("2026-11-05T04:00:00Z"),
            validTo: null,
          },
          {
            priceCents: 51_999,
            referencePriceCents: null,
            inStock: false,
            validFrom: new Date("2026-10-28T04:00:00Z"),
            validTo: new Date("2026-11-02T04:00:00Z"),
          },
        ],
      },
    ];

    // Act
    const series = chartSeries(listings, NOW);

    // Assert: the gap from 2 to 5 Nov stays a gap.
    expect(series).toEqual([
      {
        listingId: 7,
        storeSlug: "darty",
        storeName: "Darty",
        segments: [
          {
            from: at("2026-10-28T04:00:00Z"),
            to: at("2026-11-02T04:00:00Z"),
            priceCents: 51_999,
            inStock: false,
          },
          { from: at("2026-11-05T04:00:00Z"), to: NOW.getTime(), priceCents: 44_999, inStock: true },
        ],
      },
    ]);
  });

  it("leaves out listings without prices", () => {
    // Arrange
    const listings: ListingHistory[] = [
      {
        listingId: 8,
        storeSlug: "radiopopular",
        storeName: "Radio Popular",
        missedRuns: 0,
        lastSeenAt: NOW,
        intervals: [],
      },
    ];

    // Act
    const series = chartSeries(listings, NOW);

    // Assert
    expect(series).toEqual([]);
  });
});
