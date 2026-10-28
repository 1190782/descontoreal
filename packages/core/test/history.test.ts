import { describe, expect, it } from "vitest";
import { computeWindowStats, timeWeightedMedian, type PriceInterval, type WindowStats } from "../src/history";
import { daysBefore } from "../src/intervals";

const NOW = new Date("2026-11-27T06:00:00.000Z");

/** Interval from `fromDaysAgo` to `toDaysAgo` days before NOW; `toDaysAgo` null means current. */
function interval(priceCents: number, fromDaysAgo: number, toDaysAgo: number | null): PriceInterval {
  return {
    priceCents,
    referencePriceCents: null,
    inStock: true,
    validFrom: daysBefore(NOW, fromDaysAgo),
    validTo: toDaysAgo === null ? null : daysBefore(NOW, toDaysAgo),
  };
}

describe("computeWindowStats", () => {
  // Each closed interval ends exactly where a window starts, so clipping decides what counts.
  const intervals = [
    interval(20_000, 250, 180),
    interval(30_000, 180, 90),
    interval(60_000, 90, 60),
    interval(45_000, 60, 30),
    interval(50_000, 30, 10),
    interval(55_000, 10, null),
  ];

  it("computes every window ending at now, with the current price included", () => {
    // Arrange
    const expected: WindowStats = {
      currentPriceCents: 55_000,
      currentSince: daysBefore(NOW, 10),
      min30Cents: 50_000,
      min90Cents: 45_000,
      min180Cents: 30_000,
      med90Cents: 50_000,
      max90Cents: 60_000,
      trackedSince: daysBefore(NOW, 250),
      historyDays: 250,
    };

    // Act
    const stats = computeWindowStats(intervals, NOW);

    // Assert
    expect(stats).toEqual(expected);
  });

  it("counts an interval that ends one millisecond inside a window", () => {
    // Arrange
    const change = new Date(daysBefore(NOW, 30).getTime() + 1);
    const shifted: PriceInterval[] = [
      { ...interval(45_000, 60, 30), validTo: change },
      { ...interval(55_000, 30, null), validFrom: change },
    ];

    // Act
    const stats = computeWindowStats(shifted, NOW);

    // Assert
    expect(stats.min30Cents).toBe(45_000);
  });

  it("ignores a higher price that ended exactly when the 90-day window starts", () => {
    // Arrange
    const withOldPeak = [interval(90_000, 120, 90), interval(50_000, 90, 10), interval(55_000, 10, null)];

    // Act
    const stats = computeWindowStats(withOldPeak, NOW);

    // Assert
    expect(stats).toMatchObject({ max90Cents: 55_000, min180Cents: 50_000, med90Cents: 50_000 });
  });

  it("gives the same result whatever the order of the intervals", () => {
    // Arrange
    const shuffled = [
      intervals[3],
      intervals[5],
      intervals[0],
      intervals[4],
      intervals[2],
      intervals[1],
    ].filter((candidate) => candidate !== undefined);

    // Act
    const stats = computeWindowStats(shuffled, NOW);

    // Assert
    expect(stats).toEqual(computeWindowStats(intervals, NOW));
  });

  it("gives the same stats when a change of stock or reference price splits the current price", () => {
    // Arrange
    const unsplit = [interval(50_000, 30, 10), interval(45_000, 10, null)];
    const split = [
      interval(50_000, 30, 10),
      { ...interval(45_000, 10, 4), inStock: false },
      { ...interval(45_000, 4, 2), referencePriceCents: 50_000 },
      interval(45_000, 2, null),
    ];

    // Act
    const stats = computeWindowStats(split, NOW);

    // Assert
    expect(stats).toEqual(computeWindowStats(unsplit, NOW));
    expect(stats.currentSince).toEqual(daysBefore(NOW, 10));
  });

  it("uses the current price for every window when it is the only one", () => {
    // Arrange
    const only = [interval(44_999, 12.5, null)];

    // Act
    const stats = computeWindowStats(only, NOW);

    // Assert
    expect(stats).toEqual({
      currentPriceCents: 44_999,
      currentSince: daysBefore(NOW, 12.5),
      min30Cents: 44_999,
      min90Cents: 44_999,
      min180Cents: 44_999,
      med90Cents: 44_999,
      max90Cents: 44_999,
      trackedSince: daysBefore(NOW, 12.5),
      // 14 November at 18:00 to 27 November at 06:00: 12.5 days elapsed, 13 calendar days.
      historyDays: 13,
    });
  });

  it.each([
    ["Lisbon midnight", "2026-11-27T00:00:00.000Z", 30],
    ["10:59 UTC, before the hour of the first price", "2026-11-27T10:59:00.000Z", 30],
    ["the last instant of the day", "2026-11-27T23:59:59.999Z", 30],
    ["the last instant of the day before", "2026-11-26T23:59:59.999Z", 29],
  ])("counts historyDays in Lisbon calendar days at %s", (_case, iso, expected) => {
    // Arrange
    const firstPrice: PriceInterval = {
      priceCents: 50_000,
      referencePriceCents: null,
      inStock: true,
      validFrom: new Date("2026-10-28T11:00:00.000Z"),
      validTo: null,
    };

    // Act
    const stats = computeWindowStats([firstPrice], new Date(iso));

    // Assert
    expect(stats.historyDays).toBe(expected);
  });

  it("counts a current price that started at now in the minimum and maximum, but not in the median", () => {
    // Arrange
    const startedNow = [interval(50_000, 20, 0), interval(40_000, 0, null)];

    // Act
    const stats = computeWindowStats(startedNow, NOW);

    // Assert
    expect(stats).toMatchObject({ min30Cents: 40_000, max90Cents: 50_000, med90Cents: 50_000 });
  });

  it("throws without a current interval", () => {
    // Arrange
    const closed = [interval(50_000, 20, 1)];

    // Act
    const compute = (): WindowStats => computeWindowStats(closed, NOW);

    // Assert
    expect(compute).toThrow("Expected exactly one current price interval");
  });

  it("throws with two current intervals", () => {
    // Arrange
    const twoOpen = [interval(50_000, 20, null), interval(40_000, 5, null)];

    // Act
    const compute = (): WindowStats => computeWindowStats(twoOpen, NOW);

    // Assert
    expect(compute).toThrow("Expected exactly one current price interval");
  });
});

describe("timeWeightedMedian", () => {
  const from = daysBefore(NOW, 10);

  it("returns null without intervals", () => {
    // Arrange
    const intervals: PriceInterval[] = [];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBeNull();
  });

  it("returns null when nothing overlaps the window", () => {
    // Arrange
    const intervals = [interval(100, 30, 10), interval(200, 10, 10)];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBeNull();
  });

  it("returns null for a window that ends before it starts", () => {
    // Arrange
    const intervals = [interval(100, 30, null)];

    // Act
    const median = timeWeightedMedian(intervals, NOW, from);

    // Assert
    expect(median).toBeNull();
  });

  it("weights each price by how long it held", () => {
    // Arrange
    const mostlyHigh = [interval(100, 10, 7), interval(200, 7, null)];
    const mostlyLow = [interval(100, 10, 3), interval(200, 3, null)];

    // Act
    const medians = [timeWeightedMedian(mostlyHigh, from, NOW), timeWeightedMedian(mostlyLow, from, NOW)];

    // Assert
    expect(medians).toEqual([200, 100]);
  });

  it("returns the lower price when the weight splits exactly in half", () => {
    // Arrange
    const intervals = [interval(200, 10, 5), interval(100, 5, null)];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBe(100);
  });

  it("returns a price that existed, not an average", () => {
    // Arrange
    const intervals = [interval(100, 10, 6), interval(250, 6, 3), interval(400, 3, null)];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBe(250);
  });

  it("only weights the part of an interval inside the window", () => {
    // Arrange
    const intervals = [interval(100, 100, 8), interval(200, 8, null)];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBe(200);
  });

  it("ends an open interval at the window end", () => {
    // Arrange
    const to = daysBefore(NOW, 4);
    const intervals = [interval(100, 10, 6), interval(300, 6, null)];

    // Act
    const median = timeWeightedMedian(intervals, from, to);

    // Assert
    expect(median).toBe(100);
  });

  it("ignores zero-length intervals", () => {
    // Arrange
    const intervals = [interval(100, 10, 6), interval(1, 6, 6), interval(1, 6, 6), interval(300, 6, null)];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBe(300);
  });

  it("does not depend on the order of the intervals", () => {
    // Arrange
    const intervals = [interval(400, 3, null), interval(100, 10, 6), interval(250, 6, 3)];

    // Act
    const median = timeWeightedMedian(intervals, from, NOW);

    // Assert
    expect(median).toBe(250);
  });
});
