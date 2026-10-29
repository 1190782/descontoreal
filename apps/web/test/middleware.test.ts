import type { CookieMethodsServer, CookieOptionsWithName } from "@supabase/ssr";
import type { JwtPayload } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { config, middleware } from "@/middleware";

interface ClaimsResult {
  data: { claims: Partial<JwtPayload> } | null;
}

const supabase = vi.hoisted(() => ({
  /** What getClaims returns, after it optionally writes cookies through the middleware's setAll. */
  getClaims: vi.fn<(cookies: CookieMethodsServer) => Promise<ClaimsResult>>(),
  options: [] as { cookieOptions?: CookieOptionsWithName }[],
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: { cookies: CookieMethodsServer; cookieOptions?: CookieOptionsWithName },
  ) => {
    supabase.options.push(options);
    return { auth: { getClaims: () => supabase.getClaims(options.cookies) } };
  },
}));

const PAGE = "https://descontoreal.pt/admin/correspondencias";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projeto.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_teste");
});

afterEach(() => {
  vi.unstubAllEnvs();
  supabase.getClaims.mockReset();
  supabase.options.length = 0;
});

describe("middleware", () => {
  it("only runs on the admin pages", () => {
    // Assert
    expect(config.matcher).toEqual(["/admin/:path*"]);
  });

  it("lets an admin through", async () => {
    // Arrange
    supabase.getClaims.mockResolvedValue({ data: { claims: { app_metadata: { role: "admin" } } } });

    // Act
    const response = await middleware(new NextRequest(PAGE));

    // Assert
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("sends a visitor without a session to /entrar", async () => {
    // Arrange
    supabase.getClaims.mockResolvedValue({ data: null });

    // Act
    const response = await middleware(new NextRequest(PAGE));

    // Assert
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://descontoreal.pt/entrar");
  });

  it("tells a signed-in user who is not an admin why", async () => {
    // Arrange
    supabase.getClaims.mockResolvedValue({ data: { claims: { app_metadata: {} } } });

    // Act
    const response = await middleware(new NextRequest(PAGE));

    // Assert
    expect(response.headers.get("location")).toBe("https://descontoreal.pt/entrar?aviso=sem-acesso");
  });

  it("writes a refreshed session to the response, for /admin only and never cached", async () => {
    // Arrange
    supabase.getClaims.mockImplementation(async (cookies) => {
      await cookies.setAll?.(
        [{ name: "sb-projeto-auth-token", value: "novo", options: { path: "/admin", httpOnly: true } }],
        { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
      );
      return { data: { claims: { app_metadata: { role: "admin" } } } };
    });

    // Act
    const response = await middleware(new NextRequest(PAGE));

    // Assert
    expect(supabase.options[0]?.cookieOptions).toMatchObject({
      path: "/admin",
      httpOnly: true,
      secure: true,
    });
    expect(response.cookies.get("sb-projeto-auth-token")).toMatchObject({ value: "novo", path: "/admin" });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps the cleared session, never cached, on the way to /entrar", async () => {
    // Arrange
    supabase.getClaims.mockImplementation(async (cookies) => {
      await cookies.setAll?.(
        [{ name: "sb-projeto-auth-token", value: "", options: { path: "/admin", maxAge: 0 } }],
        { "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0" },
      );
      return { data: null };
    });

    // Act
    const response = await middleware(new NextRequest(PAGE));

    // Assert
    expect(response.status).toBe(303);
    expect(response.cookies.get("sb-projeto-auth-token")).toMatchObject({ value: "", maxAge: 0 });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
});
