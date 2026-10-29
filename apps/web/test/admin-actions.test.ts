import { revalidatePath } from "next/cache";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approveMatch, rejectMatch, signOut, splitListing } from "@/app/admin/correspondencias/actions";
import { confirmSignIn } from "@/app/auth/confirm/actions";
import { sendSignInLink } from "@/app/entrar/actions";

const client = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), signOut: vi.fn() },
}));

vi.mock("@/lib/supabase", () => ({
  createSessionClient: () => Promise.resolve(client),
  createMailClient: () => client,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Redirect(url);
  }),
}));

/** Like Next's redirect(), it ends the action by throwing. */
class Redirect extends Error {
  constructor(readonly url: string) {
    super(`redirect to ${url}`);
  }
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    data.set(name, value);
  }
  return data;
}

async function redirectOf(action: Promise<void>): Promise<string> {
  const error: unknown = await action.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof Redirect)) {
    throw new Error(`expected a redirect, got ${String(error)}`);
  }
  return error.url;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("review actions", () => {
  it("approves the candidate and renders its product page again", async () => {
    // Arrange
    client.rpc.mockResolvedValue({ data: { slugs: ["samsung-ww90t534dae"] }, error: null });

    // Act
    const url = await redirectOf(approveMatch(form({ id: "12" })));

    // Assert
    expect(client.rpc).toHaveBeenCalledWith("admin_approve_match", { p_candidate_id: 12 });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/p/samsung-ww90t534dae"]]);
    expect(url).toBe("/admin/correspondencias?aviso=aprovada");
  });

  it("rejects the candidate", async () => {
    // Arrange
    client.rpc.mockResolvedValue({ data: { slugs: [] }, error: null });

    // Act
    const url = await redirectOf(rejectMatch(form({ id: "12" })));

    // Assert
    expect(client.rpc).toHaveBeenCalledWith("admin_reject_match", { p_candidate_id: 12 });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(url).toBe("/admin/correspondencias?aviso=rejeitada");
  });

  it("splits the listing and renders both product pages again", async () => {
    // Arrange
    client.rpc.mockResolvedValue({ data: { slugs: ["lg-f4wr709", "lg-f4wr709-2"] }, error: null });

    // Act
    const url = await redirectOf(splitListing(form({ id: "7" })));

    // Assert
    expect(client.rpc).toHaveBeenCalledWith("admin_split_listing", { p_listing_id: 7 });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([["/p/lg-f4wr709"], ["/p/lg-f4wr709-2"]]);
    expect(url).toBe("/admin/correspondencias?aviso=separado");
  });

  it("reports a decision the database refused, and renders nothing again", async () => {
    // Arrange
    client.rpc.mockResolvedValue({
      data: null,
      error: { message: "approve_match_candidate: candidate 12 is approved", code: "P0001" },
    });

    // Act
    const url = await redirectOf(approveMatch(form({ id: "12" })));

    // Assert
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(url).toBe("/admin/correspondencias?aviso=falhou");
  });

  it("calls nothing for a form without a valid id", async () => {
    // Act
    const url = await redirectOf(approveMatch(form({ id: "12; drop table products" })));

    // Assert
    expect(client.rpc).not.toHaveBeenCalled();
    expect(url).toBe("/admin/correspondencias?aviso=falhou");
  });

  it("signs out of this session only", async () => {
    // Arrange
    client.auth.signOut.mockResolvedValue({ error: null });

    // Act
    const url = await redirectOf(signOut());

    // Assert
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(url).toBe("/entrar?aviso=saiu");
  });
});

describe("sendSignInLink", () => {
  it("sends a link to an existing account and never creates one", async () => {
    // Arrange
    client.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });

    // Act
    const url = await redirectOf(sendSignInLink(form({ email: "admin@descontoreal.pt" })));

    // Assert
    expect(client.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "admin@descontoreal.pt",
      options: { shouldCreateUser: false },
    });
    expect(url).toBe("/entrar?aviso=enviado");
  });

  it("answers an address without an account as if the link went", async () => {
    // Arrange
    client.auth.signInWithOtp.mockResolvedValue({ data: {}, error: { status: 422, code: "otp_disabled" } });

    // Act
    const url = await redirectOf(sendSignInLink(form({ email: "outra@exemplo.pt" })));

    // Assert
    expect(url).toBe("/entrar?aviso=enviado");
  });

  it("logs a failure without the address", async () => {
    // Arrange
    client.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: {
        status: 500,
        code: "unexpected_failure",
        message: "Error sending email to admin@descontoreal.pt",
      },
    });

    // Act
    const url = await redirectOf(sendSignInLink(form({ email: "admin@descontoreal.pt" })));

    // Assert
    expect(url).toBe("/entrar?aviso=falhou");
    expect(console.error).toHaveBeenCalledWith("signInWithOtp failed: unexpected_failure, HTTP 500");
  });

  it("asks for a valid address before calling Supabase", async () => {
    // Act
    const url = await redirectOf(sendSignInLink(form({ email: "admin" })));

    // Assert
    expect(client.auth.signInWithOtp).not.toHaveBeenCalled();
    expect(url).toBe("/entrar?aviso=email-invalido");
  });
});

describe("confirmSignIn", () => {
  it("signs in with the link's token and opens the admin page", async () => {
    // Arrange
    client.auth.verifyOtp.mockResolvedValue({ data: {}, error: null });

    // Act
    const url = await redirectOf(confirmSignIn(form({ token_hash: "a1b2c3" })));

    // Assert
    expect(client.auth.verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "a1b2c3" });
    expect(url).toBe("/admin/correspondencias");
  });

  it("sends an expired or used link back to /entrar", async () => {
    // Arrange
    client.auth.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403, code: "otp_expired" } });

    // Act
    const url = await redirectOf(confirmSignIn(form({ token_hash: "a1b2c3" })));

    // Assert
    expect(url).toBe("/entrar?aviso=link");
  });

  it("sends a link without a token back to /entrar", async () => {
    // Act
    const url = await redirectOf(confirmSignIn(form({})));

    // Assert
    expect(client.auth.verifyOtp).not.toHaveBeenCalled();
    expect(url).toBe("/entrar?aviso=link");
  });
});
