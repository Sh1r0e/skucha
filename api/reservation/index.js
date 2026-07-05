const ReservationService = require("../services/ReservationService");
const Reservation = require("../models/Reservation");

function createReservationHandler(customDependencies) {
  const dependencies = {
    ReservationService,
    Reservation,
    ...(customDependencies || {})
  };

  return async function reservationHandler(context, req) {
    let reservation = null;

    try {
      const request = req || context.req || {};
      let payload = request.body || {};

      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload || "{}");
        } catch (_error) {
          const parseError = new Error("Request body must be valid JSON");
          parseError.statusCode = 400;
          parseError.code = "InvalidJson";
          throw parseError;
        }
      }

      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        const typeError = new Error("Request body must be a JSON object");
        typeError.statusCode = 400;
        typeError.code = "InvalidRequestBody";
        throw typeError;
      }

      reservation = new dependencies.Reservation(payload);

      const result = await dependencies.ReservationService.createReservation(reservation);

      context.log("Reservation accepted", { reservationId: result.reservationId });

      context.res = {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        },
        body: result
      };
    } catch (error) {
      const statusCode = error.statusCode || 500;
      const code = error.code || (statusCode >= 500 ? "InternalError" : "BadRequest");
      const requestId = context.invocationId;

      context.log.error("Reservation error", {
        reservationId: reservation && reservation.id ? reservation.id : undefined,
        requestId: requestId,
        statusCode: statusCode,
        message: error.message,
        code: code
      });

      context.res = {
        status: statusCode,
        headers: {
          "Content-Type": "application/json"
        },
        body: {
          message: error.message || "Reservation failed",
          code: code,
          requestId: requestId
        }
      };
    }
  };
}

let activeHandler = createReservationHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createReservationHandler = createReservationHandler;
defaultHandler.__setReservationService = function __setReservationService(service) {
  activeHandler = createReservationHandler({ ReservationService: service || ReservationService });
};
defaultHandler.__resetReservationService = function __resetReservationService() {
  activeHandler = createReservationHandler();
};

module.exports = defaultHandler;
