import { BOT_USER_AGENT } from "@descontoreal/core";
import { errorMessage } from "../http/errors";
import type { Transport } from "../http/fetcher";
import type { Logger } from "../http/logger";

export interface RevalidationConfig {
  /** SITE_URL. */
  siteUrl: string;
  /** REVALIDATE_SECRET; never logged. */
  secret: string;
  /** Defaults to global fetch. */
  transport?: Transport;
}

export const REVALIDATE_CHUNK_SIZE = 200;
const REVALIDATE_TIMEOUT_MS = 30_000;

/**
 * Asks the site to revalidate product pages: POST {SITE_URL}/api/revalidate with { slugs }, in chunks of 200.
 * Failures are logged, never thrown: a stale page must not fail a collection run. Returns the slugs accepted.
 */
export async function revalidateProducts(
  slugs: readonly string[],
  config: RevalidationConfig,
  log: Logger,
): Promise<number> {
  let accepted = 0;
  for (let start = 0; start < slugs.length; start += REVALIDATE_CHUNK_SIZE) {
    const chunk = slugs.slice(start, start + REVALIDATE_CHUNK_SIZE);
    const failure = await postRevalidation({ slugs: chunk }, config);
    if (failure === null) {
      accepted += chunk.length;
    } else {
      log.warn(`Revalidation of ${chunk.length} product pages failed: ${failure}`);
    }
  }
  log.info(`Revalidated ${accepted} of ${slugs.length} product pages`);
  return accepted;
}

/**
 * Asks the site to render every page again: POST {SITE_URL}/api/revalidate with { all: true }. For after `pnpm stats`,
 * which changes the labels and warnings of products whose price did not change. Failures are logged, never thrown: a
 * stale page must not fail the labels job. Returns whether the site accepted.
 */
export async function revalidateEverything(config: RevalidationConfig, log: Logger): Promise<boolean> {
  const failure = await postRevalidation({ all: true }, config);
  if (failure === null) {
    log.info("Revalidated every page of the site");
    return true;
  }
  log.warn(`Revalidation of every page failed: ${failure}`);
  return false;
}

/** Null when the site answered 2xx; otherwise why not, without the secret. */
async function postRevalidation(body: object, config: RevalidationConfig): Promise<string | null> {
  const endpoint = `${config.siteUrl.replace(/\/+$/, "")}/api/revalidate`;
  const transport = config.transport ?? ((url, init) => fetch(url, init));
  try {
    const response = await transport(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.secret}`,
        "Content-Type": "application/json",
        "User-Agent": BOT_USER_AGENT,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
    });
    // Reading the small reply frees the connection.
    await response.arrayBuffer();
    return response.ok ? null : `HTTP ${response.status}`;
  } catch (error) {
    return errorMessage(error);
  }
}
