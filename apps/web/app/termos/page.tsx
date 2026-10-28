import { formatDatePt, SITE } from "@descontoreal/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { DATA_CONTROLLER, LEGAL_UPDATED_AT } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Termos de utilização",
  description: `As condições de utilização do ${SITE.name}: o que o site oferece, os seus limites e as suas responsabilidades.`,
  alternates: { canonical: "/termos" },
};

export default function TermsPage(): ReactElement {
  return (
    <article className="prose">
      <h1>Termos de utilização</h1>
      <p className="lead">Última atualização: {formatDatePt(LEGAL_UPDATED_AT)}.</p>

      <h2>O que é o {SITE.name}</h2>
      <p>
        Um serviço gratuito de informação, mantido por {DATA_CONTROLLER}: guarda o histórico de preços de
        lojas portuguesas e descreve cada desconto com regras públicas, explicadas em{" "}
        <Link href="/como-funciona">Como funciona</Link>.
      </p>

      <h2>Os preços podem já ter mudado</h2>
      <p>
        Lemos os preços uma vez por dia e as lojas podem mudá-los a qualquer momento. O preço que conta é
        sempre o que a loja mostra no momento da compra: confirme-o na loja antes de comprar.
      </p>

      <h2>O que os rótulos são</h2>
      <p>
        Os rótulos descrevem números e datas do histórico que recolhemos. Não são acusações às lojas nem
        pareceres jurídicos. Podem conter erros, por exemplo quando um artigo fica associado ao produto
        errado. Se encontrar um erro, escreva para{" "}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
      </p>

      <h2>Sem garantias</h2>
      <p>
        O site é fornecido tal como está, sem garantia de estar sempre disponível, completo ou sem erros. Na
        medida permitida por lei, não respondemos por decisões de compra tomadas com base no site.
      </p>

      <h2>Marcas, imagens e ligações</h2>
      <ul>
        <li>Os nomes dos produtos, as marcas e as imagens pertencem aos respetivos titulares.</li>
        <li>
          As ligações para as lojas levam a sites de terceiros, com termos próprios. Hoje não são ligações de
          afiliação (ver <Link href="/afiliacao">Afiliação</Link>).
        </li>
      </ul>

      <h2>Uso do site</h2>
      <p>
        Pode usar a informação do site para uso pessoal. Não é permitido sobrecarregar o site com pedidos
        automáticos.
      </p>

      <h2>Lei aplicável e alterações</h2>
      <p>
        Estes termos regem-se pela lei portuguesa. Podemos alterá-los; a data no topo indica a última
        alteração.
      </p>
    </article>
  );
}
