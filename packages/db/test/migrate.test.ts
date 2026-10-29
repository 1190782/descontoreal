import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLocalPglite, pgliteExecutor } from "../src/local/pglite";
import { applyMigrations, formatMigrationRun } from "../src/migrate";
import { migrateThrough, SETUP_TIMEOUT_MS } from "./helpers/database";

const VERSIONS = [
  "0001_init",
  "0002_rrp_partial_matching",
  "0003_touch_same_store_matching",
  "0004_admin_review",
];

describe("applyMigrations", () => {
  let template: PGlite;
  let db: PGliteInterface;
  let directory: string | null = null;

  async function migrationsDirectory(files: Record<string, string>): Promise<string> {
    directory = await mkdtemp(join(tmpdir(), "descontoreal-migrations-"));
    for (const [name, text] of Object.entries(files)) {
      await writeFile(join(directory, name), text);
    }
    return directory;
  }

  async function appliedVersions(): Promise<string[]> {
    const result = await db.query<{ version: string }>(
      "select version from schema_migrations order by version",
    );
    return result.rows.map((row) => row.version);
  }

  async function priceColumns(): Promise<string[]> {
    const result = await db.query<{ name: string }>(
      "select column_name as name from information_schema.columns where table_name = 'price_points'",
    );
    return result.rows.map((row) => row.name);
  }

  beforeAll(async () => {
    template = await createLocalPglite();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await template.close();
  });

  beforeEach(async () => {
    db = await template.clone();
  });

  afterEach(async () => {
    await db.close();
    if (directory) {
      await rm(directory, { recursive: true, force: true });
      directory = null;
    }
  });

  it("applies the package migrations and records them", async () => {
    // Arrange
    const executor = pgliteExecutor(db);

    // Act
    const run = await applyMigrations(executor);

    // Assert
    expect(run).toEqual({ applied: VERSIONS, skipped: [] });
    expect(await appliedVersions()).toEqual(VERSIONS);
    const tables = await db.query<{ name: string | null }>(
      "select to_regclass('public.price_points')::text as name",
    );
    expect(tables.rows).toEqual([{ name: "price_points" }]);
    expect(await priceColumns()).toContain("rrp_cents");
  });

  it("skips migrations that were already applied", async () => {
    // Arrange
    const executor = pgliteExecutor(db);
    await applyMigrations(executor);

    // Act
    const run = await applyMigrations(executor);

    // Assert
    expect(run).toEqual({ applied: [], skipped: VERSIONS });
    expect(await appliedVersions()).toEqual(VERSIONS);
  });

  it("applies only the missing migrations to a database at 0001_init", async () => {
    // Arrange
    await migrateThrough(db, "0001_init");
    const columnsBefore = await priceColumns();

    // Act
    const run = await applyMigrations(pgliteExecutor(db));

    // Assert
    expect(run).toEqual({ applied: VERSIONS.slice(1), skipped: ["0001_init"] });
    expect(await appliedVersions()).toEqual(VERSIONS);
    expect(columnsBefore).not.toContain("rrp_cents");
    expect(await priceColumns()).toContain("rrp_cents");
  });

  it("applies .sql files in name order and ignores other files", async () => {
    // Arrange
    const dir = await migrationsDirectory({
      "0010_insert.sql": "insert into steps (name) values ('0010');",
      "0002_create.sql": "create table steps (id serial primary key, name text);",
      "README.md": "not a migration",
    });

    // Act
    const run = await applyMigrations(pgliteExecutor(db), { directory: dir });

    // Assert
    expect(run.applied).toEqual(["0002_create", "0010_insert"]);
    expect((await db.query("select name from steps")).rows).toEqual([{ name: "0010" }]);
  });

  it("rolls back a failing migration and keeps the ones before it", async () => {
    // Arrange
    const dir = await migrationsDirectory({
      "0001_ok.sql": "create table ok (id int);",
      "0002_broken.sql": "create table half (id int); select 1 / 0;",
    });

    // Act
    const act = applyMigrations(pgliteExecutor(db), { directory: dir });

    // Assert
    await expect(act).rejects.toThrow("division by zero");
    expect(await appliedVersions()).toEqual(["0001_ok"]);
    const half = await db.query<{ name: string | null }>("select to_regclass('public.half')::text as name");
    expect(half.rows).toEqual([{ name: null }]);
  });
});

describe("formatMigrationRun", () => {
  it("lists what was applied", () => {
    // Arrange
    const run = { applied: ["0002_b", "0003_c"], skipped: ["0001_a"] };

    // Act
    const text = formatMigrationRun(run);

    // Assert
    expect(text).toBe("Migrations applied: 0002_b, 0003_c (1 already applied).");
  });

  it("says when there is nothing to apply", () => {
    // Arrange
    const run = { applied: [], skipped: ["0001_a"] };

    // Act
    const text = formatMigrationRun(run);

    // Assert
    expect(text).toBe("Migrations: nothing to apply (1 already applied).");
  });
});
