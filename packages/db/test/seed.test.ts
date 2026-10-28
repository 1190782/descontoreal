import { CATEGORIES, STORES } from "@descontoreal/core";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createLocalPglite, pgliteExecutor } from "../src/local/pglite";
import { applyMigrations } from "../src/migrate";
import { formatSeedResult, seedReferenceData } from "../src/seed";
import { SETUP_TIMEOUT_MS } from "./helpers/database";

describe("seedReferenceData", () => {
  let template: PGlite;
  let db: PGliteInterface;

  beforeAll(async () => {
    template = await createLocalPglite();
    await applyMigrations(pgliteExecutor(template));
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await template.close();
  });

  beforeEach(async () => {
    db = await template.clone();
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts every core store and category", async () => {
    // Arrange
    const executor = pgliteExecutor(db);

    // Act
    const result = await seedReferenceData(executor);

    // Assert
    expect(result).toEqual({
      stores: { inserted: STORES.length, updated: 0 },
      categories: { inserted: CATEGORIES.length, updated: 0 },
    });
    const stores = await db.query("select slug, name, base_url, active from stores order by id");
    expect(stores.rows).toEqual(
      STORES.map((store) => ({
        slug: store.slug,
        name: store.name,
        base_url: store.baseUrl,
        active: store.active,
      })),
    );
  });

  it("changes nothing when it runs again", async () => {
    // Arrange
    const executor = pgliteExecutor(db);
    await seedReferenceData(executor);

    // Act
    const result = await seedReferenceData(executor);

    // Assert
    expect(result).toEqual({ stores: { inserted: 0, updated: 0 }, categories: { inserted: 0, updated: 0 } });
    const counts = await db.query<{ stores: number; categories: number }>(
      "select (select count(*)::int from stores) as stores, (select count(*)::int from categories) as categories",
    );
    expect(counts.rows).toEqual([{ stores: STORES.length, categories: CATEGORIES.length }]);
  });

  it("stores each category's parent and singular", async () => {
    // Arrange
    const executor = pgliteExecutor(db);

    // Act
    await seedReferenceData(executor);

    // Assert
    const rows = await db.query(
      `select c.slug, c.name, c.singular, parent.slug as parent
       from categories c left join categories parent on parent.id = c.parent_id
       where c.slug in ('grandes-eletrodomesticos', 'maquinas-de-lavar-roupa')
       order by c.id`,
    );
    expect(rows.rows).toEqual([
      { slug: "grandes-eletrodomesticos", name: "Grandes eletrodomésticos", singular: null, parent: null },
      {
        slug: "maquinas-de-lavar-roupa",
        name: "Máquinas de lavar roupa",
        singular: "máquina de lavar roupa",
        parent: "grandes-eletrodomesticos",
      },
    ]);
  });

  it("restores rows that drifted from core", async () => {
    // Arrange
    const executor = pgliteExecutor(db);
    await seedReferenceData(executor);
    await db.exec(`
      update stores set name = 'Old name', active = not active where slug = 'darty';
      update categories set parent_id = null where slug = 'televisores';
    `);

    // Act
    const result = await seedReferenceData(executor);

    // Assert
    expect(result).toEqual({ stores: { inserted: 0, updated: 1 }, categories: { inserted: 0, updated: 1 } });
    const darty = await db.query("select name, active from stores where slug = 'darty'");
    expect(darty.rows).toEqual([{ name: "Darty", active: true }]);
    const tv = await db.query(
      "select parent.slug as parent from categories c join categories parent on parent.id = c.parent_id where c.slug = 'televisores'",
    );
    expect(tv.rows).toEqual([{ parent: "tv-e-som" }]);
  });
});

describe("formatSeedResult", () => {
  it("summarizes the counts", () => {
    // Arrange
    const result = { stores: { inserted: 4, updated: 0 }, categories: { inserted: 50, updated: 2 } };

    // Act
    const text = formatSeedResult(result);

    // Assert
    expect(text).toBe("Seed: stores 4 inserted, 0 updated; categories 50 inserted, 2 updated.");
  });
});
