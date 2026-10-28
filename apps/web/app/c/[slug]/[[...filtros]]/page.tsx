import {
  activeStores,
  CATEGORIES,
  categoryAndChildren,
  type Category,
  formatList,
  getCategory,
  isCategorySlug,
  isFilteredView,
  type ListFilters,
  parseFilterSegments,
} from "@descontoreal/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactElement } from "react";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { ProductListView } from "@/components/product-list-view";
import { type ListData, loadList } from "@/lib/list-data";

interface Params {
  params: Promise<{ slug: string; filtros?: string[] }>;
}

export const revalidate = false;

export function generateStaticParams(): { slug: string; filtros: string[] }[] {
  return [];
}

interface CategoryPage {
  category: Category;
  filters: ListFilters;
  data: ListData;
}

/** The category and filters in the path; null when either is not valid (a 404). */
const loadPage = cache(async (slug: string, segments: string): Promise<CategoryPage | null> => {
  const filters = parseFilterSegments(segments === "" ? [] : segments.split("/"));
  if (!isCategorySlug(slug) || filters === null) {
    return null;
  }
  const data = await loadList({ categories: categoryAndChildren(slug) }, filters, new Date());
  if (filters.page > data.pageCount) {
    return null;
  }
  return { category: getCategory(slug), filters, data };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug, filtros = [] } = await params;
  const page = await loadPage(slug, filtros.join("/"));
  if (page === null) {
    return { title: "Página não encontrada" };
  }
  const { category, filters, data } = page;
  const stores = formatList(activeStores().map((store) => `na ${store.name}`));
  return {
    title: `${category.name}: preços e descontos de hoje`,
    description:
      `Preço de hoje de ${data.list.total} produtos de ${category.name.toLowerCase()} ${stores}, com o histórico de ` +
      "cada loja e rótulos que explicam cada desconto.",
    alternates: { canonical: `/c/${category.slug}` },
    robots: isFilteredView(filters) || data.list.total === 0 ? { index: false, follow: true } : undefined,
  };
}

export default async function CategoryRoute({ params }: Params): Promise<ReactElement> {
  const { slug, filtros = [] } = await params;
  const page = await loadPage(slug, filtros.join("/"));
  if (page === null) {
    notFound();
  }
  const { category, filters, data } = page;
  const parent =
    category.parent === null ? undefined : CATEGORIES.find((other) => other.slug === category.parent);
  const children = CATEGORIES.filter((other) => other.parent === category.slug);
  const crumbs: Crumb[] = [
    ...(parent === undefined ? [] : [{ name: parent.name, path: `/c/${parent.slug}` }]),
    { name: category.name, path: `/c/${category.slug}` },
  ];
  return (
    <div className="space-y-6">
      <div>
        <Breadcrumbs items={crumbs} />
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">{category.name}</h1>
        <p className="mt-2 text-slate-700">
          {data.list.total === 1
            ? "1 produto com preço hoje."
            : `${data.list.total} produtos com preço hoje.`}
        </p>
      </div>
      {children.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label="Subcategorias">
          {children.map((child) => (
            <li key={child.slug}>
              <Link
                href={`/c/${child.slug}`}
                prefetch={false}
                className="inline-block rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-800 hover:border-indigo-700 hover:text-indigo-700"
              >
                {child.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <ProductListView basePath={`/c/${category.slug}`} filters={filters} data={data} withBrands />
    </div>
  );
}
