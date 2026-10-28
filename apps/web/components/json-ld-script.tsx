import { type JsonLd, serializeJsonLd } from "@descontoreal/core";
import type { ReactElement } from "react";

export function JsonLdScript({ data }: { data: JsonLd | JsonLd[] }): ReactElement {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
