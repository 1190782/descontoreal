import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSql, type DbSql } from "../src/connection";
import { postgresExecutor, type SqlExecutor } from "../src/executor";
import { createLocalPglite } from "../src/local/pglite";
import { serveOverSocket, type ServedDatabase } from "../src/local/server";
import { applyMigrations } from "../src/migrate";
import { seedReferenceData } from "../src/seed";
import { SETUP_TIMEOUT_MS } from "./helpers/database";

describe("postgresExecutor", () => {
  let db: PGlite;
  let served: ServedDatabase;
  let sql: DbSql;
  let executor: SqlExecutor;

  beforeAll(async () => {
    db = await createLocalPglite();
    served = await serveOverSocket(db, { port: 0 });
    sql = createSql(served.databaseUrl);
    executor = postgresExecutor(sql);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await sql.end();
    await served.stop();
    await db.close();
  });

  it("applies the migrations and the seed the way pnpm db:migrate does", async () => {
    // Arrange
    const target = executor;

    // Act
    const migrations = await applyMigrations(target);
    const seed = await seedReferenceData(target);

    // Assert
    expect(migrations.applied).toEqual([
      "0001_init",
      "0002_rrp_partial_matching",
      "0003_touch_same_store_matching",
      "0004_admin_review",
    ]);
    expect(seed.stores.inserted).toBe(4);
    expect(seed.categories.inserted).toBeGreaterThan(0);
  });

  it("runs parameterized queries", async () => {
    // Arrange
    const text = "select $1::int + 1 as answer, $2::text as word";

    // Act
    const rows = await executor.query<{ answer: number; word: string }>(text, [41, "olá"]);

    // Assert
    expect(rows).toEqual([{ answer: 42, word: "olá" }]);
  });

  it("rolls the transaction back when the work fails", async () => {
    // Arrange
    const work = async (tx: SqlExecutor): Promise<void> => {
      await tx.exec("create table rolled_back (id int)");
      throw new Error("boom");
    };

    // Act
    const act = executor.transaction(work);

    // Assert
    await expect(act).rejects.toThrow("boom");
    const rows = await executor.query<{ name: string | null }>(
      "select to_regclass('rolled_back')::text as name",
    );
    expect(rows).toEqual([{ name: null }]);
  });

  it("refuses nested transactions", async () => {
    // Arrange
    const work = async (tx: SqlExecutor): Promise<void> => {
      await tx.transaction(async () => {
        await Promise.resolve();
      });
    };

    // Act
    const act = executor.transaction(work);

    // Assert
    await expect(act).rejects.toThrow("Nested transactions are not supported.");
  });
});
