import { BOT_USER_AGENT } from "@descontoreal/core";
import robotsParser from "robots-parser";

export interface RobotsRules {
  isAllowed(url: string): boolean;
  /** Crawl-delay for our bot (or for "*"), in milliseconds; null when robots.txt sets none. */
  crawlDelayMs: number | null;
}

/** Rules when the store has no robots.txt (404, 410 and other 4xx except 401/403). */
export const ALLOW_ALL: RobotsRules = {
  isAllowed: () => true,
  crawlDelayMs: null,
};

/**
 * Parses robots.txt for DescontoRealBot (its own group, else "*"). URLs are checked by path and query
 * against the robots.txt origin, so "www." and bare hosts of the same store share the rules.
 */
export function parseRobots(robotsUrl: string, body: string): RobotsRules {
  const robots = robotsParser(robotsUrl, body);
  const origin = new URL(robotsUrl).origin;
  const crawlDelay = robots.getCrawlDelay(BOT_USER_AGENT);
  return {
    isAllowed: (url) => {
      const target = new URL(url);
      return (
        robots.isAllowed(new URL(`${target.pathname}${target.search}`, origin).href, BOT_USER_AGENT) !== false
      );
    },
    crawlDelayMs: crawlDelay !== undefined && crawlDelay > 0 ? Math.round(crawlDelay * 1000) : null,
  };
}
