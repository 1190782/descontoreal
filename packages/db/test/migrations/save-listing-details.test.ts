import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ListingDetailsInput } from "../../src/contract";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import {
  createListing,
  DAY_1,
  DAY_2,
  EAN_A,
  EAN_B,
  EAN_C,
  getCandidates,
  getListing,
  getProduct,
  getProducts,
  insertProduct,
  listingDetails,
  saveDetails,
} from "../helpers/fixtures";

const WASHER_NAME = "Máquina de Lavar Roupa Samsung WW90T534DAE 9 kg";
const SLUG_BASE = "samsung-ww90t534dae-maquina-de-lavar-roupa";
const NO_BRAND_MODEL = { brand: null, model: null, brandNorm: null, modelNorm: null } as const;

describe("save_listing_details", () => {
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

  describe("listing facts", () => {
    it("stores the raw EAN, the facts and when the product page was checked", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");
      const input = listingDetails(listingId, { rawEan: "880-6094932287", ean: EAN_A });

      // Act
      await saveDetails(db, input, DAY_2);

      // Assert
      const listing = await getListing(db, listingId);
      expect(listing.raw_ean).toBe("880-6094932287");
      expect(listing.product_page_checked_at).toEqual(DAY_2);
      const { listingId: _listingId, rawEan: _rawEan, ...facts } = input;
      expect(listing.details).toEqual(facts);
    });

    it("keeps product_page_checked_at when the facts come from a listing page", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(listingId), DAY_1);

      // Act
      await saveDetails(db, listingDetails(listingId, { imageUrl: "https://darty.pt/cdn/other.jpg" }), null);

      // Assert
      expect((await getListing(db, listingId)).product_page_checked_at).toEqual(DAY_1);
    });

    it("rejects an EAN that is not 13 digits", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");

      // Act
      const act = saveDetails(db, listingDetails(listingId, { ean: "12345" }));

      // Assert
      await expect(act).rejects.toThrow("ean must have 13 digits");
    });

    it("rejects an unknown listing", async () => {
      // Arrange
      const input = listingDetails(999);

      // Act
      const act = saveDetails(db, input);

      // Assert
      await expect(act).rejects.toThrow("listing 999 does not exist");
    });
  });

  describe("by EAN", () => {
    it("creates a product for an EAN seen for the first time", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { ean: EAN_A }));

      // Assert
      expect(outcome).toBe("created_ean");
      const product = await getProduct(db, (await getListing(db, listingId)).product_id);
      expect(product).toMatchObject({
        ean: EAN_A,
        brand: "Samsung",
        brand_norm: "samsung",
        model: "WW90T534DAE",
        model_norm: "WW90T534DAE",
        name: "Samsung WW90T534DAE",
        slug: SLUG_BASE,
        category_slug: "maquinas-de-lavar-roupa",
        image_url: "https://darty.pt/cdn/ww90t534dae.jpg",
        specs: { Capacidade: "9 kg" },
      });
    });

    it("links a listing from another store to the product with the same EAN", async () => {
      // Arrange
      const dartyId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(dartyId, { ean: EAN_A }));
      const radioPopularId = await createListing(db, "RP-9", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(
        db,
        listingDetails(radioPopularId, { ean: EAN_A, name: "Outro nome" }),
      );

      // Assert
      expect(outcome).toBe("linked_ean");
      expect((await getListing(db, radioPopularId)).product_id).toBe(
        (await getListing(db, dartyId)).product_id,
      );
      expect(await getProducts(db)).toHaveLength(1);
    });

    it("never merges listings with different EANs, even with the same title", async () => {
      // Arrange
      const whiteId = await createListing(db, "WHITE");
      const silverId = await createListing(db, "SILVER");
      await saveDetails(db, listingDetails(whiteId, { ean: EAN_A }));

      // Act
      const outcome = await saveDetails(db, listingDetails(silverId, { ean: EAN_B }));

      // Assert
      expect(outcome).toBe("created_ean");
      expect((await getProducts(db)).map((product) => [product.ean, product.slug])).toEqual([
        [EAN_A, SLUG_BASE],
        [EAN_B, `${SLUG_BASE}-2`],
      ]);
    });

    it("never links a listing with an EAN by brand and model", async () => {
      // Arrange
      await insertProduct(db, {
        name: "Samsung WW90T534DAE",
        slug: "existing",
        ean: EAN_A,
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { ean: EAN_B }));

      // Assert
      expect(outcome).toBe("created_ean");
      expect(await getProducts(db)).toHaveLength(2);
    });

    it("puts a late EAN on the listing's product when no product has it", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(listingId));
      const productId = (await getListing(db, listingId)).product_id;

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { ean: EAN_A }));

      // Assert
      expect(outcome).toBe("linked_ean");
      expect((await getListing(db, listingId)).product_id).toBe(productId);
      expect((await getProduct(db, productId)).ean).toBe(EAN_A);
    });

    it("relinks a listing to the product that already has its late EAN", async () => {
      // Arrange
      const eanProductId = await insertProduct(db, {
        name: "Aspirador Dyson V15 Detect",
        slug: "dyson-v15",
        ean: EAN_A,
      });
      const listingId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(listingId));

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { ean: EAN_A }));

      // Assert
      expect(outcome).toBe("linked_ean");
      expect((await getListing(db, listingId)).product_id).toBe(eanProductId);
    });

    it("moves a listing whose EAN changed to the product of the new EAN", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(listingId, { ean: EAN_A }));
      const firstProductId = (await getListing(db, listingId)).product_id;

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { ean: EAN_B }));

      // Assert
      expect(outcome).toBe("created_ean");
      const listing = await getListing(db, listingId);
      expect(listing.product_id).not.toBe(firstProductId);
      expect((await getProduct(db, firstProductId)).ean).toBe(EAN_A);
      expect((await getProduct(db, listing.product_id)).ean).toBe(EAN_B);
    });

    it("supersedes pending candidates once the EAN links the listing", async () => {
      // Arrange
      await insertProduct(db, {
        name: "Samsung WW90T534DAE branca",
        slug: "white",
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      await insertProduct(db, {
        name: "Samsung WW90T534DAE inox",
        slug: "silver",
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      const listingId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(listingId));

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { ean: EAN_C }));

      // Assert
      expect(outcome).toBe("created_ean");
      expect((await getCandidates(db, listingId)).map((candidate) => candidate.status)).toEqual([
        "superseded",
        "superseded",
      ]);
    });

    it("fills only the product fields that are still empty", async () => {
      // Arrange
      const dartyId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(dartyId, { ean: EAN_A, imageUrl: null, specs: {} }));
      const radioPopularId = await createListing(db, "RP-9", { storeSlug: "radiopopular" });

      // Act
      await saveDetails(
        db,
        listingDetails(radioPopularId, {
          ean: EAN_A,
          brand: "SAMSUNG ELECTRONICS",
          imageUrl: "https://radiopopular.pt/img/ww90.jpg",
          specs: { Classe: "A" },
        }),
      );

      // Assert
      expect(await getProduct(db, (await getListing(db, dartyId)).product_id)).toMatchObject({
        brand: "Samsung",
        image_url: "https://radiopopular.pt/img/ww90.jpg",
        specs: { Classe: "A" },
      });
    });
  });

  describe("without EAN", () => {
    it("links to the only product with the same brand and model", async () => {
      // Arrange
      const productId = await insertProduct(db, {
        name: "Samsung WW90T534DAE",
        slug: "existing",
        ean: EAN_A,
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId));

      // Assert
      expect(outcome).toBe("linked_brand_model");
      expect((await getListing(db, listingId)).product_id).toBe(productId);
    });

    it("sends several products with the same brand and model to review", async () => {
      // Arrange
      const white = await insertProduct(db, {
        name: "Samsung WW90T534DAE branca",
        slug: "white",
        ean: EAN_A,
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      const silver = await insertProduct(db, {
        name: "Samsung WW90T534DAE inox",
        slug: "silver",
        ean: EAN_B,
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId));

      // Assert
      expect(outcome).toBe("candidate");
      expect((await getListing(db, listingId)).product_id).toBeNull();
      const candidates = await getCandidates(db, listingId);
      expect(candidates.map((candidate) => candidate.candidate_product_id).toSorted()).toEqual([
        white,
        silver,
      ]);
      expect(candidates.every((candidate) => candidate.status === "pending")).toBe(true);
    });

    it("suggests a product with a similar title in the same category", async () => {
      // Arrange
      const similar = await insertProduct(db, {
        name: "Samsung WW90T534DAE Máquina de Lavar Roupa 9kg Branca",
        slug: "similar",
        categorySlug: "maquinas-de-lavar-roupa",
      });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(
        db,
        listingDetails(listingId, { ...NO_BRAND_MODEL, name: WASHER_NAME }),
      );

      // Assert
      expect(outcome).toBe("candidate");
      const [candidate, ...others] = await getCandidates(db, listingId);
      expect(others).toEqual([]);
      expect(candidate).toMatchObject({ candidate_product_id: similar, status: "pending" });
      expect(candidate?.confidence).toBeGreaterThanOrEqual(0.45);
      expect(candidate?.confidence).toBeLessThanOrEqual(1);
    });

    it("does not suggest similar titles from another category", async () => {
      // Arrange
      await insertProduct(db, {
        name: "Samsung WW90T534DAE Máquina de Lavar Roupa 9kg Branca",
        slug: "similar",
        categorySlug: "televisores",
      });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(
        db,
        listingDetails(listingId, { ...NO_BRAND_MODEL, name: WASHER_NAME }),
      );

      // Assert
      expect(outcome).toBe("created");
      expect(await getCandidates(db, listingId)).toEqual([]);
    });

    it("suggests at most the three most similar titles", async () => {
      // Arrange
      const names = [
        "Máquina de Lavar Roupa Samsung WW90T534DAE 9 kg Inox",
        "Máquina de Lavar Roupa Samsung WW80T534DAE 8 kg",
        "Samsung WW90T534DAE Máquina de Lavar Roupa 9kg Branca",
        "Máquina de Lavar Roupa Samsung WW11BB944DGB 11 kg",
      ];
      const ids: number[] = [];
      for (const [index, name] of names.entries()) {
        ids.push(
          await insertProduct(db, {
            name,
            slug: `similar-${index}`,
            categorySlug: "maquinas-de-lavar-roupa",
          }),
        );
      }
      const listingId = await createListing(db, "A1");

      // Act
      await saveDetails(db, listingDetails(listingId, { ...NO_BRAND_MODEL, name: WASHER_NAME }));

      // Assert
      expect((await getCandidates(db, listingId)).map((candidate) => candidate.candidate_product_id)).toEqual(
        ids.slice(0, 3),
      );
    });

    it("creates a product without EAN when nothing is similar", async () => {
      // Arrange
      await insertProduct(db, { name: "Televisor LG OLED55C46LA 55 polegadas", slug: "lg-oled" });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId));

      // Assert
      expect(outcome).toBe("created");
      const product = await getProduct(db, (await getListing(db, listingId)).product_id);
      expect(product).toMatchObject({ ean: null, slug: SLUG_BASE, brand_norm: "samsung" });
    });

    it("adds -2, -3… to the slug when the base is taken", async () => {
      // Arrange
      await insertProduct(db, { name: "Frigorífico Combinado Bosch KGN39VWEQ", slug: SLUG_BASE });
      await insertProduct(db, { name: "Aspirador Dyson V15 Detect", slug: `${SLUG_BASE}-2` });
      const listingId = await createListing(db, "A1");

      // Act
      await saveDetails(db, listingDetails(listingId));

      // Assert
      expect((await getProduct(db, (await getListing(db, listingId)).product_id)).slug).toBe(
        `${SLUG_BASE}-3`,
      );
    });

    it("answers already_linked when the listing is linked and has no EAN", async () => {
      // Arrange
      const listingId = await createListing(db, "A1");
      await saveDetails(db, listingDetails(listingId));
      const productId = (await getListing(db, listingId)).product_id;

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { model: "WW90T534DAE/S3" }));

      // Assert
      expect(outcome).toBe("already_linked");
      expect((await getListing(db, listingId)).product_id).toBe(productId);
      expect(await getProducts(db)).toHaveLength(1);
    });

    it("never offers a product a reviewer rejected for this listing", async () => {
      // Arrange
      const rejected = await insertProduct(db, {
        name: WASHER_NAME,
        slug: "rejected",
        brandNorm: "samsung",
        modelNorm: "WW90T534DAE",
      });
      const listingId = await createListing(db, "A1");
      await db.query(
        "insert into match_candidates (listing_id, candidate_product_id, confidence, status) values ($1, $2, 1, 'rejected')",
        [listingId, rejected],
      );

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { name: WASHER_NAME }));

      // Assert
      expect(outcome).toBe("created");
      expect((await getListing(db, listingId)).product_id).not.toBe(rejected);
    });
  });

  describe("another model of the same brand", () => {
    const EMS686BR = {
      brand: "ELECTRONIA",
      model: "EMS686BR",
      brandNorm: "electronia",
      modelNorm: "EMS686BR",
      name: "MÁQUINA LAVAR ROUPA ELECTRONIA EMS686BR",
      slugBase: "electronia-ems686br-maquina-de-lavar-roupa",
    } as const;

    async function insertEwm38br(): Promise<number> {
      return await insertProduct(db, {
        name: "MÁQUINA LAVAR ROUPA ELECTRONIA EWM38BR",
        slug: "electronia-ewm38br-maquina-de-lavar-roupa",
        brandNorm: "electronia",
        modelNorm: "EWM38BR",
        categorySlug: "maquinas-de-lavar-roupa",
      });
    }

    it("is never suggested for a similar title, so the listing gets its own product", async () => {
      // Arrange
      const otherModel = await insertEwm38br();
      const listingId = await createListing(db, "1336011", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, EMS686BR));

      // Assert
      expect(outcome).toBe("created");
      expect(await getCandidates(db, listingId)).toEqual([]);
      const listing = await getListing(db, listingId);
      expect(listing.product_id).not.toBe(otherModel);
      expect(await getProduct(db, listing.product_id)).toMatchObject({
        brand_norm: "electronia",
        model_norm: "EMS686BR",
        slug: "electronia-ems686br-maquina-de-lavar-roupa",
      });
    });

    it("leaves the other similar titles as candidates, such as a product without a model", async () => {
      // Arrange
      await insertEwm38br();
      const withoutModel = await insertProduct(db, {
        name: "MÁQUINA LAVAR ROUPA ELECTRONIA EMS686BR 8KG",
        slug: "without-model",
        brandNorm: "electronia",
        categorySlug: "maquinas-de-lavar-roupa",
      });
      const listingId = await createListing(db, "1336011", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, EMS686BR));

      // Assert
      expect(outcome).toBe("candidate");
      const candidates = await getCandidates(db, listingId);
      expect(candidates.map((candidate) => candidate.candidate_product_id)).toEqual([withoutModel]);
    });

    it("is still suggested when the listing has no model", async () => {
      // Arrange
      const otherModel = await insertEwm38br();
      const listingId = await createListing(db, "1336011", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(
        db,
        listingDetails(listingId, { ...EMS686BR, model: null, modelNorm: null }),
      );

      // Assert
      expect(outcome).toBe("candidate");
      const candidates = await getCandidates(db, listingId);
      expect(candidates.map((candidate) => candidate.candidate_product_id)).toEqual([otherModel]);
    });

    it("does not cover brands written differently, which stay candidates", async () => {
      // Arrange
      const otherBrand = await insertProduct(db, {
        name: `${WASHER_NAME} Inox`,
        slug: "samsung-electronics",
        brandNorm: "samsungelectronics",
        modelNorm: "WW90T534DAEEP",
        categorySlug: "maquinas-de-lavar-roupa",
      });
      const listingId = await createListing(db, "A1");

      // Act
      const outcome = await saveDetails(db, listingDetails(listingId, { name: WASHER_NAME }));

      // Assert
      expect(outcome).toBe("candidate");
      const candidates = await getCandidates(db, listingId);
      expect(candidates.map((candidate) => candidate.candidate_product_id)).toEqual([otherBrand]);
    });
  });

  describe("a product the listing's store already lists", () => {
    const WHITE_8KG = "MÁQUINA LAVAR ROUPA ELECTRONIA 8KG BRANCA";
    const WHITE_7KG = "MÁQUINA LAVAR ROUPA ELECTRONIA 7KG BRANCA";

    /** A Radio Popular own-brand washer without a model code, like most of the review queue. */
    function ownBrand(
      listingId: number,
      name: string,
      overrides: Partial<ListingDetailsInput> = {},
    ): ListingDetailsInput {
      return listingDetails(listingId, {
        brand: "ELECTRONIA",
        model: null,
        brandNorm: "electronia",
        modelNorm: null,
        name,
        slugBase: `electronia-${name.includes("8KG") ? "8kg" : "7kg"}-maquina-de-lavar-roupa`,
        ...overrides,
      });
    }

    it("is never suggested for a similar title, so the listing gets its own product", async () => {
      // Arrange
      const firstId = await createListing(db, "1340981", { storeSlug: "radiopopular" });
      await saveDetails(db, ownBrand(firstId, WHITE_8KG));
      const storeProduct = (await getListing(db, firstId)).product_id;
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_7KG));

      // Assert
      expect(outcome).toBe("created");
      expect(await getCandidates(db, listingId)).toEqual([]);
      const listing = await getListing(db, listingId);
      expect(listing.product_id).not.toBe(storeProduct);
      expect(await getProduct(db, listing.product_id)).toMatchObject({ name: WHITE_7KG, ean: null });
    });

    it("is never suggested even when another store lists it too", async () => {
      // Arrange
      const dartyId = await createListing(db, "D1");
      await saveDetails(db, ownBrand(dartyId, WHITE_8KG, { ean: EAN_A }));
      const radioPopularId = await createListing(db, "1340981", { storeSlug: "radiopopular" });
      await saveDetails(db, ownBrand(radioPopularId, WHITE_8KG, { ean: EAN_A }));
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_7KG));

      // Assert
      expect(outcome).toBe("created");
      expect(await getCandidates(db, listingId)).toEqual([]);
    });

    it("is still suggested when only another store lists it", async () => {
      // Arrange
      const dartyId = await createListing(db, "D1");
      await saveDetails(db, ownBrand(dartyId, WHITE_8KG));
      const dartyProduct = (await getListing(db, dartyId)).product_id;
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_7KG));

      // Assert
      expect(outcome).toBe("candidate");
      expect((await getCandidates(db, listingId)).map((candidate) => candidate.candidate_product_id)).toEqual(
        [dartyProduct],
      );
    });

    it("is never linked by the same brand and model, so the listing gets its own product", async () => {
      // Arrange
      const sameModel = { model: "EWM38BR", modelNorm: "EWM38BR" } as const;
      const firstId = await createListing(db, "1340981", { storeSlug: "radiopopular" });
      await saveDetails(db, ownBrand(firstId, WHITE_8KG, sameModel));
      const storeProduct = (await getListing(db, firstId)).product_id;
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_8KG, sameModel));

      // Assert
      expect(outcome).toBe("created");
      expect(await getCandidates(db, listingId)).toEqual([]);
      const listing = await getListing(db, listingId);
      expect(listing.product_id).not.toBe(storeProduct);
      expect(await getProduct(db, listing.product_id)).toMatchObject({
        ean: null,
        brand_norm: "electronia",
        model_norm: "EWM38BR",
      });
    });

    it("never counts among the products of the same brand and model, so the only other one is linked", async () => {
      // Arrange
      const sameModel = { model: "EWM38BR", modelNorm: "EWM38BR" } as const;
      const firstId = await createListing(db, "1340981", { storeSlug: "radiopopular" });
      await saveDetails(db, ownBrand(firstId, WHITE_8KG, sameModel));
      const otherProduct = await insertProduct(db, {
        name: WHITE_7KG,
        slug: "electronia-ewm38br-darty",
        ean: EAN_B,
        brandNorm: "electronia",
        modelNorm: "EWM38BR",
      });
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_8KG, sameModel));

      // Assert
      expect(outcome).toBe("linked_brand_model");
      expect((await getListing(db, listingId)).product_id).toBe(otherProduct);
      expect(await getCandidates(db, listingId)).toEqual([]);
    });

    it("is never suggested with the other products of the same brand and model", async () => {
      // Arrange
      const sameModel = { model: "EWM38BR", modelNorm: "EWM38BR" } as const;
      const firstId = await createListing(db, "1340981", { storeSlug: "radiopopular" });
      await saveDetails(db, ownBrand(firstId, WHITE_8KG, sameModel));
      const otherProducts = [
        await insertProduct(db, {
          name: WHITE_7KG,
          slug: "electronia-ewm38br-darty",
          ean: EAN_B,
          brandNorm: "electronia",
          modelNorm: "EWM38BR",
        }),
        await insertProduct(db, {
          name: `${WHITE_7KG} INOX`,
          slug: "electronia-ewm38br-inox",
          ean: EAN_C,
          brandNorm: "electronia",
          modelNorm: "EWM38BR",
        }),
      ];
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_8KG, sameModel));

      // Assert
      expect(outcome).toBe("candidate");
      expect(
        (await getCandidates(db, listingId))
          .map((candidate) => candidate.candidate_product_id)
          .toSorted((a, b) => a - b),
      ).toEqual(otherProducts);
    });

    it("still joins two of the store's listings that share a valid EAN", async () => {
      // Arrange
      const firstId = await createListing(db, "1340981", { storeSlug: "radiopopular" });
      await saveDetails(db, ownBrand(firstId, WHITE_8KG, { ean: EAN_A }));
      const listingId = await createListing(db, "1340982", { storeSlug: "radiopopular" });

      // Act
      const outcome = await saveDetails(db, ownBrand(listingId, WHITE_7KG, { ean: EAN_A }));

      // Assert
      expect(outcome).toBe("linked_ean");
      expect((await getListing(db, listingId)).product_id).toBe((await getListing(db, firstId)).product_id);
    });
  });
});
