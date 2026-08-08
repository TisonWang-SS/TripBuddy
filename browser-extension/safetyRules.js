(function installTripBuddySafetyRules(root) {
  const unsafeBookingControlPattern =
    /(payment|pay now|confirm|purchase|place order|complete reservation|submit payment|complete booking|finalize)/i;

  function isUnsafeBookingControl(value) {
    return unsafeBookingControlPattern.test(String(value || ""));
  }

  const rules = Object.freeze({
    isUnsafeBookingControl,
    unsafeBookingControlPatternSource: unsafeBookingControlPattern.source
  });

  if (typeof module === "object" && module.exports) {
    module.exports = rules;
  }
  root.TripBuddySafetyRules = rules;
})(globalThis);
