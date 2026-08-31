const ReservationRepository = require("../repositories/ReservationRepository");
const BotProtectionService = require("../services/BotProtectionService");
const { rejectDuringMaintenance } = require("../helpers/maintenance");
const { jsonResponse } = require("../helpers/http");
const { rejectRateLimitedRequest } = require("../helpers/bot-protection");

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

function isSafeIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value.trim());
}

const defaultDependencies = {
  ReservationRepository,
  BotProtectionService
};

function createGetReservationHandler(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  return async function getReservationHandler(context, req) {
    if (rejectDuringMaintenance(context)) {
      return;
    }

    const request = req || context.req || {};
    if (await rejectRateLimitedRequest(context, request, "reservation-lookup", dependencies.BotProtectionService)) {
      return;
    }
    let query = request.query || {};

    if ((!query.id || !query.session_id) && typeof request.url === "string") {
      const parsedUrl = new URL(request.url, "http://localhost");
      query = {
        ...query,
        id: query.id || parsedUrl.searchParams.get("id"),
        reservation_id: query.reservation_id || parsedUrl.searchParams.get("reservation_id"),
        session_id: query.session_id || parsedUrl.searchParams.get("session_id"),
        sessionId: query.sessionId || parsedUrl.searchParams.get("sessionId")
      };
    }
    const id = query.id || query.reservation_id || "";
    const sessionId = query.session_id || query.sessionId || "";

    if (!id || !isSafeIdentifier(id)) {
      context.res = jsonResponse(400, { message: "id query parameter is required", code: "MissingId" });
      return;
    }

    if (!sessionId || !isSafeIdentifier(sessionId)) {
      context.res = jsonResponse(400, { message: "session_id query parameter is required", code: "MissingSessionId" });
      return;
    }

    let reservation;

    try {
      reservation = await dependencies.ReservationRepository.getReservation(id.trim());
    } catch (error) {
      context.log.error("GetReservation error", {
        id: id,
        message: error.message,
        code: error.code
      });
      context.res = jsonResponse(error.statusCode || 503, {
        message: "Unable to load reservation",
        code: error.code || "StorageError"
      });
      return;
    }

    if (!reservation) {
      context.res = jsonResponse(404, { message: "Reservation not found", code: "NotFound" });
      return;
    }

    if (reservation.paymentSessionId !== sessionId.trim()) {
      context.res = jsonResponse(404, { message: "Reservation not found", code: "NotFound" });
      return;
    }

    context.res = jsonResponse(200, {
        id: reservation.id,
        status: reservation.status,
        dateFrom: reservation.fromDate,
        dateTo: reservation.toDate,
        pads: reservation.pads,
        createdAt: reservation.createdAt,
        pickupPoint: reservation.pickupPoint || "",
        payment: {
          status: reservation.paymentStatus || "",
          amount: reservation.paymentAmountMinor
            ? Number(reservation.paymentAmountMinor) / 100
            : null,
          amountMinor: Number(reservation.paymentAmountMinor || 0),
          currency: String(reservation.paymentCurrency || "PLN").toUpperCase()
        }
      });
  };
}

let activeHandler = createGetReservationHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createGetReservationHandler = createGetReservationHandler;
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createGetReservationHandler(overrides);
};
defaultHandler.__resetDependencies = function __resetDependencies() {
  activeHandler = createGetReservationHandler();
};

module.exports = defaultHandler;
