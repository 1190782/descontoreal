import { formatCents, type StoreSlug } from "@descontoreal/core";
import type { RunError, RunStatus } from "@descontoreal/db";

/** One of the first items of a run, shown by the dry run for comparing with the store's website. */
export interface SampleItem {
  storeSku: string;
  title: string;
  url: string;
  categoryKey: string;
  priceCents: number;
  referencePriceCents: number | null;
  /** Manufacturer's recommended price (PVPr), information only. */
  rrpCents: number | null;
  inStock: boolean;
  sellerName: string | null;
  /** null when this run could not tell (product page skipped or failed). */
  soldByStore: boolean | null;
  /** EAN as shown on the listing or the product page. */
  ean: string | null;
}

/** A category whose listing pages were not all read. */
export interface IncompleteCategory {
  key: string;
  /** First listing page of the category. */
  url: string;
  /** The listing page that failed or looped; the category URL itself when robots.txt disallows it. */
  failedUrl: string;
  reason: "listing-page" | "robots-txt";
}

export interface RunReport {
  store: StoreSlug;
  status: Exclude<RunStatus, "running">;
  dryRun: boolean;
  /**
   * --limit, --category, the time limit, categories robots.txt disallows, or a stop before the end (blocked, store
   * failing, unexpected error): the run never counts as history and never marks listings missing.
   */
  partial: boolean;
  /** --max-minutes when it cut the run short (what was read is stored, the run counts as partial); else null. */
  timeLimitMinutes: number | null;
  pagesFetched: number;
  /** Unique items read from listing pages, any seller. */
  listingsSeen: number;
  /** Items not sold by the store itself. */
  droppedMarketplace: number;
  /** Store-sold listings new to the database; in a dry run every kept item counts as new. */
  new: number;
  changed: number;
  unchanged: number;
  /** Product-page requests, counted against maxProductPages. */
  productPagesFetched: number;
  /** Product-page requests for prices (StoreScraper.pricesFromProductPage); never limited by maxProductPages. */
  pricePagesFetched: number;
  /** Items whose product page failed, showed no price or another SKU; they were skipped today. */
  skippedPrices: number;
  /** Product pages read for the weekly revisit. */
  revisited: number;
  /** Suspicious price jumps the product page did not confirm; the item was skipped today. */
  skippedJumps: number;
  /** Product pages not read because maxProductPages was used up. */
  budgetExhausted: number;
  /** Categories not read to the end; listings are then never marked missing and the admin gets an email. */
  incompleteCategories: IncompleteCategory[];
  /** The first errors (at most 50), as stored in scrape_runs; when the run ends early, the last one says why. */
  errors: RunError[];
  errorCount: number;
  sampleItems: SampleItem[];
}

const STATUS_TEXT: Record<RunReport["status"], string> = {
  success: "recolha concluída",
  failed: "recolha falhada",
  blocked: "recolha bloqueada pela loja",
};

const ERRORS_IN_SUMMARY = 10;
const ERRORS_IN_EMAIL = 5;
const TITLE_WIDTH = 50;

/** Run summary in pt-PT, for the terminal and the admin email. */
export function formatRunSummary(
  storeName: string,
  report: RunReport,
  maxErrors = ERRORS_IN_SUMMARY,
): string {
  const modes = [
    report.dryRun ? "simulação, nada foi gravado" : null,
    report.partial ? "execução parcial" : null,
    report.timeLimitMinutes === null ? null : `interrompida ao fim de ${report.timeLimitMinutes} min`,
  ];
  const mode = modes.filter((text) => text !== null).join(", ");
  const shownErrors = report.errors.slice(0, maxErrors);
  const lines = [
    `${storeName}: ${STATUS_TEXT[report.status]}${mode ? ` (${mode})` : ""}`,
    `Páginas obtidas: ${report.pagesFetched}`,
    `Artigos vistos: ${report.listingsSeen}, dos quais ${report.droppedMarketplace} de outros vendedores (descartados)`,
    `Novos: ${report.new} · Alterados: ${report.changed} · Sem alteração: ${report.unchanged}`,
    ...(report.pricePagesFetched > 0
      ? [
          `Páginas de produto lidas para o preço: ${report.pricePagesFetched} (artigos sem preço, ignorados hoje: ${report.skippedPrices})`,
        ]
      : []),
    `Páginas de produto: ${report.productPagesFetched} (revisitas semanais: ${report.revisited}; adiadas por limite: ${report.budgetExhausted})`,
    `Saltos de preço não confirmados: ${report.skippedJumps}`,
    ...(report.incompleteCategories.length > 0
      ? [
          `Categorias incompletas: ${report.incompleteCategories.length}`,
          ...report.incompleteCategories.map(
            (category) => `  - ${category.url} (${incompleteDetail(category)})`,
          ),
        ]
      : []),
    `Erros: ${report.errorCount}`,
    ...shownErrors.map((error) => `  - ${formatError(error)}`),
  ];
  if (report.errorCount > shownErrors.length) {
    lines.push(`  - … e mais ${report.errorCount - shownErrors.length}`);
  }
  return lines.join("\n");
}

/**
 * Email to the administrator after a failed or blocked run, one the time limit cut short, or one that did not read
 * every category to the end (pt-PT).
 */
export function formatAdminMessage(storeName: string, report: RunReport): { subject: string; text: string } {
  const { outcome, opening } = adminOpening(storeName, report);
  // The error that ended the run may sit past the first errors the summary lists.
  const cause = report.status === "success" ? undefined : report.errors.at(-1);
  const causeLines = cause === undefined ? [] : [`Motivo: ${formatError(cause)}`];
  return {
    subject: `DescontoReal: recolha ${outcome} (${storeName})`,
    text: [opening, ...causeLines, "", formatRunSummary(storeName, report, ERRORS_IN_EMAIL)].join("\n"),
  };
}

function adminOpening(storeName: string, report: RunReport): { outcome: string; opening: string } {
  if (report.status === "blocked") {
    return {
      outcome: "bloqueada",
      opening: `A loja ${storeName} bloqueou o nosso bot. A recolha desta loja parou por hoje e o bloqueio não foi contornado.`,
    };
  }
  if (report.status === "success" && report.timeLimitMinutes !== null) {
    return {
      outcome: "interrompida",
      opening:
        `A recolha da loja ${storeName} parou ao fim de ${report.timeLimitMinutes} minutos, o limite de tempo da execução. ` +
        "Os preços lidos até aí foram gravados; os restantes artigos mantêm o último preço conhecido. " +
        "A execução conta como parcial: não marca artigos como desaparecidos nem entra na média de artigos. " +
        "Se acontecer todos os dias, a loja tem categorias a mais para o tempo disponível.",
    };
  }
  if (report.status === "success" && report.incompleteCategories.length > 0) {
    const count = report.incompleteCategories.length;
    const categories = count === 1 ? "1 categoria não foi lida" : `${count} categorias não foram lidas`;
    return {
      outcome: "incompleta",
      opening:
        `A recolha da loja ${storeName} terminou, mas ${categories} até ao fim (lista abaixo). ` +
        "Os preços lidos foram gravados. Como a recolha ficou incompleta, nenhum artigo foi marcado como desaparecido hoje.",
    };
  }
  return { outcome: "falhada", opening: `A recolha da loja ${storeName} falhou.` };
}

function incompleteDetail(category: IncompleteCategory): string {
  if (category.reason === "robots-txt") {
    return "proibida pelo robots.txt";
  }
  return category.failedUrl === category.url ? "falhou a primeira página" : `falhou ${category.failedUrl}`;
}

function formatError(error: RunError): string {
  return `${error.url === undefined ? "" : `${error.url}: `}${error.message}`;
}

/** The first items of a run as a text table (pt-PT), followed by their URLs. */
export function formatSampleTable(storeName: string, items: readonly SampleItem[]): string {
  if (items.length === 0) {
    return "Nenhum artigo extraído.";
  }
  const header = ["#", "SKU", "Título", "Preço", "Preço riscado", "PVPr", "Stock", "Vendedor", "EAN"];
  const rows = items.map((item, index) => [
    String(index + 1),
    item.storeSku,
    truncate(item.title, TITLE_WIDTH),
    formatCents(item.priceCents),
    centsOrDash(item.referencePriceCents),
    centsOrDash(item.rrpCents),
    item.inStock ? "sim" : "não",
    sellerText(storeName, item),
    item.ean ?? "—",
  ]);
  const widths = header.map((title, column) =>
    Math.max(title.length, ...rows.map((row) => row[column]?.length ?? 0)),
  );
  const render = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();
  return [
    render(header),
    render(widths.map((width) => "-".repeat(width))),
    ...rows.map(render),
    "",
    ...items.map((item, index) => `${index + 1}. ${item.url}`),
  ].join("\n");
}

function centsOrDash(cents: number | null): string {
  return cents === null ? "—" : formatCents(cents);
}

function sellerText(storeName: string, item: SampleItem): string {
  if (item.sellerName !== null) {
    return item.sellerName;
  }
  if (item.soldByStore === null) {
    return "?";
  }
  return item.soldByStore ? storeName : "outro vendedor";
}

function truncate(text: string, width: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= width ? clean : `${clean.slice(0, width - 1)}…`;
}
