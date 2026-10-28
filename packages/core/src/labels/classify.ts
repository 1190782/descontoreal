import { timeWeightedMedian, type PriceInterval } from "../history";
import {
  daysBefore,
  findCurrentInterval,
  firstOfSamePrice,
  highestIntervalIn,
  lowestPriceIn,
  sortByValidFrom,
} from "../intervals";
import { formatCents, formatPercent, formatSignedPercent, percentBelow } from "../money";
import { calendarDaysBetween, daysBetween, formatDatePt } from "../time";
import { LABELS_CONFIG, type LabelsConfig } from "./config";
import { LABEL_NAMES, LABEL_TONES } from "./names";
import type {
  Classification,
  ClassifyInput,
  LabelCode,
  LabelNumbers,
  LabelWarning,
  OtherStoreOffer,
} from "./types";

const M30_DAYS = 30;
const MED90_DAYS = 90;
// Thresholds are compared on integers scaled by this, so a price exactly on a threshold qualifies
// (in floating point 50000 × 1.1 is 55000.00000000001).
const SCALE = 1_000_000;

/** What the rules compare. Every window ends at S, the start of the current price. */
interface PriceFacts {
  current: PriceInterval;
  /** S, which a change of stock or reference price alone does not move. */
  currentSince: Date;
  /** P */
  price: number;
  /** Price of the interval just before S; null when P is the first price we saw. */
  previousPrice: number | null;
  /** R, only when it is above P. */
  reference: number | null;
  m30: number | null;
  med90: number | null;
  /** First interval of the latest run at the Máx90 price. */
  max90: PriceInterval | null;
  /** The price before that run was lower, so we saw it go up. */
  max90WasRise: boolean;
  /** Lowest price over the whole history before S. */
  lowestBefore: number | null;
  trackedSince: Date;
  /** Calendar days in Lisbon from trackedSince to now; the windows above stay in elapsed time. */
  historyDays: number;
  /** Start of the Med90 window: S − 90 days, or trackedSince when the history is shorter. */
  usualSince: Date;
  usualWindowIsShort: boolean;
}

interface LabelChoice {
  label: LabelCode;
  text: string;
}

/**
 * Classifies one listing in one store: main label, warnings and the numbers that justify them.
 * Pure function; rules and texts follow docs/PLANO.md, "Rótulos de desconto".
 * Throws unless exactly one interval is current (validTo = null).
 */
export function classify(input: ClassifyInput, config: LabelsConfig = LABELS_CONFIG): Classification {
  const facts = readFacts(input);
  const { label, text } = chooseLabel(facts, config);
  return {
    label,
    labelName: LABEL_NAMES[label],
    text,
    tone: LABEL_TONES[label],
    announcedDiscount: facts.reference !== null,
    warnings: collectWarnings(facts, input.cheapestOtherStore ?? null, config),
    numbers: toNumbers(facts),
  };
}

function readFacts(input: ClassifyInput): PriceFacts {
  const intervals = sortByValidFrom(input.intervals);
  const current = findCurrentInterval(intervals);
  const firstOfCurrent = firstOfSamePrice(intervals, current);
  const start = firstOfCurrent.validFrom;
  const previous = intervals[intervals.indexOf(firstOfCurrent) - 1];
  const price = current.priceCents;
  const trackedSince = (intervals[0] ?? current).validFrom;
  const ninetyDaysBefore = daysBefore(start, MED90_DAYS);
  const usualWindowIsShort = trackedSince.getTime() > ninetyDaysBefore.getTime();
  const usualSince = usualWindowIsShort ? trackedSince : ninetyDaysBefore;
  const highest = highestIntervalIn(intervals, ninetyDaysBefore, start);
  const max90 = highest === null ? null : firstOfSamePrice(intervals, highest);
  const beforeMax90 = max90 === null ? undefined : intervals[intervals.indexOf(max90) - 1];
  const reference = current.referencePriceCents;
  return {
    current,
    currentSince: start,
    price,
    previousPrice: previous?.priceCents ?? null,
    reference: reference !== null && reference > price ? reference : null,
    m30: lowestPriceIn(intervals, daysBefore(start, M30_DAYS), start),
    med90: timeWeightedMedian(intervals, usualSince, start),
    max90,
    max90WasRise: max90 !== null && beforeMax90 !== undefined && beforeMax90.priceCents < max90.priceCents,
    lowestBefore: lowestPriceIn(intervals, trackedSince, start),
    trackedSince,
    historyDays: calendarDaysBetween(trackedSince, input.now),
    usualSince,
    usualWindowIsShort,
  };
}

function chooseLabel(facts: PriceFacts, config: LabelsConfig): LabelChoice {
  const trackedSince = formatDatePt(facts.trackedSince);
  if (facts.historyDays < config.minHistoryDays) {
    const text = `Seguimos este preço desde ${trackedSince}.`;
    return {
      label: "historico_insuficiente",
      text: facts.reference === null ? text : `${text} Ainda não há dados para avaliar o desconto.`,
    };
  }
  if (
    facts.historyDays >= config.allTimeLowMinHistoryDays &&
    facts.lowestBefore !== null &&
    facts.price < facts.lowestBefore
  ) {
    return {
      label: "minimo_historico",
      text: `O preço mais baixo desde que seguimos este produto (${facts.historyDays} dias).`,
    };
  }
  const usualPrice = facts.usualWindowIsShort
    ? `preço habitual desde ${trackedSince}`
    : "preço habitual dos últimos 90 dias";
  return facts.reference === null
    ? chooseWithoutDiscount(facts, config, usualPrice)
    : chooseWithDiscount(facts, config, usualPrice);
}

function chooseWithDiscount(facts: PriceFacts, config: LabelsConfig, usualPrice: string): LabelChoice {
  const { price, previousPrice, m30, med90, max90 } = facts;
  if (
    m30 !== null &&
    med90 !== null &&
    isAtMost(price, m30, config.realDiscountFactor) &&
    isAtMost(price, med90, config.realDiscountFactor)
  ) {
    // The smaller of the two discounts keeps the sentence true for both references.
    const percent = Math.min(percentBelow(m30, price), percentBelow(med90, price));
    return {
      label: "desconto_real",
      text: `${formatPercent(percent)} abaixo do preço mais baixo dos 30 dias anteriores e do ${usualPrice}.`,
    };
  }
  if (
    med90 !== null &&
    max90 !== null &&
    isAtLeast(price, med90, config.raisedNearUsualFactor) &&
    isAtMost(price, med90, config.aboveUsualFactor) &&
    price < max90.priceCents &&
    isAtLeast(max90.priceCents, med90, config.raisedPeakFactor) &&
    // The text says the price "desceu agora": it must be below the price just before it.
    previousPrice !== null &&
    price < previousPrice
  ) {
    // "Subiu" only when the price before the peak was lower. If the peak is the first price we saw, or the
    // price came down to it, we never saw a rise, so the text says it "esteve" there.
    const change = facts.max90WasRise ? "subiu para" : "esteve em";
    const peak = formatCents(max90.priceCents);
    return {
      label: "subiu_antes_de_descer",
      text: `O preço ${change} ${peak} a ${formatDatePt(max90.validFrom)} e desceu agora para ${formatCents(price)}, perto do preço habitual.`,
    };
  }
  if (m30 !== null && med90 !== null && price < m30 && price < med90) {
    return {
      label: "desconto_pequeno",
      text: `Só ${formatPercent(percentBelow(m30, price))} abaixo do preço mais baixo dos 30 dias anteriores.`,
    };
  }
  return { label: "sem_desconto_real", text: noRealDiscountText(facts) };
}

function chooseWithoutDiscount(facts: PriceFacts, config: LabelsConfig, usualPrice: string): LabelChoice {
  const { price, med90 } = facts;
  if (med90 === null) {
    return { label: "preco_habitual", text: samePriceText(facts) };
  }
  if (isAtMost(price, med90, config.goodPriceFactor)) {
    return {
      label: "bom_preco",
      text: `${formatPercent(percentBelow(med90, price))} abaixo do ${usualPrice}.`,
    };
  }
  if (isAtLeast(price, med90, config.aboveUsualFactor)) {
    return {
      label: "acima_do_habitual",
      text: `${formatPercent(-percentBelow(med90, price))} acima do ${usualPrice}.`,
    };
  }
  return { label: "preco_habitual", text: `Perto do ${usualPrice}.` };
}

function noRealDiscountText(facts: PriceFacts): string {
  const references = [
    facts.m30 === null ? null : `ao preço mais baixo dos 30 dias anteriores (${formatCents(facts.m30)})`,
    facts.med90 === null ? null : `ao preço habitual (${formatCents(facts.med90)})`,
  ].filter((reference) => reference !== null);
  return references.length === 0
    ? samePriceText(facts)
    : `Sem descida relevante face ${references.join(" e ")}.`;
}

function samePriceText(facts: PriceFacts): string {
  return `O preço é o mesmo desde ${formatDatePt(facts.currentSince)}.`;
}

function collectWarnings(
  facts: PriceFacts,
  otherStore: OtherStoreOffer | null,
  config: LabelsConfig,
): LabelWarning[] {
  const { price, reference, m30 } = facts;
  const warnings: LabelWarning[] = [];
  if (
    reference !== null &&
    m30 !== null &&
    announcedExceedsReal(price, reference, m30, config.exaggeratedDiscountPoints)
  ) {
    const announced = formatSignedPercent(-percentBelow(reference, price));
    const real = formatSignedPercent(-percentBelow(m30, price));
    warnings.push({
      code: "desconto_anunciado_exagerado",
      text: `Anunciado ${announced} · Face aos 30 dias anteriores: ${real}`,
    });
  }
  if (otherStore !== null && isAtMost(otherStore.priceCents, price, config.cheaperElsewhereFactor)) {
    warnings.push({
      code: "mais_barato_noutra_loja",
      text: `${otherStore.storeName} tem este produto a ${formatCents(otherStore.priceCents)}.`,
    });
  }
  if (!facts.current.inStock) {
    warnings.push({ code: "esgotado", text: "Indisponível nesta loja." });
  }
  return warnings;
}

function toNumbers(facts: PriceFacts): LabelNumbers {
  const { price, reference, m30, med90, max90 } = facts;
  return {
    priceCents: price,
    referencePriceCents: reference,
    currentSince: facts.currentSince.toISOString(),
    m30Cents: m30,
    med90Cents: med90,
    max90Cents: max90?.priceCents ?? null,
    max90Since: max90?.validFrom.toISOString() ?? null,
    windowDays: daysBetween(facts.usualSince, facts.currentSince),
    trackedSince: facts.trackedSince.toISOString(),
    historyDays: facts.historyDays,
    announcedDiscountPct: reference === null ? null : percentBelow(reference, price),
    realDiscountPct: m30 === null ? null : percentBelow(m30, price),
    belowMed90Pct: med90 === null ? null : percentBelow(med90, price),
  };
}

/** value ≤ base × factor, exact for whole cents. */
function isAtMost(value: number, base: number, factor: number): boolean {
  return value * SCALE <= base * Math.round(factor * SCALE);
}

/** value ≥ base × factor, exact for whole cents. */
function isAtLeast(value: number, base: number, factor: number): boolean {
  return value * SCALE >= base * Math.round(factor * SCALE);
}

/**
 * Announced % − real % > points, i.e. (R − P) / R − (M30 − P) / M30 > points / 100, rewritten as
 * 100·P·(R − M30) > points·R·M30. BigInt keeps it exact where the products pass 2^53.
 */
function announcedExceedsReal(price: number, reference: number, m30: number, points: number): boolean {
  const left = 100n * BigInt(SCALE) * BigInt(price) * BigInt(reference - m30);
  const right = BigInt(Math.round(points * SCALE)) * BigInt(reference) * BigInt(m30);
  return left > right;
}
