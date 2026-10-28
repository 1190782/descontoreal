import { describe, expect, it } from "vitest";
import { backoffDelayMs, isRetryableStatus, parseRetryAfter } from "../../src/http/retry";

const NOW = new Date("2026-10-28T03:00:00Z");

describe("isRetryableStatus", () => {
  it.each([
    [429, true],
    [500, true],
    [503, true],
    [200, false],
    [403, false],
    [404, false],
  ])("status %i → %s", (status, expected) => {
    // Act
    const retryable = isRetryableStatus(status);

    // Assert
    expect(retryable).toBe(expected);
  });
});

describe("parseRetryAfter", () => {
  it("reads delta seconds", () => {
    // Act
    const waitMs = parseRetryAfter(" 120 ", NOW);

    // Assert
    expect(waitMs).toBe(120_000);
  });

  it("reads an HTTP date", () => {
    // Act
    const waitMs = parseRetryAfter("Wed, 28 Oct 2026 03:00:30 GMT", NOW);

    // Assert
    expect(waitMs).toBe(30_000);
  });

  it("never returns a negative wait for a date in the past", () => {
    // Act
    const waitMs = parseRetryAfter("Wed, 28 Oct 2026 02:00:00 GMT", NOW);

    // Assert
    expect(waitMs).toBe(0);
  });

  it.each([null, "soon", ""])("returns null for %j", (value) => {
    // Act
    const waitMs = parseRetryAfter(value, NOW);

    // Assert
    expect(waitMs).toBeNull();
  });
});

describe("backoffDelayMs", () => {
  it.each([
    [1, 0, 500],
    [1, 1, 1000],
    [2, 0, 1000],
    [2, 0.5, 1500],
    [3, 1, 4000],
  ])("attempt %i with random %f waits %i ms (base 1000)", (attempt, random, expected) => {
    // Act
    const waitMs = backoffDelayMs(attempt, 1000, () => random);

    // Assert
    expect(waitMs).toBe(expected);
  });
});
