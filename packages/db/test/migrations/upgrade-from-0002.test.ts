import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { slugify } from "@descontoreal/core";
import type { PGlite, PGliteInterface } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ListingDetailsInput } from "../../src/contract";
import { pgliteExecutor } from "../../src/local/pglite";
import { MIGRATIONS_DIR } from "../../src/migrate";
import { createDatabaseAt, createUser, migrateThrough, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  createListing,
  EAN_B,
  EAN_C,
  getCandidates,
  getListing,
  getProduct,
  getProducts,
  insertProduct,
  listingDetails,
  type ProductRow,
  saveDetails,
} from "../helpers/fixtures";

const PREVIOUS = "0002_rrp_partial_matching";
const VERSION = "0003_touch_same_store_matching";

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

interface Snapshot {
  review: ReviewRow[];
  products: ProductRow[];
}

/** Facts of a Radio Popular own-brand item without a model code, like most of the production queue. */
function ownBrand(
  listingId: number,
  name: string,
  categorySlug: string,
  overrides: Partial<ListingDetailsInput> = {},
): ListingDetailsInput {
  return listingDetails(listingId, {
    brand: "ELECTRONIA",
    model: null,
    brandNorm: "electronia",
    modelNorm: null,
    name,
    slugBase: slugify(name),
    categorySlug,
    imageUrl: `https://www.radiopopular.pt/img/${slugify(name)}.jpg`,
    specs: {},
    ...overrides,
  });
}

describe(`${VERSION} on a database at ${PREVIOUS}`, () => {
  let template: PGlite;
  let db: PGliteInterface;

  /** A product that matching linked to a listing of `storeSlug`. */
  async function listedProduct(
    storeSlug: string,
    storeSku: string,
    product: Parameters<typeof insertProduct>[1],
  ): Promise<number> {
    const productId = await insertProduct(db, product);
    const listingId = await createListing(db, storeSku, { storeSlug });
    await db.query("update listings set product_id = $1 where id = $2", [productId, listingId]);
    return productId;
  }

  /** A Radio Popular listing whose facts went through the 0002 matching. */
  async function queued(
    storeSku: string,
    details: (listingId: number) => ListingDetailsInput,
  ): Promise<number> {
    const listingId = await createListing(db, storeSku, { storeSlug: "radiopopular" });
    await saveDetails(db, details(listingId));
    return listingId;
  }

  async function review(action: "approve" | "reject", listingId: number, reviewer: string): Promise<void> {
    const [candidate] = await getCandidates(db, listingId);
    await db.query(`select ${action}_match_candidate($1, $2)`, [candidate?.id ?? 0, reviewer]);
  }

  /** Each case in its own category, so their titles never meet. */
  async function queueAgainstOwnStore(): Promise<{ listingId: number; storeProduct: number }> {
    const storeProduct = await listedProduct("radiopopular", "1350001", {
      name: "MICRO-ONDAS ELECTRONIA 20L BRANCO",
      slug: "electronia-micro-ondas-20l-branco",
      brandNorm: "electronia",
      categorySlug: "micro-ondas",
    });
    const listingId = await queued("1350002", (id) =>
      ownBrand(id, "MICRO-ONDAS ELECTRONIA 20L PRETO", "micro-ondas"),
    );
    return { listingId, storeProduct };
  }

  async function queueAgainstBothStores(): Promise<{
    listingId: number;
    storeProduct: number;
    otherStoreProduct: number;
  }> {
    const washer = { brandNorm: "electronia", categorySlug: "maquinas-de-lavar-roupa" };
    const storeProduct = await listedProduct("radiopopular", "1340981", {
      name: "MÁQUINA LAVAR ROUPA ELECTRONIA 8KG BRANCA",
      slug: "electronia-8kg-radiopopular",
      ...washer,
    });
    const otherStoreProduct = await listedProduct("darty", "D-8KG", {
      name: "Máquina de Lavar Roupa Electronia 8 kg Branca",
      slug: "electronia-8kg-darty",
      ...washer,
    });
    const listingId = await queued("1340982", (id) =>
      ownBrand(id, "MÁQUINA LAVAR ROUPA ELECTRONIA 7KG BRANCA", "maquinas-de-lavar-roupa"),
    );
    return { listingId, storeProduct, otherStoreProduct };
  }

  async function queueByBrandAndModel(): Promise<{
    listingId: number;
    storeProduct: number;
    otherStoreProduct: number;
  }> {
    const dryer = { brandNorm: "electronia", modelNorm: "ESR80B", categorySlug: "maquinas-de-secar-roupa" };
    const storeProduct = await listedProduct("radiopopular", "1360001", {
      name: "MÁQUINA SECAR ROUPA ELECTRONIA ESR80B",
      slug: "electronia-esr80b-radiopopular",
      ...dryer,
    });
    const otherStoreProduct = await listedProduct("darty", "D-ESR80B", {
      name: "Máquina de Secar Roupa Electronia ESR80B 8 kg",
      slug: "electronia-esr80b-darty",
      ean: EAN_B,
      ...dryer,
    });
    const listingId = await queued("1360002", (id) =>
      ownBrand(id, "MÁQUINA SECAR ROUPA ELECTRONIA ESR80B BRANCA", "maquinas-de-secar-roupa", {
        model: "ESR80B",
        modelNorm: "ESR80B",
      }),
    );
    return { listingId, storeProduct, otherStoreProduct };
  }

  /** Two products of the listing's brand and model, both already listed by its own store. */
  async function queueByBrandAndModelOfOwnStore(): Promise<{ listingId: number; storeProducts: number[] }> {
    const hob = { brandNorm: "electronia", modelNorm: "EPI60", categorySlug: "placas" };
    const storeProducts = [
      await listedProduct("radiopopular", "1390001", {
        name: "PLACA INDUÇÃO ELECTRONIA EPI60",
        slug: "electronia-epi60-radiopopular",
        ...hob,
      }),
      await listedProduct("radiopopular", "1390002", {
        name: "PLACA INDUÇÃO ELECTRONIA EPI60 PRETA",
        slug: "electronia-epi60-preta-radiopopular",
        ean: EAN_C,
        ...hob,
      }),
    ];
    const listingId = await queued("1390003", (id) =>
      ownBrand(id, "PLACA INDUÇÃO ELECTRONIA EPI60 BRANCA", "placas", { model: "EPI60", modelNorm: "EPI60" }),
    );
    return { listingId, storeProducts };
  }

  async function reviewAgainstOwnStore(): Promise<void> {
    const reviewer = await createUser(db, "admin@descontoreal.pt");
    await listedProduct("radiopopular", "1370001", {
      name: "FORNO ENCASTRE ELECTRONIA 70L INOX",
      slug: "electronia-forno-70l-inox",
      brandNorm: "electronia",
      categorySlug: "fornos",
    });
    const approved = await queued("1370002", (id) =>
      ownBrand(id, "FORNO ENCASTRE ELECTRONIA 70L PRETO", "fornos"),
    );
    await review("approve", approved, reviewer);
    const rejected = await queued("1370003", (id) =>
      ownBrand(id, "FORNO ENCASTRE ELECTRONIA 65L INOX", "fornos"),
    );
    await review("reject", rejected, reviewer);
  }

  /** `second` waits on a Darty product that brand and model give to `first` once its own candidate goes. */
  async function queueBehindAnotherListing(): Promise<{
    first: number;
    second: number;
    otherStoreProduct: number;
  }> {
    const tv = { brandNorm: "smarttech", categorySlug: "televisores" };
    const smartTech = { brand: "SMART TECH", brandNorm: "smarttech" };
    await listedProduct("radiopopular", "1380001", {
      name: "TELEVISOR SMART TECH 32 HD LED",
      slug: "smart-tech-32-hd-led-radiopopular",
      ...tv,
    });
    const first = await queued("1380002", (id) =>
      ownBrand(id, "TELEVISOR SMART TECH ST32 32 HD LED", "televisores", {
        ...smartTech,
        model: "ST32",
        modelNorm: "ST32",
      }),
    );
    const otherStoreProduct = await listedProduct("darty", "D-ST32", {
      name: "Televisor Smart Tech ST32 32 HD LED",
      slug: "smart-tech-st32-darty",
      modelNorm: "ST32",
      ...tv,
    });
    const second = await queued("1380003", (id) =>
      ownBrand(id, "TELEVISOR SMART TECH 32 HD LED PRETO", "televisores", smartTech),
    );
    return { first, second, otherStoreProduct };
  }

  async function queueLikeProduction(): Promise<void> {
    await queueAgainstOwnStore();
    await queueAgainstBothStores();
    await queueByBrandAndModel();
    await queueByBrandAndModelOfOwnStore();
    await reviewAgainstOwnStore();
    await queueBehindAnotherListing();
  }

  async function snapshot(): Promise<Snapshot> {
    const review = await db.query<ReviewRow>(
      `select mc.id, mc.listing_id, mc.candidate_product_id, mc.status, mc.reviewed_at, mc.reviewed_by,
              l.product_id
       from match_candidates mc join listings l on l.id = mc.listing_id
       order by mc.id`,
    );
    return { review: review.rows, products: await getProducts(db) };
  }

  async function candidateStates(listingId: number): Promise<[number, string][]> {
    return (await getCandidates(db, listingId)).map((row) => [row.candidate_product_id, row.status]);
  }

  beforeAll(async () => {
    template = await createDatabaseAt(PREVIOUS);
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

  it("supersedes the title candidates that are products of the listing's own store", async () => {
    // Arrange
    const { listingId, storeProduct } = await queueAgainstOwnStore();
    const before = await candidateStates(listingId);

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect(before).toEqual([[storeProduct, "pending"]]);
    const candidates = await getCandidates(db, listingId);
    expect(candidates).toMatchObject([
      { candidate_product_id: storeProduct, status: "superseded", reviewed_by: null },
    ]);
    expect(candidates[0]?.reviewed_at).toBeInstanceOf(Date);
  });

  it("gives a listing left without candidates its own product, built from its facts", async () => {
    // Arrange
    const { listingId, storeProduct } = await queueAgainstOwnStore();
    const productCount = (await getProducts(db)).length;

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    const listing = await getListing(db, listingId);
    expect(listing.product_id).not.toBe(storeProduct);
    expect(await getProduct(db, listing.product_id)).toMatchObject({
      ean: null,
      brand: "ELECTRONIA",
      brand_norm: "electronia",
      model: null,
      name: "MICRO-ONDAS ELECTRONIA 20L PRETO",
      slug: "micro-ondas-electronia-20l-preto",
      category_slug: "micro-ondas",
      image_url: "https://www.radiopopular.pt/img/micro-ondas-electronia-20l-preto.jpg",
    });
    expect(await getProducts(db)).toHaveLength(productCount + 1);
  });

  it("keeps the candidates that only another store lists waiting for review", async () => {
    // Arrange
    const { listingId, storeProduct, otherStoreProduct } = await queueAgainstBothStores();

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect(await candidateStates(listingId)).toEqual([
      [storeProduct, "superseded"],
      [otherStoreProduct, "pending"],
    ]);
    expect((await getListing(db, listingId)).product_id).toBeNull();
  });

  it("supersedes the brand and model candidates its own store lists, keeping another store's", async () => {
    // Arrange
    const { listingId, storeProduct, otherStoreProduct } = await queueByBrandAndModel();
    const before = await candidateStates(listingId);

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect(before.map(([, status]) => status)).toEqual(["pending", "pending"]);
    expect((await candidateStates(listingId)).toSorted(([a], [b]) => a - b)).toEqual([
      [storeProduct, "superseded"],
      [otherStoreProduct, "pending"],
    ]);
    expect((await getListing(db, listingId)).product_id).toBeNull();
  });

  it("gives a listing whose brand and model candidates its own store lists a product of its own", async () => {
    // Arrange
    const { listingId, storeProducts } = await queueByBrandAndModelOfOwnStore();
    const productCount = (await getProducts(db)).length;

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect((await candidateStates(listingId)).map(([, status]) => status)).toEqual([
      "superseded",
      "superseded",
    ]);
    const listing = await getListing(db, listingId);
    expect(storeProducts).not.toContain(listing.product_id);
    expect(await getProduct(db, listing.product_id)).toMatchObject({
      ean: null,
      model_norm: "EPI60",
      name: "PLACA INDUÇÃO ELECTRONIA EPI60 BRANCA",
    });
    expect(await getProducts(db)).toHaveLength(productCount + 1);
  });

  it("leaves reviewed candidates and linked listings as they are", async () => {
    // Arrange
    await reviewAgainstOwnStore();
    const before = await snapshot();

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect(before.review.map((row) => row.status).toSorted()).toEqual(["approved", "rejected"]);
    expect(await snapshot()).toEqual(before);
  });

  it("supersedes again when a listing it links makes another candidate a product of the same store", async () => {
    // Arrange
    const { first, second, otherStoreProduct } = await queueBehindAnotherListing();
    const before = await candidateStates(second);

    // Act
    await migrateThrough(db, VERSION);

    // Assert
    expect(before.map(([, status]) => status)).toEqual(["pending", "pending"]);
    expect((await getListing(db, first)).product_id).toBe(otherStoreProduct);
    expect((await candidateStates(second)).map(([, status]) => status)).toEqual(["superseded", "superseded"]);
    const secondProduct = (await getListing(db, second)).product_id;
    expect(secondProduct).not.toBe(otherStoreProduct);
    expect((await getProduct(db, secondProduct)).name).toBe("TELEVISOR SMART TECH 32 HD LED PRETO");
  });

  it("proposes no product of the listing's own store to the listings saved after it", async () => {
    // Arrange
    const { storeProduct } = await queueAgainstOwnStore();
    await migrateThrough(db, VERSION);
    const listingId = await createListing(db, "1350003", { storeSlug: "radiopopular" });

    // Act
    const outcome = await saveDetails(
      db,
      ownBrand(listingId, "MICRO-ONDAS ELECTRONIA 20L GRILL", "micro-ondas"),
    );

    // Assert
    expect(outcome).toBe("created");
    expect((await getListing(db, listingId)).product_id).not.toBe(storeProduct);
  });

  it("is the only migration the runner applies", async () => {
    // Arrange
    await queueLikeProduction();

    // Act
    const run = await migrateThrough(db, VERSION);

    // Assert
    expect(run).toEqual({ applied: [VERSION], skipped: ["0001_init", PREVIOUS] });
  });

  it("changes nothing when the runner runs again", async () => {
    // Arrange
    await queueLikeProduction();
    await migrateThrough(db, VERSION);
    const before = await snapshot();

    // Act
    const run = await migrateThrough(db, VERSION);

    // Assert
    expect(run).toEqual({ applied: [], skipped: ["0001_init", PREVIOUS, VERSION] });
    expect(await snapshot()).toEqual(before);
  });

  it("changes nothing when its text runs again", async () => {
    // Arrange
    await queueLikeProduction();
    await migrateThrough(db, VERSION);
    const before = await snapshot();
    const text = await readFile(join(MIGRATIONS_DIR, `${VERSION}.sql`), "utf8");

    // Act
    await pgliteExecutor(db).transaction(async (tx) => {
      await tx.exec(text);
    });

    // Assert
    expect(before.review.map((row) => row.status)).toEqual(
      expect.arrayContaining(["pending", "superseded", "approved", "rejected"]),
    );
    expect(await snapshot()).toEqual(before);
  });
});
