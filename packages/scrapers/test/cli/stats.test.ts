import type { Db } from "@descontoreal/db";
import { describe, expect, it, type Mock, vi } from "vitest";
import { z } from "zod";
import { main, type StatsDeps } from "../../src/cli/stats";
import type { Env } from "../../src/env";
import { formatStatsSummary, type StatsSummary } from "../../src/jobs/stats";
import { FakeStatsDb } from "../jobs/fake-stats-db";

const NOW = new Date("2026-10-29T03:40:00Z");
const DATABASE_URL = "postgres://postgres.abc:segredo123@db.test:5432/postgres";
const SUMMARY: StatsSummary = {
  labels: { historico_insuficiente: 3, preco_habitual: 1 },
  classified: 4,
  withoutCurrentPrice: 1,
};

interface Setup {
  deps: StatsDeps;
  db: FakeStatsDb;
  out: string[];
  err: string[];
  warnings: string[];
  createDb: Mock<(databaseUrl: string) => Db>;
  runStats: Mock<(db: Db, now: Date) => Promise<StatsSummary>>;
}

function setup(env: Env = { DATABASE_URL }): Setup {
  const db = new FakeStatsDb();
  const out: string[] = [];
  const err: string[] = [];
  const warnings: string[] = [];
  const createDb = vi.fn<(databaseUrl: string) => Db>(() => db);
  const runStats = vi.fn<(db: Db, now: Date) => Promise<StatsSummary>>(() => Promise.resolve(SUMMARY));
  const deps: StatsDeps = {
    loadEnv: () => env,
    createDb,
    runStats,
    now: () => NOW,
    log: {
      info: () => undefined,
      warn: (message) => {
        warnings.push(message);
      },
      error: () => undefined,
    },
    print: (text) => {
      out.push(text);
    },
    printError: (text) => {
      err.push(text);
    },
  };
  return { deps, db, out, err, warnings, createDb, runStats };
}

function invalidEnvError(): z.ZodError {
  const result = z.object({ ADMIN_EMAIL: z.email() }).safeParse({ ADMIN_EMAIL: "valor-secreto" });
  if (result.success) {
    throw new Error("Expected an invalid email");
  }
  return result.error;
}

describe("main", () => {
  it("runs the stats job, prints the counts per label and closes the database", async () => {
    // Arrange
    const { deps, db, out, err, createDb, runStats } = setup();

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(0);
    expect(createDb).toHaveBeenCalledExactlyOnceWith(DATABASE_URL);
    expect(runStats).toHaveBeenCalledExactlyOnceWith(db, NOW);
    expect(out).toEqual([formatStatsSummary(SUMMARY)]);
    expect(err).toEqual([]);
    expect(db.closed).toBe(true);
  });

  it("exits with 1 without DATABASE_URL and never connects", async () => {
    // Arrange
    const { deps, err, createDb } = setup({});

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(1);
    expect(err).toEqual(["Falta a variável DATABASE_URL (ver .env.example)."]);
    expect(createDb).not.toHaveBeenCalled();
  });

  it("names invalid environment variables without printing their values", async () => {
    // Arrange
    const { deps, err, createDb } = setup();
    deps.loadEnv = () => {
      throw invalidEnvError();
    };

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(1);
    expect(err).toEqual(["Variáveis de ambiente inválidas: ADMIN_EMAIL. Corrige o .env (ver .env.example)."]);
    expect(err.join("\n")).not.toContain("valor-secreto");
    expect(createDb).not.toHaveBeenCalled();
  });

  it("explains an unreadable .env file", async () => {
    // Arrange
    const { deps, err } = setup();
    deps.loadEnv = () => {
      throw new Error("EACCES: permission denied");
    };

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(1);
    expect(err).toEqual([
      "Variáveis de ambiente inválidas: o ficheiro .env não pôde ser lido. Corrige o .env (ver .env.example).",
    ]);
  });

  it("exits with 1 and still closes the database when the job fails", async () => {
    // Arrange
    const { deps, db, out, err, runStats } = setup();
    runStats.mockRejectedValue(new Error("connection terminated unexpectedly"));

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(1);
    expect(err).toEqual(["O cálculo dos rótulos falhou: connection terminated unexpectedly"]);
    expect(out).toEqual([]);
    expect(db.closed).toBe(true);
  });

  it("exits with 1 when the database client cannot be created", async () => {
    // Arrange
    const { deps, err, createDb, runStats } = setup();
    createDb.mockImplementation(() => {
      throw new Error("Invalid URL");
    });

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(1);
    expect(err).toEqual(["O cálculo dos rótulos falhou: Invalid URL"]);
    expect(runStats).not.toHaveBeenCalled();
  });

  it("keeps the success when only closing the database fails", async () => {
    // Arrange
    const { deps, db, warnings } = setup();
    db.closeError = new Error("timeout");

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(0);
    expect(warnings).toEqual(["Database connection not closed cleanly: timeout"]);
  });

  it("never prints the database URL or password when the job fails", async () => {
    // Arrange
    const { deps, err, runStats } = setup();
    runStats.mockRejectedValue(
      new Error(`could not connect to ${DATABASE_URL} (password segredo123 rejected)`),
    );

    // Act
    const exitCode = await main(deps);

    // Assert
    expect(exitCode).toBe(1);
    expect(err).toEqual(["O cálculo dos rótulos falhou: could not connect to *** (password *** rejected)"]);
  });

  it("never logs the database password when closing the database fails", async () => {
    // Arrange
    const { deps, db, warnings } = setup();
    db.closeError = new Error("password segredo123 rejected");

    // Act
    await main(deps);

    // Assert
    expect(warnings).toEqual(["Database connection not closed cleanly: password *** rejected"]);
  });
});
