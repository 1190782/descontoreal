import { activeStores, formatList, getStore, parseSearchQuery, type SearchQuery } from "@descontoreal/core";
import { listProducts, type ProductCard, searchProducts } from "@descontoreal/db/web";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactElement } from "react";
import { ProductGrid } from "@/components/product-card";
import { SearchForm } from "@/components/search-form";
import { getQuery } from "@/lib/db";

interface Props {
  searchParams: Promise<{ q?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Pesquisa",
  robots: { index: false, follow: true },
};

const MAX_RESULTS = 24;

/** Searches by name, model, EAN or a store address; a single match by EAN or address opens the product. */
export default async function SearchRoute({ searchParams }: Props): Promise<ReactElement> {
  const { q } = await searchParams;
  const raw = Array.isArray(q) ? (q[0] ?? "") : (q ?? "");
  const search = parseSearchQuery(raw);
  const results = await runSearch(search);
  if (results !== null && results.length === 1 && (search.kind === "ean" || search.kind === "store-url")) {
    redirect(`/p/${results[0]?.slug ?? ""}`);
  }
  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Pesquisa</h1>
        <SearchForm defaultValue={raw} />
      </div>
      <SearchOutcome search={search} results={results} />
    </div>
  );
}

/** Product cards for the search, best first; null when there is nothing to look up. */
async function runSearch(search: SearchQuery): Promise<ProductCard[] | null> {
  if (search.kind !== "ean" && search.kind !== "store-url" && search.kind !== "text") {
    return null;
  }
  const query = await getQuery();
  const found = await searchProducts(query, search, MAX_RESULTS);
  if (found.kind === "listing-not-found" || found.productIds.length === 0) {
    return [];
  }
  const list = await listProducts(query, {
    productIds: found.productIds,
    sort: "relevancia",
    offset: 0,
    limit: MAX_RESULTS,
    now: new Date(),
  });
  return list.items;
}

function SearchOutcome({
  search,
  results,
}: {
  search: SearchQuery;
  results: ProductCard[] | null;
}): ReactElement {
  const stores = formatList(activeStores().map((store) => store.name));
  switch (search.kind) {
    case "empty":
      return (
        <p className="text-slate-700">
          Escreve o nome ou o modelo de um produto, o código EAN da caixa, ou cola o endereço da página do
          produto numa das lojas que seguimos: {stores}.
        </p>
      );
    case "inactive-store":
      return (
        <p className="text-slate-700">
          Ainda não seguimos a {getStore(search.storeSlug).name}. Hoje seguimos {stores}.
        </p>
      );
    case "other-url":
      return (
        <p className="text-slate-700">
          Este endereço não é de uma página de produto das lojas que seguimos ({stores}).
        </p>
      );
    case "ean":
    case "store-url":
    case "text":
      return results === null || results.length === 0 ? (
        <p className="text-slate-700">
          {search.kind === "store-url"
            ? "Ainda não temos este produto: a recolha diária pode ainda não o ter lido."
            : "Não encontrámos nenhum produto com preço hoje para esta pesquisa."}
        </p>
      ) : (
        <section aria-labelledby="resultados" className="space-y-4">
          <h2 id="resultados" className="text-xl font-semibold text-slate-900">
            {results.length === 1 ? "1 resultado" : `${results.length} resultados`}
          </h2>
          <ProductGrid cards={results} />
        </section>
      );
  }
}
