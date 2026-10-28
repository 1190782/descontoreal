import {
  activeStores,
  formatList,
  isFilteredView,
  type ListFilters,
  parseFilterSegments,
} from "@descontoreal/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, type ReactElement } from "react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProductListView } from "@/components/product-list-view";
import { type ListData, loadList } from "@/lib/list-data";

interface Params {
  params: Promise<{ slug: string; filtros?: string[] }>;
}

export const revalidate = false;

export function generateStaticParams(): { slug: string; filtros: string[] }[] {
  return [];
}

interface BrandPage {
  brandNorm: string;
  name: string;
  filters: ListFilters;
  data: ListData;
}

/** A brand (products.brand_norm) with products on sale, and the filters in the path; null for a 404. */
const loadPage = cache(async (slug: string, segments: string): Promise<BrandPage | null> => {
  const filters = parseFilterSegments(segments === "" ? [] : segments.split("/"));
  if (!/^[a-z0-9]+$/.test(slug) || filters === null || filters.brand !== null) {
    return null;
  }
  const data = await loadList({ brandNorm: slug }, filters, new Date());
  const name = data.facets.brands[0]?.name;
  if (name === undefined || filters.page > data.pageCount) {
    return null;
  }
  return { brandNorm: slug, name, filters, data };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, filtros = [] } = await params;
  const page = await loadPage(slug, filtros.join("/"));
  if (page === null) {
    return { title: "Página não encontrada" };
  }
  const stores = formatList(activeStores().map((store) => `na ${store.name}`));
  return {
    title: `${page.name}: preços e descontos de hoje`,
    description:
      `Preço de hoje de ${page.data.list.total} produtos ${page.name} ${stores}, com o histórico de cada loja e ` +
      "rótulos que explicam cada desconto.",
    alternates: { canonical: `/marca/${page.brandNorm}` },
    robots: isFilteredView(page.filters) ? { index: false, follow: true } : undefined,
  };
}

export default async function BrandRoute({ params }: Params): Promise<ReactElement> {
  const { slug, filtros = [] } = await params;
  const page = await loadPage(slug, filtros.join("/"));
  if (page === null) {
    notFound();
  }
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={[{ name: page.name, path: `/marca/${page.brandNorm}` }]} />
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{page.name}</h1>
        <p className="mt-2 text-slate-700">
          {page.data.list.total === 1
            ? "1 produto com preço hoje."
            : `${page.data.list.total} produtos com preço hoje.`}
        </p>
      </div>
      <ProductListView
        basePath={`/marca/${page.brandNorm}`}
        filters={page.filters}
        data={page.data}
        withBrands={false}
      />
    </div>
  );
}
