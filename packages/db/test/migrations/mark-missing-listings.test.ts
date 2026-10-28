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

interface MissingResult {
  missed: number;
  deactivated: number;
}

describe("mark_missing_listings", () => {
  let db: PGlite;

  async function markMissing(storeSlug: string, seenSince: Date): Promise<MissingResult | undefined> {
    const result = await db.query<MissingResult>("select * from mark_missing_listings($1, $2)", [
      storeSlug,
      seenSince,
    ]);
    return result.rows[0];
  }

  /** Runs `count` daily runs after DAY_1 in which only "SEEN" appears. Returns the last run's result. */
  async function runsWithout(count: number): Promise<MissingResult | undefined> {
    const days = [DAY_2, DAY_3, DAY_4, DAY_5].slice(0, count);
    let result: MissingResult | undefined;
    for (const day of days) {
      await ingest(db, "darty", day, [observation("SEEN")]);
      result = await markMissing("darty", day);
    }
    return result;
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

  it("counts one missed run and keeps the listing active", async () => {
    // Arrange
    const [gone] = await ingest(db, "darty", DAY_1, [observation("GONE"), observation("SEEN")]);

    // Act
    const result = await runsWithout(1);

    // Assert
    expect(result).toEqual({ missed: 1, deactivated: 0 });
    const listing = await getListing(db, gone?.listing_id ?? 0);
    expect(listing).toMatchObject({ active: true, missed_runs: 1 });
    expect((await intervals(db, listing.id)).map((row) => row.valid_to)).toEqual([null]);
  });

  it("keeps the listing active after two missed runs", async () => {
    // Arrange
    const [gone] = await ingest(db, "darty", DAY_1, [observation("GONE"), observation("SEEN")]);

    // Act
    const result = await runsWithout(2);

    // Assert
    expect(result).toEqual({ missed: 1, deactivated: 0 });
    expect(await getListing(db, gone?.listing_id ?? 0)).toMatchObject({ active: true, missed_runs: 2 });
  });

  it("deactivates the listing and closes its interval on the third missed run", async () => {
    // Arrange
    const [gone] = await ingest(db, "darty", DAY_1, [observation("GONE"), observation("SEEN")]);

    // Act
    const result = await runsWithout(3);

    // Assert
    expect(result).toEqual({ missed: 1, deactivated: 1 });
    const listing = await getListing(db, gone?.listing_id ?? 0);
    expect(listing).toMatchObject({ active: false, missed_runs: 3 });
    expect((await intervals(db, listing.id)).map((row) => [row.valid_from, row.valid_to])).toEqual([
      [DAY_1, DAY_4],
    ]);
  });

  it("leaves inactive listings alone in later runs", async () => {
    // Arrange
    const [gone] = await ingest(db, "darty", DAY_1, [observation("GONE"), observation("SEEN")]);
    await runsWithout(3);
    await ingest(db, "darty", DAY_5, [observation("SEEN")]);

    // Act
    const result = await markMissing("darty", DAY_5);

    // Assert
    expect(result).toEqual({ missed: 0, deactivated: 0 });
    expect((await getListing(db, gone?.listing_id ?? 0)).missed_runs).toBe(3);
  });

  it("reactivates a listing that appears again, with a new interval", async () => {
    // Arrange
    const [gone] = await ingest(db, "darty", DAY_1, [observation("GONE"), observation("SEEN")]);
    await runsWithout(3);

    // Act
    const [back] = await ingest(db, "darty", DAY_5, [observation("GONE", { priceCents: 39_999 })]);

    // Assert
    expect(back?.status).toBe("changed");
    expect(await getListing(db, gone?.listing_id ?? 0)).toMatchObject({ active: true, missed_runs: 0 });
    expect(
      (await intervals(db, gone?.listing_id ?? 0)).map((row) => [row.price_cents, row.valid_to]),
    ).toEqual([
      [49_999, DAY_4],
      [39_999, null],
    ]);
  });

  it("does not touch listings seen in the run or listings of other stores", async () => {
    // Arrange
    const [seen] = await ingest(db, "darty", DAY_2, [observation("SEEN")]);
    const [other] = await ingest(db, "radiopopular", DAY_1, [observation("OTHER")]);

    // Act
    const result = await markMissing("darty", DAY_2);

    // Assert
    expect(result).toEqual({ missed: 0, deactivated: 0 });
    expect((await getListing(db, seen?.listing_id ?? 0)).missed_runs).toBe(0);
    expect((await getListing(db, other?.listing_id ?? 0)).missed_runs).toBe(0);
  });

  it("rejects an unknown store", async () => {
    // Arrange
    const seenSince = DAY_2;

    // Act
    const act = markMissing("nope", seenSince);

    // Assert
    await expect(act).rejects.toThrow("unknown store nope");
  });
});
