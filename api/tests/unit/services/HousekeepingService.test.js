const HousekeepingService = require("../../../services/HousekeepingService");

describe("HousekeepingService", function () {
  beforeEach(function () {
    HousekeepingService.__resetDependencies();
  });

  it("should_expire_stale_unpaid_pending_reservations()", async function () {
    const attachPayment = vi.fn().mockResolvedValue({ id: "res-1", etag: "etag-2" });
    const updateStatus = vi.fn().mockResolvedValue({ id: "res-1", status: "Expired" });
    const expireCheckoutSession = vi.fn().mockResolvedValue({ paymentStatus: "Expired" });

    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          {
            id: "res-1",
            etag: "etag-1",
            status: "Pending",
            paymentStatus: "unpaid",
            paymentSessionId: "cs_test_1",
            createdAt: "2026-08-09T08:00:00.000Z"
          }
        ]),
        attachPayment,
        updateStatus
      },
      StripeService: { expireCheckoutSession },
      MailService: { sendPaymentExpiredNotification: vi.fn().mockResolvedValue({ queued: true }) },
      ConfigurationService: { getReservationPendingExpiryHours: vi.fn().mockReturnValue(2) },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations({ limit: 10 });

    expect(expireCheckoutSession).toHaveBeenCalledWith("cs_test_1");
    expect(attachPayment).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ paymentStatus: "Expired" }),
      expect.objectContaining({ expectedStatus: "Pending", expectedEtag: "etag-1" })
    );
    expect(updateStatus).toHaveBeenCalledWith(
      "res-1",
      "Expired",
      expect.objectContaining({ expectedStatus: "Pending", expectedEtag: "etag-2" })
    );
    expect(result.expired).toBe(1);
  });

  it("should_leave_a_paid_during_cleanup_reservation_untouched()", async function () {
    const attachPayment = vi.fn();
    const updateStatus = vi.fn();

    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          {
            id: "res-1",
            status: "Pending",
            paymentStatus: "unpaid",
            paymentSessionId: "cs_test_1",
            createdAt: "2026-08-09T08:00:00.000Z"
          }
        ]),
        attachPayment,
        updateStatus
      },
      StripeService: {
        expireCheckoutSession: vi.fn().mockResolvedValue({ paymentStatus: "Paid" })
      },
      MailService: { sendPaymentExpiredNotification: vi.fn() },
      ConfigurationService: { getReservationPendingExpiryHours: vi.fn().mockReturnValue(2) },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations();

    expect(result.expired).toBe(0);
    expect(result.skipped).toBe(1);
    expect(attachPayment).not.toHaveBeenCalled();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("should_support_a_repeatable_dry_run()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          {
            id: "res-1",
            status: "Pending",
            paymentStatus: "unpaid",
            createdAt: "2026-08-09T08:00:00.000Z"
          }
        ])
      },
      ConfigurationService: { getReservationPendingExpiryHours: vi.fn().mockReturnValue(2) },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations({ dryRun: true });

    expect(result).toMatchObject({ dryRun: true, eligible: 1, expired: 1 });
  });

  it("should_handle_missing_checkout_sessions_and_notification_failures()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          { id: "res-no-session", status: "Pending", paymentStatus: "unpaid", createdAt: "2026-08-09T08:00:00.000Z" },
          { id: "res-mail", status: "Pending", paymentStatus: "unpaid", createdAt: "2026-08-09T08:00:00.000Z" }
        ]),
        attachPayment: vi.fn()
          .mockResolvedValueOnce({ id: "res-no-session", etag: "etag-1" })
          .mockResolvedValueOnce({ id: "res-mail", etag: "etag-2" }),
        updateStatus: vi.fn()
          .mockResolvedValueOnce({ id: "res-no-session", status: "Expired" })
          .mockResolvedValueOnce({ id: "res-mail", status: "Expired" })
      },
      StripeService: {},
      MailService: { sendPaymentExpiredNotification: vi.fn().mockRejectedValue(new Error("mail failed")) },
      ConfigurationService: { getReservationPendingExpiryHours: vi.fn().mockReturnValue(2) },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations();

    expect(result.expired).toBe(2);
    expect(result.errors.filter(function (entry) { return entry.code === "NotificationFailed"; })).toHaveLength(2);
  });

  it("should_keep_a_row_when_stripe_expiration_fails()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          { id: "res-1", status: "Pending", paymentStatus: "unpaid", paymentSessionId: "cs-1", createdAt: "2026-08-09T08:00:00.000Z" }
        ]),
        attachPayment: vi.fn(),
        updateStatus: vi.fn()
      },
      StripeService: { expireCheckoutSession: vi.fn().mockRejectedValue(Object.assign(new Error("stripe down"), { code: "PaymentProviderError" })) },
      MailService: { sendPaymentExpiredNotification: vi.fn() },
      ConfigurationService: { getReservationPendingExpiryHours: vi.fn().mockReturnValue(2) },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations();

    expect(result.expired).toBe(0);
    expect(result.errors[0].code).toBe("PaymentProviderError");
  });

  it("should_skip_non_pending_and_invalid_expiry_rows()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          { id: "confirmed", status: "Confirmed", createdAt: "invalid" },
          { id: "pending-invalid", status: "Pending", paymentStatus: "unpaid", pendingExpiresAt: "invalid" },
          { id: "paid", status: "Pending", paymentStatus: "Paid", createdAt: "2026-08-09T08:00:00.000Z" }
        ])
      },
      ConfigurationService: { getReservationPendingExpiryHours: vi.fn().mockReturnValue(2) },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations();

    expect(result.eligible).toBe(0);
    expect(result.expired).toBe(0);
  });

  it("should_use_explicit_expiry_for_legacy_rows_without_creation_time()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          { id: "legacy", status: "Pending", paymentStatus: "unpaid" },
          { id: "explicit", status: "Pending", paymentStatus: "pending", pendingExpiresAt: "2026-08-09T09:00:00.000Z" }
        ]),
        attachPayment: vi.fn().mockResolvedValue({ id: "explicit", etag: "etag-explicit" }),
        updateStatus: vi.fn().mockResolvedValue({ id: "explicit", status: "Expired" })
      },
      StripeService: {},
      MailService: { sendPaymentExpiredNotification: vi.fn().mockResolvedValue({ queued: true }) },
      ConfigurationService: {},
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await HousekeepingService.expirePendingReservations();

    expect(result.eligible).toBe(1);
    expect(result.expired).toBe(1);
  });
});
