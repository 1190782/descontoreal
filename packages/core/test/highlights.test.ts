import { describe, expect, it } from "vitest";
import { type HighlightCandidate, pickHighlights } from "../src/highlights";
import type { LabelCode, LabelNumbers } from "../src/labels/types";
import { formatCents } from "../src/money";

function numbers(overrides: Partial<LabelNumbers> = {}): LabelNumbers {
  return {
    priceCents: 44_999,
    referencePriceCents: null,
    currentSince: "2026-11-15T04:00:00.000Z",
    m30Cents: 50_999,
    med90Cents: 50_999,
    max90Cents: 50_999,
    max90Since: "2026-10-28T04:00:00.000Z",
    windowDays: 18,
    trackedSince: "2026-10-28T04:00:00.000Z",
    historyDays: 23,
    announcedDiscountPct: null,
    realDiscountPct: 11.8,
    belowMed90Pct: 11.8,
    ...overrides,
  };
}

function candidate(
  productSlug: string,
  label: LabelCode,
  overrides: Partial<LabelNumbers> = {},
): HighlightCandidate {
  return {
    productSlug,
    productName: productSlug.toUpperCase(),
    imageUrl: null,
    storeName: "Darty",
    priceCents: 44_999,
    label,
    labelText: `Texto do rótulo de ${productSlug}.`,
    numbers: numbers(overrides),
  };
}

describe("pickHighlights", () => {
  it("shows the biggest real discounts once labels exist, with the label's text", () => {
    // Arrange
    const candidates = [
      candidate("tv-a", "desconto_real", { realDiscountPct: 12 }),
      candidate("tv-b", "historico_insuficiente", { realDiscountPct: 40 }),
      candidate("tv-c", "minimo_historico", { realDiscountPct: 20 }),
    ];

    // Act
    const highlights = pickHighlights(candidates, 6);

    // Assert
    expect(highlights.kind).toBe("labels");
    expect(highlights.items.map((item) => [item.productSlug, item.text])).toEqual([
      ["tv-c", "Texto do rótulo de tv-c."],
      ["tv-a", "Texto do rótulo de tv-a."],
    ]);
  });

  it("shows one card per product, its best offer first", () => {
    // Arrange
    const candidates = [
      candidate("tv-a", "desconto_real", { realDiscountPct: 12 }),
      candidate("tv-a", "desconto_real", { realDiscountPct: 15 }),
    ];

    // Act
    const highlights = pickHighlights(candidates, 6);

    // Assert
    expect(highlights.items.map((item) => item.numbers.realDiscountPct)).toEqual([15]);
  });

  it("falls back to drops below the usual price, described with numbers and dates only", () => {
    // Arrange
    const candidates = [
      candidate("tv-a", "historico_insuficiente", { belowMed90Pct: 4 }),
      candidate("tv-b", "historico_insuficiente", { belowMed90Pct: 8, med90Cents: 50_999, windowDays: 10 }),
      candidate("tv-c", "historico_insuficiente", { belowMed90Pct: 15, windowDays: 3 }),
    ];

    // Act
    const highlights = pickHighlights(candidates, 6);

    // Assert
    expect(highlights.kind).toBe("drops");
    expect(highlights.items.map((item) => [item.productSlug, item.text])).toEqual([
      ["tv-b", `8% abaixo do preço habitual desde 28 de outubro de 2026 (${formatCents(50_999)}).`],
    ]);
  });

  it("keeps at most `limit` items", () => {
    // Arrange
    const candidates = ["a", "b", "c"].map((slug) => candidate(slug, "desconto_real"));

    // Act
    const highlights = pickHighlights(candidates, 2);

    // Assert
    expect(highlights.items).toHaveLength(2);
  });
});
