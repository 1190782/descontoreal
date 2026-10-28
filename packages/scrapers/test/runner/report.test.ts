import { formatCents } from "@descontoreal/core";
import { describe, expect, it } from "vitest";
import {
  formatAdminMessage,
  formatRunSummary,
  formatSampleTable,
  type IncompleteCategory,
  type RunReport,
  type SampleItem,
} from "../../src/runner/report";

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    store: "darty",
    status: "success",
    dryRun: false,
    partial: false,
    timeLimitMinutes: null,
    pagesFetched: 120,
    listingsSeen: 2400,
    droppedMarketplace: 12,
    new: 30,
    changed: 210,
    unchanged: 2148,
    productPagesFetched: 380,
    pricePagesFetched: 0,
    skippedPrices: 0,
    revisited: 343,
    skippedJumps: 1,
    budgetExhausted: 0,
    incompleteCategories: [],
    errors: [],
    errorCount: 0,
    sampleItems: [],
    ...overrides,
  };
}

const INCOMPLETE: IncompleteCategory[] = [
  {
    key: "tv",
    url: "https://loja.test/c/tv",
    failedUrl: "https://loja.test/c/tv?page=3",
    reason: "listing-page",
  },
  {
    key: "frio",
    url: "https://loja.test/c/frio",
    failedUrl: "https://loja.test/c/frio",
    reason: "listing-page",
  },
  { key: "som", url: "https://loja.test/c/som", failedUrl: "https://loja.test/c/som", reason: "robots-txt" },
];

function sample(overrides: Partial<SampleItem> = {}): SampleItem {
  return {
    storeSku: "123",
    title: "Televisor Samsung QE55Q67CA 55 polegadas",
    url: "https://loja.test/p/123",
    categoryKey: "tv",
    priceCents: 49_999,
    referencePriceCents: 59_999,
    rrpCents: 64_999,
    inStock: true,
    sellerName: null,
    soldByStore: true,
    ean: "5901234123457",
    ...overrides,
  };
}

describe("formatRunSummary", () => {
  it("lists the counts and the errors in pt-PT", () => {
    // Arrange
    const errors = [
      { url: "https://loja.test/c/tv?page=9", message: "HTTP 503 (3 attempts)" },
      { message: "Broken run: 2 listings seen, recent average 100" },
    ];

    // Act
    const text = formatRunSummary("Darty", report({ status: "failed", errors, errorCount: 2 }));

    // Assert
    expect(text.split("\n")).toEqual([
      "Darty: recolha falhada",
      "Páginas obtidas: 120",
      "Artigos vistos: 2400, dos quais 12 de outros vendedores (descartados)",
      "Novos: 30 · Alterados: 210 · Sem alteração: 2148",
      "Páginas de produto: 380 (revisitas semanais: 343; adiadas por limite: 0)",
      "Saltos de preço não confirmados: 1",
      "Erros: 2",
      "  - https://loja.test/c/tv?page=9: HTTP 503 (3 attempts)",
      "  - Broken run: 2 listings seen, recent average 100",
    ]);
  });

  it("says when the run was a partial simulation and how many errors were left out", () => {
    // Arrange
    const errors = Array.from({ length: 50 }, (_, index) => ({ message: `erro ${index}` }));

    // Act
    const text = formatRunSummary(
      "Darty",
      report({ dryRun: true, partial: true, errors, errorCount: 70 }),
      2,
    );

    // Assert
    expect(text.split("\n")[0]).toBe(
      "Darty: recolha concluída (simulação, nada foi gravado, execução parcial)",
    );
    expect(text.split("\n").slice(-3)).toEqual(["  - erro 0", "  - erro 1", "  - … e mais 68"]);
  });

  it("counts the product pages read for prices and says when the time limit cut the run short", () => {
    // Act
    const text = formatRunSummary(
      "Darty",
      report({
        partial: true,
        timeLimitMinutes: 300,
        pricePagesFetched: 3500,
        skippedPrices: 4,
        productPagesFetched: 0,
        revisited: 0,
      }),
    );

    // Assert
    expect(text.split("\n").slice(0, 6)).toEqual([
      "Darty: recolha concluída (execução parcial, interrompida ao fim de 300 min)",
      "Páginas obtidas: 120",
      "Artigos vistos: 2400, dos quais 12 de outros vendedores (descartados)",
      "Novos: 30 · Alterados: 210 · Sem alteração: 2148",
      "Páginas de produto lidas para o preço: 3500 (artigos sem preço, ignorados hoje: 4)",
      "Páginas de produto: 0 (revisitas semanais: 0; adiadas por limite: 0)",
    ]);
  });

  it("lists the categories not read to the end, with the page that failed or robots.txt", () => {
    // Act
    const text = formatRunSummary("Darty", report({ incompleteCategories: INCOMPLETE }));

    // Assert
    expect(text.split("\n").slice(6, 11)).toEqual([
      "Categorias incompletas: 3",
      "  - https://loja.test/c/tv (falhou https://loja.test/c/tv?page=3)",
      "  - https://loja.test/c/frio (falhou a primeira página)",
      "  - https://loja.test/c/som (proibida pelo robots.txt)",
      "Erros: 0",
    ]);
  });
});

describe("formatAdminMessage", () => {
  it("explains a blocked run without suggesting to get past the block", () => {
    // Act
    const message = formatAdminMessage("Darty", report({ status: "blocked" }));

    // Assert
    expect(message.subject).toBe("DescontoReal: recolha bloqueada (Darty)");
    expect(message.text.split("\n")[0]).toBe(
      "A loja Darty bloqueou o nosso bot. A recolha desta loja parou por hoje e o bloqueio não foi contornado.",
    );
  });

  it("explains a failed run and lists at most 5 errors", () => {
    // Arrange
    const errors = Array.from({ length: 8 }, (_, index) => ({ message: `erro ${index}` }));

    // Act
    const message = formatAdminMessage("Radio Popular", report({ status: "failed", errors, errorCount: 8 }));

    // Assert
    expect(message.subject).toBe("DescontoReal: recolha falhada (Radio Popular)");
    expect(message.text).toContain("A recolha da loja Radio Popular falhou.");
    expect(message.text).toContain("  - erro 4\n  - … e mais 3");
    expect(message.text).not.toContain("erro 5");
  });

  it("explains a run the time limit cut short: what was stored and what it means for history", () => {
    // Act
    const message = formatAdminMessage("Darty", report({ partial: true, timeLimitMinutes: 300 }));

    // Assert
    expect(message.subject).toBe("DescontoReal: recolha interrompida (Darty)");
    expect(message.text.split("\n")[0]).toBe(
      "A recolha da loja Darty parou ao fim de 300 minutos, o limite de tempo da execução. " +
        "Os preços lidos até aí foram gravados; os restantes artigos mantêm o último preço conhecido. " +
        "A execução conta como parcial: não marca artigos como desaparecidos nem entra na média de artigos. " +
        "Se acontecer todos os dias, a loja tem categorias a mais para o tempo disponível.",
    );
    expect(message.text).toContain(
      "Darty: recolha concluída (execução parcial, interrompida ao fim de 300 min)",
    );
  });

  it("calls a failed run failed even when the time limit also cut it short", () => {
    // Act
    const message = formatAdminMessage("Darty", report({ status: "failed", timeLimitMinutes: 300 }));

    // Assert
    expect(message.subject).toBe("DescontoReal: recolha falhada (Darty)");
  });

  it("explains a run that left categories unread: what was stored and that nothing was marked missing", () => {
    // Act
    const message = formatAdminMessage("Darty", report({ incompleteCategories: INCOMPLETE }));

    // Assert
    expect(message.subject).toBe("DescontoReal: recolha incompleta (Darty)");
    expect(message.text.split("\n")[0]).toBe(
      "A recolha da loja Darty terminou, mas 3 categorias não foram lidas até ao fim (lista abaixo). " +
        "Os preços lidos foram gravados. Como a recolha ficou incompleta, nenhum artigo foi marcado como desaparecido hoje.",
    );
    expect(message.text).toContain("  - https://loja.test/c/som (proibida pelo robots.txt)");
  });

  it("gives the error that ended a failed or blocked run, even past the errors listed", () => {
    // Arrange
    const errors = [
      ...Array.from({ length: 7 }, (_, index) => ({ message: `erro ${index}` })),
      {
        url: "https://loja.test/c/c5",
        message: "darty keeps failing: HTTP 503 (3 attempts), 5 URLs in a row",
      },
    ];

    // Act
    const failed = formatAdminMessage("Darty", report({ status: "failed", errors, errorCount: 8 }));
    const blocked = formatAdminMessage("Darty", report({ status: "blocked", errors, errorCount: 8 }));
    const success = formatAdminMessage("Darty", report({ timeLimitMinutes: 300, errors, errorCount: 8 }));

    // Assert
    const cause =
      "Motivo: https://loja.test/c/c5: darty keeps failing: HTTP 503 (3 attempts), 5 URLs in a row";
    expect(failed.text.split("\n").slice(0, 3)).toEqual(["A recolha da loja Darty falhou.", cause, ""]);
    expect(blocked.text.split("\n")[1]).toBe(cause);
    expect(success.text).not.toContain("Motivo:");
  });
});

describe("formatSampleTable", () => {
  it("aligns SKU, title, prices, PVPr, stock, seller and EAN, then lists the URLs", () => {
    // Arrange
    const items = [
      sample(),
      sample({
        storeSku: "4567",
        title: "Máquina de lavar roupa com um título muito comprido para caber na tabela inteira",
        referencePriceCents: null,
        rrpCents: null,
        inStock: false,
        sellerName: "Vendedor X",
        soldByStore: false,
        ean: null,
        url: "https://loja.test/p/4567",
      }),
    ];

    // Act
    const lines = formatSampleTable("Darty", items).split("\n");

    // Assert
    expect(lines[0]).toMatch(/^# +SKU +Título +Preço +Preço riscado +PVPr +Stock +Vendedor +EAN$/);
    expect(lines[2]).toContain(formatCents(49_999));
    expect(lines[2]).toContain(formatCents(59_999));
    expect(lines[2]).toContain(formatCents(64_999));
    expect(lines[2]).toMatch(/sim +Darty +5901234123457$/);
    expect(lines[3]).toMatch(/— +— +não/);
    expect(lines[3]).toContain("Máquina de lavar roupa com um título muito compri…");
    expect(lines[3]).toMatch(/não +Vendedor X +—$/);
    expect(lines.slice(-2)).toEqual(["1. https://loja.test/p/123", "2. https://loja.test/p/4567"]);
    const skuColumn = lines[0]?.indexOf("SKU");
    const priceColumn = lines[0]?.indexOf("Preço ");
    expect([lines[2]?.indexOf("123"), lines[3]?.indexOf("4567")]).toEqual([skuColumn, skuColumn]);
    expect([lines[2]?.indexOf(formatCents(49_999)), lines[3]?.indexOf(formatCents(49_999))]).toEqual([
      priceColumn,
      priceColumn,
    ]);
  });

  it("marks a seller the run could not determine", () => {
    // Act
    const table = formatSampleTable("Darty", [sample({ soldByStore: null })]);

    // Assert
    expect(table.split("\n")[2]).toMatch(/sim +\? +5901234123457$/);
  });

  it("says when there are no items", () => {
    // Act
    const table = formatSampleTable("Darty", []);

    // Assert
    expect(table).toBe("Nenhum artigo extraído.");
  });
});
