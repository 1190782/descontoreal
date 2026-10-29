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

// next build: web_ro shares its 15 Session pooler connections with Hyperdrive, the live site, and a client per page
// kept its connection open until the build ended. One connection per build process serves all its pages.
let buildQuery: Query | undefined;

/**
 * The read-only database client of the current request: Hyperdrive in production (web_ro role, no query cache),
 * the local PGlite server under next dev. A client is never shared between requests, which Workers forbid; only
 * next build, which runs outside Workers, shares one.
 */
export const getQuery = cache(async (): Promise<Query> => {
  const { env } = await getCloudflareContext({ async: true });
  const url = env.HYPERDRIVE.connectionString;
  const { hostname } = new URL(url);
  if (SUPABASE_HOST.test(hostname)) {
    buildQuery ??= connect(url, { max: 1, ssl: "require" });
    return buildQuery;
  }
  // The local server serves one client at a time.
  const local = LOCAL_HOSTS.has(hostname);
  return connect(url, { max: local ? 1 : MAX_CONNECTIONS, idle_timeout: local ? 2 : undefined });
});

function connect(
  url: string,
  options: { max: number; ssl?: "require" | undefined; idle_timeout?: number | undefined },
): Query {
  return preparedQuery(
    postgres(url, {
      ...options,
      prepare: true,
      fetch_types: false,
      types: {
        int8: {
          to: INT8_OID,
          from: [INT8_OID],
          serialize: (value: number): string => String(value),
          parse: (value: string): number => Number(value),
        },
      },
    }),
  );
}
