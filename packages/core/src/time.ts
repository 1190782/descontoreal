export const DAY_MS = 86_400_000;
export const TIME_ZONE = "Europe/Lisbon";

const DAY_PARTS_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const LONG_DATE_FORMAT = new Intl.DateTimeFormat("pt-PT", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Calendar date in Lisbon as "YYYY-MM-DD". */
export function lisbonDate(date: Date): string {
  const parts = Object.fromEntries(
    DAY_PARTS_FORMAT.formatToParts(date).map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Date for users in pt-PT, e.g. "28 de outubro de 2026" (Lisbon time zone). */
export function formatDatePt(date: Date): string {
  return LONG_DATE_FORMAT.format(date);
}

/** Whole days from `from` to `to` (floor), using real elapsed time. */
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Calendar days from `from` to `to` in Lisbon, whatever the hour: 23:59 to 00:01 the next day is 1, and
 * the 23- and 25-hour days when the clocks change count as one day each.
 */
export function calendarDaysBetween(from: Date, to: Date): number {
  return lisbonDayNumber(to) - lisbonDayNumber(from);
}

/** Days since 1970-01-01 of the Lisbon calendar date; UTC midnights are whole multiples of DAY_MS. */
function lisbonDayNumber(date: Date): number {
  return Date.parse(`${lisbonDate(date)}T00:00:00Z`) / DAY_MS;
}
