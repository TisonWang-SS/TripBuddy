import { calendarDayOf, localDayAsCalendarDate, localInstantDayOf } from "@/lib/dateSemantics";

export function isActiveBookingDate(checkIn: Date, now = new Date()) {
  return calendarDayOf(checkIn) >= localInstantDayOf(now);
}

export function currentLocalDayAsCalendarDate(now = new Date()) {
  return localDayAsCalendarDate(now);
}
