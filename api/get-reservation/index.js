const ReservationRepository = require("../repositories/ReservationRepository");
const BotProtectionService = require("../services/BotProtectionService");
const StripeService = require("../services/StripeService");
const MailService = require("../services/MailService");
const { rejectDuringMaintenance } = require("../helpers/maintenance");
const { jsonResponse } = require("../helpers/http");
const { rejectRateLimitedRequest } = require("../helpers/bot-protection");

const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

function isSafeIdentifier(value) {
  return typeof value === "string" && IDENTIFIER_PATTERN.test(value.trim());
}

const defaultDependencies = {
  ReservationRepository,
  BotProtectionService,
  StripeService,
  MailService
};

function checkoutReservationId(session) {
  const clientReferenceId = session && session.client_reference_id;
  const metadataReservationId = session && session.metadata && session.metadata.reservationId;

  if (clientReferenceId && metadataReservationId
    && String(clientReferenceId) !== String(metadataReservationId)) {
    return "";
  }

  return String(clientReferenceId || metadataReservationId || "");
}

function checkoutMatchesReservation(session, reservation) {
  return session
    && session.id === reservation.paymentSessionId
    && checkoutReservationId(session) === reservation.id
    && (!session.mode || session.mode === "payment")
    && Number.isInteger(session.amount_total)
    && session.amount_total === Number(reservation.paymentAmountMinor)
    && typeof session.currency === "string"
    && session.currency.toLowerCase() === String(reservation.paymentCurrency || "").toLowerCase();
}

function confirmationReservation(reservation, session) {
  const paymentIntentId = session.payment_intent
    ? String(session.payment_intent.id || session.payment_intent)
    : reservation.paymentIntentId || "";

  return {
    ...reservation,
    status: "Confirmed",
    paymentStatus: "Paid",
    paymentIntentId,
    amount: Number(session.amount_total) / 100,
    currency: String(session.currency).toUpperCase(),
    cancelUrl: reservation.cancellationUrl,
    cancelExpiresAt: reservation.cancellationExpiresAt
  };
}

async function reconcileCheckoutReturn(context, reservation, dependencies) {
  if (reservation.status !== "Pending"
    || !dependencies.StripeService
    || typeof dependencies.StripeService.getCheckoutSession !== "function") {
    return reservation;
  }

  const session = await dependencies.StripeService.getCheckoutSession(reservation.paymentSessionId);
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";

  if (!paid || !checkoutMatchesReservation(session, reservation)) {
    return reservation;
  }

  const paymentIntentId = session.payment_intent
    ? String(session.payment_intent.id || session.payment_intent)
    : "";
  const options = reservation.etag
    ? { expectedStatus: "Pending", expectedEtag: reservation.etag }
    : undefined;
  const paymentUpdate = await dependencies.ReservationRepository.attachPayment(
    reservation.id,
    {
      sessionId: session.id,
      paymentStatus: "Paid",
      paymentIntentId,
      amountInMinorUnit: session.amount_total,
      currency: session.currency
    },
    options
  );

  if (!paymentUpdate) {
    return reservation;
  }

  const statusOptions = paymentUpdate.etag
    ? { expectedStatus: "Pending", expectedEtag: paymentUpdate.etag }
    : undefined;
  const statusUpdate = await dependencies.ReservationRepository.updateStatus(
    reservation.id,
    "Confirmed",
    statusOptions
  );

  if (!statusUpdate) {
    return reservation;
  }

  const confirmed = {
    ...reservation,
    ...paymentUpdate,
    ...statusUpdate,
    status: "Confirmed",
    paymentStatus: "Paid",
    paymentIntentId
  };

  try {
    await dependencies.MailService.sendPaymentConfirmationNotification(
      confirmationReservation(confirmed, session)
    );
  } catch (error) {
    context.log.error("GetReservation: confirmation email failed after payment reconciliation", {
      reservationId: reservation.id,
      message: error.message,
      code: error.code
    });
  }

  context.log("GetReservation: reconciled paid Stripe checkout", {
    reservationId: reservation.id,
    sessionId: session.id
  });
  return confirmed;
}

function createGetReservationHandler(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  return async function getReservationHandler(context, req) {
    if (rejectDuringMaintenance(context)) {
      return;
    }

    const request = req || context.req || {};
    if (await rejectRateLimitedRequest(context, request, "reservation-lookup", dependencies.BotProtectionService)) {
      return;
    }
    let query = request.query || {};

    if ((!query.id || !query.session_id) && typeof request.url === "string") {
      const parsedUrl = new URL(request.url, "http://localhost");
      query = {
        ...query,
        id: query.id || parsedUrl.searchParams.get("id"),
        reservation_id: query.reservation_id || parsedUrl.searchParams.get("reservation_id"),
        session_id: query.session_id || parsedUrl.searchParams.get("session_id"),
        sessionId: query.sessionId || parsedUrl.searchParams.get("sessionId")
      };
    }
    const id = query.id || query.reservation_id || "";
    const sessionId = query.session_id || query.sessionId || "";

    if (!id || !isSafeIdentifier(id)) {
      context.res = jsonResponse(400, { message: "id query parameter is required", code: "MissingId" });
      return;
    }

    if (!sessionId || !isSafeIdentifier(sessionId)) {
      context.res = jsonResponse(400, { message: "session_id query parameter is required", code: "MissingSessionId" });
      return;
    }

    let reservation;

    try {
      reservation = await dependencies.ReservationRepository.getReservation(id.trim());
    } catch (error) {
      context.log.error("GetReservation error", {
        id: id,
        message: error.message,
        code: error.code
      });
      context.res = jsonResponse(error.statusCode || 503, {
        message: "Unable to load reservation",
        code: error.code || "StorageError"
      });
      return;
    }

    if (!reservation) {
      context.res = jsonResponse(404, { message: "Reservation not found", code: "NotFound" });
      return;
    }

    if (reservation.paymentSessionId !== sessionId.trim()) {
      context.res = jsonResponse(404, { message: "Reservation not found", code: "NotFound" });
      return;
    }

    try {
      reservation = await reconcileCheckoutReturn(context, reservation, dependencies);
    } catch (error) {
      context.log.error("GetReservation: payment reconciliation deferred", {
        id: reservation.id,
        message: error.message,
        code: error.code
      });

      if (error && error.code === "StorageConflict") {
        reservation = await dependencies.ReservationRepository.getReservation(id.trim());
      }
    }

    context.res = jsonResponse(200, {
        id: reservation.id,
        status: reservation.status,
        dateFrom: reservation.fromDate,
        dateTo: reservation.toDate,
        pads: reservation.pads,
        createdAt: reservation.createdAt,
        pickupPoint: reservation.pickupPoint || "",
        payment: {
          status: reservation.paymentStatus || "",
          amount: reservation.paymentAmountMinor
            ? Number(reservation.paymentAmountMinor) / 100
            : null,
          amountMinor: Number(reservation.paymentAmountMinor || 0),
          currency: String(reservation.paymentCurrency || "PLN").toUpperCase()
        }
      });
  };
}

let activeHandler = createGetReservationHandler();

function defaultHandler(context, req) {
  return activeHandler(context, req);
}

defaultHandler.createGetReservationHandler = createGetReservationHandler;
defaultHandler.__setDependencies = function __setDependencies(overrides) {
  activeHandler = createGetReservationHandler(overrides);
};
defaultHandler.__resetDependencies = function __resetDependencies() {
  activeHandler = createGetReservationHandler();
};

module.exports = defaultHandler;
