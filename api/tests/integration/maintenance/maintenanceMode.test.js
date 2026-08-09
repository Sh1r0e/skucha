const { createMockContext } = require("../../helpers/functionTestUtils");

const guardedHandlers = [
  require("../../../availability"),
  require("../../../reservation"),
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

  it("should_reject_all_public_reservation_handlers()", async function () {
    process.env.MAINTENANCE_MODE = "true";

    for (const handler of guardedHandlers) {
      const context = createMockContext();

      await handler(context, { body: {}, query: {} });

      expect(context.res.status).toBe(503);
      expect(context.res.body.code).toBe("MaintenanceMode");
    }
  });
});
