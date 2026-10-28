import { normalizeGtin } from "./gtin";
import { normalizeModel } from "./normalize";
import { parseStoreUrl } from "./store-urls";
import type { StoreSlug } from "./stores";

/** What the search box was given. */
export type SearchQuery =
  | { kind: "empty" }
  /** A product page of a store we collect: look up listings.url. */
  | { kind: "store-url"; storeSlug: StoreSlug; url: string }
  | { kind: "inactive-store"; storeSlug: StoreSlug }
  /** An address that is not a product page of a store we know. */
  | { kind: "other-url" }
  | { kind: "ean"; ean: string }
  /** Words to match against product names, and the words that look like model codes, normalized. */
  | { kind: "text"; text: string; models: string[] };

export const MAX_QUERY_LENGTH = 200;

const MIN_MODEL_LENGTH = 4;

/** Classifies a search: pasted store address, EAN, or words (with any model codes among them). */
export function parseSearchQuery(raw: string): SearchQuery {
  const text = raw.trim().replace(/\s+/g, " ").slice(0, MAX_QUERY_LENGTH);
  if (text === "") {
    return { kind: "empty" };
  }
  if (/^(?:https?:\/\/)?[\w-]+(?:\.[\w-]+)+\/\S/i.test(text)) {
    const pasted = parseStoreUrl(text);
    if (pasted === null) {
      return { kind: "other-url" };
    }
    return pasted.kind === "listing"
      ? { kind: "store-url", storeSlug: pasted.storeSlug, url: pasted.url }
      : { kind: "inactive-store", storeSlug: pasted.storeSlug };
  }
  if (/^[\d\s-]{8,20}$/.test(text)) {
    const ean = normalizeGtin(text);
    if (ean !== null) {
      return { kind: "ean", ean };
    }
  }
  const models = text
    .split(" ")
    .filter((word) => /\d/.test(word) && /[a-z]/i.test(word))
    .map((word) => normalizeModel(word))
    .filter((model): model is string => model !== null && model.length >= MIN_MODEL_LENGTH);
  return { kind: "text", text, models: [...new Set(models)] };
}
