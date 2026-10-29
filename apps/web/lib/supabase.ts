import "server-only";
import type { ReviewOutcome, ReviewQueue } from "@descontoreal/db/web";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { AUTH_COOKIE_OPTIONS, supabaseConfig } from "@/lib/admin";

/** The functions of 0004_admin_review.sql the admin pages call through Supabase's API. */
interface AdminDatabase {
  public: {
    Tables: Record<never, never>;
    Views: Record<never, never>;
    Functions: {
      admin_review_queue: { Args: Record<never, never>; Returns: ReviewQueue };
      admin_approve_match: { Args: { p_candidate_id: number }; Returns: ReviewOutcome };
      admin_reject_match: { Args: { p_candidate_id: number }; Returns: ReviewOutcome };
      admin_split_listing: { Args: { p_listing_id: number }; Returns: ReviewOutcome };
    };
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
}

export type AdminClient = SupabaseClient<AdminDatabase>;

/** The signed-in user's client for admin pages and Server Actions, with the session in the request's cookies. */
export async function createSessionClient(): Promise<AdminClient> {
  const { url, key } = supabaseConfig();
  const cookieStore = await cookies();
  return createServerClient<AdminDatabase>(url, key, {
    cookieOptions: AUTH_COOKIE_OPTIONS,
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // A page can't write cookies; on /admin the middleware has already refreshed the session.
        }
      },
    },
  });
}

/** Sends sign-in links and nothing else: no session, nothing stored in the browser. */
export function createMailClient(): AdminClient {
  const { url, key } = supabaseConfig();
  return createClient<AdminDatabase>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
