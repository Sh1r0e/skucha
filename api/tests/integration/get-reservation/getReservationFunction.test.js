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
  paymentUrl: "https://checkout.stripe.com/c/pay/cs_test_123"
};

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
    expect(context.res.body.payment.status).toBe("Paid");
    expect(context.res.body.customerName).toBeUndefined();
    expect(context.res.body.customerEmail).toBeUndefined();
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
});
