const { Buffer } = require("buffer");
const { createMockContext } = require("../../helpers/functionTestUtils");
const {
  bodyByteLength,
  jsonResponse,
  rejectNonJsonRequest,
  rejectOversizedRequest
} = require("../../../helpers/http");

describe("HTTP helpers", function () {
  it("should_create_non_cacheable_hardened_json_responses()", function () {
    const response = jsonResponse(200, { ok: true });

    expect(response.headers["Cache-Control"]).toBe("no-store, max-age=0");
    expect(response.headers["Content-Security-Policy"]).toContain("default-src 'none'");
    expect(response.headers["Referrer-Policy"]).toBe("no-referrer");
    expect(response.headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(response.headers["X-Frame-Options"]).toBe("DENY");
  });

  it("should_reject_non_json_requests()", function () {
    const context = createMockContext();

    expect(rejectNonJsonRequest(context, { headers: { "Content-Type": "text/plain" } })).toBe(true);
    expect(context.res.status).toBe(415);
    expect(context.res.body.code).toBe("UnsupportedMediaType");
  });

  it("should_accept_json_and_headerless_test_requests()", function () {
    const context = createMockContext();

    expect(rejectNonJsonRequest(context, { headers: { "Content-Type": "application/json; charset=utf-8" } })).toBe(false);
    expect(rejectNonJsonRequest(context, { headers: {} })).toBe(false);
    expect(context.res).toBeUndefined();
  });

  it("should_reject_oversized_and_unserializable_request_bodies()", function () {
    const oversizedContext = createMockContext();
    const absentBodyContext = createMockContext();

    expect(bodyByteLength({ body: Buffer.from("abc") })).toBe(3);
    expect(bodyByteLength({ body: "abc" })).toBe(3);
    expect(bodyByteLength({ body: { value: "abc" } })).toBeGreaterThan(3);
    expect(bodyByteLength({ headers: { "Content-Length": "17" } })).toBe(17);
    expect(bodyByteLength({ headers: { "Content-Length": "invalid" } })).toBe(0);

    expect(rejectOversizedRequest(oversizedContext, { body: "x".repeat(17) }, 16)).toBe(true);
    expect(oversizedContext.res.status).toBe(413);
    expect(oversizedContext.res.body.code).toBe("PayloadTooLarge");

    expect(rejectOversizedRequest(absentBodyContext, { body: "x" }, 16)).toBe(false);
    expect(absentBodyContext.res).toBeUndefined();
  });
});