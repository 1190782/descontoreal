import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import { pathToFileURL } from "node:url";
import { isStoreSlug, type StoreSlug } from "@descontoreal/core";
import { type CheerioAPI, load } from "cheerio";
import iconv from "iconv-lite";
import { detectEncoding } from "../src/http/decode";
import { errorMessage } from "../src/http/errors";
import { SCRAPERS } from "../src/stores/registry";
import type { StoreScraper } from "../src/types";

// domhandler's node type, which cheerio does not re-export and this package cannot import directly.
type DomNode = Parameters<CheerioAPI["contains"]>[0];

/** What a store's fixtures keep: what src/stores/<loja>.ts reads. */
export interface TrimRules {
  /** Elements kept with their content, minus `drop`; their ancestors keep only their own tags. */
  keep: readonly string[];
  /** Elements kept as tags only, like the ancestors of kept elements. */
  keepTags?: readonly string[];
  /** Elements removed even inside kept ones. */
  drop?: readonly string[];
  /** The part of a JSON fixture to keep. */
  trimJson?: (data: unknown) => unknown;
}

// The charset keeps the file readable in its own encoding; the title names the page.
const ALWAYS_KEEP = ["meta[charset]", 'meta[http-equiv="Content-Type" i]', "head > title"];
// Scripts go too, unless a keep rule names them.
const ALWAYS_DROP = ["style", "link", "svg", "noscript", "iframe", "template", '[itemprop="description"]'];
const EXCERPT_NOTE =
  "<!-- Excerpt for tests: only what the store's parser reads (packages/scrapers/scripts/trim-fixtures.ts). -->";
// HTML whitespace only: &nbsp; is text.
const LAYOUT_SPACE = /^[ \t\n\f\r]*$/;
const LEADING_SPACE = /^[ \t\n\f\r]/;
// An attribute of a start tag: its name, then an optional quoted or bare value.
const ATTRIBUTE = /\s+([^\s"'>/=]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?/g;
// Shopify repeats the description as "content".
const JSON_DESCRIPTION = /("(?:description|content)"\s*:\s*)"(?:[^"\\]|\\.)*"/g;

const SHOPIFY_PRODUCT_FIELDS = ["title", "handle", "vendor", "product_type", "variants", "images"];
const SHOPIFY_VARIANT_FIELDS = [
  "id",
  "title",
  "sku",
  "barcode",
  "available",
  "price",
  "compare_at_price",
  "featured_image",
];

export const TRIM_RULES: Partial<Record<StoreSlug, TrimRules>> = {
  darty: {
    keep: [
      'script[type="application/ld+json"]',
      'script:contains("window.product")',
      "h1",
      // The main price block, and the cart drawer's and sticky bar's, which the parser must not read.
      ".scx-price--container",
      // The page repeats the list for mobile.
      "ul.specs-list:first",
    ],
    trimJson: trimShopifyJson,
  },
  radiopopular: {
    keep: [
      // Listings: the brand and category filters, whose labels carry the item counts.
      '#filters .filter-item:has(input[name="brand"], input[name="category"])',
      // Cards of listings and carousels: microdata, link, image, prices and the exhibition flag.
      "article.product-grid-module meta",
      'article.product-grid-module [itemprop="name"]',
      'article.product-grid-module [itemprop="url"]',
      'article.product-grid-module [itemprop="image"]',
      'article.product-grid-module [itemprop="price"]',
      "article.product-grid-module .old-price",
      ".flags-item.exhibition",
      // Product pages: the main product's microdata, its characteristics and its price lines.
      '[itemscope][itemtype$="schema.org/Product"]:not([itemprop])',
      "#_characteristics .characteristic-group",
      ".mpup",
    ],
    keepTags: ["[data-products-total]"],
    drop: ['[itemprop="aggregateRating"]', ".features", "#filters img"],
  },
};

export const USAGE = [
  "Utilização: pnpm --filter @descontoreal/scrapers exec tsx scripts/trim-fixtures.ts <loja> <ficheiro>...",
  "",
  "Reduz cada página ou JSON guardado ao que o parser da loja lê, no próprio ficheiro e na mesma codificação.",
  "Só grava o ficheiro se o parser ler o mesmo antes e depois.",
  `Lojas com regras: ${Object.keys(TRIM_RULES).join(", ")}.`,
].join("\n");

/**
 * The page with only the kept elements, the tags of their ancestors and the line breaks between them. Kept text
 * and tags are copied from the source as they are, without style attributes.
 */
export function trimHtml(source: string, rules: TrimRules): string {
  const $ = load(source, { sourceCodeLocationInfo: true });
  const keep = select($, [...ALWAYS_KEEP, ...rules.keep]);
  const drop = select($, [...ALWAYS_DROP, ...(rules.drop ?? [])]);
  for (const script of $("script").toArray()) {
    if (!keep.has(script)) {
      drop.add(script);
    }
  }
  const tags = select($, rules.keepTags ?? []);
  for (const element of [...keep, ...tags]) {
    for (let parent = element.parent; parent !== null && !tags.has(parent); parent = parent.parent) {
      tags.add(parent);
    }
  }

  const parts: string[] = [];
  let space = "";
  let noted = false;
  const write = (text: string): void => {
    // Text that starts with its own whitespace needs no more before it.
    parts.push(LEADING_SPACE.test(text) ? "" : space, text);
    space = "";
  };
  const visit = (node: DomNode, inside: boolean): void => {
    if (node.nodeType === 3) {
      if (LAYOUT_SPACE.test(node.data)) {
        space = lastLineBreak(node.data);
      } else if (inside) {
        const text = sourceOf(source, node);
        write(isScript(node.parent) ? text.replace(JSON_DESCRIPTION, '$1""') : text);
      }
      return;
    }
    // Comments go, and so does CDATA, which only svg and math hold.
    if (!("attribs" in node)) {
      return;
    }
    const kept = inside || keep.has(node);
    if (drop.has(node) || (!kept && !tags.has(node))) {
      return;
    }
    const { startTag, endTag } = node.sourceCodeLocation ?? {};
    if (startTag) {
      write(withoutStyle(source.slice(startTag.startOffset, startTag.endOffset)));
    }
    for (const child of node.children) {
      visit(child, kept);
    }
    if (endTag) {
      write(source.slice(endTag.startOffset, endTag.endOffset));
    }
  };
  for (const child of $.root()[0]?.children ?? []) {
    if ("name" in child && !("attribs" in child)) {
      // The doctype stays first.
      write(`${sourceOf(source, child)}\n${EXCERPT_NOTE}\n`);
      noted = true;
    } else {
      visit(child, false);
    }
  }

  const trimmed = `${noted ? "" : `${EXCERPT_NOTE}\n`}${parts.join("")}${space}`;
  return source.endsWith("\n") && !trimmed.endsWith("\n") ? `${trimmed}\n` : trimmed;
}

/** A saved page or JSON trimmed by the store's rules, in the file's own encoding. */
export function trimFixture(bytes: Uint8Array, fileName: string, rules: TrimRules): Buffer {
  const encoding = detectEncoding(bytes, null);
  const text = iconv.decode(bytes, encoding);
  const trimmed = extname(fileName) === ".json" ? trimJsonText(text, rules) : trimHtml(text, rules);
  return iconv.encode(trimmed, encoding, {
    addBOM: bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf,
  });
}

/** Trims the files in place and returns the exit code: 1 when any file was left as it was. */
export async function main(argv: readonly string[]): Promise<number> {
  const [store, ...files] = argv;
  const slug = store !== undefined && isStoreSlug(store) ? store : null;
  const rules = slug === null ? undefined : TRIM_RULES[slug];
  const scraper = slug === null ? undefined : SCRAPERS[slug];
  if (rules === undefined || scraper === undefined || files.length === 0) {
    console.error(USAGE);
    return 1;
  }
  let failed = 0;
  for (const file of files) {
    try {
      const bytes = readFileSync(file);
      const trimmed = trimFixture(bytes, file, rules);
      const isJson = extname(file) === ".json";
      const before = await parserReadings(scraper, decodeFixture(bytes), isJson);
      const after = await parserReadings(scraper, decodeFixture(trimmed), isJson);
      if (before !== after) {
        console.error(
          `${file}: o parser lê outra coisa no excerto. Ficheiro não alterado: revê as regras da loja.`,
        );
        failed += 1;
        continue;
      }
      writeFileSync(file, trimmed);
      console.log(`${file}: ${formatBytes(bytes.length)} → ${formatBytes(trimmed.length)}`);
    } catch (error) {
      console.error(`${file}: não foi reduzido (${errorMessage(error)}).`);
      failed += 1;
    }
  }
  return failed === 0 ? 0 : 1;
}

/** What the store's parsers read from a body, to compare a file before and after trimming. */
async function parserReadings(scraper: StoreScraper, body: string, isJson: boolean): Promise<string> {
  const categories = await scraper.listCategories();
  // A JSON listing (Darty) keeps different items for each category; an HTML listing only takes its URL from it.
  const checked = isJson ? categories : categories.slice(0, 1);
  const url = new URL("/", scraper.baseUrl).href;
  return JSON.stringify([
    attempt(() => scraper.parseProductPage(body, url)),
    ...checked.map((category) => attempt(() => scraper.parseListingPage(body, category.url, category))),
  ]);
}

function attempt(read: () => unknown): unknown {
  try {
    return read();
  } catch {
    return "error";
  }
}

function select($: CheerioAPI, selectors: readonly string[]): Set<DomNode> {
  return new Set(selectors.flatMap((selector) => $(selector).toArray()));
}

function sourceOf(source: string, node: DomNode): string {
  const location = node.sourceCodeLocation;
  if (!location) {
    throw new Error("Node without a source location");
  }
  return source.slice(location.startOffset, location.endOffset);
}

function isScript(node: DomNode | null): boolean {
  return node !== null && "attribs" in node && node.name === "script";
}

/** Layout whitespace as its last line break and the indent that follows, or as it is on one line. */
function lastLineBreak(space: string): string {
  const index = space.lastIndexOf("\n");
  return index === -1 ? space : space.slice(index);
}

function withoutStyle(startTag: string): string {
  return startTag.replace(ATTRIBUTE, (attribute: string, name: string) =>
    name.toLowerCase() === "style" ? "" : attribute,
  );
}

function trimJsonText(text: string, rules: TrimRules): string {
  if (rules.trimJson === undefined) {
    throw new Error("No JSON rules for this store");
  }
  const data: unknown = JSON.parse(text);
  return `${JSON.stringify(rules.trimJson(data), null, 2)}\n`;
}

/** Darty's products.json and product.json, with the fields src/stores/darty.ts reads and the first image. */
function trimShopifyJson(data: unknown): unknown {
  const products = asRecord(data)?.products;
  if (Array.isArray(products)) {
    return { products: products.map(trimShopifyProduct) };
  }
  const product = asRecord(data)?.product;
  return product === undefined ? data : { product: trimShopifyProduct(product) };
}

function trimShopifyProduct(product: unknown): Record<string, unknown> {
  const trimmed = pick(product, SHOPIFY_PRODUCT_FIELDS);
  if (Array.isArray(trimmed.variants)) {
    trimmed.variants = trimmed.variants.map(trimShopifyVariant);
  }
  if (Array.isArray(trimmed.images)) {
    trimmed.images = trimmed.images.slice(0, 1).map((image) => pick(image, ["src"]));
  }
  return trimmed;
}

function trimShopifyVariant(variant: unknown): Record<string, unknown> {
  const trimmed = pick(variant, SHOPIFY_VARIANT_FIELDS);
  if (asRecord(trimmed.featured_image) !== null) {
    trimmed.featured_image = pick(trimmed.featured_image, ["src"]);
  }
  return trimmed;
}

function pick(value: unknown, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(asRecord(value) ?? {}).filter(([key]) => keys.includes(key)));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function decodeFixture(bytes: Uint8Array): string {
  return iconv.decode(bytes, detectEncoding(bytes, null));
}

function formatBytes(count: number): string {
  return `${new Intl.NumberFormat("pt-PT").format(count)} bytes`;
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
