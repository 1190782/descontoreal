import type { CreateEmailOptions, CreateEmailResponse } from "resend";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { z } from "zod";
import { type Env, loadEnv } from "../src/env";
import { notifyAdmin } from "../src/notify";

const resend = vi.hoisted(() => ({
  apiKeys: [] as string[],
  send: vi.fn<(payload: CreateEmailOptions) => Promise<CreateEmailResponse>>(),
}));

vi.mock("resend", () => ({
  Resend: class {
    readonly emails = { send: resend.send };

    constructor(apiKey: string) {
      resend.apiKeys.push(apiKey);
    }
  },
}));
vi.mock("../src/env", () => ({ loadEnv: vi.fn() }));

const loadEnvMock = vi.mocked(loadEnv);

const SUBJECT = "DescontoReal: recolha falhada (Darty)";
const TEXT = "A recolha da loja Darty falhou.";
const ENV: Env = {
  RESEND_API_KEY: "re_test_123",
  ADMIN_EMAIL: "admin@example.com",
  EMAIL_FROM: "DescontoReal <alertas@descontoreal.pt>",
};

describe("notifyAdmin", () => {
  let warn: MockInstance<typeof console.warn>;
  let error: MockInstance<typeof console.error>;

  beforeEach(() => {
    resend.apiKeys.length = 0;
    resend.send.mockReset();
    resend.send.mockResolvedValue({ data: { id: "email-1" }, error: null, headers: null });
    loadEnvMock.mockReset();
    loadEnvMock.mockReturnValue(ENV);
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("emails ADMIN_EMAIL from EMAIL_FROM with the API key", async () => {
    // Act
    await notifyAdmin(SUBJECT, TEXT);

    // Assert
    expect(resend.apiKeys).toEqual(["re_test_123"]);
    expect(resend.send).toHaveBeenCalledExactlyOnceWith({
      from: "DescontoReal <alertas@descontoreal.pt>",
      to: "admin@example.com",
      subject: SUBJECT,
      text: TEXT,
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each(["RESEND_API_KEY", "ADMIN_EMAIL", "EMAIL_FROM"] as const)(
    "only logs a warning when %s is not set",
    async (name) => {
      // Arrange
      loadEnvMock.mockReturnValue({ ...ENV, [name]: undefined });

      // Act
      await notifyAdmin(SUBJECT, TEXT);

      // Assert
      expect(resend.apiKeys).toEqual([]);
      expect(resend.send).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledExactlyOnceWith(
        `Admin email not sent (RESEND_API_KEY, ADMIN_EMAIL or EMAIL_FROM is not set): ${SUBJECT}`,
      );
    },
  );

  it("logs the name and HTTP status of the error Resend returns and resolves", async () => {
    // Arrange
    resend.send.mockResolvedValue({
      data: null,
      error: { name: "invalid_api_key", message: "API key is invalid", statusCode: 401 },
      headers: null,
    });

    // Act
    const outcome = notifyAdmin(SUBJECT, TEXT);

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith(
      `Admin email not sent (invalid_api_key, HTTP 401): ${SUBJECT}`,
    );
  });

  it("never logs the message of a Resend error, which can quote an email address", async () => {
    // Arrange
    resend.send.mockResolvedValue({
      data: null,
      error: {
        name: "validation_error",
        message: "You can only send testing emails to your own email address (admin@example.com).",
        statusCode: 403,
      },
      headers: null,
    });

    // Act
    await notifyAdmin(SUBJECT, TEXT);

    // Assert
    expect(error).toHaveBeenCalledExactlyOnceWith(
      `Admin email not sent (validation_error, HTTP 403): ${SUBJECT}`,
    );
    expect(error.mock.calls.flat().join("\n")).not.toContain("admin@example.com");
  });

  it("logs only the name of a Resend error without an HTTP status", async () => {
    // Arrange
    resend.send.mockResolvedValue({
      data: null,
      error: {
        name: "application_error",
        message: "Unable to fetch data. The request could not be resolved.",
        statusCode: null,
      },
      headers: null,
    });

    // Act
    await notifyAdmin(SUBJECT, TEXT);

    // Assert
    expect(error).toHaveBeenCalledExactlyOnceWith(`Admin email not sent (application_error): ${SUBJECT}`);
  });

  it("logs only the name of an error thrown while sending and resolves", async () => {
    // Arrange
    resend.send.mockRejectedValue(new TypeError("Invalid `to` field: admin@example.com"));

    // Act
    const outcome = notifyAdmin(SUBJECT, TEXT);

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledExactlyOnceWith(`Admin email not sent (TypeError): ${SUBJECT}`);
  });

  it("logs invalid environment variables and resolves without emailing", async () => {
    // Arrange
    loadEnvMock.mockImplementation(() =>
      z.object({ ADMIN_EMAIL: z.email() }).parse({ ADMIN_EMAIL: "admin@" }),
    );

    // Act
    const outcome = notifyAdmin(SUBJECT, TEXT);

    // Assert
    await expect(outcome).resolves.toBeUndefined();
    expect(resend.send).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledExactlyOnceWith(`Admin email not sent (ZodError): ${SUBJECT}`);
  });
});
