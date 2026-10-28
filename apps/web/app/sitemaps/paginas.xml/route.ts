import { CATEGORIES } from "@descontoreal/core";
import { getCategoryCounts } from "@descontoreal/db/web";
import { getQuery } from "@/lib/db";
import { urlSet, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-static";
export const revalidate = false;

const STATIC_PAGES = ["/", "/como-funciona", "/bot", "/privacidade", "/termos", "/cookies", "/afiliacao"];

/** The fixed pages, and the categories with products on sale (a top category when any child has some). */
export async function GET(): Promise<Response> {
  const counts = await getCategoryCounts(await getQuery());
  const withProducts = new Set(counts.filter((count) => count.products > 0).map((count) => count.slug));
  const categories = CATEGORIES.filter(
    (category) =>
      withProducts.has(category.slug) ||
      CATEGORIES.some((child) => child.parent === category.slug && withProducts.has(child.slug)),
  );
  return xmlResponse(
    urlSet([
      ...STATIC_PAGES.map((path) => ({ path })),
      ...categories.map((category) => ({ path: `/c/${category.slug}` })),
    ]),
  );
}
