import type { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

export const LOCAL_HOST = "127.0.0.1";
export const LOCAL_PORT = 54329;
const MAX_CONNECTIONS = 4;

export interface SocketServerOptions {
  host?: string;
  /** 0 picks a free port. */
  port?: number;
}

export interface ServedDatabase {
  /** postgresql:// URL for DATABASE_URL. PGlite accepts any password. */
  databaseUrl: string;
  stop(): Promise<void>;
}

/** Serves `db` over the Postgres wire protocol, so postgres.js (and psql) can connect to it. */
export async function serveOverSocket(
  db: PGlite,
  options: SocketServerOptions = {},
): Promise<ServedDatabase> {
  const server = new PGLiteSocketServer({
    db,
    host: options.host ?? LOCAL_HOST,
    port: options.port ?? LOCAL_PORT,
    maxConnections: MAX_CONNECTIONS,
  });
  await server.start();
  return {
    databaseUrl: `postgresql://postgres:postgres@${server.getServerConn()}/postgres`,
    async stop(): Promise<void> {
      await server.stop();
    },
  };
}
