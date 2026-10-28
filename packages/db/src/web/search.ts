import type { SearchQuery } from "@descontoreal/core";
import { escapeLike, jsonParam, type Query } from "./query";

/** What a search found: product ids best first, or why there is nothing to look up. */
export type SearchResult =
  | { kind: "products"; productIds: number[] }
  /** A pasted address of a store we collect, for a listing not linked to a product yet or unknown. */
  | { kind: "listing-not-found" };

/** word_similarity() of the words and a product name from which the product counts as a match. */
const MIN_WORD_SIMILARITY = 0.5;

const BY_EAN_SQL = `select p.id from products p where p.ean = $1::text`;

const BY_URL_SQL = `
  select l.product_id as id
  from listings l
  join stores s on s.id = l.store_id
  where s.slug = $1::text and (l.url = $2::text or l.url like $3::text escape '\\')
    and l.sold_by_store and l.product_id is not null
  order by l.active desc, l.id
  limit 1
`;

// Model codes first, then the names most like the words; pg_trgm lives in the extensions schema.
const BY_TEXT_SQL = `
  select p.id
  from products p
  where p.model_norm in (select jsonb_array_elements_text($2::text::jsonb))
     or extensions.word_similarity($1::text, p.name) >= $3::real
     or p.name ilike $4::text escape '\\'
  order by p.model_norm in (select jsonb_array_elements_text($2::text::jsonb)) desc,
           extensions.word_similarity($1::text, p.name) desc,
           p.name, p.id
  limit $5::int
`;

/** Looks up a parsed search (core parseSearchQuery); empty and unknown addresses find nothing. */
export async function searchProducts(
  query: Query,
  search: SearchQuery,
  limit: number,
): Promise<SearchResult> {
  switch (search.kind) {
    case "ean":
      return { kind: "products", productIds: ids(await query<{ id: number }>(BY_EAN_SQL, [search.ean])) };
    case "store-url": {
      const rows = await query<{ id: number }>(BY_URL_SQL, [
        search.storeSlug,
        search.url,
        `${escapeLike(search.url)}?%`,
      ]);
      return rows.length === 0 ? { kind: "listing-not-found" } : { kind: "products", productIds: ids(rows) };
    }
    case "text":
      return {
        kind: "products",
        productIds: ids(
          await query<{ id: number }>(BY_TEXT_SQL, [
            search.text,
            jsonParam(search.models),
            MIN_WORD_SIMILARITY,
            `%${escapeLike(search.text)}%`,
            limit,
          ]),
        ),
      };
    case "empty":
    case "inactive-store":
    case "other-url":
      return { kind: "products", productIds: [] };
  }
}

function ids(rows: readonly { id: number }[]): number[] {
  return rows.map((row) => row.id);
}
