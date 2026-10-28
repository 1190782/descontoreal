import { formatCents } from "@descontoreal/core";
import type { Db } from "@descontoreal/db";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CliUsageError,
  main,
  parseScrapeArgs,
  redactSecrets,
  resolveScraper,
  type ScrapeArgs,
  type ScrapeDeps,
  USAGE,
} from "../../src/cli/scrape";
import type { Env } from "../../src/env";
import type { Logger } from "../../src/http/logger";
import { FakeDb } from "../fakes/fake-db";
import {
  createFakeStore,
  FAKE_STORE_NAME,
  FAKE_STORE_URL,
  fakeCategory,
  listingBody,
  listingItem,
  VALID_EAN,
} from "../fakes/fake-store";
import {
  fakeTransport,
  jsonResponse,
  type Reply,
  textResponse,
  type TransportCall,
} from "../fakes/fake-transport";

// The CLI is tested on its own: the real stores, database client and notifier belong to other modules.
vi.mock("../../src/stores/registry", () => ({ SCRAPERS: {} }));
vi.mock("../../src/notify", () => ({ notifyAdmin: vi.fn(() => Promise.resolve()) }));
vi.mock("@descontoreal/db", () => ({ createDb: vi.fn() }));

const NOW = new Date("2026-10-28T03:00:00Z");
const TV = fakeCategory("tv");
const STORE = createFakeStore([TV]);
const ROBOTS = `${FAKE_STORE_URL}/robots.txt`;
const DATABASE_URL = "postgres://postgres.abc:segredo123@db.test:5432/postgres";
const silentLog: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined };

const DEFAULT_ARGS: ScrapeArgs = {
  store: undefined,
  categoryKey: undefined,
  dryRun: false,
  limit: undefined,
  maxProductPages: undefined,
  maxMinutes: undefined,
  help: false,
};

interface Setup {
  deps: ScrapeDeps;
  out: string[];
  err: string[];
  calls: TransportCall[];
  createDb: ReturnType<typeof vi.fn<(databaseUrl: string) => Db>>;
}

function setup(options: { env?: Env; routes?: Record<string, Reply | Reply[]>; db?: Db } = {}): Setup {
  const out: string[] = [];
  const err: string[] = [];
  const db = options.db ?? new FakeDb();
  const createDb = vi.fn<(databaseUrl: string) => Db>(() => db);
  const { transport, calls } = fakeTransport({
    [ROBOTS]: textResponse("User-agent: *\nDisallow:"),
    [TV.url]: jsonResponse(listingBody([listingItem("A", { ean: VALID_EAN })])),
    ...options.routes,
  });
  const deps: ScrapeDeps = {
    scrapers: { darty: STORE },
    loadEnv: () => options.env ?? {},
    createDb,
    fetcherOptions: { transport, minDelayMs: 0, maxDelayMs: 0 },
    now: () => NOW,
    log: silentLog,
    print: (text) => {
      out.push(text);
    },
    printError: (text) => {
      err.push(text);
    },
  };
  return { deps, out, err, calls, createDb };
}

describe("parseScrapeArgs", () => {
  it.each<[string[], Partial<ScrapeArgs>]>([
    [["--store", "darty"], { store: "darty" }],
    [
      ["--store=darty", "--category=tv", "--dry-run", "--limit=50", "--max-product-pages=0"],
      { store: "darty", categoryKey: "tv", dryRun: true, limit: 50, maxProductPages: 0 },
    ],
    [["--", "--store", "radiopopular", "--limit", "5"], { store: "radiopopular", limit: 5 }],
    [["--store", "darty", "--max-minutes", "300"], { store: "darty", maxMinutes: 300 }],
    [["--help"], { help: true }],
    [["-h"], { help: true }],
  ])("parses %j", (argv, expected) => {
    // Act
    const args = parseScrapeArgs(argv);

    // Assert
    expect(args).toEqual({ ...DEFAULT_ARGS, ...expected });
  });

  it.each([
    [["--limit", "0"], 'A opção --limit tem de ser um número inteiro a partir de 1 (recebido: "0").'],
    [["--limit", "1.5"], 'A opção --limit tem de ser um número inteiro a partir de 1 (recebido: "1.5").'],
    [["--limit", "-3"], 'A opção --limit tem de ser um número inteiro a partir de 1 (recebido: "-3").'],
    [["--limit=abc"], 'A opção --limit tem de ser um número inteiro a partir de 1 (recebido: "abc").'],
    [
      ["--max-product-pages", "-1"],
      'A opção --max-product-pages tem de ser um número inteiro a partir de 0 (recebido: "-1").',
    ],
    [
      ["--max-minutes=0"],
      'A opção --max-minutes tem de ser um número inteiro a partir de 1 (recebido: "0").',
    ],
    [["--store"], "A opção --store precisa de um valor."],
    [["--store", "--dry-run"], "A opção --store precisa de um valor."],
    [["--store="], "A opção --store precisa de um valor."],
    [["--dry-run=sim"], "A opção --dry-run não leva valor."],
    [["--verbose"], "Opção desconhecida: --verbose"],
    [["darty"], "Opção desconhecida: darty"],
  ])("rejects %j in pt-PT", (argv, message) => {
    // Act
    const act = (): ScrapeArgs => parseScrapeArgs(argv);

    // Assert
    expect(act).toThrow(CliUsageError);
    expect(act).toThrow(message);
  });
});

describe("resolveScraper", () => {
  it("returns the scraper of a known store", () => {
    // Act
    const scraper = resolveScraper("darty", { darty: STORE });

    // Assert
    expect(scraper).toBe(STORE);
  });

  it.each([
    [undefined, "Indica a loja com --store <loja>. Lojas disponíveis: darty."],
    ["xpto", 'Loja desconhecida: "xpto". Lojas disponíveis: darty.'],
    ["radiopopular", 'Loja desconhecida: "radiopopular". Lojas disponíveis: darty.'],
  ])("explains a missing or unknown store (%s)", (store, message) => {
    // Act
    const act = (): unknown => resolveScraper(store, { darty: STORE });

    // Assert
    expect(act).toThrow(new CliUsageError(message));
  });

  it.each([
    ["worten", "Worten"],
    ["fnac", "Fnac"],
  ])("refuses %s, which blocks our bot", (store, name) => {
    // Act
    const act = (): unknown => resolveScraper(store, { darty: STORE });

    // Assert
    expect(act).toThrow(
      new CliUsageError(
        `A loja ${name} bloqueia o nosso bot, por isso não recolhemos dela (ver docs/stores/${store}.md). ` +
          "Lojas disponíveis: darty.",
      ),
    );
  });
});

describe("main", () => {
  it("prints the usage for --help", async () => {
    // Arrange
    const { deps, out } = setup();

    // Act
    const code = await main(["--help"], deps);

    // Assert
    expect(code).toBe(0);
    expect(out).toEqual([USAGE]);
  });

  it("explains an unknown store without requesting anything", async () => {
    // Arrange
    const { deps, err, calls, createDb } = setup();

    // Act
    const code = await main(["--store", "xpto"], deps);

    // Assert
    expect(code).toBe(1);
    expect(err[0]).toMatch(/^Loja desconhecida: "xpto"\. Lojas disponíveis: darty\./);
    expect(calls).toEqual([]);
    expect(createDb).not.toHaveBeenCalled();
  });

  it("requires DATABASE_URL outside a dry run", async () => {
    // Arrange
    const { deps, err, calls, createDb } = setup({ env: {} });

    // Act
    const code = await main(["--store", "darty"], deps);

    // Assert
    expect(code).toBe(1);
    expect(err).toEqual([
      "Falta a variável DATABASE_URL (ver .env.example). Para testar sem base de dados usa --dry-run.",
    ]);
    expect(calls).toEqual([]);
    expect(createDb).not.toHaveBeenCalled();
  });

  it("names invalid environment variables without printing their values", async () => {
    // Arrange
    const parsed = z.object({ SITE_URL: z.url() }).safeParse({ SITE_URL: "nao-e-um-url" });
    if (parsed.success) {
      throw new Error("Expected an invalid SITE_URL");
    }
    const { deps, err } = setup();
    deps.loadEnv = () => {
      throw parsed.error;
    };

    // Act
    const code = await main(["--store", "darty", "--dry-run"], deps);

    // Assert
    expect(code).toBe(1);
    expect(err).toEqual(["Variáveis de ambiente inválidas: SITE_URL. Corrige o .env (ver .env.example)."]);
  });

  it("runs a dry run without opening the database and prints the first items", async () => {
    // Arrange
    const items = [
      listingItem("A", { ean: VALID_EAN }),
      listingItem("B", { ean: VALID_EAN, priceCents: 129_900, referencePriceCents: 149_900 }),
    ];
    const { deps, out, calls, createDb } = setup({
      env: { DATABASE_URL },
      routes: { [TV.url]: jsonResponse(listingBody(items)) },
    });

    // Act
    const code = await main(["--store", "darty", "--dry-run"], deps);

    // Assert
    expect(code).toBe(0);
    expect(createDb).not.toHaveBeenCalled();
    expect(calls.map((call) => call.url)).toEqual([ROBOTS, TV.url]);
    const printed = out.join("\n");
    expect(printed).toContain(`${FAKE_STORE_NAME}: recolha concluída (simulação, nada foi gravado)`);
    expect(printed).toContain("Primeiros artigos:");
    expect(printed).toContain(formatCents(129_900));
    expect(printed).toContain(formatCents(149_900));
    expect(printed).toContain(`2. ${FAKE_STORE_URL}/p/B`);
  });

  it("runs against the database from DATABASE_URL and closes it", async () => {
    // Arrange
    const db = new FakeDb();
    const { deps, createDb } = setup({ env: { DATABASE_URL }, db });

    // Act
    const code = await main(["--store=darty"], deps);

    // Assert
    expect(code).toBe(0);
    expect(createDb).toHaveBeenCalledWith(DATABASE_URL);
    expect(db.calls[0]).toBe("startRun");
    expect(db.calls.at(-1)).toBe("close");
    expect(db.closed).toBe(true);
  });

  it("stops requesting at --max-minutes and says so in the summary", async () => {
    // Arrange
    const page2 = `${TV.url}?page=2`;
    const { deps, out } = setup({
      routes: {
        [TV.url]: jsonResponse(listingBody([listingItem("A", { ean: VALID_EAN })], page2)),
        [page2]: jsonResponse(listingBody([listingItem("B", { ean: VALID_EAN })], `${TV.url}?page=3`)),
      },
    });
    const transport = deps.fetcherOptions.transport;
    let clockMs = NOW.getTime();
    deps.now = () => new Date(clockMs);
    deps.fetcherOptions = {
      ...deps.fetcherOptions,
      transport: (url, init) => {
        clockMs += 60_000;
        return transport === undefined ? Promise.reject(new Error("No transport")) : transport(url, init);
      },
    };

    // Act
    const code = await main(["--store", "darty", "--dry-run", "--max-minutes", "3"], deps);

    // Assert
    expect(code).toBe(0);
    expect(out[0]?.split("\n")[0]).toBe(
      `${FAKE_STORE_NAME}: recolha concluída (simulação, nada foi gravado, execução parcial, interrompida ao fim de 3 min)`,
    );
    expect(out[0]).toContain("Artigos vistos: 1,");
  });

  it("exits with 1 when the store blocks us", async () => {
    // Arrange
    const { deps, out } = setup({ routes: { [ROBOTS]: textResponse("Access Denied", 403) } });

    // Act
    const code = await main(["--store", "darty", "--dry-run"], deps);

    // Assert
    expect(code).toBe(1);
    expect(out[0]).toMatch(/^Loja Teste: recolha bloqueada pela loja/);
  });

  it("reports a store whose robots.txt disallows our bot as blocked, never as a broken scraper", async () => {
    // Arrange
    const { deps, out, calls } = setup({ routes: { [ROBOTS]: textResponse("User-agent: *\nDisallow: /") } });

    // Act
    const code = await main(["--store", "darty", "--dry-run"], deps);

    // Assert
    expect(code).toBe(1);
    expect(out[0]?.split("\n")[0]).toBe(
      `${FAKE_STORE_NAME}: recolha bloqueada pela loja (simulação, nada foi gravado, execução parcial)`,
    );
    expect(out[0]).toContain(`${ROBOTS}: darty blocks our bot: robots.txt disallows the whole site`);
    expect(calls.map((call) => call.url)).toEqual([ROBOTS]);
  });

  it("lists the store's categories for an unknown --category", async () => {
    // Arrange
    const { deps, err, calls } = setup();

    // Act
    const code = await main(["--store", "darty", "--dry-run", "--category", "tablets"], deps);

    // Assert
    expect(code).toBe(1);
    expect(err).toEqual([
      `Categoria desconhecida na loja ${FAKE_STORE_NAME}: "tablets". Categorias disponíveis: tv.`,
    ]);
    expect(calls).toEqual([]);
  });

  it("never prints the database password when the run fails", async () => {
    // Arrange
    const { deps, err } = setup({ env: { DATABASE_URL } });
    deps.createDb = () => {
      throw new Error(`could not connect to ${DATABASE_URL} (password segredo123 rejected)`);
    };

    // Act
    const code = await main(["--store", "darty"], deps);

    // Assert
    expect(code).toBe(1);
    expect(err).toEqual([
      `A recolha da loja ${FAKE_STORE_NAME} falhou: could not connect to *** (password *** rejected)`,
    ]);
  });
});

describe("redactSecrets", () => {
  it("hides secret values and the database password, encoded or not", () => {
    // Arrange
    const env: Env = {
      DATABASE_URL: "postgres://postgres.abc:p%40ss%2Fword@pooler.test:5432/postgres",
      REVALIDATE_SECRET: "segredo-da-revalidacao",
      RESEND_API_KEY: "re_123456789",
    };
    const text = `url=${env.DATABASE_URL} raw=p%40ss%2Fword plain=p@ss/word rev=segredo-da-revalidacao key=re_123456789`;

    // Act
    const redacted = redactSecrets(text, env);

    // Assert
    expect(redacted).toBe("url=*** raw=*** plain=*** rev=*** key=***");
  });

  it("leaves text alone when no secret is set", () => {
    // Act
    const redacted = redactSecrets("HTTP 503 (3 attempts)", {});

    // Assert
    expect(redacted).toBe("HTTP 503 (3 attempts)");
  });
});
