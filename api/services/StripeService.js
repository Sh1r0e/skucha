const Stripe = require("stripe");
const ConfigurationService = require("./ConfigurationService");

const defaultDependencies = {
  Stripe,
  ConfigurationService
};

function createConfigurationError(message, code) {
  const error = new Error(message);
  error.statusCode = 503;
  error.code = code || "PaymentNotConfigured";
  return error;
}

function createPaymentError(message, cause, code) {
  const error = new Error(message);
  error.statusCode = cause && cause.statusCode ? cause.statusCode : 502;
  error.code = code || "PaymentProviderError";
  error.details = cause && cause.message ? cause.message : undefined;
  return error;
}

function createStripeService(customDependencies) {
  const dependencies = {
    ...defaultDependencies,
    ...(customDependencies || {})
  };

  let client = null;

  function getClient() {
    if (client) {
      return client;
    }

    if (dependencies.stripeClient) {
      client = dependencies.stripeClient;
      return client;
    }

    const stripeKey = dependencies.ConfigurationService.getStripeSecretKey();

    if (!stripeKey) {
      throw createConfigurationError("Stripe secret key is not configured", "PaymentNotConfigured");
    }

    client = new dependencies.Stripe(stripeKey);
    return client;
  }

  async function createCheckoutSession(params) {
    const amountInMinorUnit = Number(params.amountInMinorUnit || 0);

    if (!Number.isInteger(amountInMinorUnit) || amountInMinorUnit < 1) {
      const validationError = new Error("Payment amount must be a positive integer in minor units");
      validationError.statusCode = 400;
      validationError.code = "InvalidPaymentAmount";
      throw validationError;
    }

    const successUrl = params.successUrl || dependencies.ConfigurationService.getStripeCheckoutSuccessUrl();
    const cancelUrl = params.cancelUrl || dependencies.ConfigurationService.getStripeCheckoutCancelUrl();

    if (!successUrl || !cancelUrl) {
      throw createConfigurationError(
        "Stripe checkout success and cancel URLs must be configured",
        "PaymentUrlsNotConfigured"
      );
    }

    const stripeClient = getClient();

    // Append reservation_id so redirect pages can fetch authoritative status
    // without relying on localStorage alone.
    function appendReservationId(url, id) {
      if (!url || !id) { return url || ""; }
      return url + (url.includes("?") ? "&" : "?") + "reservation_id=" + encodeURIComponent(id);
    }

    const successUrlFinal = appendReservationId(successUrl, params.reservationId);
    const cancelUrlFinal = appendReservationId(cancelUrl, params.reservationId);

    try {
      const session = await stripeClient.checkout.sessions.create({
        mode: "payment",
        success_url: successUrlFinal,
        cancel_url: cancelUrlFinal,
        customer_email: params.customerEmail,
        client_reference_id: params.reservationId,
        payment_method_types: ["card"],
        metadata: {
          reservationId: params.reservationId,
          customerEmail: params.customerEmail,
          dateFrom: params.dateFrom,
          dateTo: params.dateTo,
          padsCount: String(params.padsCount || "")
        },
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: String(params.currency || "pln").toLowerCase(),
              unit_amount: amountInMinorUnit,
              product_data: {
                name: params.productName || "Crash pad reservation",
                description: params.description || "Reservation payment"
              }
            }
          }
        ]
      });

      return {
        sessionId: session.id,
        url: session.url,
        paymentStatus: session.payment_status || "unpaid"
      };
    } catch (error) {
      throw createPaymentError("Unable to create Stripe checkout session", error, "PaymentProviderError");
    }
  }

  function verifyWebhookSignature(rawBody, signature) {
    const webhookSecret = dependencies.ConfigurationService.getStripeWebhookSecret();

    if (!webhookSecret) {
      throw createConfigurationError(
        "Stripe webhook secret is not configured",
        "WebhookSecretNotConfigured"
      );
    }

    const stripeClient = getClient();

    try {
      return stripeClient.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (error) {
      const signatureError = new Error("Webhook signature verification failed");
      signatureError.statusCode = 400;
      signatureError.code = "WebhookSignatureInvalid";
      signatureError.details = error && error.message ? error.message : undefined;
      throw signatureError;
    }
  }

  async function getCheckoutSession(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      const validationError = new Error("sessionId is required");
      validationError.statusCode = 400;
      validationError.code = "MissingSessionId";
      throw validationError;
    }

    try {
      return await getClient().checkout.sessions.retrieve(normalizedSessionId);
    } catch (error) {
      throw createPaymentError("Unable to load Stripe checkout session", error, "PaymentProviderError");
    }
  }

  async function refundCheckoutSessionPayment(params) {
    const sessionId = String((params && params.sessionId) || "").trim();

    if (!sessionId) {
      const validationError = new Error("sessionId is required for refund");
      validationError.statusCode = 400;
      validationError.code = "MissingSessionId";
      throw validationError;
    }

    const stripeClient = getClient();

    if (params && params.refundId) {
      try {
        const existingRefund = await stripeClient.refunds.retrieve(String(params.refundId));
        return {
          refundId: existingRefund.id,
          status: existingRefund.status || "pending",
          paymentIntentId: existingRefund.payment_intent || params.paymentIntentId || ""
        };
      } catch (error) {
        throw createPaymentError("Unable to load existing Stripe refund", error, "PaymentProviderError");
      }
    }

    let session;

    let paymentIntentId = String((params && params.paymentIntentId) || "").trim();

    if (!paymentIntentId) {
      try {
        session = await stripeClient.checkout.sessions.retrieve(sessionId);
      } catch (error) {
        throw createPaymentError("Unable to load Stripe checkout session", error, "PaymentProviderError");
      }

      paymentIntentId = session && session.payment_intent
        ? String(session.payment_intent.id || session.payment_intent)
        : "";
    }

    if (!paymentIntentId) {
      const notRefundable = new Error("Checkout session has no payment intent to refund");
      notRefundable.statusCode = 409;
      notRefundable.code = "PaymentNotRefundable";
      throw notRefundable;
    }

    try {
      const refundParams = {
        payment_intent: paymentIntentId,
        reason: (params && params.reason) || "requested_by_customer",
        metadata: {
          reservationId: (params && params.reservationId) || ""
        }
      };
      const requestOptions = params && params.idempotencyKey
        ? { idempotencyKey: String(params.idempotencyKey) }
        : undefined;
      const refund = requestOptions
        ? await stripeClient.refunds.create(refundParams, requestOptions)
        : await stripeClient.refunds.create(refundParams);

      return {
        refundId: refund.id,
        status: refund.status || "pending",
        paymentIntentId: paymentIntentId
      };
    } catch (error) {
      throw createPaymentError("Unable to create Stripe refund", error, "RefundFailed");
    }
  }

  async function expireCheckoutSession(sessionId) {
    const normalizedSessionId = String(sessionId || "").trim();

    if (!normalizedSessionId) {
      const validationError = new Error("sessionId is required to expire checkout");
      validationError.statusCode = 400;
      validationError.code = "MissingSessionId";
      throw validationError;
    }

    const stripeClient = getClient();
    let session;

    try {
      session = await stripeClient.checkout.sessions.retrieve(normalizedSessionId);
    } catch (error) {
      throw createPaymentError("Unable to load Stripe checkout session", error, "PaymentProviderError");
    }

    if (session.payment_status === "paid" || session.status === "complete") {
      return {
        sessionId: normalizedSessionId,
        status: session.status || "complete",
        paymentStatus: "Paid",
        expired: false
      };
    }

    if (session.status && session.status !== "open") {
      return {
        sessionId: normalizedSessionId,
        status: session.status,
        paymentStatus: session.payment_status || "expired",
        expired: session.status === "expired"
      };
    }

    try {
      const expired = await stripeClient.checkout.sessions.expire(normalizedSessionId);
      return {
        sessionId: normalizedSessionId,
        status: expired.status || "expired",
        paymentStatus: expired.payment_status || "expired",
        expired: true
      };
    } catch (error) {
      throw createPaymentError("Unable to expire Stripe checkout session", error, "CheckoutExpirationFailed");
    }
  }

  return {
    createCheckoutSession,
    getCheckoutSession,
    verifyWebhookSignature,
    refundCheckoutSessionPayment,
    expireCheckoutSession
  };
}

let activeService = createStripeService();

function __setDependencies(overrides) {
  activeService = createStripeService(overrides);
}

function __resetDependencies() {
  activeService = createStripeService();
}

module.exports = {
  createCheckoutSession: function createCheckoutSessionProxy(params) {
    return activeService.createCheckoutSession(params);
  },
  getCheckoutSession: function getCheckoutSessionProxy(sessionId) {
    return activeService.getCheckoutSession(sessionId);
  },
  verifyWebhookSignature: function verifyWebhookSignatureProxy(rawBody, signature) {
    return activeService.verifyWebhookSignature(rawBody, signature);
  },
  refundCheckoutSessionPayment: function refundCheckoutSessionPaymentProxy(params) {
    return activeService.refundCheckoutSessionPayment(params);
  },
  expireCheckoutSession: function expireCheckoutSessionProxy(sessionId) {
    return activeService.expireCheckoutSession(sessionId);
  },
  createStripeService,
  __setDependencies,
  __resetDependencies
};
