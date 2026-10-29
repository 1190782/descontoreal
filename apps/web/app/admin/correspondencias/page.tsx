import { formatCents, formatPercent } from "@descontoreal/core";
import type { ReviewCandidate, ReviewQueue, SameStoreGroup } from "@descontoreal/db/web";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement, ReactNode } from "react";
import { ProductImage } from "@/components/product-image";
import { noticeText } from "@/lib/admin";
import { createSessionClient } from "@/lib/supabase";
import { approveMatch, rejectMatch, signOut, splitListing } from "./actions";

interface Props {
  searchParams: Promise<{ aviso?: string | string[] }>;
}

export const metadata: Metadata = {
  title: "Correspondências",
  robots: { index: false, follow: false },
};

const NOTICES = {
  aprovada: "Correspondência aprovada. A página do produto volta a ser gerada na próxima visita.",
  rejeitada: "Sugestão rejeitada.",
  separado: "Artigo separado e ligado de novo pelas regras.",
  falhou: "Não foi possível guardar a decisão. A lista abaixo está atualizada: confirma e tenta outra vez.",
};

const BUTTON = "rounded-lg px-4 py-2 text-sm font-medium";
const PRIMARY_BUTTON = `${BUTTON} bg-indigo-700 font-semibold text-white hover:bg-indigo-800`;
const SECONDARY_BUTTON = `${BUTTON} text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50`;

/** Matches the rules could not decide alone, and products one store lists more than once. */
export default async function MatchReviewPage({ searchParams }: Props): Promise<ReactElement> {
  const { aviso } = await searchParams;
  const notice = noticeText(aviso, NOTICES);
  const supabase = await createSessionClient();
  const { data: queue, error } = await supabase.rpc("admin_review_queue");
  if (queue === null) {
    throw new Error(`admin_review_queue failed: ${error.message}`);
  }
  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Correspondências</h1>
        <form action={signOut}>
          <button type="submit" className={SECONDARY_BUTTON}>
            Sair
          </button>
        </form>
      </div>
      {notice === null ? null : (
        <p role="status" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-800">
          {notice}
        </p>
      )}
      <Candidates queue={queue} />
      <SameStore groups={queue.sameStore} />
    </div>
  );
}

function Candidates({ queue }: { queue: ReviewQueue }): ReactElement {
  return (
    <section aria-labelledby="sugestoes" className="space-y-4">
      <div className="space-y-2">
        <h2 id="sugestoes" className="text-2xl font-bold text-slate-900">
          Sugestões por rever ({queue.candidateCount})
        </h2>
        <p className="text-slate-700">
          Aprovar liga o artigo da loja ao produto. Rejeitar tira a sugestão: sem sugestões pendentes, o
          artigo fica ligado pelas regras ou com um produto novo.
        </p>
        {queue.candidateCount > queue.candidates.length ? (
          <p className="text-sm text-slate-600">
            Mostramos as {queue.candidates.length} mais prováveis de {queue.candidateCount}.
          </p>
        ) : null}
      </div>
      {queue.candidates.length === 0 ? (
        <p className="text-slate-700">Não há sugestões por rever.</p>
      ) : (
        <ol className="space-y-4">
          {queue.candidates.map((candidate) => (
            <CandidateItem key={candidate.candidateId} candidate={candidate} />
          ))}
        </ol>
      )}
    </section>
  );
}

function CandidateItem({ candidate }: { candidate: ReviewCandidate }): ReactElement {
  const { listing, product } = candidate;
  const pair = `${listing.title} e ${product.name}`;
  return (
    <li className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">
        Semelhança dos nomes: {formatPercent(candidate.confidence * 100)}
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <Side
          heading={`Artigo da ${listing.storeName}`}
          imageUrl={listing.imageUrl}
          name={listing.title}
          link={
            <a href={listing.url} target="_blank" rel="noopener noreferrer" className="underline">
              Ver na loja
            </a>
          }
          facts={[
            ["SKU", listing.sku],
            ["EAN", listing.ean ?? "sem EAN"],
            ["Marca", listing.brand ?? "—"],
            ["Modelo", listing.model ?? "—"],
            ["Preço", priceText(listing.priceCents, listing.inStock === false ? ", sem stock" : "")],
          ]}
        />
        <Side
          heading="Produto"
          imageUrl={product.imageUrl}
          name={product.name}
          link={
            <Link href={`/p/${product.slug}`} prefetch={false} className="underline">
              Ver a página do produto
            </Link>
          }
          facts={[
            ["Lojas", product.stores.length === 0 ? "nenhuma" : product.stores.join(", ")],
            ["EAN", product.ean ?? "sem EAN"],
            ["Marca", product.brand ?? "—"],
            ["Modelo", product.model ?? "—"],
            ["Mais barato hoje", priceText(product.priceCents, "")],
          ]}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <DecisionButton action={approveMatch} id={candidate.candidateId} className={PRIMARY_BUTTON}>
          Aprovar<span className="sr-only">: {pair} são o mesmo produto</span>
        </DecisionButton>
        <DecisionButton action={rejectMatch} id={candidate.candidateId} className={SECONDARY_BUTTON}>
          Rejeitar<span className="sr-only">: {pair} são produtos diferentes</span>
        </DecisionButton>
      </div>
    </li>
  );
}

function Side({
  heading,
  imageUrl,
  name,
  link,
  facts,
}: {
  heading: string;
  imageUrl: string | null;
  name: string;
  link: ReactNode;
  facts: [string, string][];
}): ReactElement {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold tracking-wide text-slate-600 uppercase">{heading}</h3>
      <div className="flex items-start gap-3">
        <ProductImage src={imageUrl} alt="" size={96} />
        <div className="space-y-1">
          <p className="font-semibold text-slate-900">{name}</p>
          <p className="text-sm">{link}</p>
        </div>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-slate-600">{term}</dt>
            <dd className="text-slate-900">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SameStore({ groups }: { groups: SameStoreGroup[] }): ReactElement {
  return (
    <section aria-labelledby="mesma-loja" className="space-y-4">
      <div className="space-y-2">
        <h2 id="mesma-loja" className="text-2xl font-bold text-slate-900">
          Produtos com vários artigos da mesma loja ({groups.length})
        </h2>
        <p className="text-slate-700">
          Dois artigos da mesma loja são dois produtos, exceto se tiverem o EAN do produto. Separar tira o
          artigo do produto e liga-o de novo pelas regras: ao produto do seu EAN, a outro da mesma marca e
          modelo, a sugestões para rever ou a um produto novo.
        </p>
      </div>
      {groups.length === 0 ? (
        <p className="text-slate-700">Nenhum produto tem mais do que um artigo da mesma loja.</p>
      ) : (
        <ul className="space-y-4">
          {groups.map((group) => (
            <SameStoreItem key={`${group.productId}-${group.storeName}`} group={group} />
          ))}
        </ul>
      )}
    </section>
  );
}

function SameStoreItem({ group }: { group: SameStoreGroup }): ReactElement {
  return (
    <li className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-900">
        <Link href={`/p/${group.slug}`} prefetch={false} className="underline">
          {group.name}
        </Link>{" "}
        <span className="font-normal text-slate-600">na {group.storeName}</span>
      </h3>
      {group.sharesEan ? (
        <p className="text-sm text-slate-700">
          Todos têm o EAN do produto ({group.ean}): são o mesmo produto.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-xl text-left text-sm">
          <thead className="text-slate-600">
            <tr>
              <th scope="col" className="py-1 pr-4 font-medium">
                SKU
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Nome na loja
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                EAN
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Preço
              </th>
              <th scope="col" className="py-1 font-medium">
                <span className="sr-only">Separar</span>
              </th>
            </tr>
          </thead>
          <tbody className="text-slate-900">
            {group.listings.map((listing) => (
              <tr key={listing.id} className="border-t border-slate-200">
                <td className="py-2 pr-4 whitespace-nowrap">
                  <a href={listing.url} target="_blank" rel="noopener noreferrer" className="underline">
                    {listing.sku}
                  </a>
                </td>
                <td className="py-2 pr-4">{listing.title}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{listing.ean ?? "sem EAN"}</td>
                <td className="py-2 pr-4 whitespace-nowrap">{priceText(listing.priceCents, "")}</td>
                <td className="py-2">
                  {listing.canSplit ? (
                    <DecisionButton action={splitListing} id={listing.id} className={SECONDARY_BUTTON}>
                      Separar<span className="sr-only"> o SKU {listing.sku}</span>
                    </DecisionButton>
                  ) : (
                    <span className="text-slate-600">
                      {listing.ean !== null && listing.ean === group.ean
                        ? "EAN do produto"
                        : "Sem dados da página"}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </li>
  );
}

/** A form with one button, so every decision also works without JavaScript. */
function DecisionButton({
  action,
  id,
  className,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  id: number;
  className: string;
  children: ReactNode;
}): ReactElement {
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button type="submit" className={className}>
        {children}
      </button>
    </form>
  );
}

function priceText(cents: number | null, suffix: string): string {
  return cents === null ? "sem preço" : `${formatCents(cents)}${suffix}`;
}
