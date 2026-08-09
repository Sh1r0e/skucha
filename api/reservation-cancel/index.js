const ReservationService = require("../services/ReservationService");

function createReservationCancelHandler(customDependencies) {
  const dependencies = {
    ReservationService,
    ...(customDependencies || {})
  };

  return async function reservationCancelHandler(context, req) {
    const request = req || context.req || {};
    const query = request.query || {};

    if (request.method && String(request.method).toLowerCase() !== "post") {
      context.res = {
        status: 405,
        headers: { "Content-Type": "application/json", Allow: "POST" },
        body: { message: "Cancellation must use POST", code: "MethodNotAllowed" }
      };
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

      context.res = {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: {
          message: "Reservation cancelled",
          ...result
        }
      };
    } catch (error) {
      const body = typeof request.body === "object" && request.body ? request.body : {};
      const reservationId = query.reservation_id || query.reservationId || body.reservationId || "";

      context.log.error("Reservation cancellation error", {
        reservationId: reservationId,
        statusCode: error.statusCode,
        code: error.code,
        message: error.message
      });

      context.res = {
        status: error.statusCode || 500,
        headers: { "Content-Type": "application/json" },
        body: {
          message: error.message || "Cancellation failed",
          code: error.code || (error.statusCode >= 500 ? "InternalError" : "BadRequest")
        }
      };
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
