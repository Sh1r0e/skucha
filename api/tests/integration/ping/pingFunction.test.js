const { createMockContext } = require("../../helpers/functionTestUtils");

describe("ping function", function () {
  it("should_return_200_with_health_payload()", async function () {
    const handler = require("../../../ping");
    const context = createMockContext();

    await handler(context);

    expect(context.res.status).toBe(200);
    expect(context.res.body.ok).toBe(true);
    expect(context.res.body.service).toBe("skucha-api");
  });
});
