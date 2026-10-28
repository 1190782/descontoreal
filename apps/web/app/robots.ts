import { SITE } from "@descontoreal/core";
import type { MetadataRoute } from "next";

/** Search results, account and admin pages, and category filter combinations stay out of search engines. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/pesquisa", "/admin", "/conta", "/entrar", "/api/", "/auth/", "/c/*/", "/marca/*/"],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  };
}
