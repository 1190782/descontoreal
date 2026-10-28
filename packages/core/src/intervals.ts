import type { PriceInterval } from "./history";
import { DAY_MS } from "./time";

/** The instant `days` days before `date`. */
export function daysBefore(date: Date, days: number): Date {
  return new Date(date.getTime() - days * DAY_MS);
}

/** Milliseconds `interval` held inside [from, to); an open interval runs until `to`. */
export function overlapMs(interval: PriceInterval, from: Date, to: Date): number {
  const start = Math.max(interval.validFrom.getTime(), from.getTime());
  const end = Math.min(interval.validTo?.getTime() ?? to.getTime(), to.getTime());
  return Math.max(0, end - start);
}

/** A copy of `intervals`, oldest validFrom first. */
export function sortByValidFrom(intervals: readonly PriceInterval[]): PriceInterval[] {
  return [...intervals].sort((a, b) => a.validFrom.getTime() - b.validFrom.getTime());
}

/** The interval with validTo = null. Throws unless there is exactly one. */
export function findCurrentInterval(intervals: readonly PriceInterval[]): PriceInterval {
  const open = intervals.filter((interval) => interval.validTo === null);
  const current = open[0];
  if (current === undefined || open.length > 1) {
    throw new Error(`Expected exactly one current price interval (validTo = null), found ${open.length}`);
  }
  return current;
}

/**
 * First interval of the same-price run that ends with `interval`, one of `sorted` (oldest validFrom first):
 * walks back while the previous interval has the same price and ends exactly where the next one starts.
 * A change of stock or reference price alone splits an interval, not the price.
 */
export function firstOfSamePrice(sorted: readonly PriceInterval[], interval: PriceInterval): PriceInterval {
  let first = interval;
  for (const previous of sorted.slice(0, sorted.indexOf(interval)).reverse()) {
    if (
      previous.priceCents !== first.priceCents ||
      previous.validTo?.getTime() !== first.validFrom.getTime()
    ) {
      break;
    }
    first = previous;
  }
  return first;
}

/** Lowest price that held for some time inside [from, to); null when no interval did. */
export function lowestPriceIn(intervals: readonly PriceInterval[], from: Date, to: Date): number | null {
  const prices = intervals
    .filter((interval) => overlapMs(interval, from, to) > 0)
    .map((interval) => interval.priceCents);
  return prices.length > 0 ? Math.min(...prices) : null;
}

/** Interval with the highest price that held inside [from, to), the latest one on ties; null when none did. */
export function highestIntervalIn(
  intervals: readonly PriceInterval[],
  from: Date,
  to: Date,
): PriceInterval | null {
  let highest: PriceInterval | null = null;
  for (const interval of intervals) {
    if (overlapMs(interval, from, to) === 0) {
      continue;
    }
    const isHigher = highest === null || interval.priceCents > highest.priceCents;
    const isLaterTie =
      highest !== null &&
      interval.priceCents === highest.priceCents &&
      interval.validFrom.getTime() > highest.validFrom.getTime();
    if (isHigher || isLaterTie) {
      highest = interval;
    }
  }
  return highest;
}
