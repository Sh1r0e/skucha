const {
  createAvailabilityParams,
  createAvailabilityReservation
} = require("../../factories/availabilityFactory");
const AvailabilityService = require("../../../services/AvailabilityService");

describe("AvailabilityService", function () {
  beforeEach(function () {
    AvailabilityService.__resetDependencies();
    vi.clearAllMocks();
  });

  it("should_return_available_when_remaining_pads_exist()", async function () {
    AvailabilityService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ availability: { totalPads: 4 } })
      },
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          createAvailabilityReservation({
            fromDate: "2026-08-10",
            toDate: "2026-08-12",
            pads: 1,
            status: "Pending"
          })
        ])
      }
    });

    const result = await AvailabilityService.getAvailability(createAvailabilityParams());

    expect(result.available).toBe(true);
    expect(result.remainingPads).toBe(3);
    expect(result.days["2026-08-10"]).toBe(3);
  });

  it("should_reject_invalid_dates()", async function () {
    await expect(
      AvailabilityService.getAvailability(createAvailabilityParams({ from: "invalid-date" }))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid date: from"
    });
  });

  it("should_reject_when_from_is_later_than_to()", async function () {
    await expect(
      AvailabilityService.getAvailability(createAvailabilityParams({
        from: "2026-08-15",
        to: "2026-08-10"
      }))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "from cannot be later than to"
    });
  });

  it("should_reject_ranges_that_are_too_long()", async function () {
    await expect(
      AvailabilityService.getAvailability(createAvailabilityParams({
        to: "2027-08-15"
      }))
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "AvailabilityRangeTooLong"
    });
  });

  it("should_reject_timestamp_values_instead_of_normalizing_them()", async function () {
    await expect(
      AvailabilityService.getAvailability(createAvailabilityParams({
        from: "2026-08-10T00:00:00.000Z"
      }))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid date: from"
    });
  });

  it("should_reject_calendar_dates_that_do_not_exist()", async function () {
    await expect(
      AvailabilityService.getAvailability(createAvailabilityParams({
        from: "2026-02-30"
      }))
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "Invalid date: from"
    });
  });

  it("should_handle_overlapping_reservations_by_day()", async function () {
    AvailabilityService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ availability: { totalPads: 4 } })
      },
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          createAvailabilityReservation({
            id: "a",
            fromDate: "2026-08-10",
            toDate: "2026-08-11",
            pads: 2,
            status: "Pending"
          }),
          createAvailabilityReservation({
            id: "b",
            fromDate: "2026-08-11",
            toDate: "2026-08-12",
            pads: 2,
            status: "Confirmed"
          })
        ])
      }
    });

    const result = await AvailabilityService.getAvailability(createAvailabilityParams());

    expect(result.days["2026-08-11"]).toBe(0);
    expect(result.available).toBe(false);
  });

  it("should_fail_closed_when_repository_is_unavailable()", async function () {
    AvailabilityService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ availability: { totalPads: 4 } })
      },
      ReservationRepository: {
        getReservations: vi.fn().mockRejectedValue(new Error("temporary storage issue"))
      }
    });

    await expect(
      AvailabilityService.getAvailability(createAvailabilityParams())
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "AvailabilityUnavailable"
    });
  });

  it("should_ignore_stale_unpaid_pending_reservations_before_housekeeping_runs()", async function () {
    AvailabilityService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ availability: { totalPads: 4 } })
      },
      ConfigurationService: {
        getReservationPendingExpiryHours: vi.fn().mockReturnValue(2)
      },
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          createAvailabilityReservation({
            pads: 4,
            createdAt: "2026-08-09T08:00:00.000Z",
            paymentStatus: "unpaid"
          })
        ])
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-09T11:00:00.000Z"))
    });

    const result = await AvailabilityService.getAvailability(createAvailabilityParams());

    expect(result.remainingPads).toBe(4);
  });

  it("should_return_not_configured_when_total_pads_is_missing()", async function () {
    AvailabilityService.__setDependencies({
      ConfigService: {
        loadConfig: vi.fn().mockResolvedValue({ availability: { totalPads: 0 } })
      },
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([])
      }
    });

    const result = await AvailabilityService.getAvailability(createAvailabilityParams());

    expect(result.available).toBe(false);
    expect(result.message).toBe("Availability is not configured");
  });
});
