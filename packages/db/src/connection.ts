import postgres from "postgres";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const IDLE_TIMEOUT_SECONDS = 20;
const INT8_OID = 20;

export type DbSql = postgres.Sql<{ int8: number }>;
/** What DbSql and its transactions both run. */
export type DbQueries = postgres.ISql<{ int8: number }>;

/**
 * postgres.js client for DATABASE_URL (Supabase session or transaction pooler, or the local PGlite server).
 * One connection: every caller runs its queries in sequence, and the local server multiplexes clients per
 * protocol message, so concurrent connections could interleave there.
 */
export function createSql(databaseUrl: string): DbSql {
  return postgres(databaseUrl, {
    ...tlsOptions(parseDatabaseUrl(databaseUrl)),
    max: 1,
    // Poolers in transaction mode cannot keep prepared statements between transactions.
    prepare: false,
    idle_timeout: IDLE_TIMEOUT_SECONDS,
    onnotice: ignoreNotice,
    connection: { application_name: "descontoreal" },
    types: {
      int8: {
        to: INT8_OID,
        from: [INT8_OID],
        serialize: (value: number): string => String(value),
        parse: (value: string): number => Number(value),
      },
    },
  });
}

/** Never puts the URL in the error: it holds the database password. */
export function parseDatabaseUrl(databaseUrl: string): URL {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must start with postgresql://.");
  }
  return url;
}

/** TLS for remote hosts unless the URL sets sslmode itself; none for the local database. */
export function tlsOptions(url: URL): { ssl?: false | "require" } {
  if (url.searchParams.has("sslmode")) {
    return {};
  }
  return { ssl: LOCAL_HOSTS.has(url.hostname) ? false : "require" };
}

function ignoreNotice(): void {
  // "already exists, skipping" notices from migrations are expected.
}
