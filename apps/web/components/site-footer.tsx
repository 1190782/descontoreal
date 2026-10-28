import { activeStores, SITE } from "@descontoreal/core";
import Link from "next/link";
import type { ReactElement } from "react";
import { formatList } from "@/lib/text";

const LINKS = [
  { href: "/como-funciona", label: "Como funciona" },
  { href: "/bot", label: "O nosso bot" },
  { href: "/privacidade", label: "Privacidade" },
  { href: "/termos", label: "Termos" },
  { href: "/cookies", label: "Cookies" },
  { href: "/afiliacao", label: "Afiliação" },
];

export function SiteFooter(): ReactElement {
  const stores = formatList(activeStores().map((store) => `na ${store.name}`));
  return (
    <footer className="mt-16 border-t border-slate-200 bg-slate-50">
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-8 text-sm text-slate-600">
        <p>
          <strong className="text-slate-900">{SITE.name}</strong> · {SITE.tagline}. Preços recolhidos todos os
          dias {stores}.
        </p>
        <nav aria-label="Rodapé">
          <ul className="flex flex-wrap gap-x-5 gap-y-2">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-slate-700 hover:text-indigo-700 hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          Contacto:{" "}
          <a href={`mailto:${SITE.contactEmail}`} className="text-slate-700 underline underline-offset-2">
            {SITE.contactEmail}
          </a>
        </p>
      </div>
    </footer>
  );
}
