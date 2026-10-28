import type { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLocalPglite } from "../../src/local/pglite";
import { serveOverSocket } from "../../src/local/server";
import { SETUP_TIMEOUT_MS } from "../helpers/database";

describe("serveOverSocket", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createLocalPglite();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  it("serves the database over the Postgres protocol until stopped", async () => {
    // Arrange
    const served = await serveOverSocket(db, { port: 0 });
    const sql = postgres(served.databaseUrl, { max: 1, connect_timeout: 5 });

    // Act
    const rows = await sql<{ answer: number }[]>`select 41 + 1 as answer`;
    await sql.end();
    await served.stop();

    // Assert
    expect(served.databaseUrl).toMatch(/^postgresql:\/\/postgres:postgres@127\.0\.0\.1:\d+\/postgres$/);
    expect(rows).toEqual([{ answer: 42 }]);
    const afterStop = postgres(served.databaseUrl, { max: 1, connect_timeout: 5 });
    await expect(afterStop`select 1`).rejects.toThrow();
    await afterStop.end();
  });
});
