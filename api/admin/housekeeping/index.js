const HousekeepingService = require("../../services/HousekeepingService");
const { getRequest, requireAdmin } = require("../../helpers/auth");
const { rejectDuringMaintenance } = require("../../helpers/maintenance");

module.exports = async function (context, req) {
  if (rejectDuringMaintenance(context)) {
    return;
  }

  const request = getRequest(context, req);

  if (requireAdmin(context, request)) {
    return;
  }

  let body = {};
  try {
    if (request.body) {
      body = typeof request.body === "object" ? request.body : JSON.parse(request.body);
    }
  } catch (_error) {
    context.res = {
      status: 400,
      headers: { "Content-Type": "application/json" },
      body: { message: "Request body must be valid JSON", code: "InvalidJson" }
    };
    return;
  }

  try {
    const result = await HousekeepingService.expirePendingReservations({
      dryRun: Boolean(body.dryRun),
      limit: body.limit
    });
    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: result
    };
  } catch (error) {
    context.log.error("Admin housekeeping error", { message: error.message, code: error.code });
    context.res = {
      status: error.statusCode || 500,
      headers: { "Content-Type": "application/json" },
      body: { message: error.message || "Housekeeping failed", code: error.code || "HousekeepingFailed" }
    };
  }
};
