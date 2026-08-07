const StripeService = require("../services/StripeService");
const ReservationRepository = require("../repositories/ReservationRepository");
const MailService = require("../services/MailService");

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
    const request = req || context.req || {};

    // Stripe signature verification requires the original body payload bytes.
    // Depending on runtime shape we may receive it as req.rawBody or as a
    // plain string in req.body.
    const rawBody = request.rawBody
      || (typeof request.body === "string" ? request.body : "");
    const signature = getHeaderValue(request.headers, "stripe-signature");

    if (!rawBody) {
      context.log.error("Stripe webhook: raw body is missing");
      context.res = {
        status: 400,
        headers: { "Content-Type": "application/json" },
        body: { error: "Raw body unavailable" }
      };
      return;
    }

    if (!signature) {
      context.log.error("Stripe webhook: missing stripe-signature header");
      context.res = { status: 400, headers: { "Content-Type": "application/json" }, body: { error: "Missing stripe-signature" } };
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
      context.res = {
        status: error.statusCode || 400,
        headers: { "Content-Type": "application/json" },
        body: { error: error.message, code: error.code }
      };
      return;
    }

    context.log("Stripe webhook received", { type: event.type, id: event.id });

    try {
      await handleEvent(context, event, dependencies);
    } catch (error) {
      // Return 500 so Stripe retries the delivery.
      context.log.error("Stripe webhook: event handling failed", {
        eventType: event.type,
        eventId: event.id,
        message: error.message,
        code: error.code
      });
      context.res = {
        status: 500,
        headers: { "Content-Type": "application/json" },
        body: { error: "Event handling failed", code: error.code || "InternalError" }
      };
      return;
    }

    context.res = {
      status: 200,
      headers: { "Content-Type": "application/json" },
      body: { received: true, type: event.type }
    };
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
  const reservationId = session.client_reference_id || (session.metadata && session.metadata.reservationId);

  if (!reservationId) {
    context.log.error("Stripe webhook: checkout.session.completed has no reservationId", { sessionId: session.id });
    return;
  }

  const stripePaymentStatus = session.payment_status || "unpaid";
  const internalPaymentStatus = PAYMENT_STATUS_MAP[stripePaymentStatus] || "Unpaid";
  const reservationStatus = RESERVATION_STATUS_ON_PAYMENT[internalPaymentStatus] || "Pending";

  const payment = {
    sessionId: session.id,
    paymentStatus: internalPaymentStatus
  };

  if (session.url) {
    payment.paymentUrl = session.url;
  }

  if (Number.isInteger(session.amount_total)) {
    payment.amountInMinorUnit = session.amount_total;
  }

  if (session.currency) {
    payment.currency = session.currency;
  }

  const paymentUpdate = await dependencies.ReservationRepository.attachPayment(reservationId, payment);

  if (!paymentUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while attaching payment",
      "ReservationNotFound"
    );
  }

  const statusUpdate = await dependencies.ReservationRepository.updateStatus(reservationId, reservationStatus);

  if (!statusUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while updating reservation status",
      "ReservationNotFound"
    );
  }

  const reservation = await dependencies.ReservationRepository.getReservation(reservationId);

  if (!reservation) {
    throw createWebhookHandlingError(
      "Reservation not found while loading notification details",
      "ReservationNotFound"
    );
  }

  const notificationReservation = buildNotificationReservation(
    reservation,
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
  const reservationId = session.client_reference_id || (session.metadata && session.metadata.reservationId);

  if (!reservationId) {
    context.log.error("Stripe webhook: checkout.session.expired has no reservationId", { sessionId: session.id });
    return;
  }

  const payment = {
    sessionId: session.id,
    paymentStatus: "Expired"
  };

  if (Number.isInteger(session.amount_total)) {
    payment.amountInMinorUnit = session.amount_total;
  }

  if (session.currency) {
    payment.currency = session.currency;
  }

  const paymentUpdate = await dependencies.ReservationRepository.attachPayment(reservationId, payment);

  if (!paymentUpdate) {
    throw createWebhookHandlingError(
      "Reservation not found while marking payment as expired",
      "ReservationNotFound"
    );
  }

  const reservation = await dependencies.ReservationRepository.getReservation(reservationId);

  if (!reservation) {
    throw createWebhookHandlingError(
      "Reservation not found while loading expiration notification details",
      "ReservationNotFound"
    );
  }

  await dependencies.MailService.sendPaymentExpiredNotification(
    buildNotificationReservation(reservation, session, "Expired", reservation.status)
  );

  context.log("Stripe webhook: reservation payment marked Expired", { reservationId });
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
      currency: currency
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
