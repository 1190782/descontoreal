import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

export const metadata: Metadata = {
  title: "Página não encontrada",
};

export default function NotFound(): ReactElement {
  return (
    <div className="prose">
      <h1>Página não encontrada</h1>
      <p>O endereço pode estar errado, ou a página pode ter mudado de sítio.</p>
      <p>
        <Link href="/">Voltar ao início</Link> · <Link href="/como-funciona">Como funciona</Link>
      </p>
    </div>
  );
}
