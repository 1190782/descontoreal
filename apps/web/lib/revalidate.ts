import { timingSafeEqual } from "node:crypto";

/** Slugs per request; the scrapers send chunks of 200 (REVALIDATE_CHUNK_SIZE). */
export const MAX_SLUGS = 200;

// products.slug's check constraint.
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Product pages to render again, or every page (after `pnpm stats`, which changes labels without prices). */
export type RevalidateRequest = { all: true } | { all: false; slugs: string[] };

/** Reads { "slugs": [...] } or { "all": true }; null for anything else. */
export function parseRevalidateBody(body: unknown): RevalidateRequest | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }
  if ("all" in body && body.all === true) {
    return { all: true };
  }
  if (!("slugs" in body) || !Array.isArray(body.slugs)) {
    return null;
  }
  const slugs: unknown[] = body.slugs;
  if (slugs.length === 0 || slugs.length > MAX_SLUGS) {
    return null;
  }
  const valid = slugs.filter((slug): slug is string => typeof slug === "string" && SLUG.test(slug));
  return valid.length === slugs.length ? { all: false, slugs: [...new Set(valid)] } : null;
}

/** True when `header` is "Bearer <secret>", compared in constant time; false without a secret configured. */
export function isAuthorized(header: string | null, secret: string | undefined): boolean {
  if (secret === undefined || secret === "" || header === null) {
    return false;
  }
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
