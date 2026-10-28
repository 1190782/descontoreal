// Challenge pages are small; markers sit in the first few kilobytes.
const SCAN_CHARS = 32_768;

// Normal Cloudflare pages also load /cdn-cgi/challenge-platform/scripts/…, so that path is not a marker.
const CLOUDFLARE_MARKERS = [
  /<title>\s*just a moment/i,
  /_cf_chl_opt/,
  /enable javascript and cookies to continue/i,
];
const AKAMAI_MARKERS = [/_sec\/cp_challenge/, /sec-if-cpt-container/];
const DATADOME_MARKERS = [/captcha-delivery\.com/];

/**
 * Names the bot protection when a response is a challenge or block page (Cloudflare, Akamai, DataDome),
 * or returns null. `bodyHead` is the start of the body; markers are ASCII, so any single-byte decoding works.
 */
export function detectBotChallenge(status: number, headers: Headers, bodyHead: string): string | null {
  const head = bodyHead.slice(0, SCAN_CHARS);
  if (headers.get("cf-mitigated")?.toLowerCase() === "challenge" || matchesAny(head, CLOUDFLARE_MARKERS)) {
    return "Cloudflare";
  }
  if (matchesAny(head, DATADOME_MARKERS) || (status === 403 && headers.has("x-datadome"))) {
    return "DataDome";
  }
  if (
    matchesAny(head, AKAMAI_MARKERS) ||
    (status === 403 && /akamaighost/i.test(headers.get("server") ?? ""))
  ) {
    return "Akamai";
  }
  return null;
}

function matchesAny(text: string, markers: readonly RegExp[]): boolean {
  return markers.some((marker) => marker.test(text));
}
