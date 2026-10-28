import { describe, expect, it } from "vitest";
import type { PriceInterval } from "../src/history";
import { currentIntervalOf, isCurrentOffer, type OfferState } from "../src/offers";

const NOW = new Date("2026-11-20T10:00:00Z");

function state(overrides: Partial<OfferState> = {}): OfferState {
  return { inStock: true, missedRuns: 0, lastSeenAt: new Date("2026-11-20T04:30:00Z"), ...overrides };
}

describe("isCurrentOffer", () => {
  it("counts a price in stock, read today, with no missed runs", () => {
    // Act
    const current = isCurrentOffer(state(), NOW);

    // Assert
    expect(current).toBe(true);
  });

  it("still counts a price read yesterday, when today's run of that store failed", () => {
    // Arrange
    const offer = state({ lastSeenAt: new Date("2026-11-19T04:30:00Z") });

    // Act
    const current = isCurrentOffer(offer, NOW);

    // Assert
    expect(current).toBe(true);
  });

  it("drops a price read two calendar days ago in Lisbon, even under 48 hours ago", () => {
    // Arrange
    const offer = state({ lastSeenAt: new Date("2026-11-18T23:30:00Z") });
    const now = new Date("2026-11-20T00:10:00Z");

    // Act
    const current = isCurrentOffer(offer, now);

    // Assert
    expect(current).toBe(false);
  });

  it.each([
    ["out of stock", { inStock: false }],
    ["missed by the last complete run", { missedRuns: 1 }],
  ])("drops a price %s", (_case, overrides) => {
    // Act
    const current = isCurrentOffer(state(overrides), NOW);

    // Assert
    expect(current).toBe(false);
  });
});

describe("currentIntervalOf", () => {
  const changedAt = new Date("2026-11-02T03:00:00Z");
  const closed: PriceInterval = {
    priceCents: 49_999,
    referencePriceCents: null,
    inStock: true,
    validFrom: new Date("2026-10-28T03:00:00Z"),
    validTo: changedAt,
  };
  const open: PriceInterval = { ...closed, priceCents: 44_999, validFrom: changedAt, validTo: null };

  it("returns the open interval", () => {
    // Act
    const current = currentIntervalOf([closed, open]);

    // Assert
    expect(current).toBe(open);
  });

  it("returns undefined for a listing without a current price", () => {
    // Act
    const current = currentIntervalOf([closed]);

    // Assert
    expect(current).toBeUndefined();
  });
});
