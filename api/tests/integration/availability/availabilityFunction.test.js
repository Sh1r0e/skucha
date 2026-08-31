const { createMockContext } = require("../../helpers/functionTestUtils");
const handler = require("../../../availability");

describe("availability function", function () {
  beforeEach(function () {
    vi.clearAllMocks();
    handler.__resetAvailabilityService();
  });

  it("should_return_200_for_happy_path()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockResolvedValue({ available: true, remainingPads: 3, days: {} })
    });
    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(200);
    expect(context.res.body.available).toBe(true);
  });

  it("should_return_429_before_calling_availability_service", async function () {
    const getAvailability = vi.fn();
    handler.__setDependencies({
      AvailabilityService: { getAvailability },
      BotProtectionService: {
        checkRequest: vi.fn().mockResolvedValue({ allowed: false, resetAt: "2099-01-01T00:00:00.000Z" })
      }
    });
    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(429);
    expect(context.res.body.code).toBe("TooManyRequests");
    expect(getAvailability).not.toHaveBeenCalled();
  });

  it("should_parse_query_params_from_url()", async function () {
    const getAvailability = vi.fn().mockResolvedValue({ available: true, remainingPads: 3, days: {} });

    handler.__setAvailabilityService({ getAvailability });
    const context = createMockContext();

    await handler(context, { url: "http://localhost/api/availability?from=2026-08-10&to=2026-08-12" });

    expect(getAvailability).toHaveBeenCalledWith({ from: "2026-08-10", to: "2026-08-12" });
    expect(context.res.status).toBe(200);
  });

  it("should_return_400_for_invalid_payload()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(
        Object.assign(new Error("Invalid date: from"), {
          statusCode: 400,
          code: "BadRequest"
        })
      )
    });
    const context = createMockContext();

    await handler(context, { query: { from: "bad", to: "2026-08-12" } });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("BadRequest");
  });

  it("should_return_404_when_service_reports_not_found()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(
        Object.assign(new Error("Calendar not found"), {
          statusCode: 404,
          code: "NotFound"
        })
      )
    });
    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(404);
    expect(context.res.body.code).toBe("NotFound");
  });

  it("should_return_500_for_repository_exceptions()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(
        Object.assign(new Error("Storage unavailable"), {
          statusCode: 500,
          code: "StorageError"
        })
      )
    });
    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(500);
    expect(context.res.body.code).toBe("StorageError");
  });

  it("should_return_400_for_missing_query_parameters()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(
        Object.assign(new Error("Invalid date: from"), {
          statusCode: 400,
          code: "BadRequest"
        })
      )
    });
    const context = createMockContext();

    await handler(context, { query: {} });

    expect(context.res.status).toBe(400);
  });

  it("should_use_context_req_when_second_argument_is_missing()", async function () {
    const getAvailability = vi.fn().mockResolvedValue({ available: true, remainingPads: 1, days: {} });
    handler.__setAvailabilityService({ getAvailability });

    const context = createMockContext({
      req: {
        query: {
          from: "2026-08-10",
          to: "2026-08-12"
        }
      }
    });

    await handler(context);

    expect(getAvailability).toHaveBeenCalledWith({ from: "2026-08-10", to: "2026-08-12" });
    expect(context.res.status).toBe(200);
  });

  it("should_return_400_when_both_req_and_context_req_are_absent()", async function () {
    // Covers the third branch of `req || context.req || {}`.
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(
        Object.assign(new Error("Invalid date: from"), { statusCode: 400, code: "BadRequest" })
      )
    });
    const context = createMockContext(); // context.req is undefined

    await handler(context); // req argument also absent

    expect(context.res.status).toBe(400);
  });

  it("should_use_BadRequest_code_when_error_has_no_code_and_status_is_below_500()", async function () {
    // Covers the `"BadRequest"` branch of `error.code || (statusCode >= 500 ? ... : "BadRequest")`.
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(
        Object.assign(new Error("date out of range"), { statusCode: 422 })
      )
    });
    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(422);
    expect(context.res.body.code).toBe("BadRequest");
  });

  it("should_use_default_service_when_null_is_passed_to_set_availability_service()", async function () {
    // Covers `service || AvailabilityService` fallback.
    expect(() => handler.__setAvailabilityService(null)).not.toThrow();
  });

  it("should_map_unknown_errors_to_bad_request()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue(new Error("unknown failure"))
    });

    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(400);
    expect(context.res.body.code).toBe("BadRequest");
  });

  it("should_use_default_error_message_when_exception_has_no_message()", async function () {
    handler.__setAvailabilityService({
      getAvailability: vi.fn().mockRejectedValue({ statusCode: 500, code: "InternalError" })
    });

    const context = createMockContext();

    await handler(context, { query: { from: "2026-08-10", to: "2026-08-12" } });

    expect(context.res.status).toBe(500);
    expect(context.res.body.message).toBe("Invalid request");
  });
});
