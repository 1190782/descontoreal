import {
  isLabelCode,
  type LabelCode,
  OFFER_MAX_AGE_DAYS,
  type SortOrder,
  type StoreSlug,
  TIME_ZONE,
} from "@descontoreal/core";
import { jsonParam, type Query } from "./query";
import { type ClassificationJson, toCardLabel, toStoreSlug } from "./rows";
import type { FacetOption, ListFacets, ProductList } from "./types";

/** Which products a list shows. Every filter left null applies no restriction. */
export interface ListCriteria {
  /** Category slugs (core categoryAndChildren for a top category). */
  categories?: readonly string[] | null;
  brandNorm?: string | null;
  /** Search results, best first: only these products, in this order with sort "relevancia". */
  productIds?: readonly number[] | null;
  excludeProductId?: number | null;
  /** Only this store's listings count, and the price shown is its own. */
  store?: StoreSlug | null;
  label?: LabelCode | null;
  minPriceCents?: number | null;
  /** Excluded. */
  maxPriceCents?: number | null;
  sort: SortOrder | "relevancia";
  offset: number;
  limit: number;
  now: Date;
}

interface CardJson {
  productId: number;
  slug: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  storeName: string;
  priceCents: number;
  onSale: boolean;
  storeCount: number;
  label: ClassificationJson | null;
  realDiscountPct: number | null;
}

interface FacetJson {
  value: string;
  name: string | null;
  count: number;
}

/**
 * Listings with a current price of the products that pass $1–$4, with core isCurrentOffer as SQL ($5 now, $6 max
 * age) and the label only when listing_stats was computed for that price.
 */
const PRICED_CTES = `
  candidates as (
    select p.id, p.slug, p.name, p.brand, p.brand_norm, p.image_url
    from products p
    where ($1::text is null or p.category_id in (
            select c.id from categories c where c.slug in (select jsonb_array_elements_text($1::text::jsonb))))
      and ($2::text is null or p.brand_norm = $2::text)
      and ($3::text is null or p.id in (select (jsonb_array_elements_text($3::text::jsonb))::bigint))
      and ($4::bigint is null or p.id <> $4::bigint)
  ),
  priced as (
    select l.product_id, l.id as listing_id, s.slug as store_slug, s.name as store_name, pp.price_cents,
           pp.in_stock and l.missed_runs = 0
             and ($5::timestamptz at time zone '${TIME_ZONE}')::date
               - (l.last_seen_at at time zone '${TIME_ZONE}')::date <= $6::int as on_sale,
           case when ls.current_price_cents = pp.price_cents then ls.details end as label_details,
           case when ls.current_price_cents = pp.price_cents then ls.real_discount_pct end as real_discount_pct
    from listings l
    join candidates c on c.id = l.product_id
    join stores s on s.id = l.store_id
    join price_points pp on pp.listing_id = l.id and pp.valid_to is null
    left join listing_stats ls on ls.listing_id = l.id
    where l.sold_by_store and l.active
  )
`;

const LIST_SQL = `
  with ${PRICED_CTES},
  best as (
    select distinct on (pr.product_id) pr.*
    from priced pr
    where $7::text is null or pr.store_slug = $7::text
    order by pr.product_id, pr.on_sale desc, pr.price_cents, pr.listing_id
  ),
  cards as (
    select c.id, c.slug, c.name, c.brand, c.image_url, b.store_name, b.price_cents, b.on_sale, b.label_details,
           b.real_discount_pct,
           (select count(distinct pr.store_slug) from priced pr where pr.product_id = c.id)::int as store_count
    from candidates c
    join best b on b.product_id = c.id
    where ($8::text is null or b.label_details ->> 'label' = $8::text)
      and ($9::int is null or b.price_cents >= $9::int)
      and ($10::int is null or b.price_cents < $10::int)
  ),
  ranked as (
    select cards.*, row_number() over (order by
      cards.on_sale desc,
      case when $11::text = 'preco' then cards.price_cents end asc,
      case when $11::text = 'preco-desc' then cards.price_cents end desc,
      case when $11::text = 'desconto' then cards.real_discount_pct end desc nulls last,
      case when $11::text = 'relevancia' then (
        select t.ord from jsonb_array_elements_text($3::text::jsonb) with ordinality as t (value, ord)
        where t.value::bigint = cards.id
      ) end asc,
      cards.name, cards.id
    ) as position
    from cards
  )
  select
    (select count(*) from ranked)::int as total,
    coalesce((
      select json_agg(json_build_object(
        'productId', r.id, 'slug', r.slug, 'name', r.name, 'brand', r.brand, 'imageUrl', r.image_url,
        'storeName', r.store_name, 'priceCents', r.price_cents, 'onSale', r.on_sale, 'storeCount', r.store_count,
        'label', r.label_details, 'realDiscountPct', r.real_discount_pct
      ) order by r.position)
      from ranked r
      where r.position > $12::int and r.position <= $12::int + $13::int
    ), '[]'::json) as items
`;

const FACETS_SQL = `
  with ${PRICED_CTES},
  best as (
    select distinct on (pr.product_id) pr.*
    from priced pr
    order by pr.product_id, pr.on_sale desc, pr.price_cents, pr.listing_id
  )
  select
    coalesce((
      select json_agg(json_build_object('value', f.brand_norm, 'name', f.brand, 'count', f.n) order by f.n desc, f.brand)
      from (
        select c.brand_norm, min(c.brand) as brand, count(*)::int as n
        from best b join candidates c on c.id = b.product_id
        where c.brand_norm is not null
        group by c.brand_norm
      ) f
    ), '[]'::json) as brands,
    coalesce((
      select json_agg(json_build_object('value', f.store_slug, 'name', f.store_name, 'count', f.n) order by f.store_name)
      from (
        select pr.store_slug, pr.store_name, count(distinct pr.product_id)::int as n
        from priced pr
        group by pr.store_slug, pr.store_name
      ) f
    ), '[]'::json) as stores,
    coalesce((
      select json_agg(json_build_object('value', f.label, 'name', null, 'count', f.n) order by f.n desc, f.label)
      from (
        select b.label_details ->> 'label' as label, count(*)::int as n
        from best b
        where b.label_details is not null
        group by 1
      ) f
    ), '[]'::json) as labels
`;

/** One page of products for a category, brand, search or related list, with the total that pass the filters. */
export async function listProducts(query: Query, criteria: ListCriteria): Promise<ProductList> {
  const [row] = await query<{ total: number; items: CardJson[] }>(LIST_SQL, [
    jsonParam(criteria.categories),
    criteria.brandNorm ?? null,
    jsonParam(criteria.productIds),
    criteria.excludeProductId ?? null,
    criteria.now,
    OFFER_MAX_AGE_DAYS,
    criteria.store ?? null,
    criteria.label ?? null,
    criteria.minPriceCents ?? null,
    criteria.maxPriceCents ?? null,
    criteria.sort,
    criteria.offset,
    criteria.limit,
  ]);
  return {
    total: row?.total ?? 0,
    items: (row?.items ?? []).map((card) => ({ ...card, label: toCardLabel(card.label) })),
  };
}

/** Brands, stores and labels found in a list without filters, most common first. */
export async function getListFacets(
  query: Query,
  criteria: Pick<ListCriteria, "categories" | "brandNorm" | "now">,
): Promise<ListFacets> {
  const [row] = await query<{ brands: FacetJson[]; stores: FacetJson[]; labels: FacetJson[] }>(FACETS_SQL, [
    jsonParam(criteria.categories),
    criteria.brandNorm ?? null,
    null,
    null,
    criteria.now,
    OFFER_MAX_AGE_DAYS,
  ]);
  return {
    brands: (row?.brands ?? []).map((facet) => ({
      value: facet.value,
      name: facet.name ?? facet.value,
      count: facet.count,
    })),
    stores: (row?.stores ?? []).map((facet): FacetOption<StoreSlug> => ({
      value: toStoreSlug(facet.value),
      name: facet.name ?? facet.value,
      count: facet.count,
    })),
    labels: (row?.labels ?? []).flatMap((facet): FacetOption<LabelCode>[] =>
      isLabelCode(facet.value) ? [{ value: facet.value, name: facet.value, count: facet.count }] : [],
    ),
  };
}
