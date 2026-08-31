const BotProtectionService = require("../services/BotProtectionService");
const { jsonResponse } = require("./http");

async function rejectRateLimitedRequest(context, request, policyKey, service) {
  try {
    const result = await (service || BotProtectionService).checkRequest(request, policyKey);
    if (result.allowed) {
      return false;
    }

    const retryAfter = Math.max(1, Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000));
    context.res = jsonResponse(429, {
      message: "Too many requests",
      code: "TooManyRequests"
    }, { "Retry-After": String(retryAfter) });
    return true;
  } catch (error) {
    context.log.error("Request protection error", {
      requestId: context.invocationId,
      policy: policyKey,
      code: error.code || "RateLimitFailed"
    });
    context.res = jsonResponse(503, {
      message: "Service temporarily unavailable",
      code: "RequestProtectionUnavailable"
    });
    return true;
  }
}

module.exports = { rejectRateLimitedRequest };