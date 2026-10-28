import { describe, expect, it } from "vitest";
import { normalizeBrand, normalizeModel, productSlugBase, slugify } from "../src/normalize";

describe("normalizeBrand", () => {
  it.each([
    ["Bosch", "bosch"],
    ["De'Longhi", "delonghi"],
    ["DeLonghi", "delonghi"],
    [" SAMSUNG ", "samsung"],
    ["LG Electronics", "lgelectronics"],
    ["Rowenta®", "rowenta"],
    ["Pêra-Doce", "peradoce"],
  ])("normalizes %j to %j", (brand, expected) => {
    // Arrange
    const input = brand;

    // Act
    const normalized = normalizeBrand(input);

    // Assert
    expect(normalized).toBe(expected);
  });

  it.each([null, undefined, "", "!!!"])("returns null for %j", (brand) => {
    // Arrange
    const input = brand;

    // Act
    const normalized = normalizeBrand(input);

    // Assert
    expect(normalized).toBeNull();
  });
});

describe("normalizeModel", () => {
  it.each([
    ["WW90T534DAE/S3", "WW90T534DAE"],
    ["OLED55C46LA.AEU", "OLED55C46LA"],
    ["QE55Q67RATXXC", "QE55Q67RA"],
    ["ECAM22.110.B", "ECAM22110"],
  ])("follows its documented example %j → %j", (model, expected) => {
    // Arrange
    const input = model;

    // Act
    const normalized = normalizeModel(input);

    // Assert
    expect(normalized).toBe(expected);
  });

  it.each([
    ["spaces around the slash", "WW90T534DAE / S3", "WW90T534DAE"],
    ["lowercase", "ww90t534dae/s3", "WW90T534DAE"],
    ["hyphens", "KD-55X80L", "KD55X80L"],
    ["a dual-SIM suffix", "SM-A556B/DS", "SMA556B"],
    ["an Apple region suffix", "MGN63PO/A", "MGN63PO"],
    ["a tail without T", "UE55CU7105KXXC", "UE55CU7105K"],
    ["a spaced tail", "QE55Q67RAT XXC", "QE55Q67RA"],
    ["a model with spaces", "ECAM 22.110.B", "ECAM22110"],
  ])("handles %s", (_case, model, expected) => {
    // Arrange
    const input = model;

    // Act
    const normalized = normalizeModel(input);

    // Assert
    expect(normalized).toBe(expected);
  });

  it("gives the same code to a model with and without its color suffix", () => {
    // Arrange
    const withColor = "ECAM22.110.B";
    const withoutColor = "ECAM22.110";

    // Act
    const normalized = [normalizeModel(withColor), normalizeModel(withoutColor)];

    // Assert
    expect(normalized).toEqual(["ECAM22110", "ECAM22110"]);
  });

  it("keeps models that differ before the last dot apart", () => {
    // Arrange
    const models = ["ECAM22.110.B", "ECAM22.360.S", "ECAM 290.61.B", "ECAM 290.81.TB"];

    // Act
    const normalized = models.map((model) => normalizeModel(model));

    // Assert
    expect(normalized).toEqual(["ECAM22110", "ECAM22360", "ECAM29061", "ECAM29081"]);
  });

  it.each([
    ["a digits-only variant", "HD9252/90", "HD925290"],
    ["a suffix longer than four characters", "WW90T534DAE/ABCDE", "WW90T534DAEABCDE"],
    ["a region tail that would leave a short code", "ABXXC", "ABXXC"],
    ["a model that is only a tail", "TXXC", "TXXC"],
  ])("is conservative with %s", (_case, model, expected) => {
    // Arrange
    const input = model;

    // Act
    const normalized = normalizeModel(input);

    // Assert
    expect(normalized).toBe(expected);
  });

  it.each([null, undefined, "", "   ", "/", "-/A"])("returns null for %j", (model) => {
    // Arrange
    const input = model;

    // Act
    const normalized = normalizeModel(input);

    // Assert
    expect(normalized).toBeNull();
  });
});

describe("slugify", () => {
  it.each([
    ["Máquina de Lavar", "maquina-de-lavar"],
    ["  Olá, Mundo!  ", "ola-mundo"],
    ['TV 55" 4K', "tv-55-4k"],
    ["De'Longhi", "de-longhi"],
    ["Frigorífico--Combinado", "frigorifico-combinado"],
    ["", ""],
    ["!!!", ""],
  ])("slugifies %j as %j", (text, expected) => {
    // Arrange
    const input = text;

    // Act
    const slug = slugify(input);

    // Assert
    expect(slug).toBe(expected);
  });
});

describe("productSlugBase", () => {
  it("builds {marca}-{modelo}-{tipo}", () => {
    // Arrange
    const input = {
      brand: "Samsung",
      model: "WW90T534DAE",
      name: "Máquina de Lavar Roupa Samsung WW90T534DAE 9 kg",
      categorySingular: "máquina de lavar roupa",
    };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe("samsung-ww90t534dae-maquina-de-lavar-roupa");
  });

  it("does not repeat the brand when the model starts with it", () => {
    // Arrange
    const input = {
      brand: "Samsung",
      model: "Samsung Galaxy S24",
      name: "x",
      categorySingular: "smartphone",
    };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe("samsung-galaxy-s24-smartphone");
  });

  it("leaves out the type when the category has no singular", () => {
    // Arrange
    const input = { brand: "LG", model: "OLED55C46LA", name: "x", categorySingular: null };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe("lg-oled55c46la");
  });

  it.each([
    ["brand", { brand: null, model: "WW90T534DAE" }],
    ["model", { brand: "Samsung", model: null }],
    ["an empty brand", { brand: "", model: "WW90T534DAE" }],
  ])("falls back to the name without a %s", (_case, partial) => {
    // Arrange
    const input = {
      ...partial,
      name: "Máquina de Lavar Roupa 9 kg",
      categorySingular: "máquina de lavar roupa",
    };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe("maquina-de-lavar-roupa-9-kg");
  });

  it("falls back to produto when nothing is usable", () => {
    // Arrange
    const input = { brand: null, model: null, name: "!!!", categorySingular: null };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe("produto");
  });

  it("cuts long slugs at a word boundary, keeping a slug of exactly 80 characters", () => {
    // Arrange
    const words = Array.from({ length: 20 }, (_, index) => `palavra${index}`);
    const input = { brand: null, model: null, name: words.join(" "), categorySingular: null };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe(words.slice(0, 9).join("-"));
    expect(slug).toHaveLength(80);
  });

  it("returns produto when the first word alone is longer than 80 characters", () => {
    // Arrange
    const input = { brand: null, model: null, name: "a".repeat(81), categorySingular: null };

    // Act
    const slug = productSlugBase(input);

    // Assert
    expect(slug).toBe("produto");
  });
});
