import {
  chartSeries,
  formatCents,
  formatDatePt,
  priceSummary,
  productDescription,
  productFaq,
  productJsonLd,
  productTitle,
  SITE,
} from "@descontoreal/core";
import { getProductPage, listProducts, type ProductPage } from "@descontoreal/db/web";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Fragment, type ReactElement } from "react";
import { Breadcrumbs, type Crumb } from "@/components/breadcrumbs";
import { JsonLdScript } from "@/components/json-ld-script";
import { LabelBadge } from "@/components/label-badge";
import { PriceChart } from "@/components/price-chart";
import { ProductGrid } from "@/components/product-card";
import { ProductImage } from "@/components/product-image";
import { getQuery } from "@/lib/db";
import { type ListingStatus, productView } from "@/lib/product-view";
import { STORE_COLORS } from "@/lib/store-colors";

interface Params {
  params: Promise<{ slug: string }>;
}

// Rendered on the first visit and kept until /api/revalidate asks for a new render.
export const revalidate = false;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

const STATUS_TEXT: Readonly<Record<ListingStatus, string>> = {
  "on-sale": "Em stock",
  "out-of-stock": "Esgotado",
  unconfirmed: "Por confirmar na última leitura",
  gone: "Já não aparece na loja",
};

const loadPage = cache(
  async (slug: string): Promise<ProductPage | null> => await getProductPage(await getQuery(), slug),
);

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (page === null) {
    return { title: "Produto não encontrado" };
  }
  const now = new Date();
  const view = productView(page, now);
  const title = productTitle(page.name);
  const description = productDescription({
    name: page.name,
    best: view.best,
    lowest: view.summaryLowest,
    trackedSince: view.since,
    storeNames: view.storeNames,
    now,
  });
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: `/p/${page.slug}` },
    robots: view.indexable ? undefined : { index: false, follow: true },
    openGraph: {
      type: "website",
      url: `/p/${page.slug}`,
      title,
      description,
      images: page.imageUrl === null ? undefined : [page.imageUrl],
    },
  };
}

export default async function ProductRoute({ params }: Params): Promise<ReactElement> {
  const { slug } = await params;
  const page = await loadPage(slug);
  if (page === null) {
    notFound();
  }
  const now = new Date();
  const view = productView(page, now);
  const bestLabel = view.bestListing?.label ?? null;
  const summary = priceSummary(page.listings, now);
  const faq = productFaq(page.name, page.listings, now);
  const related =
    page.category === null
      ? null
      : await listProducts(await getQuery(), {
          categories: [page.category.slug],
          excludeProductId: page.id,
          sort: "desconto",
          offset: 0,
          limit: 6,
          now,
        });
  const crumbs: Crumb[] = [
    ...(page.category?.parent === null || page.category?.parent === undefined
      ? []
      : [{ name: page.category.parent.name, path: `/c/${page.category.parent.slug}` }]),
    ...(page.category === null ? [] : [{ name: page.category.name, path: `/c/${page.category.slug}` }]),
    { name: page.name, path: `/p/${page.slug}` },
  ];
  const facts = [
    page.brand === null || page.brandNorm === null
      ? null
      : {
          key: "marca",
          node: (
            <Link href={`/marca/${page.brandNorm}`} prefetch={false} className="hover:underline">
              {page.brand}
            </Link>
          ),
        },
    page.model === null ? null : { key: "modelo", node: page.model },
    page.ean === null ? null : { key: "ean", node: `EAN ${page.ean}` },
  ].filter((fact) => fact !== null);
  const jsonLd = productJsonLd({
    name: page.name,
    url: `${SITE.url}/p/${page.slug}`,
    imageUrl: page.imageUrl,
    brand: page.brand,
    ean: page.ean,
    offers: view.offers,
  });

  return (
    <article className="space-y-8 sm:space-y-10">
      <div>
        <Breadcrumbs items={crumbs} />
        <header className="flex items-start gap-4">
          <ProductImage src={page.imageUrl} alt={page.name} size={72} eager />
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{page.name}</h1>
            <p className="mt-1 text-sm text-slate-600">
              {facts.map((fact, index) => (
                <Fragment key={fact.key}>
                  {index > 0 ? " · " : null}
                  {fact.node}
                </Fragment>
              ))}
            </p>
          </div>
        </header>
      </div>

      <section aria-labelledby="hoje" className="rounded-xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
        <h2 id="hoje" className="text-sm font-semibold tracking-wide text-slate-600 uppercase">
          Mais barato hoje
        </h2>
        {view.best === null ? (
          <p className="mt-2 text-lg text-slate-800">
            Hoje não está à venda em nenhuma das lojas que seguimos.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            <p>
              <span className="text-3xl font-bold text-slate-900 sm:text-4xl">
                {formatCents(view.best.priceCents)}
              </span>{" "}
              <span className="text-lg text-slate-700">na {view.best.storeName}</span>
            </p>
            {bestLabel === null ? (
              <p className="text-slate-600">
                Rótulo em atualização: é recalculado depois da recolha de hoje.
              </p>
            ) : (
              <div className="space-y-1">
                <LabelBadge tone={bestLabel.tone} name={bestLabel.name} />
                <p className="text-slate-800">{bestLabel.text}</p>
              </div>
            )}
            {view.bestListing === undefined ? null : (
              <a
                href={view.bestListing.url}
                rel="nofollow noopener"
                className="inline-block rounded-lg bg-indigo-700 px-4 py-2 font-semibold text-white hover:bg-indigo-800"
              >
                Ver na {view.best.storeName}
              </a>
            )}
          </div>
        )}
        <p className="mt-4 text-sm text-slate-600">
          <Link href="/como-funciona" className="underline underline-offset-2">
            Como lemos os preços e escolhemos os rótulos
          </Link>
        </p>
      </section>

      <section aria-labelledby="historico">
        <h2 id="historico" className="mb-3 text-xl font-semibold text-slate-900">
          Histórico de preço
        </h2>
        <PriceChart series={chartSeries(page.listings, now)} now={now.getTime()} colors={STORE_COLORS} />
        {summary === null ? null : <p className="mt-3 text-slate-800">{summary}</p>}
      </section>

      <section aria-labelledby="lojas">
        <h2 id="lojas" className="mb-3 text-xl font-semibold text-slate-900">
          Preço em cada loja
        </h2>
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200">
          {view.rows.map(({ listing, current, status }) => (
            <li key={listing.listingId} className="flex flex-wrap items-start justify-between gap-3 p-4">
              <div className="space-y-1">
                <p className="font-semibold text-slate-900">{listing.storeName}</p>
                <p className="text-sm text-slate-600">
                  {STATUS_TEXT[status]} · lido a {formatDatePt(listing.lastSeenAt)}
                </p>
                {status === "gone" ? null : listing.label === null ? (
                  <p className="text-sm text-slate-600">Rótulo em atualização.</p>
                ) : (
                  <div className="space-y-1">
                    <LabelBadge tone={listing.label.tone} name={listing.label.name} />
                    <p className="text-sm text-slate-800">{listing.label.text}</p>
                    {listing.label.warnings.map((warning) => (
                      <p key={warning.code} className="text-sm text-amber-900">
                        {warning.text}
                      </p>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right">
                {current === undefined ? null : (
                  <p>
                    {current.referencePriceCents === null ||
                    current.referencePriceCents <= current.priceCents ? null : (
                      <span className="mr-2 text-sm text-slate-500 line-through">
                        {formatCents(current.referencePriceCents)}
                      </span>
                    )}
                    <span className="text-xl font-bold text-slate-900">
                      {formatCents(current.priceCents)}
                    </span>
                  </p>
                )}
                <a
                  href={listing.url}
                  rel="nofollow noopener"
                  className="text-sm font-medium text-indigo-700 underline underline-offset-2"
                >
                  Ver na {listing.storeName}
                </a>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {view.lowest.length === 0 ? null : (
        <section aria-labelledby="minimos">
          <h2 id="minimos" className="mb-3 text-xl font-semibold text-slate-900">
            Preços mais baixos
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {view.lowest.map((row) => (
              <div key={row.label} className="rounded-lg border border-slate-200 p-4">
                <dt className="text-sm text-slate-600">{row.label}</dt>
                <dd className="text-lg font-semibold text-slate-900">
                  {formatCents(row.lowest.priceCents)}{" "}
                  <span className="text-sm font-normal text-slate-600">
                    na {row.lowest.storeName}, desde {formatDatePt(row.lowest.since)}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {Object.keys(page.specs).length === 0 ? null : (
        <section aria-labelledby="caracteristicas">
          <h2 id="caracteristicas" className="mb-3 text-xl font-semibold text-slate-900">
            Características
          </h2>
          <dl className="divide-y divide-slate-200 rounded-lg border border-slate-200">
            {Object.entries(page.specs).map(([name, value]) => (
              <div key={name} className="grid grid-cols-2 gap-4 px-4 py-2 text-sm">
                <dt className="text-slate-600">{name}</dt>
                <dd className="text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <section aria-labelledby="perguntas">
        <h2 id="perguntas" className="mb-3 text-xl font-semibold text-slate-900">
          Perguntas frequentes
        </h2>
        <dl className="space-y-4">
          {faq.map((entry) => (
            <div key={entry.question}>
              <dt className="font-semibold text-slate-900">{entry.question}</dt>
              <dd className="mt-1 text-slate-800">{entry.answer}</dd>
            </div>
          ))}
        </dl>
      </section>

      {related === null || related.items.length === 0 ? null : (
        <section aria-labelledby="relacionados">
          <h2 id="relacionados" className="mb-3 text-xl font-semibold text-slate-900">
            Outros produtos da categoria
          </h2>
          <ProductGrid cards={related.items} />
        </section>
      )}

      {jsonLd === null ? null : <JsonLdScript data={jsonLd} />}
    </article>
  );
}
