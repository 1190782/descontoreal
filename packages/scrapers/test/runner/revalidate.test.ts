import { BOT_USER_AGENT } from "@descontoreal/core";
import { describe, expect, it } from "vitest";
import type { Logger } from "../../src/http/logger";
import { REVALIDATE_CHUNK_SIZE, revalidateProducts } from "../../src/runner/revalidate";
import { fakeTransport, jsonResponse } from "../fakes/fake-transport";

const ENDPOINT = "https://descontoreal.test/api/revalidate";

function recordingLog(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    info: () => undefined,
    warn: (message) => {
      warnings.push(message);
    },
    error: () => undefined,
    warnings,
  };
}

describe("revalidateProducts", () => {
  it("posts the slugs in chunks of 200 with the bearer secret", async () => {
    // Arrange
    const slugs = Array.from({ length: REVALIDATE_CHUNK_SIZE + 1 }, (_, index) => `produto-${index}`);
    const { transport, calls } = fakeTransport({ [ENDPOINT]: jsonResponse("{}") });

    // Act
    const accepted = await revalidateProducts(
      slugs,
      { siteUrl: "https://descontoreal.test", secret: "segredo", transport },
      recordingLog(),
    );

    // Assert
    expect(accepted).toBe(201);
    expect(calls.map((call) => call.url)).toEqual([ENDPOINT, ENDPOINT]);
    expect(calls[0]?.init.method).toBe("POST");
    const headers = new Headers(calls[0]?.init.headers);
    expect([headers.get("authorization"), headers.get("content-type"), headers.get("user-agent")]).toEqual([
      "Bearer segredo",
      "application/json",
      BOT_USER_AGENT,
    ]);
    expect(calls[0]?.init.body).toBe(JSON.stringify({ slugs: slugs.slice(0, 200) }));
    expect(calls[1]?.init.body).toBe(JSON.stringify({ slugs: ["produto-200"] }));
  });

  it("drops trailing slashes from SITE_URL", async () => {
    // Arrange
    const { transport, calls } = fakeTransport({ [ENDPOINT]: jsonResponse("{}") });

    // Act
    await revalidateProducts(
      ["a"],
      { siteUrl: "https://descontoreal.test//", secret: "segredo", transport },
      recordingLog(),
    );

    // Assert
    expect(calls.map((call) => call.url)).toEqual([ENDPOINT]);
  });

  it("logs failures without throwing and without the secret", async () => {
    // Arrange
    const log = recordingLog();
    const { transport } = fakeTransport({
      [ENDPOINT]: [jsonResponse("{}", 401), new TypeError("fetch failed")],
    });
    const slugs = Array.from({ length: REVALIDATE_CHUNK_SIZE * 2 }, (_, index) => `produto-${index}`);

    // Act
    const accepted = await revalidateProducts(
      slugs,
      { siteUrl: "https://descontoreal.test", secret: "segredo-muito-secreto", transport },
      log,
    );

    // Assert
    expect(accepted).toBe(0);
    expect(log.warnings).toEqual([
      "Revalidation of 200 product pages failed: HTTP 401",
      "Revalidation of 200 product pages failed: fetch failed",
    ]);
  });
});
