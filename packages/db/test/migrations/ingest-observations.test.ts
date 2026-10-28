import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  DAY_1,
  DAY_2,
  DAY_3,
  getListing,
  ingest,
  intervals,
  listingDetails,
  observation,
  saveDetails,
} from "../helpers/fixtures";

describe("ingest_observations", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await resetData(db);
  });

  it("creates a new listing with one open price interval", async () => {
    // Arrange
    const item = observation("A1", { priceCents: 49_999, referencePriceCents: 59_999 });

    // Act
    const [result] = await ingest(db, "darty", DAY_1, [item]);

    // Assert
    expect(result).toMatchObject({ store_sku: "A1", status: "new", product_id: null, product_slug: null });
    const listing = await getListing(db, result?.listing_id ?? 0);
    expect(listing).toMatchObject({
      url: item.url,
      raw_title: item.rawTitle,
      sold_by_store: true,
      first_seen_at: DAY_1,
      last_seen_at: DAY_1,
      active: true,
      missed_runs: 0,
    });
    expect(await intervals(db, listing.id)).toEqual([
      {
        price_cents: 49_999,
        reference_price_cents: 59_999,
        rrp_cents: null,
        in_stock: true,
        valid_from: DAY_1,
        valid_to: null,
      },
    ]);
  });

  it("only moves last_seen_at when price, reference and stock are the same", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1")]);

    // Act
    const [second] = await ingest(db, "darty", DAY_2, [observation("A1")]);

    // Assert
    expect(second?.status).toBe("unchanged");
    const listing = await getListing(db, first?.listing_id ?? 0);
    expect(listing.first_seen_at).toEqual(DAY_1);
    expect(listing.last_seen_at).toEqual(DAY_2);
    expect(await intervals(db, listing.id)).toEqual([
      {
        price_cents: 49_999,
        reference_price_cents: null,
        rrp_cents: null,
        in_stock: true,
        valid_from: DAY_1,
        valid_to: null,
      },
    ]);
  });

  it("closes the interval and opens a new one when the price changes", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { priceCents: 49_999 })]);

    // Act
    const [second] = await ingest(db, "darty", DAY_2, [observation("A1", { priceCents: 44_999 })]);

    // Assert
    expect(second?.status).toBe("changed");
    expect(await intervals(db, first?.listing_id ?? 0)).toEqual([
      {
        price_cents: 49_999,
        reference_price_cents: null,
        rrp_cents: null,
        in_stock: true,
        valid_from: DAY_1,
        valid_to: DAY_2,
      },
      {
        price_cents: 44_999,
        reference_price_cents: null,
        rrp_cents: null,
        in_stock: true,
        valid_from: DAY_2,
        valid_to: null,
      },
    ]);
  });

  it("opens a new interval when only the stock changes", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { inStock: true })]);

    // Act
    const [second] = await ingest(db, "darty", DAY_2, [observation("A1", { inStock: false })]);

    // Assert
    expect(second?.status).toBe("changed");
    const rows = await intervals(db, first?.listing_id ?? 0);
    expect(rows.map((row) => [row.in_stock, row.valid_from, row.valid_to])).toEqual([
      [true, DAY_1, DAY_2],
      [false, DAY_2, null],
    ]);
  });

  it("opens a new interval when only the reference price changes", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { referencePriceCents: null })]);

    // Act
    const [second] = await ingest(db, "darty", DAY_2, [observation("A1", { referencePriceCents: 59_999 })]);

    // Assert
    expect(second?.status).toBe("changed");
    const rows = await intervals(db, first?.listing_id ?? 0);
    expect(rows.map((row) => [row.reference_price_cents, row.valid_to])).toEqual([
      [null, DAY_2],
      [59_999, null],
    ]);
  });

  it("keeps a marketplace listing without recording prices", async () => {
    // Arrange
    const item = observation("M1", { soldByStore: false });

    // Act
    const [result] = await ingest(db, "darty", DAY_1, [item]);

    // Assert
    expect(result?.status).toBe("new");
    const listing = await getListing(db, result?.listing_id ?? 0);
    expect(listing.sold_by_store).toBe(false);
    expect(await intervals(db, listing.id)).toEqual([]);
  });

  it("closes the open interval when a listing stops being sold by the store", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1")]);

    // Act
    const [second] = await ingest(db, "darty", DAY_2, [observation("A1", { soldByStore: false })]);

    // Assert
    expect(second?.status).toBe("changed");
    expect((await getListing(db, first?.listing_id ?? 0)).sold_by_store).toBe(false);
    const rows = await intervals(db, first?.listing_id ?? 0);
    expect(rows.map((row) => [row.valid_from, row.valid_to])).toEqual([[DAY_1, DAY_2]]);
  });

  it("opens a new interval when the store sells the listing again", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1")]);
    await ingest(db, "darty", DAY_2, [observation("A1", { soldByStore: false })]);

    // Act
    const [third] = await ingest(db, "darty", DAY_3, [observation("A1", { priceCents: 39_999 })]);

    // Assert
    expect(third?.status).toBe("changed");
    const rows = await intervals(db, first?.listing_id ?? 0);
    expect(rows.map((row) => [row.price_cents, row.valid_from, row.valid_to])).toEqual([
      [49_999, DAY_1, DAY_2],
      [39_999, DAY_3, null],
    ]);
  });

  it("ignores an observation older than the last one", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_2, [observation("A1", { priceCents: 44_999 })]);

    // Act
    const [late] = await ingest(db, "darty", DAY_1, [
      observation("A1", { priceCents: 49_999, rawTitle: "Old title" }),
    ]);

    // Assert
    expect(late?.status).toBe("unchanged");
    const listing = await getListing(db, first?.listing_id ?? 0);
    expect(listing.last_seen_at).toEqual(DAY_2);
    expect(listing.raw_title).toBe("Produto A1");
    expect(await intervals(db, listing.id)).toEqual([
      {
        price_cents: 44_999,
        reference_price_cents: null,
        rrp_cents: null,
        in_stock: true,
        valid_from: DAY_2,
        valid_to: null,
      },
    ]);
  });

  it("keeps one interval when the same item is read twice at the same instant", async () => {
    // Arrange
    const items = [observation("A1", { priceCents: 49_999 }), observation("A1", { priceCents: 47_999 })];

    // Act
    const results = await ingest(db, "darty", DAY_1, items);

    // Assert
    expect(results.map((row) => row.status)).toEqual(["new", "changed"]);
    expect(await intervals(db, results[0]?.listing_id ?? 0)).toEqual([
      {
        price_cents: 47_999,
        reference_price_cents: null,
        rrp_cents: null,
        in_stock: true,
        valid_from: DAY_1,
        valid_to: null,
      },
    ]);
  });

  it("returns one row per item, in order, with the linked product", async () => {
    // Arrange
    const [linked] = await ingest(db, "darty", DAY_1, [observation("A1")]);
    await saveDetails(db, listingDetails(linked?.listing_id ?? 0));

    // Act
    const results = await ingest(db, "darty", DAY_2, [observation("B2"), observation("A1")]);

    // Assert
    expect(results.map((row) => [row.store_sku, row.status, row.product_slug])).toEqual([
      ["B2", "new", null],
      ["A1", "unchanged", "samsung-ww90t534dae-maquina-de-lavar-roupa"],
    ]);
    expect(results[1]?.product_id).toEqual(expect.any(Number));
  });

  it("keeps listings of different stores apart", async () => {
    // Arrange
    const [darty] = await ingest(db, "darty", DAY_1, [observation("A1")]);

    // Act
    const [radioPopular] = await ingest(db, "radiopopular", DAY_1, [observation("A1")]);

    // Assert
    expect(radioPopular?.status).toBe("new");
    expect(radioPopular?.listing_id).not.toBe(darty?.listing_id);
  });

  it("rejects an unknown store", async () => {
    // Arrange
    const items = [observation("A1")];

    // Act
    const act = ingest(db, "nope", DAY_1, items);

    // Assert
    await expect(act).rejects.toThrow("unknown store nope");
  });

  it("rejects an item sold by the store without a price", async () => {
    // Arrange
    const item = { ...observation("A1"), priceCents: null };

    // Act
    const act = db.query("select * from ingest_observations('darty', $1, $2::text::jsonb)", [
      DAY_1,
      JSON.stringify([item]),
    ]);

    // Assert
    await expect(act).rejects.toThrow("incomplete item");
  });

  it("rejects prices that are not integer cents", async () => {
    // Arrange
    const item = observation("A1", { priceCents: 499.99 });

    // Act
    const act = ingest(db, "darty", DAY_1, [item]);

    // Assert
    await expect(act).rejects.toThrow();
  });

  describe("PVPr", () => {
    it("stores the PVPr apart from the reference price on a new interval", async () => {
      // Arrange
      const item = observation("A1", { priceCents: 44_999, referencePriceCents: null, rrpCents: 54_999 });

      // Act
      const [result] = await ingest(db, "darty", DAY_1, [item]);

      // Assert
      expect(await intervals(db, result?.listing_id ?? 0)).toEqual([
        {
          price_cents: 44_999,
          reference_price_cents: null,
          rrp_cents: 54_999,
          in_stock: true,
          valid_from: DAY_1,
          valid_to: null,
        },
      ]);
    });

    it("stores no PVPr for items without one, sent as null or left out", async () => {
      // Arrange
      const items = [observation("A1", { rrpCents: null }), observation("B2")];

      // Act
      const results = await ingest(db, "darty", DAY_1, items);

      // Assert
      expect(results.map((row) => row.status)).toEqual(["new", "new"]);
      const rows = [
        ...(await intervals(db, results[0]?.listing_id ?? 0)),
        ...(await intervals(db, results[1]?.listing_id ?? 0)),
      ];
      expect(rows.map((row) => [row.price_cents, row.rrp_cents])).toEqual([
        [49_999, null],
        [49_999, null],
      ]);
    });

    it("updates the open interval in place when only the PVPr changes", async () => {
      // Arrange
      const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { rrpCents: 54_999 })]);

      // Act
      const [second] = await ingest(db, "darty", DAY_2, [observation("A1", { rrpCents: 52_999 })]);

      // Assert
      expect(second?.status).toBe("unchanged");
      const listing = await getListing(db, first?.listing_id ?? 0);
      expect(listing.last_seen_at).toEqual(DAY_2);
      expect(await intervals(db, listing.id)).toEqual([
        {
          price_cents: 49_999,
          reference_price_cents: null,
          rrp_cents: 52_999,
          in_stock: true,
          valid_from: DAY_1,
          valid_to: null,
        },
      ]);
    });

    it("clears the PVPr in place when the store stops showing it", async () => {
      // Arrange
      const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { rrpCents: 54_999 })]);

      // Act
      const [second] = await ingest(db, "darty", DAY_2, [observation("A1")]);

      // Assert
      expect(second?.status).toBe("unchanged");
      const rows = await intervals(db, first?.listing_id ?? 0);
      expect(rows.map((row) => [row.rrp_cents, row.valid_from, row.valid_to])).toEqual([[null, DAY_1, null]]);
    });

    it("opens the new interval with the new PVPr when the price changes", async () => {
      // Arrange
      const [first] = await ingest(db, "darty", DAY_1, [
        observation("A1", { priceCents: 49_999, rrpCents: 54_999 }),
      ]);

      // Act
      const [second] = await ingest(db, "darty", DAY_2, [
        observation("A1", { priceCents: 44_999, rrpCents: 52_999 }),
      ]);

      // Assert
      expect(second?.status).toBe("changed");
      const rows = await intervals(db, first?.listing_id ?? 0);
      expect(rows.map((row) => [row.price_cents, row.rrp_cents, row.valid_from, row.valid_to])).toEqual([
        [49_999, 54_999, DAY_1, DAY_2],
        [44_999, 52_999, DAY_2, null],
      ]);
    });

    it("stores the PVPr when the store sells the listing again", async () => {
      // Arrange
      const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { rrpCents: 54_999 })]);
      await ingest(db, "darty", DAY_2, [observation("A1", { soldByStore: false })]);

      // Act
      const [third] = await ingest(db, "darty", DAY_3, [observation("A1", { rrpCents: 52_999 })]);

      // Assert
      expect(third?.status).toBe("changed");
      const rows = await intervals(db, first?.listing_id ?? 0);
      expect(rows.map((row) => [row.rrp_cents, row.valid_from, row.valid_to])).toEqual([
        [54_999, DAY_1, DAY_2],
        [52_999, DAY_3, null],
      ]);
    });

    it("ignores the PVPr of an observation older than the last one", async () => {
      // Arrange
      const [first] = await ingest(db, "darty", DAY_2, [observation("A1", { rrpCents: 52_999 })]);

      // Act
      const [late] = await ingest(db, "darty", DAY_1, [observation("A1", { rrpCents: 54_999 })]);

      // Assert
      expect(late?.status).toBe("unchanged");
      const rows = await intervals(db, first?.listing_id ?? 0);
      expect(rows.map((row) => [row.rrp_cents, row.valid_from])).toEqual([[52_999, DAY_2]]);
    });

    it("rejects a PVPr that is not a positive price", async () => {
      // Arrange
      const item = observation("A1", { rrpCents: 0 });

      // Act
      const act = ingest(db, "darty", DAY_1, [item]);

      // Assert
      await expect(act).rejects.toThrow("price_points_rrp_cents_check");
    });
  });
});
