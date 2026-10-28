export interface QualityConfig {
  /** A drop larger than this fraction needs a second reading (0.7 = more than 70%). */
  maxDropFraction: number;
  /** A rise larger than this fraction needs a second reading (2 = more than 200%). */
  maxRiseFraction: number;
  /** A run is broken when it sees fewer listings than this fraction of the recent average (0.7 = 30% fewer). */
  brokenRunFraction: number;
  /** How many recent runs make the average. */
  recentRuns: number;
}

export const QUALITY_CONFIG: QualityConfig = {
  maxDropFraction: 0.7,
  maxRiseFraction: 2,
  brokenRunFraction: 0.7,
  recentRuns: 7,
};

/** True when going from `previousCents` to `nextCents` must be confirmed by reading the product page again. */
export function isSuspiciousPriceJump(
  previousCents: number,
  nextCents: number,
  config: QualityConfig = QUALITY_CONFIG,
): boolean {
  if (previousCents <= 0) {
    return false;
  }
  const change = (nextCents - previousCents) / previousCents;
  return change < -config.maxDropFraction || change > config.maxRiseFraction;
}

/** True when `listingsSeen` is below brokenRunFraction × average of `recentCounts`. False without recent runs. */
export function isBrokenRun(
  listingsSeen: number,
  recentCounts: readonly number[],
  config: QualityConfig = QUALITY_CONFIG,
): boolean {
  if (recentCounts.length === 0) {
    return false;
  }
  const average = recentCounts.reduce((sum, count) => sum + count, 0) / recentCounts.length;
  return listingsSeen < average * config.brokenRunFraction;
}
