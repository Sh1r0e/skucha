const Reservation = require("../models/Reservation");
const AvailabilityService = require("./AvailabilityService");
const ConfigService = require("./ConfigService");
const MailService = require("./MailService");
const StripeService = require("./StripeService");
const ReservationRepository = require("../repositories/ReservationRepository");

const defaultDependencies = {
  AvailabilityService,
  ConfigService,
  MailService,
  StripeService,
  ReservationRepository
};

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

function parseIsoDate(value) {
  const parts = String(value || "").split("-").map(Number);
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function countDaysInRange(fromDate, toDateValue) {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDateValue);
  let start = from;
  let end = to;

  if (start.getTime() > end.getTime()) {
    start = to;
    end = from;
  }

  const cursor = new Date(start);
  let days = 0;

  while (cursor.getTime() <= end.getTime()) {
    days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}

function calculateReservationAmountInMajorUnit(reservation, pricing) {
  const weekdayRate = Number((pricing && pricing.weekday) || 0);
  const weekendRate = Number((pricing && pricing.weekend) || 0);
  const from = parseIsoDate(reservation.dateFrom);
  const to = parseIsoDate(reservation.dateTo);
  let start = from;
  let end = to;

  if (start.getTime() > end.getTime()) {
    start = to;
    end = from;
  }

  let totalForSinglePad = 0;
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const day = cursor.getDay();
    totalForSinglePad += day === 0 || day === 6 ? weekendRate : weekdayRate;
    cursor.setDate(cursor.getDate() + 1);
  }

  return totalForSinglePad * reservation.padsCount;
}

function createReservationService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  async function createReservation(reservation) {
    if (!(reservation instanceof Reservation)) {
      reservation = new Reservation(reservation || {});
    }

    const config = await dependencies.ConfigService.loadConfig();

    validateReservation(reservation, config);

    const availability = await dependencies.AvailabilityService.getAvailability({
      from: reservation.dateFrom,
      to: reservation.dateTo
    });

    if (!availability.available || availability.remainingPads < reservation.padsCount) {
      throw badRequest("Requested number of pads is not available for selected dates");
    }

    const savedReservation = await dependencies.ReservationRepository.saveReservation({
      fullName: reservation.fullName,
      email: reservation.email,
      phone: reservation.phone,
      dateFrom: reservation.dateFrom,
      dateTo: reservation.dateTo,
      padsCount: reservation.padsCount,
      notes: reservation.notes,
      status: RESERVATION_STATUS.PENDING
    });

    const currency = String((config.pricing && config.pricing.currency) || "PLN").toLowerCase();
    const amountInMajorUnit = calculateReservationAmountInMajorUnit(reservation, config.pricing);
    const amountInMinorUnit = Math.round(amountInMajorUnit * 100);
    const daysCount = countDaysInRange(reservation.dateFrom, reservation.dateTo);

    const payment = await dependencies.StripeService.createCheckoutSession({
      reservationId: savedReservation.id,
      customerEmail: reservation.email,
      dateFrom: reservation.dateFrom,
      dateTo: reservation.dateTo,
      padsCount: reservation.padsCount,
      amountInMinorUnit: amountInMinorUnit,
      currency: currency,
      productName: "Skucha - crash pad reservation",
      description: daysCount + " day(s), " + reservation.padsCount + " pad(s)"
    });

    await dependencies.ReservationRepository.attachPayment(savedReservation.id, {
      sessionId: payment.sessionId,
      paymentStatus: payment.paymentStatus,
      paymentUrl: payment.url
    });

    const mailResult = await dependencies.MailService.sendReservationNotification({
      ...reservation,
      id: savedReservation.id,
      status: savedReservation.status,
      payment: {
        sessionId: payment.sessionId,
        checkoutUrl: payment.url,
        amount: amountInMajorUnit,
        currency: currency.toUpperCase()
      }
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
      payment: {
        provider: "stripe",
        status: payment.paymentStatus,
        sessionId: payment.sessionId,
        checkoutUrl: payment.url,
        amount: amountInMajorUnit,
        amountInMinorUnit: amountInMinorUnit,
        currency: currency.toUpperCase()
      },
      mail: mailResult
    };
  }

  return {
    createReservation
  };
}

let activeService = createReservationService();

function __setDependencies(overrides) {
  activeService = createReservationService(overrides);
}

function __resetDependencies() {
  activeService = createReservationService();
}

module.exports = {
  RESERVATION_STATUS,
  createReservation: function createReservationProxy(reservation) {
    return activeService.createReservation(reservation);
  },
  createReservationService,
  __setDependencies,
  __resetDependencies
};
