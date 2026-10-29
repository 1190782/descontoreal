import type {
  CategorySlug,
  HighlightCandidate,
  LabelCode,
  LabelNumbers,
  LabelTone,
  LabelWarning,
  ListingHistory,
  StoreSlug,
} from "@descontoreal/core";

/** A listing's label, from listing_stats, when it was computed for the listing's current price. */
export interface ListingLabel {
  code: LabelCode;
  name: string;
  tone: LabelTone;
  /** The sentence the user reads. */
  text: string;
  warnings: LabelWarning[];
  numbers: LabelNumbers;
}

/** A listing of the product page: history for the chart, and what the table of stores shows. */
export interface PageListing extends ListingHistory {
  url: string;
  active: boolean;
  /** null while the label was computed for another price (the price changed after the last `pnpm stats`). */
  label: ListingLabel | null;
}

export interface PageCategory {
  slug: CategorySlug;
  name: string;
  parent: { slug: CategorySlug; name: string } | null;
}

export interface ProductPage {
  id: number;
  slug: string;
  name: string;
  brand: string | null;
  brandNorm: string | null;
  model: string | null;
  ean: string | null;
  imageUrl: string | null;
  specs: Record<string, string>;
  category: PageCategory | null;
  /** Listings sold by the store, active or not, by store name. */
  listings: PageListing[];
}

export interface CardLabel {
  code: LabelCode;
  name: string;
  tone: LabelTone;
  text: string;
}

/** A product in a list: its best price (cheapest current offer, else cheapest current price) and that listing's label. */
export interface ProductCard {
  productId: number;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  storeName: string;
  priceCents: number;
  /** In stock and read by the last run (core isCurrentOffer); false shows the price as unavailable. */
  onSale: boolean;
  /** Stores with a current price for the product. */
  storeCount: number;
  label: CardLabel | null;
  /** Of the listing shown, when its label is current. */
  realDiscountPct: number | null;
}

export interface ProductList {
  total: number;
  items: ProductCard[];
}

export interface FacetOption<Value extends string> {
  value: Value;
  name: string;
  count: number;
}

/** What a list can be filtered by, counted over the list without filters. */
export interface ListFacets {
  brands: FacetOption<string>[];
  stores: FacetOption<StoreSlug>[];
  labels: FacetOption<LabelCode>[];
}

export interface StoreStatus {
  slug: StoreSlug;
  name: string;
  /** Last reading with a price of any of its listings; null before the first. */
  lastSeenAt: Date | null;
  /** Active listings with a current price. */
  listings: number;
}

export interface HomeData {
  stores: StoreStatus[];
  /** Products with a current price in at least one store. */
  productCount: number;
  /** For core pickHighlights. */
  highlightCandidates: HighlightCandidate[];
  /** A product on sale whose price changed, for the example chart; null when none did. */
  exampleSlug: string | null;
}

export interface SitemapProduct {
  slug: string;
  firstPriceAt: Date;
  lastChangeAt: Date;
  /** Stores with a current price. */
  storeCount: number;
}

export interface SitemapBrand {
  brandNorm: string;
  name: string;
  products: number;
}

export interface CategoryCount {
  slug: CategorySlug;
  /** Products with a current price, in the category itself (not its children). */
  products: number;
}

/** A store listing waiting for review, as admin_review_queue() (0004_admin_review.sql) shows it. */
export interface ReviewListing {
  id: number;
  storeName: string;
  sku: string;
  title: string;
  url: string;
  imageUrl: string | null;
  ean: string | null;
  brand: string | null;
  model: string | null;
  /** null when the listing has no current price. */
  priceCents: number | null;
  inStock: boolean | null;
}

/** A product the listing may be: its cheapest current price and the stores that already list it. */
export interface ReviewProduct {
  id: number;
  slug: string;
  name: string;
  imageUrl: string | null;
  ean: string | null;
  brand: string | null;
  model: string | null;
  priceCents: number | null;
  stores: string[];
}

export interface ReviewCandidate {
  candidateId: number;
  /** Similarity of the two names (pg_trgm), 0 to 1. */
  confidence: number;
  listing: ReviewListing;
  product: ReviewProduct;
}

export interface SameStoreListing {
  id: number;
  sku: string;
  title: string;
  url: string;
  ean: string | null;
  priceCents: number | null;
  /** False without product page facts, and for the listing whose EAN is the product's. */
  canSplit: boolean;
}

/** Listings of one store on one product: right when they share the product's EAN, otherwise linked before 0003. */
export interface SameStoreGroup {
  productId: number;
  slug: string;
  name: string;
  ean: string | null;
  storeName: string;
  sharesEan: boolean;
  listings: SameStoreListing[];
}

export interface ReviewQueue {
  /** Every pending candidate; `candidates` holds the best 100. */
  candidateCount: number;
  candidates: ReviewCandidate[];
  sameStore: SameStoreGroup[];
}

/** What approving, rejecting or splitting returns: the product pages to render again. */
export interface ReviewOutcome {
  slugs: string[];
}
