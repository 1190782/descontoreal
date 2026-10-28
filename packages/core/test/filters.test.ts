import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTERS,
  filterSegments,
  isFilteredView,
  labelFromSlug,
  labelSlug,
  parseFilterSegments,
} from "../src/filters";

describe("parseFilterSegments", () => {
  it("reads no segments as the default view", () => {
    // Act
    const filters = parseFilterSegments([]);

    // Assert
    expect(filters).toEqual(DEFAULT_FILTERS);
  });

  it("reads every kind of filter in canonical order", () => {
    // Arrange
    const segments = [
      "marca-lg",
      "loja-darty",
      "rotulo-desconto-real",
      "preco-250-500",
      "ordem-preco",
      "pagina-3",
    ];

    // Act
    const filters = parseFilterSegments(segments);

    // Assert
    expect(filters).toEqual({
      brand: "lg",
      store: "darty",
      label: "desconto_real",
      price: "250-500",
      sort: "preco",
      page: 3,
    });
  });

  it.each([
    [["loja-darty", "marca-lg"]],
    [["marca-lg", "marca-samsung"]],
    [["ordem-desconto"]],
    [["pagina-1"]],
    [["pagina-0"]],
    [["pagina-02"]],
    [["pagina-1000"]],
    [["marca-LG"]],
    [["marca-"]],
    [["loja-amazon"]],
    [["rotulo-desconto_real"]],
    [["rotulo-falso"]],
    [["preco-0-50"]],
    [["cor-preto"]],
    [["televisores"]],
  ])("rejects %j", (segments) => {
    // Act
    const filters = parseFilterSegments(segments);

    // Assert
    expect(filters).toBeNull();
  });
});

describe("filterSegments", () => {
  it("writes the segments parseFilterSegments reads back", () => {
    // Arrange
    const segments = ["marca-samsung", "rotulo-subiu-antes-de-descer", "ordem-preco-desc", "pagina-2"];
    const filters = parseFilterSegments(segments);

    // Act
    const written = filters === null ? null : filterSegments(filters);

    // Assert
    expect(written).toEqual(segments);
  });

  it("writes nothing for the default view", () => {
    // Act
    const segments = filterSegments(DEFAULT_FILTERS);

    // Assert
    expect(segments).toEqual([]);
  });
});

describe("isFilteredView", () => {
  it.each([
    [DEFAULT_FILTERS, false],
    [{ ...DEFAULT_FILTERS, page: 2 }, true],
    [{ ...DEFAULT_FILTERS, brand: "lg" }, true],
  ])("isFilteredView(%j) is %s", (filters, expected) => {
    // Act
    const filtered = isFilteredView(filters);

    // Assert
    expect(filtered).toBe(expected);
  });
});

describe("labelSlug and labelFromSlug", () => {
  it("map label codes to path segments and back", () => {
    // Act
    const slug = labelSlug("minimo_historico");

    // Assert
    expect(slug).toBe("minimo-historico");
    expect(labelFromSlug(slug)).toBe("minimo_historico");
  });
});
