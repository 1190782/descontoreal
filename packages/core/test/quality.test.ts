import { describe, expect, it } from "vitest";
import { QUALITY_CONFIG, isBrokenRun, isSuspiciousPriceJump, type QualityConfig } from "../src/quality";

describe("isSuspiciousPriceJump", () => {
  it.each([
    ["a drop of exactly 70%", 10_000, 3_000, false],
    ["a drop just above 70%", 10_000, 2_999, true],
    ["a rise of exactly 200%", 10_000, 30_000, false],
    ["a rise just above 200%", 10_000, 30_001, true],
    ["a drop of exactly 70% on an odd price", 44_990, 13_497, false],
    ["a drop to zero", 10_000, 0, true],
    ["a normal discount", 44_999, 39_999, false],
    ["no change", 44_999, 44_999, false],
  ])("for %s (%i → %i) returns %s", (_case, previousCents, nextCents, expected) => {
    // Arrange
    const previous = previousCents;

    // Act
    const suspicious = isSuspiciousPriceJump(previous, nextCents);

    // Assert
    expect(suspicious).toBe(expected);
  });

  it.each([0, -100])("never flags a jump from a previous price of %i", (previousCents) => {
    // Arrange
    const nextCents = 1_000_000;

    // Act
    const suspicious = isSuspiciousPriceJump(previousCents, nextCents);

    // Assert
    expect(suspicious).toBe(false);
  });

  it("uses the thresholds it is given", () => {
    // Arrange
    const config: QualityConfig = { ...QUALITY_CONFIG, maxDropFraction: 0.5 };

    // Act
    const results = [
      isSuspiciousPriceJump(10_000, 5_000, config),
      isSuspiciousPriceJump(10_000, 4_999, config),
    ];

    // Assert
    expect(results).toEqual([false, true]);
  });
});

describe("isBrokenRun", () => {
  it("never flags a run without history", () => {
    // Arrange
    const recentCounts: number[] = [];

    // Act
    const broken = isBrokenRun(0, recentCounts);

    // Assert
    expect(broken).toBe(false);
  });

  it.each([
    ["exactly 30% fewer listings", 700, false],
    ["just over 30% fewer listings", 699, true],
    ["as many listings as usual", 1_000, false],
    ["more listings than usual", 1_500, false],
    ["no listings", 0, true],
  ])("against an average of 1000, %s (%i) gives %s", (_case, listingsSeen, expected) => {
    // Arrange
    const recentCounts = [900, 1_000, 1_100, 1_000, 950, 1_050, 1_000];

    // Act
    const broken = isBrokenRun(listingsSeen, recentCounts);

    // Assert
    expect(broken).toBe(expected);
  });

  it("compares against the average, not a single run", () => {
    // Arrange
    const recentCounts = [100, 300];

    // Act
    const results = [isBrokenRun(140, recentCounts), isBrokenRun(139, recentCounts)];

    // Assert
    expect(results).toEqual([false, true]);
  });

  it("uses the threshold it is given", () => {
    // Arrange
    const config: QualityConfig = { ...QUALITY_CONFIG, brokenRunFraction: 0.5 };

    // Act
    const results = [isBrokenRun(50, [100], config), isBrokenRun(49, [100], config)];

    // Assert
    expect(results).toEqual([false, true]);
  });
});

describe("QUALITY_CONFIG", () => {
  it("matches the plan: 70% drop, 200% rise, 30% fewer listings than the last 7 runs", () => {
    // Arrange
    const expected: QualityConfig = {
      maxDropFraction: 0.7,
      maxRiseFraction: 2,
      brokenRunFraction: 0.7,
      recentRuns: 7,
    };

    // Act
    const config = QUALITY_CONFIG;

    // Assert
    expect(config).toEqual(expected);
  });
});
