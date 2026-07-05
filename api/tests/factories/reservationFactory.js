const { createCustomer } = require("./customerFactory");

function createReservation(overrides) {
  const customer = createCustomer();

  return {
    ...customer,
    dateFrom: "2026-08-10",
    dateTo: "2026-08-12",
    padsCount: 2,
    deliveryMethod: "pickup",
    pickupPoint: "Stablowice",
    notes: "Bring extra straps",
    acceptTerms: true,
    ...overrides
  };
}

module.exports = {
  createReservation
};
