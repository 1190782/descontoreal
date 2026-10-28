import { describe, expect, it } from "vitest";
import type { PriceInterval } from "../src/history";
import {
  daysBefore,
  findCurrentInterval,
  firstOfSamePrice,
  highestIntervalIn,
  lowestPriceIn,
  overlapMs,
  sortByValidFrom,
} from "../src/intervals";
import { DAY_MS } from "../src/time";

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

describe("daysBefore", () => {
  it("moves back whole 24-hour days", () => {
    // Arrange
    const date = new Date("2026-11-27T06:00:00.000Z");

    // Act
    const earlier = daysBefore(date, 30);

    // Assert
    expect(earlier.toISOString()).toBe("2026-10-28T06:00:00.000Z");
  });
});

describe("overlapMs", () => {
  it.each([
    ["a closed interval inside the window", interval(100, 8, 6), 2 * DAY_MS],
    ["a closed interval starting before the window", interval(100, 20, 6), 4 * DAY_MS],
    ["an open interval, which runs until the window end", interval(100, 3, null), 3 * DAY_MS],
    ["an open interval starting before the window", interval(100, 30, null), 10 * DAY_MS],
    ["an interval ending exactly at the window start", interval(100, 20, 10), 0],
    ["an interval entirely before the window", interval(100, 30, 20), 0],
    ["a zero-length interval", interval(100, 5, 5), 0],
  ])("measures %s", (_case, candidate, expected) => {
    // Arrange
    const from = daysBefore(NOW, 10);

    // Act
    const overlap = overlapMs(candidate, from, NOW);

    // Assert
    expect(overlap).toBe(expected);
  });

  it("is zero for a window that ends before it starts", () => {
    // Arrange
    const candidate = interval(100, 30, null);

    // Act
    const overlap = overlapMs(candidate, NOW, daysBefore(NOW, 10));

    // Assert
    expect(overlap).toBe(0);
  });
});

describe("sortByValidFrom", () => {
  it("returns a sorted copy and leaves the input alone", () => {
    // Arrange
    const newest = interval(300, 5, null);
    const oldest = interval(100, 20, 10);
    const middle = interval(200, 10, 5);
    const input = [newest, oldest, middle];

    // Act
    const sorted = sortByValidFrom(input);

    // Assert
    expect(sorted).toEqual([oldest, middle, newest]);
    expect(input).toEqual([newest, oldest, middle]);
  });
});

describe("findCurrentInterval", () => {
  it("returns the interval without validTo", () => {
    // Arrange
    const current = interval(300, 5, null);
    const intervals = [interval(100, 20, 5), current];

    // Act
    const found = findCurrentInterval(intervals);

    // Assert
    expect(found).toBe(current);
  });

  it.each([
    ["no interval", [], 0],
    ["only closed intervals", [interval(100, 20, 5)], 0],
    ["two current intervals", [interval(100, 20, null), interval(200, 5, null)], 2],
  ])("throws with %s", (_case, intervals, found) => {
    // Arrange
    const input: PriceInterval[] = intervals;

    // Act
    const find = (): PriceInterval => findCurrentInterval(input);

    // Assert
    expect(find).toThrow(`Expected exactly one current price interval (validTo = null), found ${found}`);
  });
});

describe("firstOfSamePrice", () => {
  it("goes back over intervals at the same price that each end where the next starts", () => {
    // Arrange
    const first = interval(300, 40, 30);
    const outOfStock = { ...interval(300, 30, 25), inStock: false };
    const withReference = { ...interval(300, 25, 20), referencePriceCents: 400 };
    const sorted = [interval(100, 50, 40), first, outOfStock, withReference, interval(200, 20, null)];

    // Act
    const found = firstOfSamePrice(sorted, withReference);

    // Assert
    expect(found).toBe(first);
  });

  it("stops at a gap, even at the same price", () => {
    // Arrange
    const current = interval(300, 10, null);
    const sorted = [interval(300, 30, 20), current];

    // Act
    const found = firstOfSamePrice(sorted, current);

    // Assert
    expect(found).toBe(current);
  });

  it("returns the interval itself when it is the oldest", () => {
    // Arrange
    const only = interval(300, 10, null);

    // Act
    const found = firstOfSamePrice([only], only);

    // Assert
    expect(found).toBe(only);
  });
});

describe("lowestPriceIn", () => {
  it("returns the lowest price that held inside the window", () => {
    // Arrange
    const intervals = [interval(100, 40, 30), interval(300, 30, 20), interval(200, 20, null)];

    // Act
    const lowest = lowestPriceIn(intervals, daysBefore(NOW, 30), NOW);

    // Assert
    expect(lowest).toBe(200);
  });

  it("ignores zero-length intervals", () => {
    // Arrange
    const intervals = [interval(300, 30, 10), interval(50, 10, 10), interval(200, 10, null)];

    // Act
    const lowest = lowestPriceIn(intervals, daysBefore(NOW, 30), NOW);

    // Assert
    expect(lowest).toBe(200);
  });

  it("returns null when nothing held inside the window", () => {
    // Arrange
    const intervals = [interval(100, 40, 30)];

    // Act
    const lowest = lowestPriceIn(intervals, daysBefore(NOW, 30), NOW);

    // Assert
    expect(lowest).toBeNull();
  });
});

describe("highestIntervalIn", () => {
  it("returns the interval with the highest price inside the window", () => {
    // Arrange
    const peak = interval(300, 30, 20);
    const intervals = [interval(900, 50, 30), peak, interval(200, 20, null)];

    // Act
    const highest = highestIntervalIn(intervals, daysBefore(NOW, 30), NOW);

    // Assert
    expect(highest).toBe(peak);
  });

  it("returns the latest interval on ties, whatever the input order", () => {
    // Arrange
    const latestPeak = interval(300, 10, 5);
    const intervals = [latestPeak, interval(300, 30, 20), interval(200, 20, 10), interval(200, 5, null)];

    // Act
    const highest = highestIntervalIn(intervals, daysBefore(NOW, 30), NOW);

    // Assert
    expect(highest).toBe(latestPeak);
  });

  it("returns null when nothing held inside the window", () => {
    // Arrange
    const intervals = [interval(100, 40, 30)];

    // Act
    const highest = highestIntervalIn(intervals, daysBefore(NOW, 30), NOW);

    // Assert
    expect(highest).toBeNull();
  });
});
