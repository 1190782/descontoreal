import { copyFile, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite, PGliteInterface, Transaction } from "@electric-sql/pglite";
import { createLocalPglite, pgliteExecutor } from "../../src/local/pglite";
import { applyMigrations, MIGRATIONS_DIR, type MigrationRun } from "../../src/migrate";
import { seedReferenceData } from "../../src/seed";

/** PGlite starts in a few seconds; a slow CI machine needs more than Vitest's default hook timeout. */
export const SETUP_TIMEOUT_MS = 60_000;

export type ApiRole = "anon" | "authenticated" | "service_role";

/** In-memory PGlite with the Supabase shim, every migration and the core stores and categories. */
export async function createMigratedDatabase(): Promise<PGlite> {
  const db = await createLocalPglite();
  const executor = pgliteExecutor(db);
  await applyMigrations(executor);
  await seedReferenceData(executor);
  return db;
}

/** Like createMigratedDatabase, but stops after migration `lastVersion`, as a database the next ones upgrade. */
export async function createDatabaseAt(lastVersion: string): Promise<PGlite> {
  const db = await createLocalPglite();
  await migrateThrough(db, lastVersion);
  await seedReferenceData(pgliteExecutor(db));
  return db;
}

/** Applies the package migrations up to and including `lastVersion`, never the ones after it. */
export async function migrateThrough(db: PGliteInterface, lastVersion: string): Promise<MigrationRun> {
  const directory = await mkdtemp(join(tmpdir(), "descontoreal-migrations-"));
  try {
    const files = (await readdir(MIGRATIONS_DIR)).filter(
      (name) => name.endsWith(".sql") && name.slice(0, -".sql".length) <= lastVersion,
    );
    for (const file of files) {
      await copyFile(join(MIGRATIONS_DIR, file), join(directory, file));
    }
    return await applyMigrations(pgliteExecutor(db), { directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/** Empties every table the tests write to; stores and categories stay. */
export async function resetData(db: PGliteInterface): Promise<void> {
  await db.exec(`
    truncate table listing_stats, match_candidates, alerts_sent, watchlist, price_points, listings, products,
      scrape_runs, auth.users
    restart identity cascade
  `);
}

/** Runs `work` the way Supabase's API would: as `role`, with `userId` as the JWT subject. Rolls back after. */
export async function asRole<T>(
  db: PGliteInterface,
  role: ApiRole,
  userId: string | null,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    if (userId) {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role }),
      ]);
    }
    const result = await work(tx);
    await tx.rollback();
    return result;
  });
}

export async function createUser(db: PGliteInterface, email: string): Promise<string> {
  const result = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [
    email,
  ]);
  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error("auth.users insert returned no id");
  }
  return id;
}
