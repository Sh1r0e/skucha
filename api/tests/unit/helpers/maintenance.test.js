const { createMockContext } = require("../../helpers/functionTestUtils");
const { rejectDuringMaintenance } = require("../../../helpers/maintenance");

describe("maintenance helper", function () {
  const previous = process.env.MAINTENANCE_MODE;

  afterEach(function () {
    if (previous === undefined) {
      delete process.env.MAINTENANCE_MODE;
    } else {
      process.env.MAINTENANCE_MODE = previous;
    }
  });

  it("should_leave_context_untouched_when_maintenance_is_disabled()", function () {
    delete process.env.MAINTENANCE_MODE;
    const context = createMockContext();

    expect(rejectDuringMaintenance(context)).toBe(false);
    expect(context.res).toBeUndefined();
  });

  it("should_return_service_unavailable_when_maintenance_is_enabled()", function () {
    process.env.MAINTENANCE_MODE = "true";
    const context = createMockContext();

    expect(rejectDuringMaintenance(context)).toBe(true);
    expect(context.res.status).toBe(503);
    expect(context.res.body.code).toBe("MaintenanceMode");
    expect(context.res.headers["Retry-After"]).toBe("3600");
  });
});
