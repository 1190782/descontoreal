import { SITE } from "@descontoreal/core";

export interface SitemapEntry {
  /** Site path, e.g. "/p/samsung-ww90t534dae". */
  path: string;
  lastModified?: Date;
}

/** Child sitemaps listed by /sitemap.xml. */
export const SITEMAP_FILES = [
  "/sitemaps/paginas.xml",
  "/sitemaps/marcas.xml",
  "/sitemaps/produtos.xml",
] as const;

const XML_ENTITIES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

/** A <urlset> of absolute addresses, with lastmod as a date when known. */
export function urlSet(entries: readonly SitemapEntry[]): string {
  const urls = entries.map((entry) => {
    const lastmod =
      entry.lastModified === undefined
        ? ""
        : `<lastmod>${entry.lastModified.toISOString().slice(0, 10)}</lastmod>`;
    return `<url><loc>${escapeXml(`${SITE.url}${entry.path}`)}</loc>${lastmod}</url>`;
  });
  return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
}

/** The <sitemapindex> pointing at SITEMAP_FILES. */
export function sitemapIndex(): string {
  const sitemaps = SITEMAP_FILES.map(
    (path) => `<sitemap><loc>${escapeXml(`${SITE.url}${path}`)}</loc></sitemap>`,
  );
  return xml(
    `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemaps.join("")}</sitemapindex>`,
  );
}

export function xmlResponse(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
}

function xml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`;
}

function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => XML_ENTITIES[character] ?? character);
}
