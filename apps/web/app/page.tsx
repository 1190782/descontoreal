import { activeStores, LABELS_CONFIG } from "@descontoreal/core";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";
import { formatList } from "@/lib/text";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

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

export default function HomePage(): ReactElement {
  const stores = activeStores();
  return (
    <div className="space-y-14">
      <section className="pt-4 sm:pt-10">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
          Vê se o desconto é real
        </h1>
        <p className="mt-4 max-w-2xl text-lg text-slate-700">
          Histórico de preços {formatList(stores.map((store) => `da ${store.name}`))}, atualizado todos os
          dias.
        </p>
        <p className="mt-6 max-w-2xl rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-slate-800">
          Estamos a preparar a pesquisa e as páginas de cada produto. Os rótulos de desconto precisam de{" "}
          {LABELS_CONFIG.minHistoryDays} dias de preços em cada loja.
        </p>
      </section>

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

      <section aria-labelledby="lojas">
        <h2 id="lojas" className="text-2xl font-semibold text-slate-900">
          Lojas seguidas
        </h2>
        <ul className="mt-4 flex flex-wrap gap-3">
          {stores.map((store) => (
            <li key={store.slug} className="rounded-full border border-slate-300 px-4 py-1.5 text-slate-800">
              {store.name}
            </li>
          ))}
        </ul>
        <p className="mt-4 max-w-2xl text-slate-700">Só contamos artigos vendidos pela própria loja.</p>
      </section>
    </div>
  );
}
