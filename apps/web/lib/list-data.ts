import "server-only";
import { type ListFilters, PRICE_BUCKETS } from "@descontoreal/core";
import { getListFacets, type ListFacets, listProducts, type ProductList } from "@descontoreal/db/web";
import { getQuery } from "@/lib/db";

export const PAGE_SIZE = 24;

export interface ListData {
  list: ProductList;
  facets: ListFacets;
  pageCount: number;
}

/** One page of a category's or a brand's products under `filters`, and the options to filter it further. */
export async function loadList(
  scope: { categories: readonly string[] } | { brandNorm: string },
  filters: ListFilters,
  now: Date,
): Promise<ListData> {
  const query = await getQuery();
  const bucket = PRICE_BUCKETS.find((candidate) => candidate.slug === filters.price);
  const base = "brandNorm" in scope ? { brandNorm: scope.brandNorm } : { categories: scope.categories };
  const [list, facets] = await Promise.all([
    listProducts(query, {
      ...base,
      brandNorm: "brandNorm" in scope ? scope.brandNorm : filters.brand,
      store: filters.store,
      label: filters.label,
      minPriceCents: bucket?.minCents ?? null,
      maxPriceCents: bucket?.maxCents ?? null,
      sort: filters.sort,
      offset: (filters.page - 1) * PAGE_SIZE,
      limit: PAGE_SIZE,
      now,
    }),
    getListFacets(query, { ...base, now }),
  ]);
  return { list, facets, pageCount: Math.max(1, Math.ceil(list.total / PAGE_SIZE)) };
}
