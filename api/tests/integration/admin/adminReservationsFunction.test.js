const { createMockContext } = require("../../helpers/functionTestUtils");
const { Buffer } = require("buffer");
const handler = require("../../../admin/reservations");
const AdminReservationService = require("../../../services/AdminReservationService");

function principalHeader(roles) {
  return Buffer.from(JSON.stringify({ userRoles: roles }), "utf8").toString("base64");
}

describe("admin reservations function", function () {
  beforeEach(function () {
    AdminReservationService.__resetDependencies();
    handler.__resetDependencies();
  });

  it("should_reject_anonymous_requests()", async function () {
    const context = createMockContext();

    await handler(context, { method: "GET", headers: {} });

    expect(context.res.status).toBe(401);
  });

  it("should_list_reservations_for_admins()", async function () {
    handler.__setDependencies({
      AdminReservationService: {
        listReservations: vi.fn().mockResolvedValue([{ id: "res-1", status: "Confirmed" }])
      }
    });
    const context = createMockContext();

    await handler(context, {
      method: "GET",
      headers: { "x-ms-client-principal": principalHeader(["authenticated", "admin"]) },
      query: { active: "true" }
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.reservations[0].id).toBe("res-1");
  });

  it("should_dispatch_collect_action_for_admins()", async function () {
    const collectReservation = vi.fn().mockResolvedValue({ id: "res-1", status: "InProgress" });
    handler.__setDependencies({
      AdminReservationService: {
        collectReservation: collectReservation
      }
    });
    const context = createMockContext();

    await handler(context, {
      method: "POST",
      headers: { "x-ms-client-principal": principalHeader(["admin"]) },
      body: {
        action: "collect",
        reservationId: "res-1",
        expectedReturnAt: "2026-08-12T18:00:00.000Z"
      }
    });

    expect(collectReservation).toHaveBeenCalledWith(expect.objectContaining({ reservationId: "res-1" }));
    expect(context.res.status).toBe(200);
  });
});
