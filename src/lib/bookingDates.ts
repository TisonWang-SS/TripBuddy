export function startOfToday(now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return today;
}

export function isActiveBookingDate(checkIn: Date, now = new Date()) {
  return checkIn >= startOfToday(now);
}
