import { DAY_MS, getCategory, normalizeBrand, normalizeModel, productSlugBase } from "@descontoreal/core";
import type { SqlExecutor } from "../executor";

export interface DemoOptions {
  now: Date;
  /** Days of history before `now`. */
  days: number;
  products: number;
  /** Same seed, same data. */
  seed: number;
}

export interface DemoResult {
  products: number;
  listings: number;
  prices: number;
}

interface DemoInterval {
  priceCents: number;
  referencePriceCents: number | null;
  inStock: boolean;
  validFrom: Date;
  validTo: Date | null;
}

// Made-up brands, so nothing local can be mistaken for a real price of a real product.
const BRANDS = ["Alfa", "Boreal", "Cénit", "Delta", "Éter", "Fénix"] as const;
const DEMO_CATEGORIES = [
  { slug: "maquinas-de-lavar-roupa", minCents: 29_900, maxCents: 89_900 },
  { slug: "frigorificos", minCents: 39_900, maxCents: 149_900 },
  { slug: "televisores", minCents: 29_900, maxCents: 199_900 },
  { slug: "portateis", minCents: 44_900, maxCents: 179_900 },
  { slug: "smartphones", minCents: 19_900, maxCents: 129_900 },
  { slug: "aspiradores", minCents: 9_900, maxCents: 59_900 },
  { slug: "maquinas-de-cafe", minCents: 4_900, maxCents: 79_900 },
  { slug: "fritadeiras", minCents: 4_900, maxCents: 19_900 },
] as const;
const STORES = [
  {
    slug: "darty",
    productUrl: (key: string) => `https://darty.pt/products/demo-${key}`,
    hasReference: false,
  },
  {
    slug: "radiopopular",
    productUrl: (key: string) => `https://www.radiopopular.pt/produto/demo-${key}`,
    hasReference: true,
  },
] as const;

/**
 * Writes made-up products, listings and price histories for local development: steady prices, promotions, a few
 * prices raised before a drop, some out of stock. Run `pnpm stats` afterwards for the labels. Local database only.
 */
export async function seedDemoData(executor: SqlExecutor, options: DemoOptions): Promise<DemoResult> {
  const random = mulberry32(options.seed);
  const start = new Date(options.now.getTime() - options.days * DAY_MS);
  const result: DemoResult = { products: 0, listings: 0, prices: 0 };
  for (let index = 0; index < options.products; index += 1) {
    const brand = pick(random, BRANDS);
    const category = pick(random, DEMO_CATEGORIES);
    const singular = getCategory(category.slug).singular ?? null;
    const model = `${brand.slice(0, 2).toUpperCase()}${1000 + index}`;
    const name = `${brand} ${model}`;
    const slug = productSlugBase({ brand, model, name, categorySingular: singular });
    const [product] = await executor.query<{ id: number }>(
      `insert into products (ean, brand, brand_norm, model, model_norm, name, slug, category_id, specs)
       values ($1, $2, $3, $4, $5, $6, $7, (select id from categories where slug = $8), $9::text::jsonb)
       on conflict (slug) do nothing
       returning id`,
      [
        demoEan(index),
        brand,
        normalizeBrand(brand),
        model,
        normalizeModel(model),
        name,
        slug,
        category.slug,
        JSON.stringify({ Modelo: model, Garantia: "3 anos" }),
      ],
    );
    if (product === undefined) {
      continue;
    }
    result.products += 1;
    const basePrice = roundPrice(category.minCents + random() * (category.maxCents - category.minCents));
    const stores = STORES.filter(() => random() < 0.75);
    for (const store of stores.length === 0 ? [STORES[0]] : stores) {
      const intervals = demoHistory(random, basePrice, start, options.now, store.hasReference);
      const lastSeenAt = new Date(options.now.getTime() - (random() < 0.05 ? 3 * DAY_MS : 6 * 3_600_000));
      const [listing] = await executor.query<{ id: number }>(
        `insert into listings (store_id, store_sku, product_id, url, raw_title, sold_by_store, first_seen_at,
                               last_seen_at)
         values ((select id from stores where slug = $1), $2, $3, $4, $5, true, $6, $7)
         returning id`,
        [store.slug, `DEMO-${index}`, product.id, store.productUrl(slug), name, start, lastSeenAt],
      );
      if (listing === undefined) {
        throw new Error("listing insert returned no id");
      }
      result.listings += 1;
      for (const interval of intervals) {
        await executor.query(
          `insert into price_points (listing_id, price_cents, reference_price_cents, in_stock, valid_from, valid_to)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            listing.id,
            interval.priceCents,
            interval.referencePriceCents,
            interval.inStock,
            interval.validFrom,
            interval.validTo,
          ],
        );
        result.prices += 1;
      }
    }
  }
  return result;
}

/** A price history: changes every few days, a promotion now and then, and sometimes a rise before a drop. */
function demoHistory(
  random: () => number,
  basePrice: number,
  start: Date,
  now: Date,
  hasReference: boolean,
): DemoInterval[] {
  const changes: { at: number; priceCents: number; referencePriceCents: number | null }[] = [
    { at: start.getTime(), priceCents: basePrice, referencePriceCents: null },
  ];
  const raisedBeforeDrop = random() < 0.15;
  let at = start.getTime();
  for (;;) {
    at += (3 + Math.floor(random() * 10)) * DAY_MS;
    if (at >= now.getTime() - 2 * DAY_MS) {
      break;
    }
    const roll = random();
    if (raisedBeforeDrop && at > now.getTime() - 25 * DAY_MS) {
      changes.push({ at, priceCents: roundPrice(basePrice * 1.2), referencePriceCents: null });
      changes.push({
        at: now.getTime() - DAY_MS,
        priceCents: roundPrice(basePrice * 1.02),
        referencePriceCents: hasReference ? roundPrice(basePrice * 1.2) : null,
      });
      break;
    }
    const factor = roll < 0.2 ? 0.82 : roll < 0.6 ? 1 - random() * 0.04 : 1 + random() * 0.04;
    const priceCents = roundPrice(basePrice * factor);
    changes.push({
      at,
      priceCents,
      referencePriceCents: hasReference && priceCents < basePrice * 0.9 ? basePrice : null,
    });
  }
  const outOfStock = random() < 0.08;
  return changes.map((change, index) => {
    const next = changes[index + 1];
    return {
      priceCents: change.priceCents,
      referencePriceCents: change.referencePriceCents,
      inStock: next !== undefined || !outOfStock,
      validFrom: new Date(change.at),
      validTo: next === undefined ? null : new Date(next.at),
    };
  });
}

/** Prices end in ,99 €, as most shop prices do. */
function roundPrice(cents: number): number {
  return Math.max(99, Math.round(cents / 100) * 100 - 1);
}

/** A valid EAN-13 in the 200–299 prefix range, which GS1 keeps for in-store use: never a real product. */
function demoEan(index: number): string {
  const body = `29${String(index).padStart(10, "0")}`;
  const sum = [...body].reduce(
    (total, digit, position) => total + Number(digit) * (position % 2 === 0 ? 1 : 3),
    0,
  );
  return `${body}${(10 - (sum % 10)) % 10}`;
}

function pick<T>(random: () => number, items: readonly T[]): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) {
    throw new Error("pick() needs at least one item");
  }
  return item;
}

/** Small seeded PRNG: the same seed gives the same demo data. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
