import { createSql } from "../connection";
import { postgresExecutor } from "../executor";
import { applyMigrations, formatMigrationRun } from "../migrate";
import { formatSeedResult, seedReferenceData } from "../seed";
import { errorMessage, loadRootEnvFile, requireDatabaseUrl } from "./env";

try {
  loadRootEnvFile();
  const sql = createSql(requireDatabaseUrl());
  try {
    const executor = postgresExecutor(sql);
    console.log(formatMigrationRun(await applyMigrations(executor)));
    console.log(formatSeedResult(await seedReferenceData(executor)));
  } finally {
    await sql.end();
  }
} catch (error) {
  console.error(`Migration failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
