import { describe, expect, it } from "vitest";
import { hasValidCheckDigit, normalizeGtin } from "../src/gtin";

describe("normalizeGtin", () => {
  it.each([
    ["EAN-13", "4006381333931", "4006381333931"],
    ["EAN-13 with spaces", " 4 006381 333931 ", "4006381333931"],
    ["EAN-13 with hyphens", "590-1234-123457", "5901234123457"],
    ["UPC-A padded to 13 digits", "036000291452", "0036000291452"],
    ["GTIN-14 with indicator 0", "00036000291452", "0036000291452"],
    ["EAN-8 padded to 13 digits", "96385074", "0000096385074"],
    ["EAN-8 already in 13 digits", "0000096385074", "0000096385074"],
    ["EAN-8 in 14 digits", "00000096385074", "0000096385074"],
  ])("normalizes %s", (_case, raw, expected) => {
    // Arrange
    const input = raw;

    // Act
    const gtin = normalizeGtin(input);

    // Assert
    expect(gtin).toBe(expected);
  });

  it.each([
    ["a wrong check digit", "4006381333932"],
    ["letters", "40063813339AB"],
    ["9 digits", "123456789"],
    ["11 digits", "12345678901"],
    ["15 digits", "000036000291452"],
    ["all zeros", "0000000000000"],
    ["GTIN-14 with a case indicator", "10036000291459"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["null", null],
    ["undefined", undefined],
  ])("returns null for %s", (_case, raw) => {
    // Arrange
    const input = raw;

    // Act
    const gtin = normalizeGtin(input);

    // Assert
    expect(gtin).toBeNull();
  });

  it.each([
    ["020", "0201234567899"],
    ["029", "0291234567890"],
    ["040", "0401234567893"],
    ["049", "0491234567894"],
    ["200", "2001234567893"],
    ["250", "2501234567898"],
    ["299", "2991234567897"],
  ])("rejects the restricted-circulation prefix %s", (_prefix, raw) => {
    // Arrange
    const input = raw;

    // Act
    const gtin = normalizeGtin(input);

    // Assert
    expect(gtin).toBeNull();
  });

  it.each([
    ["019", "0191234567893"],
    ["030", "0301234567896"],
    ["039", "0391234567897"],
    ["050", "0501234567890"],
    ["199", "1991234567898"],
    ["300", "3001234567892"],
    ["978", "9781234567897"],
  ])("accepts the neighbouring prefix %s", (_prefix, raw) => {
    // Arrange
    const input = raw;

    // Act
    const gtin = normalizeGtin(input);

    // Assert
    expect(gtin).toBe(raw);
  });

  it.each([
    ["UPC-A with number system 2", "212345678909"],
    ["UPC-A with number system 4", "412345678903"],
  ])("rejects %s, which pads into a restricted prefix", (_case, raw) => {
    // Arrange
    const input = raw;

    // Act
    const gtin = normalizeGtin(input);

    // Assert
    expect(gtin).toBeNull();
  });

  it.each([
    ["EAN-8 starting with 0", "01234565"],
    ["EAN-8 starting with 2", "21234569"],
    ["EAN-8 starting with 2 as UPC-A", "000021234569"],
    ["EAN-8 starting with 2 as EAN-13", "0000021234569"],
    ["EAN-8 starting with 2 as GTIN-14", "00000021234569"],
    ["EAN-8 starting with 0 as EAN-13", "0000001234565"],
  ])("rejects a restricted %s", (_case, raw) => {
    // Arrange
    const input = raw;

    // Act
    const gtin = normalizeGtin(input);

    // Assert
    expect(gtin).toBeNull();
  });
});

describe("hasValidCheckDigit", () => {
  it.each(["96385074", "73513537", "036000291452", "4006381333931", "5901234123457", "00036000291452"])(
    "accepts %s",
    (code) => {
      // Arrange
      const input = code;

      // Act
      const valid = hasValidCheckDigit(input);

      // Assert
      expect(valid).toBe(true);
    },
  );

  it.each([
    ["a wrong EAN-13 check digit", "4006381333930"],
    ["a wrong EAN-8 check digit", "96385075"],
    ["a wrong UPC-A check digit", "036000291453"],
    ["9 digits", "963850741"],
    ["10 digits", "9638507412"],
    ["11 digits", "96385074123"],
    ["15 digits", "000036000291452"],
    ["spaces", "4006381 333931"],
    ["an empty string", ""],
  ])("rejects %s", (_case, code) => {
    // Arrange
    const input = code;

    // Act
    const valid = hasValidCheckDigit(input);

    // Assert
    expect(valid).toBe(false);
  });
});
