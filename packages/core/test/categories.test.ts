import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  categoryAndChildren,
  getCategory,
  isCategorySlug,
  type Category,
  type CategorySlug,
} from "../src/categories";
import { slugify } from "../src/normalize";

const ALL: readonly Category[] = CATEGORIES;

describe("CATEGORIES", () => {
  it("has unique slugs", () => {
    // Arrange
    const slugs = ALL.map((category) => category.slug);

    // Act
    const unique = new Set(slugs);

    // Assert
    expect(unique.size).toBe(slugs.length);
  });

  it("uses URL-safe slugs", () => {
    // Arrange
    const slugs = ALL.map((category) => category.slug);

    // Act
    const unsafe = slugs.filter((slug) => slugify(slug) !== slug);

    // Assert
    expect(unsafe).toEqual([]);
  });

  it("is a two-level tree whose leaves point at an existing root", () => {
    // Arrange
    const roots = new Set(
      ALL.filter((category) => category.parent === null).map((category) => category.slug),
    );

    // Act
    const orphans = ALL.filter((category) => category.parent !== null && !roots.has(category.parent));

    // Assert
    expect(roots.size).toBeGreaterThan(0);
    expect(orphans).toEqual([]);
  });

  it("gives every leaf, and only leaves, a singular noun for product slugs", () => {
    // Arrange
    const leaves = ALL.filter((category) => category.parent !== null);
    const roots = ALL.filter((category) => category.parent === null);

    // Act
    const leavesWithoutSingular = leaves.filter((category) => !category.singular);
    const rootsWithSingular = roots.filter((category) => category.singular !== undefined);

    // Assert
    expect(leavesWithoutSingular).toEqual([]);
    expect(rootsWithSingular).toEqual([]);
  });

  it("gives every root at least one leaf", () => {
    // Arrange
    const roots = ALL.filter((category) => category.parent === null);

    // Act
    const empty = roots.filter((root) => !ALL.some((category) => category.parent === root.slug));

    // Assert
    expect(empty).toEqual([]);
  });
});

describe("isCategorySlug", () => {
  it.each([
    ["maquinas-de-lavar-roupa", true],
    ["grandes-eletrodomesticos", true],
    ["televisores", true],
    ["Televisores", false],
    ["carros", false],
    ["", false],
  ])("isCategorySlug(%j) is %s", (value, expected) => {
    // Arrange
    const input = value;

    // Act
    const result = isCategorySlug(input);

    // Assert
    expect(result).toBe(expected);
  });
});

describe("getCategory", () => {
  it("returns the category for a slug", () => {
    // Arrange
    const slug: CategorySlug = "frigorificos";

    // Act
    const category = getCategory(slug);

    // Assert
    expect(category).toEqual({
      slug: "frigorificos",
      name: "Frigoríficos",
      parent: "grandes-eletrodomesticos",
      singular: "frigorífico",
    });
  });

  it("throws for an unknown slug", () => {
    // Arrange
    const slug = "carros" as CategorySlug;

    // Act
    const read = (): Category => getCategory(slug);

    // Assert
    expect(read).toThrow("Unknown category: carros");
  });
});

describe("categoryAndChildren", () => {
  it("returns a top category with its children", () => {
    // Act
    const slugs = categoryAndChildren("gaming");

    // Assert
    expect(slugs).toEqual(["gaming", "consolas"]);
  });

  it("returns a leaf category alone", () => {
    // Act
    const slugs = categoryAndChildren("televisores");

    // Assert
    expect(slugs).toEqual(["televisores"]);
  });
});
