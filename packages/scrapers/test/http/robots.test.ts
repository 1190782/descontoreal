import { describe, expect, it } from "vitest";
import { ALLOW_ALL, parseRobots } from "../../src/http/robots";

const ROBOTS_URL = "https://loja.test/robots.txt";

describe("parseRobots", () => {
  it("disallows paths of the * group", () => {
    // Arrange
    const rules = parseRobots(ROBOTS_URL, "User-agent: *\nDisallow: /pesquisa\nDisallow: /*?sort=");

    // Act
    const allowed = [
      rules.isAllowed("https://loja.test/c/televisores?page=2"),
      rules.isAllowed("https://loja.test/pesquisa?q=tv"),
      rules.isAllowed("https://loja.test/c/televisores?sort=price"),
    ];

    // Assert
    expect(allowed).toEqual([true, false, false]);
  });

  it("follows the DescontoRealBot group over the * group", () => {
    // Arrange
    const rules = parseRobots(
      ROBOTS_URL,
      "User-agent: *\nAllow: /\n\nUser-agent: DescontoRealBot\nDisallow: /",
    );

    // Act
    const allowed = rules.isAllowed("https://loja.test/c/televisores");

    // Assert
    expect(allowed).toBe(false);
  });

  it("applies the rules to the www host of the same store", () => {
    // Arrange
    const rules = parseRobots(ROBOTS_URL, "User-agent: *\nDisallow: /conta");

    // Act
    const allowed = rules.isAllowed("https://www.loja.test/conta/encomendas");

    // Assert
    expect(allowed).toBe(false);
  });

  it("reads the Crawl-delay in milliseconds", () => {
    // Arrange
    const rules = parseRobots(ROBOTS_URL, "User-agent: *\nCrawl-delay: 7.5\nDisallow:");

    // Act
    const { crawlDelayMs } = rules;

    // Assert
    expect(crawlDelayMs).toBe(7500);
  });

  it("has no Crawl-delay when robots.txt sets none", () => {
    // Arrange
    const rules = parseRobots(ROBOTS_URL, "User-agent: *\nDisallow: /conta");

    // Act
    const { crawlDelayMs } = rules;

    // Assert
    expect(crawlDelayMs).toBeNull();
  });
});

describe("ALLOW_ALL", () => {
  it("allows every URL without a Crawl-delay", () => {
    // Act
    const allowed = ALLOW_ALL.isAllowed("https://loja.test/qualquer/coisa");

    // Assert
    expect(allowed).toBe(true);
    expect(ALLOW_ALL.crawlDelayMs).toBeNull();
  });
});
