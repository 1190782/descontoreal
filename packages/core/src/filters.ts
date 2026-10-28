import { isLabelCode } from "./labels/names";
import type { LabelCode } from "./labels/types";
import { isStoreSlug, type StoreSlug } from "./stores";

/** Price ranges offered as filters; bounds in cents, the minimum included and the maximum excluded. */
export const PRICE_BUCKETS = [
  { slug: "ate-100", minCents: null, maxCents: 10_000, label: "Até 100 €" },
  { slug: "100-250", minCents: 10_000, maxCents: 25_000, label: "100 € a 250 €" },
  { slug: "250-500", minCents: 25_000, maxCents: 50_000, label: "250 € a 500 €" },
  { slug: "500-1000", minCents: 50_000, maxCents: 100_000, label: "500 € a 1000 €" },
  { slug: "mais-de-1000", minCents: 100_000, maxCents: null, label: "Mais de 1000 €" },
] as const;

export type PriceBucketSlug = (typeof PRICE_BUCKETS)[number]["slug"];

/** "desconto": biggest real discount first (the default); "preco": cheapest first; "preco-desc": dearest first. */
export type SortOrder = "desconto" | "preco" | "preco-desc";

/** A product list's filters, written in the path (/c/televisores/marca-lg/pagina-2) so each view can be cached. */
export interface ListFilters {
  /** products.brand_norm */
  brand: string | null;
  store: StoreSlug | null;
  label: LabelCode | null;
  price: PriceBucketSlug | null;
  sort: SortOrder;
  /** 1-based. */
  page: number;
}

export const DEFAULT_FILTERS: ListFilters = {
  brand: null,
  store: null,
  label: null,
  price: null,
  sort: "desconto",
  page: 1,
};

const SORT_ORDERS: readonly SortOrder[] = ["desconto", "preco", "preco-desc"];
const KINDS = ["marca", "loja", "rotulo", "preco", "ordem", "pagina"] as const;
// Pages past this are never linked; a crawler inventing them gets a 404 instead of an empty page.
const MAX_PAGE = 999;

type Kind = (typeof KINDS)[number];

/** "desconto_real" → "desconto-real". */
export function labelSlug(code: LabelCode): string {
  return code.replace(/_/g, "-");
}

/** "desconto-real" → "desconto_real"; null for anything else. */
export function labelFromSlug(slug: string): LabelCode | null {
  const code = slug.replace(/-/g, "_");
  return !slug.includes("_") && isLabelCode(code) ? code : null;
}

/**
 * Reads the filter segments of a list's path. Each kind appears at most once, in the order filterSegments writes
 * them, and defaults are never written ("ordem-desconto", "pagina-1"): any other path gets null (a 404), so each
 * view has exactly one address.
 */
export function parseFilterSegments(segments: readonly string[]): ListFilters | null {
  const filters: ListFilters = { ...DEFAULT_FILTERS };
  let lastKind = -1;
  for (const segment of segments) {
    const parsed = parseSegment(segment);
    const kind = parsed === null ? -1 : KINDS.indexOf(parsed.kind);
    if (parsed === null || kind <= lastKind || !applySegment(filters, parsed.kind, parsed.value)) {
      return null;
    }
    lastKind = kind;
  }
  return filters;
}

/** The path segments of `filters`, in canonical order, without defaults. */
export function filterSegments(filters: ListFilters): string[] {
  const segments: string[] = [];
  if (filters.brand !== null) {
    segments.push(`marca-${filters.brand}`);
  }
  if (filters.store !== null) {
    segments.push(`loja-${filters.store}`);
  }
  if (filters.label !== null) {
    segments.push(`rotulo-${labelSlug(filters.label)}`);
  }
  if (filters.price !== null) {
    segments.push(`preco-${filters.price}`);
  }
  if (filters.sort !== DEFAULT_FILTERS.sort) {
    segments.push(`ordem-${filters.sort}`);
  }
  if (filters.page !== DEFAULT_FILTERS.page) {
    segments.push(`pagina-${filters.page}`);
  }
  return segments;
}

/** True when the list shows anything but its first page with the default order: such views are not indexed. */
export function isFilteredView(filters: ListFilters): boolean {
  return filterSegments(filters).length > 0;
}

function parseSegment(segment: string): { kind: Kind; value: string } | null {
  const dash = segment.indexOf("-");
  const kind = KINDS.find((candidate) => candidate === segment.slice(0, dash));
  const value = segment.slice(dash + 1);
  return dash <= 0 || kind === undefined || value === "" ? null : { kind, value };
}

/** Writes one segment into `filters`; false when its value is not valid or is a default. */
function applySegment(filters: ListFilters, kind: Kind, value: string): boolean {
  switch (kind) {
    case "marca":
      filters.brand = /^[a-z0-9]+$/.test(value) ? value : null;
      return filters.brand !== null;
    case "loja":
      filters.store = isStoreSlug(value) ? value : null;
      return filters.store !== null;
    case "rotulo":
      filters.label = labelFromSlug(value);
      return filters.label !== null;
    case "preco":
      filters.price = PRICE_BUCKETS.find((bucket) => bucket.slug === value)?.slug ?? null;
      return filters.price !== null;
    case "ordem": {
      const sort = SORT_ORDERS.find((order) => order === value);
      if (sort === undefined || sort === DEFAULT_FILTERS.sort) {
        return false;
      }
      filters.sort = sort;
      return true;
    }
    case "pagina": {
      const page = /^[1-9][0-9]*$/.test(value) ? Number(value) : 0;
      if (page < 2 || page > MAX_PAGE) {
        return false;
      }
      filters.page = page;
      return true;
    }
  }
}
