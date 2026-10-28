import { LABEL_NAMES, LABEL_TONES, type LabelCode, type LabelNumbers } from "@descontoreal/core";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import type { SqlParam } from "../../src/executor";
import type { Query } from "../../src/web";
import { asRole } from "../helpers/database";

/** "Now" of the site in these tests, and the last reading of the listings on sale. */
export const NOW = new Date("2026-11-20T10:00:00Z");
export const SEEN = new Date("2026-11-20T04:30:00Z");

/** Runs `work` with a Query as the site's role runs it: anon's grants and row level security. */
export async function asSite<T>(db: PGlite, work: (query: Query) => Promise<T>): Promise<T> {
  return await asRole(db, "anon", null, async (tx) => {
    const query: Query = async <Row extends object>(text: string, params: readonly SqlParam[] = []) =>
      (await tx.query<Row>(text, [...params])).rows;
    return await work(query);
  });
}

export async function addProduct(
  db: PGliteInterface,
  product: {
    slug: string;
    name: string;
    brand?: string | null;
    brandNorm?: string | null;
    model?: string | null;
    modelNorm?: string | null;
    ean?: string | null;
    categorySlug?: string | null;
    imageUrl?: string | null;
    specs?: Record<string, string>;
  },
): Promise<number> {
  const result = await db.query<{ id: number }>(
    `insert into products (slug, name, brand, brand_norm, model, model_norm, ean, category_id, image_url, specs)
     values ($1, $2, $3, $4, $5, $6, $7, (select id from categories where slug = $8), $9, $10::text::jsonb)
     returning id`,
    [
      product.slug,
      product.name,
      product.brand ?? null,
      product.brandNorm ?? null,
      product.model ?? null,
      product.modelNorm ?? null,
      product.ean ?? null,
      product.categorySlug ?? null,
      product.imageUrl ?? null,
      JSON.stringify(product.specs ?? {}),
    ],
  );
  return firstId(result.rows);
}

export async function addListing(
  db: PGliteInterface,
  listing: {
    productId: number | null;
    storeSlug: string;
    sku: string;
    url?: string;
    soldByStore?: boolean;
    active?: boolean;
    missedRuns?: number;
    lastSeenAt?: Date;
  },
): Promise<number> {
  const result = await db.query<{ id: number }>(
    `insert into listings (store_id, store_sku, product_id, url, raw_title, sold_by_store, first_seen_at, last_seen_at,
                           active, missed_runs)
     values ((select id from stores where slug = $1), $2, $3, $4, $2, $5, $6, $7, $8, $9)
     returning id`,
    [
      listing.storeSlug,
      listing.sku,
      listing.productId,
      listing.url ?? `https://example.pt/${listing.sku}`,
      listing.soldByStore ?? true,
      new Date("2026-10-28T03:00:00Z"),
      listing.lastSeenAt ?? SEEN,
      listing.active ?? true,
      listing.missedRuns ?? 0,
    ],
  );
  return firstId(result.rows);
}

export async function addPrice(
  db: PGliteInterface,
  listingId: number,
  price: {
    cents: number;
    from: string;
    to?: string | null;
    inStock?: boolean;
    referenceCents?: number | null;
  },
): Promise<void> {
  await db.query(
    `insert into price_points (listing_id, price_cents, reference_price_cents, in_stock, valid_from, valid_to)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      listingId,
      price.cents,
      price.referenceCents ?? null,
      price.inStock ?? true,
      new Date(price.from),
      price.to === undefined || price.to === null ? null : new Date(price.to),
    ],
  );
}

/** A listing_stats row as `pnpm stats` writes it, computed for `priceCents`. */
export async function addStats(
  db: PGliteInterface,
  listingId: number,
  stats: { label: LabelCode; priceCents: number; numbers?: Partial<LabelNumbers> },
): Promise<void> {
  const numbers: LabelNumbers = {
    priceCents: stats.priceCents,
    referencePriceCents: null,
    currentSince: "2026-11-05T04:00:00.000Z",
    m30Cents: null,
    med90Cents: null,
    max90Cents: null,
    max90Since: null,
    windowDays: 8,
    trackedSince: "2026-10-28T04:00:00.000Z",
    historyDays: 23,
    announcedDiscountPct: null,
    realDiscountPct: null,
    belowMed90Pct: null,
    ...stats.numbers,
  };
  const details = {
    label: stats.label,
    labelName: LABEL_NAMES[stats.label],
    text: `Texto de ${LABEL_NAMES[stats.label]}.`,
    tone: LABEL_TONES[stats.label],
    announcedDiscount: false,
    warnings: [],
    numbers,
  };
  await db.query(
    `insert into listing_stats (listing_id, computed_at, current_price_cents, label, details, real_discount_pct)
     values ($1, $2, $3, $4, $5::text::jsonb, $6)`,
    [listingId, SEEN, stats.priceCents, stats.label, JSON.stringify(details), numbers.realDiscountPct],
  );
}

/**
 * The shared catalogue: three washing machines (one on sale in two stores, one with a label computed for an old
 * price, one out of stock), a TV with a real discount, a product no longer sold and a marketplace offer.
 */
export async function seedCatalogue(
  db: PGliteInterface,
): Promise<Record<"ww90" | "lg" | "bosch" | "tv" | "old", number>> {
  const ww90 = await addProduct(db, {
    slug: "samsung-ww90t534dae",
    name: "Samsung WW90T534DAE",
    brand: "Samsung",
    brandNorm: "samsung",
    model: "WW90T534DAE",
    modelNorm: "WW90T534DAE",
    ean: "8806094932287",
    categorySlug: "maquinas-de-lavar-roupa",
    imageUrl: "https://darty.pt/cdn/shop/files/ww90.jpg",
    specs: { Capacidade: "9 kg" },
  });
  const dartyWw90 = await addListing(db, {
    productId: ww90,
    storeSlug: "darty",
    sku: "T00000001",
    url: "https://darty.pt/products/samsung-ww90t534dae",
  });
  await addPrice(db, dartyWw90, { cents: 51_999, from: "2026-10-28T04:00:00Z", to: "2026-11-05T04:00:00Z" });
  await addPrice(db, dartyWw90, { cents: 44_999, from: "2026-11-05T04:00:00Z" });
  await addStats(db, dartyWw90, {
    label: "bom_preco",
    priceCents: 44_999,
    numbers: { realDiscountPct: 13.5, belowMed90Pct: 10, med90Cents: 49_999 },
  });
  const popularWw90 = await addListing(db, { productId: ww90, storeSlug: "radiopopular", sku: "1340981" });
  await addPrice(db, popularWw90, { cents: 47_999, from: "2026-10-28T05:00:00Z" });
  await addStats(db, popularWw90, {
    label: "preco_habitual",
    priceCents: 47_999,
    numbers: { belowMed90Pct: 0 },
  });
  const marketplace = await addListing(db, {
    productId: ww90,
    storeSlug: "darty",
    sku: "MKT1",
    soldByStore: false,
  });
  await addPrice(db, marketplace, { cents: 100, from: "2026-11-01T04:00:00Z" });

  const lg = await addProduct(db, {
    slug: "lg-f4wr709",
    name: "LG F4WR709 9 kg",
    brand: "LG",
    brandNorm: "lg",
    categorySlug: "maquinas-de-lavar-roupa",
  });
  const dartyLg = await addListing(db, {
    productId: lg,
    storeSlug: "darty",
    sku: "T00000002",
    url: "https://darty.pt/products/lg-f4wr709?variant=123",
  });
  await addPrice(db, dartyLg, { cents: 39_999, from: "2026-11-01T04:00:00Z" });
  await addStats(db, dartyLg, {
    label: "desconto_real",
    priceCents: 41_999,
    numbers: { realDiscountPct: 30 },
  });

  const bosch = await addProduct(db, {
    slug: "bosch-wgg244",
    name: "Bosch WGG244",
    brand: "Bosch",
    brandNorm: "bosch",
    categorySlug: "maquinas-de-lavar-roupa",
  });
  const popularBosch = await addListing(db, { productId: bosch, storeSlug: "radiopopular", sku: "1400001" });
  await addPrice(db, popularBosch, { cents: 59_999, from: "2026-10-28T05:00:00Z", inStock: false });

  const tv = await addProduct(db, {
    slug: "samsung-qe55",
    name: "Samsung QE55 televisor",
    brand: "Samsung",
    brandNorm: "samsung",
    categorySlug: "televisores",
  });
  const dartyTv = await addListing(db, { productId: tv, storeSlug: "darty", sku: "T00000003" });
  await addPrice(db, dartyTv, { cents: 69_999, from: "2026-11-02T04:00:00Z" });
  await addStats(db, dartyTv, {
    label: "desconto_real",
    priceCents: 69_999,
    numbers: { realDiscountPct: 20, belowMed90Pct: 20, med90Cents: 87_499 },
  });

  const old = await addProduct(db, {
    slug: "antigo",
    name: "Produto antigo",
    categorySlug: "maquinas-de-lavar-roupa",
  });
  const dartyOld = await addListing(db, {
    productId: old,
    storeSlug: "darty",
    sku: "T00000004",
    active: false,
  });
  await addPrice(db, dartyOld, { cents: 29_999, from: "2026-10-28T04:00:00Z", to: "2026-11-03T04:00:00Z" });

  return { ww90, lg, bosch, tv, old };
}

function firstId(rows: readonly { id: number }[]): number {
  const id = rows[0]?.id;
  if (id === undefined) {
    throw new Error("insert returned no id");
  }
  return id;
}
