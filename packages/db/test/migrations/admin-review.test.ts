import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SqlParam } from "../../src/executor";
import { createMigratedDatabase, createUser, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  createListing,
  EAN_A,
  EAN_B,
  EAN_C,
  getCandidates,
  getListing,
  insertProduct,
  listingDetails,
  saveDetails,
} from "../helpers/fixtures";

interface User {
  userId: string;
  admin: boolean;
}

interface Queue {
  candidateCount: number;
  candidates: {
    candidateId: number;
    listing: { sku: string; storeName: string; priceCents: number | null };
    product: { slug: string; ean: string | null };
  }[];
  sameStore: {
    slug: string;
    storeName: string;
    sharesEan: boolean;
    listings: { sku: string; canSplit: boolean }[];
  }[];
}

describe("admin review functions", () => {
  let db: PGlite;
  let admin: User;
  let customer: User;
  let listingId: number;
  let white: number;

  /** Runs `sql` the way Supabase's API would for a signed-in user or for anon, and keeps what it writes. */
  async function callAs<Row extends object>(
    caller: User | "anon",
    sql: string,
    params: SqlParam[] = [],
  ): Promise<Row[]> {
    return await db.transaction(async (tx) => {
      if (caller === "anon") {
        await tx.exec("set local role anon");
      } else {
        await tx.exec("set local role authenticated");
        const claims = {
          sub: caller.userId,
          role: "authenticated",
          app_metadata: caller.admin ? { role: "admin" } : {},
        };
        await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      }
      return (await tx.query<Row>(sql, params)).rows;
    });
  }

  async function queue(): Promise<Queue> {
    const [row] = await callAs<{ queue: Queue }>(admin, "select admin_review_queue() as queue");
    if (row === undefined) {
      throw new Error("admin_review_queue returned no row");
    }
    return row.queue;
  }

  async function review(fn: string, id: number): Promise<{ slugs: string[] }> {
    const [row] = await callAs<{ result: { slugs: string[] } }>(admin, `select ${fn}($1) as result`, [id]);
    if (row === undefined) {
      throw new Error(`${fn} returned no row`);
    }
    return row.result;
  }

  async function candidateFor(productId: number): Promise<number> {
    const candidate = (await getCandidates(db, listingId)).find(
      (row) => row.candidate_product_id === productId,
    );
    if (candidate === undefined) {
      throw new Error(`no candidate for product ${productId}`);
    }
    return candidate.id;
  }

  /** Two Darty SKUs of one product: without EANs, as linked before the 0003 rule, or joined by one EAN. */
  async function sameStorePair(slug: string, ean: string | null): Promise<[number, number]> {
    const productId = await insertProduct(db, {
      name: `Produto ${slug}`,
      slug,
      ean,
      brandNorm: "lg",
      modelNorm: "F4WR709",
    });
    const facts = {
      ...listingDetails(0, {
        ean,
        brand: "LG",
        model: "F4WR709",
        brandNorm: "lg",
        modelNorm: "F4WR709",
        name: "LG F4WR709",
        slugBase: "lg-f4wr709-maquina-de-lavar-roupa",
      }),
      listingId: undefined,
    };
    const first = await createListing(db, `${slug}-1`);
    const second = await createListing(db, `${slug}-2`);
    await db.query("update listings set product_id = $1, details = $2::text::jsonb where id in ($3, $4)", [
      productId,
      JSON.stringify(facts),
      first,
      second,
    ]);
    return [first, second];
  }

  beforeAll(async () => {
    db = await createMigratedDatabase();
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await resetData(db);
    admin = { userId: await createUser(db, "admin@descontoreal.pt"), admin: true };
    customer = { userId: await createUser(db, "cliente@exemplo.pt"), admin: false };
    white = await insertProduct(db, {
      name: "Samsung WW90T534DAE branca",
      slug: "white",
      ean: EAN_A,
      brandNorm: "samsung",
      modelNorm: "WW90T534DAE",
    });
    await insertProduct(db, {
      name: "Samsung WW90T534DAE inox",
      slug: "silver",
      ean: EAN_B,
      brandNorm: "samsung",
      modelNorm: "WW90T534DAE",
    });
    listingId = await createListing(db, "A1");
    await saveDetails(db, listingDetails(listingId));
  });

  it("lets no anonymous visitor run them", async () => {
    // Act
    const run = callAs("anon", "select admin_review_queue()");

    // Assert
    await expect(run).rejects.toThrow("permission denied");
  });

  it("refuses signed-in users who are not admins", async () => {
    // Act
    const run = callAs(customer, "select admin_review_queue()");

    // Assert
    await expect(run).rejects.toThrow("admins only");
  });

  it("lists the pending candidates with the listing and the product side by side", async () => {
    // Act
    const { candidateCount, candidates } = await queue();

    // Assert
    expect(candidateCount).toBe(2);
    expect(candidates.map((candidate) => candidate.product.slug).sort()).toEqual(["silver", "white"]);
    expect(candidates[0]?.listing).toMatchObject({ sku: "A1", storeName: "Darty", priceCents: 49_999 });
  });

  it("approves as the admin and returns the product page to revalidate", async () => {
    // Arrange
    const candidateId = await candidateFor(white);

    // Act
    const result = await review("admin_approve_match", candidateId);

    // Assert
    expect(result).toEqual({ slugs: ["white"] });
    expect((await getListing(db, listingId)).product_id).toBe(white);
    const approved = (await getCandidates(db, listingId)).find((candidate) => candidate.id === candidateId);
    expect(approved?.reviewed_by).toBe(admin.userId);
  });

  it("rejects as the admin, leaving the listing to its other candidate", async () => {
    // Arrange
    const candidateId = await candidateFor(white);

    // Act
    const result = await review("admin_reject_match", candidateId);

    // Assert
    expect(result).toEqual({ slugs: [] });
    const rejected = (await getCandidates(db, listingId)).find((candidate) => candidate.id === candidateId);
    expect([rejected?.status, rejected?.reviewed_by]).toEqual(["rejected", admin.userId]);
  });

  it("lists products one store has twice, and which of their SKUs may be split", async () => {
    // Arrange
    await sameStorePair("legacy-lg", null);
    await sameStorePair("one-ean", EAN_C);

    // Act
    const { sameStore } = await queue();

    // Assert
    expect(
      sameStore.map((group) => [
        group.slug,
        group.storeName,
        group.sharesEan,
        group.listings.map((listing) => listing.canSplit),
      ]),
    ).toEqual([
      ["legacy-lg", "Darty", false, [true, true]],
      ["one-ean", "Darty", true, [false, false]],
    ]);
  });

  it("splits a SKU into a product of its own and returns both pages to revalidate", async () => {
    // Arrange
    const [, second] = await sameStorePair("legacy-lg", null);

    // Act
    const result = await review("admin_split_listing", second);

    // Assert
    expect(result).toEqual({ slugs: ["legacy-lg", "lg-f4wr709-maquina-de-lavar-roupa"] });
    expect((await queue()).sameStore).toEqual([]);
  });

  it("refuses to split a SKU whose EAN is its product's", async () => {
    // Arrange
    const [first] = await sameStorePair("one-ean", EAN_C);

    // Act
    const run = review("admin_split_listing", first);

    // Assert
    await expect(run).rejects.toThrow("has its product's EAN");
  });

  it("refuses to split a SKU without product page facts", async () => {
    // Arrange
    const [first] = await sameStorePair("legacy-lg", null);
    await db.query("update listings set details = null where id = $1", [first]);

    // Act
    const run = review("admin_split_listing", first);

    // Assert
    await expect(run).rejects.toThrow("no product page facts");
  });

  it("refuses to split a SKU again once its pair is apart", async () => {
    // Arrange
    const [first, second] = await sameStorePair("legacy-lg", null);
    await review("admin_split_listing", second);

    // Act
    const run = review("admin_split_listing", first);

    // Assert
    await expect(run).rejects.toThrow("no other listing of its store");
  });
});
