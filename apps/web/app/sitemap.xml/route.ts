import { sitemapIndex, xmlResponse } from "@/lib/sitemap";

export const dynamic = "force-static";

export function GET(): Response {
  return xmlResponse(sitemapIndex());
}
