import { createSql, parseDatabaseUrl } from "../connection";
import { postgresExecutor } from "../executor";
import { seedDemoData } from "../local/demo";
import { LOCAL_HOST, LOCAL_PORT } from "../local/server";
import { errorMessage } from "./env";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const DEMO_OPTIONS = { days: 120, products: 80, seed: 20_261_028 };

// Never reads .env: that file holds the production DATABASE_URL, and this writes made-up data.
const databaseUrl =
  process.env.DATABASE_URL ?? `postgresql://postgres:postgres@${LOCAL_HOST}:${LOCAL_PORT}/postgres`;

try {
  if (!LOCAL_HOSTS.has(parseDatabaseUrl(databaseUrl).hostname)) {
    throw new Error("demo data only goes into a local database (pnpm db:local).");
  }
  const sql = createSql(databaseUrl);
  try {
    const result = await seedDemoData(postgresExecutor(sql), { ...DEMO_OPTIONS, now: new Date() });
    console.log(
      `Demo data: ${result.products} products, ${result.listings} listings, ${result.prices} prices. ` +
        "Now run pnpm stats with the same DATABASE_URL for the labels.",
    );
  } finally {
    await sql.end();
  }
} catch (error) {
  console.error(`Demo data failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
