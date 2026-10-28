import { isCategorySlug } from "@descontoreal/core";
import type { Query } from "./query";
import type { CategoryCount, SitemapBrand, SitemapProduct } from "./types";

const PRODUCTS_SQL = `
  select p.slug,
         min(pp.valid_from) as first_price_at,
         max(pp.valid_from) as last_change_at,
         count(distinct l.store_id) filter (where pp.valid_to is null and l.active)::int as store_count
  from products p
  join listings l on l.product_id = p.id and l.sold_by_store
  join price_points pp on pp.listing_id = l.id
  group by p.slug
  order by p.slug
`;

const BRANDS_SQL = `
  select p.brand_norm, min(p.brand) as brand, count(distinct p.id)::int as products
  from products p
  join listings l on l.product_id = p.id and l.sold_by_store and l.active
  join price_points pp on pp.listing_id = l.id and pp.valid_to is null
  where p.brand_norm is not null
  group by p.brand_norm
  order by p.brand_norm
`;

const CATEGORY_COUNTS_SQL = `
  select c.slug, count(distinct p.id)::int as products
  from categories c
  join products p on p.category_id = c.id
  join listings l on l.product_id = p.id and l.sold_by_store and l.active
  join price_points pp on pp.listing_id = l.id and pp.valid_to is null
  group by c.slug
  order by c.slug
`;

/** Every product with a price history; the caller keeps the indexable ones (core isProductIndexable). */
export async function getSitemapProducts(query: Query): Promise<SitemapProduct[]> {
  const rows = await query<{ slug: string; first_price_at: Date; last_change_at: Date; store_count: number }>(
    PRODUCTS_SQL,
  );
  return rows.map((row) => ({
    slug: row.slug,
    firstPriceAt: new Date(row.first_price_at),
    lastChangeAt: new Date(row.last_change_at),
    storeCount: row.store_count,
  }));
}

/** Brands with at least one product with a current price. */
export async function getBrands(query: Query): Promise<SitemapBrand[]> {
  const rows = await query<{ brand_norm: string; brand: string; products: number }>(BRANDS_SQL);
  return rows.map((row) => ({ brandNorm: row.brand_norm, name: row.brand, products: row.products }));
}

/** Products with a current price per category (its own products, not its children's). */
export async function getCategoryCounts(query: Query): Promise<CategoryCount[]> {
  const rows = await query<{ slug: string; products: number }>(CATEGORY_COUNTS_SQL);
  return rows.flatMap((row) =>
    isCategorySlug(row.slug) ? [{ slug: row.slug, products: row.products }] : [],
  );
}
