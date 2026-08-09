const { createMockContext } = require("../../helpers/functionTestUtils");
const handler = require("../../../stripe-webhook");

function buildMockDependencies(overrides) {
  return {
    StripeService: {
      verifyWebhookSignature: vi.fn()
    },
    ReservationRepository: {
      attachPayment: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({}),
      getReservation: vi.fn().mockResolvedValue({
        id: "res-1",
        status: "Pending",
        customerName: "Jan Kowalski",
        customerEmail: "jan@example.com",
        customerPhone: "+48500500500",
        fromDate: "2026-08-10",
        toDate: "2026-08-12",
        pads: 2,
        notes: "Bring extra straps",
        deliveryMethod: "pickup",
        pickupPoint: "Stablowice",
        paymentSessionId: "cs_test_123",
        paymentStatus: "Unpaid",
        paymentAmountMinor: 12000,
        paymentCurrency: "PLN",
        paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_123",
        cancellationUrl: "https://www.skucha.co/reservation-cancel.html?reservation_id=res-1&token=abc",
        cancellationExpiresAt: "2026-08-20T12:00:00.000Z"
      })
    },
    StripeEventRepository: {
      claimEvent: vi.fn().mockResolvedValue({ claimed: true, duplicate: false }),
      markEvent: vi.fn().mockResolvedValue(undefined)
    },
    MailService: {
      sendPaymentPendingNotification: vi.fn().mockResolvedValue({ queued: true }),
      sendPaymentConfirmationNotification: vi.fn().mockResolvedValue({ queued: true }),
      sendPaymentExpiredNotification: vi.fn().mockResolvedValue({ queued: true })
    },
    ...overrides
  };
}

function buildCompletedSession(overrides) {
  return {
    id: "cs_test_123",
    payment_status: "paid",
    client_reference_id: "res-1",
    metadata: { reservationId: "res-1" },
    url: "https://checkout.stripe.com/c/pay/cs_test_123",
    ...overrides
  };
}

describe("stripe-webhook function", function () {
  beforeEach(function () {
    vi.clearAllMocks();
    handler.__resetDependencies();
  });

  it("should_return_400_when_stripe_signature_header_is_missing()", async function () {
    const context = createMockContext();
    const deps = buildMockDependencies();
    handler.__setDependencies(deps);

    await handler(context, { headers: {}, rawBody: "{}" });

    expect(context.res.status).toBe(400);
    expect(context.res.body.error).toMatch(/Missing stripe-signature/i);
  });

  it("should_return_400_when_raw_body_is_missing()", async function () {
    const context = createMockContext();
    const deps = buildMockDependencies();
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      body: { parsed: true }
    });

    expect(context.res.status).toBe(400);
    expect(context.res.body.error).toMatch(/Raw body unavailable/i);
  });

  it("should_return_400_when_signature_verification_fails()", async function () {
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockImplementation(function () {
          const error = new Error("Webhook signature verification failed");
          error.statusCode = 400;
          error.code = "WebhookSignatureInvalid";
          throw error;
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "bad-sig" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("WebhookSignatureInvalid");
  });

  it("should_return_200_and_confirm_reservation_on_checkout_session_completed()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_1",
          data: { object: session }
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(200);
    expect(deps.ReservationRepository.attachPayment).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ sessionId: "cs_test_123", paymentStatus: "Paid" })
    );
    expect(deps.ReservationRepository.updateStatus).toHaveBeenCalledWith("res-1", "Confirmed");
    expect(deps.MailService.sendPaymentConfirmationNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "res-1",
        fullName: "Jan Kowalski",
        dateFrom: "2026-08-10",
        padsCount: 2,
        deliveryMethod: "pickup",
        pickupPoint: "Stablowice",
        notes: "Bring extra straps",
        amount: 120,
        currency: "PLN",
        cancelUrl: expect.stringContaining("/reservation-cancel.html"),
        payment: expect.objectContaining({ status: "Paid", sessionId: "cs_test_123" })
      })
    );
  });

  it("should_accept_stripe_signature_header_with_original_casing()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_1a",
          data: { object: session }
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "Stripe-Signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(200);
    expect(deps.StripeService.verifyWebhookSignature).toHaveBeenCalledWith("{}", "t=1,v1=abc");
  });

  it("should_mark_reservation_Unpaid_when_payment_status_is_unpaid()", async function () {
    const session = buildCompletedSession({ payment_status: "unpaid" });
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_2",
          data: { object: session }
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(200);
    expect(deps.ReservationRepository.attachPayment).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ paymentStatus: "Unpaid" })
    );
    expect(deps.ReservationRepository.updateStatus).not.toHaveBeenCalled();
    expect(deps.MailService.sendPaymentPendingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: "Unpaid" })
    );
  });

  it("should_mark_payment_Expired_on_checkout_session_expired()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.expired",
          id: "evt_3",
          data: { object: session }
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(200);
    expect(deps.ReservationRepository.attachPayment).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ paymentStatus: "Expired" })
    );
    expect(deps.ReservationRepository.updateStatus).toHaveBeenCalledWith("res-1", "Expired");
    expect(deps.MailService.sendPaymentExpiredNotification).toHaveBeenCalledWith(
      expect.objectContaining({ paymentStatus: "Expired" })
    );
  });

  it("should_return_200_for_unhandled_event_types_without_updating_storage()", async function () {
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "customer.created",
          id: "evt_4",
          data: { object: {} }
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(200);
    expect(deps.ReservationRepository.attachPayment).not.toHaveBeenCalled();
    expect(deps.ReservationRepository.updateStatus).not.toHaveBeenCalled();
  });

  it("should_ignore_a_duplicate_event_before_touching_reservation_storage()", async function () {
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt-duplicate",
          data: { object: buildCompletedSession() }
        })
      },
      StripeEventRepository: {
        claimEvent: vi.fn().mockResolvedValue({ claimed: false, duplicate: true, status: "Processed" }),
        markEvent: vi.fn()
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.duplicate).toBe(true);
    expect(deps.ReservationRepository.attachPayment).not.toHaveBeenCalled();
  });

  it("should_return_500_when_repository_throws_during_event_handling()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_5",
          data: { object: session }
        })
      },
      ReservationRepository: {
        attachPayment: vi.fn().mockRejectedValue(
          Object.assign(new Error("Storage write failed"), { statusCode: 503, code: "StorageWriteFailed" })
        ),
        updateStatus: vi.fn()
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(500);
  });

  it("should_return_500_when_reservation_is_missing_during_event_handling()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_5b",
          data: { object: session }
        })
      },
      ReservationRepository: {
        attachPayment: vi.fn().mockResolvedValue(null),
        updateStatus: vi.fn().mockResolvedValue(null),
        getReservation: vi.fn().mockResolvedValue(null)
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(500);
    expect(context.res.body.code).toBe("ReservationNotFound");
  });

  it("should_return_500_when_notification_details_are_missing()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_5c",
          data: { object: session }
        })
      },
      ReservationRepository: {
        attachPayment: vi.fn().mockResolvedValue({}),
        updateStatus: vi.fn().mockResolvedValue({}),
        getReservation: vi.fn().mockResolvedValue(null)
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(500);
    expect(context.res.body.code).toBe("ReservationNotFound");
  });

  it("should_return_500_when_confirmation_email_fails()", async function () {
    const session = buildCompletedSession();
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_5d",
          data: { object: session }
        })
      },
      MailService: {
        sendPaymentPendingNotification: vi.fn(),
        sendPaymentConfirmationNotification: vi.fn().mockRejectedValue(new Error("ACS unavailable")),
        sendPaymentExpiredNotification: vi.fn()
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(context.res.status).toBe(500);
    expect(context.res.body.code).toBe("InternalError");
  });

  it("should_use_client_reference_id_to_identify_reservation()", async function () {
    const session = buildCompletedSession({ client_reference_id: "res-from-ref", metadata: {} });
    const context = createMockContext();
    const deps = buildMockDependencies({
      StripeService: {
        verifyWebhookSignature: vi.fn().mockReturnValue({
          type: "checkout.session.completed",
          id: "evt_6",
          data: { object: session }
        })
      }
    });
    handler.__setDependencies(deps);

    await handler(context, {
      headers: { "stripe-signature": "t=1,v1=abc" },
      rawBody: "{}"
    });

    expect(deps.ReservationRepository.attachPayment).toHaveBeenCalledWith(
      "res-from-ref",
      expect.any(Object)
    );
  });
});
