import { decimalToCents, normalizeGtin, parsePriceToCents } from "@descontoreal/core";
import { type CheerioAPI, load } from "cheerio";
import { z } from "zod";
import type { ListingObservation, ListingPage, ProductDetails, StoreCategory, StoreScraper } from "../types";
import { DARTY_BASE_URL, DARTY_CATEGORIES, DARTY_INACTIVE_CATEGORIES, DARTY_PAGE_SIZE } from "./darty.config";

// Shopify's page size when the URL has no limit.
const SHOPIFY_DEFAULT_LIMIT = 30;
const SINGLE_VARIANT_TITLE = "Default Title";
const OUTLET = /\boutlet\b|\bgrade [a-d]\b|recondicionad|seminov/;
// Darty spells it "Não Indentificado".
const UNKNOWN_BRAND = /^n[aã]o in?dentificad/i;
const HANDLE_EAN = /-(\d{12,14})$/;
const IN_STOCK_AVAILABILITY = new Set(["InStock", "LimitedAvailability", "OnlineOnly"]);

// Letters of measures, capacities and units that follow a number in titles ("140cm", "9kg", "4K", "256GB").
const UNITS =
  "a ah bar bit bits btu btus cl cm db fps g gb ghz h hz k kg khz kw kwh l lm lt m mah mb mhz min ml mm mp mpx nits p pol rpm tb v w wh x";
const UNIT_LETTERS = new Set(UNITS.split(" "));
// Processors, graphics cards and standards: letters and digits, but not the product's model.
const NOT_A_MODEL =
  /^(?:[ir][3579]-\d{4,5}[a-z]{0,3}|(?:rtx|gtx|rx)-?\d{3,4}\w*|(?:hdr|hdmi|usb|ddr|lpddr|gddr|pcie|nvme|dvb)[-\d.]\S*)$/i;

const priceSchema = z.union([z.string(), z.number()]);

const variantSchema = z.object({
  id: z.number(),
  title: z.string(),
  sku: z.string().nullish(),
  available: z.boolean(),
  price: priceSchema,
  compare_at_price: priceSchema.nullish(),
  featured_image: z.object({ src: z.string() }).nullish(),
});

const productSchema = z.object({
  title: z.string(),
  handle: z.string(),
  vendor: z.string().nullish(),
  product_type: z.string().nullish(),
  variants: z.array(variantSchema),
  images: z.array(z.object({ src: z.string() })).nullish(),
});

const listingSchema = z.object({ products: z.array(z.unknown()) });

const windowProductSchema = z.object({
  variants: z.array(z.object({ id: z.number(), sku: z.string().nullish(), barcode: z.string().nullish() })),
});

type ShopifyProduct = z.infer<typeof productSchema>;
type ShopifyVariant = z.infer<typeof variantSchema>;
type JsonObject = Record<string, unknown>;

interface PriceBlock {
  saleCents: number | null;
  pvprCents: number | null;
}

/**
 * Model code from a Darty title: the first token with at least two letters and two digits (or one letter
 * and four digits), before the " - " or "|" that starts colours and specs. Measures ("140cm", "4K",
 * "256GB") and processors do not count. Returns null when no token looks like a model code.
 * "Smart TV LG 55" QNED evo AI Mini-LED UHD 4K 55QNED8MB6C (2026) - 140cm" → "55QNED8MB6C".
 */
export function extractModel(title: string): string | null {
  const head = title.split(/\s+[-–]\s+|\|/)[0] ?? "";
  for (const raw of head.split(/\s+/)) {
    const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    if (isModelCode(token)) {
      return token;
    }
  }
  return null;
}

/** EAN at the end of a Darty handle ("…-140cm-8806096857861"), validated; null for internal outlet codes. */
export function eanFromHandle(handle: string): string | null {
  const match = HANDLE_EAN.exec(handle);
  return match?.[1] === undefined ? null : normalizeGtin(match[1]);
}

function isModelCode(token: string): boolean {
  // "XP502/03" is judged by "XP502"; "8GB/256GB" and "12/10Kg" by their first part.
  const base = token.split("/")[0] ?? "";
  const letters = base.replace(/[^\p{L}]/gu, "");
  const digits = base.replace(/\D/g, "").length;
  if (UNIT_LETTERS.has(letters.toLowerCase()) || NOT_A_MODEL.test(base)) {
    return false;
  }
  const length = letters.length + digits;
  return (
    (letters.length >= 2 && digits >= 2 && length >= 5) || (letters.length >= 1 && digits >= 4 && length >= 6)
  );
}

/** Lowercase, without accents and repeated spaces, to compare Shopify product types. */
function normalizeLabel(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isOutlet(product: ShopifyProduct): boolean {
  return OUTLET.test(normalizeLabel(product.title)) || /-outlet-/.test(product.handle);
}

function cleanBrand(brand: string | null | undefined): string | null {
  const trimmed = brand?.trim() ?? "";
  return trimmed === "" || UNKNOWN_BRAND.test(trimmed) ? null : trimmed;
}

function absoluteUrl(src: string | null | undefined): string | null {
  if (!src) {
    return null;
  }
  return new URL(src.startsWith("//") ? `https:${src}` : src, DARTY_BASE_URL).href;
}

function productUrl(handle: string, variantId: number | null): string {
  const url = `${DARTY_BASE_URL}/products/${handle}`;
  return variantId === null ? url : `${url}?variant=${variantId}`;
}

function parseListingPage(body: string, url: string, category: StoreCategory): ListingPage {
  const { products } = listingSchema.parse(JSON.parse(body));
  const productTypes =
    [...DARTY_CATEGORIES, ...DARTY_INACTIVE_CATEGORIES].find((candidate) => candidate.key === category.key)
      ?.productTypes ?? null;
  const items = products.flatMap((raw) => {
    const parsed = productSchema.safeParse(raw);
    return parsed.success ? listingItems(parsed.data, productTypes) : [];
  });
  return { items, nextPageUrl: nextListingUrl(url, products.length) };
}

/** Available variants of a product kept for the category; outlet and other product types are left out. */
function listingItems(product: ShopifyProduct, productTypes: RegExp | null): ListingObservation[] {
  if (
    isOutlet(product) ||
    (productTypes !== null && !productTypes.test(normalizeLabel(product.product_type ?? "")))
  ) {
    return [];
  }
  const single = product.variants.length === 1;
  const ean = single ? eanFromHandle(product.handle) : null;
  return product.variants.flatMap((variant) => {
    const item = listingItem(product, variant, single);
    if (item === null) {
      return [];
    }
    // The product page, read for every item's price, always has the EAN; the handle's is only a first look.
    return ean === null ? [item] : [{ ...item, ean }];
  });
}

function listingItem(
  product: ShopifyProduct,
  variant: ShopifyVariant,
  single: boolean,
): ListingObservation | null {
  // Shopify's price is Darty's base price (the PVPr): campaign prices only show on the product page, which
  // the runner reads for every item (pricesFromProductPage), so this price is never stored.
  const priceCents = decimalToCents(variant.price);
  if (!variant.available || priceCents === null || priceCents <= 0) {
    return null;
  }
  const compareAtCents = decimalToCents(variant.compare_at_price);
  const title =
    single || variant.title === SINGLE_VARIANT_TITLE
      ? product.title.trim()
      : `${product.title.trim()} - ${variant.title.trim()}`;
  return {
    storeSku: variant.sku?.trim() || `variant-${variant.id}`,
    url: productUrl(product.handle, single ? null : variant.id),
    title,
    priceCents,
    referencePriceCents: compareAtCents !== null && compareAtCents > priceCents ? compareAtCents : null,
    inStock: true,
    sellerName: null,
    brand: cleanBrand(product.vendor),
    model: extractModel(product.title),
    imageUrl: absoluteUrl(variant.featured_image?.src ?? product.images?.[0]?.src),
  };
}

/** Next page while pages come full; Shopify answers the page after the last one with no products. */
function nextListingUrl(url: string, productCount: number): string | null {
  const next = new URL(url);
  const limit = Math.min(Number(next.searchParams.get("limit") ?? SHOPIFY_DEFAULT_LIMIT), DARTY_PAGE_SIZE);
  if (productCount === 0 || productCount < limit) {
    return null;
  }
  next.searchParams.set("page", String(Number(next.searchParams.get("page") ?? "1") + 1));
  return next.href;
}

function parseProductPage(body: string, url: string): ProductDetails {
  const $ = load(body);
  const product = findJsonLdProduct($);
  if (product === null) {
    throw new Error("No schema.org Product in the page's JSON-LD");
  }
  const variantId = new URL(url).searchParams.get("variant");
  const offer = pickOffer(product.offers, variantId);
  const shopifyVariant = readWindowProductVariant(body, variantId);
  const block = readPriceBlock($);
  const priceCents = jsonLdPriceCents(text(offer?.price ?? offer?.lowPrice)) ?? block.saleCents;
  const title = text(product.name) ?? $("h1").first().text().trim();
  return {
    storeSku: text(product.sku) ?? shopifyVariant?.sku ?? "",
    url,
    title,
    ean:
      text(product.gtin13 ?? product.gtin ?? product.gtin14 ?? product.gtin12) ??
      shopifyVariant?.barcode ??
      null,
    brand: cleanBrand(brandName(product.brand)),
    model: extractModel(title),
    imageUrl: absoluteUrl(firstImage(product.image)),
    specs: readSpecs($),
    sellerName: null,
    priceCents,
    // Next to its price Darty only shows the manufacturer's PVPr, never an earlier price of its own.
    referencePriceCents: null,
    rrpCents: block.pvprCents,
    inStock: isInStock(text(offer?.availability)),
  };
}

/** Cents of a JSON-LD price; Darty sometimes writes a third decimal zero ("428.990"). */
function jsonLdPriceCents(value: string | null): number | null {
  return decimalToCents(value?.replace(/^(\d+\.\d{2})0+$/, "$1"));
}

function findJsonLdProduct($: CheerioAPI): JsonObject | null {
  for (const script of $('script[type="application/ld+json"]').toArray()) {
    let data: unknown;
    try {
      data = JSON.parse($(script).text());
    } catch {
      continue;
    }
    const product = jsonLdNodes(data).find((node) => {
      const type = node["@type"];
      return type === "Product" || (Array.isArray(type) && type.includes("Product"));
    });
    if (product !== undefined) {
      return product;
    }
  }
  return null;
}

function jsonLdNodes(data: unknown): JsonObject[] {
  if (Array.isArray(data)) {
    return data.flatMap(jsonLdNodes);
  }
  const node = asObject(data);
  if (node === null) {
    return [];
  }
  return [node, ...jsonLdNodes(node["@graph"])];
}

/** The offer of the variant in the URL when the page lists several, else the first one. */
function pickOffer(offers: unknown, variantId: string | null): JsonObject | null {
  const list = (Array.isArray(offers) ? offers : [offers]).map(asObject).filter((offer) => offer !== null);
  const forVariant =
    variantId === null ? undefined : list.find((offer) => text(offer.url)?.includes(`variant=${variantId}`));
  return forVariant ?? list[0] ?? null;
}

/** The variant in `window.product` (Shopify's product JSON on the page), for the barcode when JSON-LD lacks it. */
function readWindowProductVariant(
  body: string,
  variantId: string | null,
): { sku: string | null; barcode: string | null } | null {
  const match = /window\.product\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/.exec(body);
  if (match?.[1] === undefined) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return null;
  }
  const parsed = windowProductSchema.safeParse(data);
  if (!parsed.success) {
    return null;
  }
  const { variants } = parsed.data;
  const variant = variants.find((candidate) => String(candidate.id) === variantId) ?? variants[0];
  return variant === undefined ? null : { sku: text(variant.sku), barcode: text(variant.barcode) };
}

/** The main product's price block: "PVPr*" (manufacturer's recommended price) and the selling price. */
function readPriceBlock($: CheerioAPI): PriceBlock {
  const block = $(".scx-product-info--wrapper .scx-price--container").first();
  const cents = (selector: string): number | null => {
    const value = block.find(selector).first().text().trim();
    return value === "" ? null : parsePriceToCents(value);
  };
  return { saleCents: cents(".scx-price--line-regular"), pvprCents: cents(".scx-price--line-pvpr") };
}

function readSpecs($: CheerioAPI): Record<string, string> {
  const specs: Record<string, string> = {};
  // The page repeats the list for mobile; the first copy is enough.
  $("ul.specs-list")
    .first()
    .find("li")
    .each((_index, element) => {
      const label = $(element).find(".specs-list-title").text().replace(/\s+/g, " ").trim();
      const value = $(element).find(".specs-list-val").text().replace(/\s+/g, " ").trim();
      if (label !== "" && value !== "" && !(label in specs)) {
        specs[label] = value;
      }
    });
  return specs;
}

function isInStock(availability: string | null): boolean | null {
  if (availability === null) {
    return null;
  }
  const value = availability.split("/").pop() ?? availability;
  return IN_STOCK_AVAILABILITY.has(value);
}

function brandName(brand: unknown): string | null {
  return text(brand) ?? text(asObject(brand)?.name);
}

function firstImage(image: unknown): string | null {
  const first: unknown = Array.isArray(image) ? image[0] : image;
  return text(first) ?? text(asObject(first)?.url);
}

function asObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonObject) : null;
}

/** Trimmed string from a JSON-LD value (strings and numbers), or null. */
function text(value: unknown): string | null {
  if (typeof value === "number") {
    return String(value);
  }
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export const darty: StoreScraper = {
  slug: "darty",
  name: "Darty",
  baseUrl: DARTY_BASE_URL,
  // The listing JSON only has the base price (the PVPr); campaign prices are applied on the product page.
  pricesFromProductPage: true,
  listCategories: () => [...DARTY_CATEGORIES],
  parseListingPage,
  parseProductPage,
  // Darty has no marketplace (docs/stores/darty.md): only a named third-party seller would say otherwise.
  isSoldByStore: (item) => item.sellerName === null || /\bdarty\b/i.test(item.sellerName),
};
