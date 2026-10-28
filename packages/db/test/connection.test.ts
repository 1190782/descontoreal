import { describe, expect, it } from "vitest";
import { createSql, parseDatabaseUrl, tlsOptions } from "../src/connection";

const SUPABASE_URL = "postgresql://postgres.abcd:s3cret@aws-0-eu-west-1.pooler.supabase.com:5432/postgres";

describe("parseDatabaseUrl", () => {
  it.each(["postgresql://u:p@localhost:5432/db", "postgres://u:p@db.example.pt/db"])("accepts %s", (url) => {
    // Arrange
    const databaseUrl = url;

    // Act
    const parsed = parseDatabaseUrl(databaseUrl);

    // Assert
    expect(parsed.href).toBe(databaseUrl);
  });

  it("rejects text that is not a URL without repeating it", () => {
    // Arrange
    const databaseUrl = "postgresql://user:s3cret@[bad";

    // Act
    const act = (): URL => parseDatabaseUrl(databaseUrl);

    // Assert
    expect(act).toThrow(/^DATABASE_URL is not a valid URL\.$/);
  });

  it("rejects URLs of other protocols", () => {
    // Arrange
    const databaseUrl = "https://abcd.supabase.co";

    // Act
    const act = (): URL => parseDatabaseUrl(databaseUrl);

    // Assert
    expect(act).toThrow("DATABASE_URL must start with postgresql://.");
  });
});

describe("tlsOptions", () => {
  it.each([
    ["postgresql://u:p@localhost:54329/postgres", { ssl: false }],
    ["postgresql://u:p@127.0.0.1:54329/postgres", { ssl: false }],
    ["postgresql://u:p@[::1]:54329/postgres", { ssl: false }],
    [SUPABASE_URL, { ssl: "require" }],
    [`${SUPABASE_URL}?sslmode=verify-full`, {}],
  ])("for %s is %o", (url, expected) => {
    // Arrange
    const parsed = new URL(url);

    // Act
    const options = tlsOptions(parsed);

    // Assert
    expect(options).toEqual(expected);
  });
});

describe("createSql", () => {
  it("uses one connection, no prepared statements and TLS for a remote host", async () => {
    // Arrange
    const databaseUrl = SUPABASE_URL;

    // Act
    const sql = createSql(databaseUrl);

    // Assert
    expect(sql.options).toMatchObject({ max: 1, prepare: false, ssl: "require", idle_timeout: 20 });
    await sql.end();
  });

  it("parses int8 values as numbers", async () => {
    // Arrange
    const sql = createSql("postgresql://u:p@localhost:54329/postgres");

    // Act
    const parse = sql.options.parsers[20];

    // Assert
    expect(parse?.("9007199254740991")).toBe(9_007_199_254_740_991);
    await sql.end();
  });
});
