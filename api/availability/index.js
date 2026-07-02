const AvailabilityService = require("../services/AvailabilityService");

module.exports = async function (context, req) {
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

    const result = await AvailabilityService.getAvailability({ from, to });

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: result
    };
  } catch (error) {
    context.log.error("Availability error", error);

    context.res = {
      status: error.statusCode || 400,
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        message: error.message || "Invalid request"
      }
    };
  }
};
