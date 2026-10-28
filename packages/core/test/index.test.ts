import { describe, expect, it } from "vitest";
import * as core from "../src/index";

describe("package entry point", () => {
  it("exports the functions other packages code against", () => {
    // Arrange
    const functions = [
      "classify",
      "computeWindowStats",
      "timeWeightedMedian",
      "parsePriceToCents",
      "decimalToCents",
      "formatCents",
      "formatPercent",
      "formatSignedPercent",
      "percentBelow",
      "normalizeGtin",
      "hasValidCheckDigit",
      "normalizeBrand",
      "normalizeModel",
      "slugify",
      "productSlugBase",
      "lisbonDate",
      "formatDatePt",
      "daysBetween",
      "calendarDaysBetween",
      "isSuspiciousPriceJump",
      "isBrokenRun",
      "isCategorySlug",
      "getCategory",
      "isStoreSlug",
      "getStore",
      "activeStores",
      "organizationJsonLd",
      "serializeJsonLd",
      "productJsonLd",
      "breadcrumbJsonLd",
      "productTitle",
      "productDescription",
      "centsToDecimal",
      "formatList",
      "isCurrentOffer",
      "currentIntervalOf",
      "currentOffers",
      "trackedSince",
      "lowestPriceBetween",
      "highestPriceBetween",
      "cheapestStoreShare",
      "isProductIndexable",
      "priceSummary",
      "productFaq",
      "chartSeries",
      "pickHighlights",
      "parseFilterSegments",
      "filterSegments",
      "isFilteredView",
      "labelSlug",
      "labelFromSlug",
      "parseStoreUrl",
      "parseSearchQuery",
      "isLabelCode",
      "categoryAndChildren",
    ];
    const exports: Record<string, unknown> = core;

    // Act
    const missing = functions.filter((name) => typeof exports[name] !== "function");

    // Assert
    expect(missing).toEqual([]);
  });

  it("exports the shared constants", () => {
    // Arrange
    const constants = [
      "LABELS_CONFIG",
      "LABEL_NAMES",
      "LABEL_TONES",
      "WARNING_NAMES",
      "QUALITY_CONFIG",
      "CATEGORIES",
      "STORES",
      "SITE",
      "BOT_USER_AGENT",
      "BOT_POLICY",
      "OFFER_MAX_AGE_DAYS",
      "INDEXING_RULES",
      "SUMMARY_DAYS",
      "MIN_DROP_WINDOW_DAYS",
      "PRICE_BUCKETS",
      "DEFAULT_FILTERS",
      "MAX_QUERY_LENGTH",
      "DAY_MS",
      "TIME_ZONE",
    ];
    const exports: Record<string, unknown> = core;

    // Act
    const missing = constants.filter((name) => exports[name] === undefined);

    // Assert
    expect(missing).toEqual([]);
  });

  it("keeps the interval helpers internal", () => {
    // Arrange
    const internal = [
      "overlapMs",
      "sortByValidFrom",
      "findCurrentInterval",
      "firstOfSamePrice",
      "lowestPriceIn",
      "highestIntervalIn",
      "daysBefore",
    ];
    const exports: Record<string, unknown> = core;

    // Act
    const leaked = internal.filter((name) => name in exports);

    // Assert
    expect(leaked).toEqual([]);
  });
});
