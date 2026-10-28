/** Nome e domínio do site: a única fonte destes valores no código. */
export const SITE = {
  name: "DescontoReal",
  domain: "descontoreal.pt",
  url: "https://descontoreal.pt",
  tagline: "Histórico de preços das lojas portuguesas",
  contactEmail: "contacto@descontoreal.pt",
} as const;

export const BOT_USER_AGENT = `DescontoRealBot/1.0 (+${SITE.url}/bot)`;

/** How the bot collects: the scrapers run with these values and the /bot page states them. */
export const BOT_POLICY = {
  /** Random pause between two requests to the same store. */
  minDelayMs: 2000,
  maxDelayMs: 5000,
  /** A store that asks us to wait longer than this (Retry-After) stops the collection for the day. */
  maxRetryAfterMs: 120_000,
  /** Hour (UTC) the daily collection starts, as in the cron of .github/workflows/scrape.yml. */
  dailyRunHourUtc: 3,
} as const;
