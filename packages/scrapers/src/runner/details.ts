import {
  getCategory,
  normalizeBrand,
  normalizeGtin,
  normalizeModel,
  productSlugBase,
} from "@descontoreal/core";
import type { ListingDetailsInput } from "@descontoreal/db";
import type { ListingObservation, ProductDetails, StoreCategory } from "../types";

/** Product facts as read from a listing page or a product page. */
export interface ProductFacts {
  title: string;
  ean: string | null;
  brand: string | null;
  model: string | null;
  imageUrl: string | null;
  specs: Record<string, string>;
}

/** Facts some stores already show on listing pages; listings never carry specifications. */
export function factsFromListing(item: ListingObservation): ProductFacts {
  return {
    title: item.title,
    ean: item.ean ?? null,
    brand: item.brand ?? null,
    model: item.model ?? null,
    imageUrl: item.imageUrl ?? null,
    specs: {},
  };
}

/** Facts from a product page; the listing title stands in when the page has none. */
export function factsFromProductPage(details: ProductDetails, listingTitle: string): ProductFacts {
  return {
    title: details.title.trim() || listingTitle,
    ean: details.ean,
    brand: details.brand,
    model: details.model,
    imageUrl: details.imageUrl,
    specs: details.specs,
  };
}

/** Input for db.saveListingDetails: EAN validated, brand and model normalized, product slug base built. */
export function buildListingDetails(
  listingId: number,
  facts: ProductFacts,
  category: StoreCategory,
  soldByStore: boolean,
): ListingDetailsInput {
  const rawEan = cleanText(facts.ean);
  const brand = cleanText(facts.brand);
  const model = cleanText(facts.model);
  const name = facts.title.trim();
  return {
    listingId,
    rawEan,
    ean: normalizeGtin(rawEan),
    brand,
    model,
    brandNorm: normalizeBrand(brand),
    modelNorm: normalizeModel(model),
    name,
    slugBase: productSlugBase({
      brand,
      model,
      name,
      categorySingular: getCategory(category.categorySlug).singular ?? null,
    }),
    categorySlug: category.categorySlug,
    imageUrl: cleanText(facts.imageUrl),
    specs: facts.specs,
    soldByStore,
  };
}

function cleanText(value: string | null): string | null {
  return value?.trim() || null;
}
