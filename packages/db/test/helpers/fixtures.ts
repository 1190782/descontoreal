import type { PGliteInterface } from "@electric-sql/pglite";
import type { ListingDetailsInput, MatchOutcome, ObservationInput } from "../../src/contract";

export const DAY_1 = new Date("2026-10-28T03:00:00.000Z");
export const DAY_2 = new Date("2026-10-29T03:00:00.000Z");
export const DAY_3 = new Date("2026-10-30T03:00:00.000Z");
export const DAY_4 = new Date("2026-10-31T03:00:00.000Z");
export const DAY_5 = new Date("2026-11-01T03:00:00.000Z");

const DAY_MS = 86_400_000;

/** `day` plus `days` runs of 24 hours, for more daily runs than DAY_1 to DAY_5. */
export function daysAfter(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

/** Valid EAN-13 codes (check digit included). */
export const EAN_A = "8806094932287";
export const EAN_B = "8720689065818";
export const EAN_C = "4006381333931";

export interface IngestRow {
  store_sku: string;
  listing_id: number;
  product_id: number | null;
  product_slug: string | null;
  status: string;
}

export interface IntervalRow {
  price_cents: number;
  reference_price_cents: number | null;
  rrp_cents: number | null;
  in_stock: boolean;
  valid_from: Date;
  valid_to: Date | null;
}

export interface ListingRow {
  id: number;
  store_sku: string;
  product_id: number | null;
  url: string;
  raw_title: string;
  raw_ean: string | null;
  sold_by_store: boolean;
  first_seen_at: Date;
  last_seen_at: Date;
  active: boolean;
  missed_runs: number;
  product_page_checked_at: Date | null;
  details: Record<string, unknown> | null;
}

export interface ProductRow {
  id: number;
  ean: string | null;
  brand: string | null;
  brand_norm: string | null;
  model: string | null;
  model_norm: string | null;
  name: string;
  slug: string;
  category_slug: string | null;
  image_url: string | null;
  specs: Record<string, string>;
}

export interface CandidateRow {
  id: number;
  candidate_product_id: number;
  confidence: number;
  status: string;
  reviewed_at: Date | null;
  reviewed_by: string | null;
}

export function observation(storeSku: string, overrides: Partial<ObservationInput> = {}): ObservationInput {
  return {
    storeSku,
    url: `https://darty.pt/products/${storeSku}`,
    rawTitle: `Produto ${storeSku}`,
    soldByStore: true,
    priceCents: 49_999,
    referencePriceCents: null,
    inStock: true,
    ...overrides,
  };
}

export function listingDetails(
  listingId: number,
  overrides: Partial<ListingDetailsInput> = {},
): ListingDetailsInput {
  return {
    listingId,
    rawEan: null,
    ean: null,
    brand: "Samsung",
    model: "WW90T534DAE",
    brandNorm: "samsung",
    modelNorm: "WW90T534DAE",
    name: "Samsung WW90T534DAE",
    slugBase: "samsung-ww90t534dae-maquina-de-lavar-roupa",
    categorySlug: "maquinas-de-lavar-roupa",
    imageUrl: "https://darty.pt/cdn/ww90t534dae.jpg",
    specs: { Capacidade: "9 kg" },
    soldByStore: true,
    ...overrides,
  };
}

export async function ingest(
  db: PGliteInterface,
  storeSlug: string,
  observedAt: Date,
  items: readonly ObservationInput[],
): Promise<IngestRow[]> {
  const result = await db.query<IngestRow>("select * from ingest_observations($1, $2, $3::text::jsonb)", [
    storeSlug,
    observedAt,
    JSON.stringify(items),
  ]);
  return result.rows;
}

/** Ingests one sold-by-store observation and returns the listing id. */
export async function createListing(
  db: PGliteInterface,
  storeSku: string,
  options: { storeSlug?: string; observedAt?: Date } = {},
): Promise<number> {
  const [row] = await ingest(db, options.storeSlug ?? "darty", options.observedAt ?? DAY_1, [
    observation(storeSku),
  ]);
  if (!row) {
    throw new Error("ingest_observations returned no row");
  }
  return row.listing_id;
}

export async function saveDetails(
  db: PGliteInterface,
  input: ListingDetailsInput,
  checkedAt: Date | null = DAY_1,
): Promise<MatchOutcome> {
  const result = await db.query<{ outcome: MatchOutcome }>(
    "select save_listing_details($1::text::jsonb, $2) as outcome",
    [JSON.stringify(input), checkedAt],
  );
  const outcome = result.rows[0]?.outcome;
  if (!outcome) {
    throw new Error("save_listing_details returned nothing");
  }
  return outcome;
}

export async function intervals(db: PGliteInterface, listingId: number): Promise<IntervalRow[]> {
  const result = await db.query<IntervalRow>(
    `select price_cents, reference_price_cents, rrp_cents, in_stock, valid_from, valid_to
     from price_points where listing_id = $1 order by valid_from`,
    [listingId],
  );
  return result.rows;
}

export async function getListing(db: PGliteInterface, listingId: number): Promise<ListingRow> {
  const result = await db.query<ListingRow>("select * from listings where id = $1", [listingId]);
  const row = result.rows[0];
  if (!row) {
    throw new Error(`listing ${listingId} not found`);
  }
  return row;
}

export async function getProducts(db: PGliteInterface): Promise<ProductRow[]> {
  const result = await db.query<ProductRow>(
    `select p.id, p.ean, p.brand, p.brand_norm, p.model, p.model_norm, p.name, p.slug, c.slug as category_slug,
            p.image_url, p.specs
     from products p left join categories c on c.id = p.category_id
     order by p.id`,
  );
  return result.rows;
}

export async function getProduct(db: PGliteInterface, productId: number | null): Promise<ProductRow> {
  const product = (await getProducts(db)).find((candidate) => candidate.id === productId);
  if (!product) {
    throw new Error(`product ${productId} not found`);
  }
  return product;
}

/** Inserts a product directly, as if another store's listing had created it earlier. */
export async function insertProduct(
  db: PGliteInterface,
  product: {
    name: string;
    slug: string;
    ean?: string | null;
    brandNorm?: string | null;
    modelNorm?: string | null;
    categorySlug?: string | null;
  },
): Promise<number> {
  const result = await db.query<{ id: number }>(
    `insert into products (name, slug, ean, brand_norm, model_norm, category_id)
     values ($1, $2, $3, $4, $5, (select id from categories where slug = $6))
     returning id`,
    [
      product.name,
      product.slug,
      product.ean ?? null,
      product.brandNorm ?? null,
      product.modelNorm ?? null,
      product.categorySlug ?? null,
    ],
  );
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("product insert returned no id");
  }
  return id;
}

export async function getCandidates(db: PGliteInterface, listingId: number): Promise<CandidateRow[]> {
  const result = await db.query<CandidateRow>(
    `select id, candidate_product_id, confidence, status, reviewed_at, reviewed_by
     from match_candidates where listing_id = $1 order by confidence desc, candidate_product_id`,
    [listingId],
  );
  return result.rows;
}
