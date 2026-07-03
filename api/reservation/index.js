const ReservationService = require("../services/ReservationService");
const Reservation = require("../models/Reservation");

module.exports = async function (context, req) {
  let reservation = null;

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

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      const typeError = new Error("Request body must be a JSON object");
      typeError.statusCode = 400;
      throw typeError;
    }

    reservation = new Reservation(payload);

    const result = await ReservationService.createReservation(reservation);

    context.log("Reservation accepted", { reservationId: result.reservationId });

    context.res = {
      status: 200,
      headers: {
        "Content-Type": "application/json"
      },
      body: result
    };
  } catch (error) {
    context.log.error("Reservation error", {
      reservationId: reservation && reservation.id ? reservation.id : undefined,
      message: error.message,
      code: error.code
    });

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
