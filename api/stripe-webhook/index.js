const StripeService = require("../services/StripeService");
const ReservationRepository = require("../repositories/ReservationRepository");
const StripeEventRepository = require("../repositories/StripeEventRepository");
const MailService = require("../services/MailService");
const Lifecycle = require("../services/ReservationLifecycleService");
const { rejectDuringMaintenance } = require("../helpers/maintenance");
const { jsonResponse, rejectNonJsonRequest } = require("../helpers/http");

// Maps Stripe checkout.session payment_status to internal reservation payment status.
const PAYMENT_STATUS_MAP = {
  paid: "Paid",
  unpaid: "Unpaid",
  no_payment_required: "NoPaymentRequired"
};

// Maps internal payment status to reservation booking status.
const RESERVATION_STATUS_ON_PAYMENT = {
  Paid: "Confirmed",
  Unpaid: "Pending",
  NoPaymentRequired: "Confirmed"
};

function createWebhookHandlingError(message, code) {
  const error = new Error(message);
  error.code = code || "WebhookEventHandlingFailed";
  return error;
}

function createWebhookHandler(customDependencies) {
  const dependencies = {
    StripeService,
    ReservationRepository,
    MailService,
    StripeEventRepository,
    ...(customDependencies || {})
  };

  function getHeaderValue(headers, name) {
    if (!headers || !name) {
      return "";
    }

    const direct = headers[name];
    if (direct) {
      return direct;
    }

    const target = String(name).toLowerCase();
    const keys = Object.keys(headers);

    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (String(key).toLowerCase() === target) {
        return headers[key] || "";
      }
    }

    return "";
  }

  return async function stripeWebhookHandler(context, req) {
    if (rejectDuringMaintenance(context)) {
      return;
    }

    const request = req || context.req || {};

    if (rejectNonJsonRequest(context, request)) {
      return;
    }

    // Stripe signature verification requires the original body payload bytes.
    // Depending on runtime shape we may receive it as req.rawBody or as a
    // plain string in req.body.
    const rawBody = request.rawBody
      || (typeof request.body === "string" ? request.body : "");
    const signature = getHeaderValue(request.headers, "stripe-signature");

    if (!rawBody) {
      context.log.error("Stripe webhook: raw body is missing");
      context.res = jsonResponse(400, { error: "Raw body unavailable" });
      return;
    }

    if (!signature) {
      context.log.error("Stripe webhook: missing stripe-signature header");
      context.res = jsonResponse(400, { error: "Missing stripe-signature" });
      return;
    }

    let event;

    try {
      event = dependencies.StripeService.verifyWebhookSignature(rawBody, signature);
    } catch (error) {
      context.log.error("Stripe webhook: signature verification failed", {
        code: error.code,
        details: error.details
      });
      context.res = jsonResponse(error.statusCode || 400, { error: error.message, code: error.code });
      return;
    }

    context.log("Stripe webhook received", { type: event.type, id: event.id });

    let eventClaim;
    try {
      eventClaim = await dependencies.StripeEventRepository.claimEvent(event);
    } catch (error) {
      context.log.error("Stripe webhook: unable to claim event", {
        eventId: event.id,
        message: error.message,
        code: error.code
      });
      context.res = jsonResponse(error.statusCode || 503, {
        error: "Event claim failed",
        code: error.code || "EventClaimFailed"
      });
      return;
    }

    if (eventClaim && eventClaim.duplicate) {
      context.log("Stripe webhook: duplicate event ignored", { eventId: event.id });
      context.res = jsonResponse(200, { received: true, duplicate: true, type: event.type });
      return;
    }

    try {
      await handleEvent(context, event, dependencies);
    } catch (error) {
      try {
        await dependencies.StripeEventRepository.markEvent(event.id, "Retryable", { error: error.message });
      } catch (markError) {
        context.log.error("Stripe webhook: unable to mark retryable event", {
          eventId: event.id,
          message: markError.message,
          code: markError.code
        });
      }
      // Return 500 so Stripe retries the delivery.
      context.log.error("Stripe webhook: event handling failed", {
        eventType: event.type,
        eventId: event.id,
        message: error.message,
        code: error.code
      });
      context.res = jsonResponse(500, { error: "Event handling failed", code: error.code || "InternalError" });
      return;
    }

    try {
      await dependencies.StripeEventRepository.markEvent(event.id, "Processed");
    } catch (error) {
      context.log.error("Stripe webhook: unable to mark event processed", {
        eventId: event.id,
        message: error.message,
        code: error.code
      });
      context.res = jsonResponse(error.statusCode || 503, {
        error: "Event completion tracking failed",
        code: error.code || "EventTrackingFailed"
      });
      return;
    }

    context.res = jsonResponse(200, { received: true, type: event.type });
  };
}

async function handleEvent(context, event, dependencies) {
  if (event.type === "checkout.session.completed") {
    await handleCheckoutSessionCompleted(context, event.data.object, dependencies);
    return;
  }

  if (event.type === "checkout.session.expired") {
    await handleCheckoutSessionExpired(context, event.data.object, dependencies);
    return;
  }

  // Unhandled event types — acknowledge without error so Stripe does not retry.
  context.log("Stripe webhook: unhandled event type, ignoring", { type: event.type });
}

async function handleCheckoutSessionCompleted(context, session, dependencies) {
  const reservationId = getReservationIdFromSession(session);

  if (!reservationId) {
    context.log.error("Stripe webhook: checkout.session.completed has no reservationId", { sessionId: session.id });
    return;
  }

  const stripePaymentStatus = session.payment_status || "unpaid";
  const internalPaymentStatus = PAYMENT_STATUS_MAP[stripePaymentStatus] || "Unpaid";
  const reservationStatus = RESERVATION_STATUS_ON_PAYMENT[internalPaymentStatus] || "Pending";

  const reservation = await dependencies.ReservationRepository.getReservation(reservationId);

  if (!reservation) {
    throw createWebhookHandlingError(
      "Reservation not found while loading payment state",
      "ReservationNotFound"
    );
  }

  validatePaymentContract(session, reservation, true);

  if (reservation.status === Lifecycle.RESERVATION_STATUS.CONFIRMED
    && String(reservation.paymentStatus || "").toLowerCase() === "paid"
    && reservationStatus === Lifecycle.RESERVATION_STATUS.CONFIRMED) {
    context.log("Stripe webhook: paid reservation already confirmed", { reservationId });
    return;
  }

  if ([
    Lifecycle.RESERVATION_STATUS.CANCELLED,
    Lifecycle.RESERVATION_STATUS.EXPIRED,
    Lifecycle.RESERVATION_STATUS.IN_PROGRESS,
    Lifecycle.RESERVATION_STATUS.COMPLETED
  ].includes(reservation.status)) {
    if (internalPaymentStatus === "Paid"
      && String(reservation.paymentStatus || "").toLowerCase() !== "refunded") {
      await reconcileLatePayment(context, reservation, session, dependencies);
    }
    return;
  }

  if (reservation.status === Lifecycle.RESERVATION_STATUS.CANCELLATION_PENDING) {
    context.log("Stripe webhook: payment ignored while cancellation is pending", { reservationId });
    return;
  }

  const payment = {
    sessionId: session.id,
    paymentStatus: internalPaymentStatus
  };

  if (session.payment_intent) {
    payment.paymentIntentId = String(session.payment_intent.id || session.payment_intent);
  }

  if (session.url) {
    payment.paymentUrl = session.url;
  }

  if (Number.isInteger(session.amount_total)) {
    payment.amountInMinorUnit = session.amount_total;
  }

  if (session.currency) {
    payment.currency = session.currency;
  }

  const paymentUpdate = await attachPaymentConditionally(
    dependencies.ReservationRepository,
    reservationId,
    payment,
    reservation
  );

  if (!paymentUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while attaching payment",
      "ReservationNotFound"
    );
  }

  let statusUpdate = paymentUpdate;

  if (reservation.status === Lifecycle.RESERVATION_STATUS.PENDING
    && reservationStatus === Lifecycle.RESERVATION_STATUS.CONFIRMED) {
    statusUpdate = await updateStatusConditionally(
      dependencies.ReservationRepository,
      reservationId,
      reservationStatus,
      paymentUpdate || reservation,
      reservation.status
    );
  }

  if (!statusUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while updating reservation status",
      "ReservationNotFound"
    );
  }

  const updatedReservation = await dependencies.ReservationRepository.getReservation(reservationId);

  if (!updatedReservation) {
    throw createWebhookHandlingError(
      "Reservation not found while loading notification details",
      "ReservationNotFound"
    );
  }

  const notificationReservation = buildNotificationReservation(
    updatedReservation,
    session,
    internalPaymentStatus,
    reservationStatus
  );

  if (reservationStatus === "Confirmed") {
    await dependencies.MailService.sendPaymentConfirmationNotification(notificationReservation);
  } else {
    await dependencies.MailService.sendPaymentPendingNotification(notificationReservation);
  }

  context.log("Stripe webhook: reservation updated after checkout.session.completed", {
    reservationId,
    internalPaymentStatus,
    reservationStatus
  });
}

async function handleCheckoutSessionExpired(context, session, dependencies) {
  const reservationId = getReservationIdFromSession(session);

  if (!reservationId) {
    context.log.error("Stripe webhook: checkout.session.expired has no reservationId", { sessionId: session.id });
    return;
  }

  const reservation = await dependencies.ReservationRepository.getReservation(reservationId);

  if (!reservation) {
    throw createWebhookHandlingError(
      "Reservation not found while loading expiration state",
      "ReservationNotFound"
    );
  }

  validatePaymentContract(session, reservation, false);

  if (reservation.status !== Lifecycle.RESERVATION_STATUS.PENDING
    || String(reservation.paymentStatus || "").toLowerCase() === "paid") {
    context.log("Stripe webhook: checkout expiry ignored for non-pending reservation", {
      reservationId,
      status: reservation.status,
      paymentStatus: reservation.paymentStatus
    });
    return;
  }

  const payment = {
    sessionId: session.id,
    paymentStatus: "Expired",
    expiredAt: new Date().toISOString()
  };

  if (Number.isInteger(session.amount_total)) {
    payment.amountInMinorUnit = session.amount_total;
  }

  if (session.currency) {
    payment.currency = session.currency;
  }

  const paymentUpdate = await attachPaymentConditionally(
    dependencies.ReservationRepository,
    reservationId,
    payment,
    reservation
  );

  if (!paymentUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while marking payment as expired",
      "ReservationNotFound"
    );
  }

  const statusUpdate = await updateStatusConditionally(
    dependencies.ReservationRepository,
    reservationId,
    Lifecycle.RESERVATION_STATUS.EXPIRED,
    paymentUpdate || reservation,
    Lifecycle.RESERVATION_STATUS.PENDING
  );

  if (!statusUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while marking reservation expired",
      "ReservationNotFound"
    );
  }

  const updatedReservation = await dependencies.ReservationRepository.getReservation(reservationId);

  if (!updatedReservation) {
    throw createWebhookHandlingError(
      "Reservation not found while loading expiration notification details",
      "ReservationNotFound"
    );
  }

  await dependencies.MailService.sendPaymentExpiredNotification(
    buildNotificationReservation(updatedReservation, session, "Expired", Lifecycle.RESERVATION_STATUS.EXPIRED)
  );

  context.log("Stripe webhook: reservation marked Expired", { reservationId });
}

function getReservationIdFromSession(session) {
  const clientReferenceId = session && session.client_reference_id;
  const metadataReservationId = session && session.metadata && session.metadata.reservationId;

  if (clientReferenceId && metadataReservationId
    && String(clientReferenceId) !== String(metadataReservationId)) {
    throw createWebhookHandlingError("Payment contract mismatch", "PaymentContractMismatch");
  }

  return clientReferenceId || metadataReservationId;
}

function validatePaymentContract(session, reservation, requireAmountAndCurrency) {
  if (!session || !reservation
    || session.id !== reservation.paymentSessionId) {
    throw createWebhookHandlingError("Payment contract mismatch", "PaymentContractMismatch");
  }

  if (session.mode && session.mode !== "payment") {
    throw createWebhookHandlingError("Payment contract mismatch", "PaymentContractMismatch");
  }

  if (!requireAmountAndCurrency) {
    return;
  }

  if (!Number.isInteger(session.amount_total)
    || !Number.isInteger(Number(reservation.paymentAmountMinor))
    || session.amount_total !== Number(reservation.paymentAmountMinor)
    || typeof session.currency !== "string"
    || !session.currency
    || String(session.currency).toLowerCase() !== String(reservation.paymentCurrency || "").toLowerCase()) {
    throw createWebhookHandlingError("Payment contract mismatch", "PaymentContractMismatch");
  }
}

async function attachPaymentConditionally(repository, reservationId, payment, reservation) {
  const options = reservation && reservation.etag
    ? { expectedStatus: reservation.status, expectedEtag: reservation.etag }
    : null;

  return options
    ? repository.attachPayment(reservationId, payment, options)
    : repository.attachPayment(reservationId, payment);
}

async function updateStatusConditionally(repository, reservationId, status, reservation, expectedStatus) {
  const options = reservation && reservation.etag
    ? { expectedStatus: expectedStatus, expectedEtag: reservation.etag }
    : null;

  return options
    ? repository.updateStatus(reservationId, status, options)
    : repository.updateStatus(reservationId, status);
}

async function reconcileLatePayment(context, reservation, session, dependencies) {
  if (typeof dependencies.StripeService.refundCheckoutSessionPayment !== "function") {
    throw createWebhookHandlingError(
      "Stripe refund reconciliation is not configured",
      "RefundReconciliationNotConfigured"
    );
  }

  const refund = await dependencies.StripeService.refundCheckoutSessionPayment({
    sessionId: session.id,
    paymentIntentId: reservation.paymentIntentId,
    refundId: reservation.refundId,
    reservationId: reservation.id,
    idempotencyKey: "reservation-refund:" + reservation.id,
    reason: "requested_by_customer"
  });

  const paymentStatus = refund.status === "succeeded" ? "Refunded" : "RefundPending";
  await attachPaymentConditionally(
    dependencies.ReservationRepository,
    reservation.id,
    {
      sessionId: session.id,
      paymentStatus: paymentStatus,
      paymentIntentId: refund.paymentIntentId,
      refundId: refund.refundId,
      refundCompletedAt: refund.status === "succeeded" ? new Date().toISOString() : undefined
    },
    reservation
  );

  context.log("Stripe webhook: late payment reconciled without resurrecting reservation", {
    reservationId: reservation.id,
    paymentStatus: paymentStatus
  });
}

function buildNotificationReservation(reservation, session, paymentStatus, reservationStatus) {
  const amountInMinorUnit = Number(
    reservation.paymentAmountMinor || session.amount_total || 0
  );
  const currency = String(
    reservation.paymentCurrency || session.currency || "PLN"
  ).toUpperCase();
  const checkoutUrl = reservation.paymentUrl || session.url || "";

  return {
    ...reservation,
    id: reservation.id,
    status: reservationStatus || reservation.status,
    fullName: reservation.customerName,
    email: reservation.customerEmail,
    phone: reservation.customerPhone,
    dateFrom: reservation.fromDate,
    dateTo: reservation.toDate,
    padsCount: reservation.pads,
    deliveryMethod: reservation.deliveryMethod,
    pickupPoint: reservation.pickupPoint,
    notes: reservation.notes,
    amount: amountInMinorUnit > 0 ? amountInMinorUnit / 100 : "-",
    currency: currency,
    paymentIntentId: reservation.paymentIntentId || (session.payment_intent ? String(session.payment_intent.id || session.payment_intent) : ""),
    paymentStatus: paymentStatus,
    paymentSessionId: reservation.paymentSessionId || session.id,
    checkoutUrl: checkoutUrl,
    cancelUrl: reservation.cancellationUrl,
    cancelExpiresAt: reservation.cancellationExpiresAt,
    payment: {
      sessionId: reservation.paymentSessionId || session.id,
      status: paymentStatus,
      checkoutUrl: checkoutUrl,
      amount: amountInMinorUnit > 0 ? amountInMinorUnit / 100 : "-",
      currency: currency,
      paymentIntentId: reservation.paymentIntentId || (session.payment_intent ? String(session.payment_intent.id || session.payment_intent) : "")
    }
  };
}

let activeHandler = createWebhookHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createWebhookHandler = createWebhookHandler;
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createWebhookHandler(overrides);
};
defaultHandler.__resetDependencies = function __resetDependencies() {
  activeHandler = createWebhookHandler();
};

module.exports = defaultHandler;
