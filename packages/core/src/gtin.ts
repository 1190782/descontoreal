// GS1 restricted-circulation prefixes (store-internal codes) in the 13-digit form. An EAN-8 pads to
// "00000" + its 8 digits, so "00000[02]" catches EAN-8 codes starting with 0 or 2 in any length.
const RESTRICTED_PREFIX = /^(?:02\d|04\d|2\d\d|00000[02])/;

/**
 * Validates and normalizes a barcode to a 13-digit GTIN (EAN-13).
 * Accepts EAN-13, UPC-A (12), EAN-8 and GTIN-14 with spaces or hyphens; checks the check digit;
 * left-pads or strips leading zeros to 13 digits. Returns null when invalid, all zeros, or a
 * restricted-circulation (store-internal) number (GS1 prefixes 020–029, 040–049, 200–299, and
 * EAN-8 codes starting with 0 or 2), because those codes do not identify the same product across stores.
 */
export function normalizeGtin(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }
  const digits = raw.trim().replace(/[\s-]/g, "");
  if (!hasValidCheckDigit(digits)) {
    return null;
  }
  // A GTIN-14 with a leading indicator digit other than 0 identifies a case, not a consumer unit.
  const gtin13 =
    digits.length === 14 ? (digits.startsWith("0") ? digits.slice(1) : null) : digits.padStart(13, "0");
  if (gtin13 === null || RESTRICTED_PREFIX.test(gtin13)) {
    return null;
  }
  return gtin13;
}

/** True when `code` (digits only, 8, 12, 13 or 14 long) has a valid GS1 check digit. */
export function hasValidCheckDigit(code: string): boolean {
  if (!/^(?:\d{8}|\d{12,14})$/.test(code)) {
    return false;
  }
  const digits = [...code].map(Number);
  const checkDigit = digits.pop();
  // Weights alternate 3, 1, 3… starting from the digit next to the check digit.
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === checkDigit;
}
