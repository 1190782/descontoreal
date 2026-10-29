"use server";

import { redirect } from "next/navigation";
import { ADMIN_HOME } from "@/lib/admin";
import { createSessionClient } from "@/lib/supabase";

/** Trades the magic link's token for a session, kept in cookies that only /admin receives. */
export async function confirmSignIn(formData: FormData): Promise<void> {
  const tokenHash = formData.get("token_hash");
  if (typeof tokenHash !== "string" || tokenHash === "") {
    redirect("/entrar?aviso=link");
  }
  const supabase = await createSessionClient();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash: tokenHash });
  redirect(error === null ? ADMIN_HOME : "/entrar?aviso=link");
}
