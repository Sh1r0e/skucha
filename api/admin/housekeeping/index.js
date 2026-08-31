const HousekeepingService = require("../../services/HousekeepingService");
const { getRequest, requireAdmin } = require("../../helpers/auth");
const { rejectDuringMaintenance } = require("../../helpers/maintenance");
const { jsonResponse, rejectNonJsonRequest, rejectOversizedRequest } = require("../../helpers/http");

module.exports = async function (context, req) {
  if (rejectDuringMaintenance(context)) {
    return;
  }

  const request = getRequest(context, req);

  if (requireAdmin(context, request)) {
    return;
  }

  if (rejectNonJsonRequest(context, request)) {
    return;
  }
  if (rejectOversizedRequest(context, request)) {
    return;
  }

  let body = {};
  try {
    if (request.body) {
      body = typeof request.body === "object" ? request.body : JSON.parse(request.body);
    }
  } catch (_error) {
    context.res = jsonResponse(400, { message: "Request body must be valid JSON", code: "InvalidJson" });
    return;
  }

  try {
    const result = await HousekeepingService.expirePendingReservations({
      dryRun: Boolean(body.dryRun),
      limit: body.limit
    });
    context.res = jsonResponse(200, result);
  } catch (error) {
    context.log.error("Admin housekeeping error", { message: error.message, code: error.code });
    const statusCode = error.statusCode || 500;
    context.res = jsonResponse(statusCode, {
      message: statusCode >= 500 ? "Housekeeping failed" : (error.message || "Housekeeping failed"),
      code: error.code || "HousekeepingFailed"
    });
  }
};
