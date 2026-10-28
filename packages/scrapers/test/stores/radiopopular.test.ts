import { readFileSync } from "node:fs";
import { CATEGORIES, getCategory } from "@descontoreal/core";
import iconv from "iconv-lite";
import { describe, expect, it } from "vitest";
import { radiopopular } from "../../src/stores/radiopopular";
import { RADIOPOPULAR_CATEGORIES } from "../../src/stores/radiopopular.config";
import type { ListingObservation, StoreCategory } from "../../src/types";

const CATEGORY_URL = "https://www.radiopopular.pt/categoria/maquinas-de-lavar-roupa";
const CATEGORY: StoreCategory = {
  key: "maquinas-de-lavar-roupa",
  categorySlug: "maquinas-de-lavar-roupa",
  url: CATEGORY_URL,
};
const IMAGES = "https://lojae-s3-prd-files.radiopopular.pt/files/static/images/products";
const LEAF = "Grandes Eletrodomésticos|Máquinas de Roupa|Máquinas de Lavar Roupa";
// URLs of the saved filtered and sorted pages, as the traversal builds them.
const KG_10_11_URL =
  "https://www.radiopopular.pt/categoria/maquinas-de-lavar-roupa?pf-filters=%28%28category+eq+%27Grandes+Eletrodom%C3%A9sticos%7CM%C3%A1quinas+de+Roupa%7CM%C3%A1quinas+de+Lavar+Roupa%7C10-11+Kg%27%29%29";
const KG_10_11_AEG_TO_BOSCH_ASC_URL =
  "https://www.radiopopular.pt/categoria/maquinas-de-lavar-roupa?pf-filters=%28%28%28brand+eq+%27AEG%27%29+or+%28brand+eq+%27Balay%27%29+or+%28brand+eq+%27Beko%27%29+or+%28brand+eq+%27Bosch%27%29%29+and+%28category+eq+%27Grandes+Eletrodom%C3%A9sticos%7CM%C3%A1quinas+de+Roupa%7CM%C3%A1quinas+de+Lavar+Roupa%7C10-11+Kg%27%29%29&pf-order=price+asc";
const AEG_DESC_URL =
  "https://www.radiopopular.pt/categoria/maquinas-de-lavar-roupa?pf-filters=%28%28brand+eq+%27AEG%27%29%29&pf-order=price+desc";

/** Fixtures are UTF-8 pages, decoded as the runner decodes them (Content-Type charset). */
function fixture(name: string): string {
  return iconv.decode(readFileSync(new URL(`../../fixtures/radiopopular/${name}`, import.meta.url)), "utf-8");
}

function listingItem(
  page: { items: ListingObservation[] },
  storeSku: string,
): ListingObservation | undefined {
  return page.items.find((item) => item.storeSku === storeSku);
}

function listingPageWithCard(card: string): string {
  return `<section class="products grid"><div class="viewport">${card}</div></section>`;
}

function escapeAttribute(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** A listing page with no cards and the filter form of the real pages: label "Name (count)" around each input. */
function facetPage(
  total: number,
  facets: { brands?: Record<string, number>; categories?: Record<string, number> },
): string {
  const filter = (name: string, value: string, count: number): string =>
    `<div class="filter-item"><a class="filter-field"><label><input name="${name}" type="checkbox" value="${escapeAttribute(value)}" /></label> ${value.split("|").pop() ?? ""} (${count})</a></div>`;
  const brands = Object.entries(facets.brands ?? {}).map(([value, count]) => filter("brand", value, count));
  const categories = Object.entries(facets.categories ?? {}).map(([value, count]) =>
    filter("category", value, count),
  );
  return [
    `<div class="container modules" data-products-total="${total}">`,
    `<aside id="filters"><form method="GET">${[...brands, ...categories].join("")}</form></aside>`,
    `<section class="products grid"><div class="viewport"></div></section></div>`,
  ].join("");
}

/** A saved page cut down to what the traversal reads, its item total and its brand and category filters. */
function filterForm(body: string): string {
  const container = /<div class="container modules[^>]*>/.exec(body)?.[0] ?? "";
  const sections = body.match(/<section class="minimal category-filter"[\s\S]*?<\/section>/g) ?? [];
  const kept = sections.filter((section) => /name="(brand|category)"/.test(section));
  return `${container}<aside id="filters">${kept.join("")}</aside></div>`;
}

/** Follows nextPageUrl from the category's first page, with `body` answering every URL. */
function traverse(body: string, maxPages = 100): string[] {
  const urls: string[] = [];
  let url: string | null = CATEGORY_URL;
  while (url !== null && urls.length < maxPages) {
    urls.push(url);
    url = radiopopular.parseListingPage(body, url, CATEGORY).nextPageUrl;
  }
  return urls;
}

/** A listing URL's query as text, e.g. "pf-filters=((brand eq 'AEG'))&pf-order=price asc". */
function query(url: string | null): string | null {
  return url === null
    ? null
    : [...new URL(url).searchParams].map(([name, value]) => `${name}=${value}`).join("&");
}

function categoryPage(url: string): string {
  const { origin, pathname } = new URL(url);
  return `${origin}${pathname}`;
}

describe("radiopopular", () => {
  it("keeps a missing item for 7 runs, because the filtered and sorted pages can miss it for a day or two", () => {
    // Act
    const runs = radiopopular.maxMissedRuns;

    // Assert
    expect(runs).toBe(7);
  });
});

describe("radiopopular.parseListingPage", () => {
  it("reads the 12 cards of a category page", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items.map((item) => item.storeSku)).toEqual([
      "1339128",
      "1336013",
      "1336011",
      "1335834",
      "1339144",
      "1323776",
      "1340981",
      "1336012",
      "1340988",
      "1340980",
      "1339129",
      "1337927",
    ]);
  });

  it("reads every field of a branded card", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(listingItem(page, "1340981")).toEqual({
      storeSku: "1340981",
      url: "https://www.radiopopular.pt/produto/maquina-lavar-roupa-samsung-ww90fg3m05awep",
      title: "MÁQUINA LAVAR ROUPA SAMSUNG WW90FG3M05AWEP",
      priceCents: 42999,
      referencePriceCents: null,
      rrpCents: 57999,
      inStock: true,
      sellerName: null,
      ean: "8806097015925",
      brand: "SAMSUNG",
      model: "WW90FG3M05AWEP",
      imageUrl: `${IMAGES}/129617_0.jpg`,
    });
  });

  it("drops the internal barcode of the store's own brands and keeps the model from the title", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(listingItem(page, "1339128")).toMatchObject({
      title: "MÁQUINA LAVAR ROUPA ELECTRONIA EWM38BR",
      ean: null,
      brand: "ELECTRONIA",
      model: "EWM38BR",
    });
  });

  it("ignores the recommended retail price (PVPR), which is not struck through, as a reference price", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items).toHaveLength(12);
    expect(page.items.map((item) => item.referencePriceCents)).toEqual(Array(12).fill(null));
  });

  it("keeps the recommended retail price (PVPR) apart, as shown next to each price", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items.map((item) => [item.storeSku, item.priceCents, item.rrpCents])).toEqual([
      ["1339128", 26999, 32999],
      ["1336013", 26999, 34999],
      ["1336011", 21999, 26999],
      ["1335834", 29999, 39999],
      ["1339144", 28999, 36999],
      ["1323776", 39999, 59999],
      ["1340981", 42999, 57999],
      ["1336012", 23999, 29999],
      ["1340988", 49999, 84999],
      ["1340980", 39999, 52999],
      ["1339129", 31999, 39999],
      ["1337927", 32999, 41999],
    ]);
  });

  it("returns prices as positive integer cents and absolute product URLs", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items).toHaveLength(12);
    for (const item of page.items) {
      expect(Number.isSafeInteger(item.priceCents) && item.priceCents > 0, item.storeSku).toBe(true);
      expect(item.url, item.storeSku).toMatch(/^https:\/\/www\.radiopopular\.pt\/produto\/[a-z0-9-]+$/);
    }
  });

  it("reads a struck-through price as the reference price and counts pre-sale items as in stock", () => {
    // Arrange
    const body = fixture("listagem-variantes.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(listingItem(page, "1351716")).toEqual({
      storeSku: "1351716",
      url: "https://www.radiopopular.pt/produto/jogo-ps5-gta-vi-code-in-box",
      title: "JOGO PS5 GRAND THEFT AUTO VI CODE IN BOX",
      priceCents: 6799,
      referencePriceCents: 7999,
      rrpCents: null,
      inStock: true,
      sellerName: null,
      ean: "5026555439848",
      brand: "INFOCAPITAL",
      model: null,
      imageUrl: `${IMAGES}/140909_0.jpg`,
    });
  });

  it("reads the PVPR of a sold-out card and leaves it empty where the card shows none", () => {
    // Arrange
    const body = fixture("listagem-variantes.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items.map((item) => [item.storeSku, item.rrpCents, item.referencePriceCents])).toEqual([
      ["1351716", null, 7999],
      ["1353062", null, null],
      ["1339230", 42999, null],
      ["F116288", null, null],
      ["1341434", null, null],
    ]);
  });

  it("marks sold-out items, F-prefixed codes included, as out of stock", () => {
    // Arrange
    const body = fixture("listagem-variantes.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(listingItem(page, "1339230")).toMatchObject({
      inStock: false,
      priceCents: 29999,
      model: "TU43U8005FUXXC",
    });
    expect(listingItem(page, "F116288")).toMatchObject({
      inStock: false,
      priceCents: 48999,
      model: "WMI1495T14A",
    });
  });

  it("skips display units, which share the SKU of the new item", () => {
    // Arrange
    const body = fixture("listagem-variantes.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items.map((item) => item.storeSku)).toEqual([
      "1351716",
      "1353062",
      "1339230",
      "F116288",
      "1341434",
    ]);
  });

  it("restores the leading zeros the store drops from barcodes", () => {
    // Arrange
    const body = fixture("listagem-variantes.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(listingItem(page, "1353062")?.ean).toBe("0045496337292");
    expect(listingItem(page, "1341434")?.ean).toBe("0195950638813");
  });

  it("leaves the model empty unless a single code follows the brand in the title", () => {
    // Arrange
    const body = fixture("listagem-variantes.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(listingItem(page, "1341434")).toMatchObject({
      title: "APPLE IPHONE 17 PRO MAX 256GB PRATEADO",
      model: null,
    });
    expect(listingItem(page, "1353062")).toMatchObject({
      title: "CONSOLA NINTENDO SWITCH 2 ZELDA 40TH ED",
      model: null,
    });
  });

  it("resolves relative product and image links against the page URL", () => {
    // Arrange
    const body = listingPageWithCard(`
      <article class="product-grid-module" itemprop="itemListElement" itemscope itemtype="http://schema.org/Product">
        <meta itemprop="name" content="TV LG 43LR60006LA" />
        <meta itemprop="sku" content="1340975" />
        <div itemprop="brand" itemscope itemtype="http://schema.org/Brand"><meta itemprop="name" content="LG"></div>
        <a href="/produto/tv-lg-43lr60006la" itemprop="url" content="/produto/tv-lg-43lr60006la"></a>
        <img src="/includes/imgs/1x1.png" itemprop="image" content="/files/static/images/products/1_0.jpg">
        <div itemprop="offers" itemscope itemtype="http://schema.org/Offer">
          <div class="price" itemprop="price" content="249.99">249<sup>,99</sup></div>
          <meta itemprop="availability" content="http://schema.org/InStock" />
        </div>
      </article>`);

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.items).toEqual([
      expect.objectContaining({
        url: "https://www.radiopopular.pt/produto/tv-lg-43lr60006la",
        imageUrl: "https://www.radiopopular.pt/files/static/images/products/1_0.jpg",
        priceCents: 24999,
        rrpCents: null,
        ean: null,
        model: "43LR60006LA",
      }),
    ]);
  });

  it("reads the cards of a filtered, sorted page", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa-10-11-kg-aeg-a-bosch-preco-asc.html");

    // Act
    const page = radiopopular.parseListingPage(body, KG_10_11_AEG_TO_BOSCH_ASC_URL, CATEGORY);

    // Assert
    expect(page.items.map((item) => [item.storeSku, item.priceCents])).toEqual([
      ["1340863", 39999],
      ["1351160", 44999],
      ["1318233", 57999],
      ["F125436", 67999],
      ["1342418", 73999],
      ["F128458", 74999],
      ["F139092", 76999],
      ["F125543", 77999],
      ["F125437", 81999],
      ["1342419", 84999],
      ["F125546", 85999],
      ["1326219", 89999],
    ]);
    expect(listingItem(page, "1340863")?.rrpCents).toBe(54999);
  });

  it("returns no items and no next page for a page without the product grid", () => {
    // Arrange
    const body = "<html><body><h1>Página não encontrada</h1></body></html>";

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page).toEqual({ items: [], nextPageUrl: null });
  });
});

describe("radiopopular listing traversal", () => {
  it("splits a category with sub-categories by sub-category, starting with the first by name", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.nextPageUrl).toBe(KG_10_11_URL);
    expect(query(page.nextPageUrl)).toBe(`pf-filters=((category eq '${LEAF}|10-11 Kg'))`);
  });

  it("splits a large sub-category by brand, packing small brands into groups read sorted by price", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa-10-11-kg.html");

    // Act
    const page = radiopopular.parseListingPage(body, KG_10_11_URL, CATEGORY);

    // Assert
    expect(page.nextPageUrl).toBe(KG_10_11_AEG_TO_BOSCH_ASC_URL);
    expect(query(page.nextPageUrl)).toBe(
      "pf-filters=(((brand eq 'AEG') or (brand eq 'Balay') or (brand eq 'Beko') or (brand eq 'Bosch')) and " +
        `(category eq '${LEAF}|10-11 Kg'))&pf-order=price asc`,
    );
  });

  it("reads a group of 13 to 24 items sorted by price ascending, then descending", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa-10-11-kg-aeg-a-bosch-preco-asc.html");

    // Act
    const page = radiopopular.parseListingPage(body, KG_10_11_AEG_TO_BOSCH_ASC_URL, CATEGORY);

    // Assert
    expect(page.nextPageUrl).toBe(KG_10_11_AEG_TO_BOSCH_ASC_URL.replace("price+asc", "price+desc"));
  });

  it("after the last order of a brand goes on with the next brands", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa-marca-aeg-preco-desc.html");

    // Act
    const page = radiopopular.parseListingPage(body, AEG_DESC_URL, CATEGORY);

    // Assert
    expect(page.items).toHaveLength(12);
    expect(query(page.nextPageUrl)).toBe("pf-filters=((brand eq 'Balay'))");
  });

  it("walks the sub-categories, splits a large one by brand and ends, leaving accessories out", () => {
    // Arrange
    const body = facetPage(43, {
      brands: { LG: 20, Teka: 13, Beko: 10 },
      categories: {
        "Grandes Eletrodomésticos": 43,
        "Grandes Eletrodomésticos|Máquinas de Roupa": 43,
        [LEAF]: 43,
        [`${LEAF}|8 Kg`]: 30,
        [`${LEAF}|7 Kg`]: 6,
        [`${LEAF}|9 Kg`]: 4,
        [`${LEAF}|Acessórios de Máquinas`]: 3,
      },
    });

    // Act
    const urls = traverse(body);

    // Assert
    const part = (name: string): string => `(category eq '${LEAF}|${name}')`;
    expect(urls.map(query)).toEqual([
      "",
      `pf-filters=(${part("7 Kg")})`,
      `pf-filters=(${part("8 Kg")})`,
      `pf-filters=((brand eq 'Beko') and ${part("8 Kg")})`,
      `pf-filters=((brand eq 'LG') and ${part("8 Kg")})&pf-order=price asc`,
      `pf-filters=((brand eq 'LG') and ${part("8 Kg")})&pf-order=price desc`,
      `pf-filters=((brand eq 'Teka') and ${part("8 Kg")})&pf-order=price asc`,
      `pf-filters=((brand eq 'Teka') and ${part("8 Kg")})&pf-order=price desc`,
      `pf-filters=(${part("8 Kg")})&pf-order=price desc`,
      `pf-filters=(${part("9 Kg")})`,
    ]);
  });

  it("reads a large sub-category in more orders when brands cover too little of it", () => {
    // Arrange
    const body = facetPage(60, {
      brands: { CATA: 10 },
      categories: { [LEAF]: 60, [`${LEAF}|Parede`]: 55, [`${LEAF}|Teto`]: 5 },
    });

    // Act
    const urls = traverse(body);

    // Assert
    const parede = `pf-filters=((category eq '${LEAF}|Parede'))`;
    expect(urls.map(query)).toEqual([
      "",
      parede,
      `${parede}&pf-order=price asc`,
      `${parede}&pf-order=displayText asc`,
      `${parede}&pf-order=displayText desc`,
      `${parede}&pf-order=price desc`,
      `pf-filters=((category eq '${LEAF}|Teto'))`,
    ]);
  });

  it("walks a category without sub-categories by brand: a large brand in three orders, small ones together", () => {
    // Arrange
    const body = facetPage(50, {
      brands: { Bosch: 30, LG: 8, Smeg: 7, Teka: 5 },
      categories: { [LEAF]: 50 },
    });

    // Act
    const urls = traverse(body);

    // Assert
    expect(urls.map(query)).toEqual([
      "",
      "pf-filters=((brand eq 'Bosch'))",
      "pf-filters=((brand eq 'Bosch'))&pf-order=price asc",
      "pf-filters=((brand eq 'Bosch'))&pf-order=price desc",
      "pf-filters=((brand eq 'LG'))",
      "pf-filters=(((brand eq 'Smeg') or (brand eq 'Teka')))",
    ]);
  });

  it("keeps the doubled apostrophes of a brand name and reads them back", () => {
    // Arrange
    const body = facetPage(35, { brands: { Sony: 30, "T''nB": 5 } });

    // Act
    const urls = traverse(body);

    // Assert
    expect(urls.map(query).slice(-2)).toEqual([
      "pf-filters=((brand eq 'Sony'))&pf-order=price desc",
      "pf-filters=((brand eq 'T''nB'))",
    ]);
    expect(urls).toHaveLength(5);
  });

  it("stops after the first page when it shows every item", () => {
    // Arrange
    const body = facetPage(12, { brands: { Bosch: 12 } });

    // Act
    const page = radiopopular.parseListingPage(body, CATEGORY_URL, CATEGORY);

    // Assert
    expect(page.nextPageUrl).toBeNull();
  });

  it("reads a category of 13 to 24 items sorted by price both ways and ends", () => {
    // Arrange
    const body = facetPage(20, { brands: { Bosch: 12, LG: 8 } });

    // Act
    const urls = traverse(body);

    // Assert
    expect(urls.map(query)).toEqual(["", "pf-order=price asc", "pf-order=price desc"]);
  });

  it("reads a large category that cannot be split in five orders", () => {
    // Arrange
    const body = facetPage(60, {});

    // Act
    const urls = traverse(body);

    // Assert
    expect(urls.map(query)).toEqual([
      "",
      "pf-order=price asc",
      "pf-order=displayText asc",
      "pf-order=displayText desc",
      "pf-order=price desc",
    ]);
  });

  it("goes forward when changed counts regrouped the brands of the current page", () => {
    // Arrange
    const body = facetPage(50, { brands: { Bosch: 30, LG: 8, Smeg: 7, Teka: 5 } });
    const regrouped = `${CATEGORY_URL}?pf-filters=${encodeURIComponent("(((brand eq 'LG') or (brand eq 'Smeg')))")}`;
    const pastTheEnd = `${CATEGORY_URL}?pf-filters=${encodeURIComponent("((brand eq 'Teka'))")}`;

    // Act
    const fromRegrouped = radiopopular.parseListingPage(body, regrouped, CATEGORY).nextPageUrl;
    const fromPastTheEnd = radiopopular.parseListingPage(body, pastTheEnd, CATEGORY).nextPageUrl;

    // Assert
    expect(query(fromRegrouped)).toBe("pf-filters=(((brand eq 'Smeg') or (brand eq 'Teka')))");
    expect(fromPastTheEnd).toBeNull();
  });

  it("always ends without repeating a URL, whichever saved page answers", () => {
    // Arrange
    const bodies = [
      "categoria-maquinas-de-lavar-roupa.html",
      "categoria-maquinas-de-lavar-roupa-10-11-kg.html",
      "categoria-maquinas-de-lavar-roupa-10-11-kg-aeg-a-bosch-preco-asc.html",
      "categoria-maquinas-de-lavar-roupa-marca-aeg-preco-desc.html",
    ].map((name) => filterForm(fixture(name)));

    // Act
    const walks = bodies.map((body) => traverse(body, 500));

    // Assert
    for (const urls of walks) {
      expect(urls.length).toBeGreaterThan(1);
      expect(urls.length).toBeLessThan(500);
      expect(new Set(urls).size).toBe(urls.length);
    }
  });

  it("keeps every URL on the category's page of www.radiopopular.pt, whatever URL the page came from", () => {
    // Arrange
    const body = fixture("categoria-maquinas-de-lavar-roupa.html");
    const elsewhere = "https://example.com/categoria/outra?pf-order=price+asc";

    // Act
    const fromElsewhere = radiopopular.parseListingPage(body, elsewhere, CATEGORY).nextPageUrl;
    const urls = traverse(filterForm(body), 500);

    // Assert
    expect(categoryPage(fromElsewhere ?? "")).toBe(CATEGORY_URL);
    expect(urls.filter((url) => categoryPage(url) !== CATEGORY_URL)).toEqual([]);
  });
});

describe("radiopopular.parseProductPage", () => {
  it("reads the main product of a branded page, not the similar products in its carousels", () => {
    // Arrange
    const url = "https://www.radiopopular.pt/produto/maquina-lavar-roupa-samsung-ww90fg3m05awep";
    const body = fixture("produto-samsung-ww90fg3m05awep.html");

    // Act
    const { specs: _specs, ...facts } = radiopopular.parseProductPage(body, url);

    // Assert
    expect(facts).toEqual({
      storeSku: "1340981",
      url,
      title: "MÁQUINA LAVAR ROUPA SAMSUNG WW90FG3M05AWEP",
      ean: "8806097015925",
      brand: "Samsung",
      model: "WW90FG3M05AWEP",
      imageUrl: `${IMAGES}/129617_0.jpg`,
      sellerName: null,
      priceCents: 42999,
      referencePriceCents: null,
      rrpCents: 57999,
      inStock: true,
    });
  });

  it("keeps the specifications as label → value, without the identifier rows", () => {
    // Arrange
    const body = fixture("produto-samsung-ww90fg3m05awep.html");
    const identifiers = new Set(["Marca", "Modelo", "Código Produto", "EAN"]);

    // Act
    const { specs } = radiopopular.parseProductPage(body, "https://www.radiopopular.pt/produto/x");

    // Assert
    expect(specs).toMatchObject({ Largura: "595 mm", Peso: "64 kg", "Classe de eficiência energética": "A" });
    expect(Object.keys(specs).filter((label) => identifiers.has(label))).toEqual([]);
  });

  it("takes the model from the title when the store code fills Modelo and Código Produto", () => {
    // Arrange
    const body = fixture("produto-electronia-ems686br.html");

    // Act
    const details = radiopopular.parseProductPage(body, "https://www.radiopopular.pt/produto/x");

    // Assert
    expect(details).toMatchObject({
      storeSku: "1336011",
      ean: null,
      brand: "Electronia",
      model: "EMS686BR",
      priceCents: 21999,
      referencePriceCents: null,
      rrpCents: 26999,
      inStock: true,
    });
  });

  it("prefers the maker's reference in Código Produto and gives no price for a display unit", () => {
    // Arrange
    const body = fixture("produto-lenovo-ideapad-exposicao.html");

    // Act
    const details = radiopopular.parseProductPage(body, "https://www.radiopopular.pt/produto/x");

    // Assert
    expect(details).toMatchObject({
      storeSku: "1323660",
      ean: "0197532466562",
      brand: "Lenovo",
      model: "82XJ002FPG",
      priceCents: null,
      referencePriceCents: null,
      rrpCents: null,
      inStock: null,
    });
  });

  it("reads the struck-through price and pre-sale availability", () => {
    // Arrange
    const body = fixture("produto-gta-vi-pre-venda.html");

    // Act
    const details = radiopopular.parseProductPage(body, "https://www.radiopopular.pt/produto/x");

    // Assert
    expect(details).toMatchObject({
      storeSku: "1351716",
      url: "https://www.radiopopular.pt/produto/jogo-ps5-gta-vi-code-in-box",
      priceCents: 6799,
      referencePriceCents: 7999,
      rrpCents: null,
      inStock: true,
      model: null,
      specs: { "Data de Lançamento": "19/11/2026" },
    });
  });

  it("throws when the page has no product microdata", () => {
    // Arrange
    const body = "<html><body><h1>Página não encontrada</h1></body></html>";

    // Act
    const parse = (): unknown => radiopopular.parseProductPage(body, "https://www.radiopopular.pt/produto/x");

    // Assert
    expect(parse).toThrow(/microdata/);
  });
});

describe("radiopopular.isSoldByStore", () => {
  it("says the store sells every item, since Radio Popular has no marketplace", () => {
    // Arrange
    const page = radiopopular.parseListingPage(fixture("listagem-variantes.html"), CATEGORY_URL, CATEGORY);

    // Act
    const sellers = page.items.map((item) => radiopopular.isSoldByStore(item));

    // Assert
    expect(sellers).toEqual([true, true, true, true, true]);
  });
});

describe("radiopopular.listCategories", () => {
  it("returns the config categories, each with its own key and category page", async () => {
    // Arrange
    const expectedUrl = (key: string): string => `https://www.radiopopular.pt/categoria/${key}`;

    // Act
    const categories = await radiopopular.listCategories();

    // Assert
    expect(categories).toBe(RADIOPOPULAR_CATEGORIES);
    expect(new Set(categories.map((category) => category.key)).size).toBe(categories.length);
    for (const category of categories) {
      expect(category.url).toBe(expectedUrl(category.key));
    }
  });

  it("maps store categories only onto our leaf categories and covers all of them", () => {
    // Arrange
    const leaves = CATEGORIES.filter((category) => category.parent !== null).map((category) => category.slug);

    // Act
    const mapped = new Set(RADIOPOPULAR_CATEGORIES.map((category) => category.categorySlug));

    // Assert
    expect([...mapped].filter((slug) => getCategory(slug).parent === null)).toEqual([]);
    expect(leaves.filter((slug) => !mapped.has(slug))).toEqual([]);
  });

  it("leaves accessories and refurbished items out", () => {
    // Arrange
    const excluded = /acessorios|recondicionados|reset/;

    // Act
    const keys = RADIOPOPULAR_CATEGORIES.map((category) => category.key);

    // Assert
    expect(keys.filter((key) => excluded.test(key))).toEqual([]);
  });
});
