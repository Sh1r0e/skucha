function createAvailabilityParams(overrides) {
  return {
    from: "2026-08-10",
    to: "2026-08-12",
    ...overrides
  };
}

function createAvailabilityReservation(overrides) {
  return {
    id: "resv-1",
    status: "Pending",
    fromDate: "2026-08-10",
    toDate: "2026-08-12",
    pads: 2,
    ...overrides
  };
}

module.exports = {
  createAvailabilityParams,
  createAvailabilityReservation
};
