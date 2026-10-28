import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getProductPage } from "../../src/web";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import { asSite, SEEN, seedCatalogue } from "./catalogue";

describe("getProductPage", () => {
  let db: PGlite;
  let ids: Awaited<ReturnType<typeof seedCatalogue>>;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await resetData(db);
    ids = await seedCatalogue(db);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  it("returns the product, its category with the parent and its facts", async () => {
    // Act
    const page = await asSite(db, async (query) => await getProductPage(query, "samsung-ww90t534dae"));

    // Assert
    expect(page).toMatchObject({
      id: ids.ww90,
      slug: "samsung-ww90t534dae",
      name: "Samsung WW90T534DAE",
      brand: "Samsung",
      brandNorm: "samsung",
      model: "WW90T534DAE",
      ean: "8806094932287",
      imageUrl: "https://darty.pt/cdn/shop/files/ww90.jpg",
      specs: { Capacidade: "9 kg" },
      category: {
        slug: "maquinas-de-lavar-roupa",
        name: "Máquinas de lavar roupa",
        parent: { slug: "grandes-eletrodomesticos", name: "Grandes eletrodomésticos" },
      },
    });
  });

  it("returns the listings sold by the stores, with their intervals oldest first and current labels", async () => {
    // Act
    const page = await asSite(db, async (query) => await getProductPage(query, "samsung-ww90t534dae"));

    // Assert
    expect(page?.listings.map((listing) => listing.storeName)).toEqual(["Darty", "Radio Popular"]);
    expect(page?.listings[0]).toMatchObject({
      storeSlug: "darty",
      url: "https://darty.pt/products/samsung-ww90t534dae",
      active: true,
      missedRuns: 0,
      lastSeenAt: SEEN,
      label: { code: "bom_preco", name: "Bom preço", tone: "positive", text: "Texto de Bom preço." },
    });
    expect(page?.listings[0]?.intervals).toEqual([
      {
        priceCents: 51_999,
        referencePriceCents: null,
        inStock: true,
        validFrom: new Date("2026-10-28T04:00:00Z"),
        validTo: new Date("2026-11-05T04:00:00Z"),
      },
      {
        priceCents: 44_999,
        referencePriceCents: null,
        inStock: true,
        validFrom: new Date("2026-11-05T04:00:00Z"),
        validTo: null,
      },
    ]);
  });

  it("leaves out the label computed for another price", async () => {
    // Act
    const page = await asSite(db, async (query) => await getProductPage(query, "lg-f4wr709"));

    // Assert
    expect(page?.listings[0]?.label).toBeNull();
  });

  it("returns null for an unknown product", async () => {
    // Act
    const page = await asSite(db, async (query) => await getProductPage(query, "nao-existe"));

    // Assert
    expect(page).toBeNull();
  });
});
