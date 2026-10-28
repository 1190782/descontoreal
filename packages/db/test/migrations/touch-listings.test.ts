import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  DAY_1,
  DAY_2,
  DAY_3,
  DAY_4,
  DAY_5,
  getListing,
  ingest,
  intervals,
  observation,
} from "../helpers/fixtures";

describe("touch_listings", () => {
  let db: PGlite;

  async function touch(storeSlug: string, storeSkus: string[]): Promise<number | undefined> {
    const result = await db.query<{ touched: number }>("select touch_listings($1, $2) as touched", [
      storeSlug,
      storeSkus,
    ]);
    return result.rows[0]?.touched;
  }

  async function markMissing(seenSince: Date, storeSlug = "darty"): Promise<void> {
    await db.query("select * from mark_missing_listings($1, $2)", [storeSlug, seenSince]);
  }

  beforeAll(async () => {
    db = await createMigratedDatabase();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await resetData(db);
  });

  it("resets the listing's missed runs, keeping its prices and its last reading with a price", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { priceCents: 49_999 })]);
    await ingest(db, "darty", DAY_2, [observation("A1", { priceCents: 44_999, rrpCents: 54_999 })]);
    await markMissing(DAY_3);
    await markMissing(DAY_4);
    const listingId = first?.listing_id ?? 0;
    const pricesBefore = await intervals(db, listingId);

    // Act
    const touched = await touch("darty", ["A1"]);

    // Assert
    expect(touched).toBe(1);
    expect(await getListing(db, listingId)).toMatchObject({
      first_seen_at: DAY_1,
      last_seen_at: DAY_2,
      missed_runs: 0,
      active: true,
    });
    expect(pricesBefore).toHaveLength(2);
    expect(await intervals(db, listingId)).toEqual(pricesBefore);
  });

  it("leaves a listing seen every day without a price one missed run, never deactivated", async () => {
    // Arrange
    const [seen] = await ingest(db, "darty", DAY_1, [observation("A1")]);
    const listingId = seen?.listing_id ?? 0;

    // Act
    for (const runStart of [DAY_2, DAY_3, DAY_4, DAY_5]) {
      await touch("darty", ["A1"]);
      await markMissing(runStart);
    }

    // Assert
    expect(await getListing(db, listingId)).toMatchObject({
      last_seen_at: DAY_1,
      missed_runs: 1,
      active: true,
    });
    expect((await intervals(db, listingId)).map((row) => row.valid_to)).toEqual([null]);
  });

  it("reactivates a deactivated listing without reopening its price", async () => {
    // Arrange
    const [gone] = await ingest(db, "darty", DAY_1, [observation("GONE")]);
    for (const day of [DAY_2, DAY_3, DAY_4]) {
      await markMissing(day);
    }
    const listingId = gone?.listing_id ?? 0;

    // Act
    await touch("darty", ["GONE"]);

    // Assert
    expect(await getListing(db, listingId)).toMatchObject({
      last_seen_at: DAY_1,
      missed_runs: 0,
      active: true,
    });
    expect((await intervals(db, listingId)).map((row) => [row.valid_from, row.valid_to])).toEqual([
      [DAY_1, DAY_4],
    ]);
  });

  it("touches only the store's listings with those SKUs", async () => {
    // Arrange
    const [touchedRow, untouchedRow] = await ingest(db, "darty", DAY_1, [
      observation("A1"),
      observation("B2"),
    ]);
    const [otherStore] = await ingest(db, "radiopopular", DAY_1, [observation("A1")]);
    await markMissing(DAY_2);
    await markMissing(DAY_2, "radiopopular");

    // Act
    const touched = await touch("darty", ["A1", "A1", "UNKNOWN"]);

    // Assert
    expect(touched).toBe(1);
    expect((await getListing(db, touchedRow?.listing_id ?? 0)).missed_runs).toBe(0);
    expect((await getListing(db, untouchedRow?.listing_id ?? 0)).missed_runs).toBe(1);
    expect((await getListing(db, otherStore?.listing_id ?? 0)).missed_runs).toBe(1);
  });

  it("rejects an unknown store", async () => {
    // Arrange
    const storeSkus = ["A1"];

    // Act
    const act = touch("nope", storeSkus);

    // Assert
    await expect(act).rejects.toThrow("unknown store nope");
  });
});
