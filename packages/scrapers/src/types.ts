import type { CategorySlug, StoreSlug } from "@descontoreal/core";

/** A store category to crawl, mapped to one of our categories. Lives in the store's config file. */
export interface StoreCategory {
  /** Stable key for `pnpm scrape --category <key>`. */
  key: string;
  categorySlug: CategorySlug;
  /** Absolute URL of the first listing page. */
  url: string;
}

/** An item as read from a listing page. Prices in integer cents. */
export interface ListingObservation {
  storeSku: string;
  /** Absolute product URL. */
  url: string;
  title: string;
  priceCents: number;
  /** Struck-through price shown by the store; null when absent or not above priceCents. */
  referencePriceCents: number | null;
  /** Manufacturer's recommended price (PVPr) shown next to the price. Information only, never a reference price. */
  rrpCents?: number | null;
  inStock: boolean;
  /** Seller shown on the listing; null when the listing does not say. */
  sellerName: string | null;
  /** Facts some stores already expose on listing pages. */
  ean?: string | null;
  brand?: string | null;
  model?: string | null;
  imageUrl?: string | null;
}

export interface ListingPage {
  items: ListingObservation[];
  /** Absolute URL of the next listing page; null on the last page. */
  nextPageUrl: string | null;
}

/** Facts read from a product page. Only facts: never descriptions. */
export interface ProductDetails {
  storeSku: string;
  url: string;
  title: string;
  /** As shown by the store; the runner validates it with core normalizeGtin(). */
  ean: string | null;
  brand: string | null;
  model: string | null;
  imageUrl: string | null;
  /** Technical specifications, label → value. */
  specs: Record<string, string>;
  sellerName: string | null;
  priceCents: number | null;
  referencePriceCents: number | null;
  /** Manufacturer's recommended price (PVPr); information only. */
  rrpCents?: number | null;
  inStock: boolean | null;
}

/**
 * One implementation per store in src/stores/<slug>.ts. Scrapers never fetch: the runner does every
 * request (robots.txt, pacing, retries) and hands the decoded body to the parse methods.
 */
export interface StoreScraper {
  readonly slug: StoreSlug;
  readonly name: string;
  /** Origin for robots.txt and relative URLs, e.g. "https://darty.pt". */
  readonly baseUrl: string;
  /** Extra request headers, e.g. { Accept: "application/json" }. */
  readonly requestHeaders?: Readonly<Record<string, string>>;
  /**
   * true when listing prices are not selling prices (Darty's listing only has the base price): every run
   * reads the product page of each kept item and records its price, reference price, PVPr and stock.
   */
  readonly pricesFromProductPage?: boolean;
  /**
   * Complete runs in a row an item may be missing before it is deactivated (default 3). Higher for stores whose
   * listings cannot be read exhaustively, where an item can drop out of the pages read for a day or two. Never
   * below 2: an item seen without a price ends a complete run with one missed run.
   */
  readonly maxMissedRuns?: number;
  /** Categories from the store's config file (src/stores/<slug>.config.ts). */
  listCategories(): StoreCategory[] | Promise<StoreCategory[]>;
  parseListingPage(body: string, url: string, category: StoreCategory): ListingPage;
  /** URL that parseProductPage reads for an item; defaults to item.url. */
  productPageUrl?(item: { storeSku: string; url: string }): string;
  parseProductPage(body: string, url: string): ProductDetails;
  /** true when the store itself sells the item, false for marketplace sellers, null when the data does not say. */
  isSoldByStore(item: ListingObservation | ProductDetails): boolean | null;
}
