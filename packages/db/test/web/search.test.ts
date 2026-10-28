import { parseSearchQuery } from "@descontoreal/core";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { searchProducts } from "../../src/web";
import { createMigratedDatabase, resetData, SETUP_TIMEOUT_MS } from "../helpers/database";
import { asSite, seedCatalogue } from "./catalogue";

describe("searchProducts", () => {
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

  async function search(raw: string): ReturnType<typeof searchProducts> {
    return await asSite(db, async (query) => await searchProducts(query, parseSearchQuery(raw), 20));
  }

  it("finds a product by EAN", async () => {
    // Act
    const result = await search("8806094932287");

    // Assert
    expect(result).toEqual({ kind: "products", productIds: [ids.ww90] });
  });

  it("finds a product by its store address, also when the stored one has a variant", async () => {
    // Act
    const exact = await search("https://www.darty.pt/products/samsung-ww90t534dae/");
    const withVariant = await search("darty.pt/products/lg-f4wr709");

    // Assert
    expect(exact).toEqual({ kind: "products", productIds: [ids.ww90] });
    expect(withVariant).toEqual({ kind: "products", productIds: [ids.lg] });
  });

  it("says when a store address matches no listing", async () => {
    // Act
    const result = await search("https://darty.pt/products/nao-existe");

    // Assert
    expect(result).toEqual({ kind: "listing-not-found" });
  });

  it("finds products by model code first, then by similar names", async () => {
    // Act
    const byModel = await search("ww90t534dae");
    const byName = await search("lg f4wr709");

    // Assert
    expect(byModel).toEqual({ kind: "products", productIds: [ids.ww90] });
    expect(byName).toMatchObject({ kind: "products", productIds: [ids.lg] });
  });

  it("matches % and _ in the words literally", async () => {
    // Act
    const result = await search("100%");

    // Assert
    expect(result).toEqual({ kind: "products", productIds: [] });
  });
});
