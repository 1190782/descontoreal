import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ROOT_ENV_FILE = fileURLToPath(new URL("../../../../.env", import.meta.url));

/** Loads the repository's .env when it exists. Variables already set (GitHub secrets) win. */
export function loadRootEnvFile(): void {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
}

export function requireDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is not set: fill it in .env, or start a local database with pnpm db:local.",
    );
  }
  return databaseUrl;
}

/** Message only: some errors (an invalid URL) carry the URL, and with it the password, in other fields. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
