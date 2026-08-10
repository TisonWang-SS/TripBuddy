export const WEAKER_CANCELLATION_WARNING = "The candidate has a weaker cancellation policy.";

export function isEvidenceCaution(warning: string) {
  return warning === WEAKER_CANCELLATION_WARNING;
}
