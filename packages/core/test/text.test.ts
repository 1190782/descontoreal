import { describe, expect, it } from "vitest";
import { formatList } from "../src/text";

describe("formatList", () => {
  it.each([
    [["Darty"], "Darty"],
    [["Radio Popular", "Darty"], "Radio Popular e Darty"],
    [["Worten", "Radio Popular", "Darty"], "Worten, Radio Popular e Darty"],
  ])("joins %j as %j", (items, expected) => {
    // Act
    const text = formatList(items);

    // Assert
    expect(text).toBe(expected);
  });
});
