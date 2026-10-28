import { pathToFileURL } from "node:url";
import { isStoreSlug, STORES, type StoreSlug } from "@descontoreal/core";
import { createDb, type Db } from "@descontoreal/db";
import { z } from "zod";
import { type Env, loadEnv } from "../env";
import { errorMessage } from "../http/errors";
import { type FetcherOptions, StoreFetcher } from "../http/fetcher";
import type { Logger } from "../http/logger";
import { formatRunSummary, formatSampleTable } from "../runner/report";
import type { RevalidationConfig } from "../runner/revalidate";
import { runStore, UnknownCategoryError } from "../runner/run-store";
import { SCRAPERS } from "../stores/registry";
import type { StoreScraper } from "../types";

export const USAGE = [
  "Utilização: pnpm scrape --store <loja> [--category <categoria>] [--dry-run] [--limit N] [--max-product-pages N] [--max-minutes N]",
  "",
  "  --store <loja>           Loja a recolher (obrigatório).",
  "  --category <categoria>   Só esta categoria da loja (execução parcial).",
  "  --dry-run                Simulação: não usa a base de dados e mostra os primeiros artigos para comparar com o site.",
  "  --limit N                Para depois de N artigos (execução parcial).",
  "  --max-product-pages N    Máximo de páginas de produto visitadas para dados do produto e revisitas (1500 por omissão;",
  "                           5 com --dry-run). As páginas lidas para o preço (Darty) não contam.",
  "  --max-minutes N          Ao fim de N minutos deixa de fazer pedidos, grava o que leu e avisa o administrador",
  "                           (execução parcial).",
].join("\n");

export interface ScrapeArgs {
  store: string | undefined;
  categoryKey: string | undefined;
  dryRun: boolean;
  limit: number | undefined;
  maxProductPages: number | undefined;
  maxMinutes: number | undefined;
  help: boolean;
}

/** Wrong command line. The message is for the owner, in pt-PT. */
export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export interface ScrapeDeps {
  scrapers: Partial<Record<StoreSlug, StoreScraper>>;
  loadEnv: () => Env;
  createDb: (databaseUrl: string) => Db;
  /** Merged into the fetcher's options; tests pass a fake transport and no pauses. */
  fetcherOptions: FetcherOptions;
  now: () => Date;
  /** Progress logs of the fetcher and the runner. */
  log: Logger;
  /** Report and messages for the owner. */
  print: (text: string) => void;
  printError: (text: string) => void;
}

const FLAG_OPTIONS = new Set(["--dry-run", "--help", "-h"]);
const VALUE_OPTIONS = new Set(["--store", "--category", "--limit", "--max-product-pages", "--max-minutes"]);
const MIN_SECRET_LENGTH = 4;

/**
 * Parses `--store <slug> [--category <key>] [--dry-run] [--limit N] [--max-product-pages N] [--max-minutes N]`;
 * `--name=value` works too.
 */
export function parseScrapeArgs(argv: readonly string[]): ScrapeArgs {
  const args: ScrapeArgs = {
    store: undefined,
    categoryKey: undefined,
    dryRun: false,
    limit: undefined,
    maxProductPages: undefined,
    maxMinutes: undefined,
    help: false,
  };
  // pnpm can forward the "--" separator to the script.
  const tokens = argv.filter((token) => token !== "--");
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const equals = token.startsWith("--") ? token.indexOf("=") : -1;
    const name = equals === -1 ? token : token.slice(0, equals);
    if (FLAG_OPTIONS.has(name)) {
      if (equals !== -1) {
        throw new CliUsageError(`A opção ${name} não leva valor.`);
      }
      if (name === "--dry-run") {
        args.dryRun = true;
      } else {
        args.help = true;
      }
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) {
      throw new CliUsageError(`Opção desconhecida: ${token}`);
    }
    let value: string | undefined;
    if (equals === -1) {
      index += 1;
      value = tokens[index];
    } else {
      value = token.slice(equals + 1);
    }
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new CliUsageError(`A opção ${name} precisa de um valor.`);
    }
    switch (name) {
      case "--store":
        args.store = value;
        break;
      case "--category":
        args.categoryKey = value;
        break;
      case "--limit":
        args.limit = parseCount(name, value, 1);
        break;
      case "--max-product-pages":
        args.maxProductPages = parseCount(name, value, 0);
        break;
      case "--max-minutes":
        args.maxMinutes = parseCount(name, value, 1);
        break;
    }
  }
  return args;
}

/** The scraper for --store; a pt-PT CliUsageError for a missing, unknown or blocked store. */
export function resolveScraper(
  store: string | undefined,
  scrapers: Partial<Record<StoreSlug, StoreScraper>>,
): StoreScraper {
  const available = `Lojas disponíveis: ${Object.keys(scrapers).sort().join(", ") || "nenhuma"}.`;
  if (store === undefined) {
    throw new CliUsageError(`Indica a loja com --store <loja>. ${available}`);
  }
  const info = STORES.find((candidate) => candidate.slug === store);
  if (info !== undefined && !info.active) {
    throw new CliUsageError(
      `A loja ${info.name} bloqueia o nosso bot, por isso não recolhemos dela (ver docs/stores/${info.slug}.md). ${available}`,
    );
  }
  const scraper = isStoreSlug(store) ? scrapers[store] : undefined;
  if (scraper === undefined) {
    throw new CliUsageError(`Loja desconhecida: "${store}". ${available}`);
  }
  return scraper;
}

/** Runs `pnpm scrape` and returns the exit code: 0 on success, 1 on failed or blocked runs and on errors. */
export async function main(argv: readonly string[], deps: ScrapeDeps = defaultDeps()): Promise<number> {
  let args: ScrapeArgs;
  let scraper: StoreScraper;
  try {
    args = parseScrapeArgs(argv);
    if (args.help) {
      deps.print(USAGE);
      return 0;
    }
    scraper = resolveScraper(args.store, deps.scrapers);
  } catch (error) {
    if (!(error instanceof CliUsageError)) {
      throw error;
    }
    deps.printError(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  const env = readEnv(deps);
  if (env === null) {
    return 1;
  }
  const databaseUrl = env.DATABASE_URL;
  if (!args.dryRun && databaseUrl === undefined) {
    deps.printError(
      "Falta a variável DATABASE_URL (ver .env.example). Para testar sem base de dados usa --dry-run.",
    );
    return 1;
  }
  let db: Db | null = null;
  try {
    // A dry run never opens a connection, even when DATABASE_URL is set.
    db = args.dryRun || databaseUrl === undefined ? null : deps.createDb(databaseUrl);
    const report = await runStore({
      scraper,
      db,
      fetcher: new StoreFetcher(scraper, { log: deps.log, ...deps.fetcherOptions }),
      categoryKey: args.categoryKey,
      limit: args.limit,
      maxProductPages: args.maxProductPages,
      maxMinutes: args.maxMinutes,
      now: deps.now,
      log: deps.log,
      revalidation: args.dryRun ? null : revalidationConfig(env),
    });
    deps.print(formatRunSummary(scraper.name, report));
    if (args.dryRun) {
      deps.print(`\nPrimeiros artigos:\n${formatSampleTable(scraper.name, report.sampleItems)}`);
    }
    return report.status === "success" ? 0 : 1;
  } catch (error) {
    if (error instanceof UnknownCategoryError) {
      const known = error.available.join(", ") || "nenhuma";
      deps.printError(
        `Categoria desconhecida na loja ${scraper.name}: "${error.categoryKey}". Categorias disponíveis: ${known}.`,
      );
      return 1;
    }
    deps.printError(`A recolha da loja ${scraper.name} falhou: ${redactSecrets(errorMessage(error), env)}`);
    return 1;
  } finally {
    if (db !== null) {
      await closeDb(db, deps.log);
    }
  }
}

function defaultDeps(): ScrapeDeps {
  return {
    scrapers: SCRAPERS,
    loadEnv,
    createDb,
    fetcherOptions: {},
    now: () => new Date(),
    log: console,
    print: (text) => console.log(text),
    printError: (text) => console.error(text),
  };
}

function parseCount(name: string, value: string, min: number): number {
  const count = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(count) || count < min) {
    throw new CliUsageError(
      `A opção ${name} tem de ser um número inteiro a partir de ${min} (recebido: "${value}").`,
    );
  }
  return count;
}

function readEnv(deps: ScrapeDeps): Env | null {
  try {
    return deps.loadEnv();
  } catch (error) {
    // Names only: values may be secrets.
    const names =
      error instanceof z.ZodError
        ? [...new Set(error.issues.map((issue) => issue.path.map(String).join(".")))].join(", ")
        : "o ficheiro .env não pôde ser lido";
    deps.printError(`Variáveis de ambiente inválidas: ${names}. Corrige o .env (ver .env.example).`);
    return null;
  }
}

function revalidationConfig(env: Env): RevalidationConfig | null {
  if (env.SITE_URL === undefined || env.REVALIDATE_SECRET === undefined) {
    return null;
  }
  return { siteUrl: env.SITE_URL, secret: env.REVALIDATE_SECRET };
}

async function closeDb(db: Db, log: Logger): Promise<void> {
  try {
    await db.close();
  } catch (error) {
    log.warn(`Database connection not closed cleanly: ${errorMessage(error)}`);
  }
}

/** Removes secret values (and the database password) from a message before printing it. */
export function redactSecrets(text: string, env: Env): string {
  const password = databasePassword(env.DATABASE_URL);
  const secrets = [
    env.DATABASE_URL,
    env.REVALIDATE_SECRET,
    env.RESEND_API_KEY,
    password,
    safeDecode(password),
  ];
  return secrets
    .filter((secret): secret is string => secret !== undefined && secret.length >= MIN_SECRET_LENGTH)
    .reduce((result, secret) => result.split(secret).join("***"), text);
}

function databasePassword(databaseUrl: string | undefined): string | undefined {
  if (databaseUrl === undefined || !URL.canParse(databaseUrl)) {
    return undefined;
  }
  return new URL(databaseUrl).password || undefined;
}

function safeDecode(text: string | undefined): string | undefined {
  if (text === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main(process.argv.slice(2));
}
