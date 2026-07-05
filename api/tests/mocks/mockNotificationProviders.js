function createMockNotificationProviders(overrides) {
  return {
    emailService: {
      sendReservationNotification: vi.fn().mockResolvedValue({ queued: true })
    },
    whatsappService: {
      sendMessage: vi.fn().mockResolvedValue({ queued: true })
    },
    paymentProvider: {
      authorizePayment: vi.fn().mockResolvedValue({ authorized: true })
    },
    ...overrides
  };
}

module.exports = {
  createMockNotificationProviders
};
