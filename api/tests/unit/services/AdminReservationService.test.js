const AdminReservationService = require("../../../services/AdminReservationService");

describe("AdminReservationService", function () {
  beforeEach(function () {
    AdminReservationService.__resetDependencies();
  });

  it("should_collect_only_confirmed_reservations()", async function () {
    const updateReservation = vi.fn().mockResolvedValue({
      id: "res-1",
      status: "InProgress",
      expectedReturnAt: "2026-08-12T21:00:00.000Z"
    });

    AdminReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "Confirmed",
          etag: "etag-1"
        }),
        updateReservation
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-10T10:00:00.000Z"))
    });

    const result = await AdminReservationService.collectReservation({
      reservationId: "res-1",
      expectedReturnAt: "2026-08-12T21:00:00.000Z",
      handledBy: "staff@example.com"
    });

    expect(result.status).toBe("InProgress");
    expect(updateReservation).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ status: "InProgress", handledBy: "staff@example.com" }),
      { expectedStatus: "Confirmed", expectedEtag: "etag-1" }
    );
  });

  it("should_complete_only_in_progress_reservations()", async function () {
    const updateReservation = vi.fn().mockResolvedValue({ id: "res-1", status: "Completed" });

    AdminReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({
          id: "res-1",
          status: "InProgress",
          etag: "etag-2",
          handledBy: "staff@example.com",
          handoverNotes: "No damage"
        }),
        updateReservation
      },
      now: vi.fn().mockReturnValue(new Date("2026-08-12T20:00:00.000Z"))
    });

    const result = await AdminReservationService.completeReservation({ reservationId: "res-1" });

    expect(result.status).toBe("Completed");
    expect(updateReservation).toHaveBeenCalledWith(
      "res-1",
      expect.objectContaining({ status: "Completed", returnedAt: "2026-08-12T20:00:00.000Z" }),
      { expectedStatus: "InProgress", expectedEtag: "etag-2" }
    );
  });

  it("should_reject_collection_of_cancelled_reservations()", async function () {
    AdminReservationService.__setDependencies({
      ReservationRepository: {
        getReservation: vi.fn().mockResolvedValue({ id: "res-1", status: "Cancelled" })
      }
    });

    await expect(
      AdminReservationService.collectReservation({
        reservationId: "res-1",
        expectedReturnAt: "2026-08-12T21:00:00.000Z"
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "InvalidStatusTransition" });
  });

  it("should_filter_and_sort_admin_reservation_lists()", async function () {
    AdminReservationService.__setDependencies({
      ReservationRepository: {
        getReservations: vi.fn().mockResolvedValue([
          { id: "later", status: "InProgress", fromDate: "2026-08-20" },
          { id: "earlier", status: "Confirmed", fromDate: "2026-08-10" },
          { id: "cancelled", status: "Cancelled", fromDate: "2026-08-01" }
        ])
      }
    });

    await expect(AdminReservationService.listReservations({ active: "true" })).resolves.toEqual([
      expect.objectContaining({ id: "earlier" }),
      expect.objectContaining({ id: "later" })
    ]);
    await expect(AdminReservationService.listReservations({ status: "Cancelled" })).resolves.toEqual([
      expect.objectContaining({ id: "cancelled" })
    ]);
  });

  it("should_reject_invalid_and_missing_handover_data()", async function () {
    AdminReservationService.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue(null) }
    });

    await expect(AdminReservationService.collectReservation({})).rejects.toMatchObject({ code: "MissingReservationId" });
    await expect(AdminReservationService.collectReservation({ reservationId: "missing", expectedReturnAt: "2026-08-12" }))
      .rejects.toMatchObject({ code: "NotFound" });

    AdminReservationService.__setDependencies({
      ReservationRepository: { getReservation: vi.fn().mockResolvedValue({ id: "res-1", status: "Confirmed" }) }
    });
    await expect(AdminReservationService.collectReservation({ reservationId: "res-1", expectedReturnAt: "bad" }))
      .rejects.toMatchObject({ code: "InvalidDate" });
  });
});
