import type { StoreSlug } from "@descontoreal/core";

/**
 * A fixed colour per store for the price chart, never cycled, from the dataviz reference palette (slots 1–4). The
 * first three pass every check of its validator on white, all pairs; the third is under 3:1 contrast, which the
 * chart makes up for with direct labels and the table of prices.
 */
export const STORE_COLORS: Readonly<Record<StoreSlug, string>> = {
  darty: "#2a78d6",
  radiopopular: "#eb6834",
  worten: "#1baf7a",
  fnac: "#eda100",
};
