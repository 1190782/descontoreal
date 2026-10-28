/** Network errors, 5xx and 429 are worth another attempt. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/** Milliseconds to wait from a Retry-After header (delta seconds or HTTP date), or null when absent or invalid. */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? null : Math.max(0, date - now.getTime());
}

/** Exponential backoff with equal jitter: attempt 1 waits base/2 to base, attempt 2 base to 2 × base, and so on. */
export function backoffDelayMs(attempt: number, baseMs: number, random: () => number): number {
  const exponential = baseMs * 2 ** (attempt - 1);
  return Math.round(exponential / 2 + (random() * exponential) / 2);
}
