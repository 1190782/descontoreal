import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { errorMessage, loadRootEnvFile, REPO_ROOT, requireDatabaseUrl } from "../../src/cli/env";

describe("requireDatabaseUrl", () => {
  it("returns DATABASE_URL without surrounding spaces", () => {
    // Arrange
    const env = { DATABASE_URL: "  postgresql://u:p@localhost:54329/postgres \n" };

    // Act
    const databaseUrl = requireDatabaseUrl(env);

    // Assert
    expect(databaseUrl).toBe("postgresql://u:p@localhost:54329/postgres");
  });

  it.each([{}, { DATABASE_URL: "" }, { DATABASE_URL: "   " }])("rejects a missing value (%o)", (env) => {
    // Arrange
    const environment = env;

    // Act
    const act = (): string => requireDatabaseUrl(environment);

    // Assert
    expect(act).toThrow("DATABASE_URL is not set");
  });
});

describe("errorMessage", () => {
  it.each([
    [new Error("connect ECONNREFUSED 127.0.0.1:54329"), "connect ECONNREFUSED 127.0.0.1:54329"],
    ["plain text", "plain text"],
  ])("returns only the message of %o", (error, expected) => {
    // Arrange
    const thrown: unknown = error;

    // Act
    const message = errorMessage(thrown);

    // Assert
    expect(message).toBe(expected);
  });
});

describe("REPO_ROOT and loadRootEnvFile", () => {
  it("point at the repository root", () => {
    // Arrange
    const workspaceFile = join(REPO_ROOT, "pnpm-workspace.yaml");

    // Act
    const act = (): void => loadRootEnvFile();

    // Assert
    expect(existsSync(workspaceFile)).toBe(true);
    expect(act).not.toThrow();
  });
});
