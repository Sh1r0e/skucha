const { createMockContext } = require("../../helpers/functionTestUtils");
const handler = require("../../../get-reservation");

const MOCK_RESERVATION = {
  id: "res-1",
  status: "Confirmed",
  customerName: "Jan Kowalski",
  customerEmail: "jan@example.com",
  customerPhone: "+48500500500",
  fromDate: "2026-08-10",
  toDate: "2026-08-12",
  pads: 2,
  notes: "",
  createdAt: "2026-07-31T10:00:00.000Z",
  paymentSessionId: "cs_test_123",
  paymentStatus: "Paid",
  paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
  paymentAmountMinor: 12000,
  paymentCurrency: "PLN",
  paymentIntentId: "pi_test_123",
  pickupPoint: "Stablowice"
};

const PENDING_RESERVATION = {
  ...MOCK_RESERVATION,
  status: "Pending",
  paymentStatus: "Unpaid",
  paymentIntentId: "",
  etag: "etag-1"
};

function paidCheckoutSession(overrides) {
  return {
    id: "cs_test_123",
    mode: "payment",
    payment_status: "paid",
    payment_intent: "pi_test_123",
    amount_total: 12000,
    currency: "pln",
    client_reference_id: "res-1",
    metadata: { reservationId: "res-1" },
    ...(overrides || {})
  };
}

describe("get-reservation function", function () {
  beforeEach(function () {
    vi.clearAllMocks();
    handler.__resetDependencies();
  });

  it("should_return_200_with_reservation_for_valid_id()", async function () {
    handler.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue(MOCK_RESERVATION)
      }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(context.res.status).toBe(200);
    expect(context.res.body.id).toBe("res-1");
    expect(context.res.body.status).toBe("Confirmed");
    expect(context.res.body.pickupPoint).toBe("Stablowice");
    expect(context.res.body.payment.status).toBe("Paid");
    expect(context.res.body.payment.amount).toBe(120);
    expect(context.res.body.payment.currency).toBe("PLN");
    expect(context.res.body.payment.sessionId).toBeUndefined();
    expect(context.res.body.payment.paymentIntentId).toBeUndefined();
    expect(context.res.body.customerName).toBeUndefined();
    expect(context.res.body.customerEmail).toBeUndefined();
  });

  it("should_return_429_before_reservation_storage_lookup", async function () {
    const getReservation = vi.fn();
    handler.__setDependencies({
      ReservationRepository: { getReservation },
      BotProtectionService: {
        checkRequest: vi.fn().mockResolvedValue({ allowed: false, resetAt: "2099-01-01T00:00:00.000Z" })
      }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(context.res.status).toBe(429);
    expect(getReservation).not.toHaveBeenCalled();
  });

  it("should_return_404_when_reservation_does_not_exist()", async function () {
    handler.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue(null) }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "missing", session_id: "cs_test_123" } });

    expect(context.res.status).toBe(404);
    expect(context.res.body.code).toBe("NotFound");
  });

  it("should_return_400_when_id_is_missing()", async function () {
    handler.__setDependencies({
      ReservationRepository: { getReservation: vi.fn() }
    });
    const context = createMockContext();

    await handler(context, { query: {} });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("MissingId");
  });

  it("should_reject_identifiers_with_unsafe_characters_before_storage_lookup()", async function () {
    const getReservation = vi.fn();
    handler.__setDependencies({ ReservationRepository: { getReservation: getReservation } });
    const context = createMockContext();

    await handler(context, { query: { id: "res%27injected", session_id: "cs_test_123" } });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("MissingId");
    expect(getReservation).not.toHaveBeenCalled();
  });

  it("should_return_400_when_id_is_whitespace()", async function () {
    handler.__setDependencies({
      ReservationRepository: { getReservation: vi.fn() }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "   " } });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("MissingId");
  });

  it("should_return_503_when_storage_throws()", async function () {
    handler.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockRejectedValue(
          Object.assign(new Error("Storage unavailable"), { statusCode: 503, code: "StorageError" })
        )
      }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(context.res.status).toBe(503);
    expect(context.res.body.code).toBe("StorageError");
  });

  it("should_return_404_when_session_id_does_not_match()", async function () {
    handler.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue(MOCK_RESERVATION) }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "wrong-session" } });

    expect(context.res.status).toBe(404);
    expect(context.res.body.code).toBe("NotFound");
  });

  it("should_require_a_matching_stripe_session_id()", async function () {
    const context = createMockContext();

    await handler(context, { query: { id: "res-1" } });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("MissingSessionId");
  });

  it("should_use_context_req_when_second_argument_is_missing()", async function () {
    handler.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue(MOCK_RESERVATION) }
    });
    const context = createMockContext({ req: { query: { id: "res-1", session_id: "cs_test_123" } } });

    await handler(context);

    expect(context.res.status).toBe(200);
    expect(context.res.body.id).toBe("res-1");
  });

  it("should_parse_ids_from_the_request_url()", async function () {
    handler.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue(MOCK_RESERVATION) }
    });
    const context = createMockContext();

    await handler(context, {
      url: "https://www.skucha.co/api/reservation?id=res-1&session_id=cs_test_123"
    });

    expect(context.res.status).toBe(200);
  });

  it("should_reconcile_a_paid_checkout_return_and_send_confirmation_once()", async function () {
    const repository = {
      getReservation: vi.fn().mockResolvedValue(PENDING_RESERVATION),
      attachPayment: vi.fn().mockResolvedValue({
        ...PENDING_RESERVATION,
        paymentStatus: "Paid",
        paymentIntentId: "pi_test_123",
        etag: "etag-2"
      }),
      updateStatus: vi.fn().mockResolvedValue({
        ...PENDING_RESERVATION,
        status: "Confirmed",
        paymentStatus: "Paid",
        etag: "etag-3"
      })
    };
    const sendPaymentConfirmationNotification = vi.fn().mockResolvedValue({ queued: true });
    handler.__setDependencies({
      ReservationRepository: repository,
      StripeService: {
        getCheckoutSession: vi.fn().mockResolvedValue(paidCheckoutSession())
      },
      MailService: { sendPaymentConfirmationNotification }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(repository.attachPayment).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({
        sessionId: "cs_test_123",
        paymentStatus: "Paid",
        paymentIntentId: "pi_test_123",
        amountInMinorUnit: 12000,
        currency: "pln"
      }),
      { expectedStatus: "Pending", expectedEtag: "etag-1" }
    );
    expect(repository.updateStatus).toHaveBeenCalledWith(
      "res-1",
      "Confirmed",
      { expectedStatus: "Pending", expectedEtag: "etag-2" }
    );
    expect(sendPaymentConfirmationNotification).toHaveBeenCalledTimes(1);
    expect(context.res.body.status).toBe("Confirmed");
    expect(context.res.body.payment.status).toBe("Paid");
  });

  it("should_leave_an_unpaid_checkout_pending_without_side_effects()", async function () {
    const repository = {
      getReservation: vi.fn().mockResolvedValue(PENDING_RESERVATION),
      attachPayment: vi.fn(),
      updateStatus: vi.fn()
    };
    const sendPaymentConfirmationNotification = vi.fn();
    handler.__setDependencies({
      ReservationRepository: repository,
      StripeService: {
        getCheckoutSession: vi.fn().mockResolvedValue(
          paidCheckoutSession({ payment_status: "unpaid" })
        )
      },
      MailService: { sendPaymentConfirmationNotification }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(repository.attachPayment).not.toHaveBeenCalled();
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(sendPaymentConfirmationNotification).not.toHaveBeenCalled();
    expect(context.res.body.status).toBe("Pending");
    expect(context.res.body.payment.status).toBe("Unpaid");
  });

  it("should_not_reconcile_a_paid_checkout_with_a_mismatched_contract()", async function () {
    const repository = {
      getReservation: vi.fn().mockResolvedValue(PENDING_RESERVATION),
      attachPayment: vi.fn(),
      updateStatus: vi.fn()
    };
    handler.__setDependencies({
      ReservationRepository: repository,
      StripeService: {
        getCheckoutSession: vi.fn().mockResolvedValue(
          paidCheckoutSession({ amount_total: 9999 })
        )
      },
      MailService: { sendPaymentConfirmationNotification: vi.fn() }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(repository.attachPayment).not.toHaveBeenCalled();
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(context.res.body.status).toBe("Pending");
  });

  it("should_reload_the_reservation_when_the_webhook_wins_the_update_race()", async function () {
    const conflict = Object.assign(new Error("Reservation changed"), {
      statusCode: 409,
      code: "StorageConflict"
    });
    const repository = {
      getReservation: vi.fn()
        .mockResolvedValueOnce(PENDING_RESERVATION)
        .mockResolvedValueOnce(MOCK_RESERVATION),
      attachPayment: vi.fn().mockRejectedValue(conflict),
      updateStatus: vi.fn()
    };
    const sendPaymentConfirmationNotification = vi.fn();
    handler.__setDependencies({
      ReservationRepository: repository,
      StripeService: {
        getCheckoutSession: vi.fn().mockResolvedValue(paidCheckoutSession())
      },
      MailService: { sendPaymentConfirmationNotification }
    });
    const context = createMockContext();

    await handler(context, { query: { id: "res-1", session_id: "cs_test_123" } });

    expect(repository.getReservation).toHaveBeenCalledTimes(2);
    expect(repository.updateStatus).not.toHaveBeenCalled();
    expect(sendPaymentConfirmationNotification).not.toHaveBeenCalled();
    expect(context.res.body.status).toBe("Confirmed");
    expect(context.res.body.payment.status).toBe("Paid");
  });
});
