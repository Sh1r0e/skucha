const BlackoutService = require("../../services/BlackoutService");
const { decodeClientPrincipal, getRequest, requireAdmin } = require("../../helpers/auth");
const { rejectDuringMaintenance } = require("../../helpers/maintenance");
const { jsonResponse, rejectNonJsonRequest, rejectOversizedRequest } = require("../../helpers/http");

function response(context, status, body) {
  context.res = jsonResponse(status, body);
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

function queryValue(request, name) {
  const query = request.query || {};
  if (query[name]) {
    return query[name];
  }

  if (typeof request.url === "string") {
    const parsedUrl = new URL(request.url, "http://localhost");
    return parsedUrl.searchParams.get(name) || "";
  }

  return "";
}

function createdBy(request) {
  const principal = decodeClientPrincipal(request);
  return principal && (principal.userDetails || principal.userId || principal.userPrincipalName) || "admin";
}

function createAdminAvailabilityHandler(customDependencies) {
  const dependencies = {
    BlackoutService,
    ...(customDependencies || {})
  };

  return async function adminAvailabilityHandler(context, req) {
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
        const blackouts = await dependencies.BlackoutService.listBlackouts();
        response(context, 200, { blackouts: blackouts });
        return;
      }

      if (method === "post") {
        if (rejectNonJsonRequest(context, request)) {
          return;
        }
        if (rejectOversizedRequest(context, request)) {
          return;
        }

        const body = parseBody(request);
        const blackout = await dependencies.BlackoutService.createBlackout({
          ...body,
          createdBy: createdBy(request)
        });
        response(context, 201, { blackout: blackout });
        return;
      }

      if (method === "delete") {
        const deleted = await dependencies.BlackoutService.deleteBlackout(queryValue(request, "id"));
        response(context, 200, { blackout: deleted });
        return;
      }

      response(context, 405, { message: "Method not allowed", code: "MethodNotAllowed" });
    } catch (error) {
      context.log.error("Admin availability error", { message: error.message, code: error.code });
      response(context, error.statusCode || 500, {
        message: error.message || "Admin availability operation failed",
        code: error.code || "AdminAvailabilityFailed"
      });
    }
  };
}

let activeHandler = createAdminAvailabilityHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createAdminAvailabilityHandler = createAdminAvailabilityHandler;
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createAdminAvailabilityHandler(overrides);
};
defaultHandler.__resetDependencies = function __resetDependencies() {
  activeHandler = createAdminAvailabilityHandler();
};

module.exports = defaultHandler;