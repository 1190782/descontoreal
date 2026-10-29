import type { Metadata } from "next";
import Link from "next/link";
import type { ReactElement } from "react";

export const metadata: Metadata = {
  title: "Sem ligação",
  robots: { index: false, follow: false },
};

/** What the service worker shows when a page cannot load: no prices, which would be out of date. */
export default function OfflinePage(): ReactElement {
  return (
    <div className="prose">
      <h1>Sem ligação à internet</h1>
      <p>
        Esta página precisa de ligação para mostrar os preços de hoje. Quando voltares a ter rede, recarrega a
        página.
      </p>
      <p>
        <Link href="/">Voltar ao início</Link>
      </p>
    </div>
  );
}
