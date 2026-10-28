export interface StoreInfo {
  slug: string;
  name: string;
  baseUrl: string;
  /** false while the store blocks our bot (see docs/stores/<slug>.md). */
  active: boolean;
}

export const STORES = [
  { slug: "worten", name: "Worten", baseUrl: "https://www.worten.pt", active: false },
  { slug: "radiopopular", name: "Radio Popular", baseUrl: "https://www.radiopopular.pt", active: true },
  { slug: "darty", name: "Darty", baseUrl: "https://darty.pt", active: true },
  { slug: "fnac", name: "Fnac", baseUrl: "https://www.fnac.pt", active: false },
] as const satisfies readonly StoreInfo[];

export type StoreSlug = (typeof STORES)[number]["slug"];

export function isStoreSlug(value: string): value is StoreSlug {
  return STORES.some((store) => store.slug === value);
}

export function getStore(slug: StoreSlug): StoreInfo {
  const store = STORES.find((candidate) => candidate.slug === slug);
  if (!store) {
    throw new Error(`Unknown store: ${slug}`);
  }
  return store;
}
