import type { Metadata } from "next";
import type { ReactElement } from "react";
import { noticeText } from "@/lib/admin";
import { sendSignInLink } from "./actions";

interface Props {
  searchParams: Promise<{ aviso?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Entrar",
  robots: { index: false, follow: false },
};

const NOTICES = {
  enviado: "Se este email tiver acesso, enviámos para lá um link para entrar. O link só funciona uma vez.",
  "email-invalido": "Escreve um endereço de email válido.",
  limite: "Foram pedidos demasiados links. Tenta outra vez daqui a uma hora.",
  falhou: "Não foi possível enviar o link. Tenta outra vez daqui a alguns minutos.",
  link: "Não foi possível entrar com este link: pode ter expirado ou já ter sido usado. Pede outro.",
  "sem-acesso": "Esta conta não tem acesso à administração.",
  saiu: "Saíste da administração.",
};

/** Sign-in for the admin pages, by magic link. */
export default async function SignInPage({ searchParams }: Props): Promise<ReactElement> {
  const { aviso } = await searchParams;
  const notice = noticeText(aviso, NOTICES);
  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Entrar</h1>
        <p className="text-slate-700">Só para a administração do site: não há contas abertas ao público.</p>
      </div>
      {notice === null ? null : (
        <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-800">
          {notice}
        </p>
      )}
      <form action={sendSignInLink} className="space-y-3">
        <label htmlFor="email" className="block font-medium text-slate-900">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900"
        />
        <button
          type="submit"
          className="rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800"
        >
          Enviar link para entrar
        </button>
      </form>
    </div>
  );
}
