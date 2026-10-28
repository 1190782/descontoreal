import { describe, expect, it } from "vitest";
import { LABEL_NAMES, LABEL_TONES, WARNING_NAMES } from "../../src/labels/names";

describe("LABEL_NAMES", () => {
  it("names every label as the plan does", () => {
    // Arrange
    const expected = {
      historico_insuficiente: "Histórico insuficiente",
      minimo_historico: "Mínimo histórico",
      desconto_real: "Desconto real",
      subiu_antes_de_descer: "Subiu antes de descer",
      desconto_pequeno: "Desconto pequeno",
      sem_desconto_real: "Sem desconto real",
      bom_preco: "Bom preço",
      acima_do_habitual: "Acima do habitual",
      preco_habitual: "Preço habitual",
    };

    // Act
    const names = LABEL_NAMES;

    // Assert
    expect(names).toEqual(expected);
  });
});

describe("LABEL_TONES", () => {
  it("colours good moments green, caution cases amber and the rest neutral", () => {
    // Arrange
    const expected = {
      desconto_real: "positive",
      minimo_historico: "positive",
      bom_preco: "positive",
      desconto_pequeno: "caution",
      subiu_antes_de_descer: "caution",
      sem_desconto_real: "caution",
      acima_do_habitual: "caution",
      preco_habitual: "neutral",
      historico_insuficiente: "neutral",
    };

    // Act
    const tones = LABEL_TONES;

    // Assert
    expect(tones).toEqual(expected);
  });
});

describe("WARNING_NAMES", () => {
  it("names every warning as the plan does", () => {
    // Arrange
    const expected = {
      desconto_anunciado_exagerado: "Desconto anunciado exagerado",
      mais_barato_noutra_loja: "Mais barato noutra loja",
      esgotado: "Esgotado",
    };

    // Act
    const names = WARNING_NAMES;

    // Assert
    expect(names).toEqual(expected);
  });
});
