const Reservation = require("../models/Reservation");
const AvailabilityService = require("./AvailabilityService");
const ConfigService = require("./ConfigService");
const MailService = require("./MailService");

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateReservation(reservation, config) {
  if (!reservation.firstName) {
    throw badRequest("firstName is required");
  }

  if (!reservation.lastName) {
    throw badRequest("lastName is required");
  }

  if (!reservation.email || !reservation.email.includes("@")) {
    throw badRequest("Valid email is required");
  }

  if (!reservation.phone) {
    throw badRequest("phone is required");
  }

  if (!reservation.dateFrom || !reservation.dateTo) {
    throw badRequest("dateFrom and dateTo are required");
  }

  if (!Number.isInteger(reservation.padsCount) || reservation.padsCount < 1) {
    throw badRequest("padsCount must be a positive integer");
  }

  if (reservation.deliveryMethod !== "pickup" && reservation.deliveryMethod !== "delivery") {
    throw badRequest("deliveryMethod must be pickup or delivery");
  }

  const enabledPickupNames = (config.pickupPoints || [])
    .filter(function (point) {
      return point && point.enabled !== false;
    })
    .map(function (point) {
      return point.name;
    });

  if (reservation.deliveryMethod === "pickup") {
    if (!reservation.pickupPoint) {
      throw badRequest("pickupPoint is required for pickup reservations");
    }

    if (enabledPickupNames.indexOf(reservation.pickupPoint) === -1) {
      throw badRequest("pickupPoint is not available");
    }
  }
}

async function createReservation(payload) {
  const reservation = new Reservation(payload);
  const config = await ConfigService.loadConfig();

  validateReservation(reservation, config);

  const availability = await AvailabilityService.getAvailability({
    from: reservation.dateFrom,
    to: reservation.dateTo
  });

  if (!availability.available || availability.remainingPads < reservation.padsCount) {
    throw badRequest("Requested number of pads is not available for selected dates");
  }

  AvailabilityService.addReservationToAvailabilityStore(reservation);
  const mailResult = await MailService.sendReservationNotification(reservation);

  return {
    message: "Reservation accepted",
    reservation: {
      firstName: reservation.firstName,
      lastName: reservation.lastName,
      fullName: reservation.fullName,
      email: reservation.email,
      phone: reservation.phone,
      dateFrom: reservation.dateFrom,
      dateTo: reservation.dateTo,
      padsCount: reservation.padsCount,
      deliveryMethod: reservation.deliveryMethod,
      pickupPoint: reservation.pickupPoint
    },
    mail: mailResult
  };
}

module.exports = {
  createReservation
};
