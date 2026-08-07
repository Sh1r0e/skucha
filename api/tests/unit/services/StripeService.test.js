const StripeService = require("../../../services/StripeService");

describe("StripeService", function () {
  beforeEach(function () {
    StripeService.__resetDependencies();
    vi.clearAllMocks();
  });

  it("should_create_checkout_session_for_valid_input()", async function () {
    const createSession = vi.fn().mockResolvedValue({
      id: "cs_test_123",
      url: "https://checkout.stripe.com/c/pay/cs_test_123",
      payment_status: "unpaid"
    });

    StripeService.__setDependencies({
      stripeClient: {
        checkout: {
          sessions: {
            create: createSession
          }
        }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel")
      }
    });

    const result = await StripeService.createCheckoutSession({
      reservationId: "res-1",
      customerEmail: "jan@example.com",
      dateFrom: "2026-08-10",
      dateTo: "2026-08-12",
      padsCount: 2,
      amountInMinorUnit: 12000,
      currency: "pln",
      productName: "Skucha - crash pad reservation",
      description: "3 day(s), 2 pad(s)"
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(result.sessionId).toBe("cs_test_123");
    expect(result.paymentStatus).toBe("unpaid");
  });

  it("should_append_reservation_id_to_success_and_cancel_urls()", async function () {
    const createSession = vi.fn().mockResolvedValue({
      id: "cs_test_456",
      url: "https://checkout.stripe.com/pay/cs_test_456",
      payment_status: "unpaid"
    });

    StripeService.__setDependencies({
      stripeClient: { checkout: { sessions: { create: createSession } } },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success?session_id={CHECKOUT_SESSION_ID}"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel?session_id={CHECKOUT_SESSION_ID}"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("whsec_abc")
      }
    });

    await StripeService.createCheckoutSession({
      reservationId: "res-42",
      customerEmail: "a@b.com",
      amountInMinorUnit: 4000,
      currency: "pln"
    });

    const callArgs = createSession.mock.calls[0][0];
    expect(callArgs.success_url).toContain("reservation_id=res-42");
    expect(callArgs.cancel_url).toContain("reservation_id=res-42");
  });

  it("should_throw_when_checkout_urls_are_not_configured()", async function () {
    StripeService.__setDependencies({
      stripeClient: {
        checkout: {
          sessions: {
            create: vi.fn()
          }
        }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue(""),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("")
      }
    });

    await expect(
      StripeService.createCheckoutSession({
        reservationId: "res-1",
        amountInMinorUnit: 100,
        currency: "pln"
      })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "PaymentUrlsNotConfigured"
    });
  });

  it("should_throw_for_non_positive_amount()", async function () {
    await expect(
      StripeService.createCheckoutSession({
        reservationId: "res-1",
        amountInMinorUnit: 0,
        currency: "pln"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "InvalidPaymentAmount"
    });
  });

  it("should_verify_valid_webhook_signature()", function () {
    const fakeEvent = { type: "checkout.session.completed", id: "evt_1", data: { object: {} } };

    StripeService.__setDependencies({
      stripeClient: {
        checkout: { sessions: { create: vi.fn() } },
        webhooks: {
          constructEvent: vi.fn().mockReturnValue(fakeEvent)
        }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("whsec_test_abc")
      }
    });

    const result = StripeService.verifyWebhookSignature("raw-body", "t=123,v1=abc");

    expect(result).toEqual(fakeEvent);
  });

  it("should_throw_400_when_webhook_signature_is_invalid()", function () {
    StripeService.__setDependencies({
      stripeClient: {
        checkout: { sessions: { create: vi.fn() } },
        webhooks: {
          constructEvent: vi.fn().mockImplementation(function () {
            throw new Error("No signatures found matching the expected signature for payload");
          })
        }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("whsec_test_abc")
      }
    });

    expect(() => StripeService.verifyWebhookSignature("bad-body", "bad-sig")).toThrow(
      expect.objectContaining({ statusCode: 400, code: "WebhookSignatureInvalid" })
    );
  });

  it("should_throw_503_when_webhook_secret_is_not_configured()", function () {
    StripeService.__setDependencies({
      stripeClient: {
        checkout: { sessions: { create: vi.fn() } },
        webhooks: { constructEvent: vi.fn() }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("")
      }
    });

    expect(() => StripeService.verifyWebhookSignature("body", "sig")).toThrow(
      expect.objectContaining({ statusCode: 503, code: "WebhookSecretNotConfigured" })
    );
  });

  it("should_throw_503_when_stripe_secret_key_is_not_configured()", async function () {
    const MockStripe = vi.fn();

    StripeService.__setDependencies({
      Stripe: MockStripe,
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue(""),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("")
      }
    });

    await expect(
      StripeService.createCheckoutSession({
        reservationId: "res-1",
        amountInMinorUnit: 1000,
        currency: "pln",
        successUrl: "https://example.com/success",
        cancelUrl: "https://example.com/cancel"
      })
    ).rejects.toMatchObject({ statusCode: 503, code: "PaymentNotConfigured" });

    expect(MockStripe).not.toHaveBeenCalled();
  });

  it("should_instantiate_stripe_client_from_key_when_no_stripeClient_is_injected()", async function () {
    const mockSession = {
      id: "cs_test_direct",
      url: "https://checkout.stripe.com/pay/cs_test_direct",
      payment_status: null
    };
    const createSession = vi.fn().mockResolvedValue(mockSession);

    const MockStripe = vi.fn().mockImplementation(function () {
      return {
        checkout: { sessions: { create: createSession } }
      };
    });

    StripeService.__setDependencies({
      Stripe: MockStripe,
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_live_key"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("")
      }
    });

    const result = await StripeService.createCheckoutSession({
      reservationId: "res-direct",
      customerEmail: "a@b.com",
      amountInMinorUnit: 4000,
      currency: "pln"
    });

    expect(MockStripe).toHaveBeenCalledWith("sk_test_live_key");
    expect(result.sessionId).toBe("cs_test_direct");
    // Covers the `session.payment_status || "unpaid"` fallback branch (null → "unpaid")
    expect(result.paymentStatus).toBe("unpaid");
  });

  it("should_create_refund_for_checkout_session_payment_intent()", async function () {
    const retrieve = vi.fn().mockResolvedValue({
      id: "cs_test_1",
      payment_intent: "pi_123"
    });
    const createRefund = vi.fn().mockResolvedValue({
      id: "re_123",
      status: "succeeded"
    });

    StripeService.__setDependencies({
      stripeClient: {
        checkout: {
          sessions: {
            create: vi.fn(),
            retrieve: retrieve
          }
        },
        webhooks: { constructEvent: vi.fn() },
        refunds: {
          create: createRefund
        }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("whsec_test_abc")
      }
    });

    const result = await StripeService.refundCheckoutSessionPayment({
      sessionId: "cs_test_1",
      reservationId: "res-1"
    });

    expect(retrieve).toHaveBeenCalledWith("cs_test_1");
    expect(createRefund).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: "pi_123", reason: "requested_by_customer" })
    );
    expect(result).toMatchObject({ refundId: "re_123", status: "succeeded", paymentIntentId: "pi_123" });
  });

  it("should_throw_when_checkout_session_has_no_payment_intent_for_refund()", async function () {
    StripeService.__setDependencies({
      stripeClient: {
        checkout: {
          sessions: {
            create: vi.fn(),
            retrieve: vi.fn().mockResolvedValue({ id: "cs_no_intent", payment_intent: null })
          }
        },
        webhooks: { constructEvent: vi.fn() },
        refunds: {
          create: vi.fn()
        }
      },
      ConfigurationService: {
        getStripeSecretKey: vi.fn().mockReturnValue("sk_test_123"),
        getStripeCheckoutSuccessUrl: vi.fn().mockReturnValue("https://example.com/success"),
        getStripeCheckoutCancelUrl: vi.fn().mockReturnValue("https://example.com/cancel"),
        getStripeWebhookSecret: vi.fn().mockReturnValue("whsec_test_abc")
      }
    });

    await expect(
      StripeService.refundCheckoutSessionPayment({ sessionId: "cs_no_intent", reservationId: "res-1" })
    ).rejects.toMatchObject({ statusCode: 409, code: "PaymentNotRefundable" });
  });
});
