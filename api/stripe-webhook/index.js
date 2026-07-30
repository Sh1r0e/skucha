const StripeService = require("../services/StripeService");
const ReservationRepository = require("../repositories/ReservationRepository");

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

function createWebhookHandler(customDependencies) {
  const dependencies = {
    StripeService,
    ReservationRepository,
    ...(customDependencies || {})
  };

  return async function stripeWebhookHandler(context, req) {
    const request = req || context.req || {};

    // Azure Functions v2 runtime provides the raw body buffer on req.rawBody.
    // Stripe signature verification requires the exact original bytes.
    const rawBody = request.rawBody || request.body || "";
    const signature = (request.headers && request.headers["stripe-signature"]) || "";

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

  await dependencies.ReservationRepository.attachPayment(reservationId, {
    sessionId: session.id,
    paymentStatus: internalPaymentStatus,
    paymentUrl: session.url || ""
  });

  await dependencies.ReservationRepository.updateStatus(reservationId, reservationStatus);

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

  await dependencies.ReservationRepository.attachPayment(reservationId, {
    sessionId: session.id,
    paymentStatus: "Expired",
    paymentUrl: ""
  });

  context.log("Stripe webhook: reservation payment marked Expired", { reservationId });
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
