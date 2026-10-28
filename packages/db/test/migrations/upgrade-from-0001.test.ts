import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ListingDetailsInput } from "../../src/contract";
import { pgliteExecutor } from "../../src/local/pglite";
import { MIGRATIONS_DIR } from "../../src/migrate";
import { createDatabaseAt, createUser, migrateThrough, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  createListing,
  DAY_1,
  DAY_2,
  getCandidates,
  getListing,
  getProduct,
  getProducts,
  ingest,
  insertProduct,
  intervals,
  listingDetails,
  observation,
  saveDetails,
} from "../helpers/fixtures";

const VERSION = "0002_rrp_partial_matching";

/** A candidate with its review and the product its listing ended up with. */
interface ReviewRow {
  id: number;
  listing_id: number;
  candidate_product_id: number;
  status: string;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  product_id: number | null;
}

/** Facts of a Radio Popular own-brand washer, as the 0001 matching saw them. */
function electronia(listingId: number, model: string): ListingDetailsInput {
  return listingDetails(listingId, {
    brand: "ELECTRONIA",
    model,
    brandNorm: "electronia",
    modelNorm: model,
    name: `MÁQUINA LAVAR ROUPA ELECTRONIA ${model}`,
    slugBase: `electronia-${model.toLowerCase()}-maquina-de-lavar-roupa`,
    imageUrl: `https://www.radiopopular.pt/img/${model.toLowerCase()}.jpg`,
    specs: { Capacidade: "8 kg" },
  });
}

describe(`${VERSION} on a database at 0001_init`, () => {
  let template: PGlite;
  let db: PGliteInterface;
  let ewm38br: number;

  async function insertWithoutModel(): Promise<number> {
    return await insertProduct(db, {
      name: "MÁQUINA LAVAR ROUPA ELECTRONIA EMS686BR 8KG",
      slug: "without-model",
      brandNorm: "electronia",
      categorySlug: "maquinas-de-lavar-roupa",
    });
  }

  async function review(
    action: "approve" | "reject",
    listingId: number,
    productId: number,
    reviewer: string,
  ): Promise<void> {
    const candidate = (await getCandidates(db, listingId)).find(
      (row) => row.candidate_product_id === productId,
    );
    await db.query(`select ${action}_match_candidate($1, $2)`, [candidate?.id ?? 0, reviewer]);
  }

  async function reviewState(): Promise<ReviewRow[]> {
    const result = await db.query<ReviewRow>(
      `select mc.id, mc.listing_id, mc.candidate_product_id, mc.status, mc.reviewed_at, mc.reviewed_by,
              l.product_id
       from match_candidates mc join listings l on l.id = mc.listing_id
       order by mc.id`,
    );
    return result.rows;
  }

  beforeAll(async () => {
    template = await createDatabaseAt("0001_init");
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await template.close();
  });

  beforeEach(async () => {
    db = await template.clone();
    ewm38br = await insertProduct(db, {
      name: "MÁQUINA LAVAR ROUPA ELECTRONIA EWM38BR",
      slug: "electronia-ewm38br-maquina-de-lavar-roupa",
      brandNorm: "electronia",
      modelNorm: "EWM38BR",
      categorySlug: "maquinas-de-lavar-roupa",
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("supersedes the pending candidates of another model of the same brand", async () => {
    // Arrange
    const listingId = await createListing(db, "1336011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(listingId, "EMS686BR"));

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    const candidates = await getCandidates(db, listingId);
    expect(candidates).toMatchObject([
      { candidate_product_id: ewm38br, status: "superseded", reviewed_by: null },
    ]);
    expect(candidates[0]?.reviewed_at).toBeInstanceOf(Date);
  });

  it("gives a listing left without candidates its own product, built from its facts", async () => {
    // Arrange
    const listingId = await createListing(db, "1336011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(listingId, "EMS686BR"));

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    const listing = await getListing(db, listingId);
    expect(listing.product_id).not.toBe(ewm38br);
    expect(await getProduct(db, listing.product_id)).toMatchObject({
      ean: null,
      brand: "ELECTRONIA",
      brand_norm: "electronia",
      model: "EMS686BR",
      model_norm: "EMS686BR",
      name: "MÁQUINA LAVAR ROUPA ELECTRONIA EMS686BR",
      slug: "electronia-ems686br-maquina-de-lavar-roupa",
      category_slug: "maquinas-de-lavar-roupa",
      image_url: "https://www.radiopopular.pt/img/ems686br.jpg",
      specs: { Capacidade: "8 kg" },
    });
    expect(await getProducts(db)).toHaveLength(2);
  });

  it("gives two queued listings of the same brand and model one product", async () => {
    // Arrange
    const first = await createListing(db, "1336011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(first, "EMS686BR"));
    const second = await createListing(db, "F136011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(second, "EMS686BR"));

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    const firstProduct = (await getListing(db, first)).product_id;
    expect(firstProduct).not.toBeNull();
    expect((await getListing(db, second)).product_id).toBe(firstProduct);
    expect(await getProducts(db)).toHaveLength(2);
    const third = await createListing(db, "1399999", { storeSlug: "radiopopular" });
    expect(await saveDetails(db, electronia(third, "EMS686BR"))).toBe("linked_brand_model");
  });

  it("keeps the candidates the rule allows waiting for review", async () => {
    // Arrange
    const withoutModel = await insertWithoutModel();
    const listingId = await createListing(db, "1336011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(listingId, "EMS686BR"));

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    const candidates = await getCandidates(db, listingId);
    expect(candidates.map((row) => [row.candidate_product_id, row.status])).toEqual([
      [withoutModel, "pending"],
      [ewm38br, "superseded"],
    ]);
    expect((await getListing(db, listingId)).product_id).toBeNull();
    expect(await getProducts(db)).toHaveLength(2);
  });

  it("leaves reviewed candidates and linked listings as they are", async () => {
    // Arrange
    const reviewer = await createUser(db, "admin@descontoreal.pt");
    const rejectedId = await createListing(db, "1336011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(rejectedId, "EMS686BR"));
    await review("reject", rejectedId, ewm38br, reviewer);
    const approvedId = await createListing(db, "1339128", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(approvedId, "EMS7100BR"));
    await review("approve", approvedId, ewm38br, reviewer);
    const before = await reviewState();

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect(before.length).toBeGreaterThan(2);
    expect(await reviewState()).toEqual(before);
  });

  it("changes nothing when it runs again", async () => {
    // Arrange
    const alone = await createListing(db, "1336011", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(alone, "EMS686BR"));
    await insertWithoutModel();
    const waiting = await createListing(db, "1339128", { storeSlug: "radiopopular" });
    await saveDetails(db, electronia(waiting, "EMS7100BR"));
    await migrateThrough(db, VERSION);
    const before = { review: await reviewState(), products: await getProducts(db) };
    const text = await readFile(join(MIGRATIONS_DIR, `${VERSION}.sql`), "utf8");

    // Act
    await pgliteExecutor(db).transaction(async (tx) => {
      await tx.exec(text);
    });

    // Assert
    expect(before.review.map((row) => row.status)).toContain("pending");
    expect({ review: await reviewState(), products: await getProducts(db) }).toEqual(before);
  });

  it("keeps the price intervals, without a PVPr", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1", { priceCents: 49_999 })]);
    await ingest(db, "darty", DAY_2, [observation("A1", { priceCents: 44_999 })]);

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    const rows = await intervals(db, first?.listing_id ?? 0);
    expect(rows.map((row) => [row.price_cents, row.rrp_cents, row.valid_from, row.valid_to])).toEqual([
      [49_999, null, DAY_1, DAY_2],
      [44_999, null, DAY_2, null],
    ]);
  });

  it("fills the PVPr of the open interval in place on the next run", async () => {
    // Arrange
    const [first] = await ingest(db, "darty", DAY_1, [observation("A1")]);
    await migrateThrough(db, VERSION);

    // Act
    const [next] = await ingest(db, "darty", DAY_2, [observation("A1", { rrpCents: 54_999 })]);

    // Assert
    expect(next?.status).toBe("unchanged");
    const rows = await intervals(db, first?.listing_id ?? 0);
    expect(rows.map((row) => [row.price_cents, row.rrp_cents, row.valid_from, row.valid_to])).toEqual([
      [49_999, 54_999, DAY_1, null],
    ]);
  });
});
