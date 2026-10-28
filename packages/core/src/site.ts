/** Nome e domínio do site: a única fonte destes valores no código. */
export const SITE = {
  name: "DescontoReal",
  domain: "descontoreal.pt",
  url: "https://descontoreal.pt",
  tagline: "Histórico de preços das lojas portuguesas",
} as const;

export const BOT_USER_AGENT = `DescontoRealBot/1.0 (+${SITE.url}/bot)`;
