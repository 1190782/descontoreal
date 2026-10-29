"use server";

import type { ReviewOutcome } from "@descontoreal/db/web";
import type { PostgrestError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ADMIN_HOME, parseId } from "@/lib/admin";
import { type AdminClient, createSessionClient } from "@/lib/supabase";

type Decision = (
  supabase: AdminClient,
  id: number,
) => PromiseLike<{ data: ReviewOutcome | null; error: PostgrestError | null }>;

export async function approveMatch(formData: FormData): Promise<void> {
  await review(formData, "aprovada", (supabase, id) =>
    supabase.rpc("admin_approve_match", { p_candidate_id: id }),
  );
}

export async function rejectMatch(formData: FormData): Promise<void> {
  await review(formData, "rejeitada", (supabase, id) =>
    supabase.rpc("admin_reject_match", { p_candidate_id: id }),
  );
}

export async function splitListing(formData: FormData): Promise<void> {
  await review(formData, "separado", (supabase, id) =>
    supabase.rpc("admin_split_listing", { p_listing_id: id }),
  );
}

export async function signOut(): Promise<void> {
  const supabase = await createSessionClient();
  await supabase.auth.signOut({ scope: "local" });
  redirect("/entrar?aviso=saiu");
}

/**
 * Applies a decision to the id the form sent (the database refuses anyone but an admin), renders the product pages
 * it changed again, and reloads the queue with a notice.
 */
async function review(formData: FormData, done: string, decide: Decision): Promise<void> {
  const id = parseId(formData.get("id"));
  if (id === null) {
    redirect(`${ADMIN_HOME}?aviso=falhou`);
  }
  const { data, error } = await decide(await createSessionClient(), id);
  if (data === null) {
    console.error(`Review of ${id} failed: ${error?.message ?? "no result"}`);
    redirect(`${ADMIN_HOME}?aviso=falhou`);
  }
  for (const slug of data.slugs) {
    revalidatePath(`/p/${slug}`);
  }
  redirect(`${ADMIN_HOME}?aviso=${done}`);
}
