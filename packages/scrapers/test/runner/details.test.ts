import { describe, expect, it } from "vitest";
import { buildListingDetails, factsFromListing, factsFromProductPage } from "../../src/runner/details";
import { fakeCategory, listingItem, productDetails, VALID_EAN } from "../fakes/fake-store";

const LAUNDRY = fakeCategory("lavar", { categorySlug: "maquinas-de-lavar-roupa" });

describe("buildListingDetails", () => {
  it("validates the EAN, normalizes brand and model and builds the slug base", () => {
    // Arrange
    const facts = factsFromProductPage(
      productDetails("123", {
        title: "Máquina de Lavar Roupa Samsung WW90T534DAE/S3 9 kg",
        ean: ` ${VALID_EAN} `,
        brand: "Samsung",
        model: "WW90T534DAE/S3",
      }),
      "Título da listagem",
    );

    // Act
    const input = buildListingDetails(7, facts, LAUNDRY, true);

    // Assert
    expect(input).toEqual({
      listingId: 7,
      rawEan: VALID_EAN,
      ean: VALID_EAN,
      brand: "Samsung",
      model: "WW90T534DAE/S3",
      brandNorm: "samsung",
      modelNorm: "WW90T534DAE",
      name: "Máquina de Lavar Roupa Samsung WW90T534DAE/S3 9 kg",
      slugBase: "samsung-ww90t534dae-s3-maquina-de-lavar-roupa",
      categorySlug: "maquinas-de-lavar-roupa",
      imageUrl: "https://loja.test/img/123.jpg",
      specs: { Ecrã: "55 polegadas" },
      soldByStore: true,
    });
  });

  it("keeps an invalid barcode as raw EAN only", () => {
    // Arrange
    const facts = factsFromListing(listingItem("1", { ean: "1234567890123" }));

    // Act
    const input = buildListingDetails(1, facts, LAUNDRY, true);

    // Assert
    expect([input.rawEan, input.ean]).toEqual(["1234567890123", null]);
  });

  it("treats blank brand, model and image as missing and falls back to the name for the slug", () => {
    // Arrange
    const facts = factsFromListing(
      listingItem("1", { title: "Frigorífico Combinado 185 cm", brand: "  ", model: "", imageUrl: " " }),
    );

    // Act
    const input = buildListingDetails(1, facts, LAUNDRY, false);

    // Assert
    expect(input).toMatchObject({
      brand: null,
      model: null,
      brandNorm: null,
      modelNorm: null,
      imageUrl: null,
      slugBase: "frigorifico-combinado-185-cm",
      soldByStore: false,
    });
  });
});

describe("factsFromListing", () => {
  it("takes the facts a listing shows and no specifications", () => {
    // Arrange
    const item = listingItem("1", {
      ean: VALID_EAN,
      brand: "LG",
      model: "OLED55C46LA",
      imageUrl: "https://loja.test/1.jpg",
    });

    // Act
    const facts = factsFromListing(item);

    // Assert
    expect(facts).toEqual({
      title: "Televisor 1",
      ean: VALID_EAN,
      brand: "LG",
      model: "OLED55C46LA",
      imageUrl: "https://loja.test/1.jpg",
      specs: {},
    });
  });

  it("reads absent listing facts as null", () => {
    // Act
    const facts = factsFromListing(listingItem("1"));

    // Assert
    expect([facts.ean, facts.brand, facts.model, facts.imageUrl]).toEqual([null, null, null, null]);
  });
});

describe("factsFromProductPage", () => {
  it("uses the listing title when the product page has none", () => {
    // Act
    const facts = factsFromProductPage(productDetails("1", { title: "  " }), "Televisor da listagem");

    // Assert
    expect(facts.title).toBe("Televisor da listagem");
  });
});
