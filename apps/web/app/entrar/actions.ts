"use server";

import { redirect } from "next/navigation";
import { parseEmail, signInLinkNotice } from "@/lib/admin";
import { createMailClient } from "@/lib/supabase";

/** Emails a magic link to an existing account; Supabase's Magic Link template points it at /auth/confirm. */
export async function sendSignInLink(formData: FormData): Promise<void> {
  const email = parseEmail(formData.get("email"));
  if (email === null) {
    redirect("/entrar?aviso=email-invalido");
  }
  const { error } = await createMailClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  const notice = signInLinkNotice(error);
  if (notice === "falhou") {
    // Never the message: it can hold the address.
    console.error(`signInWithOtp failed: ${error?.code ?? "no code"}, HTTP ${error?.status ?? "none"}`);
  }
  redirect(`/entrar?aviso=${notice}`);
}
