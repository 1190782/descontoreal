import type { PriceInterval } from "./history";
import { calendarDaysBetween } from "./time";

/** Lisbon calendar days after its last sighting during which a listing's price still counts as an offer. */
export const OFFER_MAX_AGE_DAYS = 1;

/** What says whether a listing's current price is still on sale. */
export interface OfferState {
  inStock: boolean;
  /** Complete runs missed since the last reading with a price (listings.missed_runs). */
  missedRuns: number;
  /** When a run last read the listing's price (listings.last_seen_at). */
  lastSeenAt: Date;
}

/**
 * In stock, priced by the last complete run (one that saw it without a price counts as missing it), and priced
 * today or yesterday in Lisbon: a store whose run failed today still counts, but a price the store may have
 * changed since is never quoted.
 */
export function isCurrentOffer(state: OfferState, now: Date): boolean {
  return (
    state.inStock &&
    state.missedRuns === 0 &&
    calendarDaysBetween(state.lastSeenAt, now) <= OFFER_MAX_AGE_DAYS
  );
}

/** The open interval (validTo = null) of a listing; undefined when it has no current price. */
export function currentIntervalOf(intervals: readonly PriceInterval[]): PriceInterval | undefined {
  return intervals.find((interval) => interval.validTo === null);
}
