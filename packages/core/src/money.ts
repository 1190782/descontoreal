const EURO_FORMAT = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" });
const WHOLE_PERCENT_FORMAT = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 0 });
const SMALL_PERCENT_FORMAT = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });
const MINUS_SIGN = "−";
const MAX_INTEGER_DIGITS = 9;

/**
 * Reads a price as shown by Portuguese stores ("1.299,99 €", "449,99€", "449 €", "€ 12,50", "449,-")
 * and returns integer cents. Returns null when the text holds no price.
 */
export function parsePriceToCents(text: string): number | null {
  // \s also covers the no-break and thin spaces stores use as thousands separators.
  const match = /\d[\d.,\s]*/.exec(text);
  if (!match) {
    return null;
  }
  const compact = match[0].replace(/\s/g, "").replace(/[.,]+$/, "");
  // A separator followed by one or two final digits is the decimal mark; any other is a thousands mark.
  const decimal = /^(.*\d)[.,](\d{1,2})$/.exec(compact);
  const integerPart = (decimal?.[1] ?? compact).replace(/[.,]/g, "");
  const fractionPart = (decimal?.[2] ?? "").padEnd(2, "0");
  if (!/^\d+$/.test(integerPart) || integerPart.length > MAX_INTEGER_DIGITS) {
    return null;
  }
  return Number(integerPart) * 100 + Number(fractionPart);
}

/**
 * Converts a decimal value from a JSON API ("119.99", "119.9", "120", 119.99) into integer cents
 * without floating point drift. Returns null for empty or invalid values.
 */
export function decimalToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const text = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(2) : "") : value.trim();
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    return null;
  }
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

/** Formats cents as euros in pt-PT, e.g. 44999 → "449,99 €" (Intl.NumberFormat('pt-PT', EUR)). */
export function formatCents(cents: number): string {
  return EURO_FORMAT.format(cents / 100);
}

/** How much lower `toCents` is than `fromCents`, in percent: (from − to) / from × 100. */
export function percentBelow(fromCents: number, toCents: number): number {
  if (fromCents <= 0) {
    return 0;
  }
  return ((fromCents - toCents) / fromCents) * 100;
}

/**
 * Percentage for users in pt-PT: whole numbers, one decimal below 1, Unicode minus for negatives
 * ("12%", "0,4%", "−3%"). A value that rounds to zero is "0%", never "−0%".
 */
export function formatPercent(value: number): string {
  const magnitude = Math.abs(value);
  const digits = (magnitude < 1 ? SMALL_PERCENT_FORMAT : WHOLE_PERCENT_FORMAT).format(magnitude);
  const sign = value < 0 && digits !== "0" ? MINUS_SIGN : "";
  return `${sign}${digits}%`;
}

/** Like formatPercent, with "+" for increases ("+12%", "−3%", "0%"). */
export function formatSignedPercent(value: number): string {
  const text = formatPercent(value);
  return value > 0 && text !== "0%" ? `+${text}` : text;
}
