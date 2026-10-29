import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { confirmSignIn } from "./actions";

interface Props {
  searchParams: Promise<{ token_hash?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Confirmar entrada",
  robots: { index: false, follow: false },
};

/**
 * Where the magic link lands. Signing in waits for the button: some email services open every link to scan it,
 * and the link only works once.
 */
export default async function ConfirmSignInPage({ searchParams }: Props): Promise<ReactElement> {
  const { token_hash: tokenHash } = await searchParams;
  return (
    <div className="mx-auto max-w-md space-y-6">
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">Confirmar entrada</h1>
      {typeof tokenHash === "string" && tokenHash !== "" ? (
        <form action={confirmSignIn} className="space-y-3">
          <p className="text-slate-700">Carrega no botão para entrar na administração.</p>
          <input type="hidden" name="token_hash" value={tokenHash} />
          <button
            type="submit"
            className="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800"
          >
            Entrar
          </button>
        </form>
      ) : (
        <p className="text-slate-700">
          Este link está incompleto.{" "}
          <Link href="/entrar" className="font-medium text-indigo-700 underline">
            Pede outro link
          </Link>
          .
        </p>
      )}
    </div>
  );
}
