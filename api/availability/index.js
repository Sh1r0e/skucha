const AvailabilityService = require("../services/AvailabilityService");

function createAvailabilityHandler(customDependencies) {
  const dependencies = {
    AvailabilityService,
    ...(customDependencies || {})
  };

  return async function availabilityHandler(context, req) {
    try {
      const request = req || context.req || {};
      let query = request.query || {};

      if ((!query.from || !query.to) && typeof request.url === "string") {
        const parsedUrl = new URL(request.url, "http://localhost");
        query = {
          ...query,
          from: query.from || parsedUrl.searchParams.get("from"),
          to: query.to || parsedUrl.searchParams.get("to")
        };
      }

      const from = query.from;
      const to = query.to;

      const result = await dependencies.AvailabilityService.getAvailability({ from, to });

      context.res = {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        },
        body: result
      };
    } catch (error) {
      const statusCode = error.statusCode || 400;
      const code = error.code || (statusCode >= 500 ? "InternalError" : "BadRequest");
      const requestId = context.invocationId;

      context.log.error("Availability error", {
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
          message: error.message || "Invalid request",
          code: code,
          requestId: requestId
        }
      };
    }
  };
}

let activeHandler = createAvailabilityHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createAvailabilityHandler = createAvailabilityHandler;
defaultHandler.__setAvailabilityService = function __setAvailabilityService(service) {
  activeHandler = createAvailabilityHandler({ AvailabilityService: service || AvailabilityService });
};
defaultHandler.__resetAvailabilityService = function __resetAvailabilityService() {
  activeHandler = createAvailabilityHandler();
};

module.exports = defaultHandler;
