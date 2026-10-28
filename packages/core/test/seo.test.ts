import { describe, expect, it } from "vitest";
import { organizationJsonLd, serializeJsonLd } from "../src/seo";

describe("organizationJsonLd", () => {
  it("describes the site as a schema.org Organization", () => {
    // Arrange
    const expected = {
      "@context": "https://schema.org",
      "@type": "Organization",
      name: "DescontoReal",
      url: "https://descontoreal.pt",
      email: "contacto@descontoreal.pt",
    };

    // Act
    const jsonLd = organizationJsonLd();

    // Assert
    expect(jsonLd).toEqual(expected);
  });
});

describe("serializeJsonLd", () => {
  it("escapes < so a product name cannot close the script element", () => {
    // Arrange
    const data = { "@type": "Product", name: 'TV </script><script>alert(1)</script> 55"' };

    // Act
    const json = serializeJsonLd(data);

    // Assert
    expect(json).not.toContain("<");
    expect(JSON.parse(json)).toEqual(data);
  });

  it("serializes a list of objects as a JSON array", () => {
    // Arrange
    const data = [{ "@type": "Organization" }, { "@type": "BreadcrumbList" }];

    // Act
    const json = serializeJsonLd(data);

    // Assert
    expect(json).toBe('[{"@type":"Organization"},{"@type":"BreadcrumbList"}]');
  });
});
