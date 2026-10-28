import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/revalidate/route";
import { isAuthorized, MAX_SLUGS, parseRevalidateBody } from "@/lib/revalidate";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const SECRET = "segredo-de-teste";

function request(body: unknown, authorization: string | null = `Bearer ${SECRET}`): Request {
  return new Request("https://descontoreal.pt/api/revalidate", {
    method: "POST",
    headers: authorization === null ? {} : { Authorization: authorization },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("parseRevalidateBody", () => {
  it("reads product slugs, without repeats", () => {
    // Act
    const parsed = parseRevalidateBody({ slugs: ["samsung-ww90t534dae", "lg-55qned", "lg-55qned"] });

    // Assert
    expect(parsed).toEqual({ all: false, slugs: ["samsung-ww90t534dae", "lg-55qned"] });
  });

  it("reads a request for every page", () => {
    // Act
    const parsed = parseRevalidateBody({ all: true });

    // Assert
    expect(parsed).toEqual({ all: true });
  });

  it.each([
    [null],
    ["slugs"],
    [{}],
    [{ all: "true" }],
    [{ slugs: [] }],
    [{ slugs: "lg-55qned" }],
    [{ slugs: ["lg-55qned", "../admin"] }],
    [{ slugs: ["LG-55QNED"] }],
    [{ slugs: Array.from({ length: MAX_SLUGS + 1 }, (_, index) => `produto-${index}`) }],
  ])("rejects %j", (body) => {
    // Act
    const parsed = parseRevalidateBody(body);

    // Assert
    expect(parsed).toBeNull();
  });
});

describe("isAuthorized", () => {
  it.each([
    [`Bearer ${SECRET}`, SECRET, true],
    [`Bearer ${SECRET}x`, SECRET, false],
    [SECRET, SECRET, false],
    [null, SECRET, false],
    ["Bearer ", "", false],
    ["Bearer undefined", undefined, false],
  ])("isAuthorized(%j, %j) is %s", (header, secret, expected) => {
    // Act
    const authorized = isAuthorized(header, secret);

    // Assert
    expect(authorized).toBe(expected);
  });
});

describe("POST /api/revalidate", () => {
  beforeEach(() => {
    vi.stubEnv("REVALIDATE_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.mocked(revalidatePath).mockClear();
  });

  it("refuses a request without the secret and revalidates nothing", async () => {
    // Act
    const response = await POST(request({ all: true }, "Bearer outro"));

    // Assert
    expect(response.status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses a body that is not JSON or not valid", async () => {
    // Act
    const notJson = await POST(request("{"));
    const invalid = await POST(request({ slugs: ["../admin"] }));

    // Assert
    expect([notJson.status, invalid.status]).toEqual([400, 400]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates the product pages of the slugs", async () => {
    // Act
    const response = await POST(request({ slugs: ["samsung-ww90t534dae", "lg-55qned"] }));

    // Assert
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ revalidated: 2 });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/p/samsung-ww90t534dae"], ["/p/lg-55qned"]]);
  });

  it("revalidates every page for { all: true }", async () => {
    // Act
    const response = await POST(request({ all: true }));

    // Assert
    expect(await response.json()).toEqual({ revalidated: "all" });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/", "layout"]]);
  });
});
