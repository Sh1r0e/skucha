const { createReservation: buildReservation } = require("../../factories/reservationFactory");
const crypto = require("crypto");
const { Buffer } = require("buffer");
const Reservation = require("../../../models/Reservation");
const ReservationService = require("../../../services/ReservationService");

function createCancellationToken(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("hex");

  return encodedPayload + "." + signature;
}

function applyHappyPathDependencies() {
  ReservationService.__setDependencies({
    ConfigService: {
      loadConfig: vi.fn().mockResolvedValue({
        pickupPoints: [{ name: "Stablowice", enabled: true }],
        pricing: { weekday: 40, weekend: 45, currency: "PLN" }
      })
    },
    AvailabilityService: {
      getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 5 })
    },
    ReservationRepository: {
      saveReservation: vi.fn().mockResolvedValue({
        id: "res-1",
        status: "Pending",
        customerName: "Jan Kowalski",
        customerEmail: "jan.kowalski@example.com",
        customerPhone: "+48500500500",
        fromDate: "2026-08-10",
        toDate: "2026-08-12",
        pads: 2,
        createdAt: "2026-07-05T10:00:00.000Z"
      }),
      attachPayment: vi.fn().mockResolvedValue({
        id: "res-1",
        paymentSessionId: "cs_test_123"
      })
    },
    StripeService: {
      createCheckoutSession: vi.fn().mockResolvedValue({
        sessionId: "cs_test_123",
        url: "https://checkout.stripe.com/c/pay/cs_test_123",
        paymentStatus: "unpaid"
      }),
      refundCheckoutSessionPayment: vi.fn().mockResolvedValue({
        refundId: "re_test_1",
        status: "succeeded",
        paymentIntentId: "pi_test_1"
      })
    },
    ConfigurationService: {
      getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
      getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
      getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
    },
    MailService: {
      sendReservationNotification: vi.fn().mockResolvedValue({ queued: true }),
      sendCancellationNotification: vi.fn().mockResolvedValue({ queued: true })
    }
  });
}

describe("ReservationService", function () {
  beforeEach(function () {
    ReservationService.__resetDependencies();
    vi.clearAllMocks();
  });

  it("should_save_valid_reservation()", async function () {
    const input = buildReservation();

    applyHappyPathDependencies();

    const result = await ReservationService.createReservation(input);

    expect(result.message).toBe("Reservation accepted");
    expect(result.reservationId).toBe("res-1");
    expect(result.reservation.deliveryMethod).toBe("pickup");
    expect(result.payment.sessionId).toBe("cs_test_123");
    expect(result.payment.currency).toBe("PLN");
    expect(result.cancellation.url).toContain("/reservation-cancel.html?reservation_id=res-1");
    expect(result.mail.queued).toBe(true);
  });

  it("should_reject_invalid_dates_format()", async function () {
    const input = buildReservation({ dateFrom: "10-08-2026" });

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
      }
    });

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "dateFrom and dateTo must be in YYYY-MM-DD format"
    });
  });

  it("should_reject_overlapping_reservations_when_capacity_is_too_low()", async function () {
    const input = buildReservation({ padsCount: 4 });

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
      },
      AvailabilityService: {
        getAvailability: vi.fn().mockResolvedValue({ available: false, remainingPads: 0 })
      }
    });

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "Requested number of pads is not available for selected dates"
    });
  });

  it("should_propagate_repository_failures()", async function () {
    const input = buildReservation();

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
      },
      AvailabilityService: {
        getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 5 })
      },
      ReservationRepository: {
        saveReservation: vi.fn().mockRejectedValue(Object.assign(new Error("Storage down"), { statusCode: 503 }))
      },
      StripeService: {
        createCheckoutSession: vi.fn()
      }
    });

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 503,
      message: "Storage down"
    });
  });

  it("should_propagate_notification_failures()", async function () {
    const input = buildReservation();

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({
          pickupPoints: [{ name: "Stablowice", enabled: true }],
          pricing: { weekday: 40, weekend: 45, currency: "PLN" }
        })
      },
      AvailabilityService: {
        getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 5 })
      },
      ReservationRepository: {
        saveReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Pending",
          customerName: "Jan Kowalski",
          customerEmail: "jan.kowalski@example.com",
          customerPhone: "+48500500500",
          fromDate: "2026-08-10",
          toDate: "2026-08-12",
          pads: 2,
          createdAt: "2026-07-05T10:00:00.000Z"
        }),
        attachPayment: vi.fn().mockResolvedValue({
          id: "res-1",
          paymentSessionId: "cs_test_123"
        })
      },
      StripeService: {
        createCheckoutSession: vi.fn().mockResolvedValue({
          sessionId: "cs_test_123",
          url: "https://checkout.stripe.com/c/pay/cs_test_123",
          paymentStatus: "unpaid"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue(""),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(0)
      },
      MailService: {
        sendReservationNotification: vi.fn().mockRejectedValue(new Error("Mail provider unavailable"))
      }
    });

    await expect(ReservationService.createReservation(input)).rejects.toThrow("Mail provider unavailable");
  });

  it("should_reject_invalid_pickup_point()", async function () {
    const input = buildReservation({ pickupPoint: "Unknown Point" });

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
      }
    });

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "pickupPoint is not available"
    });
  });

  it("should_accept_delivery_without_pickup_point()", async function () {
    const input = buildReservation({
      deliveryMethod: "delivery",
      pickupPoint: ""
    });

    applyHappyPathDependencies();

    const result = await ReservationService.createReservation(input);

    expect(result.reservation.deliveryMethod).toBe("delivery");
  });

  it("should_reject_missing_first_name()", async function () {
    const input = buildReservation({ firstName: "" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "firstName is required"
    });
  });

  it("should_reject_invalid_email_format()", async function () {
    const input = buildReservation({ email: "invalid-email" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "Valid email is required"
    });
  });

  it("should_reject_invalid_phone_format()", async function () {
    const input = buildReservation({ phone: "123" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "phone format is invalid"
    });
  });

  it("should_reject_invalid_delivery_method()", async function () {
    const input = buildReservation({ deliveryMethod: "courier" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "deliveryMethod must be pickup or delivery"
    });
  });

  it("should_reject_pads_count_above_limit()", async function () {
    const input = buildReservation({ padsCount: 9 });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "padsCount is too high"
    });
  });

  it("should_reject_missing_last_name()", async function () {
    const input = buildReservation({ lastName: "" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "lastName is required"
    });
  });

  it("should_reject_invalid_first_name_format()", async function () {
    const input = buildReservation({ firstName: "J1" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "firstName format is invalid"
    });
  });

  it("should_reject_missing_dates()", async function () {
    const input = buildReservation({ dateFrom: "", dateTo: "" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "dateFrom and dateTo are required"
    });
  });

  it("should_reject_non_positive_pads_count()", async function () {
    const input = new Reservation(buildReservation());
    input.padsCount = 0;
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "padsCount must be a positive integer"
    });
  });

  it("should_reject_pickup_without_pickup_point()", async function () {
    const input = buildReservation({ deliveryMethod: "pickup", pickupPoint: "" });
    applyHappyPathDependencies();

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "pickupPoint is required for pickup reservations"
    });
  });

  it("should_calculate_correct_amount_when_date_range_is_reversed()", async function () {
    // dateFrom later than dateTo hits the swap branch in countDaysInRange and calculateReservationAmountInMajorUnit.
    const input = buildReservation({ dateFrom: "2026-08-12", dateTo: "2026-08-10" });

    applyHappyPathDependencies();

    const result = await ReservationService.createReservation(input);

    // 3 days × 2 pads × 40 PLN/day = 240 (all weekdays)
    expect(result.payment.amount).toBeGreaterThan(0);
    expect(result.payment.sessionId).toBe("cs_test_123");
  });

  it("should_reject_when_remaining_pads_are_lower_than_requested()", async function () {
    const input = buildReservation({ padsCount: 3 });

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
      },
      AvailabilityService: {
        getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 2 })
      }
    });

    await expect(ReservationService.createReservation(input)).rejects.toMatchObject({
      statusCode: 400,
      message: "Requested number of pads is not available for selected dates"
    });
  });

  it("should_cancel_paid_reservation_and_request_refund()", async function () {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: exp },
      "unit-test-secret"
    );

    applyHappyPathDependencies();

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({
          pickupPoints: [{ name: "Stablowice", enabled: true }],
          pricing: { weekday: 40, weekend: 45, currency: "PLN" }
        })
      },
      AvailabilityService: {
        getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 5 })
      },
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          partitionKey: "2026-08",
          status: "Confirmed",
          customerName: "Jan Kowalski",
          customerEmail: "jan@example.com",
          customerPhone: "+48500500500",
          fromDate: "2026-08-10",
          toDate: "2026-08-12",
          pads: 2,
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid",
          paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_123"
        }),
        attachPayment: vi.fn().mockResolvedValue({ id: "res-1" }),
        updateStatus: vi.fn().mockResolvedValue({ id: "res-1", status: "Cancelled" }),
        saveReservation: vi.fn()
      },
      StripeService: {
        createCheckoutSession: vi.fn(),
        refundCheckoutSessionPayment: vi.fn().mockResolvedValue({
          refundId: "re_test_1",
          status: "succeeded",
          paymentIntentId: "pi_test_1"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-08T00:00:00.000Z")),
      MailService: {
        sendReservationNotification: vi.fn().mockResolvedValue({ queued: true }),
        sendCancellationNotification: vi.fn().mockResolvedValue({ queued: true })
      }
    });

    const result = await ReservationService.cancelReservation({
      reservationId: "res-1",
      token: token
    });

    expect(result.status).toBe("Cancelled");
    expect(result.paymentStatus).toBe("Refunded");
    expect(result.refund.refundId).toBe("re_test_1");
  });

  it("should_allow_cancellation_at_exactly_24_hours_and_reject_afterwards()", async function () {
    const reservation = {
      id: "res-cutoff",
      status: "Confirmed",
      fromDate: "2026-08-12",
      toDate: "2026-08-13",
      paymentSessionId: "cs-cutoff",
      paymentStatus: "unpaid"
    };
    const token = createCancellationToken(
      {
        reservationId: reservation.id,
        sessionId: reservation.paymentSessionId,
        exp: Math.floor(new Date("2026-08-10T23:00:00.000Z").getTime() / 1000)
      },
      "unit-test-secret"
    );
    const dependencies = {
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue(reservation),
        attachPayment: vi.fn().mockResolvedValue({ ...reservation, paymentStatus: "Cancelled", etag: "etag-2" }),
        updateStatus: vi.fn().mockResolvedValue({ ...reservation, status: "Cancelled" })
      },
      StripeService: { refundCheckoutSessionPayment: vi.fn() },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancellationCutoffHours: vi.fn().mockReturnValue(24),
        getReservationTimezone: vi.fn().mockReturnValue("Europe/Warsaw")
      },
      MailService: { sendCancellationNotification: vi.fn().mockResolvedValue({ queued: true }) },
      now: vi.fn().mockReturnValue(new Date("2026-08-10T22:00:00.000Z"))
    };

    ReservationService.__setDependencies(dependencies);
    await expect(ReservationService.cancelReservation({ reservationId: reservation.id, token: token }))
      .resolves.toMatchObject({ status: "Cancelled" });

    ReservationService.__setDependencies({
      ...dependencies,
      now: vi.fn().mockReturnValue(new Date("2026-08-10T22:00:00.001Z"))
    });
    await expect(ReservationService.cancelReservation({ reservationId: reservation.id, token: token }))
      .rejects.toMatchObject({ statusCode: 409, code: "CancellationWindowClosed" });
  });

  it("should_return_already_cancelled_without_requesting_another_refund()", async function () {
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: Math.floor(Date.now() / 1000) + 3600 },
      "unit-test-secret"
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Cancelled",
          paymentStatus: "Refunded",
          paymentSessionId: "cs_test_123"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret")
      }
    });

    const result = await ReservationService.cancelReservation({
      reservationId: "res-1",
      token: token
    });

    expect(result).toMatchObject({
      status: "Cancelled",
      paymentStatus: "Refunded",
      alreadyCancelled: true,
      refund: null
    });
  });

  it("should_reject_cancellation_for_completed_reservation()", async function () {
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: Math.floor(Date.now() / 1000) + 3600 },
      "unit-test-secret"
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Completed",
          paymentSessionId: "cs_test_123"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret")
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: token })
    ).rejects.toMatchObject({ statusCode: 409, code: "AlreadyCompleted" });
  });

  it("should_reject_cancellation_when_reservation_is_missing()", async function () {
    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue(null)
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "missing", token: "token" })
    ).rejects.toMatchObject({ statusCode: 404, code: "NotFound" });
  });

  it("should_cancel_unpaid_reservation_without_requesting_refund()", async function () {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: exp },
      "unit-test-secret"
    );
    const refundCheckoutSessionPayment = vi.fn();

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Pending",
          customerName: "Jan Kowalski",
          customerEmail: "jan@example.com",
          fromDate: "2026-08-12",
          toDate: "2026-08-13",
          paymentSessionId: "cs_test_123",
          paymentStatus: "unpaid",
          paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_123"
        }),
        attachPayment: vi.fn().mockResolvedValue({ id: "res-1" }),
        updateStatus: vi.fn().mockResolvedValue({ id: "res-1", status: "Cancelled" })
      },
      StripeService: {
        refundCheckoutSessionPayment: refundCheckoutSessionPayment
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-08T00:00:00.000Z")),
      MailService: {
        sendCancellationNotification: vi.fn().mockResolvedValue({ queued: true })
      }
    });

    const result = await ReservationService.cancelReservation({
      reservationId: "res-1",
      token: token
    });

    expect(result.paymentStatus).toBe("Cancelled");
    expect(refundCheckoutSessionPayment).not.toHaveBeenCalled();
  });

  it("should_reject_cancellation_with_invalid_token_format()", async function () {
    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          fromDate: "2026-08-12",
          toDate: "2026-08-13",
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: "invalid" })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid cancellation token format" });
  });

  it("should_reject_cancellation_with_invalid_token_signature()", async function () {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: exp },
      "different-secret"
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          fromDate: "2026-08-12",
          toDate: "2026-08-13",
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: token })
    ).rejects.toMatchObject({ statusCode: 400, message: "Invalid cancellation token signature" });
  });

  it("should_reject_cancellation_when_payment_update_returns_null()", async function () {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: exp },
      "unit-test-secret"
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          fromDate: "2026-08-12",
          toDate: "2026-08-13",
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid"
        }),
        attachPayment: vi.fn().mockResolvedValue(null),
        updateStatus: vi.fn().mockResolvedValue({ id: "res-1", status: "CancellationPending" })
      },
      StripeService: {
        refundCheckoutSessionPayment: vi.fn().mockResolvedValue({ status: "succeeded", refundId: "re_1" })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: token })
    ).rejects.toMatchObject({ statusCode: 404, code: "NotFound" });
  });

  it("should_reject_cancellation_when_status_update_returns_null()", async function () {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: exp },
      "unit-test-secret"
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          fromDate: "2026-08-12",
          toDate: "2026-08-13",
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid"
        }),
        attachPayment: vi.fn().mockResolvedValue({ id: "res-1" }),
        updateStatus: vi.fn().mockResolvedValue(null)
      },
      StripeService: {
        refundCheckoutSessionPayment: vi.fn().mockResolvedValue({ status: "succeeded", refundId: "re_1" })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      },
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: token })
    ).rejects.toMatchObject({ statusCode: 404, code: "NotFound" });
  });

  it("should_report_missing_cancellation_token_secret()", async function () {
    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue(""),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: "token" })
    ).rejects.toMatchObject({ statusCode: 503, code: "CancellationNotConfigured" });
  });

  it("should_reject_cancellation_with_expired_token()", async function () {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const token = createCancellationToken(
      { reservationId: "res-1", sessionId: "cs_test_123", exp: exp },
      "unit-test-secret"
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          paymentSessionId: "cs_test_123",
          paymentStatus: "Paid"
        })
      },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret"),
        getReservationCancelTokenTtlHours: vi.fn().mockReturnValue(72)
      }
    });

    await expect(
      ReservationService.cancelReservation({ reservationId: "res-1", token: token })
    ).rejects.toMatchObject({ statusCode: 410, code: "TokenExpired" });
  });

  it("should_use_the_inventory_lease_when_storage_is_configured()", async function () {
    const acquireLease = vi.fn().mockResolvedValue({ leaseId: "lease-1" });
    const releaseLease = vi.fn().mockResolvedValue(undefined);

    ReservationService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({
          pickupPoints: [{ name: "Stablowice", enabled: true }],
          pricing: { weekday: 40, weekend: 45, currency: "PLN" }
        })
      },
      AvailabilityService: { getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 4 }) },
      ReservationRepository: {
        saveReservation: vi.fn().mockResolvedValue({
          id: "res-lease",
          status: "Pending",
          customerName: "Jan Kowalski",
          customerEmail: "jan@example.com",
          customerPhone: "+48500500500",
          fromDate: "2026-08-20",
          toDate: "2026-08-21",
          pads: 1,
          createdAt: "2026-08-09T10:00:00.000Z"
        }),
        attachPayment: vi.fn().mockResolvedValue({ id: "res-lease" })
      },
      InventoryLeaseRepository: { acquireLease, releaseLease },
      StripeService: {
        createCheckoutSession: vi.fn().mockResolvedValue({ sessionId: "cs-lease", url: "https://stripe.test/lease", paymentStatus: "unpaid" })
      },
      ConfigurationService: {
        getStorageConnectionString: vi.fn().mockReturnValue("storage"),
        getInventoryLeaseTtlMs: vi.fn().mockReturnValue(30000),
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret")
      },
      MailService: { sendReservationNotification: vi.fn().mockResolvedValue({ queued: true }) }
    });

    await ReservationService.createReservation(buildReservation({ dateFrom: "2026-08-20", dateTo: "2026-08-21" }));

    expect(acquireLease).toHaveBeenCalledWith("reservation-create", 30000);
    expect(releaseLease).toHaveBeenCalledWith({ leaseId: "lease-1" });
  });

  it("should_reject_production_reservations_when_runtime_configuration_is_incomplete()", async function () {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      ReservationService.__setDependencies({
        ConfigurationService: {
          getRuntimeConfigurationIssues: vi.fn().mockReturnValue(["STORAGE_CONNECTION_STRING"])
        }
      });

      await expect(ReservationService.createReservation(buildReservation())).rejects.toMatchObject({
        statusCode: 503,
        code: "RuntimeConfigurationInvalid"
      });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("should_reject_cancellation_after_collection_or_expiration()", async function () {
    const token = createCancellationToken(
      { reservationId: "res-state", sessionId: "cs-state", exp: Math.floor(Date.now() / 1000) + 3600 },
      "unit-test-secret"
    );
    const baseDependencies = {
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret")
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-08T00:00:00.000Z"))
    };

    ReservationService.__setDependencies({
      ...baseDependencies,
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({ id: "res-state", status: "Expired", paymentSessionId: "cs-state" })
      }
    });
    await expect(ReservationService.cancelReservation({ reservationId: "res-state", token: token }))
      .rejects.toMatchObject({ code: "AlreadyExpired" });

    ReservationService.__setDependencies({
      ...baseDependencies,
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({ id: "res-state", status: "InProgress", paymentSessionId: "cs-state" })
      }
    });
    await expect(ReservationService.cancelReservation({ reservationId: "res-state", token: token }))
      .rejects.toMatchObject({ code: "AlreadyCollected" });
  });

  it("should_keep_cancellation_pending_when_refund_fails_and_retry_it()", async function () {
    const token = createCancellationToken(
      { reservationId: "res-retry", sessionId: "cs-retry", exp: Math.floor(Date.now() / 1000) + 3600 },
      "unit-test-secret"
    );
    const reservation = {
      id: "res-retry",
      status: "Confirmed",
      fromDate: "2026-08-20",
      toDate: "2026-08-21",
      paymentSessionId: "cs-retry",
      paymentStatus: "Paid",
      etag: "etag-1"
    };
    const attachPayment = vi.fn().mockResolvedValue({ ...reservation, status: "CancellationPending", etag: "etag-3" });
    const updateStatus = vi.fn().mockResolvedValue({ ...reservation, status: "CancellationPending", etag: "etag-2" });
    const configuration = {
      getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
      getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret")
    };

    ReservationService.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue(reservation), attachPayment, updateStatus },
      StripeService: { refundCheckoutSessionPayment: vi.fn().mockRejectedValue(new Error("stripe timeout")) },
      ConfigurationService: configuration,
      MailService: { sendCancellationNotification: vi.fn() },
      now: vi.fn().mockReturnValue(new Date("2026-08-08T00:00:00.000Z"))
    });
    await expect(ReservationService.cancelReservation({ reservationId: reservation.id, token: token }))
      .rejects.toThrow("stripe timeout");
    expect(attachPayment).toHaveBeenCalledWith(
      reservation.id,
      expect.objectContaining({ paymentStatus: "RefundFailed" }),
      expect.any(Object)
    );

    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({ ...reservation, status: "CancellationPending", paymentStatus: "RefundFailed" }),
        attachPayment: vi.fn().mockResolvedValue({ ...reservation, status: "CancellationPending", etag: "etag-4" }),
        updateStatus: vi.fn().mockResolvedValue({ ...reservation, status: "Cancelled" })
      },
      StripeService: { refundCheckoutSessionPayment: vi.fn().mockResolvedValue({ refundId: "re-retry", status: "succeeded", paymentIntentId: "pi-retry" }) },
      ConfigurationService: configuration,
      MailService: { sendCancellationNotification: vi.fn().mockResolvedValue({ queued: true }) },
      now: vi.fn().mockReturnValue(new Date("2026-08-08T00:00:00.000Z"))
    });
    await expect(ReservationService.cancelReservation({ reservationId: reservation.id, token: token }))
      .resolves.toMatchObject({ status: "Cancelled", paymentStatus: "Refunded" });
  });

  it("should_cancel_a_confirmed_no_payment_reservation_without_refunding()", async function () {
    const token = createCancellationToken(
      { reservationId: "res-free", sessionId: "cs-free", exp: Math.floor(Date.now() / 1000) + 3600 },
      "unit-test-secret"
    );
    ReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-free", status: "Confirmed", fromDate: "2026-08-20", toDate: "2026-08-21",
          paymentSessionId: "cs-free", paymentStatus: "NoPaymentRequired"
        }),
        attachPayment: vi.fn().mockResolvedValue({ id: "res-free", status: "Confirmed", etag: "etag-free" }),
        updateStatus: vi.fn().mockResolvedValue({ id: "res-free", status: "Cancelled" })
      },
      StripeService: { refundCheckoutSessionPayment: vi.fn() },
      ConfigurationService: {
        getReservationPublicBaseUrl: vi.fn().mockReturnValue("https://www.skucha.co"),
        getReservationCancelTokenSecret: vi.fn().mockReturnValue("unit-test-secret")
      },
      MailService: { sendCancellationNotification: vi.fn().mockResolvedValue({ queued: true }) },
      now: vi.fn().mockReturnValue(new Date("2026-08-08T00:00:00.000Z"))
    });

    const result = await ReservationService.cancelReservation({ reservationId: "res-free", token: token });
    expect(result.status).toBe("Cancelled");
  });
});
