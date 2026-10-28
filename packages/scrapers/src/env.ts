import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  ADMIN_EMAIL: z.email().optional(),
  EMAIL_FROM: z.string().min(1).optional(),
  SITE_URL: z.url().optional(),
  REVALIDATE_SECRET: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Loads the repository's .env when it exists (GitHub Actions uses secrets instead) and validates it. */
export function loadEnv(): Env {
  if (existsSync(ROOT_ENV_FILE)) {
    process.loadEnvFile(ROOT_ENV_FILE);
  }
  // Empty values (an unfilled .env line, a missing GitHub secret) count as not set.
  const values = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== ""));
  return envSchema.parse(values);
}
