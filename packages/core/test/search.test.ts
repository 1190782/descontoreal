import { describe, expect, it } from "vitest";
import { MAX_QUERY_LENGTH, parseSearchQuery } from "../src/search";

describe("parseSearchQuery", () => {
  it.each([[""], ["   "]])("reads %j as empty", (raw) => {
    // Act
    const query = parseSearchQuery(raw);

    // Assert
    expect(query).toEqual({ kind: "empty" });
  });

  it("reads a pasted product address of a store we collect", () => {
    // Act
    const query = parseSearchQuery(" https://www.darty.pt/products/lg-55qned86a6a?variant=1 ");

    // Assert
    expect(query).toEqual({
      kind: "store-url",
      storeSlug: "darty",
      url: "https://darty.pt/products/lg-55qned86a6a",
    });
  });

  it("reads an address of a store we do not collect", () => {
    // Act
    const query = parseSearchQuery("https://www.fnac.pt/a1234567/Apple-iPhone");

    // Assert
    expect(query).toEqual({ kind: "inactive-store", storeSlug: "fnac" });
  });

  it("reads an address that is not a store product page", () => {
    // Act
    const query = parseSearchQuery("www.amazon.es/dp/B0C1234567");

    // Assert
    expect(query).toEqual({ kind: "other-url" });
  });

  it("reads a valid EAN, with spaces", () => {
    // Act
    const query = parseSearchQuery("4006381 333931");

    // Assert
    expect(query).toEqual({ kind: "ean", ean: "4006381333931" });
  });

  it("reads digits with a wrong check digit as words", () => {
    // Act
    const query = parseSearchQuery("4006381333932");

    // Assert
    expect(query).toEqual({ kind: "text", text: "4006381333932", models: [] });
  });

  it("reads words and keeps the ones that look like model codes", () => {
    // Act
    const query = parseSearchQuery("Samsung  ww90t534dae tv 55");

    // Assert
    expect(query).toEqual({ kind: "text", text: "Samsung ww90t534dae tv 55", models: ["WW90T534DAE"] });
  });

  it("cuts very long searches", () => {
    // Act
    const query = parseSearchQuery("a".repeat(MAX_QUERY_LENGTH + 50));

    // Assert
    expect(query).toEqual({ kind: "text", text: "a".repeat(MAX_QUERY_LENGTH), models: [] });
  });
});
