import { CATEGORIES, STORES } from "@descontoreal/core";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asRole, createMigratedDatabase, createUser, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import { DAY_1, ingest, insertProduct, listingDetails, observation } from "../helpers/fixtures";

describe("row level security and grants", () => {
  let db: PGlite;
  let alice: string;
  let bob: string;
  let productId: number;
  let soldListingId: number;

  beforeAll(async () => {
    db = await createMigratedDatabase();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await resetData(db);
    alice = await createUser(db, "alice@example.pt");
    bob = await createUser(db, "bob@example.pt");
    productId = await insertProduct(db, { name: "Samsung WW90T534DAE", slug: "samsung-ww90t534dae" });
    const [sold] = await ingest(db, "darty", DAY_1, [
      observation("SOLD"),
      observation("MARKETPLACE", { soldByStore: false }),
    ]);
    soldListingId = sold?.listing_id ?? 0;
    await db.query("insert into scrape_runs (store_id) select id from stores where slug = 'darty'");
    await db.query(
      `insert into match_candidates (listing_id, candidate_product_id, confidence) values ($1, $2, 0.9)`,
      [soldListingId, productId],
    );
    await db.query(`insert into watchlist (user_id, product_id) values ($1, $3), ($2, $3)`, [
      alice,
      bob,
      productId,
    ]);
    await db.query(
      `insert into alerts_sent (user_id, listing_id, price_cents) values ($1, $3, 49999), ($2, $3, 49999)`,
      [alice, bob, soldListingId],
    );
  });

  describe("as anon", () => {
    it("reads stores, categories, products, prices and listings sold by the store", async () => {
      // Arrange
      const tables = ["stores", "categories", "products", "price_points"];

      // Act
      const counts = await asRole(db, "anon", null, async (tx) => {
        const result: Record<string, number> = {};
        for (const table of [...tables, "listings"]) {
          const rows = await tx.query<{ count: number }>(`select count(*)::int as count from ${table}`);
          result[table] = rows.rows[0]?.count ?? 0;
        }
        return result;
      });

      // Assert
      expect(counts).toEqual({
        stores: STORES.length,
        categories: CATEGORIES.length,
        products: 1,
        price_points: 1,
        listings: 1,
      });
    });

    it("cannot write public tables", async () => {
      // Arrange
      const insert = "insert into products (name, slug) values ('X', 'x')";

      // Act
      const act = asRole(db, "anon", null, async (tx) => await tx.query(insert));

      // Assert
      await expect(act).rejects.toThrow("permission denied for table products");
    });

    it.each(["scrape_runs", "match_candidates", "watchlist", "alerts_sent"])(
      "cannot read %s",
      async (table) => {
        // Arrange
        const select = `select * from ${table}`;

        // Act
        const act = asRole(db, "anon", null, async (tx) => await tx.query(select));

        // Assert
        await expect(act).rejects.toThrow(`permission denied for table ${table}`);
      },
    );

    it("cannot run the write functions", async () => {
      // Arrange
      const items = JSON.stringify([observation("X")]);

      // Act
      const act = asRole(
        db,
        "anon",
        null,
        async (tx) =>
          await tx.query("select * from ingest_observations('darty', now(), $1::text::jsonb)", [items]),
      );

      // Assert
      await expect(act).rejects.toThrow("permission denied for function ingest_observations");
    });
  });

  describe("as an authenticated user", () => {
    it("sees only their own watchlist rows and alerts", async () => {
      // Arrange
      const user = alice;

      // Act
      const seen = await asRole(db, "authenticated", user, async (tx) => ({
        watchlist: (await tx.query<{ user_id: string }>("select user_id from watchlist")).rows,
        alerts: (await tx.query<{ user_id: string }>("select user_id from alerts_sent")).rows,
      }));

      // Assert
      expect(seen).toEqual({ watchlist: [{ user_id: alice }], alerts: [{ user_id: alice }] });
    });

    it("adds and removes products from their own watchlist", async () => {
      // Arrange
      const otherProduct = await insertProduct(db, { name: "LG OLED55C46LA", slug: "lg-oled55c46la" });

      // Act
      const changed = await asRole(db, "authenticated", alice, async (tx) => {
        await tx.query(
          "insert into watchlist (user_id, product_id, target_price_cents) values ($1, $2, 39999)",
          [alice, otherProduct],
        );
        const deleted = await tx.query("delete from watchlist where product_id = $1", [productId]);
        return {
          deleted: deleted.affectedRows,
          rows: (await tx.query("select * from watchlist")).rows.length,
        };
      });

      // Assert
      expect(changed).toEqual({ deleted: 1, rows: 1 });
    });

    it("cannot add a row for another user", async () => {
      // Arrange
      const otherProduct = await insertProduct(db, { name: "LG OLED55C46LA", slug: "lg-oled55c46la" });

      // Act
      const act = asRole(
        db,
        "authenticated",
        alice,
        async (tx) =>
          await tx.query("insert into watchlist (user_id, product_id) values ($1, $2)", [bob, otherProduct]),
      );

      // Assert
      await expect(act).rejects.toThrow("row-level security");
    });

    it("cannot change or delete another user's rows", async () => {
      // Arrange
      const target = bob;

      // Act
      const affected = await asRole(db, "authenticated", alice, async (tx) => ({
        updated: (await tx.query("update watchlist set notify_any_drop = false where user_id = $1", [target]))
          .affectedRows,
        deleted: (await tx.query("delete from watchlist where user_id = $1", [target])).affectedRows,
      }));

      // Assert
      expect(affected).toEqual({ updated: 0, deleted: 0 });
    });

    it("cannot run the write functions", async () => {
      // Arrange
      const input = JSON.stringify(listingDetails(soldListingId));

      // Act
      const act = asRole(
        db,
        "authenticated",
        alice,
        async (tx) => await tx.query("select save_listing_details($1::text::jsonb, null)", [input]),
      );

      // Assert
      await expect(act).rejects.toThrow("permission denied for function save_listing_details");
    });
  });

  describe("as service_role", () => {
    it("runs the write functions and reads every table", async () => {
      // Arrange
      const items = JSON.stringify([observation("NEW")]);

      // Act
      const result = await asRole(db, "service_role", null, async (tx) => ({
        ingested: (
          await tx.query<{ status: string }>(
            "select status from ingest_observations('darty', now(), $1::text::jsonb)",
            [items],
          )
        ).rows,
        outcome: (
          await tx.query<{ outcome: string }>(
            "select save_listing_details($1::text::jsonb, now()) as outcome",
            [JSON.stringify(listingDetails(soldListingId))],
          )
        ).rows,
        runs: (await tx.query("select * from scrape_runs")).rows.length,
      }));

      // Assert
      expect(result).toEqual({ ingested: [{ status: "new" }], outcome: [{ outcome: "candidate" }], runs: 1 });
    });
  });

  describe("functions in public", () => {
    const FUNCTIONS = `
      select p.proname as name, has_function_privilege($1::text::name, p.oid, 'execute') as allowed
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
      order by p.proname`;

    it("anon cannot run any of them", async () => {
      // Arrange
      const params = ["anon"];

      // Act
      const result = await db.query<{ name: string; allowed: boolean }>(FUNCTIONS, params);

      // Assert
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows.filter((row) => row.allowed)).toEqual([]);
    });

    it("authenticated runs only the admin review functions, which refuse anyone but an admin", async () => {
      // Arrange
      const params = ["authenticated"];

      // Act
      const result = await db.query<{ name: string; allowed: boolean }>(FUNCTIONS, params);

      // Assert
      expect(result.rows.filter((row) => row.allowed).map((row) => row.name)).toEqual([
        "admin_approve_match",
        "admin_reject_match",
        "admin_review_queue",
        "admin_split_listing",
        "is_admin",
      ]);
    });

    it("service_role runs every one of them", async () => {
      // Arrange
      const params = ["service_role"];

      // Act
      const result = await db.query<{ name: string; allowed: boolean }>(FUNCTIONS, params);

      // Assert
      expect(result.rows.map((row) => row.name)).toEqual(
        expect.arrayContaining([
          "ingest_observations",
          "link_unmatched_listing",
          "same_brand_other_model",
          "touch_listings",
          "listed_by_same_store",
        ]),
      );
      expect(result.rows.filter((row) => !row.allowed)).toEqual([]);
    });
  });

  it("deleting an account deletes its watchlist and alerts", async () => {
    // Arrange
    const user = alice;

    // Act
    await db.query("delete from auth.users where id = $1", [user]);

    // Assert
    const remaining = await db.query<{ user_id: string }>(
      "select user_id from watchlist union all select user_id from alerts_sent",
    );
    expect(remaining.rows.map((row) => row.user_id)).toEqual([bob, bob]);
  });
});
