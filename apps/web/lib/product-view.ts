import {
  calendarDaysBetween,
  currentIntervalOf,
  currentOffers,
  DAY_MS,
  formatDatePt,
  isCurrentOffer,
  isProductIndexable,
  lowestPriceBetween,
  type Offer,
  type PriceAt,
  type PriceInterval,
  SUMMARY_DAYS,
  trackedSince,
} from "@descontoreal/core";
import type { PageListing, ProductPage } from "@descontoreal/db/web";

/** What a store's row in the product page says about its price today. */
export type ListingStatus = "on-sale" | "out-of-stock" | "unconfirmed" | "gone";

export interface StoreRow {
  listing: PageListing;
  current: PriceInterval | undefined;
  status: ListingStatus;
}

export interface LowestRow {
  label: string;
  lowest: PriceAt;
}

export interface ProductView {
  offers: Offer[];
  best: Offer | null;
  bestListing: PageListing | undefined;
  rows: StoreRow[];
  since: Date | null;
  lowest: LowestRow[];
  /** Lowest price over SUMMARY_DAYS, or since tracking started when that is more recent: the meta description's. */
  summaryLowest: PriceAt | null;
  indexable: boolean;
  storeNames: string[];
}

const WINDOWS = [30, 90, 180] as const;

/** The product page's view of the data at `now`: offers, rows of the table of stores and lowest prices. */
export function productView(page: ProductPage, now: Date): ProductView {
  const offers = currentOffers(page.listings, now);
  const best = offers[0] ?? null;
  const since = trackedSince(page.listings);
  const rows = page.listings.map((listing) => {
    const current = currentIntervalOf(listing.intervals);
    return { listing, current, status: statusOf(listing, current, now) };
  });
  return {
    offers,
    best,
    bestListing: page.listings.find((listing) => listing.listingId === best?.listingId),
    rows: rows.sort((a, b) => order(a) - order(b)),
    since,
    lowest: since === null ? [] : lowestRows(page.listings, since, now),
    summaryLowest:
      since === null
        ? null
        : lowestPriceBetween(
            page.listings,
            new Date(Math.max(since.getTime(), now.getTime() - SUMMARY_DAYS * DAY_MS)),
            now,
          ),
    indexable: isProductIndexable({
      historyDays: since === null ? 0 : calendarDaysBetween(since, now),
      storeCount: new Set(rows.filter((row) => row.status !== "gone").map((row) => row.listing.storeSlug))
        .size,
    }),
    storeNames: [...new Set(page.listings.map((listing) => listing.storeName))],
  };
}

function statusOf(listing: PageListing, current: PriceInterval | undefined, now: Date): ListingStatus {
  if (!listing.active || current === undefined) {
    return "gone";
  }
  if (!current.inStock) {
    return "out-of-stock";
  }
  return isCurrentOffer(
    { inStock: true, missedRuns: listing.missedRuns, lastSeenAt: listing.lastSeenAt },
    now,
  )
    ? "on-sale"
    : "unconfirmed";
}

/** Stores on sale first, cheapest first; then the rest. */
function order(row: StoreRow): number {
  const rank = ["on-sale", "out-of-stock", "unconfirmed", "gone"].indexOf(row.status);
  return rank * 1e9 + (row.current?.priceCents ?? 0);
}

/** Lowest price over 30, 90 and 180 days, as far back as the history goes, and since tracking started. */
function lowestRows(listings: readonly PageListing[], since: Date, now: Date): LowestRow[] {
  const rows: LowestRow[] = [];
  for (const days of WINDOWS) {
    const from = new Date(now.getTime() - days * DAY_MS);
    if (from.getTime() <= since.getTime()) {
      break;
    }
    const lowest = lowestPriceBetween(listings, from, now);
    if (lowest !== null) {
      rows.push({ label: `Últimos ${days} dias`, lowest });
    }
  }
  const allTime = lowestPriceBetween(listings, since, now);
  if (allTime !== null) {
    rows.push({ label: `Desde ${formatDatePt(since)}`, lowest: allTime });
  }
  return rows;
}
