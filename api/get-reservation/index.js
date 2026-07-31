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
    const query = request.query || {};
    const id = query.id || "";

    if (!id || typeof id !== "string" || !id.trim()) {
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { message: "id query parameter is required", code: "MissingId" }
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

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: {
        id: reservation.id,
        status: reservation.status,
        customerName: reservation.customerName,
        dateFrom: reservation.fromDate,
        dateTo: reservation.toDate,
        pads: reservation.pads,
        createdAt: reservation.createdAt,
        payment: {
          sessionId: reservation.paymentSessionId || "",
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
