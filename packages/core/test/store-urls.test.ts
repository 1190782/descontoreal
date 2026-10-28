import { describe, expect, it } from "vitest";
import { parseStoreUrl } from "../src/store-urls";

describe("parseStoreUrl", () => {
  it.each([
    ["https://darty.pt/products/samsung-ww90t534dae"],
    ["https://www.darty.pt/products/samsung-ww90t534dae"],
    ["darty.pt/products/samsung-ww90t534dae"],
    ["https://darty.pt/products/samsung-ww90t534dae/"],
    ["https://darty.pt/products/samsung-ww90t534dae?variant=58731832639872#top"],
    ["https://darty.pt/collections/maquinas-de-lavar-roupa/products/samsung-ww90t534dae"],
    ["https://darty.pt/products/Samsung-WW90T534DAE"],
  ])("reads the Darty address %s as its listing address", (input) => {
    // Act
    const parsed = parseStoreUrl(input);

    // Assert
    expect(parsed).toEqual({
      kind: "listing",
      storeSlug: "darty",
      url: "https://darty.pt/products/samsung-ww90t534dae",
    });
  });

  it.each([
    ["https://www.radiopopular.pt/produto/maquina-de-lavar-roupa-samsung-ww90fg3m05awep"],
    ["https://radiopopular.pt/produto/maquina-de-lavar-roupa-samsung-ww90fg3m05awep?origem=pesquisa"],
  ])("reads the Radio Popular address %s as its listing address", (input) => {
    // Act
    const parsed = parseStoreUrl(input);

    // Assert
    expect(parsed).toEqual({
      kind: "listing",
      storeSlug: "radiopopular",
      url: "https://www.radiopopular.pt/produto/maquina-de-lavar-roupa-samsung-ww90fg3m05awep",
    });
  });

  it("recognises a store we do not collect", () => {
    // Act
    const parsed = parseStoreUrl("https://www.worten.pt/produtos/maquina-de-lavar-roupa-samsung-1234");

    // Assert
    expect(parsed).toEqual({ kind: "inactive-store", storeSlug: "worten" });
  });

  it.each([
    ["https://www.amazon.es/dp/B0C1234567"],
    ["https://darty.pt/collections/tvs"],
    ["https://www.radiopopular.pt/categoria/maquinas-de-lavar-roupa"],
    ["não é um endereço"],
  ])("returns null for %s", (input) => {
    // Act
    const parsed = parseStoreUrl(input);

    // Assert
    expect(parsed).toBeNull();
  });
});
