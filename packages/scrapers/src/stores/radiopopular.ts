import { decimalToCents, parsePriceToCents } from "@descontoreal/core";
import { load } from "cheerio";
import type { Cheerio, CheerioAPI } from "cheerio";
import type { ListingObservation, ListingPage, ProductDetails, StoreCategory, StoreScraper } from "../types";
import { EXCLUDED_SUBCATEGORY, RADIOPOPULAR_CATEGORIES } from "./radiopopular.config";

// domhandler's AnyNode, which cheerio does not re-export and this package cannot import directly.
type DomNode = Parameters<CheerioAPI["contains"]>[0];
type Selection = Cheerio<DomNode>;

const LISTING_CARDS = "section.products.grid .viewport article.product-grid-module";
// Product pages also hold carousels of similar products whose cards are itemListElement items.
const MAIN_PRODUCT = '[itemscope][itemtype$="schema.org/Product"]:not([itemprop])';
const CARD = "article.product-grid-module";
const EXHIBITION_FLAG = ".flags-item.exhibition";
// The manufacturer's recommended price ("PVPR*", "-X% sobre PVPR") is shown without strike-through.
const CARD_RRP = ".old-price .no-strike";
const PRODUCT_RRP = ".mpup:not(.line-discount) .no-strike";
const PRODUCT_STRUCK_PRICE = ".mpup.line-discount";
// schema.org ItemAvailability values under which the item can be ordered now.
const ORDERABLE = new Set(["InStock", "LimitedAvailability", "PreOrder", "PreSale"]);
const CODE_ROW = "Código Produto";
const MODEL_ROW = "Modelo";
const BRAND_ROW = "Marca";
const IDENTIFIER_ROWS = new Set([BRAND_ROW, MODEL_ROW, CODE_ROW, "EAN"]);
const MIN_MODEL_CODE_LENGTH = 4;

// Listing traversal (docs/stores/radiopopular.md, "Percurso"): a listing URL shows only its first 12 items,
// and the next ones come from POST /ajax, which answers 429 to our bot. The site's own filtered and sorted
// URLs reach the rest.
const PAGE_SIZE = 12;
// Sorted by price, ascending and descending, two pages hold every item of a slice up to this size.
const PAIR_SIZE = 2 * PAGE_SIZE;
// Above this size, the A-Z and Z-A orders add two pages to a slice that is not split further.
const WIDE_SIZE = 4 * PAGE_SIZE;
const MIN_SUBCATEGORY_SHARE = 0.9;
const MIN_BRAND_SHARE = 0.5;
// Category filter values are paths, "Top|Family|Leaf|…", and the mapped categories are menu leaves.
const LEAF_DEPTH = 3;
const FILTERS_PARAM = "pf-filters";
const ORDER_PARAM = "pf-order";
const FILTER_TERM = /\((brand|category) eq '((?:[^']|'')*)'\)/g;
const LABEL_COUNT = /\((\d+)\)$/;

type Order = "relevance" | "price asc" | "price desc" | "displayText asc" | "displayText desc";
type SortedOrder = Exclude<Order, "relevance">;
const SORTED_ORDERS: ReadonlySet<string> = new Set<SortedOrder>([
  "price asc",
  "price desc",
  "displayText asc",
  "displayText desc",
]);

interface FacetValue {
  /** As the filter form sends it, apostrophes doubled ("T''nB"). */
  value: string;
  count: number;
}

interface ListingFacets {
  /** Items under the page's filters. */
  total: number;
  /** Counts under the page's other filters: a brand filter does not narrow its own facet. */
  brands: FacetValue[];
  /** Deepest sub-categories of the category, all of them whatever the page's sub-category filter. */
  subcategories: FacetValue[];
}

/** What a listing URL filters on and how it sorts. */
interface ListingState {
  brands: readonly string[];
  subcategories: readonly string[];
  order: Order;
}

/** Facet values read together, in each of `orders`; null orders for a large sub-category split by brand. */
interface Step {
  values: string[];
  orders: Order[] | null;
}

/** A page's place in its category's traversal. */
interface Walk {
  facets: ListingFacets;
  state: ListingState;
  url: (brands: readonly string[], subcategories: readonly string[], order: Order) => string;
}

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Elements carrying property `name` of the item `scope` itself, not of items nested in it. */
function itemProps($: CheerioAPI, scope: Selection, name: string): Selection {
  return scope
    .find(`[itemprop="${name}"]`)
    .filter((_, element) => $(element).parent().closest("[itemscope]").is(scope));
}

/** First value of a microdata property: its content attribute, else href, src or text. */
function itemValue($: CheerioAPI, scope: Selection, name: string): string | null {
  const element = itemProps($, scope, name).first();
  if (element.length === 0) {
    return null;
  }
  const value = element.attr("content") ?? element.attr("href") ?? element.attr("src") ?? element.text();
  return cleanText(value) || null;
}

function absoluteUrl(value: string | null, pageUrl: string): string | null {
  return value === null ? null : new URL(value, pageUrl).href;
}

function isOrderable(availability: string | null): boolean {
  return availability !== null && ORDERABLE.has(availability.slice(availability.lastIndexOf("/") + 1));
}

/** The struck-through price, kept only when it is above the price paid. */
function struckPriceCents(text: string, priceCents: number): number | null {
  const cents = parsePriceToCents(text);
  return cents !== null && cents > priceCents ? cents : null;
}

/** A price as shown ("€329,99", "PVPR* €579,99"); null when absent. */
function shownPriceCents(text: string): number | null {
  const cents = parsePriceToCents(text);
  return cents !== null && cents > 0 ? cents : null;
}

/** gtin13 as the store means it, or null for the internal codes of its own brands. */
function storeEan(gtin: string | null, storeSku: string): string | null {
  if (gtin === null) {
    return null;
  }
  // Barcodes are stored as numbers, so leading zeros are lost ("45496337292" is 0045496337292).
  const code = /^\d{9,12}$/.test(gtin) ? gtin.padStart(13, "0") : gtin;
  // Electronia, Princesse… get the store code, zeros and a check digit (1339128 → 1339128000005).
  const isInternal = code.startsWith(storeSku) && /^0+$/.test(code.slice(storeSku.length, -1));
  return isInternal ? null : code;
}

function isModelCode(text: string): boolean {
  return text.length >= MIN_MODEL_CODE_LENGTH && !/\s/.test(text) && /\p{L}/u.test(text) && /\d/.test(text);
}

/** Titles read "TYPE BRAND MODEL" ("TV LG 43LR60006LA"); null unless MODEL is a single code. */
function modelFromTitle(title: string, brand: string | null): string | null {
  if (brand === null) {
    return null;
  }
  const words = title.split(" ");
  const brandWords = brand.toUpperCase().split(" ");
  const start = words.findIndex((_, index) =>
    brandWords.every((brandWord, offset) => words[index + offset]?.toUpperCase() === brandWord),
  );
  const rest = start === -1 ? [] : words.slice(start + brandWords.length);
  const [model] = rest;
  return rest.length === 1 && model !== undefined && isModelCode(model) ? model : null;
}

function parseCard($: CheerioAPI, card: Selection, pageUrl: string): ListingObservation | null {
  const storeSku = itemValue($, card, "sku");
  const title = itemValue($, card, "name");
  const url = absoluteUrl(itemValue($, card, "url"), pageUrl);
  const offer = itemProps($, card, "offers").first();
  const priceCents = decimalToCents(itemValue($, offer, "price"));
  // Display units share the SKU of the new item but sell open-box.
  if (
    storeSku === null ||
    title === null ||
    url === null ||
    priceCents === null ||
    card.find(EXHIBITION_FLAG).length > 0
  ) {
    return null;
  }
  const brand = itemValue($, itemProps($, card, "brand").first(), "name");
  return {
    storeSku,
    url,
    title,
    priceCents,
    referencePriceCents: struckPriceCents(card.find(".old-price.strike").first().text(), priceCents),
    rrpCents: shownPriceCents(card.find(CARD_RRP).text()),
    inStock: isOrderable(itemValue($, offer, "availability")),
    sellerName: null,
    ean: storeEan(itemValue($, card, "gtin13"), storeSku),
    brand,
    model: modelFromTitle(title, brand),
    imageUrl: absoluteUrl(itemValue($, card, "image"), pageUrl),
  };
}

function compareText(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function itemCount(values: readonly FacetValue[]): number {
  return values.reduce((sum, value) => sum + value.count, 0);
}

function isSortedOrder(order: string): order is SortedOrder {
  return SORTED_ORDERS.has(order);
}

/** Values of one filter of the listing's filter form, with the counts their labels show ("AEG (31)"). */
function facetValues($: CheerioAPI, name: string): FacetValue[] {
  const counts = new Map<string, number>();
  $(`#filters input[name="${name}"]`).each((_, input) => {
    const value = $(input).attr("value");
    const count = Number(LABEL_COUNT.exec(cleanText($(input).closest("a").text()))?.[1]);
    if (value !== undefined && value !== "" && count > 0 && !counts.has(value)) {
      counts.set(value, count);
    }
  });
  return [...counts].map(([value, count]) => ({ value, count }));
}

/** The deepest category paths below the leaf; of a leaf filed under two families, the copy split the most. */
function deepestSubcategories(paths: readonly FacetValue[]): FacetValue[] {
  const isDeepest = (path: string): boolean => !paths.some((other) => other.value.startsWith(`${path}|`));
  const leaves = paths
    .map((path) => path.value)
    .filter((path) => path.split("|").length === LEAF_DEPTH)
    .sort(compareText);
  let deepest: FacetValue[] = [];
  for (const leaf of leaves) {
    const below = paths.filter((path) => path.value.startsWith(`${leaf}|`) && isDeepest(path.value));
    if (below.length > deepest.length) {
      deepest = below;
    }
  }
  return deepest;
}

function readFacets($: CheerioAPI): ListingFacets {
  const total = Number($("[data-products-total]").first().attr("data-products-total"));
  return {
    total: Number.isSafeInteger(total) ? total : 0,
    brands: facetValues($, "brand"),
    subcategories: deepestSubcategories(facetValues($, "category")),
  };
}

function listingState(pageUrl: string): ListingState {
  const params = new URL(pageUrl).searchParams;
  const brands: string[] = [];
  const subcategories: string[] = [];
  for (const [, field, value] of (params.get(FILTERS_PARAM) ?? "").matchAll(FILTER_TERM)) {
    (field === "brand" ? brands : subcategories).push(value ?? "");
  }
  const order = params.get(ORDER_PARAM) ?? "";
  return {
    brands: brands.sort(compareText),
    subcategories: subcategories.sort(compareText),
    order: isSortedOrder(order) ? order : "relevance",
  };
}

function filterClause(field: "brand" | "category", values: readonly string[]): string | null {
  const terms = values.map((value) => `(${field} eq '${value}')`);
  return terms.length > 1 ? `(${terms.join(" or ")})` : (terms[0] ?? null);
}

/** The URL the site's filter form and order menu give, e.g. ?pf-filters=((brand eq 'AEG'))&pf-order=price asc. */
function listingUrl(categoryUrl: string, state: ListingState): string {
  const url = new URL(categoryUrl);
  url.search = "";
  const clauses = [filterClause("brand", state.brands), filterClause("category", state.subcategories)].filter(
    (clause) => clause !== null,
  );
  if (clauses.length > 0) {
    url.searchParams.set(FILTERS_PARAM, `(${clauses.join(" and ")})`);
  }
  if (state.order !== "relevance") {
    url.searchParams.set(ORDER_PARAM, state.order);
  }
  return url.href;
}

/** Orders that read every item of a group: one page, or the cheapest and the dearest 12. */
function groupOrders(count: number): Order[] {
  return count <= PAGE_SIZE ? ["relevance"] : ["price asc", "price desc"];
}

/** Orders for a slice read without splitting it; price desc, when read, is always last. */
function sliceOrders(count: number): Order[] {
  if (count <= PAGE_SIZE) {
    return ["relevance"];
  }
  if (count <= WIDE_SIZE) {
    return ["relevance", "price asc", "price desc"];
  }
  return ["relevance", "price asc", "displayText asc", "displayText desc", "price desc"];
}

function orderAfter(orders: readonly Order[], order: Order): Order | null {
  const index = orders.indexOf(order);
  return index === -1 ? null : (orders[index + 1] ?? null);
}

function firstOrder(step: Step): Order {
  return step.orders?.[0] ?? "relevance";
}

/** Groups neighbouring values of up to 24 items in all, choosing the groups that take the fewest requests. */
function packValues(values: readonly FacetValue[]): Step[] {
  const requests = [0];
  const starts = [0];
  for (let end = 1; end <= values.length; end += 1) {
    let items = 0;
    let fewest = Number.POSITIVE_INFINITY;
    let start = end - 1;
    for (let from = end - 1; from >= 0; from -= 1) {
      items += values[from]?.count ?? 0;
      if (items > PAIR_SIZE) {
        break;
      }
      const total = (requests[from] ?? 0) + groupOrders(items).length;
      if (total < fewest) {
        fewest = total;
        start = from;
      }
    }
    requests.push(fewest);
    starts.push(start);
  }
  const steps: Step[] = [];
  for (let end = values.length; end > 0; end = starts[end] ?? 0) {
    const group = values.slice(starts[end] ?? 0, end);
    steps.unshift({ values: group.map((value) => value.value), orders: groupOrders(itemCount(group)) });
  }
  return steps;
}

/**
 * Steps over one facet, in value order: each value of more than 24 items on its own, the others packed into
 * groups. With `splitLarge`, large values get null orders: their own pages decide how to read them.
 */
function planSteps(values: readonly FacetValue[], splitLarge: boolean): Step[] {
  const steps: Step[] = [];
  let run: FacetValue[] = [];
  for (const value of [...values].sort((a, b) => compareText(a.value, b.value))) {
    if (value.count <= PAIR_SIZE) {
      run.push(value);
      continue;
    }
    steps.push(...packValues(run), {
      values: [value.value],
      orders: splitLarge ? null : sliceOrders(value.count),
    });
    run = [];
  }
  return [...steps, ...packValues(run)];
}

function subcategorySteps(facets: ListingFacets): Step[] {
  const kept = facets.subcategories.filter(
    (subcategory) =>
      !EXCLUDED_SUBCATEGORY.test(subcategory.value.slice(subcategory.value.lastIndexOf("|") + 1)),
  );
  return planSteps(kept, true);
}

/**
 * The next URL of a plan, from a page filtered on `values`: `within` the current step, else the next step,
 * else `end`. Values that a count change regrouped since the previous page go on with the first step that
 * holds a later value, so every move goes forward.
 */
function nextInPlan(
  steps: readonly Step[],
  values: readonly string[],
  within: (step: Step) => string | null,
  start: (step: Step) => string,
  end: string | null,
): string | null {
  const index = steps.findIndex((step) => sameValues(step.values, values));
  const current = steps[index];
  if (current !== undefined) {
    const next = within(current);
    if (next !== null) {
      return next;
    }
    const following = steps[index + 1];
    return following === undefined ? end : start(following);
  }
  const last = values[values.length - 1] ?? "";
  const following = steps.find((step) => compareText(step.values[step.values.length - 1] ?? "", last) > 0);
  return following === undefined ? end : start(following);
}

/** A category's first page: split it by sub-category, else by brand, else read it in more orders. */
function firstStepUrl(walk: Walk): string | null {
  const { facets } = walk;
  const firstPart = subcategorySteps(facets)[0];
  const splitBySubcategory =
    facets.subcategories.length > 1 &&
    itemCount(facets.subcategories) >= MIN_SUBCATEGORY_SHARE * facets.total;
  if (splitBySubcategory && firstPart !== undefined) {
    return walk.url([], firstPart.values, firstOrder(firstPart));
  }
  const firstBrands = planSteps(facets.brands, false)[0];
  if (firstBrands !== undefined && itemCount(facets.brands) >= MIN_BRAND_SHARE * facets.total) {
    return walk.url(firstBrands.values, [], firstOrder(firstBrands));
  }
  const order = orderAfter(sliceOrders(facets.total), "relevance");
  return order === null ? null : walk.url([], [], order);
}

/**
 * A large sub-category: its first page shows how its items split by brand, and its last page, sorted by price
 * desc, shows every sub-category again. When brands cover too little of it, it is read in more orders.
 */
function nextInLargeSubcategory(walk: Walk, part: Step): string | null {
  const { facets, state } = walk;
  const firstBrands = planSteps(facets.brands, false)[0];
  if (
    state.order === "relevance" &&
    firstBrands !== undefined &&
    itemCount(facets.brands) >= MIN_BRAND_SHARE * facets.total
  ) {
    return walk.url(firstBrands.values, part.values, firstOrder(firstBrands));
  }
  const order = orderAfter(sliceOrders(facets.total), state.order);
  return order === null ? null : walk.url([], part.values, order);
}

/** The next listing URL of a category's traversal; null after its last page. */
function nextListingUrl(walk: Walk): string | null {
  const { facets, state } = walk;
  if (state.subcategories.length > 0 && state.brands.length > 0) {
    return nextInPlan(
      planSteps(facets.brands, false),
      state.brands,
      (step) => {
        const order = orderAfter(step.orders ?? [], state.order);
        return order === null ? null : walk.url(step.values, state.subcategories, order);
      },
      (step) => walk.url(step.values, state.subcategories, firstOrder(step)),
      walk.url([], state.subcategories, "price desc"),
    );
  }
  if (state.subcategories.length > 0) {
    return nextInPlan(
      subcategorySteps(facets),
      state.subcategories,
      (step) => {
        if (step.orders === null) {
          return nextInLargeSubcategory(walk, step);
        }
        const order = orderAfter(step.orders, state.order);
        return order === null ? null : walk.url([], step.values, order);
      },
      (step) => walk.url([], step.values, firstOrder(step)),
      null,
    );
  }
  if (state.brands.length > 0) {
    return nextInPlan(
      planSteps(facets.brands, false),
      state.brands,
      (step) => {
        const order = orderAfter(step.orders ?? [], state.order);
        return order === null ? null : walk.url(step.values, [], order);
      },
      (step) => walk.url(step.values, [], firstOrder(step)),
      null,
    );
  }
  if (state.order === "relevance" && facets.total > PAIR_SIZE) {
    return firstStepUrl(walk);
  }
  const order = orderAfter(sliceOrders(facets.total), state.order);
  return order === null ? null : walk.url([], [], order);
}

function parseListingPage(body: string, pageUrl: string, category: StoreCategory): ListingPage {
  const $ = load(body);
  const items = $(LISTING_CARDS)
    .toArray()
    .flatMap((card) => {
      const item = parseCard($, $(card), pageUrl);
      return item === null ? [] : [item];
    });
  const walk: Walk = {
    facets: readFacets($),
    state: listingState(pageUrl),
    url: (brands, subcategories, order) => listingUrl(category.url, { brands, subcategories, order }),
  };
  return { items, nextPageUrl: nextListingUrl(walk) };
}

/** "Características" rows, label → value; the first row wins when a label repeats across groups. */
function characteristics($: CheerioAPI): Map<string, string> {
  const rows = new Map<string, string>();
  $("#_characteristics .characteristic-group").each((_, row) => {
    const label = cleanText($(row).find(".designation").first().text());
    const value = cleanText($(row).find(".value").first().text());
    if (label !== "" && value !== "" && !rows.has(label)) {
      rows.set(label, value);
    }
  });
  return rows;
}

/** "Código Produto" is the maker's reference, except on own brands where it repeats the store SKU. */
function productModel(
  rows: Map<string, string>,
  title: string,
  brand: string | null,
  storeSku: string,
): string | null {
  const candidates = [rows.get(CODE_ROW) ?? null, rows.get(MODEL_ROW) ?? null, modelFromTitle(title, brand)];
  return (
    candidates.find((candidate) => candidate !== null && candidate !== storeSku && isModelCode(candidate)) ??
    null
  );
}

function parseProductPage(body: string, pageUrl: string): ProductDetails {
  const $ = load(body);
  const product = $(MAIN_PRODUCT).first();
  const storeSku = itemValue($, product, "sku");
  const title = itemValue($, product, "name");
  if (storeSku === null || title === null) {
    throw new Error("Radio Popular product microdata (sku, name) not found");
  }
  const rows = characteristics($);
  const brand = rows.get(BRAND_ROW) ?? itemValue($, itemProps($, product, "brand").first(), "name");
  const offer = itemProps($, product, "offers").first();
  const isExhibitionUnit =
    $(EXHIBITION_FLAG).filter((_, flag) => $(flag).closest(CARD).length === 0).length > 0;
  const priceCents = isExhibitionUnit ? null : decimalToCents(itemValue($, offer, "price"));
  const availability = itemValue($, offer, "availability");
  return {
    storeSku,
    url: absoluteUrl(itemValue($, product, "url"), pageUrl) ?? pageUrl,
    title,
    ean: storeEan(itemValue($, product, "gtin13") ?? rows.get("EAN") ?? null, storeSku),
    brand,
    model: productModel(rows, title, brand, storeSku),
    imageUrl: absoluteUrl(itemValue($, product, "image"), pageUrl),
    specs: Object.fromEntries([...rows].filter(([label]) => !IDENTIFIER_ROWS.has(label))),
    sellerName: null,
    priceCents,
    referencePriceCents:
      priceCents === null ? null : struckPriceCents($(PRODUCT_STRUCK_PRICE).first().text(), priceCents),
    rrpCents: priceCents === null ? null : shownPriceCents($(PRODUCT_RRP).first().text()),
    inStock: isExhibitionUnit || availability === null ? null : isOrderable(availability),
  };
}

export const radiopopular: StoreScraper = {
  slug: "radiopopular",
  name: "Radio Popular",
  baseUrl: "https://www.radiopopular.pt",
  // Listings are read through filters and price-sorted pages, never all of them: an item still on sale can drop
  // out of the pages read for a day or two (docs/stores/radiopopular.md, "Artigos que deixam de aparecer").
  maxMissedRuns: 7,
  listCategories: () => RADIOPOPULAR_CATEGORIES,
  parseListingPage: (body, url, category) => parseListingPage(body, url, category),
  parseProductPage: (body, url) => parseProductPage(body, url),
  // Radio Popular has no marketplace: every item is sold by the store (docs/stores/radiopopular.md).
  isSoldByStore: () => true,
};
