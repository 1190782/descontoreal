import { formatDatePt, SITE } from "@descontoreal/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { DATA_CONTROLLER, LEGAL_UPDATED_AT } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Política de privacidade",
  description: `Que dados pessoais o ${SITE.name} trata, para quê, durante quanto tempo e como exercer os seus direitos.`,
  alternates: { canonical: "/privacidade" },
};

export default function PrivacyPage(): ReactElement {
  const email = <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>;
  return (
    <article className="prose">
      <h1>Política de privacidade</h1>
      <p className="lead">Última atualização: {formatDatePt(LEGAL_UPDATED_AT)}.</p>

      <h2>Quem é responsável</h2>
      <p>
        O {SITE.name} é um projeto pessoal de {DATA_CONTROLLER}, responsável pelo tratamento dos dados
        descritos nesta página. Contacto: {email}.
      </p>

      <h2>Que dados tratamos</h2>
      <ul>
        <li>
          <strong>Visitas ao site.</strong> Para entregar as páginas e proteger o site contra abusos, a
          Cloudflare, que aloja o site, trata o endereço IP, a data e a hora, o endereço pedido, o browser e o
          país de cada pedido. Os registos técnicos do site, usados para encontrar erros, ficam guardados no
          máximo 7 dias.
        </li>
        <li>
          <strong>Mensagens.</strong> Quem escreve para {email} dá-nos o seu endereço de email e o conteúdo da
          mensagem. A Cloudflare reencaminha as mensagens para a caixa de correio pessoal do responsável, onde
          ficam enquanto forem precisas para tratar o assunto.
        </li>
      </ul>
      <p>
        O site não tem contas abertas ao público, não mostra publicidade e não usa cookies de publicidade nem
        de análise (ver <Link href="/cookies">Cookies</Link>).
      </p>

      <p>
        No teu browser, o site guarda só o número de visitas e a escolha sobre a sugestão de instalar a
        aplicação, que nunca nos chegam (ver <Link href="/cookies">Cookies</Link>).
      </p>
      <h2>Para quê e com que fundamento</h2>
      <ul>
        <li>
          Entregar o site e mantê-lo seguro: interesse legítimo em ter um serviço que funcione e não seja
          abusado (artigo 6.º, n.º 1, alínea f) do RGPD).
        </li>
        <li>Responder a mensagens: interesse legítimo em responder a quem nos contacta (a mesma alínea).</li>
      </ul>

      <h2>Quem trata os dados por nós</h2>
      <ul>
        <li>
          Cloudflare, Inc.: alojamento do site, entrega das páginas, registos técnicos e reencaminhamento de
          email.
        </li>
        <li>
          Supabase, Inc.: base de dados dos preços, alojada na União Europeia (Paris). Não guarda dados de
          quem visita o site.
        </li>
      </ul>
      <p>
        A Cloudflare tem uma rede mundial, por isso um pedido pode ser tratado num centro de dados fora da
        União Europeia. Nesses casos aplicam-se as garantias dos acordos de tratamento de dados destes
        fornecedores, como as cláusulas contratuais-tipo aprovadas pela Comissão Europeia.
      </p>

      <h2>Os seus direitos</h2>
      <p>
        Pode pedir o acesso, a retificação, o apagamento ou a limitação dos seus dados, e opor-se ao
        tratamento, escrevendo para {email}. Pode também apresentar reclamação à Comissão Nacional de Proteção
        de Dados (CNPD), em <a href="https://www.cnpd.pt">www.cnpd.pt</a>.
      </p>

      <h2>Alterações</h2>
      <p>
        Atualizamos esta página quando o site mudar, por exemplo quando abrirem as contas para seguir
        produtos. A data no topo indica a última alteração.
      </p>
    </article>
  );
}
