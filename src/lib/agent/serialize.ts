/*
 * Capability results cross an SSE boundary, so they carry strings rather than
 * Date objects. Both helpers exist to keep that conversion honest in one place:
 * calendar dates and instants are different kinds of value in this product and
 * must not be serialized the same way.
 */

/**
 * Check-in/check-out are calendar days stored at UTC midnight. Reading them with
 * UTC components is required — local getters show the previous day west of
 * Greenwich.
 */
export function calendarDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

/** A real point in time: deadlines, observation timestamps, run starts. */
export function instant(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}
