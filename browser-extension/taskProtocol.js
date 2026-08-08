(function installTripBuddyTaskProtocol(root) {
  const protocol = Object.freeze({
    endpointKey: "tripbuddyEndpoint",
    requestedCurrencyKey: "tripbuddyRequestedCurrency",
    taskIdKey: "tripbuddyTaskId"
  });

  if (typeof module === "object" && module.exports) {
    module.exports = protocol;
  }
  root.TripBuddyTaskProtocol = protocol;
})(globalThis);
