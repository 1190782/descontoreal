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
