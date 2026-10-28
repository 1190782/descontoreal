import { SITE } from "@descontoreal/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

export const metadata: Metadata = {
  title: "Afiliação",
  description: `Se o ${SITE.name} recebe dinheiro das lojas, e porque é que os rótulos nunca dependem disso.`,
  alternates: { canonical: "/afiliacao" },
};

export default function AffiliationPage(): ReactElement {
  return (
    <article className="prose">
      <h1>Afiliação</h1>
      <p className="lead">
        Hoje o {SITE.name} não tem ligações de afiliação. As ligações para as lojas são ligações normais: não
        recebemos nada quando alguém compra.
      </p>

      <h2>Se isso mudar</h2>
      <p>
        Para cobrir os custos do site, podemos vir a aderir aos programas de afiliação das lojas. Se isso
        acontecer, vamos indicá-lo junto às ligações para as lojas e nesta página.
      </p>

      <h2>Os rótulos não dependem disso</h2>
      <p>
        Os rótulos e a ordenação nunca dependem de a loja ter ou não um programa de afiliação connosco. As
        regras são públicas e estão em <Link href="/como-funciona">Como funciona</Link>.
      </p>
    </article>
  );
}
