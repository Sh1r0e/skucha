const Auth = require("../../../helpers/auth");
const { createMockContext } = require("../../helpers/functionTestUtils");
const { Buffer } = require("buffer");

function principalHeader(roles) {
  return Buffer.from(JSON.stringify({
    userId: "staff-1",
    userDetails: "staff@example.com",
    userRoles: roles
  }), "utf8").toString("base64");
}

describe("auth helpers", function () {
  it("should_require_the_admin_role()", function () {
    const context = createMockContext();
    const request = { headers: { "x-ms-client-principal": principalHeader(["anonymous", "authenticated", "admin"]) } };

    expect(Auth.requireAdmin(context, request)).toBe(false);
    expect(context.res).toBeUndefined();
  });

  it("should_reject_missing_or_non_admin_principals()", function () {
    const missingContext = createMockContext();
    const nonAdminContext = createMockContext();

    expect(Auth.requireAdmin(missingContext, { headers: {} })).toBe(true);
    expect(missingContext.res.status).toBe(401);

    expect(Auth.requireAdmin(nonAdminContext, {
      headers: { "x-ms-client-principal": principalHeader(["authenticated"]) }
    })).toBe(true);
    expect(nonAdminContext.res.status).toBe(403);
  });

  it("should_compare_internal_secrets_without_plaintext_comparison()", function () {
    const validContext = createMockContext();
    const invalidContext = createMockContext();

    expect(Auth.requireInternalSecret(validContext, {
      headers: { "x-housekeeping-secret": "secret-value" }
    }, "secret-value")).toBe(false);
    expect(Auth.requireInternalSecret(invalidContext, {
      headers: { "x-housekeeping-secret": "wrong-value" }
    }, "secret-value")).toBe(true);
    expect(invalidContext.res.status).toBe(401);
  });
});
