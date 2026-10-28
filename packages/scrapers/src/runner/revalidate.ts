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
  const endpoint = `${config.siteUrl.replace(/\/+$/, "")}/api/revalidate`;
  const transport = config.transport ?? ((url, init) => fetch(url, init));
  let accepted = 0;
  for (let start = 0; start < slugs.length; start += REVALIDATE_CHUNK_SIZE) {
    const chunk = slugs.slice(start, start + REVALIDATE_CHUNK_SIZE);
    try {
      const response = await transport(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.secret}`,
          "Content-Type": "application/json",
          "User-Agent": BOT_USER_AGENT,
        },
        body: JSON.stringify({ slugs: chunk }),
        signal: AbortSignal.timeout(REVALIDATE_TIMEOUT_MS),
      });
      // Reading the small reply frees the connection.
      await response.arrayBuffer();
      if (response.ok) {
        accepted += chunk.length;
      } else {
        log.warn(`Revalidation of ${chunk.length} product pages failed: HTTP ${response.status}`);
      }
    } catch (error) {
      log.warn(`Revalidation of ${chunk.length} product pages failed: ${errorMessage(error)}`);
    }
  }
  log.info(`Revalidated ${accepted} of ${slugs.length} product pages`);
  return accepted;
}
