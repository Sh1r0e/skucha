const ReservationService = require("../services/ReservationService");

module.exports = async function (context, req) {
  try {
    const payload = req.body || {};
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
