const ReservationRepository = require("../repositories/ReservationRepository");

const defaultDependencies = {
  ReservationRepository
};

function createGetReservationHandler(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  return async function getReservationHandler(context, req) {
    const request = req || context.req || {};
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

    if (!id || typeof id !== "string" || !id.trim()) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { message: "id query parameter is required", code: "MissingId" }
      };
      return;
    }

    if (!sessionId || typeof sessionId !== "string" || !sessionId.trim()) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: { message: "session_id query parameter is required", code: "MissingSessionId" }
      };
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
      context.res = {
        status: error.statusCode || 503,
        headers: { "Content-Type": "application/json" },
        body: {
          message: "Unable to load reservation",
          code: error.code || "StorageError"
        }
      };
      return;
    }

    if (!reservation) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json" },
        body: { message: "Reservation not found", code: "NotFound" }
      };
      return;
    }

    if (reservation.paymentSessionId !== sessionId.trim()) {
      context.res = {
        status: 404,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: { message: "Reservation not found", code: "NotFound" }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: {
        id: reservation.id,
        status: reservation.status,
        dateFrom: reservation.fromDate,
        dateTo: reservation.toDate,
        pads: reservation.pads,
        createdAt: reservation.createdAt,
        payment: {
          status: reservation.paymentStatus || ""
        }
      }
    };
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
