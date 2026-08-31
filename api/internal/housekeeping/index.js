const HousekeepingService = require("../../services/HousekeepingService");
const ConfigurationService = require("../../services/ConfigurationService");
const { getRequest, requireInternalSecret } = require("../../helpers/auth");
const { rejectDuringMaintenance } = require("../../helpers/maintenance");
const { jsonResponse, rejectNonJsonRequest, rejectOversizedRequest } = require("../../helpers/http");

function parseBody(request) {
  if (!request.body) {
    return {};
  }

  if (typeof request.body === "object") {
    return request.body;
  }

  try {
    return JSON.parse(request.body);
  } catch (_error) {
    const error = new Error("Request body must be valid JSON");
    error.statusCode = 400;
    error.code = "InvalidJson";
    throw error;
  }
}

module.exports = async function (context, req) {
  if (rejectDuringMaintenance(context)) {
    return;
  }

  const request = getRequest(context, req);
  const secret = ConfigurationService.getHousekeepingSecret();

  if (!secret) {
    context.res = jsonResponse(503, {
      message: "Housekeeping secret is not configured",
      code: "HousekeepingNotConfigured"
    });
    return;
  }

  if (requireInternalSecret(context, request, secret)) {
    return;
  }

  if (rejectNonJsonRequest(context, request)) {
    return;
  }
  if (rejectOversizedRequest(context, request)) {
    return;
  }

  try {
    const body = parseBody(request);
    const result = await HousekeepingService.expirePendingReservations({
      dryRun: Boolean(body.dryRun),
      limit: body.limit
    });

    context.res = jsonResponse(200, result);
  } catch (error) {
    context.log.error("Housekeeping error", { message: error.message, code: error.code });
    const statusCode = error.statusCode || 500;
    context.res = jsonResponse(statusCode, {
      message: statusCode >= 500 ? "Housekeeping failed" : (error.message || "Housekeeping failed"),
      code: error.code || "HousekeepingFailed"
    });
  }
};
