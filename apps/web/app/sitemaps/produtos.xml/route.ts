import { calendarDaysBetween, isProductIndexable } from "@descontoreal/core";
import { getSitemapProducts } from "@descontoreal/db/web";
import { getQuery } from "@/lib/db";
import { urlSet, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-static";
export const revalidate = false;

/** Indexable products only (thin pages stay out), with the date of their last price change. */
export async function GET(): Promise<Response> {
  const now = new Date();
  const products = await getSitemapProducts(await getQuery());
  const indexable = products.filter((product) =>
    isProductIndexable({
      historyDays: calendarDaysBetween(product.firstPriceAt, now),
      storeCount: product.storeCount,
    }),
  );
  return xmlResponse(
    urlSet(indexable.map((product) => ({ path: `/p/${product.slug}`, lastModified: product.lastChangeAt }))),
  );
}
