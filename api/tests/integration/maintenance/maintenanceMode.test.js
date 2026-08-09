const { createMockContext } = require("../../helpers/functionTestUtils");

const newBookingHandlers = [
  require("../../../availability"),
  require("../../../reservation")
];

const existingReservationHandlers = [
  require("../../../get-reservation"),
  require("../../../reservation-cancel")
];

describe("maintenance mode public API policy", function () {
  const previous = process.env.MAINTENANCE_MODE;

  afterEach(function () {
    if (previous === undefined) {
      delete process.env.MAINTENANCE_MODE;
    } else {
      process.env.MAINTENANCE_MODE = previous;
    }
  });

  it("should_block_new_booking_operations_during_maintenance()", async function () {
    process.env.MAINTENANCE_MODE = "true";

    for (const handler of newBookingHandlers) {
      const context = createMockContext();

      await handler(context, { body: {}, query: {} });

      expect(context.res.status).toBe(503);
      expect(context.res.body.code).toBe("MaintenanceMode");
    }
  });

  it("should_leave_existing_reservation_operations_available_during_maintenance()", async function () {
    process.env.MAINTENANCE_MODE = "true";

    const lookupContext = createMockContext();
    await existingReservationHandlers[0](lookupContext, { body: {}, query: {} });
    expect(lookupContext.res.status).toBe(400);
    expect(lookupContext.res.body.code).toBe("MissingId");

    const cancellationContext = createMockContext();
    await existingReservationHandlers[1](cancellationContext, { body: {}, query: {} });
    expect(cancellationContext.res.status).toBe(400);
    expect(cancellationContext.res.body.code).toBe("BadRequest");
  });
});
