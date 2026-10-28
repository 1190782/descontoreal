import { LABELS_CONFIG } from "./labels/config";
import type { LabelCode, LabelNumbers } from "./labels/types";
import { formatCents, formatPercent } from "./money";
import { formatDatePt } from "./time";

/** A current offer with a label that matches its price, as the home page reads it from listing_stats. */
export interface HighlightCandidate {
  productSlug: string;
  productName: string;
  imageUrl: string | null;
  storeName: string;
  priceCents: number;
  label: LabelCode;
  /** The label's sentence (listing_stats.details.text). */
  labelText: string;
  numbers: LabelNumbers;
}

export interface Highlight extends HighlightCandidate {
  /** What the card says about the price. */
  text: string;
}

/**
 * "labels": offers with a real discount or an all-time low. "drops", until labels exist: offers well below their
 * usual price, described with numbers and dates only, never as a real discount.
 */
export interface Highlights {
  kind: "labels" | "drops";
  items: Highlight[];
}

const LABELLED: ReadonlySet<LabelCode> = new Set(["desconto_real", "minimo_historico"]);
const MED90_DAYS = 90;

/** A drop needs this many days behind its usual price before the home page shows it. */
export const MIN_DROP_WINDOW_DAYS = 7;

/**
 * The home page's highlights, one per product: the biggest real discounts once any listing has that label;
 * before that, the offers furthest below their usual price (Med90) with at least MIN_DROP_WINDOW_DAYS days of
 * history behind it and at least as far below it as "Bom preço" asks.
 */
export function pickHighlights(candidates: readonly HighlightCandidate[], limit: number): Highlights {
  const labelled = candidates.filter((candidate) => LABELLED.has(candidate.label));
  if (labelled.length > 0) {
    const items = onePerProduct(
      byDescending(labelled, (candidate) => candidate.numbers.realDiscountPct ?? 0),
    );
    return {
      kind: "labels",
      items: items.slice(0, limit).map((item) => ({ ...item, text: item.labelText })),
    };
  }
  const minDropPct = Math.round((1 - LABELS_CONFIG.goodPriceFactor) * 100);
  const drops = candidates.filter(
    (candidate) =>
      candidate.numbers.belowMed90Pct !== null &&
      candidate.numbers.belowMed90Pct >= minDropPct &&
      candidate.numbers.med90Cents !== null &&
      candidate.numbers.windowDays >= MIN_DROP_WINDOW_DAYS,
  );
  const items = onePerProduct(byDescending(drops, (candidate) => candidate.numbers.belowMed90Pct ?? 0));
  return { kind: "drops", items: items.slice(0, limit).map((item) => ({ ...item, text: dropText(item) })) };
}

/** "12% abaixo do preço habitual desde 28 de outubro de 2026 (509,99 €)." */
function dropText(candidate: HighlightCandidate): string {
  const { belowMed90Pct, med90Cents, windowDays, trackedSince } = candidate.numbers;
  const usual =
    windowDays < MED90_DAYS
      ? `do preço habitual desde ${formatDatePt(new Date(trackedSince))}`
      : `do preço habitual dos últimos ${MED90_DAYS} dias`;
  return `${formatPercent(belowMed90Pct ?? 0)} abaixo ${usual} (${formatCents(med90Cents ?? 0)}).`;
}

function byDescending(
  candidates: readonly HighlightCandidate[],
  value: (candidate: HighlightCandidate) => number,
): HighlightCandidate[] {
  return [...candidates].sort((a, b) => value(b) - value(a));
}

function onePerProduct(sorted: readonly HighlightCandidate[]): HighlightCandidate[] {
  const seen = new Set<string>();
  return sorted.filter((candidate) => {
    if (seen.has(candidate.productSlug)) {
      return false;
    }
    seen.add(candidate.productSlug);
    return true;
  });
}
