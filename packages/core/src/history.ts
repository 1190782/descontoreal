import {
  daysBefore,
  findCurrentInterval,
  firstOfSamePrice,
  highestIntervalIn,
  lowestPriceIn,
  overlapMs,
  sortByValidFrom,
} from "./intervals";
import { calendarDaysBetween } from "./time";

/** One row of price_points: the period during which a price held. */
export interface PriceInterval {
  priceCents: number;
  /** Struck-through price announced by the store, when shown. */
  referencePriceCents: number | null;
  inStock: boolean;
  validFrom: Date;
  /** null = current interval. */
  validTo: Date | null;
}

/** Rolling-window figures for display and for listing_stats (windows end at `now`, current price included). */
export interface WindowStats {
  currentPriceCents: number;
  /** Start of the current price, which a change of stock or reference price alone does not move. */
  currentSince: Date;
  min30Cents: number | null;
  min90Cents: number | null;
  min180Cents: number | null;
  /** Median over the last 90 days, weighted by how long each price held. */
  med90Cents: number | null;
  max90Cents: number | null;
  trackedSince: Date;
  /** Calendar days in Lisbon from trackedSince to now (calendarDaysBetween). */
  historyDays: number;
}

/**
 * Computes WindowStats from the intervals of one listing (any order). Each window is [now − N days, now],
 * intervals are clipped to it, and the current price always counts.
 * Throws unless exactly one interval is current (validTo = null).
 */
export function computeWindowStats(intervals: readonly PriceInterval[], now: Date): WindowStats {
  const current = findCurrentInterval(intervals);
  const sorted = sortByValidFrom(intervals);
  const trackedSince = (sorted[0] ?? current).validFrom;
  // The current price counts even when it started at `now` and has not held for any time yet.
  const lowestSince = (days: number): number =>
    Math.min(current.priceCents, lowestPriceIn(intervals, daysBefore(now, days), now) ?? current.priceCents);
  const highest = highestIntervalIn(intervals, daysBefore(now, 90), now);
  return {
    currentPriceCents: current.priceCents,
    currentSince: firstOfSamePrice(sorted, current).validFrom,
    min30Cents: lowestSince(30),
    min90Cents: lowestSince(90),
    min180Cents: lowestSince(180),
    med90Cents: timeWeightedMedian(intervals, daysBefore(now, 90), now),
    max90Cents: Math.max(current.priceCents, highest?.priceCents ?? current.priceCents),
    trackedSince,
    historyDays: calendarDaysBetween(trackedSince, now),
  };
}

/**
 * Median price between `from` and `to`, weighting each price by the time it held inside the window
 * (an open interval runs until `to`). It is the price at which the cumulative weight, from the lowest
 * price up, first reaches half, so it is always a price that existed. Returns null when no interval
 * held inside the window.
 */
export function timeWeightedMedian(intervals: readonly PriceInterval[], from: Date, to: Date): number | null {
  const weighted = intervals
    .map((interval) => ({ priceCents: interval.priceCents, weight: overlapMs(interval, from, to) }))
    .filter((entry) => entry.weight > 0)
    .sort((a, b) => a.priceCents - b.priceCents);
  const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  let cumulative = 0;
  for (const entry of weighted) {
    cumulative += entry.weight;
    // Weights are whole milliseconds, so this half-way test is exact.
    if (cumulative * 2 >= total) {
      return entry.priceCents;
    }
  }
  return null;
}
