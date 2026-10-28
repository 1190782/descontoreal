import { createSql } from "../connection";
import { postgresExecutor } from "../executor";
import { formatSeedResult, seedReferenceData } from "../seed";
import { errorMessage, loadRootEnvFile, requireDatabaseUrl } from "./env";

try {
  loadRootEnvFile();
  const sql = createSql(requireDatabaseUrl());
  try {
    console.log(formatSeedResult(await seedReferenceData(postgresExecutor(sql))));
  } finally {
    await sql.end();
  }
} catch (error) {
  console.error(`Seed failed: ${errorMessage(error)}`);
  process.exitCode = 1;
}
