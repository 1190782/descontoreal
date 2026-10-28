import type { ImageLoaderProps } from "next/image";

// Darty's images come from Shopify's CDN, on its own host or on the shop's domain; both resize by query string.
const SHOPIFY_HOSTS = new Set(["cdn.shopify.com", "darty.pt"]);

/** Asks Shopify for the width next/image needs; other images are passed with `unoptimized` (isResizable). */
export default function imageLoader({ src, width }: ImageLoaderProps): string {
  if (!src.startsWith("https://")) {
    return src;
  }
  const url = new URL(src);
  if (!SHOPIFY_HOSTS.has(url.hostname)) {
    return src;
  }
  url.searchParams.set("width", String(width));
  return url.toString();
}

/** True for images the loader can resize; the rest go to next/image with `unoptimized`. */
export function isResizable(src: string): boolean {
  return src.startsWith("https://") && SHOPIFY_HOSTS.has(new URL(src).hostname);
}
