import { SITE } from "./site";

/** A schema.org object for a <script type="application/ld+json">. */
export type JsonLd = Record<string, unknown>;

/** schema.org Organization for the site, in every page. */
export function organizationJsonLd(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.name,
    url: SITE.url,
    email: SITE.contactEmail,
  };
}

/**
 * JSON for a <script type="application/ld+json">. "<" is escaped, so text from the stores (product names) can never
 * close the script element; JSON.parse still reads it back unchanged.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
