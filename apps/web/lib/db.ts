import "server-only";
import { preparedQuery, type Query } from "@descontoreal/db/web";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import postgres from "postgres";
import { cache } from "react";

const INT8_OID = 20;
// A Worker may keep 6 connections waiting for a response; leave one for anything else.
const MAX_CONNECTIONS = 5;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
// The build reaches Supabase directly (its Session pooler) and must use TLS; Hyperdrive handles TLS itself.
const SUPABASE_HOST = /\.supabase\.(com|co)$/;

/**
 * The read-only database client of the current request: Hyperdrive in production (web_ro role, no query cache),
 * the local PGlite server under next dev. A client is never shared between requests, which Workers forbid.
 */
export const getQuery = cache(async (): Promise<Query> => {
  const { env } = await getCloudflareContext({ async: true });
  const url = env.HYPERDRIVE.connectionString;
  const { hostname } = new URL(url);
  const local = LOCAL_HOSTS.has(hostname);
  const sql = postgres(url, {
    // The local server serves one client at a time.
    max: local ? 1 : MAX_CONNECTIONS,
    prepare: true,
    fetch_types: false,
    ssl: SUPABASE_HOST.test(hostname) ? "require" : undefined,
    idle_timeout: local ? 2 : undefined,
    types: {
      int8: {
        to: INT8_OID,
        from: [INT8_OID],
        serialize: (value: number): string => String(value),
        parse: (value: string): number => Number(value),
      },
    },
  });
  return preparedQuery(sql);
});
