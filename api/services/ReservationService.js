const Reservation = require("../models/Reservation");
const crypto = require("crypto");
const { Buffer } = require("buffer");
const AvailabilityService = require("./AvailabilityService");
const ConfigService = require("./ConfigService");
const ConfigurationService = require("./ConfigurationService");
const MailService = require("./MailService");
const StripeService = require("./StripeService");
const ReservationRepository = require("../repositories/ReservationRepository");
const Lifecycle = require("./ReservationLifecycleService");
const TimeService = require("./ReservationTimeService");
const InventoryLeaseRepository = require("../repositories/InventoryLeaseRepository");
const ReservationIdempotencyRepository = require("../repositories/ReservationIdempotencyRepository");
const MarketingContactRepository = require("../repositories/MarketingContactRepository");

const defaultDependencies = {
  AvailabilityService,
  ConfigService,
  ConfigurationService,
  MailService,
  StripeService,
  ReservationRepository,
  InventoryLeaseRepository,
  ReservationIdempotencyRepository,
  MarketingContactRepository,
  TimeService,
  now: function now() {
    return new Date();
  }
};

const RESERVATION_STATUS = Lifecycle.RESERVATION_STATUS;
const MAX_RESERVATION_DAYS = 366;
const DEFAULT_RESERVATION_HORIZON_MONTHS = 6;
const RESERVATION_TIMEZONE = "Europe/Warsaw";
const MAX_EMAIL_LENGTH = 254;
const MAX_NOTES_LENGTH = 2000;
const MAX_PICKUP_POINT_LENGTH = 200;
const MAX_RESERVATION_ID_LENGTH = 128;
const MAX_CANCELLATION_TOKEN_LENGTH = 2048;
const LEGAL_DOCUMENTS = {
  termsVersion: "1.0",
  privacyVersion: "1.0",
  effectiveDate: "2026-08-17"
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

function serverError(message, code, details) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code || "ServiceUnavailable";
  if (details) {
    error.details = details;
  }
  return error;
}

function isProductionEnvironment() {
  return process.env.NODE_ENV === "production" || process.env.SKUCHA_ENV === "production";
}

function normalizeIdempotencyKey(value) {
  const key = String(value || "").trim();

  if (!key) {
    return "";
  }

  const hasControlCharacter = key.split("").some(function (character) {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });

  if (key.length < 8 || key.length > 200 || hasControlCharacter) {
    throw badRequest("Idempotency-Key must be between 8 and 200 characters");
  }

  return key;
}

function reservationFingerprint(reservation) {
  const normalized = {
    firstName: reservation.firstName,
    lastName: reservation.lastName,
    fullName: reservation.fullName,
    email: reservation.email,
    phone: reservation.phone,
    dateFrom: reservation.dateFrom,
    dateTo: reservation.dateTo,
    padsCount: reservation.padsCount,
    deliveryMethod: reservation.deliveryMethod,
    pickupPoint: reservation.pickupPoint,
    notes: reservation.notes,
    acceptTerms: reservation.acceptTerms,
    acceptPrivacy: reservation.acceptPrivacy,
    earlyStartRequested: reservation.earlyStartRequested,
    marketingEmail: reservation.marketingEmail
  };

  return crypto.createHash("sha256").update(JSON.stringify(normalized), "utf8").digest("hex");
}

function validateReservation(reservation, config, now) {
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

  if (reservation.email.length > MAX_EMAIL_LENGTH) {
    throw badRequest("email is too long");
  }

  if (!reservation.phone) {
    throw badRequest("phone is required");
  }

  var normalizedPhone = reservation.phone.replace(/[^\d+]/g, "");
  if (normalizedPhone.charAt(0) !== "+") {
    normalizedPhone = "+48" + normalizedPhone;
  }
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

  const fromDate = parseIsoDate(reservation.dateFrom);
  const toDate = parseIsoDate(reservation.dateTo);
  if (fromDate.getTime() > toDate.getTime()) {
    throw badRequest("dateTo must be on or after dateFrom");
  }

  if (countDaysInRange(reservation.dateFrom, reservation.dateTo) > MAX_RESERVATION_DAYS) {
    throw badRequest("Reservation date range is too long");
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

  if (reservation.notes.length > MAX_NOTES_LENGTH) {
    throw badRequest("notes is too long");
  }

  if (reservation.pickupPoint.length > MAX_PICKUP_POINT_LENGTH) {
    throw badRequest("pickupPoint is too long");
  }

  if (!reservation.acceptTerms) {
    throw badRequest("acceptTerms is required");
  }

  if (!reservation.acceptPrivacy) {
    throw badRequest("acceptPrivacy is required");
  }

  const todayValue = TimeService.getCalendarDate(now || new Date(), RESERVATION_TIMEZONE);
  const today = parseIsoDate(todayValue);
  const startDate = fromDate;
  const horizonMonths = Number(config.availability && config.availability.horizonMonths);
  const allowedThrough = TimeService.addCalendarMonths(
    todayValue,
    Number.isInteger(horizonMonths) && horizonMonths >= 0
      ? horizonMonths
      : DEFAULT_RESERVATION_HORIZON_MONTHS
  );

  if (startDate.getTime() < today.getTime()) {
    throw badRequest("dateFrom cannot be in the past");
  }

  if (toDate.getTime() > parseIsoDate(allowedThrough).getTime()) {
    throw badRequest("Reservation date is outside the booking horizon");
  }

  const earlyStartDeadline = new Date(today);
  earlyStartDeadline.setUTCDate(earlyStartDeadline.getUTCDate() + 14);

  if (startDate.getTime() < earlyStartDeadline.getTime() && !reservation.earlyStartRequested) {
    throw badRequest("earlyStartRequested is required for reservations starting within 14 days");
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
  return TimeService.parseDateOnlyAsUtc(value);
}

function countDaysInRange(fromDate, toDateValue) {
  const from = parseIsoDate(fromDate);
  const to = parseIsoDate(toDateValue);
  const cursor = new Date(from);
  let days = 0;

  while (cursor.getTime() <= to.getTime()) {
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

  let totalForSinglePad = 0;
  const cursor = new Date(from);

  while (cursor.getTime() <= to.getTime()) {
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

    const baseUrl = String(
      typeof dependencies.ConfigurationService.getReservationPublicBaseUrl === "function"
        ? dependencies.ConfigurationService.getReservationPublicBaseUrl()
        : ""
    ).replace(/\/$/, "");
    const cutoffHours = typeof dependencies.ConfigurationService.getReservationCancellationCutoffHours === "function"
      ? Number(dependencies.ConfigurationService.getReservationCancellationCutoffHours())
      : 24;
    const timezone = typeof dependencies.ConfigurationService.getReservationTimezone === "function"
      ? dependencies.ConfigurationService.getReservationTimezone()
      : "Europe/Warsaw";

    return {
      secret,
      baseUrl: baseUrl || "https://www.skucha.co",
      cutoffHours: Number.isFinite(cutoffHours) && cutoffHours >= 0 ? cutoffHours : 24,
      timezone: timezone || "Europe/Warsaw"
    };
  }

  function currentTime() {
    const value = dependencies.now();
    return value instanceof Date ? value : new Date(value);
  }

  async function withInventoryLease(owner, work) {
    const leaseRepository = dependencies.InventoryLeaseRepository;
    const storageConfigured = typeof dependencies.ConfigurationService.getStorageConnectionString === "function"
      && dependencies.ConfigurationService.getStorageConnectionString();

    if (!storageConfigured || !leaseRepository || typeof leaseRepository.acquireLease !== "function") {
      return work();
    }

    const ttl = typeof dependencies.ConfigurationService.getInventoryLeaseTtlMs === "function"
      ? dependencies.ConfigurationService.getInventoryLeaseTtlMs()
      : 30000;
    const lease = await leaseRepository.acquireLease(owner, ttl);

    try {
      return await work();
    } finally {
      try {
        await leaseRepository.releaseLease(lease);
      } catch (_error) {
        // The lease expires automatically if release fails.
      }
    }
  }

  function signCancellationToken(encodedPayload, secret) {
    return crypto
      .createHmac("sha256", secret)
      .update(encodedPayload)
      .digest("hex");
  }

  function generateCancellationToken(reservationId, sessionId, dateFrom) {
    const settings = getCancellationSettings();
    const deadline = dependencies.TimeService.getCancellationDeadline(
      dateFrom,
      settings.cutoffHours,
      settings.timezone
    );
    const expiresAtUnix = Math.ceil(deadline.getTime() / 1000);
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

    if (!payload.exp || Number(payload.exp) < Math.floor(currentTime().getTime() / 1000)) {
      throw gone("Cancellation token expired", "TokenExpired");
    }

    return payload;
  }

  function buildCancellationUrl(reservationId, token) {
    const settings = getCancellationSettings();
    return settings.baseUrl
      + "/reservation-cancel.html?reservation_id=" + encodeURIComponent(reservationId)
      + "&token=" + encodeURIComponent(token);
  }

  async function createReservation(reservation, options) {
    const requestOptions = options || {};
    const production = isProductionEnvironment();
    if (production && typeof dependencies.ConfigurationService.getRuntimeConfigurationIssues === "function") {
      const issues = dependencies.ConfigurationService.getRuntimeConfigurationIssues({ production: true });
      if (issues.length) {
        throw serverError("Runtime configuration is incomplete", "RuntimeConfigurationInvalid", { issues });
      }
    }

    if (!(reservation instanceof Reservation)) {
      reservation = new Reservation(reservation || {});
    }

    const config = await dependencies.ConfigService.loadConfig();
    const requestNow = currentTime();

    validateReservation(reservation, config, requestNow);

    const idempotencyKey = normalizeIdempotencyKey(requestOptions.idempotencyKey);

    if (production && !idempotencyKey) {
      throw badRequest("Idempotency-Key header is required");
    }

    let idempotencyClaim = null;
    const hasStorage = typeof dependencies.ConfigurationService.getStorageConnectionString === "function"
      && dependencies.ConfigurationService.getStorageConnectionString();

    if (idempotencyKey && dependencies.ReservationIdempotencyRepository
      && typeof dependencies.ReservationIdempotencyRepository.claimRequest === "function") {
      if (!hasStorage) {
        if (production) {
          throw serverError("Reservation idempotency storage is not configured", "IdempotencyNotConfigured");
        }
      } else {
        idempotencyClaim = await dependencies.ReservationIdempotencyRepository.claimRequest(
          idempotencyKey,
          reservationFingerprint(reservation),
          requestNow
        );

        if (idempotencyClaim && idempotencyClaim.completed) {
          return idempotencyClaim.response;
        }
      }
    } else if (production && idempotencyKey) {
      throw serverError("Reservation idempotency storage is not available", "IdempotencyNotConfigured");
    }

    try {
      const result = await createReservationCore(reservation, config, requestOptions);

      if (idempotencyClaim) {
        await dependencies.ReservationIdempotencyRepository.completeRequest(
          idempotencyKey,
          result,
          { expectedEtag: idempotencyClaim.etag }
        );
      }

      return result;
    } catch (error) {
      if (idempotencyClaim && typeof dependencies.ReservationIdempotencyRepository.failRequest === "function") {
        try {
          await dependencies.ReservationIdempotencyRepository.failRequest(idempotencyKey, error);
        } catch (_failureError) {
          // Preserve the original reservation error; the idempotency record remains auditable.
        }
      }

      throw error;
    }
  }

  async function createReservationCore(reservation, config, requestOptions) {
    const consentRecordedAt = currentTime().toISOString();
    let savedReservation;
    await withInventoryLease("reservation-create", async function () {
      const availability = await dependencies.AvailabilityService.getAvailability({
        from: reservation.dateFrom,
        to: reservation.dateTo
      });

      if (!availability.available || availability.remainingPads < reservation.padsCount) {
        throw badRequest("Requested number of pads is not available for selected dates");
      }

      savedReservation = await dependencies.ReservationRepository.saveReservation({
        fullName: reservation.fullName,
        email: reservation.email,
        phone: reservation.phone,
        dateFrom: reservation.dateFrom,
        dateTo: reservation.dateTo,
        padsCount: reservation.padsCount,
        notes: reservation.notes,
        deliveryMethod: reservation.deliveryMethod,
        pickupPoint: reservation.pickupPoint,
        termsVersion: LEGAL_DOCUMENTS.termsVersion,
        privacyVersion: LEGAL_DOCUMENTS.privacyVersion,
        termsAcceptedAt: consentRecordedAt,
        privacyAcceptedAt: consentRecordedAt,
        earlyStartRequested: reservation.earlyStartRequested,
        marketingEmail: reservation.marketingEmail,
        consentRecordedAt: consentRecordedAt,
        consentIp: String(requestOptions.clientIp || "").slice(0, 128),
        consentUserAgent: String(requestOptions.userAgent || "").slice(0, 512),
        status: RESERVATION_STATUS.PENDING
      });
    });

    if (reservation.marketingEmail) {
      await dependencies.MarketingContactRepository.upsertContact({
        email: reservation.email,
        firstName: reservation.firstName,
        lastName: reservation.lastName,
        reservationId: savedReservation.id,
        consentRecordedAt: consentRecordedAt,
        consentIp: requestOptions.clientIp,
        consentUserAgent: requestOptions.userAgent
      });
    }

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

    const cancellationToken = generateCancellationToken(
      savedReservation.id,
      payment.sessionId,
      reservation.dateFrom
    );
    const cancellationUrl = buildCancellationUrl(savedReservation.id, cancellationToken.token);
    const pendingExpiryHours = typeof dependencies.ConfigurationService.getReservationPendingExpiryHours === "function"
      ? dependencies.ConfigurationService.getReservationPendingExpiryHours()
      : 2;
    const pendingExpiresAt = savedReservation.createdAt
      ? dependencies.TimeService.getPendingExpiration(savedReservation.createdAt, pendingExpiryHours).toISOString()
      : "";

    await dependencies.ReservationRepository.attachPayment(savedReservation.id, {
      sessionId: payment.sessionId,
      paymentStatus: payment.paymentStatus,
      paymentUrl: payment.url,
      amountInMinorUnit: amountInMinorUnit,
      currency: currency,
      cancellationUrl: cancellationUrl,
      cancellationExpiresAt: cancellationToken.expiresAt,
      pendingExpiresAt: pendingExpiresAt
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

    if (!/^[A-Za-z0-9_-]{1,128}$/.test(reservationId)
      || reservationId.length > MAX_RESERVATION_ID_LENGTH) {
      throw badRequest("reservationId format is invalid");
    }

    if (token.length > MAX_CANCELLATION_TOKEN_LENGTH) {
      throw badRequest("token is too long");
    }

    const reservation = await dependencies.ReservationRepository.getReservation(reservationId);

    if (!reservation) {
      throw notFound("Reservation not found", "NotFound");
    }

    const tokenPayload = verifyCancellationToken(token, reservation.id, reservation.paymentSessionId);

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

    if (reservation.status === RESERVATION_STATUS.EXPIRED) {
      throw conflict("Expired reservations cannot be cancelled", "AlreadyExpired");
    }

    if (reservation.status === RESERVATION_STATUS.IN_PROGRESS) {
      throw conflict("Collected reservations cannot be cancelled", "AlreadyCollected");
    }

    const settings = getCancellationSettings();
    const cancellationAllowed = dependencies.TimeService.isCancellationAllowed(
      reservation.fromDate,
      settings.cutoffHours,
      currentTime(),
      settings.timezone
    );

    if (!cancellationAllowed) {
      throw conflict(
        "Reservations can only be cancelled at least " + settings.cutoffHours + " hours before rental start",
        "CancellationWindowClosed"
      );
    }

    if (!tokenPayload) {
      throw badRequest("Invalid cancellation token");
    }

    let refund = null;
    let paymentStatus = reservation.paymentStatus || "";
    let cancellationReservation = reservation;

    if (["paid", "refundpending", "refundfailed"].indexOf(String(paymentStatus).toLowerCase()) !== -1) {
      if (reservation.status !== RESERVATION_STATUS.CANCELLATION_PENDING) {
        Lifecycle.assertTransition(
          reservation.status,
          RESERVATION_STATUS.CANCELLATION_PENDING,
          Lifecycle.ACTOR.CUSTOMER
        );
        const claim = await dependencies.ReservationRepository.updateStatus(
          reservation.id,
          RESERVATION_STATUS.CANCELLATION_PENDING,
          {
            expectedStatus: reservation.status,
            expectedEtag: reservation.etag
          }
        );

        if (!claim) {
          throw notFound("Reservation not found while claiming cancellation", "NotFound");
        }

        cancellationReservation = {
          ...reservation,
          ...claim,
          status: RESERVATION_STATUS.CANCELLATION_PENDING
        };
      }

      try {
        refund = await dependencies.StripeService.refundCheckoutSessionPayment({
          sessionId: cancellationReservation.paymentSessionId,
          paymentIntentId: cancellationReservation.paymentIntentId,
          refundId: cancellationReservation.refundId,
          reservationId: cancellationReservation.id,
          idempotencyKey: "reservation-refund:" + cancellationReservation.id,
          reason: "requested_by_customer"
        });
      } catch (error) {
        try {
          await dependencies.ReservationRepository.attachPayment(
            cancellationReservation.id,
            {
              paymentStatus: "RefundFailed",
              refundRequestedAt: currentTime().toISOString()
            },
            {
              expectedStatus: RESERVATION_STATUS.CANCELLATION_PENDING,
              expectedEtag: cancellationReservation.etag
            }
          );
        } catch (_updateError) {
          // Preserve the Stripe error; reconciliation can retry the claimed reservation.
        }
        throw error;
      }

      paymentStatus = refund.status === "succeeded" ? "Refunded" : "RefundPending";
    } else if (!paymentStatus || ["unpaid", "pending", "expired"].indexOf(String(paymentStatus).toLowerCase()) !== -1) {
      paymentStatus = "Cancelled";
      Lifecycle.assertTransition(
        reservation.status,
        RESERVATION_STATUS.CANCELLED,
        Lifecycle.ACTOR.CUSTOMER
      );
    }

    const paymentUpdate = await dependencies.ReservationRepository.attachPayment(reservation.id, {
      sessionId: reservation.paymentSessionId,
      paymentStatus: paymentStatus,
      paymentUrl: reservation.paymentUrl,
      paymentIntentId: refund && refund.paymentIntentId,
      refundId: refund && refund.refundId,
      refundRequestedAt: refund ? currentTime().toISOString() : undefined,
      refundCompletedAt: refund && refund.status === "succeeded" ? currentTime().toISOString() : undefined
    }, {
      expectedStatus: cancellationReservation.status,
      expectedEtag: cancellationReservation.etag
    });

    if (!paymentUpdate) {
      throw notFound("Reservation not found while updating payment", "NotFound");
    }

    const statusUpdate = await dependencies.ReservationRepository.updateStatus(
      reservation.id,
      RESERVATION_STATUS.CANCELLED,
      {
        expectedStatus: cancellationReservation.status,
        expectedEtag: paymentUpdate.etag
      }
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
  createReservation: function createReservationProxy(reservation, options) {
    return activeService.createReservation(reservation, options);
  },
  cancelReservation: function cancelReservationProxy(payload) {
    return activeService.cancelReservation(payload);
  },
  createReservationService,
  __setDependencies,
  __resetDependencies
};
