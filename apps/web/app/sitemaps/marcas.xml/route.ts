import { getBrands } from "@descontoreal/db/web";
import { getQuery } from "@/lib/db";
import { urlSet, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-static";
export const revalidate = false;

export async function GET(): Promise<Response> {
  const brands = await getBrands(await getQuery());
  return xmlResponse(urlSet(brands.map((brand) => ({ path: `/marca/${brand.brandNorm}` }))));
}
