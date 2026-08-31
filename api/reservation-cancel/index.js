const ReservationService = require("../services/ReservationService");
const BotProtectionService = require("../services/BotProtectionService");
const { rejectDuringMaintenance } = require("../helpers/maintenance");
const { jsonResponse, rejectNonJsonRequest, rejectOversizedRequest } = require("../helpers/http");
const { rejectRateLimitedRequest } = require("../helpers/bot-protection");

function createReservationCancelHandler(customDependencies) {
  const dependencies = {
    ReservationService,
    BotProtectionService,
    ...(customDependencies || {})
  };

  return async function reservationCancelHandler(context, req) {
    if (rejectDuringMaintenance(context)) {
      return;
    }

    const request = req || context.req || {};
    const query = request.query || {};

    if (request.method && String(request.method).toLowerCase() !== "post") {
      context.res = jsonResponse(405,
        { message: "Cancellation must use POST", code: "MethodNotAllowed" },
        { Allow: "POST" });
      return;
    }

    if (rejectNonJsonRequest(context, request)) {
      return;
    }
    if (rejectOversizedRequest(context, request)) {
      return;
    }
    if (await rejectRateLimitedRequest(context, request, "reservation-cancel", dependencies.BotProtectionService)) {
      return;
    }

    try {
      let body = request.body || {};

      if (typeof body === "string") {
        try {
          body = JSON.parse(body || "{}");
        } catch (_error) {
          const parseError = new Error("Request body must be valid JSON");
          parseError.statusCode = 400;
          parseError.code = "InvalidJson";
          throw parseError;
        }
      }

      const reservationId = query.reservation_id || query.reservationId || body.reservationId || "";
      const token = query.token || body.token || "";

      const result = await dependencies.ReservationService.cancelReservation({
        reservationId: reservationId,
        token: token
      });

      context.res = jsonResponse(200, {
          message: "Reservation cancelled",
          ...result
        });
    } catch (error) {
      const body = typeof request.body === "object" && request.body ? request.body : {};
      const reservationId = query.reservation_id || query.reservationId || body.reservationId || "";

      context.log.error("Reservation cancellation error", {
        reservationId: reservationId,
        statusCode: error.statusCode,
        code: error.code,
        message: error.message
      });

      const statusCode = error.statusCode || 500;
      context.res = jsonResponse(statusCode, {
        message: statusCode >= 500 ? "Cancellation failed" : (error.message || "Cancellation failed"),
        code: error.code || (statusCode >= 500 ? "InternalError" : "BadRequest")
      });
    }
  };
}

let activeHandler = createReservationCancelHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createReservationCancelHandler = createReservationCancelHandler;
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createReservationCancelHandler(overrides);
};
defaultHandler.__resetDependencies = function __resetDependencies() {
  activeHandler = createReservationCancelHandler();
};

module.exports = defaultHandler;
