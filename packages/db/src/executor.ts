import type { DbSql } from "./connection";

export type SqlParam = string | number | boolean | Date | null;

/**
 * The few operations migrations and seeding need, so they run on postgres.js (Supabase) and on PGlite (tests).
 * Pass JSON as text and cast it with `$1::text::jsonb`: both clients would JSON-encode a string bound to jsonb.
 */
export interface SqlExecutor {
  /** Runs SQL that may hold several statements and takes no parameters. */
  exec(text: string): Promise<void>;
  query<T extends object>(text: string, params?: readonly SqlParam[]): Promise<T[]>;
  /** Runs `work` in one transaction; it rolls back when `work` throws. No nesting. */
  transaction(work: (tx: SqlExecutor) => Promise<void>): Promise<void>;
}

interface PostgresQueryable {
  unsafe: DbSql["unsafe"];
}

function postgresQueries(sql: PostgresQueryable): Pick<SqlExecutor, "exec" | "query"> {
  return {
    async exec(text: string): Promise<void> {
      await sql.unsafe(text);
    },
    async query<T extends object>(text: string, params: readonly SqlParam[] = []): Promise<T[]> {
      return await sql.unsafe<T[]>(text, [...params]);
    },
  };
}

export function postgresExecutor(sql: DbSql): SqlExecutor {
  return {
    ...postgresQueries(sql),
    async transaction(work: (tx: SqlExecutor) => Promise<void>): Promise<void> {
      await sql.begin(async (tx) => {
        await work({ ...postgresQueries(tx), transaction: rejectNestedTransaction });
      });
    },
  };
}

export function rejectNestedTransaction(): Promise<void> {
  return Promise.reject(new Error("Nested transactions are not supported."));
}
