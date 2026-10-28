import type { StoreSlug } from "@descontoreal/core";
import type { StoreScraper } from "../types";
import { darty } from "./darty";
import { radiopopular } from "./radiopopular";

/** Stores we collect from. Worten and Fnac block our bot (docs/stores/worten.md, docs/stores/fnac.md). */
export const SCRAPERS: Partial<Record<StoreSlug, StoreScraper>> = {
  darty,
  radiopopular,
};
