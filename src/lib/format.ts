export function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value);
}

export function formatCalendarDate(value: Date | string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  }).format(new Date(value));
}

export function formatLocalInstant(value: Date | string | null | undefined) {
  if (!value) {
    return "Not set";
  }

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export function formatCalendarDateInput(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }

  return new Date(value).toISOString().slice(0, 10);
}

export function formatLocalInstantInput(value: Date | string | null | undefined) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return `${date.getFullYear()}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}T${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

export function formatRetryDelay(hours: number) {
  if (hours <= 0) {
    return "now";
  }
  if (hours < 1) {
    const minutes = Math.max(1, Math.round(hours * 60));
    return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const roundedHours = Math.round(hours);
  return `in ${roundedHours} hour${roundedHours === 1 ? "" : "s"}`;
}

export function nightsBetween(checkIn: Date, checkOut: Date) {
  const dayMs = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / dayMs));
}

function twoDigits(value: number) {
  return String(value).padStart(2, "0");
}
