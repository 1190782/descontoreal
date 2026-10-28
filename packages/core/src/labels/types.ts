import type { PriceInterval } from "../history";

/** Main label. The first six apply when the store announces a discount, the rest when it does not. */
export type LabelCode =
  | "historico_insuficiente"
  | "minimo_historico"
  | "desconto_real"
  | "subiu_antes_de_descer"
  | "desconto_pequeno"
  | "sem_desconto_real"
  | "bom_preco"
  | "acima_do_habitual"
  | "preco_habitual";

export type WarningCode = "desconto_anunciado_exagerado" | "mais_barato_noutra_loja" | "esgotado";

/** Colour family for the UI: green, amber or neutral. Labels always show text too. */
export type LabelTone = "positive" | "caution" | "neutral";

export interface OtherStoreOffer {
  storeName: string;
  priceCents: number;
}

export interface ClassifyInput {
  /** All intervals of one listing, any order; exactly one has validTo = null. */
  intervals: readonly PriceInterval[];
  now: Date;
  /** Cheapest current in-stock offer for the same product in another store, if any. */
  cheapestOtherStore?: OtherStoreOffer | null;
}

/** The numbers behind a label, stored in listing_stats so every label can be justified. */
export interface LabelNumbers {
  /** P */
  priceCents: number;
  /** R, only when it is above P. */
  referencePriceCents: number | null;
  /** Start of the current price, which a change of stock or reference price alone does not move. */
  currentSince: string;
  /** M30: lowest price in the 30 days before currentSince, current price excluded. */
  m30Cents: number | null;
  /** Med90: time-weighted median of the 90 days (or the available history) before currentSince. */
  med90Cents: number | null;
  /** Máx90: highest price in the 90 days before currentSince. */
  max90Cents: number | null;
  /** When the Máx90 price started, counted like currentSince (its latest run on ties). */
  max90Since: string | null;
  /** Days of history Med90/Máx90 actually cover (≤ 90). */
  windowDays: number;
  trackedSince: string;
  /** Calendar days in Lisbon from trackedSince to now: 28 Oct to 27 Nov is 30 at any hour. */
  historyDays: number;
  /** (R − P) / R × 100, unrounded (format with formatPercent). */
  announcedDiscountPct: number | null;
  /** (M30 − P) / M30 × 100 */
  realDiscountPct: number | null;
  /** (Med90 − P) / Med90 × 100; negative when P is above Med90. */
  belowMed90Pct: number | null;
}

export interface LabelWarning {
  code: WarningCode;
  text: string;
}

export interface Classification {
  label: LabelCode;
  /** "Desconto real", "Subiu antes de descer"… */
  labelName: string;
  /** The sentence the user reads, with numbers and dates in pt-PT. */
  text: string;
  tone: LabelTone;
  announcedDiscount: boolean;
  warnings: LabelWarning[];
  numbers: LabelNumbers;
}
