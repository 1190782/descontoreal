import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { createLocalPglite } from "../local/pglite";
import { LOCAL_PORT, serveOverSocket, type ServedDatabase } from "../local/server";
import { errorMessage, REPO_ROOT } from "./env";

const DATA_DIR = join(REPO_ROOT, ".cache", "pglite");

async function serve(db: PGlite): Promise<ServedDatabase> {
  try {
    return await serveOverSocket(db, { port: LOCAL_PORT });
  } catch (error) {
    await db.close();
    throw error;
  }
}

try {
  const db = await createLocalPglite(DATA_DIR);
  const served = await serve(db);

  console.log(`Local database (PGlite) in ${DATA_DIR}, listening on port ${LOCAL_PORT}.`);
  console.log("Use this in .env, then run pnpm db:migrate:");
  console.log(`DATABASE_URL=${served.databaseUrl}`);
  console.log("One client at a time works best. Ctrl+C stops it.");

  const shutdown = async (): Promise<void> => {
    await served.stop();
    await db.close();
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
} catch (error) {
  console.error(`Local database failed to start: ${errorMessage(error)}`);
  process.exitCode = 1;
}
