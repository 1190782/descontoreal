import {
  type HighlightCandidate,
  isLabelCode,
  LABELS_CONFIG,
  OFFER_MAX_AGE_DAYS,
  TIME_ZONE,
} from "@descontoreal/core";
import type { Query } from "./query";
import { type ClassificationJson, toStoreSlug } from "./rows";
import type { HomeData } from "./types";

/** Candidates kept per kind (labelled, drops) for core pickHighlights, which picks a few per product. */
const CANDIDATES_PER_KIND = 30;

const STORES_SQL = `
  select s.slug, s.name, max(l.last_seen_at) as last_seen_at, count(pp.id)::int as listings
  from stores s
  left join listings l on l.store_id = s.id and l.sold_by_store and l.active
  left join price_points pp on pp.listing_id = l.id and pp.valid_to is null
  where s.active
  group by s.slug, s.name
  order by s.name
`;

const PRODUCT_COUNT_SQL = `
  select count(distinct l.product_id)::int as products
  from listings l
  join price_points pp on pp.listing_id = l.id and pp.valid_to is null
  where l.sold_by_store and l.active and l.product_id is not null
`;

// Current offers whose label was computed for their price: the best real discounts and the biggest drops below
// the usual price ($3, in percent), for core pickHighlights.
const HIGHLIGHTS_SQL = `
  with offers as (
    select p.slug, p.name, p.image_url, s.name as store_name, pp.price_cents, ls.details, ls.label,
           (ls.details -> 'numbers' ->> 'realDiscountPct')::numeric as real_discount_pct,
           (ls.details -> 'numbers' ->> 'belowMed90Pct')::numeric as below_med90_pct
    from listing_stats ls
    join listings l on l.id = ls.listing_id
    join products p on p.id = l.product_id
    join stores s on s.id = l.store_id
    join price_points pp on pp.listing_id = l.id and pp.valid_to is null
    where l.sold_by_store and l.active and ls.current_price_cents = pp.price_cents
      and pp.in_stock and l.missed_runs = 0
      and ($1::timestamptz at time zone '${TIME_ZONE}')::date - (l.last_seen_at at time zone '${TIME_ZONE}')::date <= $2::int
  )
  (select * from offers where label in ('desconto_real', 'minimo_historico')
   order by real_discount_pct desc nulls last, slug limit $4::int)
  union all
  (select * from offers where below_med90_pct >= $3::numeric
   order by below_med90_pct desc, slug limit $4::int)
`;

// A product on sale with a story to tell: "Subiu antes de descer" when a current label says so, otherwise the one
// whose price changed most often.
const EXAMPLE_SQL = `
  select p.slug
  from listings l
  join products p on p.id = l.product_id
  join price_points pp on pp.listing_id = l.id and pp.valid_to is null
  left join listing_stats ls on ls.listing_id = l.id and ls.current_price_cents = pp.price_cents
  where l.sold_by_store and l.active and pp.in_stock and l.missed_runs = 0
    and ($1::timestamptz at time zone '${TIME_ZONE}')::date - (l.last_seen_at at time zone '${TIME_ZONE}')::date <= $2::int
    and (select count(distinct h.price_cents) from price_points h where h.listing_id = l.id) > 1
  order by coalesce(ls.label = 'subiu_antes_de_descer', false) desc,
           (select count(distinct h.price_cents) from price_points h where h.listing_id = l.id) desc,
           l.id
  limit 1
`;

interface HighlightRow {
  slug: string;
  name: string;
  image_url: string | null;
  store_name: string;
  price_cents: number;
  details: ClassificationJson;
}

/** The data of the home page, read at `now`. */
export async function getHomeData(query: Query, now: Date): Promise<HomeData> {
  const minDropPct = Math.round((1 - LABELS_CONFIG.goodPriceFactor) * 100);
  const [stores, counts, highlights, examples] = await Promise.all([
    query<{ slug: string; name: string; last_seen_at: Date | null; listings: number }>(STORES_SQL),
    query<{ products: number }>(PRODUCT_COUNT_SQL),
    query<HighlightRow>(HIGHLIGHTS_SQL, [now, OFFER_MAX_AGE_DAYS, minDropPct, CANDIDATES_PER_KIND]),
    query<{ slug: string }>(EXAMPLE_SQL, [now, OFFER_MAX_AGE_DAYS]),
  ]);
  return {
    stores: stores.map((store) => ({
      slug: toStoreSlug(store.slug),
      name: store.name,
      lastSeenAt: store.last_seen_at === null ? null : new Date(store.last_seen_at),
      listings: store.listings,
    })),
    productCount: counts[0]?.products ?? 0,
    highlightCandidates: highlights.flatMap(toCandidate),
    exampleSlug: examples[0]?.slug ?? null,
  };
}

function toCandidate(row: HighlightRow): HighlightCandidate[] {
  const label = row.details.label;
  if (!isLabelCode(label)) {
    return [];
  }
  return [
    {
      productSlug: row.slug,
      productName: row.name,
      imageUrl: row.image_url,
      storeName: row.store_name,
      priceCents: row.price_cents,
      label,
      labelText: row.details.text,
      numbers: row.details.numbers,
    },
  ];
}
