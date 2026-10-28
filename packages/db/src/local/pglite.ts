import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { PGlite, type PGliteInterface, type Transaction } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { rejectNestedTransaction, type SqlExecutor, type SqlParam } from "../executor";

const SHIM_FILE = new URL("./supabase-shim.sql", import.meta.url);

/**
 * PGlite with pg_trgm and the Supabase shim (schemas auth and extensions, auth.users, auth.uid(), the API roles).
 * In memory without `dataDir`; otherwise persisted there (parent folders are created).
 */
export async function createLocalPglite(dataDir?: string): Promise<PGlite> {
  if (dataDir) {
    await mkdir(dirname(dataDir), { recursive: true });
  }
  const db = await PGlite.create({ dataDir, extensions: { pg_trgm } });
  await db.exec(await readFile(SHIM_FILE, "utf8"));
  return db;
}

export function pgliteExecutor(db: PGliteInterface): SqlExecutor {
  return {
    ...pgliteQueries(db),
    async transaction(work: (tx: SqlExecutor) => Promise<void>): Promise<void> {
      await db.transaction(async (tx) => {
        await work({ ...pgliteQueries(tx), transaction: rejectNestedTransaction });
      });
    },
  };
}

function pgliteQueries(db: PGliteInterface | Transaction): Pick<SqlExecutor, "exec" | "query"> {
  return {
    async exec(text: string): Promise<void> {
      await db.exec(text);
    },
    async query<T extends object>(text: string, params: readonly SqlParam[] = []): Promise<T[]> {
      const result = await db.query<T>(text, [...params]);
      return result.rows;
    },
  };
}
