import { readdirSync, readFileSync } from "node:fs";
import type { StoreSlug } from "@descontoreal/core";
import { describe, expect, it } from "vitest";
import { TRIM_RULES, type TrimRules, trimFixture, trimHtml } from "../../scripts/trim-fixtures";

const NOTE =
  "<!-- Excerpt for tests: only what the store's parser reads (packages/scrapers/scripts/trim-fixtures.ts). -->";
const FIXTURE_STORES: StoreSlug[] = ["darty", "radiopopular"];
const FIXTURES = FIXTURE_STORES.flatMap((store) =>
  readdirSync(new URL(`../../fixtures/${store}/`, import.meta.url)).map((name) => ({ store, name })),
);

function rulesFor(store: StoreSlug): TrimRules {
  const rules = TRIM_RULES[store];
  if (rules === undefined) {
    throw new Error(`No trim rules for ${store}`);
  }
  return rules;
}

describe("trimHtml", () => {
  it("keeps the kept elements as written and only the tags of their ancestors, without style attributes", () => {
    // Arrange
    const page = [
      "<!DOCTYPE html>",
      '<html lang="pt-PT"><head><meta charset="UTF-8"><title>Página</title><meta name="description" content="Texto"></head>',
      "<body>",
      "<header><nav>Menu</nav></header>",
      '<main class="page">',
      "  <p>Texto de campanha</p>",
      '  <div class="price" style="color: red">9<sup>,99</sup>&nbsp;&euro;</div>',
      "</main>",
      "<footer>Rodapé</footer>",
      "</body></html>",
      "",
    ].join("\n");

    // Act
    const trimmed = trimHtml(page, { keep: [".price"] });

    // Assert
    expect(trimmed).toBe(
      [
        "<!DOCTYPE html>",
        NOTE,
        '<html lang="pt-PT"><head><meta charset="UTF-8"><title>Página</title></head>',
        "<body>",
        '<main class="page">',
        '  <div class="price">9<sup>,99</sup>&nbsp;&euro;</div>',
        "</main>",
        "</body></html>",
        "",
      ].join("\n"),
    );
  });

  it("removes comments, styles, scripts, svg, descriptions and dropped elements, even inside kept ones", () => {
    // Arrange
    const page =
      '<div class="card"><!-- banner --><style>.x{}</style><script>track()</script><svg><path d="M0"/></svg>' +
      '<meta itemprop="description" content="Texto"><span class="promo">Oferta</span><span class="price">5 €</span></div>';

    // Act
    const trimmed = trimHtml(page, { keep: [".card"], drop: [".promo"] });

    // Assert
    expect(trimmed).toBe(`${NOTE}\n<div class="card"><span class="price">5 €</span></div>`);
  });

  it("keeps a script a rule names, with the descriptions of its JSON emptied", () => {
    // Arrange
    const page =
      '<script type="application/ld+json">{"name":"TV","description":"Texto","sku":"T1"}</script>' +
      '<script>window.product = {"description":"<p>Texto</p>","content":"<p>Texto</p>","variants":[]};</script>';

    // Act
    const trimmed = trimHtml(page, {
      keep: ['script[type="application/ld+json"]', 'script:contains("window.product")'],
    });

    // Assert
    expect(trimmed).toBe(
      `${NOTE}\n<script type="application/ld+json">{"name":"TV","description":"","sku":"T1"}</script>` +
        '<script>window.product = {"description":"","content":"","variants":[]};</script>',
    );
  });

  it("keeps an element as tags only when a rule says so", () => {
    // Arrange
    const page =
      '<div class="grid" data-total="31"><p>Texto</p><article class="card">A</article></div><div>B</div>';

    // Act
    const trimmed = trimHtml(page, { keep: [], keepTags: ["[data-total]"] });

    // Assert
    expect(trimmed).toBe(`${NOTE}\n<div class="grid" data-total="31"></div>`);
  });
});

describe("trimFixture", () => {
  it("keeps the fields of a Shopify listing that the Darty parser reads, with the first image only", () => {
    // Arrange
    const listing = {
      products: [
        {
          id: 1,
          title: "TV Exemplo",
          handle: "tv-exemplo",
          body_html: "<p>Texto</p>",
          vendor: "Exemplo",
          product_type: "Televisores",
          tags: ["TV"],
          variants: [
            {
              id: 2,
              title: "Default Title",
              sku: "T00900001",
              available: true,
              price: "99.99",
              grams: 0,
              compare_at_price: "99.99",
              featured_image: { id: 3, src: "//darty.pt/a.jpg", alt: "Texto" },
            },
          ],
          images: [
            { id: 4, src: "//darty.pt/b.jpg" },
            { id: 5, src: "//darty.pt/c.jpg" },
          ],
        },
      ],
    };

    // Act
    const trimmed = trimFixture(Buffer.from(JSON.stringify(listing)), "listing.json", rulesFor("darty"));

    // Assert
    expect(JSON.parse(trimmed.toString("utf8"))).toEqual({
      products: [
        {
          title: "TV Exemplo",
          handle: "tv-exemplo",
          vendor: "Exemplo",
          product_type: "Televisores",
          variants: [
            {
              id: 2,
              title: "Default Title",
              sku: "T00900001",
              available: true,
              price: "99.99",
              compare_at_price: "99.99",
              featured_image: { src: "//darty.pt/a.jpg" },
            },
          ],
          images: [{ src: "//darty.pt/b.jpg" }],
        },
      ],
    });
  });

  it("writes the page back in its own encoding", () => {
    // Arrange
    const page = Buffer.from(
      '<html><head><meta charset="windows-1252"></head><body><p class="price">\x80 9,99</p></body></html>',
      "latin1",
    );

    // Act
    const trimmed = trimFixture(page, "pagina.html", { keep: [".price"] });

    // Assert
    expect(trimmed.toString("latin1")).toBe(
      `${NOTE}\n<html><head><meta charset="windows-1252"></head><body><p class="price">\x80 9,99</p></body></html>`,
    );
  });

  it.each(FIXTURES)("finds nothing more to trim in $store/$name", ({ store, name }) => {
    // Arrange
    const bytes = readFileSync(new URL(`../../fixtures/${store}/${name}`, import.meta.url));

    // Act
    const trimmed = trimFixture(bytes, name, rulesFor(store));

    // Assert
    expect(trimmed.toString("utf8")).toBe(bytes.toString("utf8"));
  });
});
