import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlExecutor } from "./executor";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations/", import.meta.url));

// Any constant works: it only has to be the same for every run of the migrations.
const MIGRATION_LOCK_KEY = 20_261_027;

export interface MigrationRun {
  /** Versions applied by this run, in order. */
  applied: string[];
  /** Versions that were already applied before. */
  skipped: string[];
}

/**
 * Applies `<directory>/*.sql` in file name order, each in its own transaction, and records each version
 * (the file name without .sql) in schema_migrations. Applied versions are skipped.
 */
export async function applyMigrations(
  executor: SqlExecutor,
  options: { directory?: string } = {},
): Promise<MigrationRun> {
  const directory = options.directory ?? MIGRATIONS_DIR;
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).toSorted();
  await executor.exec(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
    alter table schema_migrations enable row level security;
  `);

  const run: MigrationRun = { applied: [], skipped: [] };
  for (const file of files) {
    const version = file.slice(0, -".sql".length);
    const text = await readFile(join(directory, file), "utf8");
    await executor.transaction(async (tx) => {
      // Two runs at once (CI and a laptop) wait for each other instead of both applying the same file.
      await tx.query("select pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
      const existing = await tx.query<{ version: string }>(
        "select version from schema_migrations where version = $1",
        [version],
      );
      if (existing.length > 0) {
        run.skipped.push(version);
        return;
      }
      await tx.exec(text);
      await tx.query("insert into schema_migrations (version) values ($1)", [version]);
      run.applied.push(version);
    });
  }
  return run;
}

export function formatMigrationRun(run: MigrationRun): string {
  if (run.applied.length === 0) {
    return `Migrations: nothing to apply (${run.skipped.length} already applied).`;
  }
  return `Migrations applied: ${run.applied.join(", ")} (${run.skipped.length} already applied).`;
}
