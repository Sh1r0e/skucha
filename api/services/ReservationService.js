const Reservation = require("../models/Reservation");
const crypto = require("crypto");
const { Buffer } = require("buffer");
const AvailabilityService = require("./AvailabilityService");
const ConfigService = require("./ConfigService");
const ConfigurationService = require("./ConfigurationService");
const MailService = require("./MailService");
const StripeService = require("./StripeService");
const ReservationRepository = require("../repositories/ReservationRepository");

const defaultDependencies = {
  AvailabilityService,
  ConfigService,
  ConfigurationService,
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

function conflict(message, code) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code || "Conflict";
  return error;
}

function notFound(message, code) {
  const error = new Error(message);
  error.statusCode = 404;
  error.code = code || "NotFound";
  return error;
}

function gone(message, code) {
  const error = new Error(message);
  error.statusCode = 410;
  error.code = code || "TokenExpired";
  return error;
}

function serverError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code || "ServiceUnavailable";
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

  function getCancellationSettings() {
    const secret = dependencies.ConfigurationService.getReservationCancelTokenSecret();

    if (!secret) {
      throw serverError("Reservation cancellation token secret is not configured", "CancellationNotConfigured");
    }

    const baseUrl = String(dependencies.ConfigurationService.getReservationPublicBaseUrl() || "").replace(/\/$/, "");
    const ttlHours = Number(dependencies.ConfigurationService.getReservationCancelTokenTtlHours() || 72);

    return {
      secret,
      baseUrl: baseUrl || "https://www.skucha.co",
      ttlHours: Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : 72
    };
  }

  function signCancellationToken(encodedPayload, secret) {
    return crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest("hex");
  }

  function generateCancellationToken(reservationId, sessionId) {
    const settings = getCancellationSettings();
    const expiresAtUnix = Math.floor(Date.now() / 1000) + (settings.ttlHours * 60 * 60);
    const payload = {
      reservationId: String(reservationId || ""),
      sessionId: String(sessionId || ""),
      exp: expiresAtUnix
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = signCancellationToken(encodedPayload, settings.secret);

    return {
      token: encodedPayload + "." + signature,
      expiresAt: new Date(expiresAtUnix * 1000).toISOString()
    };
  }

  function verifyCancellationToken(token, reservationId, paymentSessionId) {
    const settings = getCancellationSettings();
    const rawToken = String(token || "");
    const parts = rawToken.split(".");

    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw badRequest("Invalid cancellation token format");
    }

    const encodedPayload = parts[0];
    const providedSignature = parts[1];
    const expectedSignature = signCancellationToken(encodedPayload, settings.secret);
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (providedBuffer.length !== expectedBuffer.length
      || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
      throw badRequest("Invalid cancellation token signature");
    }

    let payload;

    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    } catch (_error) {
      throw badRequest("Invalid cancellation token payload");
    }

    if (!payload || payload.reservationId !== reservationId) {
      throw badRequest("Cancellation token does not match reservation");
    }

    if (String(payload.sessionId || "") !== String(paymentSessionId || "")) {
      throw badRequest("Cancellation token does not match payment session");
    }

    if (!payload.exp || Number(payload.exp) < Math.floor(Date.now() / 1000)) {
      throw gone("Cancellation token expired", "TokenExpired");
    }

    return payload;
  }

  function buildCancellationUrl(reservationId, token) {
    const settings = getCancellationSettings();
    return settings.baseUrl
      + "/api/reservation/cancel?reservation_id=" + encodeURIComponent(reservationId)
      + "&token=" + encodeURIComponent(token);
  }

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
      deliveryMethod: reservation.deliveryMethod,
      pickupPoint: reservation.pickupPoint,
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

    const cancellationToken = generateCancellationToken(savedReservation.id, payment.sessionId);
    const cancellationUrl = buildCancellationUrl(savedReservation.id, cancellationToken.token);

    await dependencies.ReservationRepository.attachPayment(savedReservation.id, {
      sessionId: payment.sessionId,
      paymentStatus: payment.paymentStatus,
      paymentUrl: payment.url,
      amountInMinorUnit: amountInMinorUnit,
      currency: currency,
      cancellationUrl: cancellationUrl,
      cancellationExpiresAt: cancellationToken.expiresAt
    });

    const mailResult = await dependencies.MailService.sendReservationNotification({
      ...reservation,
      id: savedReservation.id,
      status: savedReservation.status,
      payment: {
        sessionId: payment.sessionId,
        checkoutUrl: payment.url,
        status: payment.paymentStatus,
        amount: amountInMajorUnit,
        currency: currency.toUpperCase()
      },
      amount: amountInMajorUnit,
      currency: currency.toUpperCase(),
      cancelUrl: cancellationUrl,
      cancelExpiresAt: cancellationToken.expiresAt
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
        notes: reservation.notes,
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
      cancellation: {
        url: cancellationUrl,
        expiresAt: cancellationToken.expiresAt
      },
      mail: mailResult
    };
  }

  async function cancelReservation(payload) {
    const reservationId = String((payload && payload.reservationId) || "").trim();
    const token = String((payload && payload.token) || "").trim();

    if (!reservationId) {
      throw badRequest("reservationId is required");
    }

    if (!token) {
      throw badRequest("token is required");
    }

    const reservation = await dependencies.ReservationRepository.getReservation(reservationId);

    if (!reservation) {
      throw notFound("Reservation not found", "NotFound");
    }

    if (reservation.status === RESERVATION_STATUS.CANCELLED) {
      return {
        reservationId: reservation.id,
        status: reservation.status,
        paymentStatus: reservation.paymentStatus,
        refund: null,
        alreadyCancelled: true
      };
    }

    if (reservation.status === RESERVATION_STATUS.COMPLETED) {
      throw conflict("Completed reservations cannot be cancelled", "AlreadyCompleted");
    }

    verifyCancellationToken(token, reservation.id, reservation.paymentSessionId);

    let refund = null;
    let paymentStatus = reservation.paymentStatus || "";

    if (String(paymentStatus).toLowerCase() === "paid") {
      refund = await dependencies.StripeService.refundCheckoutSessionPayment({
        sessionId: reservation.paymentSessionId,
        reservationId: reservation.id,
        reason: "requested_by_customer"
      });

      paymentStatus = refund.status === "succeeded" ? "Refunded" : "RefundPending";
    } else if (!paymentStatus || ["unpaid", "pending", "expired"].indexOf(String(paymentStatus).toLowerCase()) !== -1) {
      paymentStatus = "Cancelled";
    }

    const paymentUpdate = await dependencies.ReservationRepository.attachPayment(reservation.id, {
      sessionId: reservation.paymentSessionId,
      paymentStatus: paymentStatus,
      paymentUrl: reservation.paymentUrl
    });

    if (!paymentUpdate) {
      throw notFound("Reservation not found while updating payment", "NotFound");
    }

    const statusUpdate = await dependencies.ReservationRepository.updateStatus(
      reservation.id,
      RESERVATION_STATUS.CANCELLED
    );

    if (!statusUpdate) {
      throw notFound("Reservation not found while updating status", "NotFound");
    }

    const cancellationResult = {
      reservationId: reservation.id,
      status: RESERVATION_STATUS.CANCELLED,
      paymentStatus: paymentStatus,
      refund: refund,
      alreadyCancelled: false
    };

    const mailResult = await dependencies.MailService.sendCancellationNotification(reservation, cancellationResult);

    return {
      ...cancellationResult,
      mail: mailResult
    };
  }

  return {
    createReservation,
    cancelReservation
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
  cancelReservation: function cancelReservationProxy(payload) {
    return activeService.cancelReservation(payload);
  },
  createReservationService,
  __setDependencies,
  __resetDependencies
};
