const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns the UTC-midnight scalar for a Date that represents a stored calendar day. */
export function calendarDayOf(value: Date) {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

/** Returns the UTC-midnight scalar for the local calendar day containing an instant. */
export function localInstantDayOf(value: Date) {
  return Date.UTC(value.getFullYear(), value.getMonth(), value.getDate());
}

/** Converts the local calendar day containing an instant into the stored UTC-midnight representation. */
export function localDayAsCalendarDate(value: Date) {
  return new Date(localInstantDayOf(value));
}

/** Parses an HTML date value as a UTC-midnight calendar day, independent of the process timezone. */
export function parseCalendarDate(value: string) {
  const match = value.match(DATE_INPUT_PATTERN);
  if (!match) {
    return new Date(Number.NaN);
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day
    ? date
    : new Date(Number.NaN);
}
