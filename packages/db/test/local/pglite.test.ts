import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SqlExecutor } from "../../src/executor";
import { createLocalPglite, pgliteExecutor } from "../../src/local/pglite";
import { SETUP_TIMEOUT_MS } from "../helpers/database";

describe("createLocalPglite", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createLocalPglite();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  it("creates the Supabase roles, schemas and auth.users", async () => {
    // Arrange
    const query = `
      select
        (select array_agg(rolname order by rolname) from pg_roles
          where rolname in ('anon', 'authenticated', 'service_role')) as roles,
        (select array_agg(nspname order by nspname) from pg_namespace where nspname in ('auth', 'extensions')) as schemas,
        to_regclass('auth.users')::text as users
    `;

    // Act
    const result = await db.query(query);

    // Assert
    expect(result.rows).toEqual([
      {
        roles: ["anon", "authenticated", "service_role"],
        schemas: ["auth", "extensions"],
        users: "auth.users",
      },
    ]);
  });

  it("reads auth.uid() from the request's JWT claims", async () => {
    // Arrange
    const userId = "6f1b2c4e-0a7d-4f5e-9b1a-2c3d4e5f6a7b";

    // Act
    const uid = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId })]);
      return (await tx.query<{ uid: string }>("select auth.uid() as uid")).rows[0]?.uid;
    });

    // Assert
    expect(uid).toBe(userId);
  });

  it(
    "keeps data in dataDir across restarts, running the shim again",
    async () => {
      // Arrange
      const directory = await mkdtemp(join(tmpdir(), "descontoreal-pglite-"));
      const dataDir = join(directory, "nested", "pglite");

      try {
        // Act
        const first = await createLocalPglite(dataDir);
        await first.exec("create table kept (value text); insert into kept values ('olá');");
        await first.close();
        const second = await createLocalPglite(dataDir);
        const rows = (await second.query("select value from kept")).rows;
        await second.close();

        // Assert
        expect(rows).toEqual([{ value: "olá" }]);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    SETUP_TIMEOUT_MS,
  );
});

describe("pgliteExecutor", () => {
  let db: PGlite;
  let executor: SqlExecutor;

  beforeAll(async () => {
    db = await createLocalPglite();
    executor = pgliteExecutor(db);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  it("commits the work of a transaction", async () => {
    // Arrange
    await executor.exec("create table committed (value int)");

    // Act
    await executor.transaction(async (tx) => {
      await tx.query("insert into committed values ($1)", [7]);
    });

    // Assert
    expect(await executor.query("select value from committed")).toEqual([{ value: 7 }]);
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
    expect(await executor.query("select to_regclass('rolled_back')::text as name")).toEqual([{ name: null }]);
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
