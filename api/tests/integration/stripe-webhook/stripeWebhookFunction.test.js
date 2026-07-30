const { createMockContext } = require("../../helpers/functionTestUtils");
const handler = require("../../../stripe-webhook");

function buildMockDependencies(overrides) {
  return {
    StripeService: {
      verifyWebhookSignature: vi.fn()
    },
    ReservationRepository: {
      attachPayment: vi.fn().mockResolvedValue({}),
      updateStatus: vi.fn().mockResolvedValue({})
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
    expect(deps.ReservationRepository.updateStatus).toHaveBeenCalledWith("res-1", "Pending");
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
    expect(deps.ReservationRepository.updateStatus).not.toHaveBeenCalled();
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
