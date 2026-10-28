import { currentIntervalOf } from "@descontoreal/core";
import type { Query } from "./query";
import {
  type CategoryJson,
  type ClassificationJson,
  type IntervalJson,
  toCategory,
  toInterval,
  toListingLabel,
  toStoreSlug,
} from "./rows";
import type { PageListing, ProductPage } from "./types";

interface ListingJson {
  listingId: number;
  storeSlug: string;
  storeName: string;
  url: string;
  active: boolean;
  missedRuns: number;
  lastSeenAt: string;
  intervals: IntervalJson[];
  stats: { currentPriceCents: number; details: ClassificationJson } | null;
}

interface ProductPageRow {
  page: {
    id: number;
    slug: string;
    name: string;
    brand: string | null;
    brandNorm: string | null;
    model: string | null;
    ean: string | null;
    imageUrl: string | null;
    specs: Record<string, string>;
    category: CategoryJson | null;
    listings: ListingJson[];
  };
}

// One round trip: the product, its category and every listing sold by its store, with intervals and label.
const PRODUCT_PAGE_SQL = `
  select json_build_object(
    'id', p.id, 'slug', p.slug, 'name', p.name, 'brand', p.brand, 'brandNorm', p.brand_norm, 'model', p.model,
    'ean', p.ean, 'imageUrl', p.image_url, 'specs', p.specs,
    'category', (
      select json_build_object(
        'slug', c.slug, 'name', c.name,
        'parent', (select json_build_object('slug', pc.slug, 'name', pc.name) from categories pc where pc.id = c.parent_id)
      )
      from categories c where c.id = p.category_id
    ),
    'listings', coalesce((
      select json_agg(json_build_object(
        'listingId', l.id, 'storeSlug', s.slug, 'storeName', s.name, 'url', l.url, 'active', l.active,
        'missedRuns', l.missed_runs, 'lastSeenAt', l.last_seen_at,
        'intervals', coalesce((
          select json_agg(json_build_object(
            'priceCents', pp.price_cents, 'referencePriceCents', pp.reference_price_cents, 'inStock', pp.in_stock,
            'validFrom', pp.valid_from, 'validTo', pp.valid_to
          ) order by pp.valid_from)
          from price_points pp where pp.listing_id = l.id
        ), '[]'::json),
        'stats', (
          select json_build_object('currentPriceCents', ls.current_price_cents, 'details', ls.details)
          from listing_stats ls where ls.listing_id = l.id
        )
      ) order by s.name, l.id)
      from listings l
      join stores s on s.id = l.store_id
      where l.product_id = p.id and l.sold_by_store
    ), '[]'::json)
  ) as page
  from products p
  where p.slug = $1::text
`;

/** Everything the product page shows about `slug`; null for an unknown product. */
export async function getProductPage(query: Query, slug: string): Promise<ProductPage | null> {
  const [row] = await query<ProductPageRow>(PRODUCT_PAGE_SQL, [slug]);
  if (row === undefined) {
    return null;
  }
  const { page } = row;
  return {
    id: page.id,
    slug: page.slug,
    name: page.name,
    brand: page.brand,
    brandNorm: page.brandNorm,
    model: page.model,
    ean: page.ean,
    imageUrl: page.imageUrl,
    specs: page.specs,
    category: toCategory(page.category),
    listings: page.listings.map(toPageListing),
  };
}

function toPageListing(json: ListingJson): PageListing {
  const intervals = json.intervals.map(toInterval);
  const current = currentIntervalOf(intervals);
  return {
    listingId: json.listingId,
    storeSlug: toStoreSlug(json.storeSlug),
    storeName: json.storeName,
    url: json.url,
    active: json.active,
    missedRuns: json.missedRuns,
    lastSeenAt: new Date(json.lastSeenAt),
    intervals,
    label: toListingLabel(
      json.stats?.details ?? null,
      json.stats?.currentPriceCents ?? null,
      current?.priceCents ?? null,
    ),
  };
}
