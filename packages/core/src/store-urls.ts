import { STORES, type StoreSlug } from "./stores";

/** A product address pasted from a store's site. */
export type PastedStoreUrl =
  /** `url` is written as listings.url stores it, without the query string. */
  | { kind: "listing"; storeSlug: StoreSlug; url: string }
  /** A store we do not collect (it blocks our bot). */
  | { kind: "inactive-store"; storeSlug: StoreSlug };

/** Product page paths of the stores we collect; the first group is the part listings.url keeps. */
const PRODUCT_PATHS: Partial<Record<StoreSlug, { pattern: RegExp; path: (key: string) => string }>> = {
  // Shopify also serves products under a collection: /collections/tvs/products/<handle>.
  darty: {
    pattern: /^(?:\/collections\/[^/]+)?\/products\/([^/]+)$/,
    path: (handle) => `/products/${handle.toLowerCase()}`,
  },
  radiopopular: { pattern: /^\/produto\/([^/]+)$/, path: (slug) => `/produto/${slug}` },
};

/**
 * Reads an address pasted into the search box, with or without https:// and www., query string or trailing slash.
 * Returns the listing address to look up, "inactive-store" for a store we do not collect, and null for anything that
 * is not a product page of a store we know.
 */
export function parseStoreUrl(input: string): PastedStoreUrl | null {
  const text = input.trim();
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const store = STORES.find(
    (candidate) => bareHost(new URL(candidate.baseUrl).hostname) === bareHost(url.hostname),
  );
  if (store === undefined) {
    return null;
  }
  if (!store.active) {
    return { kind: "inactive-store", storeSlug: store.slug };
  }
  const product = PRODUCT_PATHS[store.slug];
  const key = product?.pattern.exec(url.pathname.replace(/\/+$/, ""))?.[1];
  if (product === undefined || key === undefined) {
    return null;
  }
  return { kind: "listing", storeSlug: store.slug, url: `${store.baseUrl}${product.path(key)}` };
}

function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}
