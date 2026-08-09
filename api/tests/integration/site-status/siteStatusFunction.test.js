const { createMockContext } = require("../../helpers/functionTestUtils");

const handler = require("../../../site-status");

describe("site-status function", function () {
  const previous = process.env.MAINTENANCE_MODE;

  afterEach(function () {
    if (previous === undefined) {
      delete process.env.MAINTENANCE_MODE;
    } else {
      process.env.MAINTENANCE_MODE = previous;
    }
  });

  it("should_return_disabled_status_by_default()", async function () {
    delete process.env.MAINTENANCE_MODE;
    const context = createMockContext();

    await handler(context);

    expect(context.res.status).toBe(200);
    expect(context.res.body).toEqual({ maintenanceMode: false, message: "" });
    expect(context.res.headers["Cache-Control"]).toBe("no-store, max-age=0");
  });

  it("should_return_enabled_status_when_environment_flag_is_truthy()", async function () {
    process.env.MAINTENANCE_MODE = "true";
    const context = createMockContext();

    await handler(context);

    expect(context.res.status).toBe(200);
    expect(context.res.body.maintenanceMode).toBe(true);
    expect(context.res.body.message).toContain("site is being built");
  });
});
