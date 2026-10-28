import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getBrands, getCategoryCounts, getHomeData, getSitemapProducts } from "../../src/web";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import { asSite, NOW, SEEN, seedCatalogue } from "./catalogue";

describe("home and sitemap queries", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await resetData(db);
    await seedCatalogue(db);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  it("reads the stores we collect with their active listings and last reading", async () => {
    // Act
    const home = await asSite(db, async (query) => await getHomeData(query, NOW));

    // Assert
    expect(home.stores).toEqual([
      { slug: "darty", name: "Darty", lastSeenAt: SEEN, listings: 3 },
      { slug: "radiopopular", name: "Radio Popular", lastSeenAt: SEEN, listings: 2 },
    ]);
    expect(home.productCount).toBe(4);
  });

  it("offers current, on-sale listings with a current label as highlight candidates", async () => {
    // Act
    const home = await asSite(db, async (query) => await getHomeData(query, NOW));

    // Assert: the TV (real discount) and the Samsung at Darty (10% below its usual price); the LG's label is for
    // an old price and the Radio Popular price is its usual one.
    expect(home.highlightCandidates.map((candidate) => [candidate.productSlug, candidate.label])).toEqual([
      ["samsung-qe55", "desconto_real"],
      ["samsung-qe55", "desconto_real"],
      ["samsung-ww90t534dae", "bom_preco"],
    ]);
  });

  it("picks a product on sale whose price changed as the example", async () => {
    // Act
    const home = await asSite(db, async (query) => await getHomeData(query, NOW));

    // Assert
    expect(home.exampleSlug).toBe("samsung-ww90t534dae");
  });

  it("lists every product with a price history for the sitemap", async () => {
    // Act
    const products = await asSite(db, async (query) => await getSitemapProducts(query));

    // Assert
    expect(products).toEqual([
      {
        slug: "antigo",
        firstPriceAt: new Date("2026-10-28T04:00:00Z"),
        lastChangeAt: new Date("2026-10-28T04:00:00Z"),
        storeCount: 0,
      },
      {
        slug: "bosch-wgg244",
        firstPriceAt: new Date("2026-10-28T05:00:00Z"),
        lastChangeAt: new Date("2026-10-28T05:00:00Z"),
        storeCount: 1,
      },
      {
        slug: "lg-f4wr709",
        firstPriceAt: new Date("2026-11-01T04:00:00Z"),
        lastChangeAt: new Date("2026-11-01T04:00:00Z"),
        storeCount: 1,
      },
      {
        slug: "samsung-qe55",
        firstPriceAt: new Date("2026-11-02T04:00:00Z"),
        lastChangeAt: new Date("2026-11-02T04:00:00Z"),
        storeCount: 1,
      },
      {
        slug: "samsung-ww90t534dae",
        firstPriceAt: new Date("2026-10-28T04:00:00Z"),
        lastChangeAt: new Date("2026-11-05T04:00:00Z"),
        storeCount: 2,
      },
    ]);
  });

  it("counts brands and categories with a current price", async () => {
    // Act
    const [brands, categories] = await asSite(
      db,
      async (query) => await Promise.all([getBrands(query), getCategoryCounts(query)]),
    );

    // Assert
    expect(brands).toEqual([
      { brandNorm: "bosch", name: "Bosch", products: 1 },
      { brandNorm: "lg", name: "LG", products: 1 },
      { brandNorm: "samsung", name: "Samsung", products: 2 },
    ]);
    expect(categories).toEqual([
      { slug: "maquinas-de-lavar-roupa", products: 3 },
      { slug: "televisores", products: 1 },
    ]);
  });
});
