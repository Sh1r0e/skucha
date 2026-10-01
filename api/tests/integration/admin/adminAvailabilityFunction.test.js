const { Buffer } = require("buffer");
const { createMockContext } = require("../../helpers/functionTestUtils");
const handler = require("../../../admin/availability");

function principalHeader(roles) {
  return Buffer.from(JSON.stringify({ userRoles: roles, userDetails: "admin@example.com" }), "utf8")
    .toString("base64");
}

describe("admin availability function", function () {
  beforeEach(function () {
    handler.__resetDependencies();
  });

  it("should_reject_anonymous_requests", async function () {
    const context = createMockContext();

    await handler(context, { method: "GET", headers: {} });

    expect(context.res.status).toBe(401);
  });

  it("should_list_blackouts_for_admins", async function () {
    const listBlackouts = vi.fn().mockResolvedValue([{ id: "blackout-1" }]);
    handler.__setDependencies({ BlackoutService: { listBlackouts } });
    const context = createMockContext();

    await handler(context, {
      method: "GET",
      headers: { "x-ms-client-principal": principalHeader(["admin"]) }
    });

    expect(listBlackouts).toHaveBeenCalledTimes(1);
    expect(context.res.status).toBe(200);
    expect(context.res.body.blackouts[0].id).toBe("blackout-1");
  });

  it("should_create_blackouts_for_admins", async function () {
    const createBlackout = vi.fn().mockResolvedValue({ id: "blackout-1" });
    handler.__setDependencies({ BlackoutService: { createBlackout } });
    const context = createMockContext();

    await handler(context, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ms-client-principal": principalHeader(["authenticated", "admin"])
      },
      body: { fromDate: "2026-08-15", toDate: "2026-08-16", reason: "Weekend" }
    });

    expect(createBlackout).toHaveBeenCalledWith({
      fromDate: "2026-08-15",
      toDate: "2026-08-16",
      reason: "Weekend",
      createdBy: "admin@example.com"
    });
    expect(context.res.status).toBe(201);
  });

  it("should_delete_blackouts_for_admins", async function () {
    const deleteBlackout = vi.fn().mockResolvedValue({ id: "blackout-1" });
    handler.__setDependencies({ BlackoutService: { deleteBlackout } });
    const context = createMockContext();

    await handler(context, {
      method: "DELETE",
      query: { id: "blackout-1" },
      headers: { "x-ms-client-principal": principalHeader(["admin"]) }
    });

    expect(deleteBlackout).toHaveBeenCalledWith("blackout-1");
    expect(context.res.status).toBe(200);
  });
});