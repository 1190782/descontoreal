import {
  activeStores,
  CATEGORIES,
  chartSeries,
  formatCents,
  formatDatePt,
  formatList,
  type Highlights,
  LABEL_NAMES,
  LABEL_TONES,
  LABELS_CONFIG,
  pickHighlights,
  priceSummary,
} from "@descontoreal/core";
import { getHomeData, getProductPage, type ProductPage } from "@descontoreal/db/web";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { LabelBadge } from "@/components/label-badge";
import { PriceChart } from "@/components/price-chart";
import { ProductImage } from "@/components/product-image";
import { SearchForm } from "@/components/search-form";
import { getQuery } from "@/lib/db";
import { STORE_COLORS } from "@/lib/store-colors";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

// Built with the site and rendered again after each collection, when /api/revalidate asks.
export const revalidate = false;

const HIGHLIGHTS = 6;

const STEPS = [
  {
    title: "Guardamos o preço todos os dias",
    text: "De madrugada, lemos o preço de cada artigo em cada loja e guardamos cada mudança.",
  },
  {
    title: "Comparamos com o histórico",
    text: "Pomos o preço de hoje ao lado do preço mais baixo dos 30 dias anteriores e do preço habitual dos últimos 90 dias.",
  },
  {
    title: "Explicamos cada desconto",
    text: "Cada artigo recebe um rótulo com os números e as datas que o justificam.",
  },
];

export default async function HomePage(): Promise<ReactElement> {
  const now = new Date();
  const query = await getQuery();
  const home = await getHomeData(query, now);
  const example = home.exampleSlug === null ? null : await getProductPage(query, home.exampleSlug);
  const highlights = pickHighlights(home.highlightCandidates, HIGHLIGHTS);
  const storeNames = formatList(activeStores().map((store) => `da ${store.name}`));
  const topCategories = CATEGORIES.filter((category) => category.parent === null);

  return (
    <div className="space-y-14">
      <section className="space-y-5 pt-4 sm:pt-8">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Vê se o desconto é real
        </h1>
        <p className="max-w-2xl text-lg text-slate-700">
          Histórico de preços {storeNames}, atualizado todos os dias.
        </p>
        <SearchForm large />
      </section>

      {example === null ? null : <Example page={example} now={now} />}

      <section aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="text-2xl font-semibold text-slate-900">
          Como funciona
        </h2>
        <ol className="mt-6 grid gap-4 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="rounded-lg border border-slate-200 p-5">
              <p className="text-sm font-semibold text-indigo-700">Passo {index + 1}</p>
              <h3 className="mt-1 font-semibold text-slate-900">{step.title}</h3>
              <p className="mt-2 text-slate-700">{step.text}</p>
            </li>
          ))}
        </ol>
        <p className="mt-6">
          <Link href="/como-funciona" className="font-medium text-indigo-700 underline underline-offset-2">
            Ver as regras dos rótulos
          </Link>
        </p>
      </section>

      {highlights.items.length === 0 ? null : <HighlightList highlights={highlights} />}

      <section aria-labelledby="lojas">
        <h2 id="lojas" className="text-2xl font-semibold text-slate-900">
          Lojas seguidas
        </h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {home.stores.map((store) => (
            <li key={store.slug} className="rounded-lg border border-slate-200 p-4">
              <p className="font-semibold text-slate-900">{store.name}</p>
              <p className="text-sm text-slate-600">
                {store.lastSeenAt === null
                  ? "Ainda sem leituras."
                  : `${store.listings} artigos com preço · última leitura a ${formatDatePt(store.lastSeenAt)}`}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-2xl text-slate-700">
          Seguimos {home.productCount} produtos. Só contamos artigos vendidos pela própria loja.
        </p>
      </section>

      <section aria-labelledby="categorias">
        <h2 id="categorias" className="text-2xl font-semibold text-slate-900">
          Categorias
        </h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {topCategories.map((category) => (
            <li key={category.slug}>
              <Link
                href={`/c/${category.slug}`}
                prefetch={false}
                className="inline-block rounded-full border border-slate-300 px-4 py-1.5 text-slate-800 hover:border-indigo-700 hover:text-indigo-700"
              >
                {category.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="perguntas">
        <h2 id="perguntas" className="text-2xl font-semibold text-slate-900">
          Perguntas frequentes
        </h2>
        <dl className="mt-4 max-w-3xl space-y-5">
          <div>
            <dt className="font-semibold text-slate-900">O que é a regra dos 30 dias?</dt>
            <dd className="mt-1 text-slate-800">
              Quando anuncia uma redução de preço, a loja tem de indicar o preço mais baixo que praticou nos
              30 dias anteriores. É uma regra europeia, conhecida como diretiva Omnibus.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Como saber se um desconto é real?</dt>
            <dd className="mt-1 text-slate-800">
              Compara o preço de hoje com o preço mais baixo dos 30 dias anteriores e com o preço habitual dos
              últimos 90 dias. Fazemos essa conta todos os dias e mostramo-la num rótulo, com os números.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">
              Porque é que alguns produtos ainda não têm rótulo?
            </dt>
            <dd className="mt-1 text-slate-800">
              Os rótulos de desconto precisam de {LABELS_CONFIG.minHistoryDays} dias de preços de cada loja.
              Até lá, mostramos desde quando seguimos o preço.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">O DescontoReal é grátis?</dt>
            <dd className="mt-1 text-slate-800">
              Sim. Não tem publicidade, não pede registo e hoje não recebe nada das lojas.
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

/** A real product whose price changed, with its chart and what the numbers say. */
function Example({ page, now }: { page: ProductPage; now: Date }): ReactElement {
  const story =
    page.listings.find((listing) => listing.label?.code === "subiu_antes_de_descer")?.label ?? null;
  return (
    <section aria-labelledby="exemplo" className="rounded-xl border border-slate-200 p-5">
      <h2 id="exemplo" className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
        Um exemplo, com dados reais
      </h2>
      <p className="mt-2 text-xl font-semibold text-slate-900">
        <Link href={`/p/${page.slug}`} prefetch={false} className="hover:underline">
          {page.name}
        </Link>
      </p>
      {story === null ? null : (
        <div className="mt-2 space-y-1">
          <LabelBadge tone={story.tone} name={story.name} />
          <p className="text-slate-800">{story.text}</p>
        </div>
      )}
      <div className="mt-4">
        <PriceChart series={chartSeries(page.listings, now)} now={now.getTime()} colors={STORE_COLORS} />
      </div>
      <p className="mt-3 text-slate-800">{priceSummary(page.listings, now)}</p>
    </section>
  );
}

function HighlightList({ highlights }: { highlights: Highlights }): ReactElement {
  return (
    <section aria-labelledby="destaques">
      <h2 id="destaques" className="text-2xl font-semibold text-slate-900">
        {highlights.kind === "labels" ? "Descontos reais de hoje" : "Maiores descidas face ao preço habitual"}
      </h2>
      {highlights.kind === "labels" ? null : (
        <p className="mt-2 max-w-3xl text-slate-700">
          Ainda não há {LABELS_CONFIG.minHistoryDays} dias de preços para dar rótulos de desconto. Estas são
          as ofertas de hoje mais abaixo do preço habitual de cada loja desde que a seguimos.
        </p>
      )}
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {highlights.items.map((item) => (
          <li key={item.productSlug} className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4">
            <Link
              href={`/p/${item.productSlug}`}
              prefetch={false}
              className="flex items-start gap-3 hover:underline"
            >
              <ProductImage src={item.imageUrl} alt="" size={72} />
              <h3 className="leading-snug font-semibold text-slate-900">{item.productName}</h3>
            </Link>
            <p>
              <span className="text-xl font-bold text-slate-900">{formatCents(item.priceCents)}</span>{" "}
              <span className="text-sm text-slate-600">na {item.storeName}</span>
            </p>
            {highlights.kind === "labels" ? (
              <LabelBadge tone={LABEL_TONES[item.label]} name={LABEL_NAMES[item.label]} />
            ) : null}
            <p className="text-sm text-slate-800">{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
