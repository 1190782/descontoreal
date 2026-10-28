import type {
  ListingObservation,
  ListingPage,
  ProductDetails,
  StoreCategory,
  StoreScraper,
} from "../../src/types";

export const FAKE_STORE_URL = "https://loja.test";
export const FAKE_STORE_NAME = "Loja Teste";
export const VALID_EAN = "5901234123457";

/** A listing page of the fake store: JSON with the same shape as ListingPage. */
export function listingBody(items: readonly ListingObservation[], nextPageUrl: string | null = null): string {
  return JSON.stringify({ items, nextPageUrl });
}

/** A product page of the fake store: JSON with the same shape as ProductDetails. */
export function productBody(details: ProductDetails): string {
  return JSON.stringify(details);
}

export function fakeCategory(key: string, overrides: Partial<StoreCategory> = {}): StoreCategory {
  return { key, categorySlug: "televisores", url: `${FAKE_STORE_URL}/c/${key}`, ...overrides };
}

export function productUrl(storeSku: string): string {
  return `${FAKE_STORE_URL}/p/${storeSku}`;
}

/** A store-sold item without listing facts (ean undefined), so new listings need their product page. */
export function listingItem(
  storeSku: string,
  overrides: Partial<ListingObservation> = {},
): ListingObservation {
  return {
    storeSku,
    url: productUrl(storeSku),
    title: `Televisor ${storeSku}`,
    priceCents: 49_999,
    referencePriceCents: null,
    inStock: true,
    sellerName: FAKE_STORE_NAME,
    ...overrides,
  };
}

export function productDetails(storeSku: string, overrides: Partial<ProductDetails> = {}): ProductDetails {
  return {
    storeSku,
    url: productUrl(storeSku),
    title: `Televisor ${storeSku}`,
    ean: VALID_EAN,
    brand: "Samsung",
    model: "QE55Q67CATXXC",
    imageUrl: `${FAKE_STORE_URL}/img/${storeSku}.jpg`,
    specs: { Ecrã: "55 polegadas" },
    sellerName: FAKE_STORE_NAME,
    priceCents: 49_999,
    referencePriceCents: null,
    inStock: true,
    ...overrides,
  };
}

/** StoreScraper over JSON pages. The store sells an item when sellerName is "Loja Teste"; null means unknown. */
export function createFakeStore(
  categories: readonly StoreCategory[],
  overrides: Partial<StoreScraper> = {},
): StoreScraper {
  return {
    slug: "darty",
    name: FAKE_STORE_NAME,
    baseUrl: FAKE_STORE_URL,
    listCategories: () => [...categories],
    parseListingPage: (body) => JSON.parse(body) as ListingPage,
    parseProductPage: (body) => JSON.parse(body) as ProductDetails,
    isSoldByStore: (item) => (item.sellerName === null ? null : item.sellerName === FAKE_STORE_NAME),
    ...overrides,
  };
}
