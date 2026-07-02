const AvailabilityService = require("../services/AvailabilityService");

module.exports = async function (context, req) {
  try {
    const from = req.query && req.query.from;
    const to = req.query && req.query.to;

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
