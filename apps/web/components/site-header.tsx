import { SITE } from "@descontoreal/core";
import Link from "next/link";
import type { ReactElement } from "react";

export function SiteHeader(): ReactElement {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
          {SITE.name}
        </Link>
        <nav aria-label="Principal">
          <ul className="flex items-center gap-5 text-sm font-medium">
            <li>
              <Link href="/como-funciona" className="text-slate-700 hover:text-indigo-700 hover:underline">
                Como funciona
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
