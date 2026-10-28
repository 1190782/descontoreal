import { describe, expect, it } from "vitest";
import { STORES, getStore, isStoreSlug, type StoreInfo, type StoreSlug } from "../src/stores";

const ALL: readonly StoreInfo[] = STORES;

describe("STORES", () => {
  it("lists the four launch stores", () => {
    // Arrange
    const expected = ["worten", "radiopopular", "darty", "fnac"];

    // Act
    const slugs = ALL.map((store) => store.slug);

    // Assert
    expect(slugs).toEqual(expected);
  });

  it("keeps the stores that block our bot inactive", () => {
    // Arrange
    const expected = ["radiopopular", "darty"];

    // Act
    const active = ALL.filter((store) => store.active).map((store) => store.slug);

    // Assert
    expect(active).toEqual(expected);
  });

  it("uses https base URLs without a trailing slash", () => {
    // Arrange
    const urls = ALL.map((store) => store.baseUrl);

    // Act
    const invalid = urls.filter((url) => !url.startsWith("https://") || url.endsWith("/"));

    // Assert
    expect(invalid).toEqual([]);
  });
});

describe("isStoreSlug", () => {
  it.each([
    ["worten", true],
    ["radiopopular", true],
    ["darty", true],
    ["fnac", true],
    ["amazon", false],
    ["Darty", false],
    ["", false],
  ])("isStoreSlug(%j) is %s", (value, expected) => {
    // Arrange
    const input = value;

    // Act
    const result = isStoreSlug(input);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getStore", () => {
  it("returns the store for a slug", () => {
    // Arrange
    const slug: StoreSlug = "radiopopular";

    // Act
    const store = getStore(slug);

    // Assert
    expect(store).toEqual({
      slug: "radiopopular",
      name: "Radio Popular",
      baseUrl: "https://www.radiopopular.pt",
      active: true,
    });
  });

  it("throws for an unknown slug", () => {
    // Arrange
    const slug = "amazon" as StoreSlug;

    // Act
    const read = (): StoreInfo => getStore(slug);

    // Assert
    expect(read).toThrow("Unknown store: amazon");
  });
});
