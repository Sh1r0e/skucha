function createMockReservationRepository(overrides) {
  return {
    saveReservation: vi.fn(),
    getReservation: vi.fn(),
    getReservations: vi.fn(),
    updateStatus: vi.fn(),
    ...overrides
  };
}

module.exports = {
  createMockReservationRepository
};
