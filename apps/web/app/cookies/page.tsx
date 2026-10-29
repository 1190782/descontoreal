import { formatDatePt, SITE } from "@descontoreal/core";
import type { Metadata } from "next";
import type { ReactElement } from "react";
import { LEGAL_UPDATED_AT } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Cookies",
  description: `Que cookies o ${SITE.name} usa: nenhum de publicidade nem de análise.`,
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage(): ReactElement {
  return (
    <article className="prose">
      <h1>Cookies</h1>
      <p className="lead">Última atualização: {formatDatePt(LEGAL_UPDATED_AT)}.</p>

      <h2>O que usamos</h2>
      <ul>
        <li>As páginas do site não criam cookies.</li>
        <li>Não usamos cookies de publicidade nem de análise de tráfego.</li>
        <li>
          A Cloudflare, que protege o site, pode criar um cookie técnico (por exemplo,{" "}
          <code>cf_clearance</code>) quando um pedido tem de passar por uma verificação contra abusos. É
          estritamente necessário e não serve para publicidade.
        </li>
      </ul>

      <h2>Lojas</h2>
      <p>
        Ao seguir uma ligação para uma loja, passa a valer a política de cookies dessa loja. Os cookies que a
        loja cria ficam no domínio da loja, não no nosso.
      </p>
      <h2>Armazenamento no browser</h2>
      <ul>
        <li>
          Para só sugerir a instalação da aplicação a partir da segunda visita, o site conta as visitas no
          próprio browser (localStorage), e guarda aí a escolha &ldquo;Agora não&rdquo;. Estes dados nunca
          saem do dispositivo e apagam-se nas definições do browser.
        </li>
        <li>
          O service worker guarda no browser os ficheiros do site e uma página para quando não há ligação.
          Nunca guarda preços nem dados pessoais.
        </li>
      </ul>

    </article>
  );
}
