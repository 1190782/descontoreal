import { formatCents } from "@descontoreal/core";
import type { ProductCard as ProductCardData } from "@descontoreal/db/web";
import Link from "next/link";
import type { ReactElement } from "react";
import { LabelBadge } from "@/components/label-badge";
import { ProductImage } from "@/components/product-image";

/** Cards link without prefetching: on Workers every prefetch of a dense grid is a billed request. */
export function ProductCard({ card }: { card: ProductCardData }): ReactElement {
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <Link href={`/p/${card.slug}`} prefetch={false} className="flex items-start gap-3 hover:underline">
        <ProductImage src={card.imageUrl} alt="" size={72} />
        <h3 className="text-base leading-snug font-semibold text-slate-900">{card.name}</h3>
      </Link>
      <div className="mt-auto space-y-2">
        <p>
          <span className="text-xl font-bold text-slate-900">{formatCents(card.priceCents)}</span>{" "}
          <span className="text-sm text-slate-600">
            {card.onSale ? `na ${card.storeName}` : `na ${card.storeName}, indisponível`}
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {card.label === null ? null : <LabelBadge tone={card.label.tone} name={card.label.name} />}
          {card.storeCount > 1 ? (
            <span className="text-sm text-slate-600">{card.storeCount} lojas</span>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function ProductGrid({ cards }: { cards: readonly ProductCardData[] }): ReactElement {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <ProductCard key={card.productId} card={card} />
      ))}
    </ul>
  );
}
