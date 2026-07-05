function createCustomer(overrides) {
  return {
    firstName: "Jan",
    lastName: "Kowalski",
    fullName: "Jan Kowalski",
    email: "jan.kowalski@example.com",
    phone: "+48500500500",
    ...overrides
  };
}

module.exports = {
  createCustomer
};
