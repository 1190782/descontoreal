import { breadcrumbJsonLd, SITE } from "@descontoreal/core";
import Link from "next/link";
import type { ReactElement } from "react";
import { JsonLdScript } from "@/components/json-ld-script";

export interface Crumb {
  name: string;
  /** Site path; the last crumb is the current page. */
  path: string;
}

/** The trail above a page's title, with its schema.org BreadcrumbList. */
export function Breadcrumbs({ items }: { items: readonly Crumb[] }): ReactElement {
  const trail = [{ name: "Início", path: "/" }, ...items];
  return (
    <nav aria-label="Caminho" className="mb-4 text-sm text-slate-600">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {trail.map((crumb, index) => (
          <li key={crumb.path} className="flex items-center gap-2">
            {index > 0 ? <span aria-hidden>›</span> : null}
            {index === trail.length - 1 ? (
              <span aria-current="page">{crumb.name}</span>
            ) : (
              <Link href={crumb.path} prefetch={false} className="hover:text-indigo-700 hover:underline">
                {crumb.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
      <JsonLdScript
        data={breadcrumbJsonLd(trail.map((crumb) => ({ name: crumb.name, url: `${SITE.url}${crumb.path}` })))}
      />
    </nav>
  );
}
