import { describe, expect, it } from "vitest";
import type { PriceInterval } from "../../src/history";
import { daysBefore } from "../../src/intervals";
import { classify } from "../../src/labels/classify";
import { LABELS_CONFIG } from "../../src/labels/config";
import { LABEL_NAMES, LABEL_TONES, WARNING_NAMES } from "../../src/labels/names";
import type {
  Classification,
  ClassifyInput,
  LabelCode,
  OtherStoreOffer,
  WarningCode,
} from "../../src/labels/types";

const NOW = new Date("2026-11-27T06:00:00.000Z");
const NBSP = String.fromCharCode(0xa0);
const MINUS = String.fromCharCode(0x2212);

interface Step {
  price: number;
  /** How long the price held, in days. The last step is the current price and runs until NOW. */
  days: number;
  reference?: number;
  inStock?: boolean;
}

/** Contiguous intervals from the oldest step to the current one. */
function buildIntervals(steps: readonly Step[]): PriceInterval[] {
  return steps.map((step, index) => {
    const endDaysAgo = steps.slice(index + 1).reduce((sum, later) => sum + later.days, 0);
    return {
      priceCents: step.price,
      referencePriceCents: step.reference ?? null,
      inStock: step.inStock ?? true,
      validFrom: daysBefore(NOW, endDaysAgo + step.days),
      validTo: index === steps.length - 1 ? null : daysBefore(NOW, endDaysAgo),
    };
  });
}

function classifySteps(
  steps: readonly Step[],
  options: { now?: Date; cheapestOtherStore?: OtherStoreOffer } = {},
): Classification {
  return classify({
    intervals: buildIntervals(steps),
    now: options.now ?? NOW,
    cheapestOtherStore: options.cheapestOtherStore,
  });
}

/** "449,99" → "449,99 €", with the no-break space Intl puts before the euro sign. */
function eur(amount: string): string {
  return `${amount}${NBSP}€`;
}

function isoDaysAgo(days: number): string {
  return daysBefore(NOW, days).toISOString();
}

// Each history below is one story, oldest price first; the last step is the current price.
const NEW_LISTING: Step[] = [{ price: 50_000, days: 10 }];
const NEW_LISTING_WITH_DISCOUNT: Step[] = [
  { price: 50_000, days: 20 },
  { price: 45_000, days: 5, reference: 50_000 },
];
const ALL_TIME_LOW: Step[] = [
  { price: 50_000, days: 100 },
  { price: 48_000, days: 30 },
  { price: 47_000, days: 5 },
];
const ALL_TIME_LOW_WITH_DISCOUNT: Step[] = [
  { price: 50_000, days: 100 },
  { price: 48_000, days: 30 },
  { price: 47_000, days: 5, reference: 50_000 },
];
const REAL_DISCOUNT: Step[] = [
  { price: 40_000, days: 30 },
  { price: 50_000, days: 115 },
  { price: 45_000, days: 5, reference: 50_000 },
];
// Raised about 40 days before the "discount", so the 30-day minimum is already the inflated price.
const BLACK_FRIDAY_TRICK: Step[] = [
  { price: 50_000, days: 100 },
  { price: 70_000, days: 40 },
  { price: 51_000, days: 5, reference: 70_000 },
];
const SMALL_DISCOUNT: Step[] = [
  { price: 45_000, days: 20 },
  { price: 50_000, days: 100 },
  { price: 48_000, days: 5, reference: 50_500 },
];
const NO_REAL_DISCOUNT: Step[] = [
  { price: 45_000, days: 20 },
  { price: 50_000, days: 95 },
  { price: 51_000, days: 5 },
  { price: 50_000, days: 5, reference: 60_000 },
];
const GOOD_PRICE: Step[] = [
  { price: 40_000, days: 20 },
  { price: 50_000, days: 100 },
  { price: 47_000, days: 5 },
];
const ABOVE_USUAL: Step[] = [
  { price: 40_000, days: 20 },
  { price: 50_000, days: 100 },
  { price: 55_000, days: 5 },
];
const USUAL_PRICE: Step[] = [
  { price: 40_000, days: 20 },
  { price: 50_000, days: 100 },
  { price: 49_000, days: 5 },
];
// First seen at the peak: we never saw the price go up.
const FIRST_SEEN_HIGH: Step[] = [
  { price: 70_000, days: 10 },
  { price: 51_000, days: 50 },
  { price: 50_000, days: 5, reference: 70_000 },
];
const NEVER_CHANGED_WITH_DISCOUNT: Step[] = [{ price: 50_000, days: 45, reference: 60_000 }];

/** Two prices with a gap between them, so M30 is empty while Med90 is not. */
const GAP_INPUT: ClassifyInput = {
  intervals: [
    {
      priceCents: 50_000,
      referencePriceCents: null,
      inStock: true,
      validFrom: daysBefore(NOW, 80),
      validTo: daysBefore(NOW, 50),
    },
    {
      priceCents: 49_000,
      referencePriceCents: 60_000,
      inStock: true,
      validFrom: daysBefore(NOW, 5),
      validTo: null,
    },
  ],
  now: NOW,
};

describe("classify", () => {
  describe("when the store announces a discount", () => {
    it("gives Histórico insuficiente with less than 30 days of history", () => {
      // Arrange
      const steps = NEW_LISTING_WITH_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "historico_insuficiente",
        labelName: "Histórico insuficiente",
        text: "Seguimos este preço desde 2 de novembro de 2026. Ainda não há dados para avaliar o desconto.",
        tone: "neutral",
        announcedDiscount: true,
        warnings: [],
        numbers: { historyDays: 25, trackedSince: isoDaysAgo(25) },
      });
    });

    it("gives Mínimo histórico when P is below every earlier price with at least 90 days of history", () => {
      // Arrange
      const steps = ALL_TIME_LOW_WITH_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "minimo_historico",
        labelName: "Mínimo histórico",
        text: "O preço mais baixo desde que seguimos este produto (135 dias).",
        tone: "positive",
        announcedDiscount: true,
        warnings: [],
      });
    });

    it("gives Desconto real when P is at least 5% below both M30 and Med90", () => {
      // Arrange
      const steps = REAL_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "desconto_real",
        labelName: "Desconto real",
        text: "10% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual dos últimos 90 dias.",
        tone: "positive",
        announcedDiscount: true,
        warnings: [],
      });
    });

    it("gives Subiu antes de descer, never Desconto real, for the Black Friday trick", () => {
      // Arrange
      const steps = BLACK_FRIDAY_TRICK;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "subiu_antes_de_descer",
        labelName: "Subiu antes de descer",
        text: `O preço subiu para ${eur("700,00")} a 13 de outubro de 2026 e desceu agora para ${eur("510,00")}, perto do preço habitual.`,
        tone: "caution",
        announcedDiscount: true,
        warnings: [],
      });
    });

    it("gives Sem desconto real, never Subiu antes de descer, when P is above the price just before it", () => {
      // Arrange
      const steps: Step[] = [
        { price: 50_000, days: 60 },
        { price: 70_000, days: 20 },
        { price: 48_000, days: 10 },
        { price: 51_000, days: 5, reference: 70_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.numbers).toMatchObject({ m30Cents: 48_000, med90Cents: 50_000, max90Cents: 70_000 });
      expect(result).toMatchObject({
        label: "sem_desconto_real",
        text: `Sem descida relevante face ao preço mais baixo dos 30 dias anteriores (${eur("480,00")}) e ao preço habitual (${eur("500,00")}).`,
        warnings: [
          {
            code: "desconto_anunciado_exagerado",
            text: `Anunciado ${MINUS}27% · Face aos 30 dias anteriores: +6%`,
          },
        ],
      });
    });

    it("gives Desconto pequeno when P is below M30 and Med90 but not by 5%", () => {
      // Arrange
      const steps = SMALL_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "desconto_pequeno",
        labelName: "Desconto pequeno",
        text: "Só 4% abaixo do preço mais baixo dos 30 dias anteriores.",
        tone: "caution",
        announcedDiscount: true,
        warnings: [],
      });
    });

    it("gives Sem desconto real when no other rule applies", () => {
      // Arrange
      const steps = NO_REAL_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "sem_desconto_real",
        labelName: "Sem desconto real",
        text: `Sem descida relevante face ao preço mais baixo dos 30 dias anteriores (${eur("500,00")}) e ao preço habitual (${eur("500,00")}).`,
        tone: "caution",
        announcedDiscount: true,
      });
    });
  });

  describe("when there is no announced discount", () => {
    it("gives Histórico insuficiente with less than 30 days of history", () => {
      // Arrange
      const steps = NEW_LISTING;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "historico_insuficiente",
        text: "Seguimos este preço desde 17 de novembro de 2026.",
        tone: "neutral",
        announcedDiscount: false,
        warnings: [],
      });
    });

    it("gives Mínimo histórico when P is below every earlier price with at least 90 days of history", () => {
      // Arrange
      const steps = ALL_TIME_LOW;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "minimo_historico",
        text: "O preço mais baixo desde que seguimos este produto (135 dias).",
        tone: "positive",
        announcedDiscount: false,
      });
    });

    it("gives Bom preço when P is at least 5% below Med90", () => {
      // Arrange
      const steps = GOOD_PRICE;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "bom_preco",
        labelName: "Bom preço",
        text: "6% abaixo do preço habitual dos últimos 90 dias.",
        tone: "positive",
        announcedDiscount: false,
        warnings: [],
      });
    });

    it("gives Acima do habitual when P is at least 5% above Med90", () => {
      // Arrange
      const steps = ABOVE_USUAL;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "acima_do_habitual",
        labelName: "Acima do habitual",
        text: "10% acima do preço habitual dos últimos 90 dias.",
        tone: "caution",
        announcedDiscount: false,
        warnings: [],
      });
    });

    it("gives Preço habitual when P is near Med90", () => {
      // Arrange
      const steps = USUAL_PRICE;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "preco_habitual",
        labelName: "Preço habitual",
        text: "Perto do preço habitual dos últimos 90 dias.",
        tone: "neutral",
        announcedDiscount: false,
        warnings: [],
      });
    });
  });

  describe("warnings", () => {
    it("adds Desconto anunciado exagerado when the announced % beats the real % by more than 5 points", () => {
      // Arrange
      const steps = NO_REAL_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.warnings).toEqual([
        {
          code: "desconto_anunciado_exagerado",
          text: `Anunciado ${MINUS}17% · Face aos 30 dias anteriores: 0%`,
        },
      ]);
    });

    it("shows a plus sign when P is above M30", () => {
      // Arrange
      const steps: Step[] = [
        { price: 50_000, days: 60 },
        { price: 40_000, days: 25 },
        { price: 45_000, days: 5, reference: 50_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.label).toBe("sem_desconto_real");
      expect(result.warnings).toEqual([
        {
          code: "desconto_anunciado_exagerado",
          text: `Anunciado ${MINUS}10% · Face aos 30 dias anteriores: +13%`,
        },
      ]);
    });

    it("does not add it when the difference is exactly 5 points", () => {
      // Arrange
      const steps: Step[] = [
        { price: 5_000, days: 20 },
        { price: 7_500, days: 100 },
        { price: 6_000, days: 5, reference: 8_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.numbers.announcedDiscountPct).toBeCloseTo(25, 10);
      expect(result.numbers.realDiscountPct).toBeCloseTo(20, 10);
      expect(result.warnings).toEqual([]);
    });

    it("adds it just above 5 points", () => {
      // Arrange
      const steps: Step[] = [
        { price: 5_000, days: 20 },
        { price: 7_500, days: 100 },
        { price: 6_000, days: 5, reference: 8_001 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.warnings).toEqual([
        {
          code: "desconto_anunciado_exagerado",
          text: `Anunciado ${MINUS}25% · Face aos 30 dias anteriores: ${MINUS}20%`,
        },
      ]);
    });

    it("needs M30 to compare the announced discount", () => {
      // Arrange
      const steps = NEVER_CHANGED_WITH_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.warnings).toEqual([]);
    });

    it.each([
      ["exactly 3% cheaper", 48_500, `Radio Popular tem este produto a ${eur("485,00")}.`],
      ["more than 3% cheaper", 40_000, `Radio Popular tem este produto a ${eur("400,00")}.`],
      ["just under 3% cheaper", 48_501, null],
      ["more expensive", 52_000, null],
    ])("handles Mais barato noutra loja when another store is %s", (_case, otherPrice, text) => {
      // Arrange
      const steps: Step[] = [
        { price: 40_000, days: 20 },
        { price: 52_000, days: 100 },
        { price: 50_000, days: 5 },
      ];
      const cheapestOtherStore = { storeName: "Radio Popular", priceCents: otherPrice };

      // Act
      const result = classifySteps(steps, { cheapestOtherStore });

      // Assert
      expect(result.label).toBe("preco_habitual");
      expect(result.warnings).toEqual(text === null ? [] : [{ code: "mais_barato_noutra_loja", text }]);
    });

    it("adds Esgotado when the store is out of stock", () => {
      // Arrange
      const steps: Step[] = [...USUAL_PRICE.slice(0, -1), { price: 49_000, days: 5, inStock: false }];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "preco_habitual",
        warnings: [{ code: "esgotado", text: "Indisponível nesta loja." }],
      });
    });

    it("lists every warning that applies, in a fixed order", () => {
      // Arrange
      const steps: Step[] = [
        ...NO_REAL_DISCOUNT.slice(0, -1),
        { price: 50_000, days: 5, reference: 60_000, inStock: false },
      ];
      const cheapestOtherStore = { storeName: "Darty", priceCents: 44_999 };

      // Act
      const result = classifySteps(steps, { cheapestOtherStore });

      // Assert
      expect(result.warnings).toEqual([
        {
          code: "desconto_anunciado_exagerado",
          text: `Anunciado ${MINUS}17% · Face aos 30 dias anteriores: 0%`,
        },
        { code: "mais_barato_noutra_loja", text: `Darty tem este produto a ${eur("449,99")}.` },
        { code: "esgotado", text: "Indisponível nesta loja." },
      ]);
    });

    it("adds warnings to any label, including Histórico insuficiente", () => {
      // Arrange
      const steps: Step[] = [
        { price: 50_000, days: 20 },
        { price: 45_000, days: 5, reference: 60_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.label).toBe("historico_insuficiente");
      expect(result.warnings).toEqual([
        {
          code: "desconto_anunciado_exagerado",
          text: `Anunciado ${MINUS}25% · Face aos 30 dias anteriores: ${MINUS}10%`,
        },
      ]);
    });
  });

  describe("thresholds at the boundary", () => {
    it("needs 30 calendar days of history, reached at Lisbon midnight", () => {
      // Arrange
      const steps: Step[] = [
        { price: 50_000, days: 25 },
        { price: 49_000, days: 5 },
      ];
      const lisbonMidnight = new Date("2026-11-27T00:00:00.000Z");
      const oneMillisecondEarlier = new Date(lisbonMidnight.getTime() - 1);

      // Act
      const atThirtyDays = classifySteps(steps, { now: lisbonMidnight });
      const justShort = classifySteps(steps, { now: oneMillisecondEarlier });

      // Assert
      expect(atThirtyDays).toMatchObject({
        label: "preco_habitual",
        text: "Perto do preço habitual desde 28 de outubro de 2026.",
        numbers: { historyDays: 30 },
      });
      expect(justShort).toMatchObject({
        label: "historico_insuficiente",
        text: "Seguimos este preço desde 28 de outubro de 2026.",
        numbers: { historyDays: 29 },
      });
    });

    it("needs 90 calendar days of history for Mínimo histórico, reached at Lisbon midnight", () => {
      // Arrange
      const steps: Step[] = [
        { price: 50_000, days: 85 },
        { price: 45_000, days: 5 },
      ];
      const lisbonMidnight = new Date("2026-11-27T00:00:00.000Z");
      const oneMillisecondEarlier = new Date(lisbonMidnight.getTime() - 1);

      // Act
      const atNinetyDays = classifySteps(steps, { now: lisbonMidnight });
      const justShort = classifySteps(steps, { now: oneMillisecondEarlier });

      // Assert
      expect(atNinetyDays).toMatchObject({
        label: "minimo_historico",
        text: "O preço mais baixo desde que seguimos este produto (90 dias).",
        numbers: { historyDays: 90 },
      });
      expect(justShort).toMatchObject({
        label: "bom_preco",
        text: "10% abaixo do preço habitual desde 29 de agosto de 2026.",
        numbers: { historyDays: 89 },
      });
    });

    it.each([
      [47_500, "desconto_real"],
      [47_501, "desconto_pequeno"],
    ])("treats P = %i against M30 = Med90 = 500,00 € as %s", (price, expected) => {
      // Arrange
      const steps: Step[] = [...REAL_DISCOUNT.slice(0, -1), { price, days: 5, reference: 50_000 }];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.label).toBe(expected);
    });

    it.each([
      ["P = Med90 × 0.97 and Máx90 = Med90 × 1.10", "subiu_antes_de_descer", 48_500, 55_000],
      ["P = Med90 × 1.05", "subiu_antes_de_descer", 52_500, 55_000],
      ["Máx90 just under Med90 × 1.10", "desconto_pequeno", 48_500, 54_999],
      ["P just under Med90 × 0.97", "desconto_pequeno", 48_499, 55_000],
      ["P just above Med90 × 1.05", "sem_desconto_real", 52_501, 55_000],
    ])("with %s gives %s", (_case, expected, price, peak) => {
      // Arrange
      const steps: Step[] = [
        { price: 40_000, days: 10 },
        { price: 50_000, days: 60 },
        { price: peak, days: 20 },
        { price: 50_000, days: 20 },
        { price: 53_000, days: 5 },
        { price, days: 5, reference: peak },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.numbers).toMatchObject({ m30Cents: 50_000, med90Cents: 50_000, max90Cents: peak });
      expect(result.label).toBe(expected);
    });

    // The peak is the price just before P: a P equal to it would be the same price, started at the peak.
    it.each([
      ["just under Máx90", "subiu_antes_de_descer", 54_999],
      ["above Máx90", "sem_desconto_real", 56_000],
    ])("with P %s gives %s, even when Med90 × aboveUsualFactor is above Máx90", (_case, expected, price) => {
      // Arrange
      const steps: Step[] = [
        { price: 40_000, days: 10 },
        { price: 50_000, days: 85 },
        { price: 55_000, days: 20 },
        { price, days: 5, reference: 70_000 },
      ];
      const config = { ...LABELS_CONFIG, aboveUsualFactor: 1.2 };

      // Act
      const result = classify({ intervals: buildIntervals(steps), now: NOW }, config);

      // Assert
      expect(result.numbers).toMatchObject({ med90Cents: 50_000, max90Cents: 55_000 });
      expect(result.label).toBe(expected);
    });

    // A P equal to the price just before it would be the same price, started back then.
    it.each([
      ["just under", "subiu_antes_de_descer", 49_999],
      ["just above", "sem_desconto_real", 50_001],
    ])("with P %s the price just before it gives %s", (_case, expected, price) => {
      // Arrange
      const steps: Step[] = [
        { price: 40_000, days: 10 },
        { price: 50_000, days: 60 },
        { price: 70_000, days: 20 },
        { price: 50_000, days: 10 },
        { price, days: 5, reference: 70_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.numbers).toMatchObject({ m30Cents: 50_000, med90Cents: 50_000, max90Cents: 70_000 });
      expect(result.label).toBe(expected);
    });

    it("words the boundary case of Subiu antes de descer with both prices", () => {
      // Arrange
      const steps: Step[] = [
        { price: 40_000, days: 10 },
        { price: 50_000, days: 60 },
        { price: 55_000, days: 20 },
        { price: 50_000, days: 25 },
        { price: 48_500, days: 5, reference: 55_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result.text).toBe(
        `O preço subiu para ${eur("550,00")} a 8 de outubro de 2026 e desceu agora para ${eur("485,00")}, perto do preço habitual.`,
      );
    });

    it.each([
      [47_500, "bom_preco", "5% abaixo do preço habitual dos últimos 90 dias."],
      [47_501, "preco_habitual", "Perto do preço habitual dos últimos 90 dias."],
      [52_499, "preco_habitual", "Perto do preço habitual dos últimos 90 dias."],
      [52_500, "acima_do_habitual", "5% acima do preço habitual dos últimos 90 dias."],
    ])("treats P = %i against Med90 = 500,00 € as %s", (price, label, text) => {
      // Arrange
      const steps: Step[] = [...GOOD_PRICE.slice(0, -1), { price, days: 5 }];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({ label, text });
    });
  });

  describe("history in calendar days", () => {
    // First price on 28 October at 11:00 UTC, Black Friday price from 26 November at 11:00 UTC.
    const firstPrice = new Date("2026-10-28T11:00:00.000Z");
    const blackFridayPrice = new Date("2026-11-26T11:00:00.000Z");
    const intervals: PriceInterval[] = [
      {
        priceCents: 50_000,
        referencePriceCents: null,
        inStock: true,
        validFrom: firstPrice,
        validTo: blackFridayPrice,
      },
      {
        priceCents: 45_000,
        referencePriceCents: 50_000,
        inStock: true,
        validFrom: blackFridayPrice,
        validTo: null,
      },
    ];

    it.each([
      ["Lisbon midnight", "2026-11-27T00:00:00.000Z"],
      ["10:59 UTC, before the hour of the first price", "2026-11-27T10:59:00.000Z"],
      ["the last instant of the day", "2026-11-27T23:59:59.999Z"],
    ])("counts 30 days on 27 November at %s", (_case, iso) => {
      // Arrange
      const now = new Date(iso);

      // Act
      const result = classify({ intervals, now });

      // Assert
      expect(result).toMatchObject({
        label: "desconto_real",
        text: "10% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual desde 28 de outubro de 2026.",
        numbers: { historyDays: 30, trackedSince: firstPrice.toISOString() },
      });
    });

    it("counts 29 days at the last instant of 26 November", () => {
      // Arrange
      const now = new Date("2026-11-26T23:59:59.999Z");

      // Act
      const result = classify({ intervals, now });

      // Assert
      expect(result).toMatchObject({
        label: "historico_insuficiente",
        text: "Seguimos este preço desde 28 de outubro de 2026. Ainda não há dados para avaliar o desconto.",
        numbers: { historyDays: 29 },
      });
    });

    it("keeps the price windows in elapsed time, ending at the start of the current price", () => {
      // Arrange
      const now = new Date("2026-11-27T23:59:59.999Z");

      // Act
      const { numbers } = classify({ intervals, now });

      // Assert
      expect(numbers).toMatchObject({
        currentSince: blackFridayPrice.toISOString(),
        m30Cents: 50_000,
        med90Cents: 50_000,
        windowDays: 29,
        historyDays: 30,
      });
    });
  });

  describe("start of the current price", () => {
    it.each([
      [
        "a stock-only split of the current price",
        [
          { price: 40_000, days: 30 },
          { price: 50_000, days: 115 },
          { price: 45_000, days: 3, reference: 50_000, inStock: false },
          { price: 45_000, days: 2, reference: 50_000 },
        ],
        REAL_DISCOUNT,
        "desconto_real",
      ],
      [
        "a reference-only split of the current price",
        [
          { price: 40_000, days: 30 },
          { price: 50_000, days: 115 },
          { price: 45_000, days: 3 },
          { price: 45_000, days: 2, reference: 50_000 },
        ],
        REAL_DISCOUNT,
        "desconto_real",
      ],
      [
        "a split of an earlier price inside the 30-day window",
        [
          { price: 40_000, days: 30 },
          { price: 50_000, days: 105 },
          { price: 50_000, days: 10, inStock: false },
          { price: 45_000, days: 5, reference: 50_000 },
        ],
        REAL_DISCOUNT,
        "desconto_real",
      ],
      [
        "a split of the Máx90 peak",
        [
          { price: 50_000, days: 100 },
          { price: 70_000, days: 30 },
          { price: 70_000, days: 10, inStock: false },
          { price: 51_000, days: 5, reference: 70_000 },
        ],
        BLACK_FRIDAY_TRICK,
        "subiu_antes_de_descer",
      ],
      [
        "several splits of a current price older than 30 days",
        [
          { price: 40_000, days: 30 },
          { price: 50_000, days: 115 },
          { price: 45_000, days: 35, reference: 50_000 },
          { price: 45_000, days: 3, reference: 50_000, inStock: false },
          { price: 45_000, days: 2, reference: 50_000 },
        ],
        [
          { price: 40_000, days: 30 },
          { price: 50_000, days: 115 },
          { price: 45_000, days: 40, reference: 50_000 },
        ],
        "desconto_real",
      ],
      [
        "a split of a price that never changed",
        [
          { price: 50_000, days: 30, reference: 60_000, inStock: false },
          { price: 50_000, days: 15, reference: 60_000 },
        ],
        NEVER_CHANGED_WITH_DISCOUNT,
        "sem_desconto_real",
      ],
      [
        "a stock-only split of an all-time low",
        [
          { price: 50_000, days: 100 },
          { price: 48_000, days: 30 },
          { price: 47_000, days: 3, inStock: false },
          { price: 47_000, days: 2 },
        ],
        ALL_TIME_LOW,
        "minimo_historico",
      ],
    ])("classifies %s like the unsplit history", (_case, split, unsplit, label) => {
      // Arrange
      const expected = classifySteps(unsplit);

      // Act
      const result = classifySteps(split);

      // Assert
      expect(result).toEqual(expected);
      expect(result.label).toBe(label);
    });

    it("keeps a real discount when the store sells out the day after it starts", () => {
      // Arrange
      const steps: Step[] = [
        { price: 50_000, days: 60 },
        { price: 40_000, days: 1, reference: 50_000 },
        { price: 40_000, days: 1, reference: 50_000, inStock: false },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "desconto_real",
        text: "20% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual desde 26 de setembro de 2026.",
        warnings: [{ code: "esgotado", text: "Indisponível nesta loja." }],
        numbers: { currentSince: isoDaysAgo(2), m30Cents: 50_000, med90Cents: 50_000, windowDays: 60 },
      });
    });
  });

  describe("edge cases", () => {
    it.each([
      ["equal to P", 49_000],
      ["below P", 45_000],
    ])("ignores a reference price %s", (_case, reference) => {
      // Arrange
      const steps: Step[] = [...USUAL_PRICE.slice(0, -1), { price: 49_000, days: 5, reference }];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({ label: "preco_habitual", announcedDiscount: false, warnings: [] });
      expect(result.numbers).toMatchObject({ referencePriceCents: null, announcedDiscountPct: null });
    });

    it("does not depend on the order of the intervals", () => {
      // Arrange
      const intervals = buildIntervals(BLACK_FRIDAY_TRICK);
      const expected = classify({ intervals, now: NOW });

      // Act
      const reversed = classify({ intervals: [...intervals].reverse(), now: NOW });
      const rotated = classify({ intervals: [...intervals.slice(1), ...intervals.slice(0, 1)], now: NOW });

      // Assert
      expect(reversed).toEqual(expected);
      expect(rotated).toEqual(expected);
    });

    it.each([
      [
        "Desconto real",
        [
          { price: 50_000, days: 40 },
          { price: 45_000, days: 5, reference: 50_000 },
        ],
        "10% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual desde 13 de outubro de 2026.",
      ],
      [
        "Bom preço",
        [
          { price: 50_000, days: 40 },
          { price: 47_000, days: 5 },
        ],
        "6% abaixo do preço habitual desde 13 de outubro de 2026.",
      ],
      [
        "Acima do habitual",
        [
          { price: 50_000, days: 40 },
          { price: 55_000, days: 5 },
        ],
        "10% acima do preço habitual desde 13 de outubro de 2026.",
      ],
      [
        "Preço habitual",
        [
          { price: 50_000, days: 40 },
          { price: 49_000, days: 5 },
        ],
        "Perto do preço habitual desde 13 de outubro de 2026.",
      ],
    ])(
      "says 'desde {data}' in %s when the history before P is shorter than 90 days",
      (_case, steps, text) => {
        // Arrange
        const history: Step[] = steps;

        // Act
        const result = classifySteps(history);

        // Assert
        expect(result.text).toBe(text);
        expect(result.numbers.windowDays).toBe(40);
      },
    );

    it("switches to 'desde {data}' one millisecond short of 90 days", () => {
      // Arrange
      const intervals = buildIntervals([
        { price: 50_000, days: 90 },
        { price: 55_000, days: 5 },
      ]);
      const shortened = intervals.map((interval, index) =>
        index === 0 ? { ...interval, validFrom: new Date(interval.validFrom.getTime() + 1) } : interval,
      );

      // Act
      const full = classify({ intervals, now: NOW });
      const short = classify({ intervals: shortened, now: NOW });

      // Assert
      expect(full).toMatchObject({
        text: "10% acima do preço habitual dos últimos 90 dias.",
        numbers: { windowDays: 90 },
      });
      expect(short).toMatchObject({
        text: "10% acima do preço habitual desde 24 de agosto de 2026.",
        numbers: { windowDays: 89 },
      });
    });

    it("says the price has not changed when there is no earlier price to compare", () => {
      // Arrange
      const steps = NEVER_CHANGED_WITH_DISCOUNT;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "sem_desconto_real",
        text: "O preço é o mesmo desde 13 de outubro de 2026.",
        announcedDiscount: true,
      });
      expect(result.numbers).toMatchObject({
        m30Cents: null,
        med90Cents: null,
        max90Cents: null,
        max90Since: null,
        windowDays: 0,
        realDiscountPct: null,
        belowMed90Pct: null,
      });
    });

    it("never calls a price that never changed a Mínimo histórico", () => {
      // Arrange
      const steps: Step[] = [{ price: 50_000, days: 120 }];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "preco_habitual",
        text: "O preço é o mesmo desde 30 de julho de 2026.",
      });
    });

    it("leaves out M30 when no price held in the 30 days before P", () => {
      // Arrange
      const input = GAP_INPUT;

      // Act
      const result = classify(input);

      // Assert
      expect(result).toMatchObject({
        label: "sem_desconto_real",
        text: `Sem descida relevante face ao preço habitual (${eur("500,00")}).`,
        numbers: { m30Cents: null, med90Cents: 50_000 },
      });
    });

    it("says 'esteve em' when the peak is the first price we saw", () => {
      // Arrange
      const steps = FIRST_SEEN_HIGH;

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "subiu_antes_de_descer",
        text: `O preço esteve em ${eur("700,00")} a 23 de setembro de 2026 e desceu agora para ${eur("500,00")}, perto do preço habitual.`,
      });
    });

    it("says 'esteve em' when the price came down to the peak", () => {
      // Arrange
      const steps: Step[] = [
        { price: 90_000, days: 20 },
        { price: 70_000, days: 20 },
        { price: 50_000, days: 75 },
        { price: 52_000, days: 5 },
        { price: 50_000, days: 5, reference: 70_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "subiu_antes_de_descer",
        text: `O preço esteve em ${eur("700,00")} a 14 de agosto de 2026 e desceu agora para ${eur("500,00")}, perto do preço habitual.`,
        numbers: { max90Cents: 70_000, max90Since: isoDaysAgo(105) },
      });
    });

    it("never says the price came down when P is above Máx90", () => {
      // Arrange
      const steps: Step[] = [
        { price: 10_000, days: 80 },
        { price: 11_500, days: 10 },
        { price: 12_000, days: 1, reference: 15_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "sem_desconto_real",
        text: `Sem descida relevante face ao preço mais baixo dos 30 dias anteriores (${eur("100,00")}) e ao preço habitual (${eur("100,00")}).`,
        numbers: { med90Cents: 10_000, max90Cents: 11_500 },
      });
    });

    it("dates Máx90 from the latest interval when the peak repeats", () => {
      // Arrange
      const steps: Step[] = [
        { price: 40_000, days: 10 },
        { price: 50_000, days: 30 },
        { price: 60_000, days: 10 },
        { price: 50_000, days: 30 },
        { price: 60_000, days: 10 },
        { price: 50_000, days: 5, reference: 60_000 },
      ];

      // Act
      const result = classifySteps(steps);

      // Assert
      expect(result).toMatchObject({
        label: "subiu_antes_de_descer",
        text: `O preço subiu para ${eur("600,00")} a 12 de novembro de 2026 e desceu agora para ${eur("500,00")}, perto do preço habitual.`,
        numbers: { max90Since: isoDaysAgo(15) },
      });
    });

    it("uses the thresholds it is given", () => {
      // Arrange
      const config = { ...LABELS_CONFIG, minHistoryDays: 20 };

      // Act
      const result = classify({ intervals: buildIntervals(NEW_LISTING_WITH_DISCOUNT), now: NOW }, config);

      // Assert
      expect(result).toMatchObject({
        label: "desconto_real",
        text: "10% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual desde 2 de novembro de 2026.",
      });
    });

    it("throws without a current interval", () => {
      // Arrange
      const closed = buildIntervals(USUAL_PRICE).map((interval) => ({
        ...interval,
        validTo: interval.validTo ?? NOW,
      }));

      // Act
      const run = (): Classification => classify({ intervals: closed, now: NOW });

      // Assert
      expect(run).toThrow("Expected exactly one current price interval");
    });
  });

  describe("numbers", () => {
    it("fills every field for an announced discount", () => {
      // Arrange
      const steps = REAL_DISCOUNT;

      // Act
      const { announcedDiscountPct, realDiscountPct, belowMed90Pct, ...rest } = classifySteps(steps).numbers;

      // Assert
      expect(rest).toEqual({
        priceCents: 45_000,
        referencePriceCents: 50_000,
        currentSince: isoDaysAgo(5),
        m30Cents: 50_000,
        med90Cents: 50_000,
        max90Cents: 50_000,
        max90Since: isoDaysAgo(120),
        windowDays: 90,
        trackedSince: isoDaysAgo(150),
        historyDays: 150,
      });
      expect(announcedDiscountPct).toBeCloseTo(10, 10);
      expect(realDiscountPct).toBeCloseTo(10, 10);
      expect(belowMed90Pct).toBeCloseTo(10, 10);
    });

    it("fills every field for the Black Friday trick", () => {
      // Arrange
      const steps = BLACK_FRIDAY_TRICK;

      // Act
      const { announcedDiscountPct, realDiscountPct, belowMed90Pct, ...rest } = classifySteps(steps).numbers;

      // Assert
      expect(rest).toEqual({
        priceCents: 51_000,
        referencePriceCents: 70_000,
        currentSince: isoDaysAgo(5),
        m30Cents: 70_000,
        med90Cents: 50_000,
        max90Cents: 70_000,
        max90Since: isoDaysAgo(45),
        windowDays: 90,
        trackedSince: isoDaysAgo(145),
        historyDays: 145,
      });
      expect(announcedDiscountPct).toBeCloseTo(27.142857, 5);
      expect(realDiscountPct).toBeCloseTo(27.142857, 5);
      expect(belowMed90Pct).toBeCloseTo(-2, 10);
    });
  });

  describe("texts", () => {
    const ALL_LABELS: LabelCode[] = [
      "historico_insuficiente",
      "minimo_historico",
      "desconto_real",
      "subiu_antes_de_descer",
      "desconto_pequeno",
      "sem_desconto_real",
      "bom_preco",
      "acima_do_habitual",
      "preco_habitual",
    ];
    const ALL_WARNINGS: WarningCode[] = [
      "desconto_anunciado_exagerado",
      "mais_barato_noutra_loja",
      "esgotado",
    ];

    /** Every combination of a few past histories, current prices, durations and reference prices. */
    function enumerateInputs(): ClassifyInput[] {
      const pasts: Step[][] = [
        [],
        [{ price: 50_000, days: 10 }],
        [{ price: 50_000, days: 40 }],
        [{ price: 50_000, days: 120 }],
        [
          { price: 40_000, days: 30 },
          { price: 50_000, days: 100 },
        ],
        [
          { price: 50_000, days: 100 },
          { price: 70_000, days: 40 },
        ],
        [
          { price: 70_000, days: 10 },
          { price: 50_000, days: 50 },
        ],
        [
          { price: 90_000, days: 20 },
          { price: 70_000, days: 20 },
          { price: 50_000, days: 80 },
        ],
        [
          { price: 50_000, days: 60 },
          { price: 40_000, days: 25 },
        ],
        [
          { price: 60_000, days: 30 },
          { price: 45_000, days: 30 },
          { price: 55_000, days: 30 },
        ],
        [
          { price: 50_000, days: 100 },
          { price: 52_500, days: 10 },
        ],
      ];
      const prices = [35_000, 45_000, 47_500, 48_500, 50_000, 52_500, 60_000];
      const durations = [0.5, 5, 40];
      const referenceFactors = [null, 0.9, 1, 1.1, 1.5];
      const inputs: ClassifyInput[] = [];
      for (const past of pasts) {
        for (const price of prices) {
          for (const days of durations) {
            for (const factor of referenceFactors) {
              const index = inputs.length;
              const reference = factor === null ? undefined : Math.round(price * factor);
              const steps = [...past, { price, days, reference, inStock: index % 2 === 0 }];
              const otherFactor = [null, 0.9, 1.1][index % 3] ?? null;
              const cheapestOtherStore =
                otherFactor === null
                  ? null
                  : { storeName: "Darty", priceCents: Math.round(price * otherFactor) };
              inputs.push({ intervals: buildIntervals(steps), now: NOW, cheapestOtherStore });
            }
          }
        }
      }
      return [...inputs, GAP_INPUT];
    }

    const results = enumerateInputs().map((input) => classify(input));
    const texts = results.flatMap((result) => [
      result.labelName,
      result.text,
      ...result.warnings.map((warning) => warning.text),
    ]);

    it("produces every label, every warning and every sentence variant", () => {
      // Arrange
      const variants = [
        "Ainda não há dados",
        "subiu para",
        "esteve em",
        "dos últimos 90 dias",
        "habitual desde",
        "O preço é o mesmo desde",
        "Sem descida relevante face ao preço mais baixo dos 30 dias anteriores (",
        "Sem descida relevante face ao preço habitual",
        "Face aos 30 dias anteriores: +",
        "Face aos 30 dias anteriores: 0%",
        `Face aos 30 dias anteriores: ${MINUS}`,
      ];

      // Act
      const labels = new Set(results.map((result) => result.label));
      const warnings = new Set(results.flatMap((result) => result.warnings.map((warning) => warning.code)));
      const missingVariants = variants.filter((variant) => !texts.some((text) => text.includes(variant)));

      // Assert
      expect(labels).toEqual(new Set(ALL_LABELS));
      expect(warnings).toEqual(new Set(ALL_WARNINGS));
      expect(missingVariants).toEqual([]);
    });

    it("never uses the words falso, enganoso or fraude", () => {
      // Arrange
      const everyText = [...texts, ...Object.values(LABEL_NAMES), ...Object.values(WARNING_NAMES)];

      // Act
      const offending = everyText.filter((text) => /fals[oa]|engan|fraud/i.test(text));

      // Assert
      expect(offending).toEqual([]);
    });

    it("names the 30 days before the current price, never 'últimos 30 dias'", () => {
      // Arrange
      const everyText = texts;

      // Act
      const offending = everyText.filter((text) => /últimos 30 dias/i.test(text));

      // Assert
      expect(offending).toEqual([]);
    });

    it("never prints null, undefined, NaN or Infinity", () => {
      // Arrange
      const everyText = texts;

      // Act
      const offending = everyText.filter((text) => /null|undefined|NaN|Infinity/.test(text));

      // Assert
      expect(offending).toEqual([]);
    });

    it("takes the name and tone from the shared maps", () => {
      // Arrange
      const all = results;

      // Act
      const mismatched = all.filter(
        (result) =>
          result.labelName !== LABEL_NAMES[result.label] || result.tone !== LABEL_TONES[result.label],
      );

      // Assert
      expect(mismatched).toEqual([]);
    });
  });
});
