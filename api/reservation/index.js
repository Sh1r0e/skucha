const ReservationService = require("../services/ReservationService");

module.exports = async function (context, req) {
  try {
    const request = req || context.req || {};
    let payload = request.body || {};

    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload || "{}");
      } catch (error) {
        const parseError = new Error("Request body must be valid JSON");
        parseError.statusCode = 400;
        throw parseError;
      }
    }

    const result = await ReservationService.createReservation(payload);

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: result
    };
  } catch (error) {
    context.log.error("Reservation error", error);

    context.res = {
      status: error.statusCode || 500,
      headers: {
        "Content-Type": "application/json"
      },
      body: {
        message: error.message || "Reservation failed"
      }
    };
  }
};
