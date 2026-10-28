import { describe, expect, it } from "vitest";
import type { Offer } from "../src/insights";
import { formatCents } from "../src/money";
import {
  breadcrumbJsonLd,
  organizationJsonLd,
  productDescription,
  productJsonLd,
  productTitle,
  serializeJsonLd,
} from "../src/seo";

const NOW = new Date("2026-11-20T10:00:00Z");
const DARTY: Offer = { listingId: 1, storeSlug: "darty", storeName: "Darty", priceCents: 44_999 };
const RADIO_POPULAR: Offer = {
  listingId: 2,
  storeSlug: "radiopopular",
  storeName: "Radio Popular",
  priceCents: 47_999,
};

describe("organizationJsonLd", () => {
  it("describes the site as a schema.org Organization", () => {
    // Arrange
    const expected = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "DescontoReal",
      url: "https://descontoreal.pt",
      email: "contacto@descontoreal.pt",
    };

    // Act
    const jsonLd = organizationJsonLd();

    // Assert
    expect(jsonLd).toEqual(expected);
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so a product name cannot close the script element", () => {
    // Arrange
    const data = { "@type": "Product", name: 'TV </script><script>alert(1)</script> 55"' };

    // Act
    const json = serializeJsonLd(data);

    // Assert
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual(data);
  });

  it("serializes a list of objects as a JSON array", () => {
    // Arrange
    const data = [{ "@type": "Organization" }, { "@type": "BreadcrumbList" }];

    // Act
    const json = serializeJsonLd(data);

    // Assert
    expect(json).toBe('[{"@type":"Organization"},{"@type":"BreadcrumbList"}]');
  });
});

describe("productJsonLd", () => {
  it("describes today's offers as an AggregateOffer in euros", () => {
    // Arrange
    const input = {
      name: "Samsung WW90T534DAE",
      url: "https://descontoreal.pt/p/samsung-ww90t534dae-maquina-de-lavar-roupa",
      imageUrl: "https://darty.pt/cdn/shop/files/ww90.jpg",
      brand: "Samsung",
      ean: "8806094959581",
      offers: [DARTY, RADIO_POPULAR],
    };

    // Act
    const jsonLd = productJsonLd(input);

    // Assert
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Samsung WW90T534DAE",
      url: "https://descontoreal.pt/p/samsung-ww90t534dae-maquina-de-lavar-roupa",
      image: ["https://darty.pt/cdn/shop/files/ww90.jpg"],
      brand: { "@type": "Brand", name: "Samsung" },
      gtin13: "8806094959581",
      offers: {
        "@type": "AggregateOffer",
        priceCurrency: "EUR",
        lowPrice: "449.99",
        highPrice: "479.99",
        offerCount: 2,
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("leaves out the image, brand and EAN the product does not have", () => {
    // Arrange
    const input = {
      name: "Robô X",
      url: "https://descontoreal.pt/p/robo-x",
      imageUrl: null,
      brand: null,
      ean: null,
      offers: [DARTY],
    };

    // Act
    const jsonLd = productJsonLd(input);

    // Assert
    expect(Object.keys(jsonLd ?? {})).toEqual(["@context", "@type", "name", "url", "offers"]);
  });

  it("returns null without a current offer", () => {
    // Arrange
    const input = {
      name: "Robô X",
      url: "https://descontoreal.pt/p/robo-x",
      imageUrl: null,
      brand: null,
      ean: null,
      offers: [],
    };

    // Act
    const jsonLd = productJsonLd(input);

    // Assert
    expect(jsonLd).toBeNull();
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the items from 1", () => {
    // Arrange
    const items = [
      { name: "Início", url: "https://descontoreal.pt/" },
      { name: "Televisores", url: "https://descontoreal.pt/c/televisores" },
    ];

    // Act
    const jsonLd = breadcrumbJsonLd(items);

    // Assert
    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Início", item: "https://descontoreal.pt/" },
        {
          "@type": "ListItem",
          position: 2,
          name: "Televisores",
          item: "https://descontoreal.pt/c/televisores",
        },
      ],
    });
  });
});

describe("productTitle", () => {
  it("follows the title pattern of the product pages", () => {
    // Act
    const title = productTitle("LG 55QNED86A6A");

    // Assert
    expect(title).toBe("LG 55QNED86A6A: histórico de preço e melhor preço hoje");
  });
});

describe("productDescription", () => {
  const base = { name: "LG 55QNED86A6A", storeNames: ["Darty", "Radio Popular"], now: NOW };

  it("gives today's best price and the lowest since tracking started", () => {
    // Arrange
    const input = {
      ...base,
      best: DARTY,
      lowest: { priceCents: 42_999, storeName: "Darty", since: new Date("2026-11-02T04:00:00Z") },
      trackedSince: new Date("2026-10-28T04:00:00Z"),
    };

    // Act
    const description = productDescription(input);

    // Assert
    expect(description).toBe(
      `Mais barato hoje: ${formatCents(44_999)} na Darty. Mínimo desde 28 de outubro de 2026: ${formatCents(42_999)}.`,
    );
  });

  it("speaks of the last 90 days once the history is longer", () => {
    // Arrange
    const input = {
      ...base,
      best: DARTY,
      lowest: { priceCents: 42_999, storeName: "Darty", since: new Date("2026-09-02T04:00:00Z") },
      trackedSince: new Date("2026-05-01T04:00:00Z"),
    };

    // Act
    const description = productDescription(input);

    // Assert
    expect(description).toBe(
      `Mais barato hoje: ${formatCents(44_999)} na Darty. Mínimo dos últimos 90 dias: ${formatCents(42_999)}.`,
    );
  });

  it("names the stores when nothing is on sale today", () => {
    // Arrange
    const input = { ...base, best: null, lowest: null, trackedSince: null };

    // Act
    const description = productDescription(input);

    // Assert
    expect(description).toBe(
      "Histórico de preço de LG 55QNED86A6A na Darty e na Radio Popular, atualizado todos os dias.",
    );
  });
});
