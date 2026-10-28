import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createMigratedDatabase, createUser, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  createListing,
  EAN_A,
  EAN_B,
  getCandidates,
  getListing,
  getProduct,
  getProducts,
  insertProduct,
  listingDetails,
  saveDetails,
} from "../helpers/fixtures";

describe("approve_match_candidate and reject_match_candidate", () => {
  let db: PGlite;
  let reviewer: string;
  let listingId: number;
  let white: number;
  let silver: number;

  async function review(action: "approve" | "reject", candidateId: number): Promise<number | null> {
    const result = await db.query<{ product_id: number | null }>(
      `select ${action}_match_candidate($1, $2) as product_id`,
      [candidateId, reviewer],
    );
    return result.rows[0]?.product_id ?? null;
  }

  async function candidateFor(productId: number): Promise<number> {
    const candidate = (await getCandidates(db, listingId)).find(
      (row) => row.candidate_product_id === productId,
    );
    if (!candidate) {
      throw new Error(`no candidate for product ${productId}`);
    }
    return candidate.id;
  }

  beforeAll(async () => {
    db = await createMigratedDatabase();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await resetData(db);
    reviewer = await createUser(db, "admin@descontoreal.pt");
    white = await insertProduct(db, {
      name: "Samsung WW90T534DAE branca",
      slug: "white",
      ean: EAN_A,
      brandNorm: "samsung",
      modelNorm: "WW90T534DAE",
    });
    silver = await insertProduct(db, {
      name: "Samsung WW90T534DAE inox",
      slug: "silver",
      ean: EAN_B,
      brandNorm: "samsung",
      modelNorm: "WW90T534DAE",
    });
    listingId = await createListing(db, "A1");
    await saveDetails(db, listingDetails(listingId));
  });

  it("approving links the listing and closes the other candidates", async () => {
    // Arrange
    const candidateId = await candidateFor(white);

    // Act
    const productId = await review("approve", candidateId);

    // Assert
    expect(productId).toBe(white);
    expect((await getListing(db, listingId)).product_id).toBe(white);
    const candidates = await getCandidates(db, listingId);
    expect(candidates.map((row) => [row.candidate_product_id, row.status, row.reviewed_by])).toEqual(
      expect.arrayContaining([
        [white, "approved", reviewer],
        [silver, "superseded", reviewer],
      ]),
    );
    expect(candidates.every((row) => row.reviewed_at instanceof Date)).toBe(true);
  });

  it("approving fills the product's empty fields from the listing's facts", async () => {
    // Arrange
    const candidateId = await candidateFor(white);

    // Act
    await review("approve", candidateId);

    // Assert
    expect(await getProduct(db, white)).toMatchObject({
      brand: "Samsung",
      image_url: "https://darty.pt/cdn/ww90t534dae.jpg",
      specs: { Capacidade: "9 kg" },
    });
  });

  it("rejecting one of several candidates leaves the listing waiting for review", async () => {
    // Arrange
    const candidateId = await candidateFor(white);

    // Act
    const productId = await review("reject", candidateId);

    // Assert
    expect(productId).toBeNull();
    expect((await getListing(db, listingId)).product_id).toBeNull();
    expect((await getCandidates(db, listingId)).map((row) => [row.candidate_product_id, row.status])).toEqual(
      expect.arrayContaining([
        [white, "rejected"],
        [silver, "pending"],
      ]),
    );
  });

  it("rejecting the last candidate creates the product from the listing's facts", async () => {
    // Arrange
    await review("reject", await candidateFor(white));
    const lastCandidateId = await candidateFor(silver);

    // Act
    const productId = await review("reject", lastCandidateId);

    // Assert
    expect(productId).not.toBeNull();
    expect((await getListing(db, listingId)).product_id).toBe(productId);
    expect(await getProduct(db, productId)).toMatchObject({
      ean: null,
      name: "Samsung WW90T534DAE",
      slug: "samsung-ww90t534dae-maquina-de-lavar-roupa",
      category_slug: "maquinas-de-lavar-roupa",
    });
    expect(await getProducts(db)).toHaveLength(3);
  });

  it("rejecting the last candidate never links the listing to a product its store already lists", async () => {
    // Arrange
    const storeProduct = await insertProduct(db, {
      name: "Samsung WW90T534DAE",
      slug: "store-product",
      brandNorm: "samsung",
      modelNorm: "WW90T534DAE",
    });
    const otherListingId = await createListing(db, "A2");
    await db.query("update listings set product_id = $1 where id = $2", [storeProduct, otherListingId]);
    await review("reject", await candidateFor(white));
    const lastCandidateId = await candidateFor(silver);

    // Act
    const productId = await review("reject", lastCandidateId);

    // Assert
    expect(productId).not.toBeNull();
    expect(productId).not.toBe(storeProduct);
    expect((await getListing(db, listingId)).product_id).toBe(productId);
    expect(await getProducts(db)).toHaveLength(4);
  });

  it("refuses to review a candidate twice", async () => {
    // Arrange
    const candidateId = await candidateFor(white);
    await review("approve", candidateId);

    // Act
    const act = review("reject", candidateId);

    // Assert
    await expect(act).rejects.toThrow("is approved");
  });

  it("refuses an unknown candidate", async () => {
    // Arrange
    const candidateId = 999;

    // Act
    const act = review("approve", candidateId);

    // Assert
    await expect(act).rejects.toThrow("candidate 999 does not exist");
  });
});
