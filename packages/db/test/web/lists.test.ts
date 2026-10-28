import { categoryAndChildren } from "@descontoreal/core";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getListFacets, type ListCriteria, listProducts } from "../../src/web";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import { asSite, NOW, seedCatalogue } from "./catalogue";

const WASHING_MACHINES: ListCriteria = {
  categories: ["maquinas-de-lavar-roupa"],
  sort: "desconto",
  offset: 0,
  limit: 24,
  now: NOW,
};

describe("listProducts", () => {
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

  async function slugs(criteria: ListCriteria): Promise<string[]> {
    const list = await asSite(db, async (query) => await listProducts(query, criteria));
    return list.items.map((item) => item.slug);
  }

  it("shows each product once with its cheapest current offer and the label computed for that price", async () => {
    // Act
    const list = await asSite(db, async (query) => await listProducts(query, WASHING_MACHINES));

    // Assert
    expect(list.total).toBe(3);
    expect(list.items[0]).toEqual({
      productId: ids.ww90,
      slug: "samsung-ww90t534dae",
      name: "Samsung WW90T534DAE",
      brand: "Samsung",
      imageUrl: "https://darty.pt/cdn/shop/files/ww90.jpg",
      storeName: "Darty",
      priceCents: 44_999,
      onSale: true,
      storeCount: 2,
      label: { code: "bom_preco", name: "Bom preço", tone: "positive", text: "Texto de Bom preço." },
      realDiscountPct: 13.5,
    });
  });

  it("orders by real discount with labels for old prices last, and products not on sale after the rest", async () => {
    // Act
    const order = await slugs(WASHING_MACHINES);

    // Assert
    expect(order).toEqual(["samsung-ww90t534dae", "lg-f4wr709", "bosch-wgg244"]);
  });

  it("drops a label computed for another price", async () => {
    // Act
    const list = await asSite(db, async (query) => await listProducts(query, WASHING_MACHINES));

    // Assert
    expect(list.items[1]).toMatchObject({ slug: "lg-f4wr709", label: null, realDiscountPct: null });
  });

  it.each([
    ["preco" as const, ["lg-f4wr709", "samsung-ww90t534dae", "bosch-wgg244"]],
    ["preco-desc" as const, ["samsung-ww90t534dae", "lg-f4wr709", "bosch-wgg244"]],
  ])("sorts by %s", async (sort, expected) => {
    // Act
    const order = await slugs({ ...WASHING_MACHINES, sort });

    // Assert
    expect(order).toEqual(expected);
  });

  it("shows a store's own price when filtered by store", async () => {
    // Act
    const list = await asSite(
      db,
      async (query) => await listProducts(query, { ...WASHING_MACHINES, store: "radiopopular" }),
    );

    // Assert
    expect(list.items.map((item) => [item.slug, item.storeName, item.priceCents])).toEqual([
      ["samsung-ww90t534dae", "Radio Popular", 47_999],
      ["bosch-wgg244", "Radio Popular", 59_999],
    ]);
  });

  it("filters by label and by price range, the maximum excluded", async () => {
    // Act
    const byLabel = await slugs({ ...WASHING_MACHINES, label: "bom_preco" });
    const byPrice = await slugs({ ...WASHING_MACHINES, minPriceCents: 40_000, maxPriceCents: 44_999 });

    // Assert
    expect(byLabel).toEqual(["samsung-ww90t534dae"]);
    expect(byPrice).toEqual([]);
  });

  it("pages through the list and keeps the total", async () => {
    // Act
    const list = await asSite(
      db,
      async (query) => await listProducts(query, { ...WASHING_MACHINES, offset: 1, limit: 1 }),
    );

    // Assert
    expect(list.total).toBe(3);
    expect(list.items.map((item) => item.slug)).toEqual(["lg-f4wr709"]);
  });

  it("lists a top category with its children, and a brand across categories", async () => {
    // Act
    const tvAndSound = await slugs({ ...WASHING_MACHINES, categories: categoryAndChildren("tv-e-som") });
    const samsung = await slugs({ ...WASHING_MACHINES, categories: null, brandNorm: "samsung" });

    // Assert
    expect(tvAndSound).toEqual(["samsung-qe55"]);
    expect(samsung).toEqual(["samsung-qe55", "samsung-ww90t534dae"]);
  });

  it("keeps the order of search results and leaves out the product of the page", async () => {
    // Act
    const searched = await slugs({
      ...WASHING_MACHINES,
      categories: null,
      productIds: [ids.lg, ids.ww90],
      sort: "relevancia",
    });
    const related = await slugs({ ...WASHING_MACHINES, excludeProductId: ids.ww90 });

    // Assert
    expect(searched).toEqual(["lg-f4wr709", "samsung-ww90t534dae"]);
    expect(related).toEqual(["lg-f4wr709", "bosch-wgg244"]);
  });
});

describe("getListFacets", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createMigratedDatabase();
    await resetData(db);
    await seedCatalogue(db);
  }, SETUP_TIMEOUT_MS);

  afterAll(async () => {
    await db.close();
  });

  it("counts brands, stores and current labels of the list", async () => {
    // Act
    const facets = await asSite(db, async (query) => await getListFacets(query, WASHING_MACHINES));

    // Assert
    expect(facets).toEqual({
      brands: [
        { value: "bosch", name: "Bosch", count: 1 },
        { value: "lg", name: "LG", count: 1 },
        { value: "samsung", name: "Samsung", count: 1 },
      ],
      stores: [
        { value: "darty", name: "Darty", count: 2 },
        { value: "radiopopular", name: "Radio Popular", count: 2 },
      ],
      labels: [{ value: "bom_preco", name: "bom_preco", count: 1 }],
    });
  });
});
