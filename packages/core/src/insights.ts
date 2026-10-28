import type { PriceInterval } from "./history";
import { daysBefore } from "./intervals";
import { formatCents, formatPercent } from "./money";
import { currentIntervalOf, isCurrentOffer } from "./offers";
import type { StoreSlug } from "./stores";
import { DAY_MS, formatDatePt, lisbonDate } from "./time";

/** One listing of a product with its price history, as the product page reads it. */
export interface ListingHistory {
  listingId: number;
  storeSlug: StoreSlug;
  storeName: string;
  /** listings.missed_runs */
  missedRuns: number;
  /** listings.last_seen_at */
  lastSeenAt: Date;
  /** Any order. */
  intervals: readonly PriceInterval[];
}

/** A price on sale today (isCurrentOffer). */
export interface Offer {
  listingId: number;
  storeSlug: StoreSlug;
  storeName: string;
  priceCents: number;
}

/** A price a listing had, and since when (clipped to the start of the window asked for). */
export interface PriceAt {
  priceCents: number;
  storeName: string;
  since: Date;
}

/** Which store was strictly the cheapest on most days, and on what share (0–1) of the days compared. */
export interface CheapestStore {
  storeName: string;
  share: number;
}

export interface FaqEntry {
  question: string;
  answer: string;
}

/** When a product page may be indexed (docs/PLANO.md, "Conteúdo fino"). */
export const INDEXING_RULES = {
  /** Calendar days of history in Lisbon. */
  minHistoryDays: 14,
  /** Stores with a current price. */
  minStores: 2,
} as const;

/** Days the price summary and the meta description look back. */
export const SUMMARY_DAYS = 90;

/** Current offers of a product, cheapest first; ties keep the input order. */
export function currentOffers(listings: readonly ListingHistory[], now: Date): Offer[] {
  const offers: Offer[] = [];
  for (const listing of listings) {
    const current = currentIntervalOf(listing.intervals);
    const state = {
      inStock: current?.inStock ?? false,
      missedRuns: listing.missedRuns,
      lastSeenAt: listing.lastSeenAt,
    };
    if (current !== undefined && isCurrentOffer(state, now)) {
      offers.push({
        listingId: listing.listingId,
        storeSlug: listing.storeSlug,
        storeName: listing.storeName,
        priceCents: current.priceCents,
      });
    }
  }
  return offers.sort((a, b) => a.priceCents - b.priceCents);
}

/** When the first price of any listing started; null without prices. */
export function trackedSince(listings: readonly ListingHistory[]): Date | null {
  let earliest: Date | null = null;
  for (const listing of listings) {
    for (const interval of listing.intervals) {
      if (earliest === null || interval.validFrom.getTime() < earliest.getTime()) {
        earliest = interval.validFrom;
      }
    }
  }
  return earliest;
}

/** Lowest price any listing had in [from, now]; the earliest one on ties. */
export function lowestPriceBetween(
  listings: readonly ListingHistory[],
  from: Date,
  now: Date,
): PriceAt | null {
  return extremePrice(listings, from, now, (price, best) => price < best);
}

/** Highest price any listing had in [from, now]; the earliest one on ties. */
export function highestPriceBetween(
  listings: readonly ListingHistory[],
  from: Date,
  now: Date,
): PriceAt | null {
  return extremePrice(listings, from, now, (price, best) => price > best);
}

/**
 * Compares the in-stock prices of the product's stores once per Lisbon calendar day in [from, now], at 12:00 UTC
 * (or at `from` or `now` when the day starts or ends the window there). Over the days on which two or more stores
 * had a price, returns the store that was strictly the cheapest on most of them; null when no day had two stores or
 * no store was ever strictly the cheapest.
 */
export function cheapestStoreShare(
  listings: readonly ListingHistory[],
  from: Date,
  now: Date,
): CheapestStore | null {
  const wins = new Map<StoreSlug, number>();
  const names = new Map(listings.map((listing) => [listing.storeSlug, listing.storeName]));
  let compared = 0;
  for (let day = lisbonDate(from); day <= lisbonDate(now); day = nextDay(day)) {
    const at = Math.min(Math.max(Date.parse(`${day}T12:00:00Z`), from.getTime()), now.getTime());
    const prices = storePricesAt(listings, at);
    if (prices.length < 2) {
      continue;
    }
    compared += 1;
    const [cheapest, next] = prices;
    if (cheapest !== undefined && next !== undefined && cheapest.priceCents < next.priceCents) {
      wins.set(cheapest.storeSlug, (wins.get(cheapest.storeSlug) ?? 0) + 1);
    }
  }
  let best: { storeSlug: StoreSlug; wins: number } | null = null;
  for (const [storeSlug, count] of wins) {
    if (best === null || count > best.wins) {
      best = { storeSlug, wins: count };
    }
  }
  return best === null
    ? null
    : { storeName: names.get(best.storeSlug) ?? best.storeSlug, share: best.wins / compared };
}

/** A product page is indexable with enough days of history or a current price in enough stores. */
export function isProductIndexable(input: { historyDays: number; storeCount: number }): boolean {
  return input.historyDays >= INDEXING_RULES.minHistoryDays || input.storeCount >= INDEXING_RULES.minStores;
}

/**
 * The data paragraph of a product page: the price range over the last 90 days (or since tracking started) and, with
 * two or more stores, the one that was cheapest on most days. Null without any price.
 */
export function priceSummary(listings: readonly ListingHistory[], now: Date): string | null {
  const window = summaryWindow(listings, now);
  if (window === null) {
    return null;
  }
  const lowest = lowestPriceBetween(listings, window.from, now);
  const highest = highestPriceBetween(listings, window.from, now);
  if (lowest === null || highest === null) {
    return null;
  }
  const range =
    lowest.priceCents === highest.priceCents
      ? `${window.opening}, o preço foi sempre ${formatCents(lowest.priceCents)}.`
      : `${window.opening}, o preço variou entre ${formatCents(lowest.priceCents)} e ${formatCents(highest.priceCents)}.`;
  const cheapest = cheapestStoreShare(listings, window.from, now);
  return cheapest === null ? range : `${range} ${cheapestSentence(cheapest)}`;
}

/** Questions answered from the data, for the product page. */
export function productFaq(name: string, listings: readonly ListingHistory[], now: Date): FaqEntry[] {
  const best = currentOffers(listings, now)[0];
  const entries: FaqEntry[] = [
    {
      question: `Qual é o preço mais baixo de ${name} hoje?`,
      answer:
        best === undefined
          ? "Hoje não está à venda em nenhuma das lojas que seguimos."
          : `${formatCents(best.priceCents)} na ${best.storeName}.`,
    },
  ];
  const since = trackedSince(listings);
  const lowest = since === null ? null : lowestPriceBetween(listings, since, now);
  if (best !== undefined && since !== null && lowest !== null) {
    entries.push({
      question: `O preço de ${name} já esteve mais baixo?`,
      answer:
        lowest.priceCents < best.priceCents
          ? `Sim. O preço mais baixo desde ${formatDatePt(since)} foi ${formatCents(lowest.priceCents)} na ` +
            `${lowest.storeName}, a ${formatDatePt(lowest.since)}.`
          : `Não. O preço de hoje é o mais baixo desde ${formatDatePt(since)}, quando começámos a seguir este produto.`,
    });
  }
  const window = summaryWindow(listings, now);
  const cheapest = window === null ? null : cheapestStoreShare(listings, window.from, now);
  if (best !== undefined && cheapest !== null) {
    entries.push({
      question: `Em que loja é mais barato comprar ${name}?`,
      answer: `Hoje é na ${best.storeName}. ${cheapestSentence(cheapest)}`,
    });
  }
  return entries;
}

function summaryWindow(
  listings: readonly ListingHistory[],
  now: Date,
): { from: Date; opening: string } | null {
  const since = trackedSince(listings);
  if (since === null) {
    return null;
  }
  const windowStart = daysBefore(now, SUMMARY_DAYS);
  return since.getTime() > windowStart.getTime()
    ? { from: since, opening: `Desde ${formatDatePt(since)}` }
    : { from: windowStart, opening: `Nos últimos ${SUMMARY_DAYS} dias` };
}

function cheapestSentence(cheapest: CheapestStore): string {
  return `A ${cheapest.storeName} foi a loja mais barata em ${formatPercent(cheapest.share * 100)} dos dias.`;
}

function extremePrice(
  listings: readonly ListingHistory[],
  from: Date,
  now: Date,
  beats: (price: number, best: number) => boolean,
): PriceAt | null {
  let best: PriceAt | null = null;
  for (const listing of listings) {
    for (const interval of listing.intervals) {
      const end = interval.validTo ?? now;
      if (end.getTime() <= from.getTime() || interval.validFrom.getTime() > now.getTime()) {
        continue;
      }
      const since = interval.validFrom.getTime() < from.getTime() ? from : interval.validFrom;
      if (
        best === null ||
        beats(interval.priceCents, best.priceCents) ||
        (interval.priceCents === best.priceCents && since.getTime() < best.since.getTime())
      ) {
        best = { priceCents: interval.priceCents, storeName: listing.storeName, since };
      }
    }
  }
  return best;
}

/** Lowest in-stock price of each store at instant `at`, cheapest first. */
function storePricesAt(
  listings: readonly ListingHistory[],
  at: number,
): { storeSlug: StoreSlug; priceCents: number }[] {
  const prices = new Map<StoreSlug, number>();
  for (const listing of listings) {
    const interval = listing.intervals.find(
      (candidate) =>
        candidate.inStock &&
        candidate.validFrom.getTime() <= at &&
        (candidate.validTo === null || candidate.validTo.getTime() > at),
    );
    const known = prices.get(listing.storeSlug);
    if (interval !== undefined && (known === undefined || interval.priceCents < known)) {
      prices.set(listing.storeSlug, interval.priceCents);
    }
  }
  return [...prices]
    .map(([storeSlug, priceCents]) => ({ storeSlug, priceCents }))
    .sort((a, b) => a.priceCents - b.priceCents);
}

/** "2026-10-31" → "2026-11-01". */
function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}
