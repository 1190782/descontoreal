import type { ListingHistory } from "./insights";
import type { StoreSlug } from "./stores";

/** One price interval of the chart, in epoch milliseconds. */
export interface ChartSegment {
  from: number;
  /** The end of the interval, or `now` for the current price. */
  to: number;
  priceCents: number;
  inStock: boolean;
}

/** One line of the price chart: a listing's intervals, oldest first. */
export interface ChartSeries {
  listingId: number;
  storeSlug: StoreSlug;
  storeName: string;
  segments: ChartSegment[];
}

/**
 * The price chart's data: a step line per listing, drawn from its intervals as they are, so a gap (a listing that
 * was not on sale) stays a gap. Listings without prices are left out.
 */
export function chartSeries(listings: readonly ListingHistory[], now: Date): ChartSeries[] {
  return listings
    .map((listing) => ({
      listingId: listing.listingId,
      storeSlug: listing.storeSlug,
      storeName: listing.storeName,
      segments: listing.intervals
        .map((interval) => ({
          from: interval.validFrom.getTime(),
          to: (interval.validTo ?? now).getTime(),
          priceCents: interval.priceCents,
          inStock: interval.inStock,
        }))
        .filter((segment) => segment.to > segment.from || segment.from === now.getTime())
        .sort((a, b) => a.from - b.from),
    }))
    .filter((series) => series.segments.length > 0);
}
