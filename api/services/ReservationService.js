const Reservation = require("../models/Reservation");
const AvailabilityService = require("./AvailabilityService");
const ConfigService = require("./ConfigService");
const MailService = require("./MailService");
const ReservationRepository = require("../repositories/ReservationRepository");

const RESERVATION_STATUS = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  CANCELLED: "Cancelled",
  COMPLETED: "Completed"
};

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function validateReservation(reservation, config) {
  var namePattern = /^[A-Za-zÀ-ž\-\s']{2,60}$/;
  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  var datePattern = /^\d{4}-\d{2}-\d{2}$/;

  if (!reservation.firstName) {
    throw badRequest("firstName is required");
  }

  if (!reservation.lastName) {
    throw badRequest("lastName is required");
  }

  if (!namePattern.test(reservation.firstName)) {
    throw badRequest("firstName format is invalid");
  }

  if (!namePattern.test(reservation.lastName)) {
    throw badRequest("lastName format is invalid");
  }

  if (!reservation.email || !emailPattern.test(reservation.email)) {
    throw badRequest("Valid email is required");
  }

  if (!reservation.phone) {
    throw badRequest("phone is required");
  }

  var normalizedPhone = reservation.phone.replace(/[^\d+]/g, "");
  if (!/^\+?[0-9]{9,15}$/.test(normalizedPhone)) {
    throw badRequest("phone format is invalid");
  }
  reservation.phone = normalizedPhone;

  if (!reservation.dateFrom || !reservation.dateTo) {
    throw badRequest("dateFrom and dateTo are required");
  }

  if (!datePattern.test(reservation.dateFrom) || !datePattern.test(reservation.dateTo)) {
    throw badRequest("dateFrom and dateTo must be in YYYY-MM-DD format");
  }

  if (!Number.isInteger(reservation.padsCount) || reservation.padsCount < 1) {
    throw badRequest("padsCount must be a positive integer");
  }

  if (reservation.padsCount > 8) {
    throw badRequest("padsCount is too high");
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

async function createReservation(reservation) {
  if (!(reservation instanceof Reservation)) {
    reservation = new Reservation(reservation || {});
  }

  const config = await ConfigService.loadConfig();

  validateReservation(reservation, config);

  const availability = await AvailabilityService.getAvailability({
    from: reservation.dateFrom,
    to: reservation.dateTo
  });

  if (!availability.available || availability.remainingPads < reservation.padsCount) {
    throw badRequest("Requested number of pads is not available for selected dates");
  }

  const savedReservation = await ReservationRepository.saveReservation({
    fullName: reservation.fullName,
    email: reservation.email,
    phone: reservation.phone,
    dateFrom: reservation.dateFrom,
    dateTo: reservation.dateTo,
    padsCount: reservation.padsCount,
    notes: reservation.notes,
    status: RESERVATION_STATUS.PENDING
  });

  const mailResult = await MailService.sendReservationNotification({
    ...reservation,
    id: savedReservation.id,
    status: savedReservation.status
  });

  return {
    message: "Reservation accepted",
    reservationId: savedReservation.id,
    reservation: {
      id: savedReservation.id,
      status: savedReservation.status,
      fullName: savedReservation.customerName,
      email: savedReservation.customerEmail,
      phone: savedReservation.customerPhone,
      dateFrom: savedReservation.fromDate,
      dateTo: savedReservation.toDate,
      padsCount: savedReservation.pads,
      deliveryMethod: reservation.deliveryMethod,
      pickupPoint: reservation.pickupPoint,
      createdAt: savedReservation.createdAt
    },
    mail: mailResult
  };
}

module.exports = {
  RESERVATION_STATUS,
  createReservation
};
