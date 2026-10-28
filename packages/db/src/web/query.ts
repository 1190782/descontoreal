import type { DbQueries } from "../connection";
import type { SqlExecutor, SqlParam } from "../executor";

/** Runs one read statement with $1… parameters and returns its rows. */
export type Query = SqlExecutor["query"];

/**
 * Query over a postgres.js client, as prepared statements: Hyperdrive keeps them per connection, and Cloudflare
 * warns that unprepared statements through it can hang. Tests pass pgliteExecutor(db).query instead.
 */
export function preparedQuery(sql: Pick<DbQueries, "unsafe">): Query {
  return async <T extends object>(text: string, params: readonly SqlParam[] = []): Promise<T[]> =>
    await sql.unsafe<T[]>(text, [...params], { prepare: true });
}

/** JSON text for a $n::text::jsonb parameter, or null; both clients bind it as text. */
export function jsonParam(value: readonly (string | number)[] | null | undefined): string | null {
  return value === null || value === undefined ? null : JSON.stringify(value);
}

/** A LIKE pattern matching `text` literally (with `escape '\\'`). */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
