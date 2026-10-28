import iconv from "iconv-lite";

// The HTML prescan looks at the first 1024 bytes; some pages put long scripts before <meta>.
const META_SCAN_BYTES = 4096;

// WHATWG Encoding: browsers read these labels as windows-1252, where 0x80 is "€".
const WINDOWS_1252_LABELS = new Set([
  "ansi_x3.4-1968",
  "ascii",
  "cp1252",
  "cp819",
  "csisolatin1",
  "ibm819",
  "iso-8859-1",
  "iso-ir-100",
  "iso8859-1",
  "iso88591",
  "iso_8859-1",
  "iso_8859-1:1987",
  "l1",
  "latin1",
  "us-ascii",
  "windows-1252",
  "x-cp1252",
]);

/** Charset label of a Content-Type header ("text/html; charset=ISO-8859-1" → "iso-8859-1"), or null. */
export function charsetFromContentType(contentType: string | null): string | null {
  if (!contentType) {
    return null;
  }
  const match = /charset\s*=\s*["']?([^"';\s]+)/i.exec(contentType);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Charset declared by <meta charset> or <meta http-equiv="Content-Type"> near the start of a page, or null. */
export function charsetFromMeta(bytes: Uint8Array): string | null {
  const head = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, META_SCAN_BYTES),
  ).toString("latin1");
  const match = /<meta\b[^>]*?charset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head);
  const label = match?.[1]?.toLowerCase() ?? null;
  // A page whose bytes we could read as ASCII is not UTF-16, whatever its <meta> says (HTML spec).
  return label?.startsWith("utf-16") ? "utf-8" : label;
}

/** Encoding for a body: UTF-8 BOM, then the Content-Type charset, then <meta>, else UTF-8. */
export function detectEncoding(bytes: Uint8Array, contentType: string | null): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8";
  }
  return (
    supportedEncoding(charsetFromContentType(contentType)) ??
    supportedEncoding(charsetFromMeta(bytes)) ??
    "utf-8"
  );
}

/** Decodes a response body with the encoding from detectEncoding(). */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return iconv.decode(buffer, detectEncoding(bytes, contentType));
}

function supportedEncoding(label: string | null): string | null {
  if (label === null) {
    return null;
  }
  if (WINDOWS_1252_LABELS.has(label)) {
    return "windows-1252";
  }
  return iconv.encodingExists(label) ? label : null;
}
