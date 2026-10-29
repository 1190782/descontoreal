import type { JwtPayload } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isAdmin, noticeText, parseEmail, parseId, signInLinkNotice, supabaseConfig } from "@/lib/admin";

function claims(appMetadata: Record<string, unknown>): JwtPayload {
  return {
    iss: "https://projeto.supabase.co/auth/v1",
    sub: "11111111-1111-1111-1111-111111111111",
    aud: "authenticated",
    exp: 1_900_000_000,
    iat: 1_800_000_000,
    role: "authenticated",
    aal: "aal1",
    session_id: "22222222-2222-2222-2222-222222222222",
    app_metadata: appMetadata,
  };
}

describe("isAdmin", () => {
  it.each([
    ["an admin", claims({ role: "admin" }), true],
    ["another role", claims({ role: "editor" }), false],
    ["no role", claims({}), false],
    ["no session", undefined, false],
  ])("answers %s with %s", (_case, payload, expected) => {
    // Act
    const admin = isAdmin(payload);

    // Assert
    expect(admin).toBe(expected);
  });
});

describe("parseEmail", () => {
  it("trims the address", () => {
    // Act
    const email = parseEmail("  admin@descontoreal.pt ");

    // Assert
    expect(email).toBe("admin@descontoreal.pt");
  });

  it.each([
    [null],
    [""],
    ["admin"],
    ["admin@descontoreal"],
    ["a b@descontoreal.pt"],
    [`${"a".repeat(250)}@x.pt`],
  ])("rejects %j", (value) => {
    // Act
    const email = parseEmail(value);

    // Assert
    expect(email).toBeNull();
  });
});

describe("parseId", () => {
  it("reads a positive whole number", () => {
    // Act
    const id = parseId("42");

    // Assert
    expect(id).toBe(42);
  });

  it.each([[null], [""], ["0"], ["-1"], ["1.5"], ["1e3"], ["12abc"], ["9007199254740993"]])(
    "rejects %j",
    (value) => {
      // Act
      const id = parseId(value);

      // Assert
      expect(id).toBeNull();
    },
  );
});

describe("signInLinkNotice", () => {
  it.each([
    [null, "enviado"],
    [{ status: 422, code: "otp_disabled" }, "enviado"],
    [{ status: 429, code: "over_email_send_rate_limit" }, "limite"],
    [{ status: 500, code: "unexpected_failure" }, "falhou"],
    [{}, "falhou"],
  ])("answers %j with %s", (error, expected) => {
    // Act
    const notice = signInLinkNotice(error);

    // Assert
    expect(notice).toBe(expected);
  });
});

describe("noticeText", () => {
  const texts = { enviado: "Enviámos o link." };

  it("finds the notice's text", () => {
    // Act
    const text = noticeText("enviado", texts);

    // Assert
    expect(text).toBe("Enviámos o link.");
  });

  it.each([[undefined], ["outro"], ["toString"], [["enviado", "enviado"]]])("has no text for %j", (value) => {
    // Act
    const text = noticeText(value, texts);

    // Assert
    expect(text).toBeNull();
  });
});

describe("supabaseConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the project address and the publishable key", () => {
    // Arrange
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projeto.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_teste");

    // Act
    const config = supabaseConfig();

    // Assert
    expect(config).toEqual({ url: "https://projeto.supabase.co", key: "sb_publishable_teste" });
  });

  it("fails clearly when the deploy did not set them", () => {
    // Arrange
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://projeto.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");

    // Act
    const read = (): unknown => supabaseConfig();

    // Assert
    expect(read).toThrow("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  });
});
