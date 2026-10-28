import {
  type Classification,
  classify,
  computeWindowStats,
  currentIntervalOf,
  isCurrentOffer,
  isLabelCode,
  LABEL_NAMES,
  type LabelCode,
  type OtherStoreOffer,
  type PriceInterval,
  type StoreSlug,
} from "@descontoreal/core";
import type { Db, ListingStatsRow, PriceHistory } from "@descontoreal/db";

export interface StatsSummary {
  /** Listings classified, per label; labels no listing got are absent. */
  labels: Partial<Record<LabelCode, number>>;
  /** Listings classified and saved to listing_stats. */
  classified: number;
  /** Listings left out because none of their intervals is current. */
  withoutCurrentPrice: number;
}

interface CurrentOffer {
  storeSlug: StoreSlug;
  storeName: string;
  priceCents: number;
}

const LABEL_CODES: readonly LabelCode[] = Object.keys(LABEL_NAMES).filter(isLabelCode);

/**
 * Daily step after the collection: classifies every listing with a current price (core classify and
 * computeWindowStats) and replaces listing_stats with the label, warnings and the numbers behind them,
 * so a listing that is no longer classified loses its row.
 */
export async function runStats(db: Db, now: Date): Promise<StatsSummary> {
  const histories = await loadAllHistories(db);
  const offers = currentOffersByProduct(histories, now);
  const labels: Partial<Record<LabelCode, number>> = {};
  const rows: ListingStatsRow[] = [];
  for (const history of histories) {
    if (currentInterval(history) === undefined) {
      continue;
    }
    const classification = classify({
      intervals: history.intervals,
      now,
      cheapestOtherStore: cheapestOtherStore(history, offers),
    });
    labels[classification.label] = (labels[classification.label] ?? 0) + 1;
    rows.push(toStatsRow(history, classification, now));
  }
  await db.replaceListingStats(rows, now);
  return { labels, classified: rows.length, withoutCurrentPrice: histories.length - rows.length };
}

/** Summary for the terminal, in pt-PT, with every label in the methodology's order. */
export function formatStatsSummary(summary: StatsSummary): string {
  return [
    `Artigos classificados: ${summary.classified}`,
    `Sem preço atual (não classificados): ${summary.withoutCurrentPrice}`,
    "Por rótulo:",
    ...LABEL_CODES.map((code) => `  ${LABEL_NAMES[code]}: ${summary.labels[code] ?? 0}`),
  ].join("\n");
}

async function loadAllHistories(db: Db): Promise<PriceHistory[]> {
  const histories: PriceHistory[] = [];
  for await (const batch of db.loadPriceHistories()) {
    histories.push(...batch);
  }
  return histories;
}

function currentInterval(history: PriceHistory): PriceInterval | undefined {
  return currentIntervalOf(history.intervals);
}

/** Offers still on sale (core isCurrentOffer), keyed by product id. */
function currentOffersByProduct(histories: readonly PriceHistory[], now: Date): Map<number, CurrentOffer[]> {
  const offers = new Map<number, CurrentOffer[]>();
  for (const history of histories) {
    const current = currentInterval(history);
    if (
      history.productId === null ||
      current === undefined ||
      !isCurrentOffer(
        { inStock: current.inStock, missedRuns: history.missedRuns, lastSeenAt: history.lastSeenAt },
        now,
      )
    ) {
      continue;
    }
    const offer: CurrentOffer = {
      storeSlug: history.storeSlug,
      storeName: history.storeName,
      priceCents: current.priceCents,
    };
    const productOffers = offers.get(history.productId);
    if (productOffers === undefined) {
      offers.set(history.productId, [offer]);
    } else {
      productOffers.push(offer);
    }
  }
  return offers;
}

/** Lowest price on sale of the same product in another store; null for a listing without a product. */
function cheapestOtherStore(
  history: PriceHistory,
  offers: ReadonlyMap<number, readonly CurrentOffer[]>,
): OtherStoreOffer | null {
  if (history.productId === null) {
    return null;
  }
  let cheapest: CurrentOffer | null = null;
  for (const offer of offers.get(history.productId) ?? []) {
    if (
      offer.storeSlug !== history.storeSlug &&
      (cheapest === null || offer.priceCents < cheapest.priceCents)
    ) {
      cheapest = offer;
    }
  }
  return cheapest === null ? null : { storeName: cheapest.storeName, priceCents: cheapest.priceCents };
}

function toStatsRow(history: PriceHistory, classification: Classification, now: Date): ListingStatsRow {
  const stats = computeWindowStats(history.intervals, now);
  return {
    listingId: history.listingId,
    computedAt: now,
    currentPriceCents: stats.currentPriceCents,
    min30Cents: stats.min30Cents,
    min90Cents: stats.min90Cents,
    min180Cents: stats.min180Cents,
    med90Cents: stats.med90Cents,
    max90Cents: stats.max90Cents,
    label: classification.label,
    warnings: classification.warnings.map((warning) => warning.code),
    details: { ...classification },
    realDiscountPct: classification.numbers.realDiscountPct,
  };
}
