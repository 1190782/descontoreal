import { readFileSync } from "node:fs";
import { getCategory, isCategorySlug } from "@descontoreal/core";
import { describe, expect, it } from "vitest";
import { darty, eanFromHandle, extractModel } from "../../src/stores/darty";
import { DARTY_CATEGORIES, DARTY_INACTIVE_CATEGORIES } from "../../src/stores/darty.config";
import type { ListingObservation, ProductDetails, StoreCategory } from "../../src/types";

const TVS_URL = "https://darty.pt/collections/tvs/products.json?limit=250";
const LG_55_URL =
  "https://darty.pt/products/smart-tv-lg-55-qned-evo-ai-mini-led-uhd-4k-55qned8mb6c-2026-140cm-8806096857861";
const SWITCH_URL = "https://darty.pt/products/consola-nintendo-switch-v2-n-on-azul-vermelho";
const HISENSE_FRIDGE_URL =
  "https://darty.pt/products/frigorifico-combinado-hisense-rb390n4awe-no-frost-304l-e";
const URL_PATTERN = /^https:\/\/darty\.pt\/collections\/[a-z0-9-]+\/products\.json\?limit=250$/;

function fixture(name: string): string {
  return readFileSync(new URL(`../../fixtures/darty/${name}`, import.meta.url), "utf8");
}

function categoryByKey(key: string): StoreCategory {
  const category = [...DARTY_CATEGORIES, ...DARTY_INACTIVE_CATEGORIES].find(
    (candidate) => candidate.key === key,
  );
  if (category === undefined) {
    throw new Error(`No Darty category "${key}"`);
  }
  return category;
}

/** A products.json body with one single-variant product. */
function listingWith(productType: string, title: string): string {
  return JSON.stringify({
    products: [
      {
        title,
        handle: "exemplo",
        vendor: "Exemplo",
        product_type: productType,
        variants: [{ id: 1, title: "Default Title", sku: "T00900009", available: true, price: "99.99" }],
        images: [],
      },
    ],
  });
}

function skus(items: readonly ListingObservation[]): string[] {
  return items.map((item) => item.storeSku);
}

function productDetails(overrides: Partial<ProductDetails>): ProductDetails {
  return {
    storeSku: "T00000001",
    url: "https://darty.pt/products/exemplo",
    title: "Exemplo",
    ean: null,
    brand: null,
    model: null,
    imageUrl: null,
    specs: {},
    sellerName: null,
    priceCents: 1000,
    referencePriceCents: null,
    inStock: true,
    ...overrides,
  };
}

describe("darty", () => {
  it("reads prices from product pages, because the listing JSON only has the base price", () => {
    // Act
    const flag = darty.pricesFromProductPage;

    // Assert
    expect(flag).toBe(true);
  });

  it("keeps the default of 3 missed runs, because its listing shows every available item", () => {
    // Act
    const runs = darty.maxMissedRuns;

    // Assert
    expect(runs).toBeUndefined();
  });
});

describe("darty.listCategories", () => {
  it("crawls 43 collections, each mapped to one of our leaf categories, TVs first", async () => {
    // Act
    const categories = await darty.listCategories();

    // Assert
    expect(categories).toHaveLength(43);
    expect(categories.slice(0, 4).map((category) => category.key)).toEqual([
      "televisores",
      "maquinas-de-lavar-roupa",
      "maquinas-de-lavar-loica",
      "frigorificos",
    ]);
    for (const category of categories) {
      expect(isCategorySlug(category.categorySlug), category.key).toBe(true);
      expect(getCategory(category.categorySlug).parent, category.key).not.toBeNull();
      expect(category.url, category.key).toMatch(URL_PATTERN);
    }
  });

  it("keeps the inactive collections mapped, with unique keys, but out of the daily crawl", async () => {
    // Act
    const categories = await darty.listCategories();

    // Assert
    const activeKeys = categories.map((category) => category.key);
    const inactiveKeys = DARTY_INACTIVE_CATEGORIES.map((category) => category.key);
    expect(inactiveKeys).toEqual([
      "pequenos-aparelhos-de-cozinha",
      "pequenos-aparelhos-de-cozinha-confecao",
      "armazenamento",
      "engomar",
      "escovas-de-dentes-eletricas",
    ]);
    expect(new Set([...activeKeys, ...inactiveKeys]).size).toBe(48);
    for (const category of DARTY_INACTIVE_CATEGORIES) {
      expect(isCategorySlug(category.categorySlug), category.key).toBe(true);
      expect(category.url, category.key).toMatch(URL_PATTERN);
    }
  });
});

describe("darty.parseListingPage", () => {
  it("keeps the available TVs and leaves out outlet items", () => {
    // Arrange
    const body = fixture("collection-tvs.json");

    // Act
    const page = darty.parseListingPage(body, TVS_URL, categoryByKey("televisores"));

    // Assert
    expect(skus(page.items)).toEqual([
      "2647576",
      "T00162680",
      "2499590",
      "T00088969",
      "T00263385",
      "T00252956",
      "T00230523",
      "T00252949",
      "T00272288",
      "T00245587",
      "T00297176",
    ]);
  });

  it("reads the listing facts of a TV, with the EAN from the handle", () => {
    // Arrange
    const body = fixture("collection-tvs.json");

    // Act
    const page = darty.parseListingPage(body, TVS_URL, categoryByKey("televisores"));

    // Assert
    expect(page.items.find((item) => item.storeSku === "T00297176")).toEqual({
      storeSku: "T00297176",
      url: LG_55_URL,
      title: 'Smart TV LG 55" QNED evo AI Mini-LED UHD 4K 55QNED8MB6C 2026 - 140cm',
      priceCents: 61999,
      referencePriceCents: null,
      inStock: true,
      sellerName: null,
      ean: "8806096857861",
      brand: "LG",
      model: "55QNED8MB6C",
      imageUrl:
        "https://cdn.shopify.com/s/files/1/0703/2684/5580/files/1505-1_bb9fbe8f-d467-4952-af5e-b2e6cd21edc5.jpg?v=1788292946",
    });
  });

  it("leaves the ean key out when the handle has no EAN", () => {
    // Arrange
    const body = fixture("collection-tvs.json");

    // Act
    const page = darty.parseListingPage(body, TVS_URL, categoryByKey("televisores"));

    // Assert
    const item = page.items.find((candidate) => candidate.storeSku === "2499590");
    expect(item?.title).toBe("Smart TV LG 32'' HD 32LQ630B 81cm");
    expect(item?.model).toBe("32LQ630B");
    expect(item !== undefined && "ean" in item).toBe(false);
  });

  it("keeps only coffee machines from a collection that also sells coffee and accessories", () => {
    // Arrange
    const body = fixture("collection-maquinas-de-cafe.json");
    const url = "https://darty.pt/collections/maquinas-de-cafe/products.json?limit=250";

    // Act
    const page = darty.parseListingPage(body, url, categoryByKey("maquinas-de-cafe"));

    // Assert
    expect(skus(page.items)).toEqual([
      "T00238588",
      "2585533",
      "1793306",
      "T00164279",
      "T00229901",
      "2675868",
      "T00137538",
      "T00089863",
    ]);
  });

  it("splits washing machines from washer-dryers listed in the same collection", () => {
    // Arrange
    const body = fixture("collection-maquinas-de-lavar-roupa.json");
    const url = "https://darty.pt/collections/maquinas-de-lavar-roupa/products.json?limit=250";

    // Act
    const washers = darty.parseListingPage(body, url, categoryByKey("maquinas-de-lavar-roupa"));
    const washerDryers = darty.parseListingPage(body, url, categoryByKey("maquinas-de-lavar-e-secar-roupa"));

    // Assert
    expect(skus(washers.items)).toEqual(["T00162744", "T00100854", "T00163521", "T00096648", "T00241688"]);
    expect(skus(washerDryers.items)).toEqual(["T00096160", "2722560", "2786541"]);
  });

  it("keeps Darty's videoprojectors in the projectors collection", () => {
    // Arrange
    const body = listingWith("Videoprojectores", "Videoprojetor Exemplo PX100");
    const url = "https://darty.pt/collections/projetores-video/products.json?limit=250";

    // Act
    const page = darty.parseListingPage(body, url, categoryByKey("projetores"));

    // Assert
    expect(skus(page.items)).toEqual(["T00900009"]);
  });

  it("applies the product types of an inactive collection too, leaving blank discs out of storage", () => {
    // Arrange
    const url = "https://darty.pt/collections/armazenamento/products.json?limit=250";
    const category = categoryByKey("armazenamento");

    // Act
    const blankDiscs = darty.parseListingPage(
      listingWith("Discos CD/DVD/Blu-ray", "DVD-R x10"),
      url,
      category,
    );
    const externalDisk = darty.parseListingPage(
      listingWith('Discos Rígidos 2.5" Externos', "Disco Externo Exemplo 2TB"),
      url,
      category,
    );

    // Assert
    expect(blankDiscs.items).toEqual([]);
    expect(skus(externalDisk.items)).toEqual(["T00900009"]);
  });

  it("asks for the next page while pages come full", () => {
    // Arrange
    const body = fixture("collection-tvs.json");
    const url = "https://darty.pt/collections/tvs/products.json?limit=17&page=2";

    // Act
    const page = darty.parseListingPage(body, url, categoryByKey("televisores"));

    // Assert
    expect(page.nextPageUrl).toBe("https://darty.pt/collections/tvs/products.json?limit=17&page=3");
  });

  it("stops after a page shorter than the limit", () => {
    // Arrange
    const body = fixture("collection-tvs.json");

    // Act
    const page = darty.parseListingPage(body, TVS_URL, categoryByKey("televisores"));

    // Assert
    expect(page.nextPageUrl).toBeNull();
  });

  it("stops at an empty page", () => {
    // Arrange
    const body = '{"products":[]}';
    const url = `${TVS_URL}&page=7`;

    // Act
    const page = darty.parseListingPage(body, url, categoryByKey("televisores"));

    // Assert
    expect(page).toEqual({ items: [], nextPageUrl: null });
  });

  it("turns each available variant into an item with its own URL", () => {
    // Arrange
    const body = JSON.stringify({
      products: [
        {
          title: "Smartphone Exemplo X200 5G",
          handle: "smartphone-exemplo-x200-5g-5901234123457",
          vendor: "Exemplo",
          product_type: "Smartphones",
          variants: [
            {
              id: 11,
              title: "128GB - Preto",
              sku: "T00900001",
              available: true,
              price: "299.99",
              compare_at_price: "349.99",
              featured_image: { src: "//darty.pt/cdn/shop/files/preto.jpg" },
            },
            {
              id: 12,
              title: "256GB - Azul",
              sku: "T00900002",
              available: false,
              price: "349.99",
              compare_at_price: null,
            },
          ],
          images: [{ src: "https://cdn.shopify.com/s/files/exemplo.jpg" }],
        },
      ],
    });
    const url = "https://darty.pt/collections/smartphones/products.json?limit=250";

    // Act
    const page = darty.parseListingPage(body, url, categoryByKey("smartphones"));

    // Assert
    expect(page.items).toEqual([
      {
        storeSku: "T00900001",
        url: "https://darty.pt/products/smartphone-exemplo-x200-5g-5901234123457?variant=11",
        title: "Smartphone Exemplo X200 5G - 128GB - Preto",
        priceCents: 29999,
        referencePriceCents: 34999,
        inStock: true,
        sellerName: null,
        brand: "Exemplo",
        model: null,
        imageUrl: "https://darty.pt/cdn/shop/files/preto.jpg",
      },
    ]);
  });

  it("drops an unknown brand placeholder", () => {
    // Arrange
    const body = JSON.stringify({
      products: [
        {
          title: "Smart TV 32 HD ABC32XY99",
          handle: "smart-tv-32-hd-abc32xy99",
          vendor: "Não Indentificado",
          product_type: "Televisores",
          variants: [
            {
              id: 1,
              title: "Default Title",
              sku: "T00900003",
              available: true,
              price: "99.00",
              compare_at_price: "99.00",
            },
          ],
          images: [],
        },
      ],
    });

    // Act
    const page = darty.parseListingPage(body, TVS_URL, categoryByKey("televisores"));

    // Assert
    expect(page.items[0]?.brand).toBeNull();
    expect(page.items[0]?.imageUrl).toBeNull();
  });

  it("throws on a body that is not Shopify's product list", () => {
    // Arrange
    const html = "<!doctype html><html><body>Erro</body></html>";
    const wrongJson = '{"items":[]}';
    const category = categoryByKey("televisores");

    // Act
    const parseHtml = (): unknown => darty.parseListingPage(html, TVS_URL, category);
    const parseWrongJson = (): unknown => darty.parseListingPage(wrongJson, TVS_URL, category);

    // Assert
    expect(parseHtml).toThrow();
    expect(parseWrongJson).toThrow();
  });
});

describe("darty.parseProductPage", () => {
  it("reads the campaign price as the price and the PVPr apart, never as a reference price", () => {
    // Arrange
    const body = fixture("product-lg-55qned8mb6c.html");

    // Act
    const details = darty.parseProductPage(body, LG_55_URL);

    // Assert
    expect(details).toEqual({
      storeSku: "T00297176",
      url: LG_55_URL,
      title: 'Smart TV LG 55" QNED evo AI Mini-LED UHD 4K 55QNED8MB6C 2026 - 140cm',
      ean: "8806096857861",
      brand: "LG",
      model: "55QNED8MB6C",
      imageUrl:
        "https://darty.pt/cdn/shop/files/1505-1_bb9fbe8f-d467-4952-af5e-b2e6cd21edc5.jpg?v=1788292946&width=1920",
      specs: expect.objectContaining({
        "Ecrã - Tecnologia": "QNED Mini LED",
        Resolução: "3840 x 2160 (4K Ultra HD)",
        "Classe energética": "F",
      }) as Record<string, string>,
      sellerName: null,
      priceCents: 47999,
      referencePriceCents: null,
      rrpCents: 61999,
      inStock: true,
    });
    expect(Object.keys(details.specs)).toHaveLength(28);
  });

  it("reads a page without a campaign: the price only, with no PVPr", () => {
    // Arrange
    const body = fixture("product-nintendo-switch-sem-campanha.html");

    // Act
    const details = darty.parseProductPage(body, SWITCH_URL);

    // Assert
    expect(details).toMatchObject({
      storeSku: "2307945",
      title: "Consola Nintendo Switch V2 Néon Azul/Vermelho",
      ean: "0045496453596",
      brand: "Nintendo",
      priceCents: 29999,
      referencePriceCents: null,
      rrpCents: null,
      inStock: true,
    });
  });

  it("reads a JSON-LD price written with three decimals", () => {
    // Arrange
    // The price block is changed so that only the JSON-LD "428.990" can give 428,99 €.
    const body = fixture("product-hisense-rb390n4awe.html").replaceAll("428,99€", "999,99€");

    // Act
    const details = darty.parseProductPage(body, HISENSE_FRIDGE_URL);

    // Assert
    expect(details).toMatchObject({
      storeSku: "T00095808",
      ean: "6921727072863",
      model: "RB390N4AWE",
      priceCents: 42899,
      referencePriceCents: null,
      rrpCents: 57900,
      inStock: true,
    });
  });

  it("reads an out-of-stock TV with its campaign price", () => {
    // Arrange
    const body = fixture("product-lg-43lr6000la-esgotado.html");
    const url = "https://darty.pt/products/smart-tv-lg-43-led-full-hd-43lr6000la-2025-109-cm";

    // Act
    const details = darty.parseProductPage(body, url);

    // Assert
    expect(details).toMatchObject({
      storeSku: "T00182499",
      ean: "8806096520963",
      model: "43LR6000LA",
      priceCents: 23999,
      referencePriceCents: null,
      rrpCents: 29999,
      inStock: false,
    });
  });

  it("reads a washing machine page, keeping the first value of a repeated spec", () => {
    // Arrange
    const body = fixture("product-samsung-ww90cgc04dae.html");
    const url = "https://darty.pt/products/maquina-lavar-roupa-samsung-ww90cgc04dae-ep-9kg-1200rpm-a";

    // Act
    const details = darty.parseProductPage(body, url);

    // Assert
    expect(details).toMatchObject({
      storeSku: "T00100854",
      title: "Máquina de Lavar Roupa Samsung WW90CGC04DAEEP | 9 Kg | 1400 RPM | A | Branco",
      ean: "8806095210681",
      brand: "Samsung",
      model: "WW90CGC04DAEEP",
      priceCents: 42799,
      referencePriceCents: null,
      rrpCents: 68999,
      inStock: true,
      specs: expect.objectContaining({ Cor: "Branco", "Capacidade de Lavagem (kg)": "9" }) as Record<
        string,
        string
      >,
    });
    // 22 rows on the page, "Cor" twice.
    expect(Object.keys(details.specs)).toHaveLength(21);
  });

  it("takes the EAN from Shopify's barcode when the JSON-LD has no gtin", () => {
    // Arrange
    const body = fixture("product-lg-55qned8mb6c.html").replace('"gtin":"8806096857861",', "");

    // Act
    const details = darty.parseProductPage(body, LG_55_URL);

    // Assert
    expect(details.ean).toBe("8806096857861");
  });

  it("takes the price from the price block when the JSON-LD has none", () => {
    // Arrange
    const body = fixture("product-lg-55qned8mb6c.html").replace('"price":"479.99",', "");

    // Act
    const details = darty.parseProductPage(body, LG_55_URL);

    // Assert
    expect(details.priceCents).toBe(47999);
    expect(details.rrpCents).toBe(61999);
  });

  it("has no PVPr when the price block shows none", () => {
    // Arrange
    const body = fixture("product-lg-55qned8mb6c.html").replaceAll(
      "scx-price--line-pvpr",
      "scx-price--line-other",
    );

    // Act
    const details = darty.parseProductPage(body, LG_55_URL);

    // Assert
    expect(details.priceCents).toBe(47999);
    expect(details.rrpCents).toBeNull();
    expect(details.referencePriceCents).toBeNull();
  });

  it("picks the offer of the variant in the URL from a JSON-LD graph", () => {
    // Arrange
    const jsonLd = {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Darty" },
        {
          "@type": "Product",
          name: "Smartphone Exemplo X200 5G",
          sku: "T00900001",
          brand: "Exemplo",
          image: ["https://darty.pt/cdn/shop/files/preto.jpg"],
          offers: [
            {
              "@type": "Offer",
              price: "299.99",
              availability: "https://schema.org/InStock",
              url: "https://darty.pt/products/exemplo?variant=11",
            },
            {
              "@type": "Offer",
              price: 349.99,
              availability: "https://schema.org/OutOfStock",
              url: "https://darty.pt/products/exemplo?variant=12",
            },
          ],
        },
      ],
    };
    const body = `<html><head><script type="application/ld+json">${JSON.stringify(jsonLd)}</script></head></html>`;

    // Act
    const details = darty.parseProductPage(body, "https://darty.pt/products/exemplo?variant=12");

    // Assert
    expect(details).toMatchObject({
      storeSku: "T00900001",
      brand: "Exemplo",
      imageUrl: "https://darty.pt/cdn/shop/files/preto.jpg",
      priceCents: 34999,
      referencePriceCents: null,
      rrpCents: null,
      inStock: false,
      ean: null,
      specs: {},
    });
  });

  it("throws when the page has no Product JSON-LD", () => {
    // Arrange
    const body = "<html><body><h1>Página não encontrada</h1></body></html>";

    // Act
    const parse = (): unknown => darty.parseProductPage(body, "https://darty.pt/products/inexistente");

    // Assert
    expect(parse).toThrow(/JSON-LD/);
  });
});

describe("darty.isSoldByStore", () => {
  it("counts an item without a seller as sold by Darty, which has no marketplace", () => {
    // Arrange
    const body = fixture("collection-tvs.json");
    const [item] = darty.parseListingPage(body, TVS_URL, categoryByKey("televisores")).items;

    // Act
    const soldByStore = item === undefined ? null : darty.isSoldByStore(item);

    // Assert
    expect(soldByStore).toBe(true);
  });

  it("counts Darty as the store and any other named seller as a third party", () => {
    // Arrange
    const fromDarty = productDetails({ sellerName: "Darty" });
    const fromThirdParty = productDetails({ sellerName: "Loja Exemplo, Lda." });

    // Act
    const results = [darty.isSoldByStore(fromDarty), darty.isSoldByStore(fromThirdParty)];

    // Assert
    expect(results).toEqual([true, false]);
  });
});

describe("extractModel", () => {
  it.each([
    ['Smart TV LG 55" QNED evo AI Mini-LED UHD 4K 55QNED8MB6C 2026 - 140cm', "55QNED8MB6C"],
    ['Smart TV Hisense 58" LED UHD 4K 58A6Q - 147cm', "58A6Q"],
    ["TV Infiniton INTV-40N520 | LED | FHD | 40'' | 101,6 cm | G", "INTV-40N520"],
    ['Smart TV Monitor LG 24TQ510S-PZ LED 24" HD', "24TQ510S-PZ"],
    ["TCL 50C655 QLED GOOGLE TV 430 NITS", "50C655"],
    ["Máquina de Lavar Roupa Samsung WW90CGC04DAEEP | 9 Kg | 1400 RPM | A | Branco", "WW90CGC04DAEEP"],
    ["Máquina de Lavar e Secar Roupa LG WT1210BBF | 12/10Kg | 1400 RPM - Preto", "WT1210BBF"],
    [
      "Máquina de Café Automática com Moinho DeLonghi Magnifica Plus ECAM320.70.TB - Titanium Black",
      "ECAM320.70.TB",
    ],
    ["Máquina de Barbear Philips Series 5000X XP502/03 - Prateado | Preto", "XP502/03"],
  ])("finds the model code in %j", (title, expected) => {
    // Arrange
    const input = title;

    // Act
    const model = extractModel(input);

    // Assert
    expect(model).toBe(expected);
  });

  it.each([
    'TV Silver 32" LED HD Frameless 411593 81cm - Preto',
    "Krups Dolce Gusto Mini Me - Preto | Cinzento",
    "Máquina de Lavar Roupa Indesit IMA 762 MYTIME SPT| 7 Kg | 1200 RPM | A | Branco",
    "Smartphone Samsung Galaxy S25 5G 8GB/256GB",
    'Portátil Exemplo i7-13620H 16GB 512GB SSD 15.6"',
  ])("finds no model code in %j", (title) => {
    // Arrange
    const input = title;

    // Act
    const model = extractModel(input);

    // Assert
    expect(model).toBeNull();
  });
});

describe("eanFromHandle", () => {
  it.each([
    ["smart-tv-lg-55-qned-evo-ai-mini-led-uhd-4k-55qned8mb6c-2026-140cm-8806096857861", "8806096857861"],
    ["smart-tv-hisense-55-mini-led-uhd-4k-55u7q-pro-140-cm-outlet-grade-a-2200028022161", null],
    ["smart-tv-lg-32lq630b6-led-32-hd", null],
    ["tv-silver-32-led-hd-frameless-411593-81cm-preto", null],
    ["smart-tv-exemplo-5901234123458", null],
  ])("reads %j as %j", (handle, expected) => {
    // Arrange
    const input = handle;

    // Act
    const ean = eanFromHandle(input);

    // Assert
    expect(ean).toBe(expected);
  });
});
