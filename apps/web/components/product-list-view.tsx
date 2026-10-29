import {
  filterSegments,
  LABEL_NAMES,
  type ListFilters,
  PRICE_BUCKETS,
  type SortOrder,
} from "@descontoreal/core";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { ProductGrid } from "@/components/product-card";
import type { ListData } from "@/lib/list-data";

const SORT_NAMES: Readonly<Record<SortOrder, string>> = {
  desconto: "Maior desconto real",
  preco: "Preço mais baixo",
  "preco-desc": "Preço mais alto",
};
const SORT_ORDERS: readonly SortOrder[] = ["desconto", "preco", "preco-desc"];
const VISIBLE_BRANDS = 12;

interface Props {
  /** "/c/televisores" or "/marca/lg". */
  basePath: string;
  filters: ListFilters;
  data: ListData;
  /** Brand filter options; a brand page has none. */
  withBrands: boolean;
}

/** A path of this list with `change` applied; any change but the page goes back to page 1. */
function pathWith(basePath: string, filters: ListFilters, change: Partial<ListFilters>): string {
  const next = { ...filters, page: 1, ...change };
  return [basePath, ...filterSegments(next)].join("/");
}

/** Filters, products and pages of a category or brand list. Every option is a plain link to its own cached page. */
export function ProductListView({ basePath, filters, data, withBrands }: Props): ReactElement {
  const { list, facets, pageCount } = data;
  const active = [
    filters.brand === null
      ? null
      : {
          name: facets.brands.find((brand) => brand.value === filters.brand)?.name ?? filters.brand,
          path: pathWith(basePath, filters, { brand: null }),
        },
    filters.store === null
      ? null
      : {
          name: facets.stores.find((store) => store.value === filters.store)?.name ?? filters.store,
          path: pathWith(basePath, filters, { store: null }),
        },
    filters.label === null
      ? null
      : { name: LABEL_NAMES[filters.label], path: pathWith(basePath, filters, { label: null }) },
    filters.price === null
      ? null
      : {
          name: PRICE_BUCKETS.find((bucket) => bucket.slug === filters.price)?.label ?? filters.price,
          path: pathWith(basePath, filters, { price: null }),
        },
  ].filter((chip) => chip !== null);

  return (
    <div className="space-y-6">
      <details className="rounded-lg border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 font-medium text-slate-900">Filtrar e ordenar</summary>
        <div className="grid gap-6 border-t border-slate-200 p-4 sm:grid-cols-2 lg:grid-cols-3">
          <FilterGroup title="Ordenar">
            {SORT_ORDERS.map((sort) => (
              <Option
                key={sort}
                href={pathWith(basePath, filters, { sort })}
                selected={filters.sort === sort}
                name={SORT_NAMES[sort]}
              />
            ))}
          </FilterGroup>
          {facets.labels.length === 0 ? null : (
            <FilterGroup title="Rótulo">
              {facets.labels.map((label) => (
                <Option
                  key={label.value}
                  href={pathWith(basePath, filters, { label: label.value })}
                  selected={filters.label === label.value}
                  name={LABEL_NAMES[label.value]}
                  count={label.count}
                />
              ))}
            </FilterGroup>
          )}
          <FilterGroup title="Loja">
            {facets.stores.map((store) => (
              <Option
                key={store.value}
                href={pathWith(basePath, filters, { store: store.value })}
                selected={filters.store === store.value}
                name={store.name}
                count={store.count}
              />
            ))}
          </FilterGroup>
          <FilterGroup title="Preço">
            {PRICE_BUCKETS.map((bucket) => (
              <Option
                key={bucket.slug}
                href={pathWith(basePath, filters, { price: bucket.slug })}
                selected={filters.price === bucket.slug}
                name={bucket.label}
              />
            ))}
          </FilterGroup>
          {withBrands && facets.brands.length > 0 ? (
            <FilterGroup title="Marca">
              {facets.brands.slice(0, VISIBLE_BRANDS).map((brand) => (
                <Option
                  key={brand.value}
                  href={pathWith(basePath, filters, { brand: brand.value })}
                  selected={filters.brand === brand.value}
                  name={brand.name}
                  count={brand.count}
                />
              ))}
              {facets.brands.length > VISIBLE_BRANDS ? (
                <li>
                  <details>
                    <summary className="cursor-pointer text-sm text-indigo-700">Mais marcas</summary>
                    <ul className="mt-2 space-y-1">
                      {facets.brands.slice(VISIBLE_BRANDS).map((brand) => (
                        <Option
                          key={brand.value}
                          href={pathWith(basePath, filters, { brand: brand.value })}
                          selected={filters.brand === brand.value}
                          name={brand.name}
                          count={brand.count}
                        />
                      ))}
                    </ul>
                  </details>
                </li>
              ) : null}
            </FilterGroup>
          ) : null}
        </div>
      </details>

      {active.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label="Filtros ativos">
          {active.map((chip) => (
            <li key={chip.path}>
              <Link
                href={chip.path}
                prefetch={false}
                className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-sm text-white"
              >
                {chip.name} <span aria-label="remover filtro">×</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="sr-only">Produtos</h2>
      {list.items.length === 0 ? (
        <p className="text-slate-700">Nenhum produto com preço hoje corresponde a estes filtros.</p>
      ) : (
        <ProductGrid cards={list.items} />
      )}

      {pageCount > 1 ? (
        <nav aria-label="Páginas" className="flex items-center justify-between gap-4 text-sm">
          {filters.page > 1 ? (
            <Link
              href={pathWith(basePath, filters, { page: filters.page - 1 })}
              prefetch={false}
              rel="prev"
              className="font-medium text-indigo-700 underline underline-offset-2"
            >
              Página anterior
            </Link>
          ) : (
            <span />
          )}
          <span className="text-slate-600">
            Página {filters.page} de {pageCount}
          </span>
          {filters.page < pageCount ? (
            <Link
              href={pathWith(basePath, filters, { page: filters.page + 1 })}
              prefetch={false}
              rel="next"
              className="font-medium text-indigo-700 underline underline-offset-2"
            >
              Página seguinte
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div>
      <h2 className="mb-2 text-sm font-semibold text-slate-900">{title}</h2>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Option({
  href,
  selected,
  name,
  count,
}: {
  href: string;
  selected: boolean;
  name: string;
  count?: number;
}): ReactElement {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        aria-current={selected ? "true" : undefined}
        className="text-sm text-slate-700 hover:text-indigo-700 hover:underline aria-[current=true]:font-semibold aria-[current=true]:text-slate-900"
      >
        {name}
        {count === undefined ? null : <span className="text-slate-500"> ({count})</span>}
      </Link>
    </li>
  );
}
