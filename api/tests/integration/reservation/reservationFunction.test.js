const { createMockContext } = require("../../helpers/functionTestUtils");
const { createReservation } = require("../../factories/reservationFactory");
const handler = require("../../../reservation");

describe("reservation function", function () {
  beforeEach(function () {
    vi.clearAllMocks();
    handler.__resetReservationService();
  });

  it("should_return_200_for_happy_path()", async function () {
    handler.__setReservationService({
      createReservation: vi.fn().mockResolvedValue({
        reservationId: "res-1",
        message: "Reservation accepted"
      })
    });
    const context = createMockContext();

    await handler(context, { body: createReservation() });

    expect(context.res.status).toBe(200);
    expect(context.res.body.reservationId).toBe("res-1");
  });

  it("should_return_400_for_invalid_payload_type()", async function () {
    const context = createMockContext();

    await handler(context, { body: [] });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("InvalidRequestBody");
  });

  it("should_return_400_for_invalid_json_string_payload()", async function () {
    const context = createMockContext();

    await handler(context, { body: "{ bad-json" });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("InvalidJson");
  });

  it("should_return_400_for_missing_payload()", async function () {
    const context = createMockContext();

    await handler(context, {});

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("BadRequest");
  });

  it("should_return_404_when_service_throws_not_found()", async function () {
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue(
        Object.assign(new Error("Reservation template not found"), {
          statusCode: 404,
          code: "NotFound"
        })
      )
    });
    const context = createMockContext();

    await handler(context, { body: createReservation() });

    expect(context.res.status).toBe(404);
    expect(context.res.body.code).toBe("NotFound");
  });

  it("should_return_500_for_unexpected_exceptions()", async function () {
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue(new Error("boom"))
    });
    const context = createMockContext();

    await handler(context, { body: createReservation() });

    expect(context.res.status).toBe(500);
    expect(context.res.body.code).toBe("InternalError");
  });

  it("should_return_503_for_repository_exceptions()", async function () {
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue(
        Object.assign(new Error("Storage unavailable"), {
          statusCode: 503,
          code: "StorageError"
        })
      )
    });
    const context = createMockContext();

    await handler(context, { body: createReservation() });

    expect(context.res.status).toBe(503);
    expect(context.res.body.code).toBe("StorageError");
  });

  it("should_use_context_req_when_second_argument_is_missing()", async function () {
    const createReservationMock = vi.fn().mockResolvedValue({
      reservationId: "res-context",
      message: "Reservation accepted"
    });

    handler.__setReservationService({
      createReservation: createReservationMock
    });

    const context = createMockContext({
      req: {
        body: createReservation()
      }
    });

    await handler(context);

    expect(createReservationMock).toHaveBeenCalledTimes(1);
    expect(context.res.status).toBe(200);
  });

  it("should_return_400_when_both_req_and_context_req_are_absent()", async function () {
    // Covers the third branch of `req || context.req || {}`.
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue(
        Object.assign(new Error("firstName is required"), { statusCode: 400, code: "BadRequest" })
      )
    });
    const context = createMockContext(); // context.req is undefined

    await handler(context); // req argument also absent

    expect(context.res.status).toBe(400);
  });

  it("should_return_400_for_empty_string_body()", async function () {
    // Covers the `payload || "{}"` fallback in JSON.parse branch.
    const context = createMockContext();

    await handler(context, { body: "" });

    expect(context.res.status).toBe(400);
  });

  it("should_use_BadRequest_code_when_error_has_no_code_and_status_is_below_500()", async function () {
    // Covers the `"BadRequest"` branch of `error.code || (statusCode >= 500 ? ... : "BadRequest")`.
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue(
        Object.assign(new Error("validation failed"), { statusCode: 422 })
      )
    });
    const context = createMockContext();

    await handler(context, { body: { firstName: "Jan" } });

    expect(context.res.status).toBe(422);
    expect(context.res.body.code).toBe("BadRequest");
  });

  it("should_use_default_service_when_null_is_passed_to_set_reservation_service()", async function () {
    // Covers `service || ReservationService` fallback.
    expect(() => handler.__setReservationService(null)).not.toThrow();
  });

  it("should_map_unknown_errors_to_internal_error()", async function () {
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue(new Error("unexpected"))
    });

    const context = createMockContext();

    await handler(context, { body: createReservation() });

    expect(context.res.status).toBe(500);
    expect(context.res.body.code).toBe("InternalError");
  });

  it("should_use_default_error_message_when_exception_has_no_message()", async function () {
    handler.__setReservationService({
      createReservation: vi.fn().mockRejectedValue({ statusCode: 500, code: "InternalError" })
    });

    const context = createMockContext();

    await handler(context, { body: createReservation() });

    expect(context.res.status).toBe(500);
    expect(context.res.body.message).toBe("Reservation failed");
  });
});
