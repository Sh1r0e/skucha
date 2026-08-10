const AdminReservationService = require("../../services/AdminReservationService");
const { getRequest, requireAdmin } = require("../../helpers/auth");
const { rejectDuringMaintenance } = require("../../helpers/maintenance");

function response(context, status, body) {
  context.res = {
    status: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: body
  };
}

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

function createAdminReservationsHandler(customDependencies) {
  const dependencies = {
    AdminReservationService,
    ...(customDependencies || {})
  };

  return async function adminReservationsHandler(context, req) {
    if (rejectDuringMaintenance(context)) {
      return;
    }

    const request = getRequest(context, req);
    if (requireAdmin(context, request)) {
      return;
    }

    try {
      const method = String(request.method || "get").toLowerCase();

      if (method === "get") {
        const query = request.query || {};
        const reservations = await dependencies.AdminReservationService.listReservations({
          status: query.status,
          active: query.active
        });
        response(context, 200, { reservations: reservations });
        return;
      }

      if (method !== "post") {
        response(context, 405, { message: "Method not allowed", code: "MethodNotAllowed" });
        return;
      }

      const body = parseBody(request);
      let reservation;

      if (body.action === "collect") {
        reservation = await dependencies.AdminReservationService.collectReservation(body);
      } else if (body.action === "complete" || body.action === "return") {
        reservation = await dependencies.AdminReservationService.completeReservation(body);
      } else {
        response(context, 400, { message: "action must be collect or complete", code: "InvalidAction" });
        return;
      }

      response(context, 200, { reservation: reservation });
    } catch (error) {
      context.log.error("Admin reservations error", { message: error.message, code: error.code });
      response(context, error.statusCode || 500, {
        message: error.message || "Admin reservation operation failed",
        code: error.code || "AdminReservationFailed"
      });
    }
  };
}

let activeHandler = createAdminReservationsHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createAdminReservationsHandler = createAdminReservationsHandler;
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createAdminReservationsHandler(overrides);
};
defaultHandler.__resetDependencies = function __resetDependencies() {
  activeHandler = createAdminReservationsHandler();
};

module.exports = defaultHandler;
