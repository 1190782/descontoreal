import { describe, expect, it } from "vitest";
import { charsetFromContentType, charsetFromMeta, decodeBody, detectEncoding } from "../../src/http/decode";

// "Máquina 1.299,99 €" in windows-1252: á is 0xE1 and € is 0x80.
const WINDOWS_1252_BYTES = new Uint8Array([
  0x4d, 0xe1, 0x71, 0x75, 0x69, 0x6e, 0x61, 0x20, 0x31, 0x2e, 0x32, 0x39, 0x39, 0x2c, 0x39, 0x39, 0x20, 0x80,
]);
const DECODED = "Máquina 1.299,99 €";

function ascii(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function withPrefix(prefix: string, bytes: Uint8Array): Uint8Array {
  const head = ascii(prefix);
  const joined = new Uint8Array(head.length + bytes.length);
  joined.set(head);
  joined.set(bytes, head.length);
  return joined;
}

describe("charsetFromContentType", () => {
  it.each([
    ["text/html; charset=ISO-8859-1", "iso-8859-1"],
    ['text/html; charset="utf-8"', "utf-8"],
    ["text/html;charset=windows-1252;foo=bar", "windows-1252"],
    ["application/json", null],
    [null, null],
  ])("reads %s as %s", (contentType, expected) => {
    // Act
    const charset = charsetFromContentType(contentType);

    // Assert
    expect(charset).toBe(expected);
  });
});

describe("charsetFromMeta", () => {
  it("reads <meta charset>", () => {
    // Arrange
    const bytes = ascii('<html><head><meta charset="Windows-1252"><title>x</title>');

    // Act
    const charset = charsetFromMeta(bytes);

    // Assert
    expect(charset).toBe("windows-1252");
  });

  it("reads <meta http-equiv> with a charset in its content", () => {
    // Arrange
    const bytes = ascii('<meta http-equiv="Content-Type" content="text/html; charset=iso-8859-1" />');

    // Act
    const charset = charsetFromMeta(bytes);

    // Assert
    expect(charset).toBe("iso-8859-1");
  });

  it("returns null without a meta charset", () => {
    // Arrange
    const bytes = ascii('{"items": []}');

    // Act
    const charset = charsetFromMeta(bytes);

    // Assert
    expect(charset).toBeNull();
  });

  it("reads a UTF-16 declaration as UTF-8, as browsers do", () => {
    // Arrange
    const bytes = ascii('<meta charset="utf-16">');

    // Act
    const charset = charsetFromMeta(bytes);

    // Assert
    expect(charset).toBe("utf-8");
  });
});

describe("detectEncoding", () => {
  it("maps ISO-8859-1 to windows-1252", () => {
    // Act
    const encoding = detectEncoding(WINDOWS_1252_BYTES, "text/html; charset=ISO-8859-1");

    // Assert
    expect(encoding).toBe("windows-1252");
  });

  it("prefers a UTF-8 byte order mark over the Content-Type", () => {
    // Arrange
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x41]);

    // Act
    const encoding = detectEncoding(bytes, "text/html; charset=iso-8859-1");

    // Assert
    expect(encoding).toBe("utf-8");
  });

  it("falls back to <meta> when the Content-Type charset is unknown", () => {
    // Arrange
    const bytes = ascii('<meta charset="iso-8859-1">');

    // Act
    const encoding = detectEncoding(bytes, "text/html; charset=nonsense");

    // Assert
    expect(encoding).toBe("windows-1252");
  });

  it("defaults to UTF-8", () => {
    // Act
    const encoding = detectEncoding(ascii("<p>ok</p>"), "text/html");

    // Assert
    expect(encoding).toBe("utf-8");
  });
});

describe("decodeBody", () => {
  it("decodes an ISO-8859-1 page, including the euro sign", () => {
    // Act
    const text = decodeBody(WINDOWS_1252_BYTES, "text/html; charset=ISO-8859-1");

    // Assert
    expect(text).toBe(DECODED);
  });

  it("decodes by <meta charset> when the Content-Type has none", () => {
    // Arrange
    const bytes = withPrefix('<meta charset="iso-8859-1">', WINDOWS_1252_BYTES);

    // Act
    const text = decodeBody(bytes, "text/html");

    // Assert
    expect(text).toBe(`<meta charset="iso-8859-1">${DECODED}`);
  });

  it("decodes UTF-8 by default and strips the byte order mark", () => {
    // Arrange
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(DECODED)]);

    // Act
    const text = decodeBody(bytes, null);

    // Assert
    expect(text).toBe(DECODED);
  });
});
