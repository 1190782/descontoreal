import type { CookieOptionsWithName } from "@supabase/ssr";
import type { JwtPayload } from "@supabase/supabase-js";

/** Where the magic link signs in to, and the only admin page so far. */
export const ADMIN_HOME = "/admin/correspondencias";

/**
 * Only the admin pages use the session, so the browser sends its cookies nowhere else and the public pages stay
 * cookie-free. No script reads them: every Supabase call runs on the server.
 */
export const AUTH_COOKIE_OPTIONS: CookieOptionsWithName = {
  path: "/admin",
  httpOnly: true,
  secure: true,
  sameSite: "lax",
};

// Inlined by next build from the GitHub variables of the deploy; the publishable key is public by design.
export function supabaseConfig(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url === undefined || url === "" || key === undefined || key === "") {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are not set");
  }
  return { url, key };
}

/** The same test as is_admin() in 0004_admin_review.sql; only the service role can set app_metadata. */
export function isAdmin(claims: JwtPayload | undefined): boolean {
  return claims?.app_metadata?.role === "admin";
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;

export function parseEmail(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const email = value.trim();
  return email.length <= MAX_EMAIL_LENGTH && EMAIL.test(email) ? email : null;
}

/** A database id from a form field: a positive whole number, or null. */
export function parseId(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * The notice after asking for a sign-in link. An address without an account (otp_disabled, since the form never
 * creates one) gets the same notice as a sent link, so the form tells no one who has access.
 */
export function signInLinkNotice(
  error: { status?: number; code?: string } | null,
): "enviado" | "limite" | "falhou" {
  if (error === null || error.code === "otp_disabled") {
    return "enviado";
  }
  return error.status === 429 ? "limite" : "falhou";
}

/** The text of the ?aviso= notice a page was redirected with, or null for none or an unknown one. */
export function noticeText<Notice extends string>(
  value: string | string[] | undefined,
  texts: Record<Notice, string>,
): string | null {
  return typeof value === "string" && Object.hasOwn(texts, value) ? texts[value as Notice] : null;
}
