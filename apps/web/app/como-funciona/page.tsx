import {
  activeStores,
  formatList,
  LABEL_NAMES,
  LABEL_TONES,
  type LabelCode,
  LABELS_CONFIG,
  type LabelTone,
  SITE,
  WARNING_NAMES,
  type WarningCode,
} from "@descontoreal/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

export const metadata: Metadata = {
  title: "Como funciona: regras dos rótulos de desconto",
  description:
    "De onde vêm os preços, o que comparamos e as regras públicas de cada rótulo de desconto, com os limiares que usamos.",
  alternates: { canonical: "/como-funciona" },
};

interface Rule<Code> {
  code: Code;
  when: string;
  reads: string;
}

/** 0,95 or 1,05 → 5: how far from 100% a factor of LABELS_CONFIG is. */
function percentOf(factor: number): number {
  return Math.round(Math.abs(factor - 1) * 100);
}

const config = LABELS_CONFIG;
const insufficient = `Menos de ${config.minHistoryDays} dias de dados nesta loja.`;
const allTimeLow = `Pelo menos ${config.allTimeLowMinHistoryDays} dias de dados, e P abaixo de todos os preços anteriores.`;
const allTimeLowReads = "O preço mais baixo desde que seguimos este produto ({n} dias).";

const WITH_DISCOUNT: Rule<LabelCode>[] = [
  {
    code: "historico_insuficiente",
    when: insufficient,
    reads: "Seguimos este preço desde {data}. Ainda não há dados para avaliar o desconto.",
  },
  { code: "minimo_historico", when: allTimeLow, reads: allTimeLowReads },
  {
    code: "desconto_real",
    when: `P pelo menos ${percentOf(config.realDiscountFactor)}% abaixo do M30 e do Med90.`,
    reads: "{x}% abaixo do preço mais baixo dos 30 dias anteriores e do preço habitual dos últimos 90 dias.",
  },
  {
    code: "subiu_antes_de_descer",
    when:
      `P entre ${percentOf(config.raisedNearUsualFactor)}% abaixo e ${percentOf(config.aboveUsualFactor)}% ` +
      "acima do Med90, abaixo do Máx90 e do preço anterior, e o Máx90 pelo menos " +
      `${percentOf(config.raisedPeakFactor)}% acima do Med90.`,
    reads: "O preço subiu para {Máx90} a {data} e desceu agora para {P}, perto do preço habitual.",
  },
  {
    code: "desconto_pequeno",
    when: `P abaixo do M30 e do Med90, sem chegar aos ${percentOf(config.realDiscountFactor)}%.`,
    reads: "Só {x}% abaixo do preço mais baixo dos 30 dias anteriores.",
  },
  {
    code: "sem_desconto_real",
    when: "Nenhuma das anteriores.",
    reads:
      "Sem descida relevante face ao preço mais baixo dos 30 dias anteriores ({M30}) e ao preço habitual ({Med90}).",
  },
];

const WITHOUT_DISCOUNT: Rule<LabelCode>[] = [
  { code: "historico_insuficiente", when: insufficient, reads: "Seguimos este preço desde {data}." },
  { code: "minimo_historico", when: allTimeLow, reads: allTimeLowReads },
  {
    code: "bom_preco",
    when: `P pelo menos ${percentOf(config.goodPriceFactor)}% abaixo do Med90.`,
    reads: "{x}% abaixo do preço habitual dos últimos 90 dias.",
  },
  {
    code: "acima_do_habitual",
    when: `P pelo menos ${percentOf(config.aboveUsualFactor)}% acima do Med90.`,
    reads: "{x}% acima do preço habitual dos últimos 90 dias.",
  },
  {
    code: "preco_habitual",
    when: "Nenhuma das anteriores.",
    reads: "Perto do preço habitual dos últimos 90 dias.",
  },
];

const WARNINGS: Rule<WarningCode>[] = [
  {
    code: "desconto_anunciado_exagerado",
    when:
      "A percentagem anunciada, (R − P) / R, passa a real, (M30 − P) / M30, em mais de " +
      `${config.exaggeratedDiscountPoints} pontos.`,
    reads: "Anunciado −{a}% · Face aos 30 dias anteriores: −{b}%",
  },
  {
    code: "mais_barato_noutra_loja",
    when:
      `Outra loja tem o mesmo produto pelo menos ${percentOf(config.cheaperElsewhereFactor)}% mais barato, ` +
      "em stock e com o preço lido hoje ou ontem.",
    reads: "{Loja} tem este produto a {preço}.",
  },
  {
    code: "esgotado",
    when: "A loja indica que o artigo não está disponível.",
    reads: "Indisponível nesta loja.",
  },
];

const TONE_COLOURS: Record<LabelTone, string> = {
  positive: "Verde",
  caution: "Âmbar",
  neutral: "Cinzento",
};

/** One card per rule; an ordered list when the first rule that applies wins. */
function RuleList({
  rules,
  names,
  ordered,
}: {
  rules: Rule<string>[];
  names: Readonly<Record<string, string>>;
  ordered: boolean;
}): ReactElement {
  const items = rules.map((rule, index) => (
    <li key={rule.code} className="rounded-lg border border-slate-200 p-4">
      <p className="font-semibold text-slate-900">
        {ordered ? `${index + 1}. ` : ""}
        {names[rule.code]}
      </p>
      <p>
        <span className="font-medium text-slate-900">Quando:</span> {rule.when}
      </p>
      <p>
        <span className="font-medium text-slate-900">O que se lê:</span> «{rule.reads}»
      </p>
    </li>
  ));
  return ordered ? <ol className="rules">{items}</ol> : <ul className="rules">{items}</ul>;
}

export default function HowItWorksPage(): ReactElement {
  const stores = activeStores().map((store) => store.name);
  const tones = (Object.keys(TONE_COLOURS) as LabelTone[]).map((tone) => ({
    tone,
    names: (Object.keys(LABEL_TONES) as LabelCode[])
      .filter((code) => LABEL_TONES[code] === tone)
      .map((code) => LABEL_NAMES[code]),
  }));
  return (
    <article className="prose">
      <h1>Como funciona</h1>
      <p className="lead">
        O {SITE.name} guarda todos os dias o preço de cada artigo de eletrónica e eletrodomésticos vendido{" "}
        {formatList(stores.map((name) => `pela ${name}`))}, mostra o histórico em cada loja e dá a cada
        desconto um rótulo com regras públicas. As regras e os limiares estão todos nesta página.
      </p>

      <h2>De onde vêm os preços</h2>
      <ul>
        <li>
          Lemos os preços uma vez por dia, de madrugada, nos sites das lojas (ver{" "}
          <Link href="/bot">o nosso bot</Link>
          ).
        </li>
        <li>Só contamos artigos vendidos pela própria loja, nunca por outros vendedores.</li>
        <li>
          São os preços da loja online, com IVA, tal como a loja os mostra. Nas lojas físicas podem ser
          diferentes.
        </li>
        <li>Ignoramos vales, descontos em talão, códigos promocionais, ofertas e reembolsos.</li>
        <li>Guardamos só as mudanças: cada preço tem uma data de início e uma data de fim.</li>
      </ul>

      <h2>O que comparamos</h2>
      <p>Cada artigo é avaliado em cada loja, com o histórico dessa loja.</p>
      <dl>
        <dt>P</dt>
        <dd>O preço atual.</dd>
        <dt>Início do preço atual</dt>
        <dd>
          O dia em que o preço passou a ser P. Uma mudança só da disponibilidade ou do preço riscado não conta
          como mudança de preço.
        </dd>
        <dt>R</dt>
        <dd>O preço riscado que a loja anuncia, quando está acima de P.</dd>
        <dt>M30</dt>
        <dd>
          O preço mais baixo nos 30 dias antes do início do preço atual, sem contar com P. É a referência que
          a regra europeia dos 30 dias (diretiva Omnibus) pede às lojas quando anunciam uma redução de preço.
        </dd>
        <dt>Med90, o preço habitual</dt>
        <dd>
          A mediana dos preços nos 90 dias antes do início do preço atual, em que cada preço conta pelo tempo
          que esteve em vigor. Com menos de 90 dias de histórico, usamos o histórico que existe, e o texto diz
          «preço habitual desde {"{data}"}».
        </dd>
        <dt>Máx90</dt>
        <dd>O preço mais alto nos 90 dias antes do início do preço atual.</dd>
        <dt>Dias de dados</dt>
        <dd>Dias de calendário, na hora de Lisboa, desde a primeira vez que vimos o preço nessa loja.</dd>
      </dl>

      <h2>Rótulos quando a loja anuncia um desconto</h2>
      <p>Há desconto anunciado quando a loja mostra um preço riscado. Vale a primeira regra que se aplica.</p>
      <RuleList rules={WITH_DISCOUNT} names={LABEL_NAMES} ordered />

      <h2>Rótulos quando não há desconto anunciado</h2>
      <p>Vale a primeira regra que se aplica.</p>
      <RuleList rules={WITHOUT_DISCOUNT} names={LABEL_NAMES} ordered />
      <p>
        A comparação com o preço habitual apanha o que a regra dos 30 dias sozinha não apanha: subir o preço
        mais de 30 dias antes de uma promoção, para que o mínimo dos 30 dias já seja o preço subido.
      </p>

      <h2>Avisos</h2>
      <p>Qualquer rótulo pode vir acompanhado de um ou mais avisos.</p>
      <RuleList rules={WARNINGS} names={WARNING_NAMES} ordered={false} />

      <h2>Cores</h2>
      <p>Cada rótulo tem sempre texto, além da cor.</p>
      <ul>
        {tones.map(({ tone, names }) => (
          <li key={tone}>
            {TONE_COLOURS[tone]}: {formatList(names)}.
          </li>
        ))}
      </ul>

      <h2>O preço recomendado (PVPr)</h2>
      <p>
        Algumas lojas mostram o preço de venda recomendado pelo fabricante. Guardamo-lo à parte, só como
        informação: nunca conta como preço riscado nem como desconto anunciado.
      </p>

      <h2>Neutralidade</h2>
      <p>
        Os rótulos e a ordenação nunca dependem de a loja ter ou não um programa de afiliação connosco. Hoje o{" "}
        {SITE.name} não tem ligações de afiliação (ver <Link href="/afiliacao">Afiliação</Link>).
      </p>

      <h2>Limites</h2>
      <ul>
        <li>
          O histórico começa no dia em que começámos a seguir cada artigo. As comparações com 30 e 90 dias só
          ficam completas ao fim desse tempo.
        </li>
        <li>
          Ligamos o mesmo produto em lojas diferentes pelo código EAN. Sem EAN, usamos a marca e o modelo, e
          os casos duvidosos são revistos à mão. Pode haver erros: se encontrar um, escreva para{" "}
          <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>.
        </li>
        <li>Os rótulos descrevem números e datas. Não são acusações às lojas nem pareceres jurídicos.</li>
      </ul>

      <h2>Lojas seguidas</h2>
      <p>Hoje lemos todos os dias {formatList(stores.map((name) => `a ${name}`))}.</p>
    </article>
  );
}
