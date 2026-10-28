import { describe, expect, it } from "vitest";
import { detectBotChallenge } from "../../src/http/challenge";

describe("detectBotChallenge", () => {
  it("detects the Cloudflare cf-mitigated header", () => {
    // Arrange
    const headers = new Headers({ "cf-mitigated": "challenge" });

    // Act
    const vendor = detectBotChallenge(403, headers, "");

    // Assert
    expect(vendor).toBe("Cloudflare");
  });

  it("detects the Cloudflare 'Just a moment' page, even with status 200", () => {
    // Arrange
    const body =
      "<html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue";

    // Act
    const vendor = detectBotChallenge(200, new Headers(), body);

    // Assert
    expect(vendor).toBe("Cloudflare");
  });

  it("detects a DataDome captcha page", () => {
    // Arrange
    const body = '<script src="https://ct.captcha-delivery.com/c.js"></script>';

    // Act
    const vendor = detectBotChallenge(403, new Headers(), body);

    // Assert
    expect(vendor).toBe("DataDome");
  });

  it("detects a DataDome block by its header on a 403", () => {
    // Arrange
    const headers = new Headers({ "x-datadome": "protected" });

    // Act
    const vendor = detectBotChallenge(403, headers, "Forbidden");

    // Assert
    expect(vendor).toBe("DataDome");
  });

  it("detects an Akamai challenge page", () => {
    // Arrange
    const body =
      '<div id="sec-if-cpt-container"></div><script src="/_sec/cp_challenge/ak-challenge.js"></script>';

    // Act
    const vendor = detectBotChallenge(200, new Headers(), body);

    // Assert
    expect(vendor).toBe("Akamai");
  });

  it("detects an Akamai block by its server header on a 403", () => {
    // Arrange
    const headers = new Headers({ server: "AkamaiGHost" });

    // Act
    const vendor = detectBotChallenge(403, headers, "<H1>Access Denied</H1>");

    // Assert
    expect(vendor).toBe("Akamai");
  });

  it("ignores normal pages that load bot-management scripts", () => {
    // Arrange
    const headers = new Headers({ "x-datadome": "protected", server: "cloudflare" });
    const body =
      '<title>Televisores</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>' +
      '<script src="https://js.datadome.co/tags.js"></script>';

    // Act
    const vendor = detectBotChallenge(200, headers, body);

    // Assert
    expect(vendor).toBeNull();
  });
});
