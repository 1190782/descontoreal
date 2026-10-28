import type { Offer, PriceAt } from "./insights";
import { SUMMARY_DAYS } from "./insights";
import { daysBefore } from "./intervals";
import { centsToDecimal, formatCents } from "./money";
import { SITE } from "./site";
import { formatList } from "./text";
import { formatDatePt } from "./time";

/** A schema.org object for a <script type="application/ld+json">. */
export type JsonLd = Record<string, unknown>;

export interface ProductJsonLdInput {
  name: string;
  /** Absolute address of the product page. */
  url: string;
  imageUrl: string | null;
  brand: string | null;
  ean: string | null;
  /** Today's offers (currentOffers). */
  offers: readonly Offer[];
}

export interface ProductDescriptionInput {
  name: string;
  /** The cheapest current offer. */
  best: Offer | null;
  /** Lowest price over the last 90 days, or since tracking started when that is more recent. */
  lowest: PriceAt | null;
  trackedSince: Date | null;
  /** Stores with a listing of the product. */
  storeNames: readonly string[];
  now: Date;
}

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
 * schema.org Product with an AggregateOffer of today's prices. Null without a current offer: Google reads a product
 * snippet only with offers, reviews or ratings, and the site has no price to state then.
 */
export function productJsonLd(input: ProductJsonLdInput): JsonLd | null {
  const prices = input.offers.map((offer) => offer.priceCents);
  if (prices.length === 0) {
    return null;
  }
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: input.name,
    url: input.url,
    ...(input.imageUrl === null ? {} : { image: [input.imageUrl] }),
    ...(input.brand === null ? {} : { brand: { "@type": "Brand", name: input.brand } }),
    ...(input.ean === null ? {} : { gtin13: input.ean }),
    offers: {
      "@type": "AggregateOffer",
      priceCurrency: "EUR",
      lowPrice: centsToDecimal(Math.min(...prices)),
      highPrice: centsToDecimal(Math.max(...prices)),
      offerCount: prices.length,
      availability: "https://schema.org/InStock",
    },
  };
}

/** schema.org BreadcrumbList; `url` is absolute. */
export function breadcrumbJsonLd(items: readonly { name: string; url: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/** "Samsung WW90T534DAE: histórico de preço e melhor preço hoje". */
export function productTitle(name: string): string {
  return `${name}: histórico de preço e melhor preço hoje`;
}

/**
 * The meta description of a product page, with numbers: "Mais barato hoje: 449,99 € na Darty. Mínimo dos últimos
 * 90 dias: 429,99 €." Without a current offer it names the stores the history comes from.
 */
export function productDescription(input: ProductDescriptionInput): string {
  if (input.best === null) {
    const stores = formatList(input.storeNames.map((name) => `na ${name}`));
    return `Histórico de preço de ${input.name} ${stores}, atualizado todos os dias.`;
  }
  const today = `Mais barato hoje: ${formatCents(input.best.priceCents)} na ${input.best.storeName}.`;
  if (input.lowest === null || input.trackedSince === null) {
    return today;
  }
  const window =
    input.trackedSince.getTime() > daysBefore(input.now, SUMMARY_DAYS).getTime()
      ? `desde ${formatDatePt(input.trackedSince)}`
      : `dos últimos ${SUMMARY_DAYS} dias`;
  return `${today} Mínimo ${window}: ${formatCents(input.lowest.priceCents)}.`;
}

/**
 * JSON for a <script type="application/ld+json">. "<" is escaped, so text from the stores (product names) can never
 * close the script element; JSON.parse still reads it back unchanged.
 */
export function serializeJsonLd(data: JsonLd | JsonLd[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
