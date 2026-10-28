import { describe, expect, it } from "vitest";
import { BOT_USER_AGENT, SITE } from "../src/site";

describe("SITE", () => {
  it("holds the site name and domain", () => {
    // Arrange
    const expected = {
      name: "DescontoReal",
      domain: "descontoreal.pt",
      url: "https://descontoreal.pt",
      tagline: "Histórico de preços das lojas portuguesas",
    };

    // Act
    const site = SITE;

    // Assert
    expect(site).toEqual(expected);
  });
});

describe("BOT_USER_AGENT", () => {
  it("identifies the bot with its contact page", () => {
    // Arrange
    const expected = "DescontoRealBot/1.0 (+https://descontoreal.pt/bot)";

    // Act
    const userAgent = BOT_USER_AGENT;

    // Assert
    expect(userAgent).toBe(expected);
  });
});
