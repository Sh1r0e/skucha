const { createMockContext } = require("../../helpers/functionTestUtils");
const { Buffer } = require("buffer");
const internalHandler = require("../../../internal/housekeeping");
const adminHandler = require("../../../admin/housekeeping");
const HousekeepingService = require("../../../services/HousekeepingService");

function principalHeader(roles) {
  return Buffer.from(JSON.stringify({
    userId: "staff-1",
    userRoles: roles
  }), "utf8").toString("base64");
}

describe("housekeeping functions", function () {
  const previousSecret = process.env.HOUSEKEEPING_SECRET;

  beforeEach(function () {
    HousekeepingService.__resetDependencies();
    process.env.HOUSEKEEPING_SECRET = "housekeeping-test-secret";
  });

  afterEach(function () {
    if (previousSecret === undefined) {
      delete process.env.HOUSEKEEPING_SECRET;
    } else {
      process.env.HOUSEKEEPING_SECRET = previousSecret;
    }
  });

  it("should_require_the_scheduler_secret()", async function () {
    const context = createMockContext();

    await internalHandler(context, {
      headers: { "x-housekeeping-secret": "wrong" },
      body: {}
    });

    expect(context.res.status).toBe(401);
    expect(context.res.body.code).toBe("InvalidInternalSecret");
  });

  it("should_run_housekeeping_for_the_scheduler()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: { getReservations: vi.fn().mockResolvedValue([]) }
    });
    const context = createMockContext();

    await internalHandler(context, {
      headers: { "x-housekeeping-secret": "housekeeping-test-secret" },
      body: { dryRun: true }
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.dryRun).toBe(true);
  });

  it("should_require_the_admin_role_for_manual_housekeeping()", async function () {
    const context = createMockContext();

    await adminHandler(context, { headers: {} });

    expect(context.res.status).toBe(401);
    expect(context.res.body.code).toBe("AuthenticationRequired");
  });

  it("should_run_manual_housekeeping_for_an_admin()", async function () {
    HousekeepingService.__setDependencies({
      ReservationRepository: { getReservations: vi.fn().mockResolvedValue([]) }
    });
    const context = createMockContext();

    await adminHandler(context, {
      headers: { "x-ms-client-principal": principalHeader(["authenticated", "admin"]) },
      body: { dryRun: true }
    });

    expect(context.res.status).toBe(200);
    expect(context.res.body.dryRun).toBe(true);
  });
});
