import { activeStores, BOT_POLICY, BOT_USER_AGENT, formatList, SITE } from "@descontoreal/core";
import type { Metadata } from "next";
import type { ReactElement } from "react";

export const metadata: Metadata = {
  title: "DescontoRealBot: quem recolhe os preços",
  description:
    "Quem é o DescontoRealBot, que páginas lê, a que ritmo e como pedir para mudar ou parar a recolha.",
  alternates: { canonical: "/bot" },
};

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60_000;

function hourText(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}

export default function BotPage(): ReactElement {
  const stores = formatList(activeStores().map((store) => store.name));
  const runHour = BOT_POLICY.dailyRunHourUtc;
  return (
    <article className="prose">
      <h1>DescontoRealBot</h1>
      <p className="lead">
        O DescontoRealBot recolhe os preços que o {SITE.name} mostra. Esta página explica quem somos, que
        páginas o bot lê, a que ritmo, e como pedir para mudar ou parar a recolha.
      </p>

      <h2>Como o reconhecer</h2>
      <p>Todos os pedidos levam este User-Agent:</p>
      <p>
        <code>{BOT_USER_AGENT}</code>
      </p>
      <p>
        Os pedidos partem de servidores do GitHub Actions, por isso o endereço IP muda de um dia para o outro.
        O User-Agent é a forma fiável de nos reconhecer.
      </p>

      <h2>O que lê</h2>
      <ul>
        <li>
          As páginas de listagem das categorias de eletrónica e eletrodomésticos e, conforme a loja, as
          páginas dos produtos.
        </li>
        <li>
          Só factos públicos de cada artigo: nome, preço, preço riscado, disponibilidade, EAN, marca, modelo,
          características técnicas e o endereço da imagem.
        </li>
        <li>
          Nunca descrições, opiniões de clientes nem dados pessoais. Os artigos de outros vendedores
          (marketplace) ficam de fora.
        </li>
      </ul>

      <h2>A que ritmo</h2>
      <ul>
        <li>
          Um pedido de cada vez por loja, com uma pausa aleatória de {BOT_POLICY.minDelayMs / MS_PER_SECOND} a{" "}
          {BOT_POLICY.maxDelayMs / MS_PER_SECOND} segundos entre pedidos.
        </li>
        <li>Se o robots.txt da loja pedir uma pausa maior (Crawl-delay), o bot usa essa.</li>
        <li>
          Uma recolha por dia, que começa às {hourText(runHour)} UTC ({hourText(runHour)} em Lisboa no
          inverno, {hourText(runHour + 1)} no verão), quando os sites têm menos visitas.
        </li>
      </ul>

      <h2>Regras que cumpre</h2>
      <ul>
        <li>Respeita o robots.txt de cada loja.</li>
        <li>
          Para a recolha desse dia ao primeiro sinal de bloqueio: respostas 403 ou 429 repetidas, uma
          verificação anti-bot, ou um pedido para esperar mais de {BOT_POLICY.maxRetryAfterMs / MS_PER_MINUTE}{" "}
          minutos.
        </li>
        <li>Nunca usa proxies, outro User-Agent, browsers automatizados nem rotação de endereços IP.</li>
      </ul>

      <h2>Lojas recolhidas</h2>
      <p>Hoje: {stores}.</p>

      <h2>Contacto</h2>
      <p>
        Para pedir que deixemos de recolher um site, ou que mudemos o ritmo, basta escrever para{" "}
        <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>. Cumprimos o pedido.
      </p>
      <p>
        Se a loja tiver um feed de produtos, por exemplo num programa de afiliados, podemos usá-lo em vez de
        visitar as páginas.
      </p>
    </article>
  );
}
