import { describe, expect, it } from "vitest";
import {
  centsToDecimal,
  decimalToCents,
  formatCents,
  formatPercent,
  formatSignedPercent,
  parsePriceToCents,
  percentBelow,
} from "../src/money";

const NBSP = String.fromCharCode(0xa0);
const NARROW_NBSP = String.fromCharCode(0x202f);
const MINUS = String.fromCharCode(0x2212);

describe("parsePriceToCents", () => {
  it.each([
    ["1.299,99 €", 129_999],
    [`449,99${NBSP}€`, 44_999],
    [`1${NBSP}299,99${NBSP}€`, 129_999],
    [`1${NARROW_NBSP}299,99 €`, 129_999],
    ["449,-", 44_900],
    ["449.-", 44_900],
    ["1.299,-", 129_900],
    ["1299.99", 129_999],
    ["1.299", 129_900],
    ["1,299.99", 129_999],
    ["449 €", 44_900],
    ["449€", 44_900],
    ["€ 12,50", 1_250],
    ["12,5 €", 1_250],
    ["0,99 €", 99],
    ["Preço: 449,99 €", 44_999],
    ["1.234.567,89", 123_456_789],
  ])("reads %j as %i cents", (text, expected) => {
    // Arrange
    const input = text;

    // Act
    const cents = parsePriceToCents(input);

    // Assert
    expect(cents).toBe(expected);
  });

  it.each(["", "Esgotado", "€", " , "])("returns null for %j", (text) => {
    // Arrange
    const input = text;

    // Act
    const cents = parsePriceToCents(input);

    // Assert
    expect(cents).toBeNull();
  });

  it("returns null for more than nine integer digits", () => {
    // Arrange
    const input = "1234567890,00 €";

    // Act
    const cents = parsePriceToCents(input);

    // Assert
    expect(cents).toBeNull();
  });
});

describe("decimalToCents", () => {
  it.each([
    ["119.9", 11_990],
    ["119.99", 11_999],
    ["120", 12_000],
    [" 119.99 ", 11_999],
    ["0.05", 5],
    [119.99, 11_999],
    [119.9, 11_990],
    [120, 12_000],
    [0.1 + 0.2, 30],
  ])("converts %j to %i cents", (value, expected) => {
    // Arrange
    const input = value;

    // Act
    const cents = decimalToCents(input);

    // Assert
    expect(cents).toBe(expected);
  });

  it.each([
    ["", ""],
    ["three decimals", "119.999"],
    ["comma decimal", "1,99"],
    ["text", "abc"],
    ["negative text", "-5.00"],
    ["ten integer digits", "1234567890"],
    ["negative number", -5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["null", null],
    ["undefined", undefined],
  ])("returns null for %s", (_case, value) => {
    // Arrange
    const input = value;

    // Act
    const cents = decimalToCents(input);

    // Assert
    expect(cents).toBeNull();
  });
});

describe("formatCents", () => {
  it.each([
    [44_999, `449,99${NBSP}€`],
    [129_999, `1299,99${NBSP}€`],
    [1_299_999, `12${NBSP}999,99${NBSP}€`],
    [5, `0,05${NBSP}€`],
    [0, `0,00${NBSP}€`],
  ])("formats %i cents as Node's pt-PT EUR output", (cents, expected) => {
    // Arrange
    const input = cents;

    // Act
    const text = formatCents(input);

    // Assert
    expect(text).toBe(expected);
  });
});

describe("percentBelow", () => {
  it.each([
    [50_000, 45_000, 10],
    [50_000, 55_000, -10],
    [50_000, 50_000, 0],
  ])("from %i to %i is %d%%", (fromCents, toCents, expected) => {
    // Arrange
    const from = fromCents;

    // Act
    const percent = percentBelow(from, toCents);

    // Assert
    expect(percent).toBeCloseTo(expected, 10);
  });

  it.each([0, -100])("returns 0 when the base is %i", (fromCents) => {
    // Arrange
    const toCents = 100;

    // Act
    const percent = percentBelow(fromCents, toCents);

    // Assert
    expect(percent).toBe(0);
  });
});

describe("formatPercent", () => {
  it.each([
    [12.4, "12%"],
    [12.5, "13%"],
    [5, "5%"],
    [0.4, "0,4%"],
    [0.96, "1%"],
    [0.04, "0%"],
    [1234.4, "1234%"],
    [12_345, `12${NBSP}345%`],
    [-3.2, `${MINUS}3%`],
    [-0.4, `${MINUS}0,4%`],
    [-0.04, "0%"],
    [0, "0%"],
  ])("formats %d as %j", (value, expected) => {
    // Arrange
    const input = value;

    // Act
    const text = formatPercent(input);

    // Assert
    expect(text).toBe(expected);
  });
});

describe("formatSignedPercent", () => {
  it.each([
    [12, "+12%"],
    [0.4, "+0,4%"],
    [-12, `${MINUS}12%`],
    [-0.4, `${MINUS}0,4%`],
    [0, "0%"],
    [0.04, "0%"],
    [-0.04, "0%"],
  ])("formats %d as %j", (value, expected) => {
    // Arrange
    const input = value;

    // Act
    const text = formatSignedPercent(input);

    // Assert
    expect(text).toBe(expected);
  });
});

describe("centsToDecimal", () => {
  it.each([
    [44_999, "449.99"],
    [5, "0.05"],
    [100_000, "1000.00"],
    [0, "0.00"],
  ])("writes %i cents as %j", (cents, expected) => {
    // Act
    const decimal = centsToDecimal(cents);

    // Assert
    expect(decimal).toBe(expected);
  });

  it.each([[1.5], [-1]])("rejects %j", (cents) => {
    // Act
    const write = (): string => centsToDecimal(cents);

    // Assert
    expect(write).toThrow("non-negative whole number of cents");
  });
});
