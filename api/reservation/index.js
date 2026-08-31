const ReservationService = require("../services/ReservationService");
const Reservation = require("../models/Reservation");
const BotProtectionService = require("../services/BotProtectionService");
const TurnstileService = require("../services/TurnstileService");
const { rejectDuringMaintenance } = require("../helpers/maintenance");
const { jsonResponse, rejectNonJsonRequest, rejectOversizedRequest } = require("../helpers/http");
const { rejectRateLimitedRequest } = require("../helpers/bot-protection");

function createReservationHandler(customDependencies) {
  const dependencies = {
    ReservationService,
    Reservation,
    BotProtectionService,
    TurnstileService,
    ...(customDependencies || {})
  };

  return async function reservationHandler(context, req) {
    if (rejectDuringMaintenance(context)) {
      return;
    }

    let reservation = null;

    try {
      const request = req || context.req || {};
      if (rejectNonJsonRequest(context, request)) {
        return;
      }
      if (rejectOversizedRequest(context, request)) {
        return;
      }
      if (await rejectRateLimitedRequest(context, request, "reservation-create", dependencies.BotProtectionService)) {
        return;
      }
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

      await dependencies.TurnstileService.verifyReservation(payload.turnstileToken, request);
      reservation = new dependencies.Reservation(payload);

      const forwardedFor = getHeader(request, "x-forwarded-for");
      const clientIp = String(forwardedFor || getHeader(request, "x-real-ip") || "")
        .split(",")[0]
        .trim();
      const requestOptions = {
        idempotencyKey: getHeader(request, "Idempotency-Key"),
        clientIp: clientIp,
        userAgent: getHeader(request, "user-agent")
      };

      const result = await dependencies.ReservationService.createReservation(reservation, requestOptions);

      context.log("Reservation accepted", { reservationId: result.reservationId });

      context.res = jsonResponse(200, result);
    } catch (error) {
      const statusCode = error.statusCode || 500;
      const code = error.code || (statusCode >= 500 ? "InternalError" : "BadRequest");
      const requestId = context.invocationId;

      context.log.error("Reservation error", {
        requestId: requestId,
        statusCode: statusCode,
        message: error.message,
        code: code,
        details: error.details
      });

      context.res = jsonResponse(statusCode, {
        message: statusCode >= 500 ? "Reservation failed" : (error.message || "Reservation failed"),
        code: code,
        requestId: requestId
      });
    }
  };
}

function getHeader(request, name) {
  if (!request || !request.headers) {
    return "";
  }

  if (typeof request.headers.get === "function") {
    return request.headers.get(name) || "";
  }

  const target = String(name).toLowerCase();
  const headerName = Object.keys(request.headers).find(function (key) {
    return key.toLowerCase() === target;
  });

  return headerName ? request.headers[headerName] : "";
}

let activeHandler = createReservationHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createReservationHandler = createReservationHandler;
defaultHandler.__setReservationService = function __setReservationService(service) {
  activeHandler = createReservationHandler({ ReservationService: service || ReservationService });
};
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createReservationHandler(overrides);
};
defaultHandler.__resetReservationService = function __resetReservationService() {
  activeHandler = createReservationHandler();
};

module.exports = defaultHandler;
