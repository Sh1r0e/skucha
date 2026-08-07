const { createMockContext } = require("../../helpers/functionTestUtils");
const handler = require("../../../reservation-cancel");

describe("reservation-cancel function", function () {
  beforeEach(function () {
    vi.clearAllMocks();
    handler.__resetDependencies();
  });

  it("should_return_200_when_cancellation_succeeds_from_query()", async function () {
    handler.__setDependencies({
      ReservationService: {
        cancelReservation: vi.fn().mockResolvedValue({
          reservationId: "res-1",
          status: "Cancelled",
          paymentStatus: "RefundPending"
        })
      }
    });

    const context = createMockContext();

    await handler(context, {
      query: {
        reservation_id: "res-1",
        token: "abc"
      }
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.status).toBe("Cancelled");
  });

  it("should_support_post_body_payload()", async function () {
    const cancelReservation = vi.fn().mockResolvedValue({
      reservationId: "res-2",
      status: "Cancelled",
      paymentStatus: "Cancelled"
    });

    handler.__setDependencies({
      ReservationService: { cancelReservation: cancelReservation }
    });

    const context = createMockContext();

    await handler(context, {
      body: {
        reservationId: "res-2",
        token: "xyz"
      }
    });

    expect(cancelReservation).toHaveBeenCalledWith({ reservationId: "res-2", token: "xyz" });
    expect(context.res.status).toBe(200);
  });

  it("should_return_400_for_invalid_json_body()", async function () {
    const context = createMockContext();

    await handler(context, {
      body: "{bad-json"
    });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("InvalidJson");
  });

  it("should_return_service_error_status_and_code()", async function () {
    handler.__setDependencies({
      ReservationService: {
        cancelReservation: vi.fn().mockRejectedValue(
          Object.assign(new Error("Cancellation token expired"), {
            statusCode: 410,
            code: "TokenExpired"
          })
        )
      }
    });

    const context = createMockContext();

    await handler(context, {
      query: {
        reservation_id: "res-1",
        token: "expired"
      }
    });

    expect(context.res.status).toBe(410);
    expect(context.res.body.code).toBe("TokenExpired");
  });
});
