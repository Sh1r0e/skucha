const { createReservation: buildReservation } = require("../../factories/reservationFactory");
const Reservation = require("../../../models/Reservation");
const ReservationService = require("../../../services/ReservationService");

function applyHappyPathDependencies() {
  ReservationService.__setDependencies({
    ConfigService: {
      loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
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
      })
    },
    MailService: {
      sendReservationNotification: vi.fn().mockResolvedValue({ queued: true })
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
        loadConfig: vi.fn().mockResolvedValue({ pickupPoints: [{ name: "Stablowice", enabled: true }] })
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
        })
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
});
