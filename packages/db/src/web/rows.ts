import {
  isCategorySlug,
  isLabelCode,
  isStoreSlug,
  type LabelNumbers,
  type LabelTone,
  type LabelWarning,
  type PriceInterval,
  type StoreSlug,
} from "@descontoreal/core";
import type { CardLabel, ListingLabel, PageCategory } from "./types";

/** price_points as json_build_object writes it (timestamps as ISO text). */
export interface IntervalJson {
  priceCents: number;
  referencePriceCents: number | null;
  inStock: boolean;
  validFrom: string;
  validTo: string | null;
}

/** listing_stats.details: the core Classification that justifies the label. */
export interface ClassificationJson {
  label: string;
  labelName: string;
  text: string;
  tone: LabelTone;
  warnings: LabelWarning[];
  numbers: LabelNumbers;
}

export interface CategoryJson {
  slug: string;
  name: string;
  parent: { slug: string; name: string } | null;
}

export function toInterval(json: IntervalJson): PriceInterval {
  return {
    priceCents: json.priceCents,
    referencePriceCents: json.referencePriceCents,
    inStock: json.inStock,
    validFrom: new Date(json.validFrom),
    validTo: json.validTo === null ? null : new Date(json.validTo),
  };
}

export function toStoreSlug(value: string): StoreSlug {
  if (!isStoreSlug(value)) {
    throw new Error(`Store "${value}" is not in core STORES.`);
  }
  return value;
}

/** The listing's label when it was computed for `currentPriceCents`; null otherwise or for an unknown code. */
export function toListingLabel(
  details: ClassificationJson | null,
  statsPriceCents: number | null,
  currentPriceCents: number | null,
): ListingLabel | null {
  if (details === null || statsPriceCents === null || statsPriceCents !== currentPriceCents) {
    return null;
  }
  if (!isLabelCode(details.label)) {
    return null;
  }
  return {
    code: details.label,
    name: details.labelName,
    tone: details.tone,
    text: details.text,
    warnings: details.warnings,
    numbers: details.numbers,
  };
}

/** The part of a label a product card shows. */
export function toCardLabel(details: ClassificationJson | null): CardLabel | null {
  if (details === null || !isLabelCode(details.label)) {
    return null;
  }
  return { code: details.label, name: details.labelName, tone: details.tone, text: details.text };
}

export function toCategory(json: CategoryJson | null): PageCategory | null {
  if (json === null || !isCategorySlug(json.slug)) {
    return null;
  }
  const parentSlug = json.parent?.slug;
  return {
    slug: json.slug,
    name: json.name,
    parent:
      json.parent !== null && parentSlug !== undefined && isCategorySlug(parentSlug)
        ? { slug: parentSlug, name: json.parent.name }
        : null,
  };
}
