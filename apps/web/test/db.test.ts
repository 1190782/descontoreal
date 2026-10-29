import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connectionString: "",
  clients: [] as { url: string; options: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () =>
    Promise.resolve({ env: { HYPERDRIVE: { connectionString: state.connectionString } } }),
}));
vi.mock("postgres", () => ({
  default: (url: string, options: Record<string, unknown>) => {
    state.clients.push({ url, options });
    return { url };
  },
}));
vi.mock("@descontoreal/db/web", () => ({ preparedQuery: (sql: unknown) => sql }));

const SESSION_POOLER =
  "postgresql://web_ro.projeto:segredo@aws-0-eu-west-3.pooler.supabase.com:5432/postgres";
const HYPERDRIVE = "postgresql://web_ro:segredo@0123456789abcdef.hyperdrive.local:5432/postgres";
const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54329/postgres";

/** getQuery for `pages` renders, from a fresh lib/db (as a new build process or Worker would load it). */
async function queriesFor(connectionString: string, pages: number): Promise<unknown[]> {
  state.connectionString = connectionString;
  vi.resetModules();
  const { getQuery } = await import("@/lib/db");
  return await Promise.all(Array.from({ length: pages }, () => getQuery()));
}

beforeEach(() => {
  state.clients.length = 0;
});

describe("getQuery", () => {
  it("shares one connection to Supabase's Session pooler across the pages next build renders", async () => {
    // Act
    const queries = await queriesFor(SESSION_POOLER, 5);

    // Assert
    expect(state.clients).toHaveLength(1);
    expect(state.clients[0]?.options).toMatchObject({ max: 1, ssl: "require" });
    expect(new Set(queries).size).toBe(1);
  });

  it("gives every request its own Hyperdrive client, since Workers forbid sharing one", async () => {
    // Act
    await queriesFor(HYPERDRIVE, 3);

    // Assert
    expect(state.clients.map((client) => client.options.max)).toEqual([5, 5, 5]);
    expect(state.clients[0]?.options.ssl).toBeUndefined();
  });

  it("keeps one short-lived connection to the local database", async () => {
    // Act
    await queriesFor(LOCAL, 1);

    // Assert
    expect(state.clients[0]?.options).toMatchObject({ max: 1, idle_timeout: 2 });
  });
});
