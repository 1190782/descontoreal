import { pathToFileURL } from "node:url";
import { createDb, type Db } from "@descontoreal/db";
import { z } from "zod";
import { type Env, loadEnv } from "../env";
import { errorMessage } from "../http/errors";
import type { Logger } from "../http/logger";
import { formatStatsSummary, runStats, type StatsSummary } from "../jobs/stats";
import { redactSecrets } from "./scrape";

export interface StatsDeps {
  loadEnv: () => Env;
  createDb: (databaseUrl: string) => Db;
  runStats: (db: Db, now: Date) => Promise<StatsSummary>;
  now: () => Date;
  log: Logger;
  /** Summary and messages for the owner. */
  print: (text: string) => void;
  printError: (text: string) => void;
}

/** Runs `pnpm stats` and returns the exit code: 0 on success, 1 on any error. */
export async function main(deps: StatsDeps = defaultDeps()): Promise<number> {
  const env = readEnv(deps);
  if (env === null) {
    return 1;
  }
  if (env.DATABASE_URL === undefined) {
    deps.printError("Falta a variável DATABASE_URL (ver .env.example).");
    return 1;
  }
  let db: Db | null = null;
  try {
    db = deps.createDb(env.DATABASE_URL);
    const summary = await deps.runStats(db, deps.now());
    deps.print(formatStatsSummary(summary));
    return 0;
  } catch (error) {
    deps.printError(`O cálculo dos rótulos falhou: ${redactSecrets(errorMessage(error), env)}`);
    return 1;
  } finally {
    if (db !== null) {
      await closeDb(db, env, deps.log);
    }
  }
}

function defaultDeps(): StatsDeps {
  return {
    loadEnv,
    createDb,
    runStats,
    now: () => new Date(),
    log: console,
    print: (text) => console.log(text),
    printError: (text) => console.error(text),
  };
}

function readEnv(deps: StatsDeps): Env | null {
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

async function closeDb(db: Db, env: Env, log: Logger): Promise<void> {
  try {
    await db.close();
  } catch (error) {
    log.warn(`Database connection not closed cleanly: ${redactSecrets(errorMessage(error), env)}`);
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href) {
  process.exitCode = await main();
}
